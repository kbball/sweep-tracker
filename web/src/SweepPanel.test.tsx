import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SweepPanel } from './SweepPanel'
import { courseStats } from './course'
import { formatClock } from './handbook'
import { pos, track } from './test/fixtures'

const tracks = () => [
  track(),
  track({ trackerName: 'sw2', label: 'Sweep 2', positions: [pos(1, { hasFix: false, trackerName: 'sw2', batteryV: 3.5 }), pos(2, { alt: undefined, moving: false })] }),
  track({ trackerName: 'sw3', label: 'Sweep 3', positions: [] }),
]

describe('SweepPanel', () => {
  it('shows empty state', () => {
    render(<SweepPanel tracks={[]} now={0} />)
    expect(screen.getByText(/No sweep teams/)).toBeInTheDocument()
  })

  it('shows state chips and expands the first team by default, with its reports tucked away', async () => {
    const u = userEvent.setup()
    render(<SweepPanel now={Date.now()} tracks={tracks()} />)
    expect(screen.getByText('Moving')).toBeInTheDocument()
    expect(screen.getByText('No GPS fix')).toBeInTheDocument()
    expect(screen.getByText('No reports yet')).toBeInTheDocument()
    expect(screen.getByText('3.77 V')).toBeInTheDocument() // summary line
    expect(screen.getByRole('button', { name: /Sweep 1/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Sweep 2/ })).toHaveAttribute('aria-expanded', 'false')
    // The history is a collapsed section until asked for, and only on the expanded team.
    const toggle = screen.getByRole('button', { name: /Recent reports \(3\)/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list', { name: /recent reports/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: /Recent reports/ })).toHaveLength(1)
    await u.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByText(/3.77V/)).toHaveLength(3)
    expect(screen.getAllByText(/1,500 ft/)).toHaveLength(4) // 3 history rows + the summary line
    const ops = screen.getAllByRole('listitem').filter((li) => li.style.opacity).map((r) => Number(r.style.opacity))
    expect(ops[0]).toBe(1)
    expect(ops[1]).toBeLessThan(ops[0])
    expect(ops[2]).toBeLessThan(ops[1])
    await u.click(toggle) // and closes again
    expect(screen.queryByRole('list', { name: /recent reports/ })).toBeNull()
  })

  it('expands the selected team and reports selection', async () => {
    const onSelect = vi.fn()
    render(<SweepPanel now={Date.now()} tracks={tracks()} selected="sw2" onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: /Recent reports \(2\)/ }))
    expect(screen.getByText('no fix · 3.50V')).toBeInTheDocument()
    expect(screen.getByText(/stopped$/)).toBeInTheDocument()
    expect(screen.queryAllByText(/1,500 ft/)).toHaveLength(1) // only sw2's second report has altitude
    await userEvent.click(screen.getByRole('button', { name: /Sweep 3/ }))
    expect(onSelect).toHaveBeenCalledWith('sw3')
    expect(screen.queryByRole('button', { name: /Recent reports \(0\)/ })).toBeNull() // nothing to show for a team without reports
  })

  it('remembers which teams have their reports open', async () => {
    const u = userEvent.setup()
    const { rerender } = render(<SweepPanel now={Date.now()} tracks={tracks()} selected="sw1" />)
    await u.click(screen.getByRole('button', { name: /Recent reports \(3\)/ }))
    rerender(<SweepPanel now={Date.now()} tracks={tracks()} selected="sw2" />)
    expect(screen.queryByRole('list', { name: 'Sweep 1 recent reports' })).toBeNull() // not the expanded team any more
    rerender(<SweepPanel now={Date.now()} tracks={tracks()} selected="sw1" />)
    expect(screen.getByRole('list', { name: 'Sweep 1 recent reports' })).toBeInTheDocument() // still open when it comes back
  })

  it('shows battery voltage, satellites and elevation with icons', async () => {
    const { container } = render(<SweepPanel now={Date.now()} tracks={[track({ positions: [pos(1, { sats: 9 })] })]} />)
    const battery = screen.getByTitle('Battery voltage')
    expect(battery).toHaveTextContent('Battery 3.77 V')
    expect(battery.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    const sats = screen.getByTitle('Satellites in view')
    expect(sats).toHaveTextContent('Satellites 9')
    expect(sats.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    const elevation = screen.getByTitle('Elevation')
    expect(elevation).toHaveTextContent('Elevation 1,500 ft')
    expect(elevation.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelectorAll('svg.glyph')).toHaveLength(3) // battery, satellites, elevation
    await userEvent.click(screen.getByRole('button', { name: /Recent reports/ }))
    expect(screen.getByText(/· 9 sats ·/)).toBeInTheDocument() // also in the report history
  })

  it('leaves out satellites and battery that were not reported, and shows sats on a no-fix report', async () => {
    const { container } = render(<SweepPanel now={Date.now()} tracks={[track({ positions: [pos(1, { hasFix: false, batteryV: undefined, sats: 2 })] })]} />)
    expect(screen.queryByTitle('Battery voltage')).toBeNull()
    expect(screen.getByTitle('Satellites in view')).toHaveTextContent('2')
    expect(screen.queryByTitle('Elevation')).toBeNull() // no fix, so no elevation
    expect(container.querySelectorAll('svg.glyph')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: /Recent reports/ }))
    expect(screen.getByText('no fix · 2 sats')).toBeInTheDocument()
    cleanup()
    render(<SweepPanel now={Date.now()} tracks={[track({ positions: [pos(1)] })]} />)
    expect(screen.queryByTitle('Satellites in view')).toBeNull()
  })

  it('shows the mile marker from the team progress', () => {
    render(<SweepPanel now={Date.now()} progress={{ sw1: 5632.7 }} tracks={[track()]} />)
    expect(screen.getByText('Mile 3.5')).toBeInTheDocument()
  })

  it('omits the mile marker without a fix or a course', () => {
    render(<SweepPanel now={Date.now()} tracks={[track({ positions: [pos(0, { hasFix: false })] })]} />)
    expect(screen.queryByText(/^Mile/)).toBeNull()
  })

  describe('with the course stops', () => {
    const M = 1609.344
    const course = {
      name: 'C', distanceM: 20 * M, waypoints: [
        { name: 'Aid 1', lat: 0, lon: 0, passes: [{ distM: 10 * M, use: true, label: 'Powerlines', mile: 10.5, cutoffHours: 6.5, pacer: false, crew: 'Yes/Yes' }] },
        { name: 'Finish', lat: 0, lon: 0, passes: [{ distM: 20 * M, use: true, mile: 21 }] },
        { name: 'Start', lat: 0, lon: 0, passes: [{ distM: 0, use: true, mile: 0 }] },
      ],
      track: [{ lat: 0, lon: 0 }, { lat: 0.1, lon: 0 }, { lat: 0.2, lon: 0 }],
    }
    const stats = courseStats(course)!
    const here = { sw1: 4 * M } // 4 GPX miles in: 4.2 official miles

    it('shows the official mile and the next stop with its distance and cutoff', () => {
      render(<SweepPanel now={Date.now()} progress={here} stats={stats} cutoffLabel={(h) => formatClock(h, { weekday: 5, minutes: 720 })} tracks={[track()]} />)
      expect(screen.getByText('Mile 4.2')).toBeInTheDocument()
      expect(screen.getByText('Powerlines')).toBeInTheDocument()
      expect(screen.getByText(/· 6\.3 mi · cutoff Fri 6:30 PM/)).toBeInTheDocument()
    })

    it('shows the cutoff as hours after the start when there is no start time', () => {
      render(<SweepPanel now={Date.now()} progress={here} stats={stats} tracks={[track()]} />)
      expect(screen.getByText(/cutoff \+6\.5 h/)).toBeInTheDocument()
    })

    it('leaves out the cutoff when the next stop has none, and the line when there is no next stop', () => {
      const noCutoff = courseStats({ ...course, waypoints: course.waypoints.map((w) => ({ ...w, passes: w.passes.map((p) => ({ ...p, cutoffHours: undefined })) })) })!
      const { unmount } = render(<SweepPanel now={Date.now()} progress={here} stats={noCutoff} tracks={[track()]} />)
      expect(screen.getByText(/· 6\.3 mi$/)).toBeInTheDocument()
      expect(screen.queryByText(/cutoff/)).toBeNull()
      unmount()
      render(<SweepPanel now={Date.now()} progress={{ sw1: 20 * M }} stats={stats} tracks={[track()]} />)
      expect(screen.queryByText(/Next:/)).toBeNull() // at the finish
    })
  })
})
