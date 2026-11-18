// Optimized Apple "Liquid Glass" interaction engine.
// Single delegated listener set for the entire app:
//  • tracks pointer coordinates (--mx / --my) via requestAnimationFrame
//  • applies GPU-composited .is-liquid-press on pointerdown
//  • plays .is-liquid-release elastic spring settle on pointerup

const SELECTOR =
  '.btn, .icon-btn, .navbar__cart, .tabs__tab, .chip, .dish__mod-pill, .waiter-trigger, .theme-toggle, .pay-option, .cart-bar, .kitchen-dish, .kitchen-nav__btn, .status-btn, .spice-btn, .allergy-chip, .stepper'

let installed = false

function findTarget(e: Event): HTMLElement | null {
  const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(SELECTOR)
  if (!el || (el as HTMLButtonElement).disabled) return null
  return el
}

function setPointerVars(el: HTMLElement, clientX: number, clientY: number) {
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return
  const x = ((clientX - r.left) / r.width) * 100
  const y = ((clientY - r.top) / r.height) * 100
  el.style.setProperty('--mx', `${x.toFixed(1)}%`)
  el.style.setProperty('--my', `${y.toFixed(1)}%`)
}

export function installRipple() {
  if (installed || typeof document === 'undefined') return
  installed = true

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  let frame = 0
  let pending: { el: HTMLElement; x: number; y: number } | null = null
  let pressed: HTMLElement | null = null

  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch' && !pressed) return
      const el = pressed ?? findTarget(e)
      if (!el) return
      pending = { el, x: e.clientX, y: e.clientY }
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0
          if (pending) setPointerVars(pending.el, pending.x, pending.y)
          pending = null
        })
      }
    },
    { passive: true },
  )

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return
      const el = findTarget(e)
      if (!el) return
      setPointerVars(el, e.clientX, e.clientY)
      if (reduceMotion?.matches) return
      el.classList.remove('is-liquid-release')
      el.classList.add('is-liquid-press')
      pressed = el
    },
    { passive: true },
  )

  const release = () => {
    const el = pressed
    pressed = null
    if (!el) return
    el.classList.remove('is-liquid-press')
    el.classList.add('is-liquid-release')
    const done = () => el.classList.remove('is-liquid-release')
    el.addEventListener('animationend', done, { once: true })
    setTimeout(done, 520)
  }

  document.addEventListener('pointerup', release, { passive: true })
  document.addEventListener('pointercancel', release, { passive: true })
  window.addEventListener('blur', release)
}
