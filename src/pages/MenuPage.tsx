import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CartBar } from '../components/CartBar'
import { CategoryTabs } from '../components/CategoryTabs'
import { EmptyState } from '../components/EmptyState'
import { CloseIcon } from '../components/Icons'
import { MenuItemCard } from '../components/MenuItemCard'
import { MenuSkeleton } from '../components/MenuSkeleton'
import { CATEGORIES, RESTAURANT_NAME, RESTAURANT_TAGLINE } from '../lib/config'
import { formatTableLabel, syncLinkContextFromUrl } from '../lib/orderContext'
import { isSupabaseConfigured } from '../lib/supabase'
import type { MenuFilter, MenuItem } from '../lib/types'
import { useMenu } from '../lib/useMenu'

type TagFilter = 'all' | 'spicy' | 'veg'

function isSpicyDish(item: MenuItem): boolean {
  return /spicy|fiery|pepper|suya|asun|jollof|ata-rodo|chilli/i.test(`${item.name} ${item.description}`)
}

function isVegDish(item: MenuItem): boolean {
  if (item.category === 'Drinks' || item.category === 'Desserts') return true
  if (item.category === 'Proteins') return false
  return !/beef|goat|chicken|meat|turkey|fish|snail|patty/i.test(`${item.name} ${item.description}`)
}

export function MenuPage() {
  const { items, loading, error, reload } = useMenu()
  const [active, setActive] = useState<MenuFilter>('best')
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<TagFilter>('all')
  const { pathname, search } = useLocation()
  const linkCtx = syncLinkContextFromUrl(pathname, search)

  const counts = useMemo(() => {
    const c = {
      best: items.filter((i) => i.best_seller).length,
      all: items.length,
      ...Object.fromEntries(CATEGORIES.map((k) => [k, 0])),
    } as Record<MenuFilter, number>
    items.forEach((i) => {
      c[i.category] = (c[i.category] ?? 0) + 1
    })
    return c
  }, [items])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base =
      q.length > 0
        ? items
        : active === 'best'
          ? items.filter((i) => i.best_seller)
          : active === 'all'
            ? items
            : items.filter((i) => i.category === active)

    return base.filter((item) => {
      if (q && !`${item.name} ${item.description} ${item.category}`.toLowerCase().includes(q)) {
        return false
      }
      if (tagFilter === 'spicy' && !isSpicyDish(item)) return false
      if (tagFilter === 'veg' && !isVegDish(item)) return false
      return true
    })
  }, [items, active, query, tagFilter])

  const eyebrow =
    linkCtx.mode === 'delivery'
      ? '🛵 Delivery Order · Fresh to your door'
      : linkCtx.tableCode
        ? `🍽️ ${formatTableLabel(linkCtx.tableCode)} · Tap to order to your table`
        : '🍽️ Dine-in Menu · Scan table NFC / QR to order'

  return (
    <main className="menu-page">
      <section className="hero">
        <div className="container">
          <p className="hero__eyebrow">{eyebrow}</p>
          <h1 className="hero__title">{RESTAURANT_NAME}</h1>
          <p className="hero__subtitle">{RESTAURANT_TAGLINE}</p>
        </div>
      </section>

      <div className="tabs-wrap">
        <div className="container">
          <CategoryTabs active={active} counts={counts} onChange={setActive} />
        </div>
      </div>

      <section className="container menu-section">
        <div className="menu-filter-bar">
          <div className="menu-search">
            <span className="menu-search__icon" aria-hidden="true">🔍</span>
            <input
              type="search"
              placeholder="Search dishes, proteins, drinks…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search menu"
            />
            {query && (
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <CloseIcon size={14} />
              </button>
            )}
          </div>

          <div className="menu-tags" role="group" aria-label="Dietary and spice filters">
            <button
              type="button"
              className={`chip chip--sm ${tagFilter === 'all' ? 'is-active' : ''}`}
              onClick={() => setTagFilter('all')}
            >
              All
            </button>
            <button
              type="button"
              className={`chip chip--sm ${tagFilter === 'spicy' ? 'is-active' : ''}`}
              onClick={() => setTagFilter(tagFilter === 'spicy' ? 'all' : 'spicy')}
            >
              🌶️ Spicy
            </button>
            <button
              type="button"
              className={`chip chip--sm ${tagFilter === 'veg' ? 'is-active' : ''}`}
              onClick={() => setTagFilter(tagFilter === 'veg' ? 'all' : 'veg')}
            >
              🥬 Veg / Meat-Free
            </button>
          </div>
        </div>

        {!isSupabaseConfigured ? (
          <EmptyState
            icon="⚙️"
            title="Almost there"
            message="Add your Supabase URL and anon key to the .env file, then restart the dev server."
          />
        ) : loading ? (
          <MenuSkeleton />
        ) : error ? (
          <EmptyState
            icon="⚠️"
            title="We couldn't load the menu"
            message={error}
            action={
              <button className="btn btn--primary" onClick={reload}>
                Try again
              </button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No matching dishes"
            message="Try clearing your search or switching to another category tab."
            action={
              (query || tagFilter !== 'all') && (
                <button
                  className="btn btn--ghost"
                  onClick={() => {
                    setQuery('')
                    setTagFilter('all')
                  }}
                >
                  Clear filters
                </button>
              )
            }
          />
        ) : (
          <div className="menu-grid">
            {visible.map((item) => (
              <MenuItemCard
                key={item.id}
                item={item}
                showCategory={active === 'best' || active === 'all' || query.trim().length > 0}
              />
            ))}
          </div>
        )}
      </section>

      <CartBar />
    </main>
  )
}