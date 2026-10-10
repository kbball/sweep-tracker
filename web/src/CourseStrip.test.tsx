import { render, screen } from '@testing-library/react'
import { courseStats, teamProgress } from './course'
import { CourseStrip } from './CourseStrip'
import { pos, track } from './test/fixtures'
import type { Course } from './types'

const course = (over: Partial<Course> = {}): Course => ({
  name: 'C', distanceM: 0,
  track: [{ lat: 40, lon: -105, ele: 1000 }, { lat: 40.05, lon: -105, ele: 1200 }, { lat: 40.1, lon: -105, ele: 1100 }],
  waypoints: [
    { name: 'Aid 1', lat: 40.025, lon: -105 }, { name: 'Too close', lat: 40.027, lon: -105 }, { name: 'Aid 2', lat: 40.075, lon: -105 },
  ],
  ...over,
})

describe('CourseStrip', () => {
  it('renders nothing without a usable course', () => {
    const { container, rerender } = render(<CourseStrip tracks={[]} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<CourseStrip stats={courseStats(course({ track: [] }))} tracks={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows length, aid stations as tooltips and team positions', () => {
    const stats = courseStats(course())
    const tracks = [
      track({ positions: [pos(0, { lat: 40.05, lon: -105 })] }),
      track({ trackerName: 'sw2', label: 'Sweep 2', positions: [pos(0, { hasFix: false })] }),
    ]
    render(<CourseStrip stats={stats} tracks={tracks} progress={teamProgress(stats!, tracks)} />)
    expect(screen.getByText('6.9 mi')).toBeInTheDocument()
    expect(screen.getByText(/^Aid 1 · mi 1\.7$/)).toBeInTheDocument()
    expect(screen.getByText(/^Aid 2 · mi 5\.2$/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Aid 1 · mi 1\.7$/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Too close/)).toBeInTheDocument()
    expect(screen.getByLabelText('Aid 2 · mi 5.2')).toBeInTheDocument()
    expect(screen.getByText('▲ Sweep 1 mi 3.5')).toBeInTheDocument()
    expect(screen.queryByText(/Sweep 2 mi/)).toBeNull() // no fix: not placed
    expect(screen.getByRole('img', { name: /Elevation profile/ })).toBeInTheDocument()
  })

  it('groups stops too close to tell apart, and keeps tooltips inside the strip at both ends', () => {
    const c = course({ waypoints: [{ name: 'Start', lat: 40, lon: -105 }, { name: 'Also start', lat: 40.0002, lon: -105 }, { name: 'Aid', lat: 40.05, lon: -105 }, { name: 'Finish', lat: 40.1, lon: -105 }] })
    render(<CourseStrip stats={courseStats(c)} tracks={[]} />)
    expect(screen.getByLabelText(/^Start · mi 0\.0, Also start/)).toHaveClass('at-start') // too close to tell apart: one target, both listed
    expect(screen.getByLabelText(/^Aid/)).not.toHaveClass('at-start', 'at-end')
    expect(screen.getByLabelText(/^Finish/)).toHaveClass('at-end')
  })

  it('shows official miles, the handbook names and the official length when the stops have them', () => {
    const c = course({ waypoints: [
      { name: 'Aid 1', lat: 40.025, lon: -105, passes: [{ distM: 2780, use: true, label: 'Powerlines', mile: 3.2 }] },
      { name: 'Aid 2', lat: 40.075, lon: -105, passes: [{ distM: 8340, use: true, mile: 100 }] },
    ] })
    const stats = courseStats(c)!
    render(<CourseStrip stats={stats} tracks={[track()]} progress={{ sw1: 5560 }} />)
    expect(screen.getByText('Powerlines · mi 3.2')).toBeInTheDocument()
    expect(screen.getByText('Aid 2 · mi 100.0')).toBeInTheDocument()
    expect(screen.getByText(/mi 51\.6/)).toBeInTheDocument() // the team, half way between the two official miles
    expect(screen.getByText(/^1\d\d\.\d mi$/)).toBeInTheDocument() // the official length, not the 6.9 GPX miles
  })

  it('draws a flat line when the course has no elevation', () => {
    const flat = course({ track: course().track.map(({ lat, lon }) => ({ lat, lon })) })
    const { container } = render(<CourseStrip stats={courseStats(flat)} tracks={[]} />)
    expect(container.querySelector('.profile-fill')).toBeNull()
    expect(container.querySelector('line.profile-line')).not.toBeNull()
  })

  it('handles a course with constant elevation', () => {
    const level = course({ track: course().track.map((p) => ({ ...p, ele: 500 })) })
    const { container } = render(<CourseStrip stats={courseStats(level)} tracks={[]} />)
    expect(container.querySelector('.profile-fill')).not.toBeNull()
  })
})
