import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { AppHeader } from '../AppHeader'
import { eventTiming, metersToMiles } from '../format'
import type { SweepEvent } from '../types'

const TIMING = { today: ['ok', 'Today'], upcoming: ['neutral', 'Upcoming'], past: ['neutral', 'Past'] } as const

export function HomePage() {
  const [events, setEvents] = useState<SweepEvent[]>()
  const [error, setError] = useState<string>()
  useEffect(() => { api.listEvents().then(setEvents).catch((e: Error) => setError(e.message)) }, [])
  const now = new Date()
  return (
    <main className="page wide">
      <AppHeader />
      <h1>Events</h1>
      {error && <p role="alert" className="error">{error}</p>}
      {events && events.length === 0 && (
        <div className="empty card">
          <p>No events yet.</p>
          <Link to="/admin" className="btn primary">Create one</Link>
        </div>
      )}
      <ul className="events">
        {events?.map((e) => {
          const [tone, label] = TIMING[eventTiming(e.date, now)]
          return (
            <li key={e.id} className="event card">
              <div className="event-top">
                <Link to={`/e/${e.id}`} className="event-link">{e.name}</Link>
                <span className={`chip ${tone}`}>{label}</span>
              </div>
              <span className="muted">{new Date(e.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
              <span className="event-meta">
                {e.course ? <span>{metersToMiles(e.course.distanceM).toFixed(1)} mi</span> : <span className="chip warn">No course</span>}
                {e.course && <span>{e.course.waypoints.length} waypoints</span>}
                <span>{e.trackers.length} {e.trackers.length === 1 ? 'team' : 'teams'}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
