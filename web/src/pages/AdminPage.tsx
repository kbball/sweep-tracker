import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { EventEditor } from '../EventEditor'
import { MapsPanel } from '../MapsPanel'
import type { KnownTracker, SweepEvent } from '../types'

export function AdminPage() {
  const [events, setEvents] = useState<SweepEvent[]>([])
  const [known, setKnown] = useState<KnownTracker[]>([])
  const [selected, setSelected] = useState<string>()
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string>()

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
    <main className="page">
      <p><Link to="/">← Home</Link></p>
      <h1>Admin</h1>
      {error && <p role="alert" className="error">{error}</p>}

      <fieldset>
        <legend>Events</legend>
        <ul>
          {events.map((e) => (
            <li key={e.id}>
              <button onClick={() => setSelected(e.id)} aria-pressed={e.id === selected}>{e.name}</button>{' '}
              <Link to={`/e/${e.id}`}>view</Link>{' '}
              <button aria-label={`Delete ${e.name}`} onClick={() => guard(async () => { await api.deleteEvent(e.id); if (selected === e.id) setSelected(undefined) })}>Delete</button>
            </li>
          ))}
        </ul>
        <div className="row">
          <input aria-label="New event name" placeholder="New event name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button onClick={() => guard(async () => {
            const e = await api.createEvent({ name: newName, date: new Date().toISOString() })
            setNewName(''); setSelected(e.id)
          })}>Create</button>
          <label>Import shared event <input type="file" accept=".json" onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void guard(async () => { const ev = await api.importEvent(f); setSelected(ev.id) })
          }} /></label>
        </div>
      </fieldset>

      {current && <EventEditor key={current.id + current.updatedAt} event={current} known={known}
        onChange={(e) => setEvents(events.map((x) => (x.id === e.id ? e : x)))} />}
      <MapsPanel eventId={selected} />
    </main>
  )
}
