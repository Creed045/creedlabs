import { useCallback, useEffect, useRef, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { makeSquadReference } from './squad'
import { realtimeChannel, supabase } from './supabase'
import type { CartLine, Order, OrderStatus, PaymentMethod } from './types'

export interface CustomerDetails {
  customer_name: string
  /** Either "Table 4" (from NFC/table link) or a delivery street address. */
  address: string
  /** Customer notes, spice level, and allergies. */
  notes: string
}

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

/**
 * Places an order as an anonymous customer.
 * For Squad payments, creates the order as payment_status = 'pending' with a
 * unique transaction reference before opening the Squad inline modal.
 */
export async function placeOrder(
  details: CustomerDetails,
  lines: CartLine[],
  paymentMethod: PaymentMethod,
): Promise<{ id: string; reference: string | null; email: string; error: string | null }> {
  const id = generateUuid()
  const reference = paymentMethod === 'squad' ? makeSquadReference(id) : null
  const email = `order-${id.slice(0, 8).toLowerCase()}@creedlabs.kitchen`

  const { error } = await supabase.from('orders').insert({
    id,
    customer_name: details.customer_name,
    phone: 'N/A  ',
    email,
    address: details.address,
    notes: details.notes,
    items: lines.map((l) => ({
      id: l.id,
      name: l.name,
      price: l.price,
      quantity: l.quantity,
      modifier: l.modifier ?? '',
    })),
    payment_method: paymentMethod,
    payment_reference: reference,
  })
  return { id, reference, email, error: error ? friendlyDbError(error.message) : null }
}

function friendlyDbError(message: string): string {
  if (/sold out|no longer exists|quantity/i.test(message)) return message
  return `We couldn't place your order: ${message}`
}

/** Calls the squad-verify Edge Function to verify the Squad payment server-side. */
export async function verifyPayment(
  orderId: string,
  reference: string,
  shareAmount?: number,
): Promise<{ ok: boolean; status?: 'paid' | 'partial'; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('squad-verify', {
    body: { order_id: orderId, reference, share_amount: shareAmount },
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
  return data?.ok
    ? { ok: true, status: (data.status as 'paid' | 'partial') ?? 'paid', error: null }
    : { ok: false, error: data?.error ?? 'Verification failed' }
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

    const channel = realtimeChannel(`orders-live-${statusKey || 'all'}`)
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