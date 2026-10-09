import { ageLabel, fadeOpacity, sweepState } from './format'
import type { SweepState } from './format'
import type { TrackerHistory } from './types'

const STATE_TEXT: Record<SweepState, string> = {
  moving: 'Moving', stopped: 'Stopped', nofix: 'No GPS fix', unknown: 'No reports yet',
}

export function SweepPanel({ tracks, now }: { tracks: TrackerHistory[]; now: number }) {
  if (tracks.length === 0) return <p className="muted">No sweep teams assigned to this event.</p>
  return (
    <ul className="sweeps">
      {tracks.map((t) => {
        const latest = t.positions[0]
        const state = sweepState(latest)
        return (
          <li key={t.trackerName} className="sweep">
            <h3>
              <span className="swatch" style={{ background: t.color }} /> {t.label}
              <span className={`state ${state}`}>{STATE_TEXT[state]}</span>
            </h3>
            <ol className="history">
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
          </li>
        )
      })}
    </ul>
  )
}
