import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AidStationFocus } from './AidStationFocus'
import { courseStats } from './course'
import { track } from './test/fixtures'

const stats = courseStats({
  name: 'C', distanceM: 0,
  track: Array.from({ length: 51 }, (_, i) => ({ lat: i / 1000, lon: 0 })),
  waypoints: [{ name: 'Aid 1', lat: 0.02, lon: 0, passes: [{ distM: 2224, use: true }] }, { name: 'Bare', lat: 0.04, lon: 0 }],
})!
const tracks = [track(), track({ trackerName: 'sw2', label: 'Sweep 2' }), track({ trackerName: 'sw3', label: 'Sweep 3' }), track({ trackerName: 'sw4', label: 'Sweep 4' })]

describe('AidStationFocus', () => {
  it('lists the stops and reports a choice', async () => {
    const onChange = vi.fn()
    render(<AidStationFocus stats={stats} tracks={tracks} active={undefined} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('My aid station'), '2224')
    expect(onChange).toHaveBeenCalledWith('2224')
    await userEvent.selectOptions(screen.getByLabelText('My aid station'), 'None')
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
  it('says where each team is relative to the station', () => {
    render(<AidStationFocus stats={stats} tracks={tracks} active="2224" onChange={() => {}} cutoffLabel={(h) => `T${h}`}
      progress={{ sw1: 1000, sw2: 2224, sw3: 3000 }} />)
    expect(screen.getByText(/Sweep 1 \d\.\d mi away/)).toBeInTheDocument()
    expect(screen.getByText('Sweep 2 is here')).toBeInTheDocument()
    expect(screen.getByText('Sweep 3 has passed')).toBeInTheDocument()
    expect(screen.queryByText(/Sweep 4/)).toBeNull() // not placed yet
  })
  it('renders nothing for a course without stops', () => {
    const none = courseStats({ name: 'C', distanceM: 0, track: [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }], waypoints: [] })!
    const { container } = render(<AidStationFocus stats={none} tracks={[]} onChange={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
