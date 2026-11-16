import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { StaffRole } from './types'

export interface AuthContextValue {
  session: Session | null
  role: StaffRole | null
  /** True until we know both the session and the role. */
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ role: StaffRole | null; error: string | null }>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export function homeForRole(role: StaffRole | null): string {
  if (role === 'admin') return '/admin'
  if (role === 'kitchen') return '/kitchen'
  return '/'
}
