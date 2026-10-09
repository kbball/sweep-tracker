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

  it('shows length, aid stations on alternating rows and team positions', () => {
    const stats = courseStats(course())
    const tracks = [
      track({ positions: [pos(0, { lat: 40.05, lon: -105 })] }),
      track({ trackerName: 'sw2', label: 'Sweep 2', positions: [pos(0, { hasFix: false })] }),
    ]
    render(<CourseStrip stats={stats} tracks={tracks} progress={teamProgress(stats!, tracks)} />)
    expect(screen.getByText('6.9 mi')).toBeInTheDocument()
    expect(screen.getByText(/^Aid 1 · mi 1\.7$/)).toBeInTheDocument()
    expect(screen.getByText(/^Aid 2 · mi 5\.2$/)).toBeInTheDocument()
    expect(screen.getByText(/^Aid 1/)).toHaveClass('row0')
    expect(screen.getByText(/^Too close/)).toHaveClass('row1') // near Aid 1, so it goes on the other row
    expect(screen.getByText('▲ Sweep 1 mi 3.5')).toBeInTheDocument()
    expect(screen.queryByText(/Sweep 2 mi/)).toBeNull() // no fix: not placed
    expect(screen.getByRole('img', { name: /Elevation profile/ })).toBeInTheDocument()
  })

  it('drops a label that would still overlap, and keeps edge labels inside the strip', () => {
    const c = course({ waypoints: [
      { name: 'Start', lat: 40, lon: -105 },
      { name: 'Aid A', lat: 40.0005, lon: -105 }, { name: 'Aid B', lat: 40.001, lon: -105 }, { name: 'Aid C', lat: 40.0015, lon: -105 },
      { name: 'Finish', lat: 40.1, lon: -105 },
    ] })
    render(<CourseStrip stats={courseStats(c)} tracks={[]} />)
    expect(screen.getByText(/^Start/)).toHaveStyle({ left: '0%' })
    expect(screen.getByText(/^Finish/)).toHaveStyle({ right: '0%' })
    expect(screen.getByText(/^Aid A/)).toBeInTheDocument()
    expect(screen.queryByText(/^Aid B/)).toBeNull() // both rows are taken this close to the start
    expect(screen.queryByText(/^Aid C/)).toBeNull()
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
