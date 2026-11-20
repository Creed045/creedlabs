import { useCallback, useEffect, useState } from 'react'
import { CATEGORIES } from './config'
import { realtimeChannel, supabase } from './supabase'
import type { MenuItem } from './types'

const CATEGORY_ORDER = new Map<string, number>(CATEGORIES.map((c, idx) => [c, idx]))

async function queryMenu() {
  return supabase
    .from('menu_items')
    .select('*')
    .order('created_at', { ascending: true })
}

function normalizeMenu(rows: unknown[] | null): MenuItem[] {
  return ((rows ?? []) as MenuItem[])
    .map((m) => ({
      ...m,
      price: Number(m.price),
      best_seller: Boolean(m.best_seller),
    }))
    .sort((a, b) => {
      const catDiff = (CATEGORY_ORDER.get(a.category) ?? 99) - (CATEGORY_ORDER.get(b.category) ?? 99)
      if (catDiff !== 0) return catDiff
      return Number(b.available) - Number(a.available)
    })
}

export function useMenu() {
  const [items, setItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await queryMenu()
    if (err) {
      setError(err.message)
    } else {
      setError(null)
      setItems(normalizeMenu(data))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true
    queryMenu().then(({ data, error: err }) => {
      if (!active) return
      if (err) {
        setError(err.message)
      } else {
        setError(null)
        setItems(normalizeMenu(data))
      }
      setLoading(false)
    })

    // Live updates when kitchen or admin toggles food availability
    const channel = realtimeChannel('menu-items-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => {
        queryMenu().then(({ data, error: err }) => {
          if (!active || err) return
          setItems(normalizeMenu(data))
        })
      })
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  return { items, setItems, loading, error, reload }
}