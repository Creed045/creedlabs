// Manages whether the customer entered via a Table NFC/QR link (/?table=4 or /t/4)
// or via the Admin's Delivery link variation (/?mode=delivery or /delivery).

export type OrderMode = 'table' | 'delivery'

export interface LinkContext {
  mode: OrderMode
  /** Table code when mode === 'table' (e.g. "4" or "VIP-1"), null if not yet chosen. */
  tableCode: string | null
}

const STORAGE_KEY = 'menu-app-link-context-v1'

export function formatTableLabel(code: string): string {
  const trimmed = code.trim()
  if (!trimmed) return 'Table'
  return /^table\b/i.test(trimmed) ? trimmed : `Table ${trimmed}`
}

export function loadLinkContext(): LinkContext {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LinkContext>
      if (parsed.mode === 'delivery') return { mode: 'delivery', tableCode: null }
      if (parsed.mode === 'table') return { mode: 'table', tableCode: parsed.tableCode ?? null }
    }
  } catch {
    /* ignore */
  }
  return { mode: 'table', tableCode: null }
}

export function saveLinkContext(ctx: LinkContext): LinkContext {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ctx))
  } catch {
    /* ignore */
  }
  return ctx
}

/**
 * Inspects the current URL (query params and pathname) and updates sessionStorage
 * if a table link (`?table=5` or `/t/5`) or delivery link (`?mode=delivery` or `/delivery`)
 * was opened.
 */
export function syncLinkContextFromUrl(pathname: string, search: string): LinkContext {
  const params = new URLSearchParams(search)
  const tableParam = params.get('table')?.trim()
  const modeParam = params.get('mode')?.trim().toLowerCase()

  if (pathname === '/delivery' || modeParam === 'delivery') {
    return saveLinkContext({ mode: 'delivery', tableCode: null })
  }

  const tableMatch = pathname.match(/^\/t\/([^/]+)$/i)
  if (tableMatch?.[1]) {
    return saveLinkContext({ mode: 'table', tableCode: decodeURIComponent(tableMatch[1]).trim() })
  }

  if (tableParam) {
    return saveLinkContext({ mode: 'table', tableCode: tableParam })
  }

  if (modeParam === 'table') {
    return saveLinkContext({ mode: 'table', tableCode: null })
  }

  return loadLinkContext()
}

export function buildTableUrl(origin: string, code: string): string {
  return `${origin}/?table=${encodeURIComponent(code.trim())}`
}

export function buildDeliveryUrl(origin: string): string {
  return `${origin}/?mode=delivery`
}