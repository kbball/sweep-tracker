import { useState } from 'react'
import { formatClock, parseClock, parseHandbook } from './handbook'
import type { RaceStart } from './handbook'
import { orderedPasses, raceStart } from './stops'
import type { Course, StopInput } from './types'

interface Row {
  use: boolean
  label: string
  mile: string
  cutoff: string // what is shown in the box
  hours?: number // the cutoff it means, if it could be read
  pacer: boolean
  crew: string
  station: string
  gpxMile: number
}

const HOURS = /^\+?(\d+(?:\.\d+)?)\s*h$/i

/** A cutoff typed as a clock time ("6PM Friday") or as hours after the start ("+6h"). */
function readCutoff(text: string, start: RaceStart | undefined, notBefore: number): number | undefined {
  const h = HOURS.exec(text.trim())
  return h ? parseFloat(h[1]) : start ? parseClock(text, start, notBefore) : undefined
}

const show = (hours: number | undefined, start: RaceStart | undefined) =>
  hours === undefined ? '' : start ? formatClock(hours, start) : `+${hours} h`

interface Props {
  course: Course
  date: string
  startTime: string
  /** Called when pasting a table works out the race start and none was set. */
  onStartTime: (hhmm: string) => void
  onSave: (stops: StopInput[]) => Promise<void>
}

export function StopsEditor({ course, date, startTime, onStartTime, onSave }: Props) {
  const start = raceStart(date, startTime)
  const [rows, setRows] = useState<Row[]>(() => orderedPasses(course).map(({ waypoint, pass }) => ({
    use: pass.use,
    label: pass.label ?? '',
    mile: pass.mile === undefined ? '' : String(pass.mile),
    cutoff: show(pass.cutoffHours, start),
    hours: pass.cutoffHours,
    pacer: pass.pacer ?? false,
    crew: pass.crew ?? '',
    station: waypoint.name || 'Waypoint',
    gpxMile: pass.distM / 1609.344,
  })))
  const [paste, setPaste] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [error, setError] = useState<string>()

  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))

  const commitCutoff = (i: number) => {
    const text = rows[i].cutoff.trim()
    if (!text) return patch(i, { hours: undefined, cutoff: '' })
    const before = rows.slice(0, i).reduce((m, r) => Math.max(m, r.hours ?? 0), 0)
    const hours = readCutoff(text, start, before)
    patch(i, hours === undefined ? { hours: undefined } : { hours, cutoff: show(hours, start) })
  }
  const unreadable = (r: Row) => r.cutoff.trim() !== '' && r.hours === undefined

  function fill() {
    const weekday = start?.weekday ?? new Date(`${date}T00:00:00Z`).getUTCDay()
    const result = parseHandbook(paste, { weekday, startMinutes: start?.minutes })
    const got = result.rows
    const found: string[] = [...result.warnings]
    if (got.length === 0) { setNotes(['Nothing that looks like an aid station table was found in the pasted text.']); return }
    if (got.length !== rows.length) found.unshift(`The table has ${got.length} rows but the course has ${rows.length} stops. Matching them in order; check the rest by hand.`)
    // Show cutoffs against the start that was just worked out when none was set.
    const useStart: RaceStart | undefined = start ?? (result.inferredStart ? raceStart(date, result.inferredStart) : undefined)
    if (result.inferredStart && !startTime) onStartTime(result.inferredStart)
    setRows(rows.map((r, i) => {
      const g = got[i]
      if (!g) return r
      return {
        ...r, use: true, label: g.label, mile: g.mile === undefined ? '' : String(g.mile),
        hours: g.cutoffHours, cutoff: g.cutoffHours !== undefined ? show(g.cutoffHours, useStart) : (g.cutoffText ?? ''),
        pacer: g.pacer, crew: g.crew,
      }
    }))
    setNotes(found)
    setError(undefined)
  }

  async function save() {
    setError(undefined)
    const bad = rows.findIndex(unreadable)
    if (bad >= 0) return setError(`Stop ${bad + 1}: I can't read the cutoff "${rows[bad].cutoff}". Use a time like "6PM Friday", or hours after the start like "+6h".`)
    const badMile = rows.findIndex((r) => r.mile.trim() !== '' && !Number.isFinite(Number(r.mile)))
    if (badMile >= 0) return setError(`Stop ${badMile + 1}: the mile must be a number.`)
    await onSave(rows.map((r) => ({
      use: r.use, label: r.label.trim(), mile: r.mile.trim() === '' ? undefined : Number(r.mile),
      cutoffHours: r.hours, pacer: r.pacer, crew: r.crew.trim(),
    })))
  }

  return (
    <>
      <h3>Aid stations</h3>
      <p className="muted">
        One row for each time the course goes by an aid station (an out-and-back passes each twice). Untick a row that is just the trail
        running close by. Cutoffs are times such as <code>6PM Friday</code>, or hours after the start such as <code>+6h</code>.
      </p>

      <details className="paste">
        <summary>Fill from the runner handbook</summary>
        <label>
          Paste the aid station table
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} placeholder="Copy the table from the PDF and paste it here" />
        </label>
        <button type="button" disabled={!paste.trim()} onClick={fill}>Fill the table</button>
        {notes.length > 0 && <ul className="notes" role="status">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      </details>

      <div className="stops-scroll">
        <table className="stops">
          <thead>
            <tr><th>Stop</th><th>Station</th><th>Name</th><th>Mile</th><th>Cutoff</th><th>Pacer</th><th>Crew / drop bag</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.use ? undefined : 'off'}>
                <td><input type="checkbox" checked={r.use} onChange={() => patch(i, { use: !r.use })} aria-label={`Stop ${i + 1} is a real stop`} /></td>
                <td>{r.station}<small className="muted"> GPX mi {r.gpxMile.toFixed(1)}</small></td>
                <td><input value={r.label} onChange={(e) => patch(i, { label: e.target.value })} aria-label={`Name of stop ${i + 1}`} placeholder={r.station} /></td>
                <td><input className="num" inputMode="decimal" value={r.mile} onChange={(e) => patch(i, { mile: e.target.value })} aria-label={`Mile of stop ${i + 1}`} /></td>
                <td>
                  <input value={r.cutoff} onChange={(e) => patch(i, { cutoff: e.target.value, hours: undefined })} onBlur={() => commitCutoff(i)}
                    aria-label={`Cutoff of stop ${i + 1}`} aria-invalid={unreadable(r)} className={unreadable(r) ? 'bad' : undefined} />
                </td>
                <td><input type="checkbox" checked={r.pacer} onChange={() => patch(i, { pacer: !r.pacer })} aria-label={`Pacers allowed from stop ${i + 1}`} /></td>
                <td><input className="crew" value={r.crew} onChange={(e) => patch(i, { crew: e.target.value })} aria-label={`Crew and drop bag at stop ${i + 1}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <button type="button" className="primary save" onClick={() => void save()}>Save aid stations</button>
    </>
  )
}

