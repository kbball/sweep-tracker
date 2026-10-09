import { ageLabel, fadeOpacity, metersToMiles, sweepState } from './format'
import type { SweepState } from './format'
import type { TrackerHistory } from './types'

const STATE_TEXT: Record<SweepState, string> = {
  moving: 'Moving', stopped: 'Stopped', nofix: 'No GPS fix', unknown: 'No reports yet',
}
const STATE_TONE: Record<SweepState, string> = { moving: 'ok', stopped: 'warn', nofix: 'bad', unknown: 'neutral' }

interface Props {
  tracks: TrackerHistory[]
  now: number
  /** Metres along the course of each team, by tracker name. */
  progress?: Record<string, number>
  /** Tracker name of the expanded team; defaults to the first. */
  selected?: string
  onSelect?: (trackerName: string) => void
}

export function SweepPanel({ tracks, now, progress, selected, onSelect }: Props) {
  if (tracks.length === 0) return <p className="muted">No sweep teams assigned to this event.</p>
  const open = selected ?? tracks[0].trackerName
  return (
    <ul className="sweeps">
      {tracks.map((t) => {
        const latest = t.positions[0]
        const state = sweepState(latest)
        const expanded = t.trackerName === open
        const dist = progress?.[t.trackerName]
        return (
          <li key={t.trackerName} className={`sweep${expanded ? ' open' : ''}`}>
            <button type="button" className="team" aria-expanded={expanded} onClick={() => onSelect?.(t.trackerName)}>
              <span className="team-top">
                <span className="swatch" style={{ background: t.color }} />
                <strong>{t.label}</strong>
                <span className={`chip ${STATE_TONE[state]}`}>{STATE_TEXT[state]}</span>
                {latest && <span className="team-age">{ageLabel(latest.time, now)}</span>}
              </span>
              {latest && (
                <span className="team-meta">
                  {dist != null && <span>Mile {metersToMiles(dist).toFixed(1)}</span>}
                  {latest.batteryV != null && <span>{latest.batteryV.toFixed(2)} V</span>}
                  {latest.hasFix && latest.alt != null && <span>{Math.round(latest.alt).toLocaleString()} ft</span>}
                </span>
              )}
            </button>
            {expanded && (
              <ol className="history" aria-label={`${t.label} recent reports`}>
                {t.positions.map((p, i) => (
                  <li key={p.id} style={{ opacity: fadeOpacity(i) }}>
                    <span>{ageLabel(p.time, now)}</span>
                    {p.hasFix ? (
                      <span>
                        {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
                        {p.alt != null && ` · ${Math.round(p.alt).toLocaleString()} ft`}
                        {p.batteryV != null && ` · ${p.batteryV.toFixed(2)}V`}
                        {` · ${p.moving ? 'moving' : 'stopped'}`}
                      </span>
                    ) : (
                      <span>no fix{p.batteryV != null && ` · ${p.batteryV.toFixed(2)}V`}</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </li>
        )
      })}
    </ul>
  )
}
