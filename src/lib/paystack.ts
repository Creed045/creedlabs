// Paystack Inline (v2) helper. Uses the PUBLIC key only.
// The secret key lives exclusively in the verify-payment Edge Function.

import { CURRENCY, PAYSTACK_PUBLIC_KEY, toSubunits } from './config'

const SCRIPT_SRC = 'https://js.paystack.co/v2/inline.js'

interface PaystackTransaction {
  reference: string
  status?: string
  message?: string
  trans?: string
}

interface NewTransactionOptions {
  key: string
  email: string
  amount: number
  currency: string
  reference: string
  firstName?: string
  phone?: string
  metadata?: Record<string, unknown>
  onSuccess: (tx: PaystackTransaction) => void
  onCancel: () => void
  onError: (error: { message?: string }) => void
}

interface PaystackPopInstance {
  newTransaction: (options: NewTransactionOptions) => void
}

declare global {
  interface Window {
    PaystackPop?: new () => PaystackPopInstance
  }
}

let scriptPromise: Promise<void> | null = null

export function loadPaystack(): Promise<void> {
  if (window.PaystackPop) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('Could not load Paystack. Check your internet connection.'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

export type PaystackResult =
  | { outcome: 'success'; reference: string }
  | { outcome: 'cancelled' }
  | { outcome: 'error'; message: string }

export function isPaystackConfigured(): boolean {
  return PAYSTACK_PUBLIC_KEY.startsWith('pk_')
}

/** A fresh, unique reference for every payment attempt on an order. */
export function makeReference(orderId: string): string {
  return `ORD-${orderId.slice(0, 8)}-${Date.now().toString(36)}`
}

export async function payWithPaystack(params: {
  email: string
  amountNaira: number
  reference: string
  orderId: string
  name: string
  phone: string
}): Promise<PaystackResult> {
  if (!isPaystackConfigured()) {
    return { outcome: 'error', message: 'Paystack public key is missing (VITE_PAYSTACK_PUBLIC_KEY).' }
  }

  try {
    await loadPaystack()
  } catch (e) {
    return { outcome: 'error', message: (e as Error).message }
  }

  const Pop = window.PaystackPop
  if (!Pop) return { outcome: 'error', message: 'Paystack failed to initialise.' }

  return new Promise<PaystackResult>((resolve) => {
    const popup = new Pop()
    popup.newTransaction({
      key: PAYSTACK_PUBLIC_KEY,
      email: params.email,
      amount: toSubunits(params.amountNaira), // kobo
      currency: CURRENCY.code, // NGN
      reference: params.reference,
      firstName: params.name,
      phone: params.phone,
      metadata: { order_id: params.orderId },
      onSuccess: (tx) => resolve({ outcome: 'success', reference: tx.reference }),
      onCancel: () => resolve({ outcome: 'cancelled' }),
      onError: (err) => resolve({ outcome: 'error', message: err?.message ?? 'Payment failed' }),
    })
  })
}
