import type { Course, Point, Position, TrackerHistory } from './types'

const R = 6_371_000
const rad = Math.PI / 180
const M_PER_DEG = 111_320

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

/** Distance in metres from (lat, lon) to the segment a-b, and how far along it (0..1) the closest point is. */
function toSegment(a: Point, b: Point, lat: number, lon: number): { d: number; t: number } {
  const k = Math.cos(a.lat * rad)
  const bx = (b.lon - a.lon) * k * M_PER_DEG, by = (b.lat - a.lat) * M_PER_DEG
  const px = (lon - a.lon) * k * M_PER_DEG, py = (lat - a.lat) * M_PER_DEG
  const len2 = bx * bx + by * by
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (px * bx + py * by) / len2))
  return { d: Math.hypot(px - t * bx, py - t * by), t }
}

/**
 * Every place (metres along the track, ascending) where the track comes within
 * `radiusM` of the point; hits closer than `gapM` along the track are one pass.
 * If the track never comes that close, the single nearest point.
 */
export function passesOf(track: Point[], cum: number[], lat: number, lon: number, radiusM: number, gapM = 500): number[] {
  if (track.length < 2) return []
  const latMargin = radiusM / M_PER_DEG
  const lonMargin = radiusM / (M_PER_DEG * Math.max(0.01, Math.cos(lat * rad)))
  const out: number[] = []
  let open = false, bestD = 0, bestAlong = 0, lastAlong = 0
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], b = track[i]
    // Cheap reject: segments nowhere near the point can't be a pass or the nearest point of interest.
    const far = (a.lat - lat > latMargin && b.lat - lat > latMargin) || (lat - a.lat > latMargin && lat - b.lat > latMargin) ||
      (a.lon - lon > lonMargin && b.lon - lon > lonMargin) || (lon - a.lon > lonMargin && lon - b.lon > lonMargin)
    if (far) continue
    const { d, t } = toSegment(a, b, lat, lon)
    if (d > radiusM) continue
    const along = cum[i - 1] + t * (cum[i] - cum[i - 1])
    if (open && along - lastAlong <= gapM) {
      if (d < bestD) { bestD = d; bestAlong = along }
    } else {
      if (open) out.push(bestAlong)
      bestD = d; bestAlong = along; open = true
    }
    lastAlong = along
  }
  if (open) out.push(bestAlong)
  return out.length ? out : [nearestAlong(track, cum, lat, lon)]
}

/** Metres along the track of the point on it closest to (lat, lon). */
function nearestAlong(track: Point[], cum: number[], lat: number, lon: number): number {
  let best = Infinity, along = 0
  for (let i = 1; i < track.length; i++) {
    const { d, t } = toSegment(track[i - 1], track[i], lat, lon)
    if (d < best) { best = d; along = cum[i - 1] + t * (cum[i] - cum[i - 1]) }
  }
  return along
}

/** Compass bearing in degrees (0 = north, clockwise) from a to b. */
export function bearing(a: Point, b: Point): number {
  const k = Math.cos(((a.lat + b.lat) / 2) * rad)
  return (Math.atan2((b.lon - a.lon) * k, b.lat - a.lat) / rad + 360) % 360
}

/** Smallest angle between two bearings, 0..180. */
export function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** The point `distM` metres along the track (clamped to its ends). */
function pointAt(track: Point[], cum: number[], distM: number): Point {
  if (distM <= 0) return track[0]
  if (distM >= cum[cum.length - 1]) return track[track.length - 1]
  let lo = 1, hi = cum.length - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < distM) lo = mid + 1; else hi = mid }
  const span = cum[lo] - cum[lo - 1]
  const f = span === 0 ? 0 : (distM - cum[lo - 1]) / span
  const a = track[lo - 1], b = track[lo]
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f }
}

export interface CourseStop { name: string; distM: number }
export interface CourseStats {
  totalM: number
  /** One entry per confirmed aid-station pass, in course order. */
  stops: CourseStop[]
  /** Elevation samples in metres, or null if the GPX has no elevation. */
  profile: { d: number; ele: number }[] | null
  /** Every place the course goes by (lat, lon), in metres along it. */
  candidates: (lat: number, lon: number) => number[]
  /** Which way the course runs at a distance along it (compass bearing, over a short stretch either side). */
  courseBearing: (distM: number) => number
}

/** Within this distance of the course a GPS fix counts as being on it. */
const FIX_RADIUS_M = 100
/** The stretch of course either side of a point used to work out which way it runs. */
const BEARING_SPAN_M = 60
/** A fix this close (along the course) to a pass the organiser unticked is placed on the confirmed pass instead. */
const UNUSED_PASS_M = 200

