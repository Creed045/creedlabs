import { Link, useLocation } from 'react-router-dom'
import { useCart } from '../lib/cart'
import { RESTAURANT_NAME } from '../lib/config'
import { formatTableLabel, syncLinkContextFromUrl } from '../lib/orderContext'
import { CallWaiterButton } from './CallWaiterButton'
import { CartIcon, LockIcon, PlateIcon } from './Icons'
import { ThemePicker } from './ThemePicker'

export function Navbar() {
  const { count, openCart } = useCart()
  const { pathname, search } = useLocation()
  const linkCtx = syncLinkContextFromUrl(pathname, search)

  return (
    <header className="navbar">
      <div className="navbar__inner container">
        <Link to="/" className="navbar__brand">
          <span className="navbar__logo">
            <PlateIcon size={20} />
          </span>
          <span>{RESTAURANT_NAME}</span>
        </Link>

        <nav className="navbar__actions">
          {linkCtx.mode === 'delivery' ? (
            <span className="navbar__context navbar__context--delivery" title="Delivery mode active">
              🛵 Delivery
            </span>
          ) : linkCtx.tableCode ? (
            <span className="navbar__context" title="NFC / Table link active">
              🍽️ {formatTableLabel(linkCtx.tableCode)}
            </span>
          ) : null}

          <CallWaiterButton />
          <ThemePicker />

          <Link to="/staff" className="navbar__staff" title="Staff login">
            <LockIcon size={16} />
            <span className="navbar__staff-label">Staff login</span>
          </Link>
          <button className="navbar__cart" onClick={openCart} aria-label={`Open cart, ${count} items`}>
            <CartIcon />
            {count > 0 && <span className="navbar__badge">{count}</span>}
          </button>
        </nav>
      </div>
    </header>
  )
}