import { useCart } from '../lib/cart'
import { formatPrice } from '../lib/config'
import { modifiersForCategory, type MenuItem } from '../lib/types'
import { FoodImage } from './FoodImage'
import { MinusIcon, PlusIcon } from './Icons'

export function MenuItemCard({ item, showCategory = false }: { item: MenuItem; showCategory?: boolean }) {
  const { add, quantityOf, modifierOf, setQuantity, setModifier } = useCart()
  const qty = quantityOf(item.id)
  const mod = modifierOf(item.id)
  const modOptions = modifiersForCategory(item.category)

  return (
    <article className={`dish ${item.available ? '' : 'is-soldout'} ${qty > 0 ? 'is-in-cart' : ''}`}>
      <div className="dish__media">
        <FoodImage src={item.image_url} alt={item.name} />
        {!item.available && <span className="dish__soldout">Sold out</span>}
        {item.available && item.best_seller && <span className="dish__bestseller">🔥 Best seller</span>}
        {showCategory && <span className="dish__category-tag">{item.category}</span>}
      </div>
      <div className="dish__body">
        <h3 className="dish__name">{item.name}</h3>
        <p className="dish__desc">{item.description}</p>

        {qty > 0 && item.available && (
          <div className="dish__mods" aria-label={`Customize ${item.name}`}>
            {modOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={`dish__mod-pill ${mod === option ? 'is-active' : ''}`}
                onClick={() => setModifier(item.id, option)}
              >
                {option}
              </button>
            ))}
          </div>
        )}

        <div className="dish__footer">
          <span className="dish__price">{formatPrice(item.price)}</span>
          {!item.available ? (
            <button className="btn btn--ghost btn--sm" disabled>
              Unavailable
            </button>
          ) : qty === 0 ? (
            <button className="btn btn--primary btn--sm" onClick={() => add(item)}>
              <PlusIcon size={16} /> Add
            </button>
          ) : (
            <div className="stepper" aria-label={`${item.name} quantity`}>
              <button onClick={() => setQuantity(item.id, qty - 1)} aria-label="Decrease">
                <MinusIcon size={16} />
              </button>
              <span>{qty}</span>
              <button onClick={() => add(item)} aria-label="Increase">
                <PlusIcon size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}