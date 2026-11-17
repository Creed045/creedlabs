import type { ReactNode } from 'react'

interface Props {
  icon?: ReactNode
  title: string
  message?: string
  action?: ReactNode
}

export function EmptyState({ title, message, action }: Props) {
  return (
    <div className="empty">
      <h3 className="empty__title">{title}</h3>
      {message && <p className="empty__message">{message}</p>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  )
}
