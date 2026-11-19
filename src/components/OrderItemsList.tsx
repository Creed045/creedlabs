import { formatPrice } from '../lib/config'
import type { OrderItem } from '../lib/types'

export function OrderItemsList({ items, showPrices = true }: { items: OrderItem[]; showPrices?: boolean }) {
  return (
    <ul className="order-items">
      {items.map((it, i) => (
        <li key={`${it.id}-${i}`}>
          <span className="order-items__qty">{it.quantity}×</span>
          <span className="order-items__name">
            {it.name}
            {it.modifier && <small className="order-items__mod"> · {it.modifier}</small>}
          </span>
          {showPrices && <span className="order-items__price">{formatPrice(Number(it.price) * it.quantity)}</span>}
        </li>
      ))}
    </ul>
  )
}
