import { useCallback, useEffect, useRef, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { CartLine, Order, OrderStatus, PaymentMethod } from './types'

export interface CustomerDetails {
  customer_name: string
  /** Either "Table 4" (from NFC/table link) or a delivery street address. */
  address: string
  /** Customer notes and allergies. */
  notes: string
}

/**
 * Places an order as an anonymous customer.
 * Phone and email are not required from the customer; the DB trigger fills safe defaults.
 */
function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
export async function placeOrder(
  details: CustomerDetails,
  lines: CartLine[],
  paymentMethod: PaymentMethod,
): Promise<{ id: string; error: string | null }> {
  const id = generateUuid()
  const { error } = await supabase.from('orders').insert({
    id,
    customer_name: details.customer_name,
    phone: 'N/A  ',
    email: `order-${id.slice(0, 8).toLowerCase()}@mamaput.kitchen`,
    address: details.address,
    notes: details.notes,
    items: lines.map((l) => ({ id: l.id, name: l.name, price: l.price, quantity: l.quantity, modifier: l.modifier ?? '' })),
    payment_method: paymentMethod,
  })
  return { id, error: error ? friendlyDbError(error.message) : null }
}

function friendlyDbError(message: string): string {
  if (/sold out|no longer exists|quantity/i.test(message)) return message
  return `We couldn't place your order: ${message}`
}

/** Asks the verify-payment Edge Function to confirm the Paystack payment. */
export async function verifyPayment(
  orderId: string,
  reference: string,
): Promise<{ ok: boolean; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('verify-payment', {
    body: { order_id: orderId, reference },
  })
  if (error) {
    let message = error.message
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json()
        message = body?.error ?? message
      } catch {
        /* keep default message */
      }
    }
    return { ok: false, error: message }
  }
  return data?.ok ? { ok: true, error: null } : { ok: false, error: data?.error ?? 'Verification failed' }
}

export async function updateOrderStatus(id: string, status: OrderStatus): Promise<string | null> {
  const { error } = await supabase.from('orders').update({ status }).eq('id', id)
  return error ? error.message : null
}

/**
 * Loads orders for staff and keeps them in sync via Supabase Realtime.
 * `onNewOrder` fires for every INSERT received after the initial load.
 */
export function useLiveOrders(options: {
  statuses?: OrderStatus[]
  limit?: number
  onNewOrder?: (order: Order) => void
}) {
  const { limit = 200 } = options
  const statusKey = options.statuses?.join(',') ?? ''
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const onNewRef = useRef(options.onNewOrder)

  useEffect(() => {
    onNewRef.current = options.onNewOrder
  })

  const load = useCallback(async () => {
    let query = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(limit)
    if (statusKey) query = query.in('status', statusKey.split(','))
    const { data, error: err } = await query
    if (err) setError(err.message)
    else {
      setError(null)
      setOrders((data ?? []) as Order[])
    }
    setLoading(false)
  }, [limit, statusKey])

  useEffect(() => {
    let active = true
    let initialQuery = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(limit)
    if (statusKey) initialQuery = initialQuery.in('status', statusKey.split(','))
    initialQuery.then(({ data, error: err }) => {
      if (!active) return
      if (err) setError(err.message)
      else {
        setError(null)
        setOrders((data ?? []) as Order[])
      }
      setLoading(false)
    })

    const channel = supabase
      .channel(`orders-live-${statusKey || 'all'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const order = payload.new as Order
          setOrders((prev) => (prev.some((o) => o.id === order.id) ? prev : [order, ...prev]))
          onNewRef.current?.(order)
        } else if (payload.eventType === 'UPDATE') {
          const order = payload.new as Order
          setOrders((prev) => {
            const exists = prev.some((o) => o.id === order.id)
            return exists ? prev.map((o) => (o.id === order.id ? order : o)) : [order, ...prev]
          })
        } else if (payload.eventType === 'DELETE') {
          const old = payload.old as Partial<Order>
          setOrders((prev) => prev.filter((o) => o.id !== old.id))
        }
      })
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
        if (status === 'SUBSCRIBED') load()
      })

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [limit, load, statusKey])

  const patchLocal = useCallback((id: string, patch: Partial<Order>) => {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  }, [])

  return { orders, loading, error, connected, reload: load, patchLocal }
}