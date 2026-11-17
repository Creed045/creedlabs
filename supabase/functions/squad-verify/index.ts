// Supabase Edge Function: squad-verify
// -----------------------------------------------------------------------------
// Called by the frontend AFTER the Squad by GTCO inline modal reports success.
// Calls Squad's Verify Transaction endpoint using SQUAD_SECRET_KEY (never exposed
// to the browser), verifies that transaction_status is "Success" and that
// transaction_amount (in kobo) matches the total stored in public.orders,
// and only then sets payment_status = 'paid' and saves payment_reference.
//
// Official Squad API Base URLs (docs.squadco.com):
//   Sandbox: https://sandbox-api-d.squadco.com/transaction/verify/:transaction_ref
//   Live:    https://api-d.squadco.com/transaction/verify/:transaction_ref
// -----------------------------------------------------------------------------

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

function getSquadApiBaseUrl(secretKey: string): string {
  const trimmed = secretKey.trim()
  if (/^(sandbox_sk_|test_sk_)/i.test(trimmed)) {
    return 'https://sandbox-api-d.squadco.com'
  }
  return 'https://api-d.squadco.com'
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REF_RE = /^[A-Za-z0-9._=-]{4,120}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  const envKeys = Object.keys(Deno.env.toObject())
  const squadKeyName = envKeys.find(
    (k) => k.toLowerCase() === 'squad_secret_key' || k.toLowerCase().includes('squad_secret'),
  )
  const squadSecret = squadKeyName ? Deno.env.get(squadKeyName)?.trim() : undefined
  if (!squadSecret) {
    return json({ ok: false, error: 'Server is missing SQUAD_SECRET_KEY secret' }, 500)
  }

  let reference: string, orderId: string
  try {
    const body = await req.json()
    reference = String(body.reference ?? body.transaction_ref ?? '').trim()
    orderId = String(body.order_id ?? '').trim()
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400)
  }

  if (!REF_RE.test(reference) || !UUID_RE.test(orderId)) {
    return json({ ok: false, error: 'Missing or invalid reference / order_id' }, 400)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, getAdminKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1. Load the order from the database (source of truth for the total amount).
  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('id, total, payment_method, payment_status, payment_reference')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError) return json({ ok: false, error: orderError.message }, 500)
  if (!order) return json({ ok: false, error: 'Order not found' }, 404)
  if (order.payment_method !== 'squad') {
    return json({ ok: false, error: 'This order is not a Squad order' }, 400)
  }
  if (order.payment_status === 'paid') {
    return json({ ok: true, status: 'paid', reference: order.payment_reference })
  }

  // 2. Call Squad's Verify Transaction API endpoint.
  const baseUrl = getSquadApiBaseUrl(squadSecret)
  const verifyUrl = `${baseUrl}/transaction/verify/${encodeURIComponent(reference)}`

  const sqRes = await fetch(verifyUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${squadSecret}`,
      'Content-Type': 'application/json',
    },
  })

  const sq = await sqRes.json().catch(() => null)
  if (!sqRes.ok || !sq?.data) {
    return json(
      { ok: false, error: sq?.message ?? 'Could not verify transaction with Squad' },
      502,
    )
  }

  const tx = sq.data as {
    transaction_status?: string
    transaction_amount?: number
    transaction_ref?: string
    transaction_currency_id?: string
    currency?: string
    meta?: { order_id?: string } | null
    metadata?: { order_id?: string } | null
  }

  const txStatus = String(tx.transaction_status ?? '').toLowerCase()
  const txAmountKobo = Math.round(Number(tx.transaction_amount ?? 0))
  const txCurrency = String(tx.transaction_currency_id ?? tx.currency ?? 'NGN').toUpperCase()
  const txRef = String(tx.transaction_ref ?? reference)
  const expectedKobo = Math.round(Number(order.total) * 100)

  if (txStatus !== 'success') {
    if (txStatus === 'failed' || txStatus === 'abandoned') {
      await admin.from('orders').update({ payment_status: 'failed' }).eq('id', orderId)
    }
    return json({ ok: false, status: txStatus, error: `Transaction status is ${tx.transaction_status ?? 'not successful'}` }, 402)
  }

  if (txCurrency !== 'NGN' || txAmountKobo !== expectedKobo) {
    return json(
      {
        ok: false,
        error: `Amount mismatch: paid ${txAmountKobo} kobo (${txCurrency}), expected ${expectedKobo} kobo (NGN)`,
      },
      400,
    )
  }

  const metaOrderId = tx.meta?.order_id ?? tx.metadata?.order_id
  if (metaOrderId && metaOrderId !== orderId) {
    return json({ ok: false, error: 'This payment belongs to a different order' }, 400)
  }

  // 3. Mark the order as paid and store the verified transaction reference.
  const { error: updateError } = await admin
    .from('orders')
    .update({ payment_status: 'paid', payment_reference: txRef })
    .eq('id', orderId)

  if (updateError) {
    const msg =
      updateError.code === '23505'
        ? 'This Squad transaction reference has already been used'
        : updateError.message
    return json({ ok: false, error: msg }, 409)
  }

  return json({ ok: true, status: 'paid', reference: txRef })
})