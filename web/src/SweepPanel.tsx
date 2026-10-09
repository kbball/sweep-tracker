import { ageLabel, fadeOpacity, metersToMiles, sweepState } from './format'
import type { SweepState } from './format'
import { useState } from 'react'
import { Battery4BarIcon, Landscape2Icon, SatelliteAltIcon } from './Icons'
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
  const [showReports, setShowReports] = useState<Record<string, boolean>>({})
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
                  {latest.batteryV != null && (
                    <span className="stat" title="Battery voltage"><Battery4BarIcon /><span className="sr-only">Battery </span>{latest.batteryV.toFixed(2)} V</span>
                  )}
                  {latest.sats != null && (
                    <span className="stat" title="Satellites in view"><SatelliteAltIcon /><span className="sr-only">Satellites </span>{latest.sats}</span>
                  )}
                  {latest.hasFix && latest.alt != null && (
                    <span className="stat" title="Elevation"><Landscape2Icon /><span className="sr-only">Elevation </span>{Math.round(latest.alt).toLocaleString()} ft</span>
                  )}
                </span>
              )}
            </button>
            {expanded && t.positions.length > 0 && (
              <>
                <button type="button" className="history-toggle" aria-expanded={!!showReports[t.trackerName]} aria-controls={`reports-${t.trackerName}`}
                  onClick={() => setShowReports({ ...showReports, [t.trackerName]: !showReports[t.trackerName] })}>
                  <span>Recent reports ({t.positions.length})</span>
                  <svg className="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {showReports[t.trackerName] && (
                  <ol className="history" id={`reports-${t.trackerName}`} aria-label={`${t.label} recent reports`}>
                    {t.positions.map((p, i) => (
                      <li key={p.id} style={{ opacity: fadeOpacity(i) }}>
                        <span className="when">{ageLabel(p.time, now)}</span>
                        {p.hasFix ? (
                          <span>
                            {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
                            {p.alt != null && ` · ${Math.round(p.alt).toLocaleString()} ft`}
                            {p.batteryV != null && ` · ${p.batteryV.toFixed(2)}V`}
                            {p.sats != null && ` · ${p.sats} sats`}
                            {` · ${p.moving ? 'moving' : 'stopped'}`}
                          </span>
                        ) : (
                          <span>no fix{p.batteryV != null && ` · ${p.batteryV.toFixed(2)}V`}{p.sats != null && ` · ${p.sats} sats`}</span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}
