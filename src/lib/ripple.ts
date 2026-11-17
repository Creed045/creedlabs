// Apple "Liquid Glass"-style interaction engine.
// One delegated listener set for the whole app:
//  • tracks the pointer so a specular highlight follows your finger/cursor
//  • on press, adds a soft light bloom + elastic squish
//  • on release, plays a jelly "settle" animation like iOS glass controls

const SELECTOR =
  '.btn, .icon-btn, .navbar__cart, .tabs__tab, .chip, .pay-option, .cart-bar, .kitchen-dish, .kitchen-nav__btn, .spice-btn, .allergy-chip, .theme-toggle'

let installed = false

function findTarget(e: Event): HTMLElement | null {
  const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(SELECTOR)
  if (!el || (el as HTMLButtonElement).disabled) return null
  return el
}

function setPointerVars(el: HTMLElement, clientX: number, clientY: number) {
  const r = el.getBoundingClientRect()
  const x = ((clientX - r.left) / r.width) * 100
  const y = ((clientY - r.top) / r.height) * 100
  el.style.setProperty('--mx', `${x.toFixed(1)}%`)
  el.style.setProperty('--my', `${y.toFixed(1)}%`)
  // Subtle tilt toward the pointer (−1…1)
  el.style.setProperty('--tx', ((x - 50) / 50).toFixed(3))
  el.style.setProperty('--ty', ((y - 50) / 50).toFixed(3))
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
    // Restart the settle animation even on rapid taps
    void el.offsetWidth
    el.classList.add('is-liquid-release')
    const done = () => el.classList.remove('is-liquid-release')
    el.addEventListener('animationend', done, { once: true })
    setTimeout(done, 700)
  }

  document.addEventListener('pointerup', release, { passive: true })
  document.addEventListener('pointercancel', release, { passive: true })
  window.addEventListener('blur', release)
}
