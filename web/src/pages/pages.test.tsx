import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../api'
import { App } from '../App'
import { event, pos, track } from '../test/fixtures'
import { markTourSeen } from '../tourState'

vi.mock('react-leaflet', async () => (await import('../test/leafletMock')).leafletMock)

class FakeES { onopen?: () => void; onerror?: () => void; addEventListener() {} close() {} }

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
const maps = { layers: [{ id: 'topo', name: 'Topo', attribution: '', minZoom: 0, maxZoom: 16, tileCount: 1234, sizeBytes: 45_300_000, minTileZoom: 6, maxTileZoom: 12 }], status: { running: false, done: 0, total: 0 } }

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeES)
  vi.spyOn(api, 'maps').mockResolvedValue(maps)
  vi.spyOn(api, 'config').mockResolvedValue({ version: '1' })
  localStorage.clear()
  markTourSeen() // the first-run tour has its own tests
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('first-run tour', () => {
  it('greets a new user on any page, once, and Tour in the header replays it', async () => {
    localStorage.clear()
    vi.spyOn(api, 'listEvents').mockResolvedValue([event()])
    const { unmount } = at('/')
    await userEvent.click(await screen.findByRole('button', { name: 'No thanks' }))
    await userEvent.click(screen.getByRole('button', { name: 'Tour' }))
    expect(screen.getByRole('dialog', { name: 'Welcome to Sweep Tracker' })).toBeInTheDocument()
    unmount()
    localStorage.setItem('sweep-tour-seen', '1')
    at('/')
    await screen.findByRole('link', { name: 'Test 50K' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('active aid station', () => {
  const course = {
    name: 'OAB', distanceM: 0,
    track: Array.from({ length: 51 }, (_, i) => ({ lat: i / 1000, lon: 0 })),
    waypoints: [{ name: 'Aid 1', lat: 0.02, lon: 0, passes: [{ distM: 2224, use: true, mile: 1.4, cutoffHours: 3, crew: 'Crew: Sam' }] }],
  }
  const setup = () => {
    vi.spyOn(api, 'getEvent').mockResolvedValue(event({ course }))
    vi.spyOn(api, 'positions').mockResolvedValue([track({ positions: [pos(1, { lat: 0.01, lon: 0 })] })])
  }
  it('focuses and highlights the chosen station, shows how far each team is, and remembers it', async () => {
    setup()
    const u = userEvent.setup()
    const { unmount } = at('/e/e1')
    await u.selectOptions(await screen.findByLabelText('My aid station'), '2224')
    expect(screen.getByText(/Mile 1\.4 · cutoff \+3h · Crew: Sam/)).toBeInTheDocument()
    expect(screen.getByText(/Sweep 1 0\.7 mi away|Sweep 1 \d\.\d mi away/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Aid 1/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByTestId('marker').map((m) => m.dataset.props).join()).toContain('"radius":16')
    expect(localStorage.getItem('sweep-aid-station-e1')).toBe('2224')
    unmount()
    at('/e/e1')
    expect(await screen.findByLabelText('My aid station')).toHaveValue('2224')
  })
  it('selects by clicking or keyboard on the strip, and clears again', async () => {
    setup()
    const u = userEvent.setup()
    at('/e/e1')
    const stop = await screen.findByRole('button', { name: /^Aid 1/ })
    await u.click(stop)
    expect(screen.getByLabelText('My aid station')).toHaveValue('2224')
    stop.focus()
    await u.keyboard('{Enter}')
    expect(screen.getByLabelText('My aid station')).toHaveValue('')
    expect(localStorage.getItem('sweep-aid-station-e1')).toBeNull()
  })
  it('ignores a remembered station that is no longer on the course', async () => {
    setup()
    localStorage.setItem('sweep-aid-station-e1', '99999')
    at('/e/e1')
    expect(await screen.findByLabelText('My aid station')).toHaveValue('')
  })
})

describe('HomePage', () => {
  it('lists events', async () => {
    vi.spyOn(api, 'listEvents').mockResolvedValue([event()])
    at('/')
    expect(await screen.findByRole('link', { name: 'Test 50K' })).toHaveAttribute('href', '/e/e1')
  })
  it('shows course, waypoint and team info on each event card', async () => {
    vi.spyOn(api, 'listEvents').mockResolvedValue([
      event({ date: new Date().toISOString() }),
      event({ id: 'e2', name: 'Old 10K', date: '2020-01-01T00:00:00Z', course: null, trackers: [] }),
    ])
    at('/')
    expect(await screen.findByText('Today')).toBeInTheDocument()
    expect(screen.getByText('10.0 mi')).toBeInTheDocument()
    expect(screen.getByText('2 waypoints')).toBeInTheDocument()
    expect(screen.getByText('1 team')).toBeInTheDocument()
    expect(screen.getByText('Past')).toBeInTheDocument()
    expect(screen.getByText('No course')).toBeInTheDocument()
    expect(screen.getByText('0 teams')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin')
  })
  it('shows empty state and errors', async () => {
    vi.spyOn(api, 'listEvents').mockResolvedValueOnce([])
    const { unmount } = at('/')
    expect(await screen.findByText(/No events yet/)).toBeInTheDocument()
    unmount()
    vi.spyOn(api, 'listEvents').mockRejectedValueOnce(new Error('db down'))
    at('/')
    expect(await screen.findByRole('alert')).toHaveTextContent('db down')
  })
})

describe('MapPage', () => {
  it('renders event, sweeps and map', async () => {
    vi.spyOn(api, 'getEvent').mockResolvedValue(event())
    vi.spyOn(api, 'positions').mockResolvedValue([track()])
    at('/e/e1')
    expect(await screen.findByText('Test 50K')).toBeInTheDocument()
    expect(screen.getByText('Moving')).toBeInTheDocument()
    expect(screen.getByTestId('map')).toBeInTheDocument()
    expect(screen.getByTitle('Reconnecting')).toBeInTheDocument()
  })
  it('keeps a long history for progress but shows only the newest reports', async () => {
    // An out-and-back course; the team has been out to the turnaround and is on its way home.
    const course = {
      name: 'OAB', distanceM: 0,
      track: [...Array.from({ length: 51 }, (_, i) => ({ lat: i / 1000, lon: 0 })), ...Array.from({ length: 50 }, (_, i) => ({ lat: (49 - i) / 1000, lon: 0 }))],
      waypoints: [{ name: 'Aid 1', lat: 0.02, lon: 0, passes: [{ distM: 2224, use: true }, { distM: 8896, use: true }] }],
    }
    const fixes = [0.01, 0.02, 0.03, 0.04, 0.05, 0.045, 0.04, 0.035, 0.03, 0.025, 0.021].map((lat, i) =>
      pos(11 - i, { lat, lon: 0, time: new Date(Date.UTC(2026, 9, 10, 8, i * 10)).toISOString() }))
    const getPositions = vi.spyOn(api, 'positions').mockResolvedValue([track({ positions: [...fixes].reverse() })]) // the API returns newest first
    vi.spyOn(api, 'getEvent').mockResolvedValue(event({ course }))
    at('/e/e1')
    expect(await screen.findByText('Mile 5.5')).toBeInTheDocument() // 0.021° on the way back, not mile 1.3 on the way out
    expect(getPositions).toHaveBeenCalledWith('e1', 500)
    expect(screen.queryAllByRole('listitem').filter((li) => li.style.opacity)).toHaveLength(0) // reports stay tucked away until opened
    await userEvent.click(screen.getByRole('button', { name: /Recent reports \(8\)/ })) // only the newest 8 are kept for display
    expect(screen.getAllByRole('listitem').filter((li) => li.style.opacity)).toHaveLength(8)
    expect(screen.getByLabelText(/^Aid 1 \(out\) · mi 1\.4/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Aid 1 \(in\) · mi 5\.5/)).toBeInTheDocument()
  })
  it('prompts for a course when missing and ticks the clock', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.spyOn(api, 'getEvent').mockResolvedValue(event({ course: null }))
    vi.spyOn(api, 'positions').mockResolvedValue([])
    at('/e/e1')
    expect(await screen.findByText(/No course loaded/)).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(16_000) })
    vi.useRealTimers()
  })
  it('shows loading then error', async () => {
    vi.spyOn(api, 'getEvent').mockRejectedValue(new Error('not found'))
    vi.spyOn(api, 'positions').mockResolvedValue([])
    at('/e/zzz')
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('not found')
  })
  it('survives maps endpoint failure', async () => {
    vi.spyOn(api, 'maps').mockRejectedValue(new Error('x'))
    vi.spyOn(api, 'getEvent').mockResolvedValue(event())
    vi.spyOn(api, 'positions').mockResolvedValue([])
    at('/e/e1')
    expect(await screen.findByTestId('map')).toBeInTheDocument()
  })
})

describe('App', () => {
  it('renders not-found', () => {
    at('/nope')
    expect(screen.getByText(/Not found/)).toBeInTheDocument()
  })
})

describe('AdminPage', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listEvents').mockResolvedValue([event()])
    vi.spyOn(api, 'knownTrackers').mockResolvedValue([{ name: 'sw1', lastSeen: '' }, { name: 'sw2', lastSeen: '' }])
  })

  it('creates, selects, edits and deletes events', async () => {
    const u = userEvent.setup()
    const create = vi.spyOn(api, 'createEvent').mockResolvedValue(event({ id: 'e2', name: 'New' }))
    const del = vi.spyOn(api, 'deleteEvent').mockResolvedValue()
    const update = vi.spyOn(api, 'updateEvent').mockResolvedValue(event({ name: 'Renamed' }))
    at('/admin')
    await u.click(await screen.findByRole('button', { name: 'Edit Test 50K' }))
    expect(screen.getByDisplayValue('Test 50K')).toBeInTheDocument()
    expect(screen.getByText(/Loop: 10.0 mi, 2 waypoints/)).toBeInTheDocument()

    await u.clear(screen.getByLabelText('Name'))
    await u.type(screen.getByLabelText('Name'), 'Renamed')
    await u.click(screen.getByRole('button', { name: 'Save details' }))
    expect(update).toHaveBeenCalledWith('e1', expect.objectContaining({ name: 'Renamed' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Details saved')

    await u.type(screen.getByLabelText('New event name'), 'New')
    await u.click(screen.getByRole('button', { name: 'Create' }))
    expect(create).toHaveBeenCalled()

    await u.click(screen.getByRole('button', { name: 'Delete Test 50K' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete Test 50K?')
    await u.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(del).not.toHaveBeenCalled()
    await u.click(screen.getByRole('button', { name: 'Delete Test 50K' }))
    await u.click(screen.getByRole('button', { name: 'Delete event' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(del).toHaveBeenCalledWith('e1')
  })

  describe('setup guide', () => {
    const M = 1609.344
    const course = {
      name: 'C', distanceM: 20 * M, track: [{ lat: 0, lon: 0 }, { lat: 0.1, lon: 0 }],
      waypoints: [{ name: 'Aid', lat: 0.05, lon: 0, passes: [{ distM: 5 * M, use: true, mile: 5.2 }, { distM: 15 * M, use: true }] }],
    }
    const stepOf = (title: string) => screen.getByText(title, { selector: 'strong' }).closest('li')!
    // jsdom has no scrollIntoView: tests that add one put things back as they were.
    afterEach(() => { delete (Element.prototype as Partial<Element>).scrollIntoView })

    it('outlines the order before an event is chosen', async () => {
      vi.spyOn(api, 'listEvents').mockResolvedValue([event()])
      at('/admin')
      const guide = await screen.findByRole('region', { name: 'Setup guide' })
      expect(within(guide).getByRole('heading', { name: 'Setting up an event' })).toBeInTheDocument()
      const steps = within(guide).getAllByRole('listitem').map((li) => within(li).getByText(/./, { selector: 'strong' }).textContent)
      expect(steps).toEqual(['Event details', 'Course', 'Aid stations and cutoffs', 'Sweep teams', 'Offline maps', 'Trackers reporting'])
    })

    it('shows where the selected event stands, and updates as it is set up', async () => {
      const u = userEvent.setup()
      vi.spyOn(api, 'knownTrackers').mockResolvedValue([{ name: 'sw1', lastSeen: 'x' }])
      vi.spyOn(api, 'listEvents').mockResolvedValue([event({ course, date: '2026-10-09T00:00:00Z', startTime: '12:00' })])
      at('/admin')
      await u.click(await screen.findByRole('button', { name: 'Edit Test 50K' }))
      const guide = screen.getByRole('group', { name: 'Setup guide' })
      await waitFor(() => expect(within(stepOf('Offline maps')).getByText('Done')).toBeInTheDocument()) // tiles are downloaded
      expect(within(guide).getByText('5 of 6 done')).toBeInTheDocument() // all but the team starts
      expect(within(stepOf('Event details')).getByText('Done')).toBeInTheDocument()
      expect(within(stepOf('Aid stations and cutoffs')).getByText('Done')).toBeInTheDocument()
      expect(within(stepOf('Sweep teams')).getByText('To do')).toBeInTheDocument() // an out-and-back course needs each team's start
    })

    it('says what is waiting on what for an event with nothing set up', async () => {
      const u = userEvent.setup()
      vi.spyOn(api, 'knownTrackers').mockResolvedValue([])
      vi.spyOn(api, 'listEvents').mockResolvedValue([event({ course: null, startTime: undefined, trackers: [] })])
      at('/admin')
      await u.click(await screen.findByRole('button', { name: 'Edit Test 50K' }))
      expect(within(stepOf('Course')).getByText('To do')).toBeInTheDocument()
      expect(within(stepOf('Aid stations and cutoffs')).getByText('Waiting')).toBeInTheDocument()
      expect(within(stepOf('Offline maps')).getByText('Waiting')).toBeInTheDocument()
      expect(within(stepOf('Trackers reporting')).getByText('Waiting')).toBeInTheDocument()
      expect(within(stepOf('Share')).getByText('Optional')).toBeInTheDocument()
      expect(screen.getByText('0 of 6 done')).toBeInTheDocument()
    })

    it('marks the maps step done once a download brings tiles in', async () => {
      const u = userEvent.setup()
      vi.spyOn(api, 'knownTrackers').mockResolvedValue([])
      vi.spyOn(api, 'listEvents').mockResolvedValue([event({ course })])
      const empty = { ...maps, layers: [{ ...maps.layers[0], tileCount: 0 }] }
      vi.spyOn(api, 'maps').mockResolvedValueOnce(empty).mockResolvedValue(maps)
      vi.spyOn(api, 'refreshMaps').mockResolvedValue({ running: false, done: 0, total: 0 })
      at('/admin')
      await u.click(await screen.findByRole('button', { name: 'Edit Test 50K' }))
      await waitFor(() => expect(within(stepOf('Offline maps')).getByText('To do')).toBeInTheDocument())
      await u.click(screen.getByRole('button', { name: /Download/ }))
      await waitFor(() => expect(within(stepOf('Offline maps')).getByText('Done')).toBeInTheDocument())
    })

    it('jumps to each step\'s section', async () => {
      const u = userEvent.setup()
      const scroll = vi.fn()
      Element.prototype.scrollIntoView = scroll
      vi.spyOn(api, 'knownTrackers').mockResolvedValue([])
      vi.spyOn(api, 'listEvents').mockResolvedValue([event({ course })])
      at('/admin')
      await u.click(await screen.findByRole('button', { name: 'Edit Test 50K' }))
      const expected: Record<string, string> = {
        'Event details': 'setup-details', Course: 'setup-course', 'Aid stations and cutoffs': 'setup-stops',
        'Sweep teams': 'setup-teams', 'Offline maps': 'setup-maps', 'Trackers reporting': 'setup-teams', Share: 'setup-share',
      }
      for (const [title, id] of Object.entries(expected)) {
        scroll.mockClear()
        await u.click(screen.getByRole('button', { name: `Go to ${title}` }))
        expect(scroll).toHaveBeenCalledTimes(1)
        expect(scroll.mock.contexts[0]).toBe(document.getElementById(id))
        expect(document.getElementById(id)).not.toBeNull()
      }
    })

    it('does not fail where scrolling is unavailable, and can be collapsed', async () => {
      const u = userEvent.setup()
      vi.spyOn(api, 'knownTrackers').mockResolvedValue([])
      vi.spyOn(api, 'listEvents').mockResolvedValue([event({ course })])
      at('/admin')
      await u.click(await screen.findByRole('button', { name: 'Edit Test 50K' }))
      await u.click(screen.getByRole('button', { name: 'Go to Course' }))
      const guide = screen.getByRole('group', { name: 'Setup guide' }) as HTMLDetailsElement
      expect(guide.open).toBe(true)
      await u.click(within(guide).getByText('Setup guide'))
      expect(guide.open).toBe(false)
    })

    it('lays the sections out in the order of the steps', async () => {
      const u = userEvent.setup()
      vi.spyOn(api, 'knownTrackers').mockResolvedValue([])
      vi.spyOn(api, 'listEvents').mockResolvedValue([event({ course })])
      at('/admin')
      await u.click(await screen.findByRole('button', { name: 'Edit Test 50K' }))
      const headings = Array.from(document.querySelectorAll('fieldset.panel h3, fieldset.panel legend')).map((h) => h.textContent)
      const order = ['1 · Event details', '2 · Course', '3 · Aid stations', '4 · Sweep teams', 'Share', '5 · Offline maps']
      for (const t of order) expect(headings).toContain(t)
      for (let i = 1; i < order.length; i++) expect(headings.indexOf(order[i])).toBeGreaterThan(headings.indexOf(order[i - 1]))
    })
  })

  describe('aid stations', () => {
    // An out-and-back course: Aid 1 on the way out and back, and the turnaround, so three stops in this order.
    const M = 1609.344
    const stopsCourse = {
      name: 'C', distanceM: 20 * M, track: [{ lat: 0, lon: 0 }, { lat: 0.1, lon: 0 }, { lat: 0.2, lon: 0 }],
      waypoints: [
        { name: 'Aid 1', lat: 0.05, lon: 0, passes: [{ distM: 3.5 * M, use: true }, { distM: 10.4 * M, use: true }] },
        { name: 'Turn', lat: 0.1, lon: 0, passes: [{ distM: 6.9 * M, use: true }] },
      ],
    }
    const friday = '2026-10-09T00:00:00Z'
    const open = async (over = {}) => {
      const u = userEvent.setup()
      const ev = event({ course: stopsCourse, date: friday, startTime: '12:00', ...over })
      vi.spyOn(api, 'listEvents').mockResolvedValue([ev])
      at('/admin')
      await u.click(await screen.findByRole('button', { name: 'Edit Test 50K' }))
      return { u, ev }
    }
    const table = `Aid Station
Mile
Miles to next AS
Miles to Finish
Cut-off Time
Pacer
Crew Access/
Drop-Bag
Start
0
3.2


12pm



Powerlines
3.2
3.4
3.4
1PM 


NO 
Finish
6.6




9 PM Saturday
Yes
Yes/Yes
`

    it('has a row for every pass of the course, in course order', async () => {
      await open()
      expect(screen.getAllByRole('checkbox', { name: /is a real stop/ })).toHaveLength(3)
      const names = screen.getAllByRole('row').slice(1).map((r) => r.textContent)
      expect(names[0]).toContain('Aid 1')
      expect(names[0]).toContain('GPX mi 3.5')
      expect(names[1]).toContain('Turn')
      expect(names[2]).toContain('GPX mi 10.4')
    })

    it('saves what you type, reading cutoffs as clock times', async () => {
      const { u, ev } = await open()
      const save = vi.spyOn(api, 'setStops').mockResolvedValue(ev)
      const update = vi.spyOn(api, 'updateEvent').mockResolvedValue(ev)
      await u.type(screen.getByLabelText('Name of stop 1'), 'Powerlines')
      await u.type(screen.getByLabelText('Mile of stop 1'), '3.2')
      await u.type(screen.getByLabelText('Cutoff of stop 1'), '1PM')
      await u.tab()
      expect(screen.getByLabelText('Cutoff of stop 1')).toHaveValue('Fri 1:00 PM') // tidied up
      await u.type(screen.getByLabelText('Cutoff of stop 3'), '9:30 PM Saturday')
      await u.tab()
      expect(screen.getByLabelText('Cutoff of stop 3')).toHaveValue('Sat 9:30 PM')
      await u.type(screen.getByLabelText('Crew and drop bag at stop 3'), ' Yes/Yes ')
      await u.click(screen.getByLabelText('Pacers allowed from stop 3'))
      await u.click(screen.getByLabelText('Stop 2 is a real stop')) // untick the turnaround
      await u.click(screen.getByRole('button', { name: 'Save aid stations' }))
      expect(save).toHaveBeenCalledWith('e1', [
        { use: true, label: 'Powerlines', mile: 3.2, cutoffHours: 1, pacer: false, crew: '' },
        { use: false, label: '', mile: undefined, cutoffHours: undefined, pacer: false, crew: '' },
        { use: true, label: '', mile: undefined, cutoffHours: 33.5, pacer: true, crew: 'Yes/Yes' },
      ])
      expect(update).not.toHaveBeenCalled() // the start time is unchanged
      expect(await screen.findByRole('status')).toHaveTextContent('Aid stations saved')
    })

    it('shows saved details, and cutoffs as hours when there is no start time', async () => {
      const course = { ...stopsCourse, waypoints: [
        { ...stopsCourse.waypoints[0], passes: [{ distM: 3.5 * M, use: true, label: 'Powerlines', mile: 3.2, cutoffHours: 1, pacer: true, crew: 'NO' }, stopsCourse.waypoints[0].passes[1]] },
        stopsCourse.waypoints[1],
      ] }
      await open({ course, startTime: undefined })
      expect(screen.getByLabelText('Name of stop 1')).toHaveValue('Powerlines')
      expect(screen.getByLabelText('Mile of stop 1')).toHaveValue('3.2')
      expect(screen.getByLabelText('Cutoff of stop 1')).toHaveValue('+1 h')
      expect(screen.getByLabelText('Pacers allowed from stop 1')).toBeChecked()
      expect(screen.getByLabelText('Crew and drop bag at stop 1')).toHaveValue('NO')
    })

    it('accepts cutoffs as hours after the start, even without a start time', async () => {
      const { u } = await open({ startTime: undefined })
      await u.type(screen.getByLabelText('Cutoff of stop 2'), '+6.5h')
      await u.tab()
      expect(screen.getByLabelText('Cutoff of stop 2')).toHaveValue('+6.5 h')
      await u.type(screen.getByLabelText('Cutoff of stop 1'), '6PM Friday') // needs a start time to mean anything
      await u.tab()
      expect(screen.getByLabelText('Cutoff of stop 1')).toHaveAttribute('aria-invalid', 'true')
    })

    it('does not save a cutoff or mile it cannot read', async () => {
      const { u, ev } = await open()
      const save = vi.spyOn(api, 'setStops').mockResolvedValue(ev)
      await u.type(screen.getByLabelText('Cutoff of stop 2'), 'whenever')
      await u.tab()
      expect(screen.getByLabelText('Cutoff of stop 2')).toHaveAttribute('aria-invalid', 'true')
      await u.click(screen.getByRole('button', { name: 'Save aid stations' }))
      expect(screen.getByRole('alert')).toHaveTextContent(`Stop 2: I can't read the cutoff "whenever"`)
      await u.clear(screen.getByLabelText('Cutoff of stop 2')) // blank is fine: no cutoff
      await u.tab()
      await u.type(screen.getByLabelText('Mile of stop 3'), 'abc')
      await u.click(screen.getByRole('button', { name: 'Save aid stations' }))
      expect(screen.getByRole('alert')).toHaveTextContent('Stop 3: the mile must be a number')
      expect(save).not.toHaveBeenCalled()
    })

    it('fills the table from the pasted handbook, and keeps cutoffs in order', async () => {
      const { u, ev } = await open()
      const save = vi.spyOn(api, 'setStops').mockResolvedValue(ev)
      await u.click(screen.getByText('Fill from the runner handbook'))
      await u.click(screen.getByLabelText('Paste the aid station table'))
      await u.paste(table)
      await u.click(screen.getByRole('button', { name: 'Fill the table' }))
      expect(screen.getByLabelText('Name of stop 1')).toHaveValue('Start')
      expect(screen.getByLabelText('Mile of stop 2')).toHaveValue('3.2')
      expect(screen.getByLabelText('Cutoff of stop 1')).toHaveValue('Fri 12:00 PM')
      expect(screen.getByLabelText('Cutoff of stop 2')).toHaveValue('Fri 1:00 PM')
      expect(screen.getByLabelText('Cutoff of stop 3')).toHaveValue('Sat 9:00 PM')
      expect(screen.getByLabelText('Pacers allowed from stop 3')).toBeChecked()
      expect(screen.getByLabelText('Crew and drop bag at stop 2')).toHaveValue('NO')
      expect(screen.queryByRole('status')).toBeNull() // no warnings for a clean table
      await u.click(screen.getByRole('button', { name: 'Save aid stations' }))
      expect(save.mock.calls[0][1].map((s) => s.cutoffHours)).toEqual([0, 1, 33])
    })

    it('works out the start time from the table when the event has none, and saves it with the stops', async () => {
      const { u, ev } = await open({ startTime: undefined })
      const update = vi.spyOn(api, 'updateEvent').mockResolvedValue(ev)
      const save = vi.spyOn(api, 'setStops').mockResolvedValue(ev)
      await u.click(screen.getByText('Fill from the runner handbook'))
      await u.click(screen.getByLabelText('Paste the aid station table'))
      await u.paste(table)
      await u.click(screen.getByRole('button', { name: 'Fill the table' }))
      expect(screen.getByLabelText('Start time')).toHaveValue('12:00')
      expect(screen.getByLabelText('Cutoff of stop 3')).toHaveValue('Sat 9:00 PM')
      await u.click(screen.getByRole('button', { name: 'Save aid stations' }))
      expect(update).toHaveBeenCalledWith('e1', expect.objectContaining({ startTime: '12:00', name: 'Test 50K' })) // the start time goes with them
      expect(save).toHaveBeenCalled()
      expect(update.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0])
    })

    it('says so when the table has a different number of rows, or is not a table', async () => {
      const { u } = await open()
      await u.click(screen.getByText('Fill from the runner handbook'))
      await u.click(screen.getByLabelText('Paste the aid station table'))
      await u.paste('Start\n0\n12pm\nFinish\n5\n')
      await u.click(screen.getByRole('button', { name: 'Fill the table' }))
      expect(screen.getByRole('status')).toHaveTextContent('The table has 2 rows but the course has 3 stops')
      expect(screen.getByLabelText('Name of stop 2')).toHaveValue('Finish')
      expect(screen.getByLabelText('Name of stop 3')).toHaveValue('') // left as it was
      await u.clear(screen.getByLabelText('Paste the aid station table'))
      await u.paste('12:00 only numbers 5 6')
      await u.click(screen.getByRole('button', { name: 'Fill the table' }))
      expect(screen.getByLabelText('Name of stop 1')).toBeInTheDocument()
      await u.clear(screen.getByLabelText('Paste the aid station table'))
      await u.paste('3.5\n6PM\nYes')
      await u.click(screen.getByRole('button', { name: 'Fill the table' }))
      expect(screen.getByRole('status')).toHaveTextContent('Nothing that looks like an aid station table')
    })

    it('lets each sweep team start from a stop, and saves the start time with the event', async () => {
      const { u, ev } = await open({ trackers: [{ trackerName: 'sw1', label: 'Sweep 1', color: '#e6194b' }, { trackerName: 'sw2', label: 'Sweep 2', color: '#00f', startM: 999 }] })
      const update = vi.spyOn(api, 'updateEvent').mockResolvedValue(ev)
      const first = screen.getByLabelText('Where Sweep 1 starts')
      expect(first).toHaveValue('')
      expect(within(first).getByRole('option', { name: 'Starts at Turn · mi 6.9' })).toBeInTheDocument() // from the saved stops
      await u.selectOptions(first, within(first).getByRole('option', { name: 'Starts at Aid 1 (in) · mi 10.4' }))
      expect(screen.getByLabelText('Where Sweep 2 starts')).toHaveValue('999') // not a stop: kept as it was
      expect(within(screen.getByLabelText('Where Sweep 2 starts')).getByRole('option', { name: 'Starts at mi 0.6 (not a stop)' })).toBeInTheDocument()
      await u.selectOptions(screen.getByLabelText('Where Sweep 2 starts'), '')
      await u.click(screen.getByRole('button', { name: 'Save teams' }))
      const sent = update.mock.calls[0][1]
      expect(sent.trackers?.[0].startM).toBeCloseTo(10.4 * M, 0)
      expect(sent.trackers?.[1].startM).toBeUndefined()
      expect(sent.startTime).toBe('12:00') // the saved start time: not whatever is being edited above
      expect(await screen.findByRole('status')).toHaveTextContent('Teams saved')
      fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '13:30' } })
      await u.click(screen.getByRole('button', { name: 'Save details' }))
      expect(update.mock.calls[1][1].startTime).toBe('13:30')
      expect(update.mock.calls[1][1].trackers?.[0].startM).toBeUndefined() // the saved teams, not the unsaved choice
    })

    it('offers the event file and a spreadsheet of the aid stations to share', async () => {
      const course = { ...stopsCourse, waypoints: [
        { ...stopsCourse.waypoints[0], passes: [{ distM: 3.5 * M, use: true, label: 'Powerlines', mile: 3.2, cutoffHours: 1 }, stopsCourse.waypoints[0].passes[1]] },
        stopsCourse.waypoints[1],
      ] }
      await open({ course })
      expect(screen.getByRole('link', { name: 'Event file (.sweep.json)' })).toHaveAttribute('href', '/api/events/e1/export')
      const csv = screen.getByRole('link', { name: 'Aid station table (CSV)' })
      expect(csv).toHaveAttribute('download', 'test-50k-aid-stations.csv')
      const text = decodeURIComponent(csv.getAttribute('href')!.replace('data:text/csv;charset=utf-8,', ''))
      expect(text).toContain('Powerlines,3.2,')
      expect(text).toContain('Fri 1:00 PM')
    })

    it('has no aid station table or CSV for an event without a course', async () => {
      const u = userEvent.setup()
      vi.spyOn(api, 'listEvents').mockResolvedValue([event({ course: null })])
      at('/admin')
      await u.click(await screen.findByRole('button', { name: 'Edit Test 50K' }))
      expect(screen.queryByText('Aid stations')).toBeNull()
      expect(screen.queryByRole('link', { name: /CSV/ })).toBeNull()
      expect(screen.getByRole('link', { name: /Event file/ })).toBeInTheDocument()
    })
  })

  it('gives each event explicit View, Edit and Delete actions', async () => {
    const u = userEvent.setup()
    at('/admin')
    expect(await screen.findByRole('link', { name: 'View Test 50K' })).toHaveAttribute('href', '/e/e1')
    const edit = screen.getByRole('button', { name: 'Edit Test 50K' })
    expect(edit).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('Editing')).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete Test 50K' })).toBeInTheDocument()
    await u.click(edit)
    expect(edit).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Editing')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Test 50K')).toBeInTheDocument() // the editor opened
  })

  it('edits trackers, uploads a course and reports errors', async () => {
    const u = userEvent.setup()
    const update = vi.spyOn(api, 'updateEvent').mockResolvedValue(event())
    const upload = vi.spyOn(api, 'uploadCourse').mockRejectedValueOnce(new Error('bad gpx')).mockResolvedValue(event())
    at('/admin')
    await u.click(await screen.findByRole('button', { name: 'Edit Test 50K' }))

    await u.selectOptions(screen.getByLabelText('Add tracker'), 'sw2')
    expect(screen.getByLabelText('Label for sw2')).toHaveValue('sw2')
    fireEvent.change(screen.getByLabelText('Color for sw2'), { target: { value: '#00ff00' } })
    await u.clear(screen.getByLabelText('Label for sw1'))
    await u.type(screen.getByLabelText('Label for sw1'), 'A')
    await u.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    // define a sweep before it has ever been heard on the mesh
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    await u.type(screen.getByLabelText('New tracker name'), '  Sweep9 {enter}')
    expect(screen.getByLabelText('Label for Sweep9')).toHaveValue('Sweep9')
    expect(screen.getByLabelText('New tracker name')).toHaveValue('')
    await u.type(screen.getByLabelText('New tracker name'), 'sw2')
    await u.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('alert')).toHaveTextContent('sw2 is already on this event')
    await u.click(screen.getByRole('button', { name: 'Save teams' }))
    expect(update.mock.calls[0][1]).toMatchObject({ name: 'Test 50K', startTime: '' }) // the saved details, not edits to them
    expect(update.mock.calls[0][1].trackers).toEqual([
      { trackerName: 'sw2', label: 'sw2', color: '#00ff00' },
      { trackerName: 'Sweep9', label: 'Sweep9', color: '' },
    ])

    const file = new File(['<gpx/>'], 'c.gpx')
    await u.upload(screen.getByLabelText('GPX file'), file)
    expect(await screen.findByRole('alert')).toHaveTextContent('bad gpx')
    await u.upload(screen.getByLabelText('GPX file'), new File(['<gpx/>'], 'd.gpx'))
    expect(await screen.findByRole('status')).toHaveTextContent('Course uploaded')
    expect(screen.getByRole('link', { name: /Event file/ })).toHaveAttribute('href', '/api/events/e1/export')
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('imports a shared event and shows API errors', async () => {
    const u = userEvent.setup()
    const imp = vi.spyOn(api, 'importEvent').mockResolvedValueOnce(event({ id: 'e9', name: 'Imported' })).mockRejectedValueOnce(new Error('unsupported bundle'))
    at('/admin')
    const input = await screen.findByLabelText('Import shared event')
    await u.upload(input, new File(['{}'], 'x.json'))
    await waitFor(() => expect(imp).toHaveBeenCalled())
    await u.upload(input, new File(['{}'], 'y.json'))
    expect(await screen.findByRole('alert')).toHaveTextContent('unsupported bundle')
  })

  it('surfaces load failures', async () => {
    vi.spyOn(api, 'listEvents').mockRejectedValue(new Error('offline'))
    at('/admin')
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
  })
})

describe('MapsPanel via admin', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listEvents').mockResolvedValue([event()])
    vi.spyOn(api, 'knownTrackers').mockResolvedValue([])
  })
  it('starts a refresh and shows progress, then errors', async () => {
    const u = userEvent.setup()
    const refresh = vi.spyOn(api, 'refreshMaps').mockResolvedValue({ running: true, done: 0, total: 0 })
    at('/admin')
    expect(await screen.findByText(/Topo: 1,234 tiles · 45.3 MB/)).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: /Download/ })
    expect(btn).toBeDisabled()
    await u.click(await screen.findByRole('button', { name: 'Edit Test 50K' }))
    fireEvent.change(screen.getByLabelText('Min zoom'), { target: { value: '9' } })
    fireEvent.change(screen.getByLabelText('Max zoom'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Buffer (m)'), { target: { value: '500' } })

    vi.spyOn(api, 'maps').mockResolvedValue({ ...maps, status: { running: true, layer: 'topo', done: 5, total: 10 } })
    await u.click(btn)
    expect(refresh).toHaveBeenCalledWith('e1', 9, 12, 500)
    expect(await screen.findByText(/topo: 5\/10/)).toBeInTheDocument()
    expect(screen.getByLabelText('Map download progress')).toHaveAttribute('value', '5')
  })
  it('clears offline maps only after confirmation', async () => {
    const u = userEvent.setup()
    const clear = vi.spyOn(api, 'clearMaps').mockResolvedValue(undefined)
    at('/admin')
    await u.click(await screen.findByRole('button', { name: 'Clear offline maps' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('deletes all downloaded map tiles')
    await u.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(clear).not.toHaveBeenCalled()
    await u.click(screen.getByRole('button', { name: 'Clear offline maps' }))
    await u.click(screen.getByRole('button', { name: 'Clear maps' }))
    expect(clear).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('shows an error when clearing fails', async () => {
    const u = userEvent.setup()
    vi.spyOn(api, 'clearMaps').mockRejectedValue(new Error('refresh in progress'))
    at('/admin')
    await u.click(await screen.findByRole('button', { name: 'Clear offline maps' }))
    await u.click(screen.getByRole('button', { name: 'Clear maps' }))
    expect(await screen.findByText('refresh in progress')).toBeInTheDocument()
  })
  it('reports refresh failure and backend error', async () => {
    const u = userEvent.setup()
    vi.spyOn(api, 'refreshMaps').mockRejectedValue(new Error('event has no course'))
    vi.spyOn(api, 'maps').mockResolvedValue({ ...maps, status: { running: false, done: 0, total: 0, error: 'topo: HTTP 500' } })
    at('/admin')
    await u.click(await screen.findByRole('button', { name: 'Edit Test 50K' }))
    await u.click(screen.getByRole('button', { name: /Download/ }))
    expect(await screen.findByText('event has no course')).toBeInTheDocument()
    expect(screen.getByText('topo: HTTP 500')).toBeInTheDocument()
  })
  it('handles maps load failure', async () => {
    vi.spyOn(api, 'maps').mockRejectedValue(new Error('maps down'))
    at('/admin')
    expect(await screen.findByText('maps down')).toBeInTheDocument()
  })
})
