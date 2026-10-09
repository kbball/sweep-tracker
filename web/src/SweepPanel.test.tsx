import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SweepPanel } from './SweepPanel'
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

  it('shows state chips, and expands the first team by default with fading history', () => {
    render(<SweepPanel now={Date.now()} tracks={tracks()} />)
    expect(screen.getByText('Moving')).toBeInTheDocument()
    expect(screen.getByText('No GPS fix')).toBeInTheDocument()
    expect(screen.getByText('No reports yet')).toBeInTheDocument()
    expect(screen.getAllByText(/3.77V/)).toHaveLength(3) // Sweep 1's three reports
    expect(screen.getAllByText(/1,500 ft/)).toHaveLength(4) // 3 history rows + the summary line
    expect(screen.getByText('3.77 V')).toBeInTheDocument() // summary line
    const ops = screen.getAllByRole('listitem').filter((li) => li.style.opacity).map((r) => Number(r.style.opacity))
    expect(ops[0]).toBe(1)
    expect(ops[1]).toBeLessThan(ops[0])
    expect(ops[2]).toBeLessThan(ops[1])
    expect(screen.getByRole('button', { name: /Sweep 1/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Sweep 2/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('expands the selected team and reports selection', async () => {
    const onSelect = vi.fn()
    render(<SweepPanel now={Date.now()} tracks={tracks()} selected="sw2" onSelect={onSelect} />)
    expect(screen.getByText('no fix · 3.50V')).toBeInTheDocument()
    expect(screen.getByText(/stopped$/)).toBeInTheDocument()
    expect(screen.queryAllByText(/1,500 ft/)).toHaveLength(1) // only sw2's second report has altitude
    await userEvent.click(screen.getByRole('button', { name: /Sweep 3/ }))
    expect(onSelect).toHaveBeenCalledWith('sw3')
  })

  it('shows the mile marker from the team progress', () => {
    render(<SweepPanel now={Date.now()} progress={{ sw1: 5632.7 }} tracks={[track()]} />)
    expect(screen.getByText('Mile 3.5')).toBeInTheDocument()
  })

  it('omits the mile marker without a fix or a course', () => {
    render(<SweepPanel now={Date.now()} tracks={[track({ positions: [pos(0, { hasFix: false })] })]} />)
    expect(screen.queryByText(/^Mile/)).toBeNull()
  })
})
