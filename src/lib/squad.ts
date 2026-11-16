// Squad by GTCO Inline Checkout helper (docs.squadco.com).
// Uses VITE_SQUAD_PUBLIC_KEY in the browser ONLY.
// The secret key (SQUAD_SECRET_KEY) lives exclusively in Supabase Edge Functions.

import { CURRENCY, SQUAD_PUBLIC_KEY, toSubunits } from './config'

const SCRIPT_SRC = 'https://checkout.squadco.com/widget/squad.min.js'

interface SquadSuccessPayload {
  transaction_ref?: string
  reference?: string
  message?: string
}

interface SquadInitOptions {
  key: string
  email: string
  /** Amount in kobo (Naira * 100). */
  amount: number
  currency_code: 'NGN' | 'USD'
  transaction_ref: string
  customer_name?: string
  pass_charge?: boolean
  metadata?: Record<string, unknown>
  onLoad?: () => void
  onSuccess: (payload?: SquadSuccessPayload) => void
  onClose: () => void
}

interface SquadModalInstance {
  setup: () => void
  open: () => void
}

declare global {
  interface Window {
    squad?: new (options: SquadInitOptions) => SquadModalInstance
  }
}

let scriptPromise: Promise<void> | null = null

export function loadSquadScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.squad) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('Could not load Squad checkout widget. Check your internet connection.'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

export type SquadResult =
  | { outcome: 'success'; reference: string }
  | { outcome: 'cancelled' }
  | { outcome: 'error'; message: string }

export function isSquadConfigured(): boolean {
  return /^(pk_|sandbox_pk_|test_pk_|live_pk_)/i.test(SQUAD_PUBLIC_KEY)
}

/**
 * Generates a unique, case-sensitive transaction reference for Squad.
 * Embeds the 32-hex order UUID so both squad-verify and squad-webhook
 * can always correlate a payment attempt with the order.
 */
export function makeSquadReference(orderId: string): string {
  const hex = orderId.replace(/-/g, '').toLowerCase()
  const ts = Date.now().toString(36).toUpperCase()
  return `SQ-${hex}-${ts}`
}

export async function payWithSquad(params: {
  email: string
  amountNaira: number
  reference: string
  orderId: string
  name: string
}): Promise<SquadResult> {
  if (!isSquadConfigured()) {
    return {
      outcome: 'error',
      message: 'Squad public key is missing (VITE_SQUAD_PUBLIC_KEY in .env).',
    }
  }

  try {
    await loadSquadScript()
  } catch (e) {
    return { outcome: 'error', message: (e as Error).message }
  }

  const SquadWidget = window.squad
  if (!SquadWidget) {
    return { outcome: 'error', message: 'Squad checkout widget failed to initialise.' }
  }

  return new Promise<SquadResult>((resolve) => {
    let settled = false
    const finish = (res: SquadResult) => {
      if (settled) return
      settled = true
      resolve(res)
    }

    try {
      const squadInstance = new SquadWidget({
        key: SQUAD_PUBLIC_KEY,
        email: params.email,
        amount: toSubunits(params.amountNaira), // kobo (Naira * 100)
        currency_code: CURRENCY.code, // 'NGN'
        transaction_ref: params.reference,
        customer_name: params.name,
        pass_charge: false,
        metadata: {
          order_id: params.orderId,
          customer_name: params.name,
        },
        onLoad: () => {
          /* modal opened */
        },
        onSuccess: (tx) => {
          const ref = tx?.transaction_ref || tx?.reference || params.reference
          finish({ outcome: 'success', reference: String(ref) })
        },
        onClose: () => {
          finish({ outcome: 'cancelled' })
        },
      })

      squadInstance.setup()
      squadInstance.open()
    } catch (err) {
      finish({
        outcome: 'error',
        message: (err as Error)?.message ?? 'Could not open Squad checkout modal',
      })
    }
  })
}