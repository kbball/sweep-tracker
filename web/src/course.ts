import type { Course, Point, Position, TrackerHistory } from './types'
import { lastFix } from './format'

const R = 6_371_000
const rad = Math.PI / 180

export function haversine(a: Point, b: Point): number {
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Distance along the track, in metres, at each vertex. */
export function cumulative(track: Point[]): number[] {
  const cum = [0]
  for (let i = 1; i < track.length; i++) cum.push(cum[i - 1] + haversine(track[i - 1], track[i]))
  return cum
}

/** Metres along the track of the point on it nearest to (lat, lon). */
export function projectOnTrack(track: Point[], cum: number[], lat: number, lon: number): number {
  let best = Infinity, along = 0
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], b = track[i]
    // Flat-earth approximation is plenty accurate over a single segment.
    const k = Math.cos(a.lat * rad)
    const bx = (b.lon - a.lon) * k, by = b.lat - a.lat
    const px = (lon - a.lon) * k, py = lat - a.lat
    const len2 = bx * bx + by * by
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (px * bx + py * by) / len2))
    const d = (px - t * bx) ** 2 + (py - t * by) ** 2
    if (d < best) { best = d; along = cum[i - 1] + t * (cum[i] - cum[i - 1]) }
  }
  return along
}

export interface CourseStop { name: string; distM: number }
export interface CourseStats {
  totalM: number
  stops: CourseStop[]
  /** Elevation samples in metres, or null if the GPX has no elevation. */
  profile: { d: number; ele: number }[] | null
  at: (lat: number, lon: number) => number
}

export function courseStats(course: Course, maxSamples = 200): CourseStats | null {
  const { track } = course
  if (track.length < 2) return null
  const cum = cumulative(track)
  const withEle = track.map((p, i) => ({ d: cum[i], ele: p.ele })).filter((p): p is { d: number; ele: number } => p.ele != null)
  const stride = Math.max(1, Math.ceil(withEle.length / maxSamples))
  const profile = withEle.length >= 2 ? withEle.filter((_, i) => i % stride === 0 || i === withEle.length - 1) : null
  const at = (lat: number, lon: number) => projectOnTrack(track, cum, lat, lon)
  const stops = course.waypoints
    .map((w) => ({ name: w.name || 'Waypoint', distM: at(w.lat, w.lon) }))
    .sort((a, b) => a.distM - b.distM)
  return { totalM: cum[cum.length - 1], stops, profile, at }
}

/** Metres along the course of a team's newest GPS fix, if it has one. */
export function teamDistance(stats: CourseStats, t: TrackerHistory): number | undefined {
  const f: Position | undefined = lastFix(t.positions)
  return f ? stats.at(f.lat, f.lon) : undefined
}
