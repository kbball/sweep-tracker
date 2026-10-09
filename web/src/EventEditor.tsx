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
  const [newTracker, setNewTracker] = useState('')
  const [passUse, setPassUse] = useState<boolean[][]>(() => (event.course?.waypoints ?? []).map((w) => (w.passes ?? []).map((p) => p.use)))
  const [msg, setMsg] = useState<string>()
  const [error, setError] = useState<string>()

  const run = async (fn: () => Promise<SweepEvent>, ok: string) => {
    setError(undefined); setMsg(undefined)
    try { onChange(await fn()); setMsg(ok) } catch (e) { setError((e as Error).message) }
  }
  const patch = (i: number, p: Partial<EventTracker>) => setTrackers(trackers.map((t, j) => (j === i ? { ...t, ...p } : t)))
  const addTracker = (trackerName: string) => {
    const n = trackerName.trim()
    if (!n) return
    if (trackers.some((t) => t.trackerName === n)) { setError(`${n} is already on this event`); return }
    setError(undefined)
    setTrackers([...trackers, { trackerName: n, label: n, color: '' }])
  }
  const togglePass = (i: number, j: number) => setPassUse(passUse.map((row, a) => (a === i ? row.map((u, b) => (b === j ? !u : u)) : row)))
  const unassigned = known.filter((k) => !trackers.some((t) => t.trackerName === k.name))

  return (
    <fieldset className="panel">
      <legend>Event</legend>
      <label>Name <input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label>Notes <textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

      <h3>Sweep teams</h3>
      {trackers.map((t, i) => (
        <div className="team-row" key={t.trackerName}>
          <code>{t.trackerName}</code>
          <input aria-label={`Label for ${t.trackerName}`} value={t.label} onChange={(e) => patch(i, { label: e.target.value })} />
          <input aria-label={`Color for ${t.trackerName}`} type="color" value={t.color || '#e6194b'} onChange={(e) => patch(i, { color: e.target.value })} />
          <button type="button" className="ghost" onClick={() => setTrackers(trackers.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div className="row">
        <select aria-label="Add tracker" value="" onChange={(e) => addTracker(e.target.value)}>
          <option value="">Add a tracker heard on the mesh…</option>
          {unassigned.map((k) => <option key={k.name} value={k.name}>{k.name}</option>)}
        </select>
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); addTracker(newTracker); setNewTracker('') }}>
        <input aria-label="New tracker name" placeholder="Or type a name (before it is heard)" value={newTracker} onChange={(e) => setNewTracker(e.target.value)} />
        <button type="submit" className="primary" disabled={!newTracker.trim()}>Add</button>
      </form>
      <p className="muted">The name must match what the tracker sends (e.g. <code>Sweep1</code>); it starts reporting once heard on the mesh.</p>

      <button type="button" className="primary save" onClick={() => run(() => api.updateEvent(event.id, { name, date: new Date(date).toISOString(), notes, trackers }), 'Saved')}>
        Save event
      </button>

      <h3>Course</h3>
      <p>{event.course
        ? `${event.course.name || 'Course'}: ${metersToMiles(event.course.distanceM).toFixed(1)} mi, ${event.course.waypoints.length} waypoints`
        : 'No course uploaded'}</p>
      <label>GPX file <input type="file" accept=".gpx,application/gpx+xml,text/xml"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(() => api.uploadCourse(event.id, f), 'Course uploaded') }} /></label>

      {event.course && event.course.waypoints.length > 0 && (
        <>
          <h3>Aid stations</h3>
          <p className="muted">Where the course goes by each aid station. An out-and-back course passes a station twice; untick passes that are just the trail running close by.</p>
          {event.course.waypoints.map((w, i) => {
            const passes = w.passes ?? []
            return (
              <div className="station" key={`${w.name}-${i}`}>
                <strong>{w.name || 'Waypoint'}</strong>
                {passes.length > 2 && <span className="chip warn">Review</span>}
                <span className="passes">
                  {passes.map((p, j) => (
                    <label className="check" key={j}>
                      <input type="checkbox" checked={passUse[i]?.[j] ?? false} onChange={() => togglePass(i, j)}
                        aria-label={`${w.name || 'Waypoint'} at mile ${metersToMiles(p.distM).toFixed(1)}`} />
                      mi {metersToMiles(p.distM).toFixed(1)}
                    </label>
                  ))}
                </span>
              </div>
            )
          })}
          <button type="button" className="primary save" onClick={() => run(() => api.setPasses(event.id, passUse), 'Aid stations saved')}>Save aid stations</button>
        </>
      )}

      <p><a className="btn" href={api.exportUrl(event.id)} download>Export event to share</a></p>
      {msg && <p role="status" className="notice">{msg}</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </fieldset>
  )
}
