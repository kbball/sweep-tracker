import type { Position } from './types'

/** Opacity for the i-th most recent report: newest is opaque, older ones fade. */
export function fadeOpacity(index: number, floor = 0.12, step = 0.22): number {
  return Math.max(floor, 1 - index * step)
}

export type SweepState = 'moving' | 'stopped' | 'nofix' | 'unknown'

export function sweepState(latest?: Position): SweepState {
  if (!latest) return 'unknown'
  if (!latest.hasFix) return 'nofix'
  return latest.moving ? 'moving' : 'stopped'
}

export function ageLabel(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`
  return `${Math.floor(s / 86400)}d ago`
}

export type EventTiming = 'today' | 'upcoming' | 'past'

/** Compares an event's date to now by calendar day (UTC date, as events store a date, not a time). */
export function eventTiming(iso: string, now: Date): EventTiming {
  const day = iso.slice(0, 10)
  const today = now.toISOString().slice(0, 10)
  return day === today ? 'today' : day > today ? 'upcoming' : 'past'
}

/** Human-readable size using decimal units, e.g. 1536 -> "1.5 KB". */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n, i = -1
  do { v /= 1000; i++ } while (v >= 1000 && i < units.length - 1)
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

export const metersToMiles = (m: number) => m / 1609.344

/** Newest report that actually has a GPS fix. */
export function lastFix(positions: Position[]): Position | undefined {
  return positions.find((p) => p.hasFix)
}

/** Insert a live position into a newest-first list, keeping at most `max`. */
export function mergePosition(list: Position[], p: Position, max: number): Position[] {
  if (list.some((x) => x.id === p.id && p.id !== 0)) return list
  return [...list, p]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, max)
}
