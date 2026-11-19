import { useEffect, useRef, useState } from 'react'
import {
  formatClock,
  formatCountdown,
  formatDayLabel,
  shiftDayKey,
  useBusinessDay,
  useMidnightCountdown,
} from '../lib/businessDay'
import { formatPrice, RESTAURANT_NAME } from '../lib/config'
import { downloadDayCsv, summariseDay, TENDER_LABELS, tenderOf, useDayOrders, type Tender } from '../lib/pos'
import { isTableOrder, ORDER_STATUSES, shortOrderId } from '../lib/types'
import { EmptyState } from './EmptyState'
import { ChevronLeftIcon, ChevronRightIcon, ClockIcon, DownloadIcon, PrinterIcon } from './Icons'
import { LiveDot } from './LiveDot'

const TENDER_ORDER: Tender[] = ['squad-paid', 'cash-settled', 'squad-pending', 'cash-open', 'squad-failed']

function MidnightCountdown() {
  const left = useMidnightCountdown()
  return (
    <span className="pos-countdown" title="All daily totals restart at 00:00 (WAT)">
      <ClockIcon size={14} />
      Day closes at 00:00 · <span className="mono">{formatCountdown(left)}</span>
    </span>
  )
}

export function DailyPosPanel() {
  const todayKey = useBusinessDay()
  // null = "follow today": the view rolls over to the new day automatically at 00:00.
  const [picked, setPicked] = useState<string | null>(null)
  const viewKey = picked ?? todayKey
  const isToday = viewKey === todayKey

  const [rolledFrom, setRolledFrom] = useState<string | null>(null)
  const prevToday = useRef(todayKey)
  useEffect(() => {
    if (prevToday.current !== todayKey) {
      setRolledFrom(prevToday.current)
      prevToday.current = todayKey
    }
  }, [todayKey])

  const { orders, loading, error, connected } = useDayOrders(viewKey, isToday)
  const s = summariseDay(orders)
  const peakHourValue = Math.max(...s.hourly, 1)
  const activeHours = s.hourly
    .map((v, h) => ({ h, v }))
    .filter(({ h, v }) => v > 0 || (h >= 8 && h <= 23))

  const goTo = (key: string) => setPicked(key >= todayKey ? null : key)

  const printReport = () => {
    document.body.classList.add('is-printing-pos')
    const cleanup = () => {
      document.body.classList.remove('is-printing-pos')
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    window.print()
  }

  return (
    <section className="pos">
      {rolledFrom && (
        <div className="alert alert--info pos-rollover" role="status">
          <span>
            New business day started at 00:00. Totals for {formatDayLabel(rolledFrom, 'short')} are closed and saved.
          </span>
          <span className="pos-rollover__actions">
            <button className="btn btn--ghost btn--xs" onClick={() => goTo(rolledFrom)}>
              View {formatDayLabel(rolledFrom, 'short')}
            </button>
            <button className="btn btn--text btn--xs" onClick={() => setRolledFrom(null)}>
              Dismiss
            </button>
          </span>
        </div>
      )}

      <div className="pos-toolbar no-print">
        <div className="pos-datebar">
          <button className="icon-btn" onClick={() => goTo(shiftDayKey(viewKey, -1))} aria-label="Previous day">
            <ChevronLeftIcon size={18} />
          </button>
          <input
            type="date"
            className="pos-datebar__input"
            value={viewKey}
            max={todayKey}
            onChange={(e) => e.target.value && goTo(e.target.value)}
            aria-label="Business day"
          />
          <button
            className="icon-btn"
            onClick={() => goTo(shiftDayKey(viewKey, 1))}
            disabled={isToday}
            aria-label="Next day"
          >
            <ChevronRightIcon size={18} />
          </button>
          {!isToday && (
            <button className="btn btn--ghost btn--sm" onClick={() => setPicked(null)}>
              Back to today
            </button>
          )}
        </div>

        <div className="pos-toolbar__right">
          {isToday ? (
            <>
              <MidnightCountdown />
              <LiveDot connected={connected} />
            </>
          ) : (
            <span className="badge badge--lg">Closed day</span>
          )}
          <button className="btn btn--ghost btn--sm" onClick={() => downloadDayCsv(viewKey, orders)} disabled={!orders.length}>
            <DownloadIcon size={14} /> CSV
          </button>
          <button className="btn btn--primary btn--sm" onClick={printReport} disabled={loading}>
            <PrinterIcon size={14} /> Print Z-report
          </button>
        </div>
      </div>

      <div className="pos-print">
        <header className="pos-head">
          <div>
            <span className="pos-head__eyebrow">{isToday ? 'Live business day' : 'End-of-day report'}</span>
            <h2 className="pos-head__title">{formatDayLabel(viewKey)}</h2>
            <p className="muted small">
              {RESTAURANT_NAME} · 00:00 – 23:59 WAT
              {s.firstOrderAt && s.lastOrderAt
                ? ` · First ticket ${formatClock(s.firstOrderAt)}, last ${formatClock(s.lastOrderAt)}`
                : ''}
            </p>
          </div>
        </header>

        {error && <p className="alert alert--error">{error}</p>}

        {loading ? (
          <div className="pos-kpis">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="pos-kpi skeleton" style={{ height: 86 }} />
            ))}
          </div>
        ) : (
          <>
            <div className="pos-kpis">
              <div className="pos-kpi pos-kpi--lead">
                <span className="pos-kpi__label">Gross sales</span>
                <strong className="pos-kpi__value">{formatPrice(s.gross)}</strong>
                <span className="pos-kpi__sub">{s.orderCount} orders · {s.itemsSold} items</span>
              </div>
              <div className="pos-kpi">
                <span className="pos-kpi__label">Collected</span>
                <strong className="pos-kpi__value text-ok">{formatPrice(s.collected)}</strong>
                <span className="pos-kpi__sub">Squad paid + settled cash</span>
              </div>
              <div className="pos-kpi">
                <span className="pos-kpi__label">Outstanding</span>
                <strong className="pos-kpi__value">{formatPrice(s.outstanding)}</strong>
                <span className="pos-kpi__sub">Awaiting Squad or open cash</span>
              </div>
              <div className="pos-kpi">
                <span className="pos-kpi__label">Average ticket</span>
                <strong className="pos-kpi__value">{formatPrice(s.avgTicket)}</strong>
                <span className="pos-kpi__sub">Across {s.orderCount} orders</span>
              </div>
              <div className="pos-kpi">
                <span className="pos-kpi__label">Declined</span>
                <strong className={`pos-kpi__value ${s.declinedCount ? 'text-bad' : ''}`}>{s.declinedCount}</strong>
                <span className="pos-kpi__sub">{formatPrice(s.declinedValue)} not counted</span>
              </div>
            </div>

            {orders.length === 0 ? (
              <EmptyState
                title={isToday ? 'No sales yet today' : 'No sales on this day'}
                message={
                  isToday
                    ? 'Orders placed after 00:00 will appear here instantly.'
                    : 'Pick another date to see its end-of-day report.'
                }
              />
            ) : (
              <>
                <div className="pos-split">
                  <div className="pos-card">
                    <h3 className="pos-card__title">Tender breakdown</h3>
                    <table className="pos-table">
                      <thead>
                        <tr>
                          <th>Tender</th>
                          <th className="num">Orders</th>
                          <th className="num">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {TENDER_ORDER.map((t) => (
                          <tr key={t} className={t === 'squad-failed' ? 'is-muted' : ''}>
                            <td>
                              <span className={`pos-tender pos-tender--${t}`} aria-hidden="true" />
                              {TENDER_LABELS[t]}
                            </td>
                            <td className="num">{s.tenders[t].count}</td>
                            <td className="num">{formatPrice(s.tenders[t].value)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>Gross (excl. declined)</td>
                          <td className="num">{s.orderCount}</td>
                          <td className="num">{formatPrice(s.gross)}</td>
                        </tr>
                      </tfoot>
                    </table>

                    <h3 className="pos-card__title pos-card__title--spaced">Channel</h3>
                    <div className="pos-channel">
                      <div
                        className="pos-channel__bar"
                        role="img"
                        aria-label={`Dine-in ${formatPrice(s.dineIn.value)}, delivery ${formatPrice(s.delivery.value)}`}
                      >
                        <span style={{ flexGrow: s.dineIn.value || 0.0001 }} className="pos-channel__seg is-dine" />
                        <span style={{ flexGrow: s.delivery.value || 0.0001 }} className="pos-channel__seg is-delivery" />
                      </div>
                      <div className="pos-channel__legend">
                        <span>
                          <i className="is-dine" /> Dine-in · {s.dineIn.count} · {formatPrice(s.dineIn.value)}
                        </span>
                        <span>
                          <i className="is-delivery" /> Delivery · {s.delivery.count} · {formatPrice(s.delivery.value)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="pos-card">
                    <h3 className="pos-card__title">Sales by hour</h3>
                    <div className="pos-hours" role="list">
                      {activeHours.map(({ h, v }) => (
                        <div key={h} className="pos-hours__row" role="listitem">
                          <span className="pos-hours__label mono">{String(h).padStart(2, '0')}:00</span>
                          <span className="pos-hours__track">
                            <span
                              className="pos-hours__fill"
                              style={{ transform: `scaleX(${v / peakHourValue})` }}
                            />
                          </span>
                          <span className="pos-hours__value mono">{v ? formatPrice(v) : '–'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pos-card">
                  <h3 className="pos-card__title">Item sales</h3>
                  <table className="pos-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th className="num">Qty</th>
                        <th className="num">Revenue</th>
                        <th className="num">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.items.map((it) => (
                        <tr key={it.name}>
                          <td>{it.name}</td>
                          <td className="num">{it.qty}</td>
                          <td className="num">{formatPrice(it.revenue)}</td>
                          <td className="num muted">
                            {s.gross ? Math.round((it.revenue / s.gross) * 100) : 0}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="pos-card">
                  <h3 className="pos-card__title">
                    Order ledger <span className="muted">({orders.length})</span>
                  </h3>
                  <div className="pos-table-scroll">
                    <table className="pos-table pos-table--ledger">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Ticket</th>
                          <th>Customer</th>
                          <th>Channel</th>
                          <th>Tender</th>
                          <th>Status</th>
                          <th className="num">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...orders].reverse().map((o) => {
                          const tender = tenderOf(o)
                          return (
                            <tr key={o.id} className={tender === 'squad-failed' ? 'is-muted' : ''}>
                              <td className="mono">{formatClock(o.created_at)}</td>
                              <td className="mono">#{shortOrderId(o.id)}</td>
                              <td>{o.customer_name}</td>
                              <td>{isTableOrder(o.address) ? o.address : 'Delivery'}</td>
                              <td>
                                <span className={`pos-tender pos-tender--${tender}`} aria-hidden="true" />
                                {TENDER_LABELS[tender]}
                              </td>
                              <td>{ORDER_STATUSES.find((x) => x.value === o.status)?.label}</td>
                              <td className="num">{formatPrice(Number(o.total))}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            <p className="pos-footnote muted small">
              Business day window: 00:00 – 23:59 WAT ({formatDayLabel(viewKey, 'short')}).
              Cash counts as collected once the order is marked delivered. Declined Squad payments are excluded from gross sales.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
