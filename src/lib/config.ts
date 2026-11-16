// Central app configuration. Change currency or restaurant details here only.

export const RESTAURANT_NAME = 'CreedLabs'
export const RESTAURANT_TAGLINE = 'Nigerian classics, smoky proteins & global favourites'

export const CURRENCY = {
  code: 'NGN',
  symbol: '₦',
  locale: 'en-NG',
  /** Squad expects amounts in the smallest currency unit (kobo for NGN = Naira * 100). */
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

export const SQUAD_PUBLIC_KEY = ((import.meta.env.VITE_SQUAD_PUBLIC_KEY as string | undefined) || 'pk_0774891bbcc91dc101d82a8b494a7146ed1c3db2').trim()

export const MENU_IMAGES_BUCKET = 'menu-images'