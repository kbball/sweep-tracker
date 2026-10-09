import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fitBounds, invalidateSize, leafletMock, panTo, setView, zoomIn, zoomOut } from './test/leafletMock'
import { event, pos, track } from './test/fixtures'

vi.mock('react-leaflet', () => leafletMock)
import { DEFAULT_ZOOM, SweepMap, boundsOf, centerOf, defaultZoom, usableMaxZoom } from './SweepMap'

describe('SweepMap', () => {
  it('renders layers, course, waypoints and fading markers', () => {
    render(<SweepMap course={event().course} tracks={[track()]} />)
    expect(screen.getAllByTestId('baselayer').map((e) => JSON.parse(e.dataset.props!).name)).toEqual(['Topo'])
    expect(screen.getAllByTestId('tile')[0].dataset.props).toContain('/api/tiles/topo/{z}/{x}/{y}.png')
    expect(screen.getAllByTestId('polyline')).toHaveLength(1)
    const markers = screen.getAllByTestId('marker').map((e) => JSON.parse(e.dataset.props!))
    expect(markers).toHaveLength(2 + 3) // 2 waypoints + 3 positions
    const reports = markers.slice(2)
    expect(reports[0].radius).toBeGreaterThan(reports[1].radius)
    expect(reports[0].pathOptions.fillOpacity).toBeGreaterThan(reports[1].pathOptions.fillOpacity)
    expect(reports[1].pathOptions.fillOpacity).toBeGreaterThan(reports[2].pathOptions.fillOpacity)
    expect(screen.getByText('Sweep 1')).toBeInTheDocument()
    expect(screen.getByText('Aid 1')).toBeInTheDocument()
    expect(screen.getByText('Waypoint')).toBeInTheDocument()
    expect(setView).toHaveBeenCalled()
  })

  it('skips no-fix reports on the map and uses custom layers', () => {
    const t = track({ positions: [pos(1, { hasFix: false }), pos(2)] })
    render(<SweepMap tracks={[t]} layers={[{ id: 'x', name: 'X', attribution: '', maxZoom: 10 }]} />)
    expect(screen.getAllByTestId('marker')).toHaveLength(1)
    expect(screen.queryByTestId('polyline')).toBeNull()
    expect(screen.getAllByTestId('baselayer')).toHaveLength(1)
  })

  it('opens centred on the course at the default zoom', () => {
    setView.mockClear()
    render(<SweepMap course={event().course} tracks={[]} />)
    expect(DEFAULT_ZOOM).toBe(10)
    expect(setView).toHaveBeenCalledTimes(1)
    const [c, z] = setView.mock.calls[0]
    expect(z).toBe(10)
    expect(c[0]).toBeCloseTo(39.705, 3) // midpoint of the course bounds
    expect(c[1]).toBeCloseTo(-105.005, 3)
    expect(JSON.parse(screen.getByTestId('map').dataset.props!).zoom).toBe(10)
  })

  it('opens half way between the shallowest and deepest downloaded zoom', () => {
    const base = { id: 't', name: 'T', attribution: '', maxZoom: 16 }
    expect(defaultZoom([{ ...base, tileCount: 10, minTileZoom: 6, maxTileZoom: 15 }])).toBe(10) // 10.5 rounds down
    expect(defaultZoom([{ ...base, tileCount: 10, minTileZoom: 8, maxTileZoom: 12 }])).toBe(10)
    expect(defaultZoom([{ ...base, tileCount: 10, maxTileZoom: 12 }])).toBe(6) // no minimum reported: from 0
    expect(defaultZoom([{ ...base, tileCount: 0, maxTileZoom: 0 }, { ...base, id: 'u', tileCount: 5, minTileZoom: 4, maxTileZoom: 8 }])).toBe(6) // skips layers without tiles
    expect(defaultZoom([{ ...base, tileCount: 0, maxTileZoom: 0 }])).toBe(DEFAULT_ZOOM)
    expect(defaultZoom([])).toBe(DEFAULT_ZOOM)
    setView.mockClear()
    render(<SweepMap course={event().course} tracks={[]} layers={[{ ...base, tileCount: 10, minTileZoom: 8, maxTileZoom: 14 }]} />)
    expect(setView.mock.calls[0][1]).toBe(11)
  })

  it('has no centre without a course', () => {
    expect(centerOf(undefined)).toBeUndefined()
    expect(centerOf([])).toBeUndefined()
    setView.mockClear()
    render(<SweepMap tracks={[]} />)
    expect(setView).not.toHaveBeenCalled()
    expect(JSON.parse(screen.getByTestId('map').dataset.props!).zoom).toBe(4)
  })

  it('does not re-centre the view on re-render, only when the course changes', () => {
    const course = event().course
    setView.mockClear()
    const { rerender } = render(<SweepMap course={course} tracks={[track()]} />)
    expect(setView).toHaveBeenCalledTimes(1)
    rerender(<SweepMap course={event().course} tracks={[track(), track()]} />)
    expect(setView).toHaveBeenCalledTimes(1)
    rerender(<SweepMap course={{ ...course!, track: [{ lat: 1, lon: 2, ele: 0 }, { lat: 3, lon: 4, ele: 0 }], waypoints: [] }} tracks={[]} />)
    expect(setView).toHaveBeenCalledTimes(2)
  })

  it('caps zoom at the deepest downloaded level', () => {
    const base = { id: 't', name: 'T', attribution: '', maxZoom: 16 }
    expect(usableMaxZoom({ ...base, tileCount: 10, maxTileZoom: 12 })).toBe(12)
    expect(usableMaxZoom({ ...base, tileCount: 10, maxTileZoom: 20 })).toBe(16)
    expect(usableMaxZoom({ ...base, tileCount: 0, maxTileZoom: 0 })).toBe(16)
    expect(usableMaxZoom(base)).toBe(16)
    render(<SweepMap tracks={[]} layers={[{ ...base, tileCount: 10, maxTileZoom: 12 }]} />)
    expect(JSON.parse(screen.getAllByTestId('tile')[0].dataset.props!).maxZoom).toBe(12)
  })

  it('has zoom and fit controls, and pans to a focused team', async () => {
    const u = userEvent.setup()
    zoomIn.mockClear(); zoomOut.mockClear(); fitBounds.mockClear(); panTo.mockClear()
    const { rerender } = render(<SweepMap course={event().course} tracks={[]} />)
    await u.click(screen.getByRole('button', { name: 'Zoom in' }))
    await u.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(zoomIn).toHaveBeenCalledTimes(1)
    expect(zoomOut).toHaveBeenCalledTimes(1)
    fitBounds.mockClear()
    await u.click(screen.getByRole('button', { name: 'Fit to course' }))
    expect(fitBounds).toHaveBeenCalledTimes(1)
    expect(panTo).not.toHaveBeenCalled()
    rerender(<SweepMap course={event().course} tracks={[]} focus={{ lat: 39.7, lon: -105, seq: 1 }} />)
    expect(panTo).toHaveBeenCalledWith([39.7, -105])
  })

  it('re-measures the map when its container is resized', () => {
    let notify = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { notify = cb } observe() {} disconnect() { disconnect() } })
    invalidateSize.mockClear()
    const { unmount } = render(<SweepMap tracks={[]} />)
    notify()
    expect(invalidateSize).toHaveBeenCalledTimes(1)
    unmount()
    expect(disconnect).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('disables fit when there is no course', () => {
    render(<SweepMap tracks={[]} />)
    expect(screen.getByRole('button', { name: 'Fit to course' })).toBeDisabled()
  })

  it('computes bounds', () => {
    expect(boundsOf()).toBeUndefined()
    const b = boundsOf(event().course, [track(), track({ positions: [pos(1, { hasFix: false })] })]) as number[][]
    expect(b).toHaveLength(2 + 2 + 1)
  })
})
