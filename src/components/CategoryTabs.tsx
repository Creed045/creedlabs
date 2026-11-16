import { CATEGORIES } from '../lib/config'
import type { MenuFilter } from '../lib/types'

interface Props {
  active: MenuFilter
  counts: Record<MenuFilter, number>
  onChange: (c: MenuFilter) => void
}

const TABS: { key: MenuFilter; label: string }[] = [
  { key: 'best', label: '🔥 Best Sellers' },
  { key: 'all', label: '🍽️ All Menu' },
  ...CATEGORIES.map((c) => ({ key: c as MenuFilter, label: c })),
]

export function CategoryTabs({ active, counts, onChange }: Props) {
  return (
    <div className="tabs" role="tablist" aria-label="Menu categories">
      {TABS.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          className={`tabs__tab ${active === t.key ? 'is-active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          <span className="tabs__count">{counts[t.key] ?? 0}</span>
        </button>
      ))}
    </div>
  )
}