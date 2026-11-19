import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { DailyPosPanel } from '../components/DailyPosPanel'
import { EmptyState } from '../components/EmptyState'
import { FoodImage } from '../components/FoodImage'
import { CheckIcon, CloseIcon, ExternalIcon, PlusIcon, QrIcon, TrashIcon } from '../components/Icons'
import { LiveDot } from '../components/LiveDot'
import { MenuItemForm } from '../components/MenuItemForm'
import { OrderItemsList } from '../components/OrderItemsList'
import { PaymentBadge } from '../components/PaymentBadge'
import { StaffHeader } from '../components/StaffHeader'
import { CATEGORIES, formatPrice, MENU_IMAGES_BUCKET, RESTAURANT_NAME } from '../lib/config'
import { buildDeliveryUrl, buildTableUrl, formatTableLabel } from '../lib/orderContext'
import { updateOrderStatus, useLiveOrders } from '../lib/orders'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/time'
import {
  isTableOrder,
  ORDER_STATUSES,
  shortOrderId,
  type MenuItem,
  type Order,
  type OrderStatus,
  type RestaurantTable,
} from '../lib/types'
import { useMenu } from '../lib/useMenu'
import { useAuth } from '../lib/auth'
import { useCallWaiterSetting, useLiveWaiterCalls } from '../lib/waiter'
import { playChime, vibrate } from '../lib/alert'
import { dayKeyOf, formatTime12h, useBusinessDay } from '../lib/businessDay'
import { useRestaurantHours } from '../lib/restaurantHours'

