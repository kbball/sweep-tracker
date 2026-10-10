import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { AppHeader } from '../AppHeader'
import { EventEditor } from '../EventEditor'
import { MapsPanel } from '../MapsPanel'
import { SetupGuide } from '../SetupGuide'
import type { KnownTracker, MapsInfo, SweepEvent } from '../types'

export function AdminPage() {
  const [events, setEvents] = useState<SweepEvent[]>([])
  const [known, setKnown] = useState<KnownTracker[]>([])
  const [selected, setSelected] = useState<string>()
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string>()
  const [deleting, setDeleting] = useState<SweepEvent>()
  const [tileCount, setTileCount] = useState<number>()
  const onMaps = useCallback((m: MapsInfo) => setTileCount(m.layers.reduce((n, l) => n + l.tileCount, 0)), [])

  const load = useCallback(async () => {
    try {
      const [evs, kt] = await Promise.all([api.listEvents(), api.knownTrackers()])
      setEvents(evs); setKnown(kt)
    } catch (e) { setError((e as Error).message) }
  }, [])
  useEffect(() => { void load() }, [load])

  const guard = async (fn: () => Promise<unknown>) => {
    setError(undefined)
    try { await fn(); await load() } catch (e) { setError((e as Error).message) }
  }
  const current = events.find((e) => e.id === selected)

  return (
    <main className="page wide">
      <AppHeader />
      <h1>Admin</h1>
      {error && <p role="alert" className="error">{error}</p>}

      <SetupGuide event={current} known={known} tileCount={tileCount} />

      <fieldset className="panel" id="admin-events">
        <legend>Events</legend>
        <ul className="admin-events">
          {events.map((e) => (
            <li key={e.id} className={e.id === selected ? 'selected' : undefined}>
              <span className="ev-name">
                <strong>{e.name}</strong>
                <span className="muted">{new Date(e.date).toLocaleDateString()}</span>
                {e.id === selected && <span className="chip ok">Editing</span>}
              </span>
              <span className="ev-actions">
                <Link className="btn small" to={`/e/${e.id}`} aria-label={`View ${e.name}`}>View</Link>
                <button className={e.id === selected ? 'small primary' : 'small'} aria-label={`Edit ${e.name}`} aria-pressed={e.id === selected} onClick={() => setSelected(e.id)}>Edit</button>
                <button className="small ghost danger-text" aria-label={`Delete ${e.name}`} onClick={() => setDeleting(e)}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
        <div className="add-event">
          <div className="add-card">
            <h3>New event</h3>
            <div className="row">
              <input aria-label="New event name" placeholder="Event name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button className="primary" onClick={() => guard(async () => {
                const e = await api.createEvent({ name: newName, date: new Date().toISOString() })
                setNewName(''); setSelected(e.id)
              })}>Create</button>
            </div>
          </div>
          <div className="add-card">
            <h3>Import an event</h3>
            <label>Import shared event <input type="file" accept=".json" onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void guard(async () => { const ev = await api.importEvent(f); setSelected(ev.id) })
            }} /></label>
            <p className="muted">Adds a new event from a shared <code>.sweep.json</code> file.</p>
          </div>
        </div>
      </fieldset>

      {current && <EventEditor key={current.id + current.updatedAt} event={current} known={known}
        onChange={(e) => setEvents(events.map((x) => (x.id === e.id ? e : x)))} />}
      <MapsPanel eventId={selected} onInfo={onMaps} />

      {deleting && (
        <div className="modal-backdrop">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-event-title" className="modal">
            <h3 id="delete-event-title">Delete {deleting.name}?</h3>
            <p>This permanently deletes the event, its course and its sweep team setup. Export it first if you may want it back.</p>
            <div className="row">
              <button onClick={() => setDeleting(undefined)}>Cancel</button>
              <button className="danger" onClick={() => {
                const gone = deleting
                setDeleting(undefined)
                void guard(async () => { await api.deleteEvent(gone.id); if (selected === gone.id) setSelected(undefined) })
              }}>Delete event</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
