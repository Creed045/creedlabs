import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { RESTAURANT_NAME } from '../lib/config'
import { ThemePicker } from './ThemePicker'

export function StaffHeader({ title, right }: { title: string; right?: ReactNode }) {
  const { session, role, signOut } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const logout = async () => {
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <header className="staff-header">
      <div className="staff-header__inner">
        <div className="staff-header__title">
          <Link to="/" className="staff-header__brand" title="View customer menu">
            <span className="navbar__mark" aria-hidden="true">C</span>
            <span className="staff-header__brand-name">{RESTAURANT_NAME}</span>
          </Link>
          <span className="staff-header__divider" aria-hidden="true">/</span>
          <strong className="staff-header__section">{title}</strong>
        </div>

        <div className="staff-header__right">
          {right}
          {role === 'admin' && (
            <nav className="staff-header__nav" aria-label="Staff navigation">
              <Link to="/admin" className={pathname.startsWith('/admin') ? 'is-active' : ''}>
                Back Office
              </Link>
              <Link to="/kitchen" className={pathname.startsWith('/kitchen') ? 'is-active' : ''}>
                Kitchen Display
              </Link>
            </nav>
          )}
          <ThemePicker />
          <span className="staff-header__user" title={session?.user.email ?? ''}>
            {session?.user.email}
          </span>
          <button className="btn btn--ghost btn--sm" onClick={logout}>
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}
