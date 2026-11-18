// Supabase Edge Function: squad-verify
// -----------------------------------------------------------------------------
// Verifies Squad by GTCO transactions (both full-order payments and multi-person
// split-bill share payments where each payer gets their own Squad account number).
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

function parseSplitProgress(paymentRef: string | null): { paidKobo: number; refs: string[] } {
  if (!paymentRef) return { paidKobo: 0, refs: [] }
  const m = paymentRef.match(/^PAID_KOBO:(\d+)\|REFS:(.+)$/)
  if (!m) return { paidKobo: 0, refs: [] }
  const paidKobo = parseInt(m[1], 10) || 0
  const refs = m[2]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return { paidKobo, refs }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REF_RE = /^[A-Za-z0-9._=-]{4,120}$/

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  const envKeys = Object.keys(Deno.env.toObject())
  const squadKeyName = envKeys.find(
    (k) => k.toLowerCase() === 'squad_secret_key' || k.toLowerCase().includes('squad_secret'),
  )
  let squadSecret = squadKeyName ? Deno.env.get(squadKeyName)?.trim() : undefined

  let reference: string, orderId: string, shareAmountNaira: number | null
  try {
    const body = await req.json()
    reference = String(body.reference ?? body.transaction_ref ?? '').trim()
    orderId = String(body.order_id ?? '').trim()
    shareAmountNaira = body.share_amount != null ? Number(body.share_amount) : null
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400)
  }

  if (!REF_RE.test(reference) || !UUID_RE.test(orderId)) {
    return json({ ok: false, error: 'Missing or invalid reference / order_id' }, 400)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, getAdminKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

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

  // 1. Load the order from the database
  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('id, total, payment_method, payment_status, payment_reference')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError) return json({ ok: false, error: orderError.message }, 500)
  if (!order) return json({ ok: false, error: 'Order not found' }, 404)
  if (order.payment_status === 'paid') {
    return json({ ok: true, status: 'paid', share_paid: true, reference: order.payment_reference })
  }

  // 2. Call Squad's Verify Transaction API endpoint
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
  const expectedOrderKobo = Math.round(Number(order.total) * 100)
  const isSplitShare = /-P\d+/i.test(txRef) || (shareAmountNaira != null && shareAmountNaira > 0 && Math.round(shareAmountNaira * 100) < expectedOrderKobo)

  if (txStatus !== 'success') {
    if (!isSplitShare && (txStatus === 'failed' || txStatus === 'abandoned')) {
      await admin.from('orders').update({ payment_status: 'failed' }).eq('id', orderId)
    }
    return json(
      { ok: false, status: txStatus, error: `Transaction status is ${tx.transaction_status ?? 'not successful'}` },
      402,
    )
  }

  if (txCurrency !== 'NGN') {
    return json({ ok: false, error: `Invalid currency ${txCurrency}` }, 400)
  }

  const metaOrderId = tx.meta?.order_id ?? tx.metadata?.order_id
  if (metaOrderId && metaOrderId !== orderId) {
    return json({ ok: false, error: 'This payment belongs to a different order' }, 400)
  }

  // 3A. Handle individual split-bill share payment
  if (isSplitShare) {
    if (shareAmountNaira != null && shareAmountNaira > 0) {
      const expectedShareKobo = Math.round(shareAmountNaira * 100)
      if (Math.abs(txAmountKobo - expectedShareKobo) > 100) {
        return json(
          {
            ok: false,
            error: `Share amount mismatch: paid ${txAmountKobo} kobo, expected ${expectedShareKobo} kobo`,
          },
          400,
        )
      }
    }

    const progress = parseSplitProgress(order.payment_reference)
    const alreadyCounted = progress.refs.includes(txRef)
    const nextRefs = alreadyCounted ? progress.refs : [...progress.refs, txRef]
    const nextPaidKobo = alreadyCounted ? progress.paidKobo : progress.paidKobo + txAmountKobo

    // Allow up to 1 Naira (100 kobo) rounding tolerance across split shares
    if (nextPaidKobo + 100 >= expectedOrderKobo) {
      await admin
        .from('orders')
        .update({
          payment_method: 'squad',
          payment_status: 'paid',
          payment_reference: nextRefs.join(', ').slice(0, 240),
        })
        .eq('id', orderId)

      return json({
        ok: true,
        status: 'paid',
        share_paid: true,
        paid_kobo: nextPaidKobo,
        expected_kobo: expectedOrderKobo,
        reference: txRef,
      })
    } else {
      const encodedProgress = `PAID_KOBO:${nextPaidKobo}|REFS:${nextRefs.join(',')}`
      await admin
        .from('orders')
        .update({
          payment_reference: encodedProgress,
        })
        .eq('id', orderId)

      return json({
        ok: true,
        status: 'partial',
        share_paid: true,
        paid_kobo: nextPaidKobo,
        expected_kobo: expectedOrderKobo,
        reference: txRef,
      })
    }
  }

  // 3B. Handle standard single full-order payment
  if (txAmountKobo < expectedOrderKobo) {
    return json(
      {
        ok: false,
        error: `Amount mismatch: paid ${txAmountKobo} kobo (${txCurrency}), expected ${expectedOrderKobo} kobo (NGN)`,
      },
      400,
    )
  }

  const { error: updateError } = await admin
    .from('orders')
    .update({ payment_method: 'squad', payment_status: 'paid', payment_reference: txRef })
    .eq('id', orderId)

  if (updateError) {
    const msg =
      updateError.code === '23505'
        ? 'This Squad transaction reference has already been used'
        : updateError.message
    return json({ ok: false, error: msg }, 409)
  }

  return json({ ok: true, status: 'paid', share_paid: true, reference: txRef })
})
