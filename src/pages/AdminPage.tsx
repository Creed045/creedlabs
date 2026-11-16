import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { EmptyState } from '../components/EmptyState'
import { FoodImage } from '../components/FoodImage'
import { CloseIcon, PlusIcon, TrashIcon } from '../components/Icons'
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
import { useCallWaiterSetting, useLiveWaiterCalls } from '../lib/waiter'
import { playChime, vibrate } from '../lib/alert'

type Tab = 'orders' | 'menu' | 'links'

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('orders')

  useEffect(() => {
    document.title = 'Admin · Orders, Menu & Links'
  }, [])

  return (
    <div className="staff-page">
      <StaffHeader title="Admin panel" />
      <div className="staff-tabs">
        <button className={tab === 'orders' ? 'is-active' : ''} onClick={() => setTab('orders')}>
          Orders
        </button>
        <button className={tab === 'menu' ? 'is-active' : ''} onClick={() => setTab('menu')}>
          Menu items
        </button>
        <button className={tab === 'links' ? 'is-active' : ''} onClick={() => setTab('links')}>
          Table & Delivery Links
        </button>
      </div>
      <main className="staff-main">
        {tab === 'orders' ? <OrdersPanel /> : tab === 'menu' ? <MenuPanel /> : <LinksPanel />}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function computeDailyStats(orders: Order[]) {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const todayPrefix = `${yyyy}-${mm}-${dd}`

  const todayOrders = orders.filter((o) => o.created_at.startsWith(todayPrefix))
  const revenue = todayOrders.reduce((sum, o) => sum + Number(o.total), 0)
  const paidOnline = todayOrders
    .filter((o) => o.payment_status === 'paid')
    .reduce((sum, o) => sum + Number(o.total), 0)
  const activeCount = todayOrders.filter((o) => o.status !== 'delivered').length

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
    topDishes,
  }
}
function OrdersPanel() {
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
  const { calls: waiterCalls, dismissCall } = useLiveWaiterCalls(() => {
    playChime()
    vibrate()
  })

  const stats = useMemo(() => computeDailyStats(orders), [orders])
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
              <div>
                <strong>🔔 {c.table_label}</strong>
                <span> · {c.reason}</span>
                {c.customer_name && <small className="muted"> ({c.customer_name})</small>}
                <small className="muted"> · {timeAgo(c.created_at)}</small>
              </div>
              <button className="btn btn--primary btn--sm" onClick={() => dismissCall(c.id)}>
                ✓ Attended
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <small className="muted">Today's Revenue</small>
          <strong className="stat-card__value">{formatPrice(stats.revenue)}</strong>
          <span className="muted small">Paid online: {formatPrice(stats.paidOnline)}</span>
        </div>

        <div className="stat-card">
          <small className="muted">Today's Orders</small>
          <strong className="stat-card__value">{stats.todayCount}</strong>
          <span className="muted small">{stats.activeCount} active in kitchen</span>
        </div>

        <div className="stat-card">
          <small className="muted">🔥 Top Dishes Today</small>
          {stats.topDishes.length === 0 ? (
            <span className="muted small">No orders placed today yet</span>
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
          <small className="muted">🔔 Customer "Call Waiter" Button</small>
          <label className="switch-row" style={{ marginTop: 6 }}>
            <input
              type="checkbox"
              checked={callWaiterEnabled}
              onChange={(e) => setCallWaiterEnabled(e.target.checked)}
            />
            <span className="switch" aria-hidden="true" />
            <span className={callWaiterEnabled ? 'text-ok' : 'muted'}>
              {callWaiterEnabled ? 'Enabled on tables' : 'Turned off'}
            </span>
          </label>
          <span className="muted small">Toggle whether table guests see "Call waiter"</span>
        </div>
      </div>

      <div className="panel-toolbar">
        <div className="chips">
          {(['all', ...ORDER_STATUSES.map((s) => s.value)] as const).map((s) => (
            <button key={s} className={`chip ${filter === s ? 'is-active' : ''}`} onClick={() => setFilter(s)}>
              {s === 'all' ? 'All' : ORDER_STATUSES.find((x) => x.value === s)?.label}
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
        <EmptyState icon="🧾" title="No orders here yet" message="New orders will appear instantly — no need to refresh." />
      ) : (
        <div className="orders-grid">
          {visible.map((o) => {
            const tableOrder = isTableOrder(o.address)
            return (
              <article key={o.id} className={`order-card ${freshIds.has(o.id) ? 'is-fresh' : ''}`}>
                <header className="order-card__head">
                  <div>
                    <strong>#{shortOrderId(o.id)}</strong>
                    <small className="muted"> · {timeAgo(o.created_at)}</small>
                  </div>
                  <PaymentBadge order={o} />
                </header>

                <div className="order-card__customer">
                  <div className="order-card__who">
                    <span className={`order-card__place ${tableOrder ? 'is-table' : 'is-delivery'}`}>
                      {tableOrder ? `🍽️ ${o.address}` : `🛵 ${o.address}`}
                    </span>
                    <strong>{o.customer_name}</strong>
                  </div>
                  {o.notes && (
                    <div className="order-card__notes">
                      <strong>Notes / Allergies:</strong> {o.notes}
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
        <h2 className="panel-title">
          Menu items <span className="muted">({items.length})</span>
        </h2>
        <button className="btn btn--primary" onClick={() => setEditing('new')}>
          <PlusIcon size={18} /> Add item
        </button>
      </div>

      {(error || err) && <p className="alert alert--error">{error ?? err}</p>}

      {loading ? (
        <div className="admin-menu">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="admin-item skeleton" style={{ height: 96 }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="No menu items yet" message="Add your first dish to get started." />
      ) : (
        CATEGORIES.map((cat) => {
          const list = items.filter((i) => i.category === cat)
          if (list.length === 0) return null
          return (
            <div key={cat} className="admin-menu-group">
              <h3>{cat}</h3>
              <div className="admin-menu">
                {list.map((item) => (
                  <div key={item.id} className={`admin-item ${item.available ? '' : 'is-soldout'}`}>
                    <FoodImage src={item.image_url} alt={item.name} className="admin-item__img" />
                    <div className="admin-item__info">
                      <strong>{item.name}</strong>
                      <span className="muted">{formatPrice(item.price)}</span>
                    </div>
                    <label className="switch-row switch-row--compact" title="Toggle availability">
                      <input type="checkbox" checked={item.available} onChange={() => toggleAvailable(item)} />
                      <span className="switch" aria-hidden="true" />
                      <span className={item.available ? 'text-ok' : 'text-bad'}>{item.available ? 'Available' : 'Sold out'}</span>
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

  const defaultOrigin = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname) ? window.location.protocol + '//10.232.130.108:' + (window.location.port || '5173') : window.location.origin
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
      <div className="links-controls" style={{ marginBottom: 12 }}>
        <label className="field" style={{ flex: 1 }}>
          <span>Base URL for Phone QR & NFC Links (use your Wi-Fi IP or live domain, not localhost)</span>
          <input value={origin} onChange={(e) => setOrigin(e.target.value.replace(/\/+$/, ''))} placeholder="http://10.232.130.108:5174" />
        </label>
      </div>
      {/* 1. Delivery Link Variation */}
      <div className="link-feature-card">
        <div className="link-feature-card__info">
          <span className="badge badge--cash">Delivery Variation</span>
          <h2>🛵 Online Delivery Link</h2>
          <p className="muted">
            Share this link on Instagram, WhatsApp, or your website. Customers who open this link see the{' '}
            <strong>Delivery address</strong> checkout instead of a table number.
          </p>
          <code className="link-url">{deliveryUrl}</code>
        </div>
        <div className="link-feature-card__actions">
          <button className="btn btn--primary" onClick={() => copyLink('delivery', deliveryUrl)}>
            {copiedKey === 'delivery' ? 'Copied ✓' : 'Copy delivery link'}
          </button>
          <button
            className="btn btn--ghost"
            onClick={() =>
              setQrModal({
                title: 'Delivery Ordering',
                subtitle: 'Scan to order for home or office delivery',
                url: deliveryUrl,
              })
            }
          >
            QR Code
          </button>
          <a className="btn btn--ghost" href={deliveryUrl} target="_blank" rel="noreferrer">
            Preview ↗
          </a>
        </div>
      </div>

      {/* 2. Table / NFC Link Variations */}
      <div className="panel-toolbar" style={{ marginTop: 28 }}>
        <div>
          <h2 className="panel-title">
            🍽️ Table NFC & QR Links <span className="muted">({tables.length})</span>
          </h2>
          <p className="muted small">
            Write each link to a table's NFC tag or print its QR code. Customers who tap/scan go straight to the menu for that table and only enter their <strong>Name</strong> and <strong>Notes / Allergies</strong>.
          </p>
        </div>
      </div>

      <div className="links-controls">
        <form className="links-add-form" onSubmit={addTable}>
          <input
            placeholder="Add table (e.g. 11, VIP-1, Patio-2)"
            maxLength={30}
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
          />
          <button type="submit" className="btn btn--primary" disabled={busy || !newCode.trim()}>
            <PlusIcon size={18} /> Add table link
          </button>
        </form>

        <div className="links-bulk">
          <span className="muted small">Quick generate 1 to</span>
          <input
            type="number"
            min="1"
            max="100"
            value={bulkCount}
            onChange={(e) => setBulkCount(e.target.value)}
            aria-label="Number of tables"
          />
          <button type="button" className="btn btn--ghost btn--sm" onClick={generateNumberedTables} disabled={busy}>
            Generate tables
          </button>
        </div>
      </div>

      {error && <p className="alert alert--error">{error}</p>}

      {loading ? (
        <div className="links-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="link-card skeleton" style={{ height: 140 }} />
          ))}
        </div>
      ) : tables.length === 0 ? (
        <EmptyState
          icon="🏷️"
          title="No table links yet"
          message="Add a table above or click Generate tables to create NFC/QR links for every table."
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
                    <strong className="link-card__title">🍽️ {t.label}</strong>
                    <small className="muted block">Short NFC link: /t/{t.code}</small>
                  </div>
                  <button
                    className="icon-btn icon-btn--sm"
                    onClick={() => deleteTable(t)}
                    aria-label={`Delete ${t.label}`}
                    title="Delete table link"
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>

                <code className="link-url">{url}</code>

                <div className="link-card__actions">
                  <button className="btn btn--primary btn--sm" onClick={() => copyLink(t.id, url)}>
                    {isCopied ? 'Copied ✓' : 'Copy NFC link'}
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      setQrModal({
                        title: t.label,
                        subtitle: `Scan to order right to ${t.label}`,
                        url,
                      })
                    }
                  >
                    QR Code
                  </button>
                  <a className="btn btn--ghost btn--sm" href={shortPath} target="_blank" rel="noreferrer">
                    Open ↗
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
              <h2>{qrModal.title} — QR & NFC Link</h2>
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
                width={240}
                height={240}
              />
              <code className="link-url">{qrModal.url}</code>
              <div className="modal__footer" style={{ justifyContent: 'center', marginTop: 12 }}>
                <button className="btn btn--ghost" onClick={() => copyLink('modal', qrModal.url)}>
                  {copiedKey === 'modal' ? 'Copied ✓' : 'Copy link'}
                </button>
                <button className="btn btn--primary" onClick={() => window.print()}>
                  Print stand card
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
