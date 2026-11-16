import { createContext, useContext } from 'react'
import type { CartLine, MenuItem } from './types'

export interface CartContextValue {
  lines: CartLine[]
  count: number
  total: number
  isOpen: boolean
  openCart: () => void
  closeCart: () => void
  add: (item: MenuItem) => void
  setQuantity: (id: string, quantity: number) => void
  setModifier: (id: string, modifier: string) => void
  remove: (id: string) => void
  clear: () => void
  quantityOf: (id: string) => number
  modifierOf: (id: string) => string
}

export const CartContext = createContext<CartContextValue | null>(null)

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>')
  return ctx
}