// Supabase Edge Function: verify-payment
// ---------------------------------------------------------------
// Called by the browser AFTER the Paystack popup reports success.
// It asks Paystack (with the SECRET key, which never leaves the
// server) whether the transaction really succeeded, checks the
// amount and currency against the order stored in the database,
// and only then marks the order as paid.
//
// Required secret (set with the Supabase CLI or dashboard):
//   PAYSTACK_SECRET_KEY = sk_test_xxx   (sk_live_xxx in production)
//
// SUPABASE_URL and the service-role / secret key are injected
// automatically by Supabase into every Edge Function.
// ---------------------------------------------------------------

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

/** Works with both the new `sb_secret_...` keys and the legacy service_role key. */
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REF_RE = /^[A-Za-z0-9.=-]{6,100}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY')
  if (!paystackSecret) {
    return json({ ok: false, error: 'Server is missing PAYSTACK_SECRET_KEY' }, 500)
  }

  let reference: string, orderId: string
  try {
    const body = await req.json()
    reference = String(body.reference ?? '')
    orderId = String(body.order_id ?? '')
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400)
  }
  if (!REF_RE.test(reference) || !UUID_RE.test(orderId)) {
    return json({ ok: false, error: 'Missing or invalid reference / order_id' }, 400)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, getAdminKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1. Load the order from the database (source of truth for the amount).
  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('id, total, payment_method, payment_status, payment_reference')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError) return json({ ok: false, error: orderError.message }, 500)
  if (!order) return json({ ok: false, error: 'Order not found' }, 404)
  if (order.payment_method !== 'paystack') {
    return json({ ok: false, error: 'This order is not a Paystack order' }, 400)
  }
  if (order.payment_status === 'paid') {
    // Idempotent: verifying twice is fine.
    return json({ ok: true, status: 'paid', reference: order.payment_reference })
  }

  // 2. Ask Paystack about the transaction.
  const psRes = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${paystackSecret}` } },
  )
  const ps = await psRes.json().catch(() => null)

  if (!psRes.ok || !ps?.status || !ps.data) {
    return json(
      { ok: false, error: ps?.message ?? 'Could not reach Paystack to verify payment' },
      502,
    )
  }

  const tx = ps.data as {
    status: string
    amount: number
    currency: string
    reference: string
    metadata?: { order_id?: string } | string | null
  }

  const expectedKobo = Math.round(Number(order.total) * 100)
  const metaOrderId =
    tx.metadata && typeof tx.metadata === 'object' ? tx.metadata.order_id : undefined

  if (tx.status !== 'success') {
    if (tx.status === 'failed') {
      await admin.from('orders').update({ payment_status: 'failed' }).eq('id', orderId)
    }
    return json({ ok: false, status: tx.status, error: `Payment ${tx.status}` }, 402)
  }

  if (tx.currency !== 'NGN' || tx.amount !== expectedKobo) {
    return json(
      {
        ok: false,
        error: `Amount mismatch: paid ${tx.amount} ${tx.currency}, expected ${expectedKobo} NGN`,
      },
      400,
    )
  }

  if (metaOrderId && metaOrderId !== orderId) {
    return json({ ok: false, error: 'This payment belongs to a different order' }, 400)
  }

  // 3. All checks passed → mark the order as paid.
  const { error: updateError } = await admin
    .from('orders')
    .update({ payment_status: 'paid', payment_reference: tx.reference })
    .eq('id', orderId)

  if (updateError) {
    // Unique violation = this reference was already used for another order.
    const msg = updateError.code === '23505'
      ? 'This payment reference has already been used'
      : updateError.message
    return json({ ok: false, error: msg }, 409)
  }

  return json({ ok: true, status: 'paid', reference: tx.reference })
})
