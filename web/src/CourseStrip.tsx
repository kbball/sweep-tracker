import type { CSSProperties } from 'react'
import { stopKey } from './course'
import type { CourseStats } from './course'
import type { TrackerHistory } from './types'


/** Stops closer than this (percent of the strip) share one hover target. */
const CLUSTER_PCT = 0.8

interface Label { text: string; style: CSSProperties }

/** Positions a label at `p` percent along the strip, keeping it inside the strip at both ends. */
function place(text: string, p: number): Label {
  if (p < 8) return { text, style: { left: `${p}%` } }
  if (p > 92) return { text, style: { right: `${100 - p}%` } }
  return { text, style: { left: `${p}%`, transform: 'translateX(-50%)' } }
}

/** Elevation profile of the course with aid stations and each team's position. */
interface StripProps {
  stats?: CourseStats | null
  tracks: TrackerHistory[]
  progress?: Record<string, number>
  /** stopKey of the aid station being worked: highlighted, with its tooltip always showing. */
  active?: string
  /** Clicking a stop selects it; clicking the selected one clears it. */
  onSelectStop?: (key: string | undefined) => void
}

export function CourseStrip({ stats, tracks, progress, active, onSelectStop }: StripProps) {
  if (!stats) return null
  const pct = (m: number) => (m / stats.totalM) * 100

  let path = ''
  let line = ''
  if (stats.profile) {
    const lo = Math.min(...stats.profile.map((p) => p.ele)), hi = Math.max(...stats.profile.map((p) => p.ele))
    const y = (e: number) => (hi === lo ? 40 : 62 - ((e - lo) / (hi - lo)) * 50)
    line = stats.profile.map((p, i) => `${i ? 'L' : 'M'}${(p.d / stats.totalM) * 1000} ${y(p.ele)}`).join('')
    path = `${line}L1000 70L0 70Z`
  }

  // Aid stations are tooltips on their lines. Stops too close to tell apart share one target and list together.
  const clusters: { p: number; names: string[]; keys: string[] }[] = []
  stats.stops.forEach((st) => {
    const text = `${st.name} · mi ${(st.mile ?? stats.mileAt(st.distM)).toFixed(1)}`
    const p = pct(st.distM)
    const last = clusters[clusters.length - 1]
    if (last && p - last.p < CLUSTER_PCT) { last.names.push(text); last.keys.push(stopKey(st)) }
    else clusters.push({ p, names: [text], keys: [stopKey(st)] })
  })
  const teams = tracks
    .map((t) => ({ t, d: progress?.[t.trackerName] }))
    .filter((x): x is { t: TrackerHistory; d: number } => x.d != null)

  return (
    <section className="strip card" aria-label="Course progress">
      <div className="strip-head">
        <strong>Course progress</strong>
        <span className="muted">{stats.mileAt(stats.totalM).toFixed(1)} mi</span>
      </div>
      <div className="strip-plot">
        <svg viewBox="0 0 1000 70" preserveAspectRatio="none" role="img" aria-label="Elevation profile of the course">
          {path ? <><path d={path} className="profile-fill" /><path d={line} className="profile-line" vectorEffect="non-scaling-stroke" /></>
            : <line x1="0" y1="62" x2="1000" y2="62" className="profile-line" vectorEffect="non-scaling-stroke" />}
          {stats.stops.map((s, i) => <line key={i} x1={(s.distM / stats.totalM) * 1000} x2={(s.distM / stats.totalM) * 1000} y1="0" y2="70" className="profile-stop" vectorEffect="non-scaling-stroke" />)}
        </svg>
        {clusters.map((c, i) => {
          const on = active !== undefined && c.keys.includes(active)
          return (
            <span key={i} className={`strip-stop${c.p < 8 ? ' at-start' : c.p > 92 ? ' at-end' : ''}${on ? ' active' : ''}`} style={{ left: `${c.p}%` }}
              role={onSelectStop ? 'button' : undefined} aria-pressed={onSelectStop ? on : undefined} tabIndex={0} aria-label={c.names.join(', ')}
              onClick={() => onSelectStop?.(on ? undefined : c.keys[0])}
              onKeyDown={(e) => { if (onSelectStop && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelectStop(on ? undefined : c.keys[0]) } }}>
              <span className="strip-tip" role="tooltip" aria-hidden="true">{c.names.map((n) => <span key={n}>{n}</span>)}</span>
            </span>
          )
        })}
      </div>
      <div className="strip-labels">
        {teams.map(({ t, d }) => {
          const l = place(`▲ ${t.label} mi ${stats.mileAt(d).toFixed(1)}`, pct(d))
          return <span key={t.trackerName} className="strip-team" style={{ ...l.style, color: t.color }}>{l.text}</span>
        })}
      </div>
    </section>
  )
}
