import { useCart } from '../lib/cart'
import { formatPrice } from '../lib/config'
import { CartIcon } from './Icons'

/** Sticky bottom bar so the cart is always one tap away on phones. */
export function CartBar() {
  const { lines, count, total, openCart, isOpen } = useCart()
  if (count === 0 || isOpen) return null

  const dishCount = lines.length

  return (
    <button className="cart-bar" onClick={openCart}>
      <span className="cart-bar__count">
        <CartIcon size={18} /> {dishCount} {dishCount === 1 ? 'dish' : 'different dishes'} ({count})
      </span>
      <span className="cart-bar__cta">View order</span>
      <span className="cart-bar__total">{formatPrice(total)}</span>
    </button>
  )
}