type Tab = 'orders' | 'pos' | 'menu' | 'links' | 'staff'

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('orders')

  useEffect(() => {
    document.title = `Back Office · ${RESTAURANT_NAME}`
  }, [])

  return (
    <div className="staff-page">
      <StaffHeader title="Back Office" />
      <div className="staff-tabs-wrap">
        <div className="staff-tabs" role="tablist" aria-label="Back office sections">
          <button role="tab" aria-selected={tab === 'orders'} className={tab === 'orders' ? 'is-active' : ''} onClick={() => setTab('orders')}>
            Orders
          </button>
          <button role="tab" aria-selected={tab === 'pos'} className={tab === 'pos' ? 'is-active' : ''} onClick={() => setTab('pos')}>
            Daily POS
          </button>
          <button role="tab" aria-selected={tab === 'menu'} className={tab === 'menu' ? 'is-active' : ''} onClick={() => setTab('menu')}>
            Menu Catalog
          </button>
          <button role="tab" aria-selected={tab === 'links'} className={tab === 'links' ? 'is-active' : ''} onClick={() => setTab('links')}>
            Tables & QR Links
          </button>
          <button role="tab" aria-selected={tab === 'staff'} className={tab === 'staff' ? 'is-active' : ''} onClick={() => setTab('staff')}>
            Team & Access
          </button>
        </div>
      </div>
      <main className="staff-main">
        {tab === 'orders' ? (
          <OrdersPanel onOpenPos={() => setTab('pos')} />
        ) : tab === 'pos' ? (
          <DailyPosPanel />
        ) : tab === 'menu' ? (
          <MenuPanel />
        ) : tab === 'links' ? (
          <LinksPanel />
        ) : (
          <StaffSettingsPanel />
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function computeDailyStats(orders: Order[], todayKey: string) {
  // Bucket by the restaurant's own calendar day (WAT), not the device's or UTC.
  const todayOrders = orders.filter((o) => dayKeyOf(o.created_at) === todayKey)
  const revenue = todayOrders.reduce((sum, o) => sum + Number(o.total), 0)
  const paidOnline = todayOrders
    .filter((o) => o.payment_status === 'paid')
    .reduce((sum, o) => sum + Number(o.total), 0)
  const activeCount = todayOrders.filter((o) => o.status !== 'delivered').length
  const avgOrderValue = todayOrders.length > 0 ? Math.round(revenue / todayOrders.length) : 0
  const paidRate = todayOrders.length > 0 ? Math.round((todayOrders.filter((o) => o.payment_status === 'paid').length / todayOrders.length) * 100) : 0

  const dishCounts = new Map<string, number>()
  todayOrders.forEach((o) => {
    o.items.forEach((it) => {
      const baseName = it.name.replace(/\s*\([^)]*\)$/, '')
      dishCounts.set(baseName, (dishCounts.get(baseName) ?? 0) + it.quantity)
    })
  })
  const topDishes = [...dishCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)

  return {
    todayCount: todayOrders.length,
    activeCount,
    revenue,
    paidOnline,
    avgOrderValue,
    paidRate,
    topDishes,
  }
}

function OrdersPanel({ onOpenPos }: { onOpenPos: () => void }) {
  const todayKey = useBusinessDay()
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all')
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)

  const { orders, loading, error, connected, patchLocal } = useLiveOrders({
    onNewOrder: (o) => {
      setFreshIds((s) => new Set(s).add(o.id))
      setTimeout(
        () =>
          setFreshIds((s) => {
            const n = new Set(s)
            n.delete(o.id)
            return n
          }),
        8000,
      )
    },
  })

  const { callWaiterEnabled, setCallWaiterEnabled } = useCallWaiterSetting()
  const { openingTime, closingTime, hoursEnabled, isOpen, saveOperatingHours } = useRestaurantHours()
  const [draftOpen, setDraftOpen] = useState(openingTime)
  const [draftClose, setDraftClose] = useState(closingTime)
  const [draftEnforce, setDraftEnforce] = useState(hoursEnabled)
  const [hoursSaving, setHoursSaving] = useState(false)
  const [hoursMsg, setHoursMsg] = useState<string | null>(null)

  useEffect(() => {
    setDraftOpen(openingTime)
    setDraftClose(closingTime)
    setDraftEnforce(hoursEnabled)
  }, [openingTime, closingTime, hoursEnabled])

  const handleSaveHours = async (e: FormEvent) => {
    e.preventDefault()
    setHoursSaving(true)
    setHoursMsg(null)
    const saveErr = await saveOperatingHours({
      openingTime: draftOpen,
      closingTime: draftClose,
      hoursEnabled: draftEnforce,
    })
    setHoursSaving(false)
    setHoursMsg(saveErr ? saveErr : 'Hours saved')
    if (!saveErr) {
      setTimeout(() => setHoursMsg((m) => (m === 'Hours saved' ? null : m)), 2500)
    }
  }
  const { calls: waiterCalls, dismissCall } = useLiveWaiterCalls(() => {
    playChime()
    vibrate()
  })

  const stats = useMemo(() => computeDailyStats(orders, todayKey), [orders, todayKey])
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length }
    orders.forEach((o) => (c[o.status] = (c[o.status] ?? 0) + 1))
    return c
  }, [orders])

  const visible = filter === 'all' ? orders : orders.filter((o) => o.status === filter)

  const setStatus = async (order: Order, status: OrderStatus) => {
    if (order.status === status) return
    setErr(null)
    const previous = order.status
    patchLocal(order.id, { status })
    const e = await updateOrderStatus(order.id, status)
    if (e) {
      patchLocal(order.id, { status: previous })
      setErr(`Could not update order #${shortOrderId(order.id)}: ${e}`)
    }
  }

  return (
    <section>
      {waiterCalls.length > 0 && (
        <div className="waiter-alerts" role="region" aria-label="Active table calls">
          {waiterCalls.map((c) => (
            <div key={c.id} className="waiter-alert-card">
              <div className="waiter-alert-card__body">
                <span className="waiter-alert-card__tag">Table Request</span>
                <strong>{c.table_label}</strong>
                <span>{c.reason}</span>
                {c.customer_name && <small className="muted">({c.customer_name})</small>}
                <small className="muted">· {timeAgo(c.created_at)}</small>
              </div>
              <button className="btn btn--primary btn--sm" onClick={() => dismissCall(c.id)}>
                <CheckIcon size={14} /> Mark attended
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-card__label">Gross Revenue (since 00:00)</span>
          <strong className="stat-card__value">{formatPrice(stats.revenue)}</strong>
          <span className="muted small">
            Paid online: {formatPrice(stats.paidOnline)} ({stats.paidRate}%)
          </span>
          <button type="button" className="btn btn--text btn--xs stat-card__link" onClick={onOpenPos}>
            Open Daily POS report
          </button>
        </div>

        <div className="stat-card">
          <span className="stat-card__label">Orders &amp; Average Ticket</span>
          <strong className="stat-card__value">{stats.todayCount}</strong>
          <span className="muted small">
            {stats.activeCount} active · Avg {formatPrice(stats.avgOrderValue)}
          </span>
        </div>

        <div className="stat-card">
          <span className="stat-card__label">Top Movers Today</span>
          {stats.topDishes.length === 0 ? (
            <span className="muted small">No orders recorded today</span>
          ) : (
            <ul className="stat-card__list">
              {stats.topDishes.map(([dishName, qty]) => (
                <li key={dishName}>
                  <span>{dishName}</span>
                  <strong>{qty}×</strong>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="stat-card">
          <span className="stat-card__label">Table Service Requests</span>
          <label className="switch-row" style={{ marginTop: 4 }}>
            <input
              type="checkbox"
              checked={callWaiterEnabled}
              onChange={(e) => setCallWaiterEnabled(e.target.checked)}
            />
            <span className="switch" aria-hidden="true" />
            <span className={callWaiterEnabled ? 'text-ok' : 'muted'}>
              {callWaiterEnabled ? 'Active on tables' : 'Paused'}
            </span>
          </label>
          <span className="muted small">Controls the "Service" button on dine-in menus</span>
        </div>

        <form className="stat-card hours-card" onSubmit={handleSaveHours}>
          <div className="hours-card__top">
            <span className="stat-card__label">Operating Hours (WAT)</span>
            <span className={`badge ${isOpen ? 'badge--paid' : 'badge--failed'}`}>
              {isOpen ? 'Open now' : 'Closed now'}
            </span>
          </div>
          <div className="hours-card__inputs">
            <label className="hours-card__field">
              <span>Opens</span>
              <input
                type="time"
                value={draftOpen}
                onChange={(e) => setDraftOpen(e.target.value)}
                required
              />
            </label>
            <label className="hours-card__field">
              <span>Closes</span>
              <input
                type="time"
                value={draftClose}
                onChange={(e) => setDraftClose(e.target.value)}
                required
              />
            </label>
          </div>
          <div className="hours-card__footer">
            <label className="switch-row switch-row--compact">
              <input
                type="checkbox"
                checked={draftEnforce}
                onChange={(e) => setDraftEnforce(e.target.checked)}
              />
              <span className="switch" aria-hidden="true" />
              <span>Enforce</span>
            </label>
            <button type="submit" className="btn btn--primary btn--xs" disabled={hoursSaving}>
              {hoursSaving ? 'Saving...' : 'Save hours'}
            </button>
          </div>
          {hoursMsg ? (
            <span className="small text-ok">{hoursMsg}</span>
          ) : (
            <span className="muted small">
              {draftEnforce
                ? `${formatTime12h(draftOpen)} – ${formatTime12h(draftClose)}`
                : 'Schedule check paused (always open)'}
            </span>
          )}
        </form>
      </div>

      <div className="panel-toolbar">
        <div className="chips">
          {(['all', ...ORDER_STATUSES.map((s) => s.value)] as const).map((s) => (
            <button key={s} className={`chip ${filter === s ? 'is-active' : ''}`} onClick={() => setFilter(s)}>
              {s === 'all' ? 'All orders' : ORDER_STATUSES.find((x) => x.value === s)?.label}
              <span>{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <LiveDot connected={connected} />
      </div>

      {(error || err) && <p className="alert alert--error">{error ?? err}</p>}

      {loading ? (
        <div className="orders-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="order-card skeleton" style={{ height: 220 }} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState title="No orders in this view" message="Incoming orders appear here automatically in real time." />
      ) : (
        <div className="orders-grid">
          {visible.map((o) => {
            const tableOrder = isTableOrder(o.address)
            return (
              <article key={o.id} className={`order-card ${freshIds.has(o.id) ? 'is-fresh' : ''}`}>
                <header className="order-card__head">
                  <div className="order-card__id-group">
                    <strong className="mono">#{shortOrderId(o.id)}</strong>
                    <small className="muted">{timeAgo(o.created_at)}</small>
                  </div>
                  <PaymentBadge order={o} />
                </header>

                <div className="order-card__customer">
                  <div className="order-card__who">
                    <span className={`order-card__place ${tableOrder ? 'is-table' : 'is-delivery'}`}>
                      {tableOrder ? o.address : `Delivery · ${o.address}`}
                    </span>
                    <strong>{o.customer_name}</strong>
                  </div>
                  {o.notes && (
                    <div className="order-card__notes">
                      <strong>Note:</strong> {o.notes}
                    </div>
                  )}
                </div>

                <OrderItemsList items={o.items} />

                <div className="total-row total-row--border">
                  <span>Total</span>
                  <strong>{formatPrice(Number(o.total))}</strong>
                </div>

                {o.payment_reference && <small className="muted mono">Ref: {o.payment_reference}</small>}

                <div className="status-buttons" role="group" aria-label="Order status">
                  {ORDER_STATUSES.map((s) => (
                    <button
                      key={s.value}
                      className={`status-btn status-btn--${s.value} ${o.status === s.value ? 'is-active' : ''}`}
                      onClick={() => setStatus(o, s.value)}
                      aria-pressed={o.status === s.value}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Menu management
// ---------------------------------------------------------------------------

function MenuPanel() {
  const { items, setItems, loading, error } = useMenu()
  const [editing, setEditing] = useState<MenuItem | null | 'new'>(null)
  const [err, setErr] = useState<string | null>(null)

  const toggleAvailable = async (item: MenuItem) => {
    setErr(null)
    const next = !item.available
    setItems((prev) => prev.map((m) => (m.id === item.id ? { ...m, available: next } : m)))
    const { error: e } = await supabase.from('menu_items').update({ available: next }).eq('id', item.id)
    if (e) {
      setItems((prev) => prev.map((m) => (m.id === item.id ? { ...m, available: item.available } : m)))
      setErr(e.message)
    }
  }

  const remove = async (item: MenuItem) => {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return
    setErr(null)
    const { error: e } = await supabase.from('menu_items').delete().eq('id', item.id)
    if (e) return setErr(e.message)
    setItems((prev) => prev.filter((m) => m.id !== item.id))

    const marker = `/storage/v1/object/public/${MENU_IMAGES_BUCKET}/`
    if (item.image_url?.includes(marker)) {
      const path = item.image_url.split(marker)[1]
      await supabase.storage.from(MENU_IMAGES_BUCKET).remove([decodeURIComponent(path)])
    }
  }

  const onSaved = (saved: MenuItem) => {
    setItems((prev) => (prev.some((m) => m.id === saved.id) ? prev.map((m) => (m.id === saved.id ? saved : m)) : [...prev, saved]))
    setEditing(null)
  }

  return (
    <section>
      <div className="panel-toolbar">
        <div>
          <h2 className="panel-title">
            Menu Catalog <span className="muted">({items.length})</span>
          </h2>
          <p className="muted small">Manage dishes, pricing, photos, and real-time kitchen availability.</p>
        </div>
        <button className="btn btn--primary" onClick={() => setEditing('new')}>
          <PlusIcon size={16} /> Add dish
        </button>
      </div>

      {(error || err) && <p className="alert alert--error">{error ?? err}</p>}

      {loading ? (
        <div className="admin-menu">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="admin-item skeleton" style={{ height: 76 }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="No dishes in catalog" message="Add your first dish to publish your menu." />
      ) : (
        CATEGORIES.map((cat) => {
          const list = items.filter((i) => i.category === cat)
          if (list.length === 0) return null
          return (
            <div key={cat} className="admin-menu-group">
              <h3>{cat} <span>({list.length})</span></h3>
              <div className="admin-menu">
                {list.map((item) => (
                  <div key={item.id} className={`admin-item ${item.available ? '' : 'is-soldout'}`}>
                    <FoodImage src={item.image_url} alt={item.name} className="admin-item__img" />
                    <div className="admin-item__info">
                      <div className="admin-item__title-row">
                        <strong>{item.name}</strong>
                        {item.best_seller && <span className="admin-item__tag">Popular</span>}
                      </div>
                      <span className="muted small admin-item__desc">{item.description}</span>
                    </div>
                    <div className="admin-item__price">{formatPrice(item.price)}</div>
                    <label className="switch-row switch-row--compact" title="Toggle availability">
                      <input type="checkbox" checked={item.available} onChange={() => toggleAvailable(item)} />
                      <span className="switch" aria-hidden="true" />
                      <span className={item.available ? 'text-ok' : 'text-bad'}>{item.available ? 'In stock' : 'Sold out'}</span>
                    </label>
                    <div className="admin-item__actions">
                      <button className="btn btn--ghost btn--sm" onClick={() => setEditing(item)}>
                        Edit
                      </button>
                      <button className="btn btn--danger btn--sm" onClick={() => remove(item)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })
      )}

      {editing && <MenuItemForm item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Table (NFC / QR) & Delivery Link Variations
// ---------------------------------------------------------------------------

function LinksPanel() {
  const [tables, setTables] = useState<RestaurantTable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newCode, setNewCode] = useState('')
  const [bulkCount, setBulkCount] = useState('15')
  const [busy, setBusy] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [qrModal, setQrModal] = useState<{ title: string; subtitle: string; url: string } | null>(null)

  const defaultOrigin =
    /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
      ? window.location.protocol + '//10.232.130.108:' + (window.location.port || '5173')
      : window.location.origin
  const [origin, setOrigin] = useState(defaultOrigin)
  const deliveryUrl = buildDeliveryUrl(origin)

  useEffect(() => {
    let active = true
    supabase
      .from('restaurant_tables')
      .select('*')
      .order('created_at', { ascending: true })
      .then(({ data, error: err }) => {
        if (!active) return
        if (err) setError(err.message)
        else setTables((data ?? []) as RestaurantTable[])
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const copyLink = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 2000)
    } catch {
      prompt('Copy this link:', url)
    }
  }

  const addTable = async (e: FormEvent) => {
    e.preventDefault()
    const code = newCode.trim().replace(/^table\s+/i, '')
    if (!code) return
    setBusy(true)
    setError(null)
    const label = formatTableLabel(code)
    const { data, error: err } = await supabase
      .from('restaurant_tables')
      .insert({ code, label })
      .select()
      .single()
    setBusy(false)
    if (err) {
      setError(err.code === '23505' ? `"${label}" already exists.` : err.message)
      return
    }
    setTables((prev) => [...prev, data as RestaurantTable])
    setNewCode('')
  }

  const generateNumberedTables = async () => {
    const count = Math.min(Math.max(parseInt(bulkCount, 10) || 10, 1), 100)
    setBusy(true)
    setError(null)
    const existingCodes = new Set(tables.map((t) => t.code.toLowerCase()))
    const toInsert: { code: string; label: string }[] = []
    for (let i = 1; i <= count; i++) {
      const code = String(i)
      if (!existingCodes.has(code)) {
        toInsert.push({ code, label: `Table ${i}` })
      }
    }
    if (toInsert.length === 0) {
      setBusy(false)
      return
    }
    const { data, error: err } = await supabase.from('restaurant_tables').insert(toInsert).select()
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setTables((prev) => [...prev, ...((data ?? []) as RestaurantTable[])])
  }

  const deleteTable = async (t: RestaurantTable) => {
    setError(null)
    const { error: err } = await supabase.from('restaurant_tables').delete().eq('id', t.id)
    if (err) return setError(err.message)
    setTables((prev) => prev.filter((x) => x.id !== t.id))
  }

  return (
    <section className="links-section">
      <div className="links-controls">
        <label className="field" style={{ flex: 1 }}>
          <span>Public Base URL for QR & NFC Tags</span>
          <input value={origin} onChange={(e) => setOrigin(e.target.value.replace(/\/+$/, ''))} placeholder="https://your-domain.com" />
        </label>
      </div>

      <div className="link-feature-card">
        <div className="link-feature-card__info">
          <span className="badge badge--cash">Online Ordering</span>
          <h2>Direct Delivery Link</h2>
          <p className="muted small">
            Share on social channels or WhatsApp. Opens the menu pre-configured for home or office delivery.
          </p>
          <code className="link-url">{deliveryUrl}</code>
        </div>
        <div className="link-feature-card__actions">
          <button className="btn btn--primary btn--sm" onClick={() => copyLink('delivery', deliveryUrl)}>
            {copiedKey === 'delivery' ? 'Copied' : 'Copy link'}
          </button>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() =>
              setQrModal({
                title: 'Delivery Ordering',
                subtitle: 'Scan to order for home or office delivery',
                url: deliveryUrl,
              })
            }
          >
            <QrIcon size={15} /> QR Code
          </button>
          <a className="btn btn--ghost btn--sm" href={deliveryUrl} target="_blank" rel="noreferrer">
            <ExternalIcon size={14} /> Open
          </a>
        </div>
      </div>

      <div className="panel-toolbar" style={{ marginTop: 20 }}>
        <div>
          <h2 className="panel-title">
            Dine-In Table Links <span className="muted">({tables.length})</span>
          </h2>
          <p className="muted small">
            Assign each link to a table QR stand or NFC tag so guests order directly to their table.
          </p>
        </div>
      </div>

      <div className="links-controls">
        <form className="links-add-form" onSubmit={addTable}>
          <input
            placeholder="Table number or name (e.g. 11, Patio 2)"
            maxLength={30}
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
          />
          <button type="submit" className="btn btn--primary" disabled={busy || !newCode.trim()}>
            <PlusIcon size={16} /> Add table
          </button>
        </form>

        <div className="links-bulk">
          <span className="muted small">Batch create 1 to</span>
          <input
            type="number"
            min="1"
            max="100"
            value={bulkCount}
            onChange={(e) => setBulkCount(e.target.value)}
            aria-label="Number of tables"
          />
          <button type="button" className="btn btn--ghost btn--sm" onClick={generateNumberedTables} disabled={busy}>
            Generate
          </button>
        </div>
      </div>

      {error && <p className="alert alert--error">{error}</p>}

      {loading ? (
        <div className="links-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="link-card skeleton" style={{ height: 132 }} />
          ))}
        </div>
      ) : tables.length === 0 ? (
        <EmptyState
          title="No tables configured"
          message="Add a table above or batch-generate numbered tables."
        />
      ) : (
        <div className="links-grid">
          {tables.map((t) => {
            const url = buildTableUrl(origin, t.code)
            const shortPath = `${origin}/t/${encodeURIComponent(t.code)}`
            const isCopied = copiedKey === t.id
            return (
              <article key={t.id} className="link-card">
                <div className="link-card__top">
                  <div>
                    <strong className="link-card__title">{t.label}</strong>
                    <small className="muted block mono">/t/{t.code}</small>
                  </div>
                  <button
                    className="icon-btn icon-btn--sm"
                    onClick={() => deleteTable(t)}
                    aria-label={`Delete ${t.label}`}
                    title="Delete table"
                  >
                    <TrashIcon size={15} />
                  </button>
                </div>

                <code className="link-url">{url}</code>

                <div className="link-card__actions">
                  <button className="btn btn--primary btn--sm" onClick={() => copyLink(t.id, url)}>
                    {isCopied ? 'Copied' : 'Copy link'}
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      setQrModal({
                        title: t.label,
                        subtitle: `Scan to order directly to ${t.label}`,
                        url,
                      })
                    }
                  >
                    <QrIcon size={14} /> QR
                  </button>
                  <a className="btn btn--ghost btn--sm" href={shortPath} target="_blank" rel="noreferrer">
                    <ExternalIcon size={14} /> Open
                  </a>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {qrModal && (
        <div className="modal-overlay" onClick={() => setQrModal(null)}>
          <div className="modal qr-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h2>{qrModal.title} · QR Stand Card</h2>
              <button className="icon-btn" onClick={() => setQrModal(null)} aria-label="Close">
                <CloseIcon />
              </button>
            </div>
            <div className="modal__body center qr-modal__body">
              <p className="qr-modal__brand">{RESTAURANT_NAME}</p>
              <h3>{qrModal.title}</h3>
              <p className="muted small">{qrModal.subtitle}</p>
              <img
                className="qr-modal__img"
                src={`https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=12&data=${encodeURIComponent(qrModal.url)}`}
                alt={`QR code for ${qrModal.title}`}
                width={220}
                height={220}
              />
              <code className="link-url">{qrModal.url}</code>
              <div className="modal__footer" style={{ justifyContent: 'center', marginTop: 12 }}>
                <button className="btn btn--ghost" onClick={() => copyLink('modal', qrModal.url)}>
                  {copiedKey === 'modal' ? 'Copied' : 'Copy URL'}
                </button>
                <button className="btn btn--primary" onClick={() => window.print()}>
                  Print card
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Staff Account Creation & Admin Email / Password Settings
// ---------------------------------------------------------------------------

interface StaffMember {
  id: string
  email: string
  role: 'admin' | 'kitchen'
  created_at: string
}

function StaffSettingsPanel() {
  const { session } = useAuth()
  const currentUserId = session?.user.id

  const [myEmail, setMyEmail] = useState(session?.user.email ?? '')
  const [myPassword, setMyPassword] = useState('')
  const [myPasswordConfirm, setMyPasswordConfirm] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [loadingStaff, setLoadingStaff] = useState(true)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'kitchen' | 'admin'>('kitchen')
  const [createBusy, setCreateBusy] = useState(false)
  const [staffMsg, setStaffMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const [editTarget, setEditTarget] = useState<StaffMember | null>(null)
  const [editEmailVal, setEditEmailVal] = useState('')
  const [editPasswordVal, setEditPasswordVal] = useState('')
  const [editBusy, setEditBusy] = useState(false)

  const loadStaff = async () => {
    setLoadingStaff(true)
    const { data, error } = await supabase.rpc('admin_list_staff')
    if (!error && data) {
      setStaffList(data as StaffMember[])
    }
    setLoadingStaff(false)
  }

  useEffect(() => {
    let active = true
    supabase.rpc('admin_list_staff').then(({ data, error }) => {
      if (!active) return
      if (!error && data) {
        const list = data as StaffMember[]
        setStaffList(list)
        const me = list.find((m) => m.id === currentUserId)
        if (me) setMyEmail(me.email)
      }
      setLoadingStaff(false)
    })
    return () => {
      active = false
    }
  }, [currentUserId])

  const handleUpdateMyAccount = async (e: FormEvent) => {
    e.preventDefault()
    setPwMsg(null)
    if (!currentUserId) return

    const cleanEmail = myEmail.trim().toLowerCase()
    if (!cleanEmail) {
      return setPwMsg({ type: 'err', text: 'Email cannot be empty.' })
    }
    if (myPassword && myPassword.length < 6) {
      return setPwMsg({ type: 'err', text: 'New password must be at least 6 characters.' })
    }
    if (myPassword !== myPasswordConfirm) {
      return setPwMsg({ type: 'err', text: 'Passwords do not match.' })
    }

    setPwBusy(true)
    const { error } = await supabase.rpc('admin_update_staff', {
      p_user_id: currentUserId,
      p_new_role: null,
      p_new_password: myPassword || null,
      p_new_email: cleanEmail,
    })
    if (!error) {
      await supabase.auth.refreshSession()
    }
    setPwBusy(false)

    if (error) {
      setPwMsg({ type: 'err', text: error.message })
    } else {
      setMyPassword('')
      setMyPasswordConfirm('')
      setPwMsg({ type: 'ok', text: 'Your account credentials have been updated.' })
      loadStaff()
    }
  }

  const handleCreateStaff = async (e: FormEvent) => {
    e.preventDefault()
    setStaffMsg(null)
    if (newPassword.length < 6) {
      return setStaffMsg({ type: 'err', text: 'Password must be at least 6 characters.' })
    }

    setCreateBusy(true)
    const { error } = await supabase.rpc('admin_create_staff', {
      p_email: newEmail.trim(),
      p_password: newPassword,
      p_role: newRole,
    })
    setCreateBusy(false)

    if (error) {
      setStaffMsg({ type: 'err', text: error.message })
    } else {
      setStaffMsg({
        type: 'ok',
        text: `Created ${newRole} account for ${newEmail.trim()}.`,
      })
      setNewEmail('')
      setNewPassword('')
      loadStaff()
    }
  }

  const handleRoleChange = async (member: StaffMember, nextRole: 'admin' | 'kitchen') => {
    setStaffMsg(null)
    const { error } = await supabase.rpc('admin_update_staff', {
      p_user_id: member.id,
      p_new_role: nextRole,
      p_new_password: null,
      p_new_email: null,
    })
    if (error) {
      setStaffMsg({ type: 'err', text: error.message })
    } else {
      setStaffList((prev) => prev.map((m) => (m.id === member.id ? { ...m, role: nextRole } : m)))
      setStaffMsg({ type: 'ok', text: `Updated ${member.email} role to ${nextRole}.` })
    }
  }

  const handleSaveStaffEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editTarget) return
    const cleanEmail = editEmailVal.trim().toLowerCase()
    if (!cleanEmail) {
      return setStaffMsg({ type: 'err', text: 'Email cannot be empty.' })
    }
    if (editPasswordVal && editPasswordVal.length < 6) {
      return setStaffMsg({ type: 'err', text: 'New password must be at least 6 characters.' })
    }

    setEditBusy(true)
    const { error } = await supabase.rpc('admin_update_staff', {
      p_user_id: editTarget.id,
      p_new_role: null,
      p_new_password: editPasswordVal || null,
      p_new_email: cleanEmail,
    })
    setEditBusy(false)
    if (error) {
      setStaffMsg({ type: 'err', text: error.message })
    } else {
      setStaffMsg({ type: 'ok', text: `Updated credentials for ${cleanEmail}.` })
      if (editTarget.id === currentUserId) {
        setMyEmail(cleanEmail)
        await supabase.auth.refreshSession()
      }
      setEditTarget(null)
      setEditPasswordVal('')
      loadStaff()
    }
  }

  return (
    <section className="staff-settings-grid">
      <div className="card">
        <h2>Your Account Credentials</h2>
        <p className="muted small" style={{ marginTop: 4, marginBottom: 16 }}>
          Update the email address or password you use to sign in.
        </p>

        <form className="form" onSubmit={handleUpdateMyAccount}>
          <label className="field">
            <span>Email address</span>
            <input
              type="email"
              required
              value={myEmail}
              onChange={(e) => setMyEmail(e.target.value)}
            />
          </label>
          <label className="field">
            <span>
              New password <small className="muted">(leave blank to keep current)</small>
            </span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={6}
              placeholder="Minimum 6 characters"
              value={myPassword}
              onChange={(e) => setMyPassword(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={6}
              placeholder="Re-enter new password"
              value={myPasswordConfirm}
              onChange={(e) => setMyPasswordConfirm(e.target.value)}
            />
          </label>

          {pwMsg && (
            <p className={`alert ${pwMsg.type === 'ok' ? 'alert--info' : 'alert--error'}`}>
              {pwMsg.text}
            </p>
          )}

          <button type="submit" className="btn btn--primary" disabled={pwBusy}>
            {pwBusy ? 'Saving...' : 'Update credentials'}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Add Team Member</h2>
        <p className="muted small" style={{ marginTop: 4, marginBottom: 16 }}>
          Provision access for kitchen display operators or back-office managers.
        </p>

        <form className="form" onSubmit={handleCreateStaff}>
          <label className="field">
            <span>Work email</span>
            <input
              type="email"
              required
              placeholder="e.g. kitchen@creedlabs.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Temporary password</span>
              <input
                type="text"
                required
                minLength={6}
                placeholder="Min 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>

            <label className="field">
              <span>Role</span>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value as 'kitchen' | 'admin')}>
                <option value="kitchen">Kitchen Display (/kitchen)</option>
                <option value="admin">Back Office Admin (/admin)</option>
              </select>
            </label>
          </div>

          {staffMsg && (
            <p className={`alert ${staffMsg.type === 'ok' ? 'alert--info' : 'alert--error'}`}>
              {staffMsg.text}
            </p>
          )}

          <button type="submit" className="btn btn--primary" disabled={createBusy}>
            <PlusIcon size={16} /> {createBusy ? 'Creating...' : 'Create account'}
          </button>
        </form>
      </div>

      <div className="card staff-settings-grid__full">
        <div className="panel-toolbar" style={{ marginBottom: 12 }}>
          <div>
            <h2>Team Directory <span className="muted">({staffList.length})</span></h2>
            <p className="muted small">
              Manage active staff accounts, role assignments, and sign-in credentials.
            </p>
          </div>
        </div>

        {loadingStaff ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : (
          <div className="staff-directory">
            {staffList.map((member) => {
              const isMe = member.id === currentUserId
              return (
                <div key={member.id} className="staff-row">
                  <div className="staff-row__info">
                    <strong>
                      {member.email} {isMe && <span className="badge badge--paid">Current user</span>}
                    </strong>
                    <small className="muted">
                      {member.role === 'admin' ? 'Full access · Back Office & Kitchen Display' : 'Kitchen Display only'}
                    </small>
                  </div>

                  <div className="staff-row__actions">
                    <select
                      className="staff-role-select"
                      value={member.role}
                      disabled={isMe}
                      aria-label={`Role for ${member.email}`}
                      onChange={(e) => handleRoleChange(member, e.target.value as 'admin' | 'kitchen')}
                    >
                      <option value="admin">Admin</option>
                      <option value="kitchen">Kitchen</option>
                    </select>

                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => {
                        setEditTarget(member)
                        setEditEmailVal(member.email)
                        setEditPasswordVal('')
                      }}
                    >
                      Edit credentials
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editTarget && (
        <div className="modal-overlay" onClick={() => setEditTarget(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h2>Edit {editTarget.role} credentials</h2>
              <button className="icon-btn" onClick={() => setEditTarget(null)} aria-label="Close">
                <CloseIcon />
              </button>
            </div>
            <form className="form modal__body" onSubmit={handleSaveStaffEdit}>
              <label className="field">
                <span>Email address</span>
                <input
                  type="email"
                  required
                  value={editEmailVal}
                  onChange={(e) => setEditEmailVal(e.target.value)}
                />
              </label>
              <label className="field">
                <span>
                  New password <small className="muted">(leave blank to keep existing)</small>
                </span>
                <input
                  type="text"
                  minLength={6}
                  placeholder="Enter new password (min 6 chars)"
                  value={editPasswordVal}
                  onChange={(e) => setEditPasswordVal(e.target.value)}
                />
              </label>
              <div className="modal__footer">
                <button type="button" className="btn btn--ghost" onClick={() => setEditTarget(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--primary" disabled={editBusy}>
                  {editBusy ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
