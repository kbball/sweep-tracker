import { courseStats, cumulative, haversine, passesOf, teamProgress } from './course'
import { pos, track } from './test/fixtures'
import type { Course, Point, TrackerHistory } from './types'

// A meridian out-and-back: 0.05° north (about 5.6 km) and the same way home; ~1.11 km per 0.01°.
const out: Point[] = Array.from({ length: 51 }, (_, i) => ({ lat: i / 1000, lon: 0, ele: 1000 + i }))
const back: Point[] = out.slice(0, 50).reverse().map((p) => ({ ...p }))
const loop: Point[] = [...out, ...back]
const course = (over: Partial<Course> = {}): Course => ({ name: 'C', distanceM: 0, track: loop, waypoints: [], ...over })
const total = cumulative(loop).at(-1)!
const onEitherLeg = (d: number) => Math.abs(d - 2224) < 10 || Math.abs(d - (total - 2224)) < 10

describe('geometry', () => {
  it('measures distance along a track', () => {
    expect(haversine(out[0], out[10])).toBeCloseTo(1112, -1)
    const cum = cumulative(loop)
    expect(cum[0]).toBe(0)
    expect(cum.at(-1)).toBeCloseTo(11120, -2)
  })
})

describe('passesOf', () => {
  const cum = cumulative(loop)
  it('finds both passes of a spot on an out-and-back course', () => {
    const p = passesOf(loop, cum, 0.02, 0.0002, 75)
    expect(p).toHaveLength(2)
    expect(p[0]).toBeCloseTo(2224, -1)
    expect(p[1]).toBeCloseTo(total - 2224, -1)
  })
  it('finds a single pass at the turnaround', () => {
    const p = passesOf(loop, cum, 0.05, 0, 75)
    expect(p).toHaveLength(1)
    expect(p[0]).toBeCloseTo(total / 2, -1)
  })
  it('falls back to the nearest point when the course is never that close', () => {
    const p = passesOf(loop, cum, 0.02, 0.01, 75) // ~1.1 km off the course
    expect(p).toHaveLength(1)
    expect(onEitherLeg(p[0])).toBe(true) // equally near the way out and the way back
    expect(onEitherLeg(passesOf(loop, cum, 0.02, 0, 0)[0])).toBe(true) // radius 0: nearest only
  })
  it('merges hits that are close together along the course into one pass', () => {
    const wiggle: Point[] = [{ lat: 0, lon: -0.001 }, { lat: 0, lon: 0.001 }, { lat: 0.0001, lon: 0.001 }, { lat: 0.0001, lon: -0.001 }]
    expect(passesOf(wiggle, cumulative(wiggle), 0, 0, 75)).toHaveLength(1)
  })
  it('returns nothing for a track with fewer than two points', () => {
    expect(passesOf([out[0]], [0], 0, 0, 75)).toEqual([])
  })
})

describe('courseStats', () => {
  it('places aid stations at the confirmed passes, naming out and in legs', () => {
    const stats = courseStats(course({ waypoints: [
      { name: 'Aid 1', lat: 0.02, lon: 0, passes: [{ distM: 2224, use: true }, { distM: total - 2224, use: true }] },
      { name: 'Turn', lat: 0.05, lon: 0, passes: [{ distM: total / 2, use: true }, { distM: 100, use: false }] },
      { name: '', lat: 0.03, lon: 0, passes: [{ distM: 3000, use: false }] },
    ] }))!
    expect(stats.totalM).toBeCloseTo(total, 3)
    expect(stats.stops.map((s) => s.name)).toEqual(['Aid 1 (out)', 'Turn', 'Aid 1 (in)'])
    expect(stats.stops.map((s) => Math.round(s.distM))).toEqual([2224, Math.round(total / 2), Math.round(total - 2224)])
    expect(stats.profile!.length).toBeGreaterThan(1)
  })

  it('still places a waypoint from a course saved before passes existed', () => {
    const stats = courseStats(course({ waypoints: [{ name: 'Old', lat: 0.02, lon: 0 }, { name: '', lat: 0.03, lon: 0 }] }))!
    expect(stats.stops.map((s) => s.name)).toEqual(['Old', 'Waypoint'])
    expect(stats.stops[0].distM).toBeCloseTo(2224, -1)
  })

  it('downsamples long profiles and handles missing elevation or tracks', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ lat: i / 10000, lon: 0, ele: i }))
    const s = courseStats(course({ track: many }), 100)!
    expect(s.profile!.length).toBeLessThanOrEqual(101)
    expect(s.profile!.at(-1)!.ele).toBe(999) // always keeps the finish
    expect(courseStats(course({ track: loop.map(({ lat, lon }) => ({ lat, lon })) }))!.profile).toBeNull()
    expect(courseStats(course({ track: [out[0]] }))).toBeNull()
  })
})

