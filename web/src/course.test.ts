import { angleBetween, bearing, courseStats, cumulative, haversine, passesOf, teamProgress } from './course'
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

describe('bearings', () => {
  it('gives compass bearings and the angle between them', () => {
    const o = { lat: 10, lon: 20 }
    expect(bearing(o, { lat: 11, lon: 20 })).toBeCloseTo(0)
    expect(bearing(o, { lat: 10, lon: 21 })).toBeCloseTo(90)
    expect(bearing(o, { lat: 9, lon: 20 })).toBeCloseTo(180)
    expect(bearing(o, { lat: 10, lon: 19 })).toBeCloseTo(270)
    expect(angleBetween(350, 10)).toBe(20)
    expect(angleBetween(0, 180)).toBe(180)
    expect(angleBetween(90, 90)).toBe(0)
  })
  it('knows which way the course runs, including at its ends', () => {
    const s = courseStats(course())!
    expect(s.courseBearing(1000)).toBeCloseTo(0) // way out: north
    expect(s.courseBearing(total - 1000)).toBeCloseTo(180) // way back: south
    expect(s.courseBearing(0)).toBeCloseTo(0) // clamped at the start
    expect(s.courseBearing(total)).toBeCloseTo(180) // and at the finish
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

  it('falls back to moving forward when the heading matches no pass', () => {
    // Heading east, across the course: neither leg runs that way.
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
