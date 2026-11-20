import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CartBar } from '../components/CartBar'
import { CategoryTabs } from '../components/CategoryTabs'
import { EmptyState } from '../components/EmptyState'
import { CloseIcon, PlusIcon, SearchIcon } from '../components/Icons'
import { MenuItemCard } from '../components/MenuItemCard'
import { MenuSkeleton } from '../components/MenuSkeleton'
import { useCart } from '../lib/cart'
import { CATEGORIES, formatPrice, RESTAURANT_NAME, RESTAURANT_TAGLINE } from '../lib/config'
import { formatTime12h } from '../lib/businessDay'
import { formatTableLabel, syncLinkContextFromUrl } from '../lib/orderContext'
import { useRestaurantHours } from '../lib/restaurantHours'
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
  const { openingTime, closingTime, hoursEnabled, isOpen } = useRestaurantHours()
  const { add, quantityOf } = useCart()
  const [active, setActive] = useState<MenuFilter>('best')
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<TagFilter>('all')
  const { pathname, search } = useLocation()
  const linkCtx = syncLinkContextFromUrl(pathname, search)

  const signatureDish = useMemo(() => {
    const courseRank: Record<string, number> = {
      Mains: 0,
      Starters: 1,
      Proteins: 2,
      Drinks: 3,
      Desserts: 4,
    }
    const available = items.filter((i) => i.available && i.price >= 500)
    return (
      available.find((i) => /jollof/i.test(i.name)) ??
      available.find((i) => /suya|asun|egusi/i.test(i.name) && i.best_seller) ??
      [...available]
        .filter((i) => i.best_seller)
        .sort((a, b) => (courseRank[a.category] ?? 9) - (courseRank[b.category] ?? 9))[0] ??
      available[0] ??
      null
    )
  }, [items])

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

  const serviceLabel =
    linkCtx.mode === 'delivery'
      ? 'Delivery · 25–40 mins'
      : linkCtx.tableCode
        ? `Dine-in · ${formatTableLabel(linkCtx.tableCode)}`
        : 'Dine-in & Takeaway · 15–25 mins'

  const showEditorialLead = active === 'best' && !query.trim() && tagFilter === 'all' && visible.length >= 3

  return (
    <main className="menu-page">
      <section className="hero">
        <div className="container hero__inner">
          <div className="hero__content">
            <div className="hero__meta">
              <span className="hero__status">
                <span className={`hero__status-dot ${isOpen ? '' : 'is-closed'}`} aria-hidden="true" />
                {isOpen ? 'Kitchen open' : 'Kitchen closed'}
              </span>
              {hoursEnabled && (
                <>
                  <span className="hero__sep" aria-hidden="true">·</span>
                  <span>{formatTime12h(openingTime)} – {formatTime12h(closingTime)}</span>
                </>
              )}
              <span className="hero__sep" aria-hidden="true">·</span>
              <span>{serviceLabel}</span>
            </div>
            <h1 className="hero__title">{RESTAURANT_NAME}</h1>
            <p className="hero__subtitle">{RESTAURANT_TAGLINE}</p>
            <div className="hero__pillars" aria-label="Service highlights">
              <span className="hero__pillar">Fire-wood smoky prep</span>
              <span className="hero__pillar">Instant table &amp; delivery tickets</span>
              <span className="hero__pillar">Multi-account Squad bill split</span>
            </div>
          </div>

          {signatureDish && (
            <aside className="hero__spotlight" aria-label="Chef's signature recommendation">
              <div className="hero__spotlight-head">
                <span className="hero__spotlight-tag">Tonight&apos;s Signature</span>
                <span className="hero__spotlight-price">{formatPrice(signatureDish.price)}</span>
              </div>
              <strong className="hero__spotlight-name">{signatureDish.name}</strong>
              <p className="hero__spotlight-desc">{signatureDish.description}</p>
              <button
                type="button"
                className="btn btn--primary btn--sm hero__spotlight-btn"
                onClick={() => add(signatureDish)}
              >
                <PlusIcon size={15} />
                {quantityOf(signatureDish.id) > 0
                  ? `In order (${quantityOf(signatureDish.id)}) · Add another`
                  : 'Add to order'}
              </button>
            </aside>
          )}
        </div>
      </section>

      <div className="tabs-wrap">
        <div className="container">
          <CategoryTabs active={active} counts={counts} onChange={setActive} />
        </div>
      </div>

      <section className="container menu-section">
        {hoursEnabled && !isOpen && (
          <div className="alert alert--warn closed-banner" role="status">
            <strong>Kitchen is currently closed.</strong> Ordering reopens at {formatTime12h(openingTime)} WAT
            (open daily {formatTime12h(openingTime)} – {formatTime12h(closingTime)}).
          </div>
        )}

        <div className="menu-filter-bar">
          <div className="menu-search">
            <span className="menu-search__icon" aria-hidden="true">
              <SearchIcon size={16} />
            </span>
            <input
              type="search"
              placeholder="Search Jollof, Suya, Egusi, Chapman..."
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
              All dishes
            </button>
            <button
              type="button"
              className={`chip chip--sm ${tagFilter === 'spicy' ? 'is-active' : ''}`}
              onClick={() => setTagFilter(tagFilter === 'spicy' ? 'all' : 'spicy')}
            >
              Pepper-forward
            </button>
            <button
              type="button"
              className={`chip chip--sm ${tagFilter === 'veg' ? 'is-active' : ''}`}
              onClick={() => setTagFilter(tagFilter === 'veg' ? 'all' : 'veg')}
            >
              Meat-free &amp; drinks
            </button>
          </div>
        </div>

        {!isSupabaseConfigured ? (
          <EmptyState
            title="Database connection required"
            message="Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your environment configuration."
          />
        ) : loading ? (
          <MenuSkeleton />
        ) : error ? (
          <EmptyState
            title="Unable to load menu"
            message={error}
            action={
              <button className="btn btn--primary" onClick={reload}>
                Retry
              </button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No matching dishes"
            message="Try clearing your search or switching to another section of the kitchen."
            action={
              (query || tagFilter !== 'all') && (
                <button
                  className="btn btn--ghost"
                  onClick={() => {
                    setQuery('')
                    setTagFilter('all')
                  }}
                >
                  Reset filters
                </button>
              )
            }
          />
        ) : (
          <div className={`menu-grid ${showEditorialLead ? 'menu-grid--editorial' : ''}`}>
            {visible.map((item, idx) => (
              <MenuItemCard
                key={item.id}
                item={item}
                featured={showEditorialLead && idx === 0}
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