describe('unticked passes', () => {
  // A station the course goes by three times (like Dry Creek): the organiser confirms only the middle visit.
  const loops: Point[] = []
  for (let lap = 0; lap < 3; lap++) loops.push({ lat: 0, lon: -0.001 }, { lat: 0, lon: 0.001 }, { lat: 0.02, lon: 0.001 }, { lat: 0.02, lon: -0.001 })
  const wp = (use: boolean[]) => ({ name: 'Dry Creek', lat: 0, lon: 0, passes: [0, 1, 2].map((i) => ({ distM: 0, use: use[i] })) })
  const withUse = (use: boolean[]) => {
    const cum = cumulative(loops)
    const at = passesOf(loops, cum, 0, 0, 75)
    return courseStats({ name: 'L', distanceM: 0, track: loops, waypoints: [{ ...wp(use), passes: at.map((d, i) => ({ distM: d, use: use[i] })) }] })!
  }
  it('places a fix near the station on the confirmed pass only', () => {
    const all = withUse([true, true, true]).candidates(0, 0)
    expect(all).toHaveLength(3)
    const only = withUse([false, true, false]).candidates(0, 0)
    expect(only).toEqual([all[1]])
  })
  it('keeps every pass if nothing is confirmed there, rather than losing the team', () => {
    expect(withUse([false, false, false]).candidates(0, 0)).toHaveLength(3)
  })
  it('does not exclude a pass that is also confirmed for another station', () => {
    const cum = cumulative(loops)
    const at = passesOf(loops, cum, 0, 0, 75)
    const s = courseStats({ name: 'L', distanceM: 0, track: loops, waypoints: [
      { name: 'A', lat: 0, lon: 0, passes: at.map((d, i) => ({ distM: d, use: i === 1 })) },
      { name: 'B', lat: 0, lon: 0, passes: [{ distM: at[0], use: true }] },
    ] })!
    expect(s.candidates(0, 0)).toEqual([at[0], at[1]])
  })
})

describe('teamProgress at a curled finish', () => {
  // Out along a road, back along the same road, then the last stretch curls past the start and doubles back on
  // itself, so the final 100 m heads the opposite way to the team's overall approach.
  const hook: Point[] = [{ lat: 0, lon: 0 }, { lat: 0.001, lon: -0.0002 }, { lat: -0.03, lon: -0.0002 }, { lat: 0.0012, lon: -0.0002 }, { lat: 0.0001, lon: 0.0001 }]
  const stats = courseStats({ name: 'H', distanceM: 0, track: hook, waypoints: [] })!
  const finish = cumulative(hook).at(-1)!
  const fix = (id: number, lat: number, lon: number, minutes: number) =>
    pos(id, { lat, lon, time: new Date(Date.UTC(2026, 9, 10, 8, minutes)).toISOString() })

  it('places a team arriving at the finish at the finish, not back at the start', () => {
    // 2.2 km before the finish heading home along the road, then at the finish: the straight line between them
    // points north, but the course itself ends heading south-east.
    const arriving = track({ positions: [fix(2, 0.0001, 0.0001, 20), fix(1, -0.0199, -0.0002, 0)] })
    expect(teamProgress(stats, [arriving]).sw1).toBeCloseTo(finish, -1)
  })

  it('places a team on the way out at the start end', () => {
    const leaving = track({ positions: [fix(2, -0.01, -0.0002, 20), fix(1, 0.0005, -0.0002, 0)] })
    expect(teamProgress(stats, [leaving]).sw1).toBeLessThan(finish / 2)
  })
})

