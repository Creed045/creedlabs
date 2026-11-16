import type { CATEGORIES } from './config'

export type Category = (typeof CATEGORIES)[number]
export type MenuFilter = 'best' | 'all' | Category

export interface MenuItem {
  id: string
  name: string
  description: string
  price: number
  category: Category
  image_url: string | null
  available: boolean
  best_seller?: boolean
  created_at: string
}

export interface CartLine {
  id: string
  name: string
  price: number
  image_url: string | null
  quantity: number
  modifier?: string
}

export interface OrderItem {
  id: string
  name: string
  price: number
  quantity: number
  modifier?: string
}

export type OrderStatus = 'new' | 'preparing' | 'ready' | 'delivered'
export type PaymentMethod = 'paystack' | 'cash'
export type PaymentStatus = 'pending' | 'paid' | 'failed'

export interface Order {
  id: string
  customer_name: string
  phone: string
  email: string
  address: string
  notes: string
  items: OrderItem[]
  total: number
  status: OrderStatus
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  payment_reference: string | null
  created_at: string
}

export interface RestaurantTable {
  id: string
  code: string
  label: string
  created_at: string
}

export type StaffRole = 'admin' | 'kitchen'

export const ORDER_STATUSES: { value: OrderStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'ready', label: 'Ready' },
  { value: 'delivered', label: 'Delivered' },
]

export function shortOrderId(id: string): string {
  return id.slice(0, 8).toUpperCase()
}

export function isTableOrder(address: string): boolean {
  return /^table\b/i.test(address.trim())
}

export function modifiersForCategory(category: Category): string[] {
  if (category === 'Drinks') return ['Chilled', '🧊 Extra Ice', 'No Ice']
  if (category === 'Desserts') return ['Warm', 'Extra Honey']
  return ['Mild', 'Medium', '🌶️ Extra Spicy']
}