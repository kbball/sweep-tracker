import { useEffect, useState } from 'react'
import { api } from './api'
import { mergePosition } from './format'
import type { Position, SweepEvent, TrackerHistory } from './types'

/** Reports shown per team on the map and in the team list. */
export const HISTORY = 8
/** Reports kept per team, so a team's place on an out-and-back course can be followed from its start. */
export const KEEP = 500

export interface Live {
  event?: SweepEvent
  tracks: TrackerHistory[]
  error?: string
  connected: boolean
}

/** Loads an event and its positions, then applies live updates from SSE. */
export function useLive(eventId: string): Live {
  const [event, setEvent] = useState<SweepEvent>()
  const [tracks, setTracks] = useState<TrackerHistory[]>([])
  const [error, setError] = useState<string>()
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let cancelled = false
    setEvent(undefined); setTracks([]); setError(undefined)
    Promise.all([api.getEvent(eventId), api.positions(eventId, KEEP)])
      .then(([e, t]) => { if (!cancelled) { setEvent(e); setTracks(t) } })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })

    const es = new EventSource('/api/stream')
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false) // EventSource retries on its own
    es.addEventListener('position', (ev) => {
      const p = JSON.parse((ev as MessageEvent).data) as Position
      setTracks((prev) => prev.map((t) =>
        t.trackerName === p.trackerName ? { ...t, positions: mergePosition(t.positions, p, KEEP) } : t))
    })
    return () => { cancelled = true; es.close() }
  }, [eventId])

  return { event, tracks, error, connected }
}
