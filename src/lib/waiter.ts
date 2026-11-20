import { useCallback, useEffect, useRef, useState } from 'react'
import { realtimeChannel, supabase } from './supabase'

export interface WaiterCall {
  id: string
  table_label: string
  reason: string
  customer_name: string
  status: 'pending' | 'resolved'
  created_at: string
}

export const WAITER_REASONS = [
  'Need POS terminal at table',
  'Request the bill',
  'Water, napkins or cutlery',
  'Server assistance',
] as const

function safeUuid(): string {
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
 * Reads and live-syncs `call_waiter_enabled` from `public.restaurant_settings`.
 * Admins can call `toggleCallWaiter(next)` to turn the feature ON or OFF globally.
 */
export function useCallWaiterSetting() {
  const [enabled, setEnabled] = useState<boolean>(true)
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    let active = true
    supabase
      .from('restaurant_settings')
      .select('call_waiter_enabled')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        if (data) setEnabled(Boolean(data.call_waiter_enabled))
        setLoading(false)
      })

    const channel = realtimeChannel('restaurant-settings-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_settings' }, (payload) => {
        const row = payload.new as { call_waiter_enabled?: boolean } | undefined
        if (row && typeof row.call_waiter_enabled === 'boolean') {
          setEnabled(row.call_waiter_enabled)
        }
      })
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  const setCallWaiterEnabled = useCallback(async (next: boolean): Promise<string | null> => {
    setEnabled(next)
    const { error } = await supabase
      .from('restaurant_settings')
      .update({ call_waiter_enabled: next, updated_at: new Date().toISOString() })
      .eq('id', 1)
    return error ? error.message : null
  }, [])

  return { callWaiterEnabled: enabled, loading, setCallWaiterEnabled }
}

export async function sendWaiterCall(params: {
  table_label: string
  reason: string
  customer_name?: string
}): Promise<string | null> {
  const { error } = await supabase.from('waiter_calls').insert({
    id: safeUuid(),
    table_label: params.table_label,
    reason: params.reason,
    customer_name: params.customer_name?.trim() ?? '',
  })
  return error ? error.message : null
}

export async function resolveWaiterCall(id: string): Promise<string | null> {
  const { error } = await supabase.from('waiter_calls').update({ status: 'resolved' }).eq('id', id)
  return error ? error.message : null
}

export function useLiveWaiterCalls(onNewCall?: (call: WaiterCall) => void) {
  const [calls, setCalls] = useState<WaiterCall[]>([])
  const onNewRef = useRef(onNewCall)

  useEffect(() => {
    onNewRef.current = onNewCall
  })

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('waiter_calls')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50)
    if (data) setCalls(data as WaiterCall[])
  }, [])

  useEffect(() => {
    let active = true
    supabase
      .from('waiter_calls')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (active && data) setCalls(data as WaiterCall[])
      })

    const channel = realtimeChannel('waiter-calls-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const c = payload.new as WaiterCall
          if (c.status === 'pending') {
            setCalls((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]))
            onNewRef.current?.(c)
          }
        } else if (payload.eventType === 'UPDATE') {
          const c = payload.new as WaiterCall
          if (c.status !== 'pending') {
            setCalls((prev) => prev.filter((x) => x.id !== c.id))
          }
        } else if (payload.eventType === 'DELETE') {
          const old = payload.old as Partial<WaiterCall>
          setCalls((prev) => prev.filter((x) => x.id !== old.id))
        }
      })
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [load])

  const dismissCall = useCallback(async (id: string) => {
    setCalls((prev) => prev.filter((c) => c.id !== id))
    await resolveWaiterCall(id)
  }, [])

  return { calls, dismissCall }
}