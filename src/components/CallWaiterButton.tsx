import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { formatTableLabel, syncLinkContextFromUrl } from '../lib/orderContext'
import { sendWaiterCall, useCallWaiterSetting, WAITER_REASONS } from '../lib/waiter'
import { BellIcon, CheckIcon, CloseIcon } from './Icons'

export function CallWaiterButton() {
  const { callWaiterEnabled } = useCallWaiterSetting()
  const { pathname, search } = useLocation()
  const linkCtx = syncLinkContextFromUrl(pathname, search)

  const [open, setOpen] = useState(false)
  const [tableInput, setTableInput] = useState(linkCtx.tableCode ?? '1')
  const [busy, setBusy] = useState(false)
  const [sentReason, setSentReason] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Hidden if Admin turned off Call Waiter or if customer is on a delivery link
  if (!callWaiterEnabled || linkCtx.mode === 'delivery') return null

  const tableLabel = formatTableLabel(linkCtx.tableCode ?? tableInput)

  const triggerCall = async (reason: string) => {
    setBusy(true)
    setError(null)
    const err = await sendWaiterCall({
      table_label: tableLabel,
      reason,
      customer_name: localStorage.getItem('menu-app-customer-name') ?? '',
    })
    setBusy(false)
    if (err) {
      setError(err)
      return
    }
    setSentReason(reason)
    setTimeout(() => {
      setSentReason(null)
      setOpen(false)
    }, 1800)
  }

  return (
    <>
      <button
        type="button"
        className="waiter-trigger"
        onClick={() => {
          setError(null)
          setSentReason(null)
          setOpen(true)
        }}
        title="Call a waiter to your table"
      >
        <BellIcon size={16} />
        <span>Call waiter</span>
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Call waiter" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <h2>🔔 Call Waiter · {tableLabel}</h2>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                <CloseIcon />
              </button>
            </div>
            <div className="modal__body stack">
              {sentReason ? (
                <div className="center" style={{ padding: '20px 0' }}>
                  <div className="result-icon">
                    <CheckIcon size={32} />
                  </div>
                  <h3>Waiter notified!</h3>
                  <p className="muted small">Someone is heading to {tableLabel} ({sentReason}).</p>
                </div>
              ) : (
                <>
                  {!linkCtx.tableCode && (
                    <label className="field">
                      <span>Your table number</span>
                      <input
                        value={tableInput}
                        onChange={(e) => setTableInput(e.target.value)}
                        placeholder="e.g. 4"
                        maxLength={20}
                      />
                    </label>
                  )}
                  <p className="muted small">Tap what you need and we'll alert a waiter immediately:</p>
                  <div className="waiter-reasons">
                    {WAITER_REASONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        className="waiter-reason-btn"
                        disabled={busy}
                        onClick={() => triggerCall(r)}
                      >
                        <strong>{r}</strong>
                        <span>→</span>
                      </button>
                    ))}
                  </div>
                  {error && <p className="alert alert--error">{error}</p>}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}