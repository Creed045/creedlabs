import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import type { StaffRole } from '../lib/types'

/**
 * Only renders children for signed-in staff whose role is allowed.
 * Everyone else is sent back to the customer menu.
 * (The database enforces the same rules with RLS, so this is UX, not security.)
 */
export function ProtectedRoute({ allow, children }: { allow: StaffRole[]; children: ReactNode }) {
  const { session, role, loading } = useAuth()

  if (loading) {
    return (
      <div className="page-center">
        <div className="spinner" aria-label="Loading" />
      </div>
    )
  }

  if (!session || !role || !allow.includes(role)) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