describe('teamProgress', () => {
  const stats = courseStats(course())!
  const at = (id: number, lat: number, minutes: number, over = {}) =>
    pos(id, { lat, lon: 0, time: new Date(Date.UTC(2026, 9, 10, 8, minutes)).toISOString(), ...over })
  const team = (positions: ReturnType<typeof pos>[]): TrackerHistory => track({ positions })

  it('places a team by its fixes', () => {
    expect(teamProgress(stats, [team([at(1, 0.01, 0)])])).toEqual({ sw1: expect.closeTo(1112, -1) })
  })

  it('follows a team round the turnaround instead of snapping to the outbound leg', () => {
    const outbound = [at(1, 0.03, 0), at(2, 0.04, 10), at(3, 0.05, 20)]
    const homeward = [...outbound, at(4, 0.045, 30), at(5, 0.04, 40)]
    // Reports arrive newest first, as the API returns them.
    expect(teamProgress(stats, [team([...outbound].reverse())]).sw1).toBeCloseTo(total / 2, -1)
    const p = teamProgress(stats, [team([...homeward].reverse())]).sw1
    expect(p).toBeCloseTo(total - 4448, -1) // 0.04° on the way back, not 0.04° on the way out
  })

  it('tolerates GPS jitter without jumping to the other leg', () => {
    const jitter = [at(1, 0.03, 0), at(2, 0.0301, 10), at(3, 0.0299, 20)]
    expect(teamProgress(stats, [team([...jitter].reverse())]).sw1).toBeCloseTo(3336, -2)
  })

  it('tells the leg from the direction of travel, even with no reports from the start', () => {
    // Only fixes from the way back (heading south): no history of going out is needed.
    const p = teamProgress(stats, [team([at(2, 0.03, 40), at(1, 0.031, 30)])]).sw1
    expect(p).toBeCloseTo(total - 3336, -2)
    // The same place heading north is the way out.
    expect(teamProgress(stats, [team([at(2, 0.031, 40), at(1, 0.03, 30)])]).sw1).toBeCloseTo(3447, -2)
  })

  it('judges a team resting at an aid station by how it arrived', () => {
    const arriving = [at(1, 0.04, 0), at(2, 0.035, 10), at(3, 0.03, 20)]
    const resting = [at(4, 0.03, 30), at(5, 0.0301, 40), at(6, 0.0299, 50), at(7, 0.03, 60)] // within GPS noise
    expect(teamProgress(stats, [team([...arriving, ...resting].reverse())]).sw1).toBeCloseTo(total - 3336, -2)
  })

  it('uses a recent heading but not one from reports long before', () => {
    // 167 m south of the last fix: within the slack for "same leg", so only the heading says it is heading home.
    const earlier = at(1, 0.03, 0)
    expect(teamProgress(stats, [team([at(2, 0.0285, 10), earlier])]).sw1).toBeCloseTo(total - 3169, -2) // minutes apart: inbound
    expect(teamProgress(stats, [team([at(2, 0.0285, 10 * 60), earlier])]).sw1).toBeCloseTo(3169, -2) // ten hours apart: no heading
  })

  it('falls back to moving forward when the team moves sideways to the course', () => {
    // Moving east, across the course: neither leg is a step forward or back.
    const sideways = [at(1, 0.03, 0), pos(2, { lat: 0.03, lon: 0.0006, time: new Date(Date.UTC(2026, 9, 10, 8, 10)).toISOString() })]
    expect(onEitherLeg(teamProgress(stats, [team([sideways[1], sideways[0]])]).sw1 - 1112)).toBe(true) // some pass near 0.03°
  })

  it('ignores reports from before the event, such as an earlier run of the same tracker', () => {
    const earlierRun = [at(1, 0.01, 0), at(2, 0.05, 30), at(3, 0.02, 60)] // out and back, finishing near the start
    const thisRun = [at(4, 0.01, 24 * 60)] // just starting: no heading yet
    const day = Date.UTC(2026, 9, 11, 0)
    const all = team([...earlierRun, ...thisRun].reverse())
    expect(teamProgress(stats, [all], day).sw1).toBeCloseTo(1112, -1) // this run only: at the start
    expect(teamProgress(stats, [all]).sw1).toBeCloseTo(total - 1112, -1) // without the cutoff the old run's finish carries over
    expect(teamProgress(stats, [team([at(1, 0.01, 0)])], day)).toEqual({})
  })

  it('skips teams with no GPS fix', () => {
    expect(teamProgress(stats, [team([at(1, 0.01, 0, { hasFix: false })]), team([])])).toEqual({})
  })

  it('treats a team off the course as at its nearest point', () => {
    expect(onEitherLeg(teamProgress(stats, [team([pos(1, { lat: 0.02, lon: 0.02 })])]).sw1)).toBe(true)
  })
})

