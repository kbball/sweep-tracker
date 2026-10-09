import { setupProgress, setupSteps } from './setup'
import type { SetupStep } from './setup'
import type { Course, SweepEvent } from './types'

const M = 1609.344
const course = (over: Partial<Course> = {}): Course => ({
  name: 'C', distanceM: 20 * M, track: [{ lat: 0, lon: 0 }, { lat: 0.1, lon: 0 }],
  waypoints: [
    { name: 'Aid', lat: 0.05, lon: 0, passes: [{ distM: 5 * M, use: true, mile: 5.2, cutoffHours: 6 }, { distM: 15 * M, use: true }] },
  ],
  ...over,
})
const event = (over: Partial<SweepEvent> = {}): SweepEvent => ({
  id: 'e', name: 'Run', date: '2026-10-09T00:00:00Z', startTime: '12:00', notes: '', trackers: [], course: course(), ...over,
})
const byId = (steps: SetupStep[]) => Object.fromEntries(steps.map((s) => [s.id, s]))
const team = (name: string, startM?: number) => ({ trackerName: name, label: name, color: '#111', startM })

describe('setupSteps', () => {
  it('lists the steps in the order they depend on each other', () => {
    expect(setupSteps(event(), []).map((s) => s.id)).toEqual(['details', 'course', 'stops', 'teams', 'maps', 'trackers', 'share'])
  })

  it('has nothing done for a brand new event, and says what is blocked on what', () => {
    const s = byId(setupSteps(event({ startTime: undefined, course: null }), []))
    expect(s.details.state).toBe('todo')
    expect(s.details.detail).toContain('start time')
    expect(s.course.state).toBe('todo')
    expect(s.stops).toMatchObject({ state: 'waiting', detail: 'Needs the course first.' })
    expect(s.teams.state).toBe('todo')
    expect(s.maps).toMatchObject({ state: 'waiting', detail: 'Needs the course first.' })
    expect(s.trackers).toMatchObject({ state: 'waiting', detail: 'Needs the sweep teams first.' })
    expect(s.share.state).toBe('optional')
    expect(setupProgress(Object.values(s))).toEqual({ done: 0, total: 6 })
  })

  it('knows the event details are done once the start time is set', () => {
    const d = byId(setupSteps(event(), [])).details
    expect(d.state).toBe('done')
    expect(d.detail).toBe('Starts Friday at 12:00.')
  })

  it('describes the course', () => {
    expect(byId(setupSteps(event(), [])).course.detail).toBe('20.0 miles, 1 waypoint.')
    expect(byId(setupSteps(event({ course: course({ waypoints: [] }) }), [])).course.detail).toBe('20.0 miles, 0 waypoints.')
  })

  it('treats the aid stations as optional when the GPX has no waypoints, to do until some have details, then done', () => {
    expect(byId(setupSteps(event({ course: course({ waypoints: [] }) }), [])).stops.state).toBe('optional')
    const bare = course({ waypoints: [{ name: 'Aid', lat: 0, lon: 0, passes: [{ distM: 1, use: true }] }] })
    expect(byId(setupSteps(event({ course: bare }), [])).stops.state).toBe('todo')
    const s = byId(setupSteps(event(), [])).stops
    expect(s.state).toBe('done')
    expect(s.detail).toBe('1 of 2 stops have an official mile or a cutoff.')
  })

  it('does not count unticked passes as stops', () => {
    const c = course({ waypoints: [{ name: 'Aid', lat: 0, lon: 0, passes: [{ distM: 1, use: false, mile: 3 }, { distM: 2, use: true }] }] })
    expect(byId(setupSteps(event({ course: c }), [])).stops.state).toBe('todo') // the only detail is on a pass that is not a stop
  })

  it('asks where each team starts, but only on an out-and-back course', () => {
    const two = [team('Sweep1'), team('Sweep2', 5 * M)]
    const s = byId(setupSteps(event({ trackers: two }), [])).teams // Aid has two stops: out and back
    expect(s.state).toBe('todo')
    expect(s.detail).toContain('Sweep1')
    expect(s.detail).not.toContain('Sweep2')
    expect(byId(setupSteps(event({ trackers: [team('Sweep1', 5 * M), team('Sweep2', 5 * M)] }), [])).teams).toMatchObject({ state: 'done', detail: '2 teams.' })
    const pointToPoint = course({ waypoints: [{ name: 'Aid', lat: 0, lon: 0, passes: [{ distM: 5 * M, use: true }] }] })
    expect(byId(setupSteps(event({ trackers: [team('Sweep1')], course: pointToPoint }), [])).teams).toMatchObject({ state: 'done', detail: '1 team.' })
  })

  it('needs map tiles once there is a course', () => {
    expect(byId(setupSteps(event(), [])).maps.state).toBe('todo')
    expect(byId(setupSteps(event(), [], 0)).maps.state).toBe('todo')
    const done = byId(setupSteps(event(), [], 12345)).maps
    expect(done.state).toBe('done')
    expect(done.detail).toContain('12,345 tiles')
  })

  it('checks each team has been heard on the mesh', () => {
    const teams = [team('Sweep1', 1), team('Sweep2', 1)]
    const none = byId(setupSteps(event({ trackers: teams }), [])).trackers
    expect(none.state).toBe('todo')
    expect(none.detail).toContain('Not heard yet: Sweep1, Sweep2')
    const some = byId(setupSteps(event({ trackers: teams }), [{ name: 'Sweep1', lastSeen: 'x' }])).trackers
    expect(some.detail).toContain('Not heard yet: Sweep2')
    expect(some.detail).not.toContain('Sweep1')
    expect(byId(setupSteps(event({ trackers: teams }), [{ name: 'Sweep1', lastSeen: 'x' }, { name: 'Sweep2', lastSeen: 'y' }])).trackers.state).toBe('done')
  })

  it('uses a team\'s label in the where-it-starts hint', () => {
    const t = byId(setupSteps(event({ trackers: [{ trackerName: 'sw1', label: 'Sweep One', color: '#111' }] }), [])).teams
    expect(t.detail).toContain('Sweep One')
  })

  it('counts progress over the steps that matter, not the optional ones', () => {
    const all = setupSteps(event({ trackers: [team('Sweep1', 1)] }), [{ name: 'Sweep1', lastSeen: 'x' }], 100)
    expect(setupProgress(all)).toEqual({ done: 6, total: 6 })
    expect(setupProgress([])).toEqual({ done: 0, total: 0 })
  })
})
