import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { SweepMap } from '../SweepMap'
import { SweepPanel } from '../SweepPanel'
import { useLive } from '../useLive'
import type { MapLayer } from '../types'

export function MapPage() {
  const { id = '' } = useParams()
  const { event, tracks, error, connected } = useLive(id)
  const [layers, setLayers] = useState<MapLayer[]>()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => { api.maps().then((m) => setLayers(m.layers)).catch(() => undefined) }, [])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])

  if (error) return <p role="alert" className="page error">{error} <Link to="/">Back</Link></p>
  if (!event) return <p className="page">Loading…</p>
  return (
    <div className="layout">
      <aside className="side">
        <header>
          <Link to="/">←</Link> <strong>{event.name}</strong>
          <span className={connected ? 'dot on' : 'dot off'} title={connected ? 'Live' : 'Reconnecting'} />
        </header>
        {!event.course && <p className="muted">No course loaded. Upload a GPX in <Link to="/admin">Admin</Link>.</p>}
        <SweepPanel tracks={tracks} now={now} />
      </aside>
      <SweepMap course={event.course} tracks={tracks} layers={layers} />
    </div>
  )
}
