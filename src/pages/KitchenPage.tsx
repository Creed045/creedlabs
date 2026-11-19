import { useEffect, useState } from 'react'
import { FoodImage } from '../components/FoodImage'
import { AlertIcon, BellIcon, CheckIcon, ClockIcon, CloseIcon } from '../components/Icons'
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

const COLUMNS: { status: OrderStatus; title: string; subtitle: string; next?: OrderStatus; nextLabel?: string; prev?: OrderStatus }[] = [
  { status: 'new', title: 'Incoming', subtitle: 'New tickets', next: 'preparing', nextLabel: 'Start prep' },
  { status: 'preparing', title: 'In Prep', subtitle: 'On the line', next: 'ready', nextLabel: 'Mark ready', prev: 'new' },
  { status: 'ready', title: 'Ready', subtitle: 'Awaiting runner', next: 'delivered', nextLabel: 'Complete', prev: 'preparing' },
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
  const { calls: waiterCalls, dismissCall } = useLiveWaiterCalls(() => {
    playChime()
    vibrate()
  })
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
    document.title = alertCount > 0 ? `(${alertCount}) New ticket · Kitchen` : 'Kitchen Display'
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
      setErr(`Could not update ticket #${shortOrderId(order.id)}: ${e}`)
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
        title="Kitchen Display"
        right={
          <>
            <div className="kitchen-nav" role="tablist" aria-label="Kitchen views">
              <button
                role="tab"
                aria-selected={view === 'orders'}
                className={`kitchen-nav__btn ${view === 'orders' ? 'is-active' : ''}`}
                onClick={() => setView('orders')}
              >
                Active Tickets <span className="kitchen-nav__count">{orders.length}</span>
              </button>
              <button
                role="tab"
                aria-selected={view === 'stock'}
                className={`kitchen-nav__btn ${view === 'stock' ? 'is-active' : ''}`}
                onClick={() => setView('stock')}
              >
                Item Availability <span className="kitchen-nav__count">{availableCount}/{menuItems.length}</span>
              </button>
            </div>
            <LiveDot connected={connected} />
            <button className={`btn btn--sm ${soundOn ? 'btn--ok' : 'btn--ghost'}`} onClick={enableSound}>
              <BellIcon size={14} /> {soundOn ? 'Audio on' : 'Audio off'}
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
          {alertCount} new {alertCount === 1 ? 'ticket' : 'tickets'} received · Tap to acknowledge
        </button>
      )}

      {waiterCalls.length > 0 && (
        <div className="waiter-alerts waiter-alerts--kitchen">
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
                <CheckIcon size={14} /> Acknowledge
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
                  <div className="board__head-left">
                    <span className={`board__dot board__dot--${col.status}`} aria-hidden="true" />
                    <div>
                      <h2>{col.title}</h2>
                      <small className="board__subtitle">{col.subtitle}</small>
                    </div>
                  </div>
                  <span className="board__count">{list.length}</span>
                </header>

                <div className="board__list">
                  {loading ? (
                    <div className="ticket skeleton" style={{ height: 180 }} />
                  ) : list.length === 0 ? (
                    <div className="board__empty">No tickets in {col.title.toLowerCase()}</div>
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
                            <div className="ticket__head-main">
                              <strong className="ticket__id">#{shortOrderId(o.id)}</strong>
                              <span className={`order-card__place ${tableOrder ? 'is-table' : 'is-delivery'}`}>
                                {tableOrder ? o.address : 'Delivery'}
                              </span>
                            </div>
                            <span className="ticket__time">{timeAgo(o.created_at)}</span>
                          </div>

                          <div className="ticket__meta-row">
                            <span className="ticket__who">{o.customer_name}</span>
                            <PaymentBadge order={o} />
                          </div>

                          {isFailedPayment && (
                            <div className="ticket__alert-banner ticket__alert-banner--failed">
                              <AlertIcon size={15} />
                              <span>Payment failed · Verify before preparing</span>
                            </div>
                          )}
                          {isAwaitingPayment && (
                            <div className="ticket__alert-banner ticket__alert-banner--pending">
                              <ClockIcon size={15} />
                              <span>Awaiting payment · Online checkout incomplete</span>
                            </div>
                          )}

                          <ul className="ticket__items">
                            {o.items.map((it, i) => (
                              <li key={`${it.id}-${i}`}>
                                <span className="ticket__qty">{it.quantity}×</span>
                                <div className="ticket__item-detail">
                                  <span className="ticket__item-name">{it.name}</span>
                                  {it.modifier && <span className="ticket__item-mod">{it.modifier}</span>}
                                </div>
                              </li>
                            ))}
                          </ul>

                          {o.notes && (
                            <p className="ticket__notes">
                              <strong>Note:</strong> {o.notes}
                            </p>
                          )}

                          <div className="ticket__actions">
                            {col.prev && (
                              <button
                                className="btn btn--ghost btn--sm ticket__back-btn"
                                onClick={() => move(o, col.prev!)}
                                aria-label="Move back to previous stage"
                                title="Return to previous stage"
                              >
                                Undo
                              </button>
                            )}
                            {col.next && (
                              <button
                                className={`btn btn--block btn--go-${col.next} ${
                                  col.next === 'preparing' && isFailedPayment
                                    ? 'btn--go-preparing-warn'
                                    : col.next === 'preparing' && isAwaitingPayment
                                    ? 'btn--go-preparing-amber'
                                    : ''
                                }`}
                                onClick={() => move(o, col.next!)}
                              >
                                {col.next === 'preparing' && isFailedPayment
                                  ? 'Start prep (Payment failed)'
                                  : col.next === 'preparing' && isAwaitingPayment
                                  ? 'Start prep (Awaiting payment)'
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
              <h2>Menu Availability (86 List)</h2>
              <p>Click any dish to toggle stock status on the customer menu immediately.</p>
            </div>
          </header>

          {menuLoading ? (
            <div className="kitchen-stock__grid">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="kitchen-dish skeleton" style={{ height: 76 }} />
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
                          {dish.available ? 'In stock' : 'Sold out'}
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
            style={{ maxWidth: 480 }}
          >
            <div className="modal__header">
              <h2 style={{ color: warnOrder.type === 'failed' ? 'var(--bad)' : 'var(--warn)' }}>
                {warnOrder.type === 'failed' ? 'Payment Failed Warning' : 'Awaiting Payment Warning'}
              </h2>
              <button className="icon-btn" onClick={() => setWarnOrder(null)} aria-label="Close">
                <CloseIcon />
              </button>
            </div>
            <div className="modal__body stack">
              <div
                className={`alert ${warnOrder.type === 'failed' ? 'alert--error' : 'alert--warn'}`}
                style={{ padding: '14px 16px', fontSize: '0.94rem', lineHeight: '1.5' }}
              >
                {warnOrder.type === 'failed' ? (
                  <>
                    <strong style={{ display: 'block', marginBottom: '4px' }}>
                      Online payment for this ticket was declined.
                    </strong>
                    Ticket <strong>#{shortOrderId(warnOrder.order.id)}</strong> ({warnOrder.order.customer_name},{' '}
                    <strong>{formatPrice(warnOrder.order.total)}</strong>) shows a failed payment status.
                  </>
                ) : (
                  <>
                    <strong style={{ display: 'block', marginBottom: '4px' }}>
                      Online payment has not been completed yet.
                    </strong>
                    Ticket <strong>#{shortOrderId(warnOrder.order.id)}</strong> ({warnOrder.order.customer_name},{' '}
                    <strong>{formatPrice(warnOrder.order.total)}</strong>) is still awaiting customer payment.
                  </>
                )}
              </div>

              <p className="muted" style={{ fontSize: '0.88rem', lineHeight: '1.5' }}>
                Preparing an unpaid ticket may result in wasted inventory if the guest does not complete payment. Confirm with a manager or server before firing this order.
              </p>

              <div className="modal__footer" style={{ gap: '10px', marginTop: '8px' }}>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setWarnOrder(null)}
                >
                  Hold ticket
                </button>
                <button
                  type="button"
                  className={`btn ${warnOrder.type === 'failed' ? 'btn--danger' : 'btn--warn'}`}
                  onClick={() => {
                    const { order, status } = warnOrder
                    setWarnOrder(null)
                    proceedMove(order, status)
                  }}
                >
                  Start prep anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
