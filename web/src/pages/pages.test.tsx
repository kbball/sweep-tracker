import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../api'
import { App } from '../App'
import { event, track } from '../test/fixtures'

vi.mock('react-leaflet', async () => (await import('../test/leafletMock')).leafletMock)

class FakeES { onopen?: () => void; onerror?: () => void; addEventListener() {} close() {} }

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
const maps = { layers: [{ id: 'topo', name: 'Topo', attribution: '', minZoom: 0, maxZoom: 16, tileCount: 1234, sizeBytes: 45_300_000, minTileZoom: 6, maxTileZoom: 12 }], status: { running: false, done: 0, total: 0 } }

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeES)
  vi.spyOn(api, 'maps').mockResolvedValue(maps)
  vi.spyOn(api, 'config').mockResolvedValue({ version: '1' })
  localStorage.clear()
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

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
    await u.click(screen.getByRole('button', { name: 'Save event' }))
    expect(update).toHaveBeenCalledWith('e1', expect.objectContaining({ name: 'Renamed' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')

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
    await u.click(screen.getByRole('button', { name: 'Save event' }))
    expect(update.mock.calls[0][1].trackers).toEqual([
      { trackerName: 'sw2', label: 'sw2', color: '#00ff00' },
      { trackerName: 'Sweep9', label: 'Sweep9', color: '' },
    ])

    const file = new File(['<gpx/>'], 'c.gpx')
    await u.upload(screen.getByLabelText('GPX file'), file)
    expect(await screen.findByRole('alert')).toHaveTextContent('bad gpx')
    await u.upload(screen.getByLabelText('GPX file'), new File(['<gpx/>'], 'd.gpx'))
    expect(await screen.findByRole('status')).toHaveTextContent('Course uploaded')
    expect(screen.getByRole('link', { name: /Export/ })).toHaveAttribute('href', '/api/events/e1/export')
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
