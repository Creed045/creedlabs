// Supabase Edge Function: squad-webhook
// -----------------------------------------------------------------------------
// Receives Squad by GTCO payment notifications (Event: "charge_successful").
// Validates the `x-squad-encrypted-body` header using HMAC-SHA512 of the raw
// request body keyed by SQUAD_SECRET_KEY (as documented at docs.squadco.com).
// Ignores invalid requests, verifies the kobo amount against public.orders,
// and marks the matching order paid. Safe to receive the same event twice.
// Deploy with `--no-verify-jwt`.
// -----------------------------------------------------------------------------

import { createClient } from 'npm:@supabase/supabase-js@2'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function getAdminKey(): string {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys) as Record<string, string>
      if (parsed.default) return parsed.default
    } catch {
      /* fall through to legacy key */
    }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!legacy) throw new Error('No Supabase admin key available in the function environment')
  return legacy
}

async function computeHmacSha512Hex(secret: string, rawBody: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const cleanA = a.trim().toLowerCase()
  const cleanB = b.trim().toLowerCase()
  if (cleanA.length !== cleanB.length || cleanA.length === 0) return false
  let diff = 0
  for (let i = 0; i < cleanA.length; i++) {
    diff |= cleanA.charCodeAt(i) ^ cleanB.charCodeAt(i)
  }
  return diff === 0
}

/** Extracts a UUID from references formatted as `SQ-<32hex>-<timestamp>`. */
function extractOrderUuidFromRef(ref: string): string | null {
  const m = ref.match(/^SQ-([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})-/i)
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}-${m[4]}-${m[5]}`.toLowerCase()
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  const envKeys = Object.keys(Deno.env.toObject())
  const squadKeyName = envKeys.find(
    (k) => k.toLowerCase() === 'squad_secret_key' || k.toLowerCase().includes('squad_secret'),
  )
  let squadSecret = squadKeyName ? Deno.env.get(squadKeyName)?.trim() : undefined

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, getAdminKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Fallback: If not in environment variables, check secure app_secrets table in DB
  if (!squadSecret) {
    const { data: dbSec } = await admin
      .from('app_secrets')
      .select('value')
      .eq('key', 'squad_secret_key')
      .maybeSingle()
    if (dbSec?.value) squadSecret = dbSec.value.trim()
  }

  if (!squadSecret) {
    return json({ ok: false, error: 'Server is missing SQUAD_SECRET_KEY secret' }, 500)
  }

  const signature = req.headers.get('x-squad-encrypted-body') ?? ''
  if (!signature) {
    return json({ ok: false, error: 'Missing x-squad-encrypted-body header' }, 401)
  }

  const rawBody = await req.text()
  const expectedHex = await computeHmacSha512Hex(squadSecret, rawBody)

  if (!timingSafeEqualHex(signature, expectedHex)) {
    return json({ ok: false, error: 'Invalid webhook signature' }, 401)
  }

  let payload: {
    Event?: string
    event?: string
    TransactionRef?: string
    Body?: {
      amount?: number
      transaction_ref?: string
      transaction_status?: string
      currency?: string
      currency_code?: string
      meta?: { order_id?: string } | null
      metadata?: { order_id?: string } | null
    }
  }

  try {
    payload = JSON.parse(rawBody)
  } catch {
    return json({ ok: false, error: 'Invalid JSON payload' }, 400)
  }

  const eventName = String(payload.Event ?? payload.event ?? '').toLowerCase()
  const body = payload.Body ?? {}
  const txRef = String(payload.TransactionRef ?? body.transaction_ref ?? '').trim()
  const txStatus = String(body.transaction_status ?? '').toLowerCase()

  // Acknowledge non-charge events cleanly so Squad doesn't retry them
  if (eventName !== 'charge_successful' || txStatus !== 'success' || !txRef) {
    return json({ ok: true, ignored: true, event: eventName })
  }

  // 1. Find the matching order by payment_reference or embedded order UUID / metadata
  let { data: order, error: findErr } = await admin
    .from('orders')
    .select('id, total, payment_method, payment_status, payment_reference')
    .eq('payment_reference', txRef)
    .maybeSingle()

  if (findErr) return json({ ok: false, error: findErr.message }, 500)

  if (!order) {
    const fallbackOrderId =
      body.meta?.order_id ?? body.metadata?.order_id ?? extractOrderUuidFromRef(txRef)
    if (fallbackOrderId) {
      const res = await admin
        .from('orders')
        .select('id, total, payment_method, payment_status, payment_reference')
        .eq('id', fallbackOrderId)
        .maybeSingle()
      order = res.data
    }
  }

  if (!order) {
    // Return 200 so Squad doesn't infinitely retry an unknown reference
    return json({ ok: true, ignored: true, reason: 'Order not found for reference' })
  }

  // 2. Idempotency check: safe to receive the same event twice
  if (order.payment_status === 'paid') {
    return json({ ok: true, status: 'paid', idempotent: true, order_id: order.id })
  }

  // 3. Verify amount in kobo matches the order total stored in public.orders
  const expectedKobo = Math.round(Number(order.total) * 100)
  const paidKobo = Math.round(Number(body.amount ?? 0))
  const currency = String(body.currency ?? body.currency_code ?? 'NGN').toUpperCase()

  if (currency !== 'NGN' || paidKobo !== expectedKobo) {
    return json(
      {
        ok: false,
        error: `Amount mismatch: webhook reported ${paidKobo} kobo (${currency}), order expects ${expectedKobo} kobo (NGN)`,
      },
      400,
    )
  }

  // 4. Mark order paid
  const { error: updateErr } = await admin
    .from('orders')
    .update({ payment_status: 'paid', payment_reference: txRef })
    .eq('id', order.id)

  if (updateErr) {
    return json({ ok: false, error: updateErr.message }, 500)
  }

  return json({ ok: true, status: 'paid', order_id: order.id, reference: txRef })
})