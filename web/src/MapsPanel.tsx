import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import type { MapsInfo } from './types'

export function MapsPanel({ eventId, pollMs = 2000 }: { eventId?: string; pollMs?: number }) {
  const [info, setInfo] = useState<MapsInfo>()
  const [min, setMin] = useState(6)
  const [max, setMax] = useState(12)
  const [buffer, setBuffer] = useState(2000)
  const [error, setError] = useState<string>()

  const load = useCallback(() => api.maps().then(setInfo).catch((e: Error) => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  const running = info?.status.running
  useEffect(() => {
    if (!running) return
    const t = setInterval(load, pollMs)
    return () => clearInterval(t)
  }, [running, load, pollMs])

  async function refresh() {
    setError(undefined)
    try { await api.refreshMaps(eventId!, min, max, buffer); await load() } catch (e) { setError((e as Error).message) }
  }

  const st = info?.status
  return (
    <fieldset>
      <legend>Offline maps</legend>
      <ul>{info?.layers.map((l) => <li key={l.id}>{l.name}: {l.tileCount.toLocaleString()} tiles (zoom {l.minZoom}–{l.maxZoom})</li>)}</ul>
      <p className="muted">Refreshing needs an internet connection. It downloads tiles around the selected event&apos;s course.</p>
      <div className="row">
        <label>Min zoom <input type="number" min={0} max={18} value={min} onChange={(e) => setMin(+e.target.value)} /></label>
        <label>Max zoom <input type="number" min={0} max={18} value={max} onChange={(e) => setMax(+e.target.value)} /></label>
        <label>Buffer (m) <input type="number" min={0} value={buffer} onChange={(e) => setBuffer(+e.target.value)} /></label>
        <button disabled={!eventId || running} onClick={refresh}>Download / refresh maps</button>
      </div>
      {running && st && <progress aria-label="Map download progress" value={st.done} max={st.total || 1} />}
      {running && st && <span> {st.layer}: {st.done}/{st.total}</span>}
      {st?.error && <p role="alert" className="error">{st.error}</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </fieldset>
  )
}
