import type { CSSProperties } from 'react'
import type { CourseStats } from './course'
import type { TrackerHistory } from './types'


interface Label { text: string; from: number; width: number; style: CSSProperties; row: number }

/** Positions a label at `p` percent along the strip, keeping it inside the strip at both ends.
 *  Width is estimated from the text length (about 0.7% of the strip per character). */
function place(text: string, p: number): Omit<Label, 'row'> {
  const width = text.length * 0.7
  if (p < 8) return { text, width, from: p, style: { left: `${p}%` } }
  if (p > 92) return { text, width, from: p - width, style: { right: `${100 - p}%` } }
  return { text, width, from: p - width / 2, style: { left: `${p}%`, transform: 'translateX(-50%)' } }
}

/** Elevation profile of the course with aid stations and each team's position. */
export function CourseStrip({ stats, tracks, progress }: { stats?: CourseStats | null; tracks: TrackerHistory[]; progress?: Record<string, number> }) {
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

  // Aid-station labels alternate between two rows; one that would still overlap is dropped.
  const labels: Label[] = []
  const rowEnd = [-100, -100]
  stats.stops.forEach((st, i) => {
    const text = `${st.name} · mi ${(st.mile ?? stats.mileAt(st.distM)).toFixed(1)}`
    const l = place(text, pct(st.distM))
    const row = [i % 2, (i + 1) % 2].find((r) => l.from >= rowEnd[r] + 1)
    if (row === undefined) return
    rowEnd[row] = l.from + l.width
    labels.push({ ...l, row })
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
      <svg viewBox="0 0 1000 70" preserveAspectRatio="none" role="img" aria-label="Elevation profile of the course">
        {path ? <><path d={path} className="profile-fill" /><path d={line} className="profile-line" vectorEffect="non-scaling-stroke" /></>
          : <line x1="0" y1="62" x2="1000" y2="62" className="profile-line" vectorEffect="non-scaling-stroke" />}
        {stats.stops.map((s, i) => <line key={i} x1={(s.distM / stats.totalM) * 1000} x2={(s.distM / stats.totalM) * 1000} y1="0" y2="70" className="profile-stop" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div className="strip-labels">
        {labels.map((l, i) => <span key={i} className={`row${l.row}`} style={l.style}>{l.text}</span>)}
        {teams.map(({ t, d }) => {
          const l = place(`▲ ${t.label} mi ${stats.mileAt(d).toFixed(1)}`, pct(d))
          return <span key={t.trackerName} className="strip-team" style={{ ...l.style, color: t.color }}>{l.text}</span>
        })}
      </div>
    </section>
  )
}
