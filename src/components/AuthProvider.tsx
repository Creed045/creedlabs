import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { AuthContext, type AuthContextValue } from '../lib/auth'
import type { StaffRole } from '../lib/types'

async function fetchRole(userId: string): Promise<StaffRole | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error('Could not load staff profile', error)
    return null
  }
  return (data?.role as StaffRole | undefined) ?? null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<StaffRole | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      setRole(data.session ? await fetchRole(data.session.user.id) : null)
      if (active) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!active) return
      setSession(newSession)
      if (event === 'SIGNED_OUT' || !newSession) {
        setRole(null)
        return
      }
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        // Defer DB calls out of the auth callback (recommended by supabase-js).
        setTimeout(async () => {
          const r = await fetchRole(newSession.user.id)
          if (active) setRole(r)
        }, 0)
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback<AuthContextValue['signIn']>(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.session) return { role: null, error: error?.message ?? 'Login failed' }

    const r = await fetchRole(data.session.user.id)
    if (!r) {
      await supabase.auth.signOut()
      return { role: null, error: 'This account does not have staff access.' }
    }
    setSession(data.session)
    setRole(r)
    return { role: r, error: null }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setRole(null)
  }, [])

  const value = useMemo(
    () => ({ session, role, loading, signIn, signOut }),
    [session, role, loading, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
