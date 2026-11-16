// Central app configuration. Change currency or restaurant details here only.

export const RESTAURANT_NAME = 'Mama Put Kitchen'
export const RESTAURANT_TAGLINE = 'Nigerian classics, smoky proteins & global favourites'

export const CURRENCY = {
  code: 'NGN',
  symbol: '₦',
  locale: 'en-NG',
  /** Paystack expects amounts in the smallest unit (kobo for NGN). */
  subunitMultiplier: 100,
} as const

export const CATEGORIES = ['Starters', 'Mains', 'Proteins', 'Drinks', 'Desserts'] as const

const formatter = new Intl.NumberFormat(CURRENCY.locale, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function formatPrice(amount: number): string {
  return `${CURRENCY.symbol}${formatter.format(amount)}`
}

export function toSubunits(amount: number): number {
  return Math.round(amount * CURRENCY.subunitMultiplier)
}

export const PAYSTACK_PUBLIC_KEY = (import.meta.env.VITE_PAYSTACK_PUBLIC_KEY as string | undefined) ?? ''

export const MENU_IMAGES_BUCKET = 'menu-images'