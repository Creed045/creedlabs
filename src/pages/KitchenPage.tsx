import { useEffect, useState } from 'react'
import { FoodImage } from '../components/FoodImage'
import { BellIcon, CloseIcon } from '../components/Icons'
import { LiveDot } from '../components/LiveDot'
import { PaymentBadge } from '../components/PaymentBadge'
import { StaffHeader } from '../components/StaffHeader'
import { playChime, unlockAudio, vibrate } from '../lib/alert'
import { CATEGORIES, formatPrice } from '../lib/config'
import { updateOrderStatus, useLiveOrders } from '../lib/orders'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/time'
import { isTableOrder, shortOrderId, type MenuItem, type Order, type OrderStatus } from '../lib/types'
import { useMenu } from '../lib/useMenu'
import { useLiveWaiterCalls } from '../lib/waiter'

const COLUMNS: { status: OrderStatus; title: string; next?: OrderStatus; nextLabel?: string; prev?: OrderStatus }[] = [
  { status: 'new', title: 'New', next: 'preparing', nextLabel: 'Start preparing →' },
  { status: 'preparing', title: 'Preparing', next: 'ready', nextLabel: 'Mark ready →', prev: 'new' },
  { status: 'ready', title: 'Ready', next: 'delivered', nextLabel: 'Served / Delivered ✓', prev: 'preparing' },
]

const ACTIVE: OrderStatus[] = ['new', 'preparing', 'ready']

type KitchenView = 'orders' | 'stock'

