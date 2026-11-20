import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import '../styles/checkout.css'
import { ArrowLeftIcon, LockIcon } from '../components/Icons'
import { homeForRole, useAuth } from '../lib/auth'
import { RESTAURANT_NAME } from '../lib/config'

export function StaffLoginPage() {
  const { session, role, loading, signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = `Staff login · ${RESTAURANT_NAME}`
    return () => {
      document.title = RESTAURANT_NAME
    }
  }, [])

  if (!loading && session && role) return <Navigate to={homeForRole(role)} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const result = await signIn(email.trim(), password)
    setBusy(false)
    if (result.error || !result.role) {
      setError(result.error ?? 'Login failed')
      return
    }
    navigate(homeForRole(result.role), { replace: true })
  }

  return (
    <main className="login">
      <div className="login__card card">
        <Link to="/" className="login__back">
          <ArrowLeftIcon size={18} /> Back to menu
        </Link>
        <div className="login__title-row">
          <LockIcon size={20} aria-hidden="true" />
          <h1>Staff login</h1>
        </div>
        <p className="muted">For {RESTAURANT_NAME} admin and kitchen staff only.</p>

        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <div className="password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="password-field__toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
          {error && <p className="alert alert--error" role="alert">{error}</p>}
          <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  )
}
