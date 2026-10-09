import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { formatBytes } from './format'
import type { MapsInfo } from './types'

export function MapsPanel({ eventId, pollMs = 2000, onInfo }: { eventId?: string; pollMs?: number; onInfo?: (info: MapsInfo) => void }) {
  const [info, setInfo] = useState<MapsInfo>()
  const [min, setMin] = useState(6)
  const [max, setMax] = useState(15)
  const [buffer, setBuffer] = useState(2500)
  const [error, setError] = useState<string>()
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(() => api.maps().then((m) => { setInfo(m); onInfo?.(m) }).catch((e: Error) => setError(e.message)), [onInfo])
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

  async function clear() {
    setError(undefined)
    setConfirming(false)
    try { await api.clearMaps(); await load() } catch (e) { setError((e as Error).message) }
  }

  const st = info?.status
  return (
    <fieldset className="panel" id="setup-maps">
      <legend>5 · Offline maps</legend>
      <ul className="layer-list">{info?.layers.map((l) => <li key={l.id} className="chip">{l.name}: {l.tileCount.toLocaleString()} tiles · {formatBytes(l.sizeBytes)} (zoom {l.minZoom}–{l.maxZoom})</li>)}</ul>
      <p className="muted">Refreshing needs an internet connection. It downloads tiles around the selected event&apos;s course.</p>
      <div className="row end">
        <label>Min zoom <input type="number" min={0} max={18} value={min} onChange={(e) => setMin(+e.target.value)} /></label>
        <label>Max zoom <input type="number" min={0} max={18} value={max} onChange={(e) => setMax(+e.target.value)} /></label>
        <label>Buffer (m) <input type="number" min={0} value={buffer} onChange={(e) => setBuffer(+e.target.value)} /></label>
        <button className="primary" disabled={!eventId || running} onClick={refresh}>Download / refresh maps</button>
        <button className="danger-outline" disabled={running} onClick={() => setConfirming(true)}>Clear offline maps</button>
      </div>
      {running && st && <progress aria-label="Map download progress" value={st.done} max={st.total || 1} />}
      {running && st && <span> {st.layer}: {st.done}/{st.total}</span>}
      {st?.error && <p role="alert" className="error">{st.error}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {confirming && (
        <div className="modal-backdrop">
          <div role="dialog" aria-modal="true" aria-labelledby="clear-maps-title" className="modal">
            <h3 id="clear-maps-title">Clear offline maps?</h3>
            <p>This deletes all downloaded map tiles for every event. Maps will be blank until you download them again, which needs an internet connection.</p>
            <div className="row">
              <button onClick={() => setConfirming(false)}>Cancel</button>
              <button className="danger" onClick={clear}>Clear maps</button>
            </div>
          </div>
        </div>
      )}
    </fieldset>
  )
}
