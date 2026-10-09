import { courseStats, cumulative, haversine, projectOnTrack, teamDistance } from './course'
import { pos, track } from './test/fixtures'
import type { Course } from './types'

// ~1.11 km per 0.01° of latitude
const line = [{ lat: 40, lon: -105, ele: 1000 }, { lat: 40.01, lon: -105, ele: 1100 }, { lat: 40.02, lon: -105, ele: 1050 }]
const course = (over: Partial<Course> = {}): Course => ({ name: 'C', distanceM: 0, track: line, waypoints: [], ...over })

describe('course helpers', () => {
  it('measures distance along a track', () => {
    expect(haversine(line[0], line[1])).toBeCloseTo(1112, -1)
    const cum = cumulative(line)
    expect(cum[0]).toBe(0)
    expect(cum[2]).toBeCloseTo(2224, -1)
  })

  it('projects a point onto the nearest part of the track, clamping to its ends', () => {
    const cum = cumulative(line)
    expect(projectOnTrack(line, cum, 40.005, -105.0005)).toBeCloseTo(556, -1) // beside the first segment
    expect(projectOnTrack(line, cum, 39.9, -105)).toBe(0) // before the start
    expect(projectOnTrack(line, cum, 40.5, -105)).toBeCloseTo(cum[2], 5) // past the end
    expect(projectOnTrack([line[0], line[0]], [0, 0], 40, -105)).toBe(0) // zero-length segment
  })

  it('computes stats with sorted stops and an elevation profile', () => {
    const stats = courseStats(course({ waypoints: [
      { name: 'Aid 2', lat: 40.015, lon: -105 }, { name: '', lat: 40.005, lon: -105 },
    ] }))!
    expect(stats.totalM).toBeCloseTo(2224, -1)
    expect(stats.stops.map((s) => s.name)).toEqual(['Waypoint', 'Aid 2'])
    expect(stats.stops[0].distM).toBeLessThan(stats.stops[1].distM)
    expect(stats.profile).toHaveLength(3)
  })

  it('downsamples long profiles and handles missing elevation or tracks', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ lat: 40 + i / 10000, lon: -105, ele: i }))
    const stats = courseStats(course({ track: many }), 100)!
    expect(stats.profile!.length).toBeLessThanOrEqual(101)
    expect(stats.profile!.at(-1)!.ele).toBe(999) // always keeps the finish
    expect(courseStats(course({ track: line.map(({ lat, lon }) => ({ lat, lon })) }))!.profile).toBeNull()
    expect(courseStats(course({ track: [line[0]] }))).toBeNull()
  })

  it('places a team by its newest fix', () => {
    const stats = courseStats(course())!
    expect(teamDistance(stats, track({ positions: [pos(0, { lat: 40.01, lon: -105 })] }))).toBeCloseTo(1112, -1)
    expect(teamDistance(stats, track({ positions: [pos(0, { hasFix: false })] }))).toBeUndefined()
    expect(teamDistance(stats, track({ positions: [] }))).toBeUndefined()
  })
})
