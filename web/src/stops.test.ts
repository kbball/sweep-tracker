import { aidStationsCsv, fileSlug, orderedPasses, raceStart } from './stops'
import type { Course, SweepEvent } from './types'

const M = 1609.344
const course = (): Course => ({
  name: 'C', distanceM: 20 * M,
  track: [{ lat: 0, lon: 0 }, { lat: 0.1, lon: 0 }, { lat: 0, lon: 0 }],
  waypoints: [
    { name: 'Aid, "One"', lat: 0.05, lon: 0, passes: [
      { distM: 5 * M, use: true, label: 'Aid 1 out', mile: 5.2, cutoffHours: 6, pacer: false, crew: 'Yes/Yes' },
      { distM: 15 * M, use: true, mile: 15.4, cutoffHours: 27.5, pacer: true, crew: 'NO' },
    ] },
    { name: 'Turnaround', lat: 0.1, lon: 0, passes: [{ distM: 10 * M, use: true, mile: 10.4 }, { distM: 12 * M, use: false }] },
  ],
})
const event = (over: Partial<SweepEvent> = {}): SweepEvent => ({
  id: 'e', name: 'Big Run: 100!', date: '2026-10-09T00:00:00Z', startTime: '12:00', notes: '', trackers: [], course: course(), ...over,
})

describe('stops helpers', () => {
  it('lists every pass in course order, whichever waypoint it belongs to', () => {
    expect(orderedPasses(course()).map((r) => [r.waypoint.name, Math.round(r.pass.distM / M)])).toEqual([
      ['Aid, "One"', 5], ['Turnaround', 10], ['Turnaround', 12], ['Aid, "One"', 15],
    ])
  })
  it('knows the race start only when there is a start time', () => {
    expect(raceStart('2026-10-09T00:00:00Z', '12:00')).toEqual({ weekday: 5, minutes: 720 })
    expect(raceStart('2026-10-09T00:00:00Z', '')).toBeUndefined()
    expect(raceStart('2026-10-09T00:00:00Z')).toBeUndefined()
  })
  it('makes a safe file name', () => {
    expect(fileSlug('Big Run: 100!')).toBe('big-run-100')
    expect(fileSlug('***')).toBe('event')
  })
})

describe('aidStationsCsv', () => {
  const lines = aidStationsCsv(event()).trimEnd().split('\r\n')

  it('has a header and one row for each real stop, in course order', () => {
    expect(lines[0]).toBe('Stop,Mile,Miles to next,Miles to finish,Cutoff,Cutoff (hours after start),Pacer,Crew / drop bag,GPX mile')
    expect(lines).toHaveLength(4) // the unticked pass is left out
  })
  it('uses official miles, works out the distances between stops and shows cutoffs as clock times', () => {
    expect(lines[1]).toBe('Aid 1 out,5.2,5.2,10.2,Fri 6:00 PM,6,,Yes/Yes,5.0')
    expect(lines[2]).toBe('Turnaround,10.4,5.0,5.0,,,,,10.0')
    expect(lines[3]).toBe('"Aid, ""One"" (in)",15.4,,0.0,Sat 3:30 PM,27.5,Yes,NO,15.0')
  })
  it('leaves clock times out without a start time, but keeps the hours', () => {
    const l = aidStationsCsv(event({ startTime: '' })).trimEnd().split('\r\n')
    expect(l[1]).toBe('Aid 1 out,5.2,5.2,10.2,,6,,Yes/Yes,5.0')
  })
  it('falls back to GPX miles when there are no official ones', () => {
    const c = course()
    c.waypoints.forEach((w) => w.passes!.forEach((p) => { delete p.mile }))
    expect(aidStationsCsv(event({ course: c })).split('\r\n')[1].startsWith('Aid 1 out,5.0,5.0,10.0,')).toBe(true)
  })
  it('is just the header for an event without a course', () => {
    expect(aidStationsCsv(event({ course: null }))).toBe(lines[0] + '\r\n')
  })
})
