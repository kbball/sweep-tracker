import { stopKey } from './course'
import type { CourseStats } from './course'
import type { TrackerHistory } from './types'

/** A team this close to a stop is at it. */
const AT_M = 50

interface Props {
  stats: CourseStats
  tracks: TrackerHistory[]
  progress?: Record<string, number>
  active?: string
  onChange: (key: string | undefined) => void
  cutoffLabel?: (hours: number) => string
}

/** Pick the aid station you are working; the map and strip highlight it, and each team shows how far it still has to come. */
export function AidStationFocus({ stats, tracks, progress, active, onChange, cutoffLabel }: Props) {
  if (stats.stops.length === 0) return null
  const stop = stats.stops.find((s) => stopKey(s) === active)
  const mile = stop && (stop.mile ?? stats.mileAt(stop.distM))
  return (
    <div className="aid-focus">
      <label>My aid station
        <select value={stop ? stopKey(stop) : ''} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">None</option>
          {stats.stops.map((s) => <option key={stopKey(s)} value={stopKey(s)}>{s.name} · mi {(s.mile ?? stats.mileAt(s.distM)).toFixed(1)}</option>)}
        </select>
      </label>
      {stop && mile !== undefined && (
        <ul className="aid-teams">
          <li className="muted">
            Mile {mile.toFixed(1)}
            {stop.cutoffHours !== undefined && ` · cutoff ${cutoffLabel ? cutoffLabel(stop.cutoffHours) : `+${stop.cutoffHours}h`}`}
            {stop.crew && ` · ${stop.crew}`}
          </li>
          {tracks.map((t) => {
            const d = progress?.[t.trackerName]
            if (d === undefined) return null
            const text = d > stop.distM + AT_M ? 'has passed' : d >= stop.distM - AT_M ? 'is here' : `${(mile - stats.mileAt(d)).toFixed(1)} mi away`
            return <li key={t.trackerName}><span className="swatch" style={{ background: t.color }} /> {t.label} {text}</li>
          })}
        </ul>
      )}
    </div>
  )
}
