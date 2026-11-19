// Live-synced restaurant opening and closing hours backed by public.restaurant_settings (id = 1).
import { useCallback, useEffect, useState } from 'react'
import { businessMinutesOf, isWithinOperatingHours } from './businessDay'
import { supabase } from './supabase'

export interface OperatingHoursState {
  openingTime: string
  closingTime: string
  hoursEnabled: boolean
}

const DEFAULT_HOURS: OperatingHoursState = {
  openingTime: '08:00',
  closingTime: '23:00',
  hoursEnabled: true,
}

function normalizeTime(value: unknown, fallback: string): string {
  if (typeof value === 'string' && /^\d{2}:\d{2}/.test(value)) {
    return value.slice(0, 5)
  }
  return fallback
}

export function useRestaurantHours() {
  const [hours, setHours] = useState<OperatingHoursState>(DEFAULT_HOURS)
  const [loading, setLoading] = useState(true)
  const [nowMinutes, setNowMinutes] = useState(() => businessMinutesOf())

  useEffect(() => {
    let active = true

    supabase
      .from('restaurant_settings')
      .select('opening_time, closing_time, hours_enabled')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        if (data) {
          setHours({
            openingTime: normalizeTime(data.opening_time, DEFAULT_HOURS.openingTime),
            closingTime: normalizeTime(data.closing_time, DEFAULT_HOURS.closingTime),
            hoursEnabled: typeof data.hours_enabled === 'boolean' ? data.hours_enabled : true,
          })
        }
        setLoading(false)
      })

    const channel = supabase
      .channel('restaurant-hours-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_settings' }, (payload) => {
        const row = payload.new as {
          opening_time?: string
          closing_time?: string
          hours_enabled?: boolean
        } | undefined
        if (!row) return
        setHours((prev) => ({
          openingTime: normalizeTime(row.opening_time, prev.openingTime),
          closingTime: normalizeTime(row.closing_time, prev.closingTime),
          hoursEnabled: typeof row.hours_enabled === 'boolean' ? row.hours_enabled : prev.hoursEnabled,
        }))
      })
      .subscribe()

    const tick = () => setNowMinutes(businessMinutesOf())
    const timer = setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)

    return () => {
      active = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
      supabase.removeChannel(channel)
    }
  }, [])

  const saveOperatingHours = useCallback(async (next: OperatingHoursState): Promise<string | null> => {
    setHours(next)
    const { error } = await supabase
      .from('restaurant_settings')
      .update({
        opening_time: next.openingTime,
        closing_time: next.closingTime,
        hours_enabled: next.hoursEnabled,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
    return error ? error.message : null
  }, [])

  const isOpen = !hours.hoursEnabled || isWithinOperatingHours(hours.openingTime, hours.closingTime, nowMinutes)

  return {
    ...hours,
    isOpen,
    loading,
    saveOperatingHours,
  }
}
