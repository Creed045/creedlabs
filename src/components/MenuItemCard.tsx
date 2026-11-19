import { useState } from 'react'
import { useCart } from '../lib/cart'
import { formatPrice } from '../lib/config'
import { customizationsForDish, type MenuItem } from '../lib/types'
import { FoodImage } from './FoodImage'
import { MinusIcon, PlusIcon } from './Icons'

export function MenuItemCard({
  item,
  showCategory = false,
  featured = false,
}: {
  item: MenuItem
  showCategory?: boolean
  featured?: boolean
}) {
  const { add, quantityOf, modifierOf, setQuantity, setModifier } = useCart()
  const qty = quantityOf(item.id)
  const cartMod = modifierOf(item.id)
  const [draftParts, setDraftParts] = useState<string[]>([])

  const groups = customizationsForDish(item)
  const activeParts = qty > 0 ? (cartMod ? cartMod.split(', ').filter(Boolean) : []) : draftParts

  const toggleOption = (groupOptions: string[], option: string) => {
    const withoutGroup = activeParts.filter((p) => !groupOptions.includes(p))
    const nextParts = activeParts.includes(option) ? withoutGroup : [...withoutGroup, option]
    const nextMod = nextParts.join(', ')
    setDraftParts(nextParts)
    if (qty > 0) {
      setModifier(item.id, nextMod)
    }
  }

  const handleAdd = () => {
    add(item, draftParts.join(', '))
  }

  return (
    <article
      className={`dish ${featured ? 'dish--featured' : ''} ${item.available ? '' : 'is-soldout'} ${
        qty > 0 ? 'is-in-cart' : ''
      }`}
    >
      <div className="dish__media">
        <FoodImage src={item.image_url} alt={item.name} />
        {!item.available && <span className="dish__soldout">Sold out</span>}
        {item.available && featured ? (
          <span className="dish__bestseller dish__bestseller--signature">Chef&apos;s Signature</span>
        ) : item.available && item.best_seller ? (
          <span className="dish__bestseller">House Favourite</span>
        ) : null}
        {showCategory && <span className="dish__category-tag">{item.category}</span>}
      </div>
      <div className="dish__body">
        <h3 className="dish__name">{item.name}</h3>
        <p className="dish__desc">{item.description}</p>

        {item.available && (
          <div className="dish__mods-wrap" aria-label={`Customize ${item.name}`}>
            {groups.map((g) => (
              <div key={g.label} className="dish__mod-group">
                <span className="dish__mod-label">{g.label}:</span>
                <div className="dish__mods">
                  {g.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`dish__mod-pill ${activeParts.includes(option) ? 'is-active' : ''}`}
                      onClick={() => toggleOption(g.options, option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
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
            <button className="btn btn--primary btn--sm dish__add-btn" onClick={handleAdd}>
              <PlusIcon size={16} /> Add
            </button>
          ) : (
            <div className="stepper" aria-label={`${item.name} quantity`}>
              <button onClick={() => setQuantity(item.id, qty - 1)} aria-label="Decrease">
                <MinusIcon size={15} />
              </button>
              <span>{qty}</span>
              <button onClick={handleAdd} aria-label="Increase">
                <PlusIcon size={15} />
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
