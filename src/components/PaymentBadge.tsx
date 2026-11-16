import { isTableOrder, type Order } from '../lib/types'

export function PaymentBadge({
  order,
  large = false,
}: {
  order: Pick<Order, 'payment_method' | 'payment_status'> & Partial<Pick<Order, 'address'>>
  large?: boolean
}) {
  const size = large ? 'badge--lg' : ''

  if (order.payment_method === 'cash') {
    const label = order.address && isTableOrder(order.address) ? 'Pay at table' : 'Pay on delivery'
    return <span className={`badge badge--cash ${size}`}>{label}</span>
  }
  if (order.payment_status === 'paid') {
    return <span className={`badge badge--paid ${size}`}>Paid</span>
  }
  if (order.payment_status === 'failed') {
    return <span className={`badge badge--failed ${size}`}>Payment failed</span>
  }
  return <span className={`badge badge--pending ${size}`}>Awaiting payment</span>
}