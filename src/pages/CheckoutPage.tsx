import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { ArrowLeftIcon, CardIcon, CashIcon, CheckIcon, MinusIcon, PlusIcon } from '../components/Icons'
import { OrderItemsList } from '../components/OrderItemsList'
import { PaymentBadge } from '../components/PaymentBadge'
import { useCart } from '../lib/cart'
import { formatPrice } from '../lib/config'
import { formatTableLabel, saveLinkContext, syncLinkContextFromUrl } from '../lib/orderContext'
import { placeOrder, verifyPayment, type CustomerDetails } from '../lib/orders'
import { isSquadConfigured, makeSquadReference, payWithSquad } from '../lib/squad'
import { supabase } from '../lib/supabase'
import {
  isTableOrder,
  shortOrderId,
  type CartLine,
  type OrderItem,
  type OrderStatus,
  type PaymentMethod,
  type RestaurantTable,
} from '../lib/types'

type Step = 'details' | 'payment' | 'processing' | 'retry' | 'done'
type SplitMode = 'single' | 'equal' | 'items'

export interface SplitShare {
  name: string
  amount: number
  itemsLabel?: string
  paidOnline?: boolean
}

interface PlacedOrder {
  id: string
  items: OrderItem[]
  total: number
  method: PaymentMethod
  paid: boolean
  details: CustomerDetails
  splitShares?: SplitShare[]
}

const SPICE_LEVELS = [
  { id: 'No Pepper', icon: '🌱', label: 'No Pepper', desc: 'Zero chilli' },
  { id: 'Mild Spice', icon: '🌶️', label: 'Mild', desc: 'Gentle warmth' },
  { id: 'Medium Spice', icon: '🌶️🌶️', label: 'Medium', desc: 'House standard' },
  { id: 'Extra Spicy (Fiery)', icon: '🔥', label: 'Fiery', desc: 'Extra habanero' },
] as const

const COMMON_ALLERGIES = [
  { id: 'Peanuts / Groundnut', icon: '🥜', label: 'Peanuts / Groundnut' },
  { id: 'Shellfish / Crayfish', icon: '🦐', label: 'Shellfish / Crayfish' },
  { id: 'Fish', icon: '🐟', label: 'Fish' },
  { id: 'Dairy / Milk', icon: '🥛', label: 'Dairy / Milk' },
  { id: 'Eggs', icon: '🥚', label: 'Eggs' },
  { id: 'Tree Nuts', icon: '🌰', label: 'Tree Nuts' },
  { id: 'Gluten / Wheat', icon: '🌾', label: 'Gluten / Wheat' },
  { id: 'Soy', icon: '🫘', label: 'Soy' },
] as const

const PLACED_KEY = 'menu-app-placed-order'
const NAME_KEY = 'menu-app-customer-name'

function loadPlaced(): PlacedOrder | null {
  try {
    const raw = sessionStorage.getItem(PLACED_KEY)
    return raw ? (JSON.parse(raw) as PlacedOrder) : null
  } catch {
    return null
  }
}

async function refreshLines(lines: CartLine[]): Promise<{ lines: CartLine[]; total: number; error: string | null }> {
  const { data, error } = await supabase
    .from('menu_items')
    .select('id, name, price, available')
    .in('id', lines.map((l) => l.id))
  if (error) return { lines, total: 0, error: error.message }

  const byId = new Map((data ?? []).map((d) => [d.id as string, d]))
  const fresh: CartLine[] = []
  for (const l of lines) {
    const m = byId.get(l.id)
    if (!m) return { lines, total: 0, error: `"${l.name}" is no longer on the menu. Please remove it from your cart.` }
    if (!m.available) return { lines, total: 0, error: `Sorry, "${m.name}" just sold out. Please remove it from your cart.` }
    fresh.push({ ...l, name: m.name, price: Number(m.price) })
  }
  return { lines: fresh, total: fresh.reduce((s, l) => s + l.price * l.quantity, 0), error: null }
}

