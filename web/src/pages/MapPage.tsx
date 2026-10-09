import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { courseStats, teamProgress } from '../course'
import { CourseStrip } from '../CourseStrip'
import { lastFix } from '../format'
import { SweepMap } from '../SweepMap'
import type { Focus } from '../SweepMap'
import { SweepPanel } from '../SweepPanel'
import { ThemeToggle } from '../ThemeToggle'
import { HISTORY, useLive } from '../useLive'
import type { MapLayer } from '../types'

const icon = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }

export function MapPage() {
  const { id = '' } = useParams()
  const { event, tracks, error, connected } = useLive(id)
  const [layers, setLayers] = useState<MapLayer[]>()
  const [now, setNow] = useState(() => Date.now())
  const [selected, setSelected] = useState<string>()
  const [focus, setFocus] = useState<Focus>()

  const stats = useMemo(() => (event?.course ? courseStats(event.course) : null), [event?.course])
  // Reports from well before the event date belong to an earlier run of the same tracker.
  const since = event ? new Date(event.date).getTime() - 12 * 3600_000 : undefined
  const progress = useMemo(() => (stats ? teamProgress(stats, tracks, since) : undefined), [stats, tracks, since])
  // Reports beyond the newest few are kept only to follow each team along the course.
  const recent = useMemo(() => tracks.map((t) => ({ ...t, positions: t.positions.slice(0, HISTORY) })), [tracks])

  useEffect(() => { api.maps().then((m) => setLayers(m.layers)).catch(() => undefined) }, [])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])

  if (error) return <p role="alert" className="page error">{error} <Link to="/">Back</Link></p>
  if (!event) return <p className="page">Loading…</p>

  const select = (name: string) => {
    setSelected(name)
    const fix = lastFix(tracks.find((t) => t.trackerName === name)?.positions ?? [])
    if (fix) setFocus((f) => ({ lat: fix.lat, lon: fix.lon, seq: (f?.seq ?? 0) + 1 }))
  }

  return (
    <div className="live">
      <SweepMap course={event.course} tracks={recent} layers={layers} focus={focus} />

      <nav className="rail card" aria-label="Main">
        <Link to="/" className="icon-btn" aria-label="All events" title="All events">
          <svg {...icon}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
        </Link>
        <Link to="/admin" className="icon-btn" aria-label="Admin" title="Admin">
          <svg {...icon}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
        </Link>
        <span className="rail-spacer" />
        <ThemeToggle />
      </nav>

      <section className="teams card" aria-label="Sweep teams">
        <header>
          <strong>{event.name}</strong>
          <span className={connected ? 'chip ok' : 'chip bad'} title={connected ? 'Live' : 'Reconnecting'}>
            <span className="dot" />{connected ? 'Live' : 'Offline'}
          </span>
        </header>
        {!event.course && <p className="muted">No course loaded. Upload a GPX in <Link to="/admin">Admin</Link>.</p>}
        <SweepPanel tracks={recent} now={now} progress={progress} selected={selected} onSelect={select} />
      </section>

      <CourseStrip stats={stats} tracks={recent} progress={progress} />
    </div>
  )
}
