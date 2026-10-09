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

export interface CourseStop { name: string; distM: number }
export interface CourseStats {
  totalM: number
  /** One entry per confirmed aid-station pass, in course order. */
  stops: CourseStop[]
  /** Elevation samples in metres, or null if the GPX has no elevation. */
  profile: { d: number; ele: number }[] | null
  /** Every place the course goes by (lat, lon), in metres along it. */
  candidates: (lat: number, lon: number) => number[]
}

/** Within this distance of the course a GPS fix counts as being on it. */
const FIX_RADIUS_M = 100
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
/** A team must have moved this far before its earlier position says anything about where it is now (below it, GPS noise). */
const MIN_MOVE_M = 50
/** Only movement within this long before the newest fix is used. */
const LOOKBACK_MS = 6 * 3600_000

/**
 * Metres along the course of each team's newest GPS fix.
 *
 * A course that comes back past the same place (out-and-back, loops) is
 * ambiguous from position alone. Teams move forward along the course, so the
 * team's latest fix is placed at the pass that is the smallest step forward from
 * where its earlier fix was: a team heading home steps forward along the return
 * leg, not along the way out. The earlier fix is the most recent one at least
 * 50 m away within the last 6 hours, so a team resting at an aid station is
 * judged by how it arrived. A team that hasn't moved yet, or that only moved
 * backwards along the course, keeps moving forward from the first pass.
 * Fixes before `since` (epoch ms) are ignored, so an earlier run with the same
 * tracker doesn't count.
 */
export function teamProgress(stats: CourseStats, tracks: TrackerHistory[], since = -Infinity): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of tracks) {
    const fixes = t.positions.filter((p) => p.hasFix && new Date(p.time).getTime() >= since)
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    if (fixes.length === 0) continue

    // Without a clear step: keep moving forward from the first pass.
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
    const earlier = [...fixes].reverse().find((p) => latestAt - new Date(p.time).getTime() <= LOOKBACK_MS && haversine(p, latest) >= MIN_MOVE_M)
    const here = candidatesFor(stats, latest)
    let at = chain!
    if (earlier && here.length > 1) {
      // The smallest step forward (or, failing that, the smallest slip back within the slack).
      let best: { step: number; d: number } | undefined
      for (const f of candidatesFor(stats, earlier)) {
        for (const d of here) {
          const step = d - f
          const cost = step >= 0 ? step : -step + SLACK_M // forward beats backward, whatever the backward distance
          if (step >= -SLACK_M && (!best || cost < best.step)) best = { step: cost, d }
        }
      }
      if (best) at = best.d
    }
    out[t.trackerName] = at
  }
  return out
}