export function CheckoutPage() {
  const { lines, total, clear, setQuantity, openCart } = useCart()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const linkCtx = syncLinkContextFromUrl(pathname, search)
  const isDelivery = linkCtx.mode === 'delivery'

  const initialPlaced = loadPlaced()
  const [placed, setPlaced] = useState<PlacedOrder | null>(initialPlaced)
  const [step, setStep] = useState<Step>(
    initialPlaced ? (initialPlaced.paid || initialPlaced.method === 'cash' ? 'done' : 'retry') : 'details',
  )

  const [customerName, setCustomerName] = useState(() => localStorage.getItem(NAME_KEY) ?? '')
  const [tableInput, setTableInput] = useState(linkCtx.tableCode ?? '1')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [spiceLevel, setSpiceLevel] = useState<string>('Medium Spice')
  const [selectedAllergies, setSelectedAllergies] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [tables, setTables] = useState<RestaurantTable[]>([])

  // Split payment state (for 2 or more people paying)
  const [splitMode, setSplitMode] = useState<SplitMode>('single')
  const [payerCount, setPayerCount] = useState(2)
  const [payerNames, setPayerNames] = useState<string[]>(['Person 1', 'Person 2'])
  // Maps cart line id -> payer index (0..payerCount-1) when splitMode === 'items'
  const [linePayerMap, setLinePayerMap] = useState<Record<string, number>>({})

  const [busy, setBusy] = useState<PaymentMethod | null>(null)
  const [payingShareIdx, setPayingShareIdx] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryMessage, setRetryMessage] = useState<string>('')
  const [lastReference, setLastReference] = useState<string | null>(null)

  // Load configured restaurant tables if customer arrived without a specific ?table= parameter
  useEffect(() => {
    if (isDelivery || linkCtx.tableCode) return
    let active = true
    supabase
      .from('restaurant_tables')
      .select('*')
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!active || !data) return
        setTables(data as RestaurantTable[])
        if (data.length > 0) setTableInput((prev) => prev || data[0].code)
      })
    return () => {
      active = false
    }
  }, [isDelivery, linkCtx.tableCode])

  useEffect(() => {
    if (placed) sessionStorage.setItem(PLACED_KEY, JSON.stringify(placed))
    else sessionStorage.removeItem(PLACED_KEY)
  }, [placed])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  const changePayerCount = (nextCount: number) => {
    const clamped = Math.min(Math.max(nextCount, 2), 10)
    setPayerCount(clamped)
    setPayerNames((prev) =>
      Array.from({ length: clamped }, (_, i) =>
        i === 0 && customerName.trim() ? customerName.trim() : prev[i] || `Person ${i + 1}`,
      ),
    )
  }

  const updatePayerName = (index: number, value: string) => {
    setPayerNames((prev) => prev.map((n, i) => (i === index ? value : n)))
  }

  // Compute each person's share when splitting equally or by food items
  const splitShares = useMemo<SplitShare[]>(() => {
    if (splitMode === 'single') return []
    const names = Array.from({ length: payerCount }, (_, i) =>
      (payerNames[i] ?? '').trim() || (i === 0 && customerName.trim() ? customerName.trim() : `Person ${i + 1}`),
    )

    if (splitMode === 'equal') {
      const base = Math.floor((total * 100) / payerCount) / 100
      const remainder = Math.round((total - base * payerCount) * 100) / 100
      return names.map((name, i) => ({
        name,
        amount: i === 0 ? base + remainder : base,
        itemsLabel: `Equal share (1/${payerCount})`,
      }))
    }

    // splitMode === 'items'
    return names.map((name, i) => {
      const assigned = lines.filter((l, idx) => (linePayerMap[l.id] ?? idx % payerCount) === i)
      const amount = assigned.reduce((sum, l) => sum + l.price * l.quantity, 0)
      const itemsLabel =
        assigned.length > 0 ? assigned.map((l) => `${l.quantity}× ${l.name}`).join(', ') : 'No dish assigned'
      return { name, amount, itemsLabel }
    })
  }, [splitMode, payerCount, payerNames, customerName, total, lines, linePayerMap])

  const activeTableCode = linkCtx.tableCode ?? tableInput.trim()

  const toggleAllergy = (allergy: string) => {
    setSelectedAllergies((prev) =>
      prev.includes(allergy) ? prev.filter((a) => a !== allergy) : [...prev, allergy],
    )
  }

  const structuredNotes = [
    spiceLevel ? `Spice: ${spiceLevel}` : '',
    selectedAllergies.length > 0 ? `ALLERGIES: ${selectedAllergies.join(', ')}` : 'Allergies: None',
    notes.trim(),
  ]
    .filter(Boolean)
    .join(' · ')

  const baseDetails: CustomerDetails = {
    customer_name: customerName.trim(),
    address: isDelivery ? `Delivery: ${deliveryAddress.trim()}` : formatTableLabel(activeTableCode),
    notes: structuredNotes,
  }

  const submitDetails = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!customerName.trim()) return setError('Please enter your name.')
    if (isDelivery && deliveryAddress.trim().length < 5) {
      return setError('Please enter your delivery address.')
    }
    if (!isDelivery && !activeTableCode) {
      return setError('Please select or enter your table number.')
    }
    if (!isDelivery && !linkCtx.tableCode) {
      saveLinkContext({ mode: 'table', tableCode: activeTableCode })
    }
    setPayerNames((prev) => [customerName.trim(), ...prev.slice(1)])
    localStorage.setItem(NAME_KEY, customerName.trim())
    setStep('payment')
  }

  // -------- Payment --------

  async function runSquad(order: PlacedOrder, existingRef?: string | null) {
    setStep('processing')
    setError(null)
    const reference = existingRef || makeSquadReference(order.id)
    setLastReference(reference)

    const result = await payWithSquad({
      email: `order-${order.id.slice(0, 8).toLowerCase()}@creedlabs.kitchen`,
      amountNaira: order.total,
      reference,
      orderId: order.id,
      name: order.details.customer_name,
    })

    if (result.outcome === 'cancelled') {
      setRetryMessage('The payment window was closed before payment completed.')
      setLastReference(null)
      setStep('retry')
      return
    }
    if (result.outcome === 'error') {
      setRetryMessage(result.message)
      setLastReference(null)
      setStep('retry')
      return
    }
    await confirmPayment(order, result.reference)
  }

  async function payIndividualShareWithSquad(shareIndex: number) {
    if (!placed?.splitShares) return
    const share = placed.splitShares[shareIndex]
    if (!share || share.amount <= 0 || share.paidOnline) return

    setError(null)
    setPayingShareIdx(shareIndex)
    try {
      const reference = `${makeSquadReference(placed.id)}-P${shareIndex + 1}`
      const result = await payWithSquad({
        email: `order-${placed.id.slice(0, 8).toLowerCase()}-p${shareIndex + 1}@creedlabs.kitchen`,
        amountNaira: share.amount,
        reference,
        orderId: placed.id,
        name: share.name,
        })

      if (result.outcome === 'success') {
        const updatedShares = placed.splitShares.map((s, idx) =>
          idx === shareIndex ? { ...s, paidOnline: true } : s,
        )
        const allPaid = updatedShares.filter((s) => s.amount > 0).every((s) => s.paidOnline)
        setPlaced({ ...placed, paid: allPaid || placed.paid, splitShares: updatedShares })
      } else if (result.outcome === 'error') {
        setError(result.message)
      }
    } finally {
      setPayingShareIdx(null)
    }
  }

  async function confirmPayment(order: PlacedOrder, reference: string) {
    setStep('processing')
    const { ok, error: verifyError } = await verifyPayment(order.id, reference)
    if (ok) {
      setPlaced({
        ...order,
        paid: true,
        splitShares: order.splitShares?.map((s) => ({ ...s, paidOnline: true })),
      })
      setStep('done')
    } else {
      setRetryMessage(`We couldn't confirm your payment yet: ${verifyError}`)
      setStep('retry')
    }
  }

  async function choose(method: PaymentMethod) {
    setError(null)
    if (splitMode === 'items' && splitShares.every((s) => s.amount === 0)) {
      return setError('Please assign at least one dish to a person.')
    }
    setBusy(method)
    try {
      const fresh = await refreshLines(lines)
      if (fresh.error) {
        setError(fresh.error)
        return
      }

      // Append split bill summary to notes so kitchen & waiter see each person's share
      const splitSummary =
        splitMode !== 'single' && splitShares.length > 0
          ? `Split bill (${splitShares.length} people): ` +
            splitShares.map((s) => `${s.name} ${formatPrice(s.amount)}`).join(' | ')
          : ''
      const combinedNotes = [baseDetails.notes, splitSummary].filter(Boolean).join(' · ')
      const finalDetails: CustomerDetails = { ...baseDetails, notes: combinedNotes }

      const { id, reference: initialRef, error: placeError } = await placeOrder(finalDetails, fresh.lines, method)
      if (placeError) {
        setError(placeError)
        return
      }

      const order: PlacedOrder = {
        id,
        items: fresh.lines.map(({ id: itemId, name, price, quantity }) => ({ id: itemId, name, price, quantity })),
        total: fresh.total,
        method,
        paid: false,
        details: finalDetails,
        splitShares: splitMode !== 'single' ? splitShares : undefined,
      }
      setPlaced(order)
      clear()

      if (method === 'cash') setStep('done')
      else await runSquad(order, initialRef)
    } finally {
      setBusy(null)
    }
  }

  const finish = () => {
    setPlaced(null)
    navigate('/')
  }

  // -------- Render --------

  if (!placed && lines.length === 0) {
    return (
      <main className="container checkout">
        <EmptyState
          icon="🛒"
          title="Your cart is empty"
          message="Pick a few dishes from the menu, then come back here to check out."
          action={
            <Link className="btn btn--primary" to="/">
              Browse the menu
            </Link>
          }
        />
      </main>
    )
  }

  return (
    <main className="container checkout">
      {!placed && <Stepper step={step} />}

      {step === 'details' && (
        <section className="card">
          <div className="card__head">
            <button
              className="icon-btn"
              onClick={() => {
                navigate('/')
                openCart()
              }}
              aria-label="Back to cart"
            >
              <ArrowLeftIcon />
            </button>
            <h1>Your order details</h1>
          </div>

          <div className={`context-banner ${isDelivery ? 'context-banner--delivery' : ''}`}>
            {isDelivery ? (
              <>
                <span className="context-banner__icon">🛵</span>
                <div>
                  <strong>Delivery Order</strong>
                  <small>Your food will be prepared fresh and delivered to your address.</small>
                </div>
              </>
            ) : linkCtx.tableCode ? (
              <>
                <span className="context-banner__icon">🍽️</span>
                <div>
                  <strong>{formatTableLabel(linkCtx.tableCode)}</strong>
                  <small>Table linked via NFC / QR — we'll bring your order right to your table.</small>
                </div>
              </>
            ) : (
              <>
                <span className="context-banner__icon">🍽️</span>
                <div>
                  <strong>Dine-in Table Order</strong>
                  <small>Select your table below and we'll serve you right at your seat.</small>
                </div>
              </>
            )}
          </div>

          <OrderSummary lines={lines} total={total} onQty={setQuantity} onAddMore={() => navigate('/')} />

          <form className="form" onSubmit={submitDetails}>
            {!isDelivery && !linkCtx.tableCode && (
              <label className="field">
                <span>Table</span>
                {tables.length > 0 ? (
                  <select value={tableInput} onChange={(e) => setTableInput(e.target.value)}>
                    {tables.map((t) => (
                      <option key={t.id} value={t.code}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    required
                    maxLength={20}
                    placeholder="e.g. 4"
                    value={tableInput}
                    onChange={(e) => setTableInput(e.target.value)}
                  />
                )}
              </label>
            )}

            <label className="field">
              <span>Your name</span>
              <input
                autoComplete="name"
                required
                maxLength={120}
                placeholder="e.g. Tunde (or group table name)"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </label>

            {isDelivery && (
              <label className="field">
                <span>Delivery address</span>
                <textarea
                  autoComplete="street-address"
                  required
                  rows={2}
                  maxLength={400}
                  placeholder="House number, street, area, landmark"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                />
              </label>
            )}

            {/* Spice Level Selector */}
            <div className="checkout-panel">
              <div className="checkout-panel__head">
                <strong>🌶️ Choose Spice Level</strong>
                <small className="muted">How spicy should the kitchen make your order?</small>
              </div>
              <div className="spice-grid" role="radiogroup" aria-label="Spice level">
                {SPICE_LEVELS.map((sp) => {
                  const active = spiceLevel === sp.id
                  return (
                    <button
                      key={sp.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`spice-btn ${active ? 'is-active' : ''}`}
                      onClick={() => setSpiceLevel(sp.id)}
                    >
                      <span className="spice-btn__icon">{sp.icon}</span>
                      <strong>{sp.label}</strong>
                      <small>{sp.desc}</small>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Allergies Panel */}
            <div className="checkout-panel checkout-panel--allergy">
              <div className="checkout-panel__head">
                <strong>⚠️ Allergies & Dietary Restrictions</strong>
                <small className="muted">
                  Tap any ingredient the kitchen must avoid for your table:
                </small>
              </div>
              <div className="allergy-grid" role="group" aria-label="Common food allergies">
                <button
                  type="button"
                  className={`allergy-chip ${selectedAllergies.length === 0 ? 'is-safe' : ''}`}
                  onClick={() => setSelectedAllergies([])}
                >
                  ✓ No allergies
                </button>
                {COMMON_ALLERGIES.map((al) => {
                  const active = selectedAllergies.includes(al.id)
                  return (
                    <button
                      key={al.id}
                      type="button"
                      aria-pressed={active}
                      className={`allergy-chip ${active ? 'is-active' : ''}`}
                      onClick={() => toggleAllergy(al.id)}
                    >
                      <span>{al.icon}</span> {al.label}
                    </button>
                  )
                })}
              </div>
              {selectedAllergies.length > 0 && (
                <div className="allergy-alert">
                  ⚠️ Kitchen alert: <strong>Avoid {selectedAllergies.join(', ')}</strong>
                </div>
              )}
              <label className="field" style={{ marginTop: 6 }}>
                <span>
                  Other allergy or special instructions <small className="muted">(optional)</small>
                </span>
                <textarea
                  rows={2}
                  maxLength={500}
                  placeholder="e.g. No onions, sauce on the side, extra plantain…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
            </div>

            {error && <p className="alert alert--error">{error}</p>}

            <button type="submit" className="btn btn--primary btn--lg btn--block">
              Continue to payment · {formatPrice(total)}
            </button>
          </form>
        </section>
      )}

      {step === 'payment' && (
        <section className="card">
          <div className="card__head">
            <button className="icon-btn" onClick={() => setStep('details')} aria-label="Back to details" disabled={!!busy}>
              <ArrowLeftIcon />
            </button>
            <h1>Payment & Split Bill</h1>
          </div>

          <div className="pay-total">
            <span>{baseDetails.address} · Total</span>
            <strong>{formatPrice(total)}</strong>
          </div>

          {/* Group / Multi-payer selector */}
          <div className="split-box">
            <div className="split-box__label">How many people are paying?</div>
            <div className="segmented segmented--3" role="radiogroup" aria-label="Split bill mode">
              <button
                type="button"
                className={splitMode === 'single' ? 'is-active' : ''}
                onClick={() => setSplitMode('single')}
              >
                👤 1 Person
              </button>
              <button
                type="button"
                className={splitMode === 'equal' ? 'is-active' : ''}
                onClick={() => setSplitMode('equal')}
              >
                👥 Split Equally
              </button>
              <button
                type="button"
                className={splitMode === 'items' ? 'is-active' : ''}
                onClick={() => setSplitMode('items')}
              >
                🍽️ Split by Dish
              </button>
            </div>

            {splitMode !== 'single' && (
              <div className="split-box__body">
                <div className="split-count-row">
                  <span>Number of people paying</span>
                  <div className="stepper stepper--sm">
                    <button type="button" onClick={() => changePayerCount(payerCount - 1)} aria-label="Fewer people">
                      <MinusIcon size={14} />
                    </button>
                    <span>{payerCount}</span>
                    <button type="button" onClick={() => changePayerCount(payerCount + 1)} aria-label="More people">
                      <PlusIcon size={14} />
                    </button>
                  </div>
                </div>

                {splitMode === 'items' && (
                  <div className="split-items-assign">
                    <small className="muted">Tap who ordered each dish:</small>
                    {lines.map((l, idx) => {
                      const assignedIdx = linePayerMap[l.id] ?? idx % payerCount
                      return (
                        <div key={l.id} className="split-item-row">
                          <span className="split-item-row__dish">
                            <strong>{l.quantity}×</strong> {l.name} ({formatPrice(l.price * l.quantity)})
                          </span>
                          <div className="split-item-row__pills">
                            {Array.from({ length: payerCount }, (_, pIdx) => (
                              <button
                                key={pIdx}
                                type="button"
                                className={`chip chip--xs ${assignedIdx === pIdx ? 'is-active' : ''}`}
                                onClick={() => setLinePayerMap((prev) => ({ ...prev, [l.id]: pIdx }))}
                              >
                                {(payerNames[pIdx] || `P${pIdx + 1}`).slice(0, 12)}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="split-shares">
                  {splitShares.map((s, i) => (
                    <div key={i} className="split-share-row">
                      <input
                        className="split-share-row__input"
                        value={payerNames[i] ?? s.name}
                        onChange={(e) => updatePayerName(i, e.target.value)}
                        aria-label={`Payer ${i + 1} name`}
                        placeholder={`Person ${i + 1}`}
                      />
                      <div className="split-share-row__right">
                        <small className="muted">{s.itemsLabel}</small>
                        <strong>{formatPrice(s.amount)}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="pay-options">
            <button
              className="pay-option pay-option--primary"
              onClick={() => choose('squad')}
              disabled={!!busy || !isSquadConfigured()}
            >
              <CardIcon size={28} />
              <span className="pay-option__text">
                <strong>
                  {busy === 'squad'
                    ? 'Placing order…'
                    : splitMode === 'single'
                      ? 'Pay now with Squad'
                      : 'Pay with Squad (Online)'}
                </strong>
                <small>
                  {isDelivery
                    ? 'Pay online now with Squad (Card, Bank Transfer or USSD) for delivery'
                    : 'Pay online now with Squad (Card, Bank Transfer or USSD) at your table'}
                </small>
              </span>
            </button>
            <button className="pay-option" onClick={() => choose('cash')} disabled={!!busy}>
              <CashIcon size={28} />
              <span className="pay-option__text">
                <strong>
                  {busy === 'cash'
                    ? 'Placing order…'
                    : splitMode !== 'single'
                      ? isDelivery
                        ? `Split bill (${payerCount} people — Squad or Pay on delivery)`
                        : `Split bill (${payerCount} people — Squad or Pay at table)`
                      : isDelivery
                        ? 'Pay on delivery (or later)'
                        : 'Pay at the table (Cash / POS / Transfer)'}
                </strong>
                <small>
                  {splitMode !== 'single'
                    ? 'Each person can pay their share online with Squad or when served/delivered'
                    : isDelivery
                      ? 'Pay with cash, POS card or bank transfer when your delivery arrives'
                      : 'Pay with cash, POS card or bank transfer right at your table'}
                </small>
              </span>
            </button>
          </div>

          {!isSquadConfigured() && (
            <p className="alert alert--info">Online payment is not configured yet (missing VITE_SQUAD_PUBLIC_KEY).</p>
          )}
          {error && <p className="alert alert--error">{error}</p>}

          <p className="muted small center">Your order is sent to the kitchen right after you choose a payment option.</p>
        </section>
      )}

      {step === 'processing' && (
        <section className="card center">
          <div className="spinner spinner--lg" />
          <h2>Processing payment…</h2>
          <p className="muted">Complete the payment in the Squad window. Please don't close this page.</p>
        </section>
      )}

      {step === 'retry' && placed && (
        <section className="card">
          <div className="result-icon result-icon--warn">!</div>
          <h1 className="center">Payment not completed</h1>
          <p className="center muted">{retryMessage || 'Your payment did not go through.'}</p>
          <div className="notice">
            Order <strong>#{shortOrderId(placed.id)}</strong> is saved and marked <strong>payment pending</strong>. You can try again now.
          </div>
          <div className="pay-total">
            <span>Amount due</span>
            <strong>{formatPrice(placed.total)}</strong>
          </div>
          <div className="stack">
            {lastReference && (
              <button className="btn btn--ghost btn--lg btn--block" onClick={() => confirmPayment(placed, lastReference)}>
                I've paid — check again
              </button>
            )}
            <button className="btn btn--primary btn--lg btn--block" onClick={() => runSquad(placed)}>
              Retry payment with Squad
            </button>
            <button className="btn btn--text btn--block" onClick={finish}>
              Back to menu
            </button>
          </div>
        </section>
      )}

      {step === 'done' && placed && (
        <section className="card confirmation">
          <div className="result-icon">
            <CheckIcon size={36} />
          </div>
          <h1 className="center">Order placed!</h1>
          <p className="center muted">
            Thank you, {placed.details.customer_name}. The kitchen has received your order.
          </p>

          <div className="confirmation__meta">
            <div>
              <small>Order number</small>
              <strong>#{shortOrderId(placed.id)}</strong>
            </div>
            <div>
              <small>Payment</small>
              <PaymentBadge
                order={{
                  payment_method: placed.method,
                  payment_status: placed.paid ? 'paid' : 'pending',
                  address: placed.details.address,
                }}
              />
            </div>
          </div>

          <LiveOrderTracker orderId={placed.id} />

          <OrderItemsList items={placed.items} />
          <div className="total-row total-row--border">
            <span>Total</span>
            <strong>{formatPrice(placed.total)}</strong>
          </div>

          {/* Individual share payments when 2+ people split the bill */}
          {placed.splitShares && placed.splitShares.length > 0 && (
            <div className="split-done-box">
              <h3>👥 Group Split Breakdown ({placed.splitShares.length} people)</h3>
              <p className="muted small">
                Each person can pay their share below with Squad or settle at the table with POS / transfer / cash.
              </p>
              <div className="split-done-list">
                {placed.splitShares.map((s, idx) => (
                  <div key={idx} className="split-done-row">
                    <div>
                      <strong>{s.name}</strong>
                      {s.itemsLabel && <small className="muted block">{s.itemsLabel}</small>}
                    </div>
                    <div className="split-done-row__actions">
                      <strong>{formatPrice(s.amount)}</strong>
                      {s.paidOnline || placed.paid ? (
                        <span className="badge badge--paid">Paid</span>
                      ) : isSquadConfigured() && s.amount > 0 ? (
                        <button
                          type="button"
                          className="btn btn--primary btn--xs"
                          disabled={payingShareIdx !== null}
                          onClick={() => payIndividualShareWithSquad(idx)}
                        >
                          {payingShareIdx === idx ? 'Opening…' : 'Pay share with Squad'}
                        </button>
                      ) : (
                        <span className="badge badge--cash">{isDelivery ? "Pay on delivery" : "Pay at table"}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {placed.details.notes && (
            <div className="notice">
              <strong>Notes & details:</strong> {placed.details.notes}
            </div>
          )}

          {error && <p className="alert alert--error">{error}</p>}

          <p className="muted small center">
            {isTableOrder(placed.details.address)
              ? `🍽️ Serving to ${placed.details.address}`
              : `🛵 ${placed.details.address}`}
          </p>

          <button className="btn btn--primary btn--lg btn--block" onClick={finish}>
            Order more / Back to menu
          </button>
        </section>
      )}
    </main>
  )
}

function Stepper({ step }: { step: Step }) {
  const steps = ['Cart', 'Details', 'Payment']
  const index = step === 'details' ? 1 : 2
  return (
    <ol className="stepper-nav" aria-label="Checkout progress">
      {steps.map((s, i) => (
        <li key={s} className={i < index ? 'is-done' : i === index ? 'is-current' : ''}>
          <span>{i < index ? '✓' : i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  )
}

function OrderSummary({
  lines,
  total,
  onQty,
  onAddMore,
}: {
  lines: CartLine[]
  total: number
  onQty: (id: string, q: number) => void
  onAddMore: () => void
}) {
  return (
    <details className="summary" open>
      <summary>
        <span>
          {lines.length} {lines.length === 1 ? 'dish' : 'different dishes'} ({lines.reduce((n, l) => n + l.quantity, 0)} items)
        </span>
        <strong>{formatPrice(total)}</strong>
      </summary>
      <ul className="order-items">
        {lines.map((l) => (
          <li key={l.id}>
            <span className="order-items__qty">{l.quantity}×</span>
            <span className="order-items__name">{l.name}</span>
            <span className="order-items__price">{formatPrice(l.price * l.quantity)}</span>
            <button type="button" className="btn btn--text btn--xs" onClick={() => onQty(l.id, 0)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="summary__footer">
        <button type="button" className="btn btn--ghost btn--xs" onClick={onAddMore}>
          + Add another dish, protein or drink
        </button>
      </div>
    </details>
  )
}
const LIVE_STEPS: { key: OrderStatus; label: string; sub: string }[] = [
  { key: 'new', label: 'Order received', sub: 'Sent to the kitchen' },
  { key: 'preparing', label: 'Cooking now', sub: 'Chefs are preparing your food' },
  { key: 'ready', label: 'Ready!', sub: 'Heading to your table / rider' },
  { key: 'delivered', label: 'Served', sub: 'Enjoy your meal!' },
]

function LiveOrderTracker({ orderId }: { orderId: string }) {
  const [status, setStatus] = useState<OrderStatus>('new')

  useEffect(() => {
    let active = true
    supabase
      .from('order_tracking')
      .select('status')
      .eq('id', orderId)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data?.status) setStatus(data.status as OrderStatus)
      })

    const channel = supabase
      .channel(`order-track-${orderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_tracking', filter: `id=eq.${orderId}` },
        (payload) => {
          const row = payload.new as { status?: OrderStatus } | undefined
          if (row?.status) {
            setStatus(row.status)
            if ('vibrate' in navigator) navigator.vibrate?.([150, 80, 150])
          }
        },
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [orderId])

  const activeIdx = Math.max(
    0,
    LIVE_STEPS.findIndex((s) => s.key === status),
  )

  return (
    <div className="live-tracker" aria-live="polite">
      <div className="live-tracker__head">
        <strong>Kitchen Progress</strong>
        <span className="live is-live">
          <span className="live__dot" /> Live updates
        </span>
      </div>
      <ol className="live-tracker__steps">
        {LIVE_STEPS.map((st, idx) => {
          const state = idx < activeIdx ? 'is-done' : idx === activeIdx ? 'is-current' : ''
          return (
            <li key={st.key} className={`live-tracker__step ${state}`}>
              <span className="live-tracker__dot">{idx < activeIdx ? '✓' : idx + 1}</span>
              <div>
                <strong>{st.label}</strong>
                <small>{st.sub}</small>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
