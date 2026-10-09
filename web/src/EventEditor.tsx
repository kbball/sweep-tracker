import { useState } from 'react'
import { api } from './api'
import { metersToMiles } from './format'
import type { EventTracker, KnownTracker, SweepEvent } from './types'

interface Props {
  event: SweepEvent
  known: KnownTracker[]
  onChange: (e: SweepEvent) => void
}

export function EventEditor({ event, known, onChange }: Props) {
  const [name, setName] = useState(event.name)
  const [date, setDate] = useState(event.date.slice(0, 10))
  const [notes, setNotes] = useState(event.notes)
  const [trackers, setTrackers] = useState<EventTracker[]>(event.trackers)
  const [msg, setMsg] = useState<string>()
  const [error, setError] = useState<string>()

  const run = async (fn: () => Promise<SweepEvent>, ok: string) => {
    setError(undefined); setMsg(undefined)
    try { onChange(await fn()); setMsg(ok) } catch (e) { setError((e as Error).message) }
  }
  const patch = (i: number, p: Partial<EventTracker>) => setTrackers(trackers.map((t, j) => (j === i ? { ...t, ...p } : t)))
  const unassigned = known.filter((k) => !trackers.some((t) => t.trackerName === k.name))

  return (
    <fieldset>
      <legend>Event</legend>
      <label>Name <input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label>Notes <textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

      <h3>Sweep teams</h3>
      {trackers.map((t, i) => (
        <div className="row" key={t.trackerName}>
          <code>{t.trackerName}</code>
          <input aria-label={`Label for ${t.trackerName}`} value={t.label} onChange={(e) => patch(i, { label: e.target.value })} />
          <input aria-label={`Color for ${t.trackerName}`} type="color" value={t.color || '#e6194b'} onChange={(e) => patch(i, { color: e.target.value })} />
          <button type="button" onClick={() => setTrackers(trackers.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div className="row">
        <select aria-label="Add tracker" value="" onChange={(e) => e.target.value && setTrackers([...trackers, { trackerName: e.target.value, label: e.target.value, color: '' }])}>
          <option value="">Add a tracker heard on the mesh…</option>
          {unassigned.map((k) => <option key={k.name} value={k.name}>{k.name}</option>)}
        </select>
      </div>

      <button type="button" onClick={() => run(() => api.updateEvent(event.id, { name, date: new Date(date).toISOString(), notes, trackers }), 'Saved')}>
        Save event
      </button>

      <h3>Course</h3>
      <p>{event.course
        ? `${event.course.name || 'Course'}: ${metersToMiles(event.course.distanceM).toFixed(1)} mi, ${event.course.waypoints.length} waypoints`
        : 'No course uploaded'}</p>
      <label>GPX file <input type="file" accept=".gpx,application/gpx+xml,text/xml"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(() => api.uploadCourse(event.id, f), 'Course uploaded') }} /></label>

      <p><a href={api.exportUrl(event.id)} download>Export event to share</a></p>
      {msg && <p role="status">{msg}</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </fieldset>
  )
}
