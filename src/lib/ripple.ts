// Material-style ripple for every button in the app.
// One delegated listener — no per-component wiring needed.

const SELECTOR =
  '.btn, .icon-btn, .tabs__tab, .chip, .pay-option, .cart-bar, .kitchen-dish, .kitchen-nav__btn, .spice-btn, .allergy-chip'

let installed = false

export function installRipple() {
  if (installed || typeof document === 'undefined') return
  installed = true

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (reduceMotion?.matches) return
      if (e.button !== 0) return
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(SELECTOR)
      if (!target || (target as HTMLButtonElement).disabled) return

      const rect = target.getBoundingClientRect()
      const size = Math.max(rect.width, rect.height) * 2
      const ripple = document.createElement('span')
      ripple.className = 'ripple'
      ripple.style.width = ripple.style.height = `${size}px`
      ripple.style.left = `${e.clientX - rect.left - size / 2}px`
      ripple.style.top = `${e.clientY - rect.top - size / 2}px`

      target.classList.add('has-ripple')
      target.appendChild(ripple)
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true })
      // Safety net in case animationend never fires
      setTimeout(() => ripple.remove(), 800)
    },
    { passive: true },
  )
}
