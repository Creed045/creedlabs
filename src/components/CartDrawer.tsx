import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCart } from '../lib/cart'
import { formatPrice } from '../lib/config'
import { EmptyState } from './EmptyState'
import { FoodImage } from './FoodImage'
import { CloseIcon, MinusIcon, PlusIcon, TrashIcon } from './Icons'

export function CartDrawer() {
  const { lines, total, count, isOpen, closeCart, setQuantity, remove } = useCart()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeCart()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [isOpen, closeCart])

  const goToCheckout = () => {
    closeCart()
    navigate('/checkout')
  }

  return (
    <>
      <div className={`drawer-overlay ${isOpen ? 'is-open' : ''}`} onClick={closeCart} aria-hidden="true" />
      <aside
        className={`drawer ${isOpen ? 'is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Your cart"
        aria-hidden={!isOpen}
      >
        <div className="drawer__header">
          <div>
            <h2>
              Your order {count > 0 && <span className="muted">({count})</span>}
            </h2>
            {lines.length > 0 && (
              <small className="muted">
                {lines.length} {lines.length === 1 ? 'dish selected' : 'different dishes'} · Add more or checkout
              </small>
            )}
          </div>
          <button className="icon-btn" onClick={closeCart} aria-label="Close cart">
            <CloseIcon />
          </button>
        </div>

        {lines.length === 0 ? (
          <div className="drawer__body">
            <EmptyState
              icon="🛒"
              title="Your cart is empty"
              message="Combine Mains, Proteins, Drinks, and Desserts from the menu to get started."
              action={
                <button className="btn btn--primary" onClick={closeCart}>
                  Browse the menu
                </button>
              }
            />
          </div>
        ) : (
          <>
            <ul className="drawer__body cart-list">
              {lines.map((line) => (
                <li className="cart-line" key={line.id}>
                  <FoodImage src={line.image_url} alt={line.name} className="cart-line__img" />
                  <div className="cart-line__info">
                    <div className="cart-line__top">
                      <div>
                        <span className="cart-line__name">{line.name}</span>
                        {line.modifier && <span className="cart-line__mod">{line.modifier}</span>}
                      </div>
                      <button className="icon-btn icon-btn--sm" onClick={() => remove(line.id)} aria-label={`Remove ${line.name}`}>
                        <TrashIcon size={16} />
                      </button>
                    </div>
                    <div className="cart-line__bottom">
                      <div className="stepper stepper--sm">
                        <button onClick={() => setQuantity(line.id, line.quantity - 1)} aria-label="Decrease">
                          <MinusIcon size={14} />
                        </button>
                        <span>{line.quantity}</span>
                        <button onClick={() => setQuantity(line.id, line.quantity + 1)} aria-label="Increase">
                          <PlusIcon size={14} />
                        </button>
                      </div>
                      <span className="cart-line__price">{formatPrice(line.price * line.quantity)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="drawer__footer">
              <button className="btn btn--ghost btn--sm btn--block" onClick={closeCart}>
                <PlusIcon size={15} /> Add another dish, protein or drink
              </button>
              <div className="total-row">
                <span>Total</span>
                <strong>{formatPrice(total)}</strong>
              </div>
              <button className="btn btn--primary btn--lg btn--block" onClick={goToCheckout}>
                Checkout (Single or Split Bill)
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  )
}