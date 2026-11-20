// Daily POS: loads every order inside one business day (00:00 → 00:00) and
// summarises it like an end-of-day Z-report.
import { useEffect, useState } from 'react'
import { businessHourOf, dayStart, formatClock, shiftDayKey } from './businessDay'
import { realtimeChannel, supabase } from './supabase'
import { isTableOrder, ORDER_STATUSES, shortOrderId, type Order } from './types'

export type Tender = 'squad-paid' | 'squad-pending' | 'squad-failed' | 'cash-settled' | 'cash-open'

export const TENDER_LABELS: Record<Tender, string> = {
  'squad-paid': 'Squad · paid',
  'squad-pending': 'Squad · awaiting',
  'squad-failed': 'Squad · declined',
  'cash-settled': 'Cash · settled',
  'cash-open': 'Cash · open',
}

/** Cash is treated as collected once the order is served/delivered. */
export function tenderOf(o: Order): Tender {
  if (o.payment_method === 'cash') return o.status === 'delivered' ? 'cash-settled' : 'cash-open'
  if (o.payment_status === 'paid') return 'squad-paid'
  if (o.payment_status === 'failed') return 'squad-failed'
  return 'squad-pending'
}

export interface DaySummary {
  orderCount: number
  gross: number
  collected: number
  outstanding: number
  declinedCount: number
  declinedValue: number
  avgTicket: number
  itemsSold: number
  tenders: Record<Tender, { count: number; value: number }>
  dineIn: { count: number; value: number }
  delivery: { count: number; value: number }
  hourly: number[]
  items: { name: string; qty: number; revenue: number }[]
  firstOrderAt: string | null
  lastOrderAt: string | null
}

export function summariseDay(orders: Order[]): DaySummary {
  const tenders = Object.fromEntries(
    (Object.keys(TENDER_LABELS) as Tender[]).map((t) => [t, { count: 0, value: 0 }]),
  ) as DaySummary['tenders']
  const dineIn = { count: 0, value: 0 }
  const delivery = { count: 0, value: 0 }
  const hourly = Array.from({ length: 24 }, () => 0)
  const items = new Map<string, { qty: number; revenue: number }>()
  let itemsSold = 0

  for (const o of orders) {
    const total = Number(o.total)
    const tender = tenderOf(o)
    tenders[tender].count += 1
    tenders[tender].value += total
    if (tender === 'squad-failed') continue // declined payments are not sales

    const channel = isTableOrder(o.address) ? dineIn : delivery
    channel.count += 1
    channel.value += total
    hourly[businessHourOf(o.created_at)] += total

    for (const it of o.items) {
      const row = items.get(it.name) ?? { qty: 0, revenue: 0 }
      row.qty += it.quantity
      row.revenue += Number(it.price) * it.quantity
      items.set(it.name, row)
      itemsSold += it.quantity
    }
  }

  const collected = tenders['squad-paid'].value + tenders['cash-settled'].value
  const outstanding = tenders['squad-pending'].value + tenders['cash-open'].value
  const orderCount = orders.length - tenders['squad-failed'].count
  const gross = collected + outstanding

  return {
    orderCount,
    gross,
    collected,
    outstanding,
    declinedCount: tenders['squad-failed'].count,
    declinedValue: tenders['squad-failed'].value,
    avgTicket: orderCount > 0 ? Math.round(gross / orderCount) : 0,
    itemsSold,
    tenders,
    dineIn,
    delivery,
    hourly,
    items: [...items.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty),
    firstOrderAt: orders[0]?.created_at ?? null,
    lastOrderAt: orders[orders.length - 1]?.created_at ?? null,
  }
}

/**
 * Orders for one business day, oldest first. When `live` is true (today),
 * any change to the orders table triggers a quiet refetch.
 */
export function useDayOrders(dayKey: string, live: boolean) {
  const [state, setState] = useState<{ key: string; orders: Order[]; error: string | null }>({
    key: '',
    orders: [],
    error: null,
  })
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let active = true
    let debounce: ReturnType<typeof setTimeout> | undefined
    const from = dayStart(dayKey).toISOString()
    const to = dayStart(shiftDayKey(dayKey, 1)).toISOString()

    const fetchDay = async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .gte('created_at', from)
        .lt('created_at', to)
        .order('created_at', { ascending: true })
        .limit(5000)
      if (!active) return
      setState({ key: dayKey, orders: (data ?? []) as Order[], error: error ? error.message : null })
    }

    fetchDay()

    if (!live) return () => {
      active = false
    }

    const channel = realtimeChannel(`pos-day-${dayKey}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        clearTimeout(debounce)
        debounce = setTimeout(fetchDay, 350)
      })
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'))

    return () => {
      active = false
      clearTimeout(debounce)
      setConnected(false)
      supabase.removeChannel(channel)
    }
  }, [dayKey, live])

  const loading = state.key !== dayKey
  return {
    orders: loading ? [] : state.orders,
    error: loading ? null : state.error,
    loading,
    connected: live && connected,
  }
}

function csvCell(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadDayCsv(dayKey: string, orders: Order[]) {
  const header = ['Time', 'Ticket', 'Customer', 'Channel', 'Items', 'Tender', 'Status', 'Total (NGN)', 'Reference']
  const rows = orders.map((o) => [
    formatClock(o.created_at),
    shortOrderId(o.id),
    o.customer_name,
    isTableOrder(o.address) ? o.address : 'Delivery',
    o.items.map((it) => `${it.quantity}x ${it.name}${it.modifier ? ` (${it.modifier})` : ''}`).join('; '),
    TENDER_LABELS[tenderOf(o)],
    ORDER_STATUSES.find((s) => s.value === o.status)?.label ?? o.status,
    Number(o.total),
    o.payment_reference ?? '',
  ])
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `creedlabs-pos-${dayKey}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
