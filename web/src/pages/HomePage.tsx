import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { SweepEvent } from '../types'

export function HomePage() {
  const [events, setEvents] = useState<SweepEvent[]>()
  const [error, setError] = useState<string>()
  useEffect(() => { api.listEvents().then(setEvents).catch((e: Error) => setError(e.message)) }, [])
  return (
    <main className="page">
      <h1>Sweep Tracker</h1>
      {error && <p role="alert" className="error">{error}</p>}
      {events && events.length === 0 && <p>No events yet. <Link to="/admin">Create one</Link>.</p>}
      <ul className="events">
        {events?.map((e) => (
          <li key={e.id}><Link to={`/e/${e.id}`}>{e.name}</Link> <span className="muted">{new Date(e.date).toLocaleDateString()}</span></li>
        ))}
      </ul>
      <p><Link to="/admin">Admin</Link></p>
    </main>
  )
}
