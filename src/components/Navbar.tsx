import { Link, useLocation } from 'react-router-dom'
import { useCart } from '../lib/cart'
import { RESTAURANT_NAME } from '../lib/config'
import { formatTableLabel, syncLinkContextFromUrl } from '../lib/orderContext'
import { CallWaiterButton } from './CallWaiterButton'
import { CartIcon, LockIcon } from './Icons'
import { ThemePicker } from './ThemePicker'

export function Navbar() {
  const { count, openCart } = useCart()
  const { pathname, search } = useLocation()
  const linkCtx = syncLinkContextFromUrl(pathname, search)

  return (
    <header className="navbar">
      <div className="navbar__inner container">
        <div className="navbar__left">
          <Link to="/" className="navbar__brand">
            <span className="navbar__mark" aria-hidden="true">C</span>
            <span className="navbar__brand-text">{RESTAURANT_NAME}</span>
          </Link>

          {linkCtx.mode === 'delivery' ? (
            <span className="navbar__context navbar__context--delivery" title="Delivery mode active">
              Delivery
            </span>
          ) : linkCtx.tableCode ? (
            <span className="navbar__context" title="Table service active">
              {formatTableLabel(linkCtx.tableCode)}
            </span>
          ) : null}
        </div>

        <nav className="navbar__actions">
          <CallWaiterButton />
          <ThemePicker />

          <Link to="/staff" className="navbar__staff" title="Staff sign in">
            <LockIcon size={14} />
            <span className="navbar__staff-label">Staff</span>
          </Link>
          <button className="navbar__cart" onClick={openCart} aria-label={`Open cart, ${count} items`}>
            <CartIcon size={19} />
            {count > 0 && <span key={count} className="navbar__badge">{count}</span>}
          </button>
        </nav>
      </div>
    </header>
  )
}