describe('official miles and the next stop', () => {
  const M = 1609.344
  // A short course whose GPX distances (10 and 20 miles) differ from the handbook's (10.5 and 21).
  const track = Array.from({ length: 41 }, (_, i) => ({ lat: (i * M * 0.5) / 111_195, lon: 0 })) // 20 miles north
  const pass = (distMiles: number, extra = {}) => ({ distM: distMiles * M, use: true, ...extra })
  const stats = (passes: ReturnType<typeof pass>[][]) => courseStats({
    name: 'X', distanceM: 0, track,
    waypoints: passes.map((p, i) => ({ name: `S${i + 1}`, lat: 0, lon: 0, passes: p })),
  })!

  it('interpolates the mile between stops that have official miles', () => {
    const s = stats([[pass(0, { mile: 0 })], [pass(10, { mile: 10.5, cutoffHours: 4 })], [pass(20, { mile: 21 })]])
    expect(s.mileAt(0)).toBeCloseTo(0)
    expect(s.mileAt(5 * M)).toBeCloseTo(5.25)
    expect(s.mileAt(10 * M)).toBeCloseTo(10.5)
    expect(s.mileAt(15 * M)).toBeCloseTo(15.75)
    expect(s.mileAt(20 * M)).toBeCloseTo(21)
    expect(s.mileAt(21 * M)).toBeCloseTo(22) // past the last stop: its mile plus the extra distance
  })
  it('measures before the first stop back from its mile, never below zero', () => {
    const s = stats([[pass(2, { mile: 2.5 })], [pass(10, { mile: 10.5 })]])
    expect(s.mileAt(1 * M)).toBeCloseTo(1.5)
    expect(s.mileAt(0)).toBeCloseTo(0.5)
    const s2 = stats([[pass(0.5, { mile: 0.2 })], [pass(10, { mile: 10.5 })]])
    expect(s2.mileAt(0)).toBe(0)
  })
  it('uses the GPX distance when fewer than two stops have an official mile', () => {
    expect(stats([[pass(10, { mile: 10.5 })], [pass(20)]]).mileAt(5 * M)).toBeCloseTo(5)
    expect(stats([[pass(10)], [pass(20)]]).mileAt(12 * M)).toBeCloseTo(12)
  })
  it('handles two stops at the same distance', () => {
    const s = stats([[pass(5, { mile: 5 })], [pass(5, { mile: 5.1 })], [pass(10, { mile: 10 })]])
    expect(Number.isFinite(s.mileAt(5 * M))).toBe(true)
  })

  it('finds the next stop and the miles to it', () => {
    const s = stats([[pass(0, { mile: 0 })], [pass(10, { mile: 10.5, cutoffHours: 4 })], [pass(20, { mile: 21 })]])
    const n = s.nextStop(5 * M)!
    expect(n.stop.name).toBe('S2')
    expect(n.stop.cutoffHours).toBe(4)
    expect(n.miles).toBeCloseTo(5.25) // official miles, not GPX miles
    expect(s.nextStop(10 * M)!.stop.name).toBe('S3') // at a stop, the next one is the one after
    expect(s.nextStop(10 * M - 20)!.stop.name).toBe('S3') // within 50 m counts as being at it
    expect(s.nextStop(10 * M - 200)!.stop.name).toBe('S2')
    expect(s.nextStop(20 * M)).toBeUndefined() // nothing after the finish
  })
  it('measures the miles to the next stop from the GPX when there are no official miles', () => {
    expect(stats([[pass(10)], [pass(20)]]).nextStop(2 * M)!.miles).toBeCloseTo(8)
  })
  it('names stops from the organiser\'s label, and keeps pacer and crew details', () => {
    const s = stats([[pass(10, { label: 'Finish Loop #4', pacer: true, crew: 'Yes/Yes' })]])
    expect(s.stops[0]).toMatchObject({ name: 'Finish Loop #4', pacer: true, crew: 'Yes/Yes' })
  })
})

describe('a team that starts part-way along the course', () => {
  const stats = courseStats(course())!
  const at = (id: number, lat: number, minutes: number) =>
    pos(id, { lat, lon: 0, time: new Date(Date.UTC(2026, 9, 10, 8, minutes)).toISOString() })

  it('is only placed from its start onwards, even on its first report', () => {
    // One report on the road, which runs both out and back: with a start on the way back, it is the way back.
    const fromHalfway = { ...track(), startM: total / 2 + 100, positions: [at(1, 0.02, 0)] }
    expect(teamProgress(stats, [fromHalfway]).sw1).toBeCloseTo(total - 2224, -1)
    const fromStart = { ...track(), positions: [at(1, 0.02, 0)] }
    expect(teamProgress(stats, [fromStart]).sw1).toBeCloseTo(2224, -1)
  })
  it('allows for a little slack before the start', () => {
    const t = { ...track(), startM: 2224 + 200, positions: [at(1, 0.02, 0)] } // 200 m beyond the pass: still within the slack
    expect(teamProgress(stats, [t]).sw1).toBeCloseTo(2224, -1)
  })
  it('keeps every candidate when none is at or after the start', () => {
    const t = { ...track(), startM: total * 2, positions: [at(1, 0.02, 0)] }
    expect(Number.isFinite(teamProgress(stats, [t]).sw1)).toBe(true)
  })
})
