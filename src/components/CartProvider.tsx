import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CartContext, type CartContextValue } from '../lib/cart'
import type { CartLine, MenuItem } from '../lib/types'

const STORAGE_KEY = 'menu-app-cart-v1'

function loadCart(): CartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as CartLine[]) : []
    return Array.isArray(parsed) ? parsed.filter((l) => l && l.id && l.quantity > 0) : []
  } catch {
    return []
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(loadCart)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
  }, [lines])

  const add = useCallback((item: MenuItem, initialModifier?: string) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.id === item.id)
      if (existing) {
        return prev.map((l) =>
          l.id === item.id
            ? {
                ...l,
                quantity: Math.min(l.quantity + 1, 50),
                modifier: initialModifier !== undefined ? initialModifier : l.modifier,
              }
            : l,
        )
      }
      return [
        ...prev,
        {
          id: item.id,
          name: item.name,
          price: Number(item.price),
          category: item.category,
          image_url: item.image_url,
          quantity: 1,
          modifier: initialModifier ?? '',
        },
      ]
    })
  }, [])

  const setQuantity = useCallback((id: string, quantity: number) => {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.id !== id)
        : prev.map((l) => (l.id === id ? { ...l, quantity: Math.min(quantity, 50) } : l)),
    )
  }, [])

  const setModifier = useCallback((id: string, modifier: string) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, modifier } : l)))
  }, [])

  const remove = useCallback((id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id))
  }, [])

  const clear = useCallback(() => setLines([]), [])

  const value = useMemo<CartContextValue>(() => {
    const count = lines.reduce((n, l) => n + l.quantity, 0)
    const total = lines.reduce((sum, l) => sum + l.price * l.quantity, 0)
    return {
      lines,
      count,
      total,
      isOpen,
      openCart: () => setIsOpen(true),
      closeCart: () => setIsOpen(false),
      add,
      setQuantity,
      setModifier,
      remove,
      clear,
      quantityOf: (id: string) => lines.find((l) => l.id === id)?.quantity ?? 0,
      modifierOf: (id: string) => lines.find((l) => l.id === id)?.modifier ?? '',
    }
  }, [lines, isOpen, add, setQuantity, setModifier, remove, clear])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}