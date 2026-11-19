// Business-day clock: every daily number in the back office rolls over at
// 00:00 in BUSINESS_TIMEZONE. Orders are never deleted; a new day simply
// starts counting from zero and past days stay available in the POS panel.
import { useEffect, useState } from 'react'
import { BUSINESS_TIMEZONE } from './config'

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function zonedParts(date: Date) {
  const out: Record<string, number> = {}
  for (const p of partsFormatter.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  }
}

/** Offset of BUSINESS_TIMEZONE from UTC at a given instant, in ms. */
function zoneOffsetMs(date: Date): number {
  const p = zonedParts(date)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 'YYYY-MM-DD' of the business day an instant belongs to. */
export function dayKeyOf(date: Date | string): string {
  const p = zonedParts(typeof date === 'string' ? new Date(date) : date)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** Hour of day (0–23) on the restaurant clock. */
export function businessHourOf(date: Date | string): number {
  return zonedParts(typeof date === 'string' ? new Date(date) : date).hour
}

/** Minutes since 00:00 (0–1439) on the restaurant clock. */
export function businessMinutesOf(date: Date | string = new Date()): number {
  const p = zonedParts(typeof date === 'string' ? new Date(date) : date)
  return p.hour * 60 + p.minute
}

export function parseTimeMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return Math.max(0, Math.min(23, h)) * 60 + Math.max(0, Math.min(59, m))
}

/**
 * Checks whether `nowMinutes` is inside [openingTime, closingTime).
 * Supports both same-day schedules (e.g. 08:00 -> 23:00) and overnight schedules (e.g. 10:00 -> 02:00).
 */
export function isWithinOperatingHours(
  openingTime: string,
  closingTime: string,
  nowMinutes = businessMinutesOf(),
): boolean {
  const open = parseTimeMinutes(openingTime)
  const close = parseTimeMinutes(closingTime)
  if (open === close) return true
  if (open < close) {
    return nowMinutes >= open && nowMinutes < close
  }
  return nowMinutes >= open || nowMinutes < close
}

export function formatTime12h(hhmm: string): string {
  const mins = parseTimeMinutes(hhmm)
  const h24 = Math.floor(mins / 60)
  const m = mins % 60
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

/** Move a day key forward or back by whole days. */
export function shiftDayKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** The exact instant 00:00 of a business day begins. */
export function dayStart(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  let t = guess - zoneOffsetMs(new Date(guess))
  const corrected = guess - zoneOffsetMs(new Date(t))
  if (corrected !== t) t = corrected
  return new Date(t)
}

export function msUntilNextDay(now = new Date()): number {
  return Math.max(0, dayStart(shiftDayKey(dayKeyOf(now), 1)).getTime() - now.getTime())
}

export function formatDayLabel(key: string, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: 'UTC',
    weekday: style === 'long' ? 'long' : 'short',
    day: 'numeric',
    month: style === 'long' ? 'long' : 'short',
    year: 'numeric',
  }).format(new Date(`${key}T00:00:00Z`))
}

const clockFormatter = new Intl.DateTimeFormat('en-NG', {
  timeZone: BUSINESS_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function formatClock(iso: string): string {
  return clockFormatter.format(new Date(iso))
}

export function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/**
 * Current business day key. Re-renders exactly at 00:00, and also re-checks when
 * the tab regains focus (a laptop that slept through midnight catches up).
 */
export function useBusinessDay(): string {
  const [key, setKey] = useState(() => dayKeyOf(new Date()))

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const sync = () => setKey(dayKeyOf(new Date()))
    const arm = () => {
      // +250ms so we land safely after midnight; capped to setTimeout's max.
      const wait = Math.min(msUntilNextDay() + 250, 2_147_000_000)
      timer = setTimeout(() => {
        sync()
        arm()
      }, wait)
    }
    arm()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
    }
  }, [])

  return key
}

/** Milliseconds left until `hhmm` (or `00:00` if omitted) in BUSINESS_TIMEZONE, ticking once per second. */
export function msUntilBusinessTime(hhmm: string, now = new Date()): number {
  const mins = parseTimeMinutes(hhmm)
  const todayKey = dayKeyOf(now)
  const todayTarget = dayStart(todayKey).getTime() + mins * 60_000
  if (todayTarget > now.getTime()) {
    return todayTarget - now.getTime()
  }
  const tomorrowTarget = dayStart(shiftDayKey(todayKey, 1)).getTime() + mins * 60_000
  return Math.max(0, tomorrowTarget - now.getTime())
}

/** Milliseconds left until a target time (`hhmm` or midnight if null), ticking once per second. */
export function useTargetCountdown(targetHHMM: string | null): number {
  const calc = (hhmm: string | null) =>
    hhmm ? msUntilBusinessTime(hhmm) : msUntilNextDay()
  const [left, setLeft] = useState(() => calc(targetHHMM))
  useEffect(() => {
    const tick = () => setLeft(calc(targetHHMM))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetHHMM])
  return left
}