export function KitchenPage() {
  const [view, setView] = useState<KitchenView>('orders')
  const [soundOn, setSoundOn] = useState(false)
  const [alertCount, setAlertCount] = useState(0)
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set())
  const [warnOrder, setWarnOrder] = useState<{
    order: Order
    status: OrderStatus
    type: 'failed' | 'pending'
  } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [, setTick] = useState(0)

  const { items: menuItems, setItems: setMenuItems, loading: menuLoading } = useMenu()
  const { calls: waiterCalls, dismissCall } = useLiveWaiterCalls(() => { playChime(); vibrate() })
  const availableCount = menuItems.filter((m) => m.available).length

  const { orders, loading, error, connected, patchLocal } = useLiveOrders({
    statuses: ACTIVE,
    onNewOrder: (o) => {
      playChime()
      vibrate()
      setAlertCount((n) => n + 1)
      setFreshIds((s) => new Set(s).add(o.id))
    },
  })

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    document.title = alertCount > 0 ? `(${alertCount}) New order! · Kitchen` : 'Kitchen board'
  }, [alertCount])

  const enableSound = async () => {
    const ok = await unlockAudio()
    setSoundOn(ok)
    if (ok) playChime()
  }

  const dismissAlert = () => {
    setAlertCount(0)
    setFreshIds(new Set())
  }

  const move = async (order: Order, status: OrderStatus) => {
    // Show a prominent confirmation warning if kitchen wants to start preparing an order with failed or unconfirmed payment
    if (status === 'preparing') {
      if (order.payment_status === 'failed') {
        setWarnOrder({ order, status, type: 'failed' })
        return
      }
      if (order.payment_method === 'squad' && order.payment_status === 'pending') {
        setWarnOrder({ order, status, type: 'pending' })
        return
      }
    }
    proceedMove(order, status)
  }

  const proceedMove = async (order: Order, status: OrderStatus) => {
    setErr(null)
    setFreshIds((s) => {
      const n = new Set(s)
      n.delete(order.id)
      return n
    })
    const previous = order.status
    patchLocal(order.id, { status })
    const e = await updateOrderStatus(order.id, status)
    if (e) {
      patchLocal(order.id, { status: previous })
      setErr(`Could not move order #${shortOrderId(order.id)}: ${e}`)
    }
  }

  const toggleDishAvailable = async (dish: MenuItem) => {
    setErr(null)
    const next = !dish.available
    setMenuItems((prev) => prev.map((m) => (m.id === dish.id ? { ...m, available: next } : m)))
    const { error: updateErr } = await supabase.from('menu_items').update({ available: next }).eq('id', dish.id)
    if (updateErr) {
      setMenuItems((prev) => prev.map((m) => (m.id === dish.id ? { ...m, available: dish.available } : m)))
      setErr(`Could not update "${dish.name}": ${updateErr.message}`)
    }
  }

  return (
    <div className="staff-page kitchen">
      <StaffHeader
        title="Kitchen board"
        right={
          <>
            <div className="kitchen-nav">
              <button
                className={`kitchen-nav__btn ${view === 'orders' ? 'is-active' : ''}`}
                onClick={() => setView('orders')}
              >
                📋 Live Orders ({orders.length})
              </button>
              <button
                className={`kitchen-nav__btn ${view === 'stock' ? 'is-active' : ''}`}
                onClick={() => setView('stock')}
              >
                🍲 Food Availability ({availableCount}/{menuItems.length})
              </button>
            </div>
            <LiveDot connected={connected} />
            <button className={`btn btn--sm ${soundOn ? 'btn--ok' : 'btn--ghost'}`} onClick={enableSound}>
              <BellIcon size={16} /> {soundOn ? 'Sound on' : 'Enable sound'}
            </button>
          </>
        }
      />

      {alertCount > 0 && (
        <button
          className="kitchen-alert"
          onClick={() => {
            dismissAlert()
            setView('orders')
          }}
        >
          🔔 {alertCount} new {alertCount === 1 ? 'order' : 'orders'} — tap to view
        </button>
      )}

            {waiterCalls.length > 0 && (
        <div className="waiter-alerts waiter-alerts--kitchen">
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
      {(error || err) && <p className="alert alert--error kitchen-error">{error ?? err}</p>}

      {view === 'orders' ? (
        <main className="board">
          {COLUMNS.map((col) => {
            const list = orders
              .filter((o) => o.status === col.status)
              .sort((a, b) => a.created_at.localeCompare(b.created_at))
            return (
              <section key={col.status} className={`board__col board__col--${col.status}`}>
                <header className="board__head">
                  <h2>{col.title}</h2>
                  <span className="board__count">{list.length}</span>
                </header>

                <div className="board__list">
                  {loading ? (
                    <div className="ticket skeleton" style={{ height: 180 }} />
                  ) : list.length === 0 ? (
                    <p className="board__empty">No orders</p>
                  ) : (
                    list.map((o) => {
                      const tableOrder = isTableOrder(o.address)
                      const isFailedPayment = o.payment_status === 'failed'
                      const isAwaitingPayment = o.payment_status === 'pending' && o.payment_method === 'squad'
                      const ticketWarnClass = isFailedPayment
                        ? 'ticket--failed-payment'
                        : isAwaitingPayment
                        ? 'ticket--pending-payment'
                        : ''
                      return (
                        <article key={o.id} className={`ticket ${freshIds.has(o.id) ? 'is-fresh' : ''} ${ticketWarnClass}`}>
                          <div className="ticket__head">
                            <strong className="ticket__id">#{shortOrderId(o.id)}</strong>
                            <span className="ticket__time">{timeAgo(o.created_at)}</span>
                          </div>
                          {isFailedPayment && (
                            <div className="ticket__alert-banner ticket__alert-banner--failed">
                              ⚠️ <strong>PAYMENT FAILED</strong> — Confirm before preparing!
                            </div>
                          )}
                          {isAwaitingPayment && (
                            <div className="ticket__alert-banner ticket__alert-banner--pending">
                              ⏳ <strong>AWAITING PAYMENT</strong> — Customer has not paid online yet!
                            </div>
                          )}
                          <div className="ticket__badges">
                            <span className={`order-card__place ${tableOrder ? 'is-table' : 'is-delivery'}`}>
                              {tableOrder ? `🍽️ ${o.address}` : `🛵 ${o.address}`}
                            </span>
                            <PaymentBadge order={o} large />
                          </div>
                          <div className="ticket__who">
                            Customer: <strong>{o.customer_name}</strong>
                          </div>
                          <ul className="ticket__items">
                            {o.items.map((it, i) => (
                              <li key={`${it.id}-${i}`}>
                                <span className="ticket__qty">{it.quantity}</span> {it.name}
                              </li>
                            ))}
                          </ul>
                          {o.notes && (
                            <p className="ticket__notes">
                              ⚠️ <strong>Notes / Allergies:</strong> {o.notes}
                            </p>
                          )}
                          <div className="ticket__actions">
                            {col.prev && (
                              <button className="btn btn--ghost btn--xl" onClick={() => move(o, col.prev!)} aria-label="Move back">
                                ←
                              </button>
                            )}
                            {col.next && (
                              <button
                                className={`btn btn--xl btn--block btn--go-${col.next} ${
                                  col.next === 'preparing' && isFailedPayment
                                    ? 'btn--go-preparing-warn'
                                    : col.next === 'preparing' && isAwaitingPayment
                                    ? 'btn--go-preparing-amber'
                                    : ''
                                }`}
                                onClick={() => move(o, col.next!)}
                              >
                                {col.next === 'preparing' && isFailedPayment
                                  ? '⚠️ Start preparing (Payment Failed) →'
                                  : col.next === 'preparing' && isAwaitingPayment
                                  ? '⏳ Start preparing (Awaiting Payment) →'
                                  : col.nextLabel}
                              </button>
                            )}
                          </div>
                        </article>
                      )
                    })
                  )}
                </div>
              </section>
            )
          })}
        </main>
      ) : (
        <main className="kitchen-stock">
          <header className="kitchen-stock__header">
            <div>
              <h2>🍲 Select Available Foods</h2>
              <p>Tap any dish to mark it Available or Sold Out on the customer menu immediately.</p>
            </div>
          </header>

          {menuLoading ? (
            <div className="kitchen-stock__grid">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="kitchen-dish skeleton" style={{ height: 92 }} />
              ))}
            </div>
          ) : (
            CATEGORIES.map((cat) => {
              const list = menuItems.filter((m) => m.category === cat)
              if (list.length === 0) return null
              return (
                <section key={cat} className="kitchen-stock__group">
                  <h3>{cat}</h3>
                  <div className="kitchen-stock__grid">
                    {list.map((dish) => (
                      <button
                        key={dish.id}
                        type="button"
                        className={`kitchen-dish ${dish.available ? 'is-available' : 'is-soldout'}`}
                        onClick={() => toggleDishAvailable(dish)}
                      >
                        <FoodImage src={dish.image_url} alt={dish.name} className="kitchen-dish__img" />
                        <div className="kitchen-dish__info">
                          <strong>{dish.name}</strong>
                          <small>{formatPrice(dish.price)}</small>
                        </div>
                        <span className={`kitchen-dish__status ${dish.available ? 'is-on' : 'is-off'}`}>
                          {dish.available ? '✓ Available' : '✕ Sold Out'}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )
            })
          )}
        </main>
      )}

      {warnOrder && (
        <div className="modal-overlay" onClick={() => setWarnOrder(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Payment status warning"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 500 }}
          >
            <div className="modal__header">
              <h2 style={{ color: warnOrder.type === 'failed' ? 'var(--bad)' : 'var(--warn)' }}>
                {warnOrder.type === 'failed' ? '⚠️ Payment Failed Warning' : '⏳ Awaiting Payment Warning'}
              </h2>
              <button className="icon-btn" onClick={() => setWarnOrder(null)} aria-label="Close">
                <CloseIcon />
              </button>
            </div>
            <div className="modal__body stack">
              <div
                className={`alert ${warnOrder.type === 'failed' ? 'alert--error' : 'alert--warn'}`}
                style={{ padding: '16px', fontSize: '0.98rem', lineHeight: '1.45' }}
              >
                {warnOrder.type === 'failed' ? (
                  <>
                    <strong style={{ display: 'block', marginBottom: '6px', fontSize: '1.05rem' }}>
                      ⚠️ The online payment for this order has FAILED!
                    </strong>
                    Order <strong>#{shortOrderId(warnOrder.order.id)}</strong> for{' '}
                    <strong>{warnOrder.order.customer_name}</strong> attempted online payment for{' '}
                    <strong>{formatPrice(warnOrder.order.total)}</strong>, but the transaction was declined or failed.
                  </>
                ) : (
                  <>
                    <strong style={{ display: 'block', marginBottom: '6px', fontSize: '1.05rem' }}>
                      ⚠️ This online order is still AWAITING PAYMENT.
                    </strong>
                    Order <strong>#{shortOrderId(warnOrder.order.id)}</strong> for{' '}
                    <strong>{warnOrder.order.customer_name}</strong> has not completed payment for{' '}
                    <strong>{formatPrice(warnOrder.order.total)}</strong> yet.
                  </>
                )}
              </div>

              <p className="muted" style={{ fontSize: '0.9rem' }}>
                Preparing food for an unpaid or failed order may result in lost food/revenue if the customer leaves or does not pay. Please confirm with the waiter or cashier before proceeding.
              </p>

              <div className="modal__footer" style={{ gap: '10px', marginTop: '12px' }}>
                <button
                  type="button"
                  className="btn btn--ghost btn--lg"
                  onClick={() => setWarnOrder(null)}
                >
                  Cancel (Don't prepare)
                </button>
                <button
                  type="button"
                  className={`btn btn--lg ${warnOrder.type === 'failed' ? 'btn--danger' : 'btn--warn'}`}
                  onClick={() => {
                    const { order, status } = warnOrder
                    setWarnOrder(null)
                    proceedMove(order, status)
                  }}
                >
                  Start preparing anyway →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
