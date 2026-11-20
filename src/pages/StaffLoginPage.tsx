import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeftIcon, LockIcon } from '../components/Icons'
import { homeForRole, useAuth } from '../lib/auth'
import { RESTAURANT_NAME } from '../lib/config'

export function StaffLoginPage() {
  const { session, role, loading, signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
        <div className="login__icon">
          <LockIcon size={28} />
        </div>
        <h1>Staff login</h1>
        <p className="muted">For {RESTAURANT_NAME} admin and kitchen staff only.</p>

        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p className="alert alert--error">{error}</p>}
          <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  )
}
