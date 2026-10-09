import { courseStats } from './course'
import { formatClock, minutesOf, weekdayOf } from './handbook'
import type { RaceStart } from './handbook'
import type { Course, Pass, SweepEvent, Waypoint } from './types'

export interface PassRef { waypoint: Waypoint; pass: Pass }

/** Every pass of every waypoint in course order (the order the server expects stops in). */
export function orderedPasses(course: Course): PassRef[] {
  const refs: PassRef[] = []
  for (const waypoint of course.waypoints) for (const pass of waypoint.passes ?? []) refs.push({ waypoint, pass })
  return refs.sort((a, b) => a.pass.distM - b.pass.distM) // stable: ties keep waypoint order, as on the server
}

/** The race start of an event, if it has a start time. */
export function raceStart(date: string, startTime?: string): RaceStart | undefined {
  const minutes = minutesOf(startTime)
  return minutes === undefined ? undefined : { weekday: weekdayOf(date), minutes }
}

const cell = (v: string | number | undefined) => {
  const s = v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The event's aid station table as CSV, for sharing with crews and volunteers. */
export function aidStationsCsv(event: SweepEvent): string {
  const header = ['Stop', 'Mile', 'Miles to next', 'Miles to finish', 'Cutoff', 'Cutoff (hours after start)', 'Pacer', 'Crew / drop bag', 'GPX mile']
  const stats = event.course ? courseStats(event.course) : null
  if (!stats) return header.join(',') + '\r\n'
  const start = raceStart(event.date, event.startTime)
  const miles = stats.stops.map((s) => s.mile ?? stats.mileAt(s.distM))
  const last = miles[miles.length - 1]
  const rows = stats.stops.map((s, i) => [
    s.name,
    miles[i].toFixed(1),
    i < stats.stops.length - 1 ? (miles[i + 1] - miles[i]).toFixed(1) : '',
    (last - miles[i]).toFixed(1),
    s.cutoffHours !== undefined && start ? formatClock(s.cutoffHours, start) : '',
    s.cutoffHours ?? '',
    s.pacer ? 'Yes' : '',
    s.crew ?? '',
    (s.distM / 1609.344).toFixed(1),
  ])
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

export const fileSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event'
