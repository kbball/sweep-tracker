import type { ReactNode } from 'react'

// Lightweight stand-ins so components can be tested in jsdom without a real map.
const box = (name: string) => ({ children, ...props }: { children?: ReactNode; [k: string]: unknown }) => (
  <div data-testid={name} data-props={JSON.stringify(props, (_k, v) => (typeof v === 'function' ? undefined : v))}>{children}</div>
)

export const fitBounds = vi.fn()

export const leafletMock = {
  MapContainer: box('map'),
  TileLayer: box('tile'),
  Polyline: box('polyline'),
  CircleMarker: box('marker'),
  Tooltip: box('tooltip'),
  LayersControl: Object.assign(box('layers'), { BaseLayer: box('baselayer') }),
  useMap: () => ({ fitBounds }),
}
