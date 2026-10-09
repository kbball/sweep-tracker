import { render, screen } from '@testing-library/react'
import { SweepPanel } from './SweepPanel'
import { pos, track } from './test/fixtures'

describe('SweepPanel', () => {
  it('shows empty state', () => {
    render(<SweepPanel tracks={[]} now={0} />)
    expect(screen.getByText(/No sweep teams/)).toBeInTheDocument()
  })
  it('lists history with fading opacity and state badges', () => {
    const now = Date.now()
    render(<SweepPanel now={now} tracks={[
      track(),
      track({ trackerName: 'sw2', label: 'Sweep 2', positions: [pos(1, { hasFix: false, trackerName: 'sw2', batteryV: 3.5 }), pos(2, { alt: undefined, moving: false })] }),
      track({ trackerName: 'sw3', label: 'Sweep 3', positions: [] }),
    ]} />)
    expect(screen.getByText('Moving')).toBeInTheDocument()
    expect(screen.getByText('No GPS fix')).toBeInTheDocument()
    expect(screen.getByText('No reports yet')).toBeInTheDocument()
    expect(screen.getByText('no fix · 3.50V')).toBeInTheDocument()
    expect(screen.getAllByText(/3.77V/)).toHaveLength(4)
    expect(screen.getAllByText(/1,500 ft/)).toHaveLength(3)
    const rows = screen.getAllByRole('listitem').filter((li) => li.style.opacity)
    const ops = rows.slice(0, 3).map((r) => Number(r.style.opacity))
    expect(ops[0]).toBe(1)
    expect(ops[1]).toBeLessThan(ops[0])
    expect(ops[2]).toBeLessThan(ops[1])
  })
})
