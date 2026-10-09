import { CircleMarker, LayersControl, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import { fadeOpacity, lastFix } from './format'
import type { Course, MapLayer, TrackerHistory } from './types'

export const FALLBACK_LAYERS: Pick<MapLayer, 'id' | 'name' | 'attribution' | 'maxZoom'>[] = [
  { id: 'topo', name: 'Topo', attribution: 'USGS', maxZoom: 16 },
  { id: 'terrain', name: 'Terrain', attribution: 'USGS', maxZoom: 15 },
]

export function boundsOf(course?: Course | null, tracks: TrackerHistory[] = []): LatLngBoundsExpression | undefined {
  const pts: [number, number][] = []
  course?.track.forEach((p) => pts.push([p.lat, p.lon]))
  course?.waypoints.forEach((p) => pts.push([p.lat, p.lon]))
  tracks.forEach((t) => { const f = lastFix(t.positions); if (f) pts.push([f.lat, f.lon]) })
  return pts.length ? pts : undefined
}

function Fit({ bounds }: { bounds?: LatLngBoundsExpression }) {
  const map = useMap()
  if (bounds) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 })
  return null
}

interface Props {
  course?: Course | null
  tracks: TrackerHistory[]
  layers?: Pick<MapLayer, 'id' | 'name' | 'attribution' | 'maxZoom'>[]
}

export function SweepMap({ course, tracks, layers = FALLBACK_LAYERS }: Props) {
  const courseBounds = boundsOf(course)
  return (
    <MapContainer className="map" center={[39.5, -98.35]} zoom={4} bounds={courseBounds}>
      <Fit bounds={courseBounds} />
      <LayersControl position="topright">
        {layers.map((l, i) => (
          <LayersControl.BaseLayer key={l.id} name={l.name} checked={i === 0}>
            <TileLayer url={`/tiles/${l.id}/{z}/{x}/{y}.png`} attribution={l.attribution} maxZoom={l.maxZoom} />
          </LayersControl.BaseLayer>
        ))}
      </LayersControl>

      {course && course.track.length > 1 && (
        <Polyline positions={course.track.map((p) => [p.lat, p.lon] as [number, number])} pathOptions={{ color: '#d9480f', weight: 4, opacity: 0.8 }} />
      )}
      {course?.waypoints.map((w, i) => (
        <CircleMarker key={`${w.name}-${i}`} center={[w.lat, w.lon]} radius={7} pathOptions={{ color: '#111', fillColor: '#fff', fillOpacity: 1, weight: 3 }}>
          <Tooltip>{w.name || 'Waypoint'}</Tooltip>
        </CircleMarker>
      ))}

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
