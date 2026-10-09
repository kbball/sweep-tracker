import { render, screen } from '@testing-library/react'
import { fitBounds, leafletMock } from './test/leafletMock'
import { event, pos, track } from './test/fixtures'

vi.mock('react-leaflet', () => leafletMock)
import { SweepMap, boundsOf } from './SweepMap'

describe('SweepMap', () => {
  it('renders layers, course, waypoints and fading markers', () => {
    render(<SweepMap course={event().course} tracks={[track()]} />)
    expect(screen.getAllByTestId('baselayer').map((e) => JSON.parse(e.dataset.props!).name)).toEqual(['Topo', 'Terrain'])
    expect(screen.getAllByTestId('tile')[0].dataset.props).toContain('/tiles/topo/{z}/{x}/{y}.png')
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
    expect(fitBounds).toHaveBeenCalled()
  })

  it('skips no-fix reports on the map and uses custom layers', () => {
    const t = track({ positions: [pos(1, { hasFix: false }), pos(2)] })
    render(<SweepMap tracks={[t]} layers={[{ id: 'x', name: 'X', attribution: '', maxZoom: 10 }]} />)
    expect(screen.getAllByTestId('marker')).toHaveLength(1)
    expect(screen.queryByTestId('polyline')).toBeNull()
    expect(screen.getAllByTestId('baselayer')).toHaveLength(1)
  })

  it('computes bounds', () => {
    expect(boundsOf()).toBeUndefined()
    const b = boundsOf(event().course, [track(), track({ positions: [pos(1, { hasFix: false })] })]) as number[][]
    expect(b).toHaveLength(2 + 2 + 1)
  })
})
