import { useEffect } from 'react'
import { CircleMarker, LayersControl, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { FitBoundsOptions, LatLngBoundsExpression } from 'leaflet'
import { fadeOpacity, lastFix } from './format'
import type { Course, MapLayer, TrackerHistory } from './types'

type LayerInfo = Pick<MapLayer, 'id' | 'name' | 'attribution' | 'maxZoom'> & Partial<Pick<MapLayer, 'tileCount' | 'minTileZoom' | 'maxTileZoom'>>

/** Deepest zoom that still has tiles: the downloaded depth, or the source's depth when nothing is known. */
export function usableMaxZoom(l: LayerInfo): number {
  return l.tileCount && l.maxTileZoom ? Math.min(l.maxTileZoom, l.maxZoom) : l.maxZoom
}

export const FALLBACK_LAYERS: LayerInfo[] = [
  { id: 'topo', name: 'Topo', attribution: 'USGS', maxZoom: 16 },
]

/** Zoom the live map opens at when nothing is known about the downloaded tiles. */
export const DEFAULT_ZOOM = 10

/** Opening zoom: half way between the shallowest and deepest downloaded zoom of the first layer that has tiles. */
export function defaultZoom(layers: LayerInfo[]): number {
  const l = layers.find((x) => x.tileCount && x.maxTileZoom)
  return l ? Math.floor(((l.minTileZoom ?? 0) + l.maxTileZoom!) / 2) : DEFAULT_ZOOM
}

export function centerOf(bounds?: LatLngBoundsExpression): [number, number] | undefined {
  const pts = bounds as [number, number][] | undefined
  if (!pts?.length) return undefined
  const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1])
  return [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2]
}

export function boundsOf(course?: Course | null, tracks: TrackerHistory[] = []): LatLngBoundsExpression | undefined {
  const pts: [number, number][] = []
  course?.track.forEach((p) => pts.push([p.lat, p.lon]))
  course?.waypoints.forEach((p) => pts.push([p.lat, p.lon]))
  tracks.forEach((t) => { const f = lastFix(t.positions); if (f) pts.push([f.lat, f.lon]) })
  return pts.length ? pts : undefined
}

/** Leaves room for the floating course strip along the bottom. */
const FIT: FitBoundsOptions = { paddingTopLeft: [30, 30], paddingBottomRight: [30, 190], maxZoom: 15 }

/** Opens the view on the course when it changes, not on every re-render, so the user's zoom and pan survive live updates. */
function Fit({ center, zoom }: { center?: [number, number]; zoom: number }) {
  const map = useMap()
  const key = JSON.stringify([center, zoom])
  useEffect(() => {
    if (center) map.setView(center, zoom)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])
  return null
}

/** Re-measures the map whenever its container changes size (layout settling, mobile browser bars, rotation). */
function ResizeSync() {
  const map = useMap()
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(map.getContainer())
    return () => ro.disconnect()
  }, [map])
  return null
}

/** Pans to a point without changing zoom; `seq` re-triggers it for the same point. */
export interface Focus { lat: number; lon: number; seq: number }

function PanTo({ focus }: { focus?: Focus }) {
  const map = useMap()
  useEffect(() => { if (focus) map.panTo([focus.lat, focus.lon]) }, [map, focus])
  return null
}

const iconProps = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }

function MapControls({ bounds }: { bounds?: LatLngBoundsExpression }) {
  const map = useMap()
  return (
    <div className="map-controls">
      <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => map.zoomIn()}><svg {...iconProps}><path d="M12 5v14M5 12h14" /></svg></button>
      <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => map.zoomOut()}><svg {...iconProps}><path d="M5 12h14" /></svg></button>
      <button type="button" className="icon-btn" aria-label="Fit to course" disabled={!bounds}
        onClick={() => bounds && map.fitBounds(bounds, FIT)}>
        <svg {...iconProps}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg></button>
    </div>
  )
}

interface Props {
  focus?: Focus
  /** The aid station being worked, ringed on the map. */
  activeStop?: { name: string; lat: number; lon: number }
  course?: Course | null
  tracks: TrackerHistory[]
  layers?: LayerInfo[]
}

export function SweepMap({ course, tracks, layers = FALLBACK_LAYERS, focus, activeStop }: Props) {
  const courseBounds = boundsOf(course)
  const center = centerOf(courseBounds)
  const zoom = defaultZoom(layers)
  return (
    <MapContainer className="map" center={center ?? [39.5, -98.35]} zoom={center ? zoom : 4} zoomControl={false}>
      <Fit center={center} zoom={zoom} />
      <ResizeSync />
      <PanTo focus={focus} />
      <MapControls bounds={courseBounds} />
      <LayersControl position="topright">
        {layers.map((l, i) => (
          <LayersControl.BaseLayer key={l.id} name={l.name} checked={i === 0}>
            <TileLayer url={`/api/tiles/${l.id}/{z}/{x}/{y}.png`} attribution={l.attribution} maxZoom={usableMaxZoom(l)} />
          </LayersControl.BaseLayer>
        ))}
      </LayersControl>

      {course && course.track.length > 1 && (
        <Polyline positions={course.track.map((p) => [p.lat, p.lon] as [number, number])} pathOptions={{ color: '#f76707', weight: 4, opacity: 0.9 }} />
      )}
      {course?.waypoints.map((w, i) => (
        <CircleMarker key={`${w.name}-${i}`} center={[w.lat, w.lon]} radius={7} pathOptions={{ color: '#111', fillColor: '#fff', fillOpacity: 1, weight: 3 }}>
          <Tooltip>{w.name || 'Waypoint'}</Tooltip>
        </CircleMarker>
      ))}

      {activeStop && (
        <CircleMarker key={`active-${activeStop.lat}-${activeStop.lon}`} center={[activeStop.lat, activeStop.lon]} radius={16}
          pathOptions={{ color: '#2f5bea', fillColor: '#2f5bea', fillOpacity: 0.2, weight: 4 }}>
          <Tooltip permanent direction="top" offset={[0, -14]}>{activeStop.name}</Tooltip>
        </CircleMarker>
      )}

      {tracks.map((t) => {
        // Only reports with a fix can be placed. Index is the age rank, so
        // the newest placeable report is full strength and older ones fade.
        const placed = t.positions.filter((p) => p.hasFix)
        return placed.map((p, i) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lon]}
            radius={i === 0 ? 11 : 5}
            pathOptions={{ color: i === 0 ? '#000' : t.color, fillColor: t.color, weight: i === 0 ? 3 : 1, fillOpacity: fadeOpacity(i), opacity: fadeOpacity(i) }}
          >
            {i === 0 && <Tooltip permanent direction="right" offset={[12, 0]}>{t.label}</Tooltip>}
          </CircleMarker>
        ))
      })}
    </MapContainer>
  )
}
