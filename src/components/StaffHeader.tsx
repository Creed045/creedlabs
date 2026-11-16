import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { RESTAURANT_NAME } from '../lib/config'
import { PlateIcon } from './Icons'
import { ThemePicker } from './ThemePicker'

export function StaffHeader({ title, right }: { title: string; right?: ReactNode }) {
  const { session, role, signOut } = useAuth()
  const navigate = useNavigate()

  const logout = async () => {
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <header className="staff-header">
      <div className="staff-header__inner">
        <div className="staff-header__title">
          <span className="navbar__logo">
            <PlateIcon size={18} />
          </span>
          <div>
            <strong>{title}</strong>
            <small>{RESTAURANT_NAME}</small>
          </div>
        </div>
        <div className="staff-header__right">
          {right}
          <ThemePicker />
          {role === 'admin' && (
            <nav className="staff-header__nav">
              <Link to="/admin">Admin</Link>
              <Link to="/kitchen">Kitchen</Link>
            </nav>
          )}
          <span className="staff-header__user" title={session?.user.email ?? ''}>
            {session?.user.email}
          </span>
          <button className="btn btn--ghost btn--sm" onClick={logout}>
            Log out
          </button>
        </div>
      </div>
    </header>
  )
}