export function courseStats(course: Course, maxSamples = 200): CourseStats | null {
  const { track } = course
  if (track.length < 2) return null
  const cum = cumulative(track)
  const totalM = cum[cum.length - 1]
  const withEle = track.map((p, i) => ({ d: cum[i], ele: p.ele })).filter((p): p is { d: number; ele: number } => p.ele != null)
  const stride = Math.max(1, Math.ceil(withEle.length / maxSamples))
  const profile = withEle.length >= 2 ? withEle.filter((_, i) => i % stride === 0 || i === withEle.length - 1) : null

  const stops: CourseStop[] = []
  for (const w of course.waypoints) {
    const name = w.name || 'Waypoint'
    if (!w.passes?.length) { // a course saved before passes were detected: nearest point only
      stops.push({ name, distM: passesOf(track, cum, w.lat, w.lon, 0)[0] })
      continue
    }
    const used = w.passes.filter((p) => p.use)
    for (const p of used) {
      const leg = used.length > 1 ? (p.distM < totalM / 2 ? ' (out)' : ' (in)') : ''
      stops.push({ name: name + leg, distM: p.distM })
    }
  }
  stops.sort((a, b) => a.distM - b.distM)

  // Passes the organiser unticked (the trail just runs close to the station) are not places a team can be.
  const usedAt = course.waypoints.flatMap((w) => (w.passes ?? []).filter((p) => p.use).map((p) => p.distM))
  const unusedAt = course.waypoints.flatMap((w) => (w.passes ?? []).filter((p) => !p.use).map((p) => p.distM))
    .filter((u) => !usedAt.some((v) => Math.abs(v - u) < UNUSED_PASS_M))
  const placeable = (c: number[]) => {
    const kept = c.filter((d) => !unusedAt.some((u) => Math.abs(u - d) < UNUSED_PASS_M))
    return kept.length ? kept : c
  }
  return {
    totalM, stops, profile,
    candidates: (lat, lon) => placeable(passesOf(track, cum, lat, lon, FIX_RADIUS_M)),
    courseBearing: (d) => bearing(pointAt(track, cum, d - BEARING_SPAN_M), pointAt(track, cum, d + BEARING_SPAN_M)),
  }
}

const cache = new WeakMap<CourseStats, Map<string, number[]>>()
function candidatesFor(stats: CourseStats, p: Position): number[] {
  let m = cache.get(stats)
  if (!m) cache.set(stats, (m = new Map()))
  const key = `${p.lat},${p.lon}`
  let c = m.get(key)
  if (!c) m.set(key, (c = stats.candidates(p.lat, p.lon)))
  return c
}

/** How far a team may appear to slip back (GPS jitter, a short detour) before that counts as the other leg. */
const SLACK_M = 300
/** A team must have moved this far before its direction of travel means anything (below it, GPS noise). */
const MIN_MOVE_M = 50
/** Only movement within this long before the newest fix says which way a team is going. */
const HEADING_WINDOW_MS = 6 * 3600_000
/** A pass counts as being in the team's direction of travel within this many degrees. */
const HEADING_TOLERANCE_DEG = 80

/**
 * Metres along the course of each team's newest GPS fix.
 *
 * A course that comes back past the same place (out-and-back, loops) is
 * ambiguous from position alone, so the team's direction of travel decides:
 * its heading over the most recent real movement (at least 50 m within the last
 * 6 hours, so a team resting at an aid station is judged by how it arrived) is
 * compared with the direction the course runs at each place it passes. Teams
 * that haven't moved yet, or whose heading matches none of them, are assumed to
 * keep moving forward along the course. Fixes before `since` (epoch ms) are
 * ignored, so an earlier run with the same tracker doesn't count.
 */
export function teamProgress(stats: CourseStats, tracks: TrackerHistory[], since = -Infinity): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of tracks) {
    const fixes = t.positions.filter((p) => p.hasFix && new Date(p.time).getTime() >= since)
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    if (fixes.length === 0) continue

    // Without a heading: keep moving forward from the first pass.
    let chain: number | undefined
    for (const p of fixes) {
      const c = candidatesFor(stats, p)
      if (chain === undefined) chain = c[0]
      else {
        const prev = chain
        chain = c.find((d) => d >= prev - SLACK_M) ?? c[c.length - 1]
      }
    }

    const latest = fixes[fixes.length - 1]
    const latestAt = new Date(latest.time).getTime()
    const from = [...fixes].reverse().find((p) => latestAt - new Date(p.time).getTime() <= HEADING_WINDOW_MS && haversine(p, latest) >= MIN_MOVE_M)
    const candidates = candidatesFor(stats, latest)
    let at = chain!
    if (from && candidates.length > 1) {
      const heading = bearing(from, latest)
      const matching = candidates.filter((d) => angleBetween(heading, stats.courseBearing(d)) <= HEADING_TOLERANCE_DEG)
      // Several passes the same way (loops): the one nearest the forward-moving guess.
      if (matching.length > 0) at = matching.reduce((best, d) => (Math.abs(d - at) < Math.abs(best - at) ? d : best))
    }
    out[t.trackerName] = at
  }
  return out
}
