/**
 * Reading a runner handbook's aid station table pasted from a PDF, and working
 * with cutoff times (stored as hours after the race start).
 *
 * A PDF flattens the table to one cell per line and loses some blank cells, so
 * fields are recognised by their shape (a number, a clock time, "Yes/Yes"), not
 * by position.
 */

export interface RaceStart {
  weekday: number // 0 = Sunday
  minutes: number // minutes after local midnight
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const CLOCK = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s+([a-z]+day))?$|^(noon|midnight)(?:\s+([a-z]+day))?$/i

/** "HH:MM" to minutes after midnight, or undefined if it isn't one. */
export function minutesOf(hhmm?: string): number | undefined {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? '')
  if (!m || +m[1] > 23 || +m[2] > 59) return undefined
  return +m[1] * 60 + +m[2]
}

export const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** The day of the week of an ISO date or "YYYY-MM-DD" (by its calendar date). */
export const weekdayOf = (isoDate: string) => new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).getUTCDay()

/**
 * A cutoff like "6PM Friday" or "1PM" as hours after the race start.
 * A day name is relative to the start's day; without one, the first time on or
 * after `notBefore` (hours) that has this clock reading, so a column of cutoffs
 * stays in course order.
 */
export function parseClock(text: string, start: RaceStart, notBefore = 0): number | undefined {
  const m = CLOCK.exec(text.trim())
  if (!m) return undefined
  let minutes: number
  let day: string | undefined
  if (m[5]) {
    minutes = m[5].toLowerCase() === 'noon' ? 12 * 60 : 0
    day = m[6]
  } else {
    const h = +m[1], mm = m[2] ? +m[2] : 0
    if (h < 1 || h > 12 || mm > 59) return undefined
    minutes = (h % 12) * 60 + mm + (m[3].toLowerCase() === 'pm' ? 12 * 60 : 0)
    day = m[4]
  }
  let hours = (minutes - start.minutes) / 60
  if (day) {
    const wd = DAYS.indexOf(day.toLowerCase())
    if (wd < 0) return undefined
    hours += ((wd - start.weekday + 7) % 7) * 24
    if (hours < -1e-9) hours += 168 // the same day next week
  } else {
    while (hours < notBefore - 1e-9) hours += 24
  }
  return Math.round(hours * 100) / 100
}

/** "Fri 6:00 PM" for a cutoff given as hours after the start. */
export function formatClock(hours: number, start: RaceStart): string {
  const total = start.minutes + Math.round(hours * 60)
  const day = (start.weekday + Math.floor(total / 1440)) % 7
  const m = ((total % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  return `${SHORT[day]} ${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export interface HandbookRow {
  label: string
  mile?: number
  nextMiles?: number
  toFinish?: number
  cutoffText?: string
  cutoffHours?: number
  pacer: boolean
  crew: string
}

export interface HandbookResult {
  rows: HandbookRow[]
  warnings: string[]
  /** The race start ("HH:MM"), read from the first row when none was known. */
  inferredStart?: string
}

const HEADER = new Set(['aid station', 'mile', 'miles to next as', 'miles to finish', 'cut-off time', 'pacer', 'crew access/', 'drop-bag', 'crew access/ drop-bag'])
const NUMBER = /^\d+(\.\d+)?$/
const CREW = /^(yes|no)(\/(yes|no))?$/i

export function parseHandbook(text: string, ctx: { weekday: number; startMinutes?: number }): HandbookResult {
  const warnings: string[] = []
  const rows: HandbookRow[] = []
  let cur: HandbookRow | undefined
  let nums: number[] = []
  const finish = () => {
    if (!cur) return
    ;[cur.mile, cur.nextMiles, cur.toFinish] = nums
    if (cur.mile === undefined) warnings.push(`"${cur.label}": no mile found`)
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || HEADER.has(line.toLowerCase()) || line.startsWith('*')) continue
    if (NUMBER.test(line)) {
      if (cur) nums.push(parseFloat(line))
    } else if (CLOCK.test(line)) {
      if (cur) cur.cutoffText = line
    } else if (CREW.test(line)) {
      if (!cur) continue
      if (line.toLowerCase() === 'yes') cur.pacer = true // a lone "Yes" is the pacer column
      else cur.crew = line
    } else if (/^no drops$/i.test(line)) {
      // printed in the cutoff column for stations without drop bags: not a cutoff
    } else {
      finish()
      // A name. A footnote printed on the same line is dropped ("Finish Loop #2 *this is the same loop as #1"),
      // except a trailing "& …" that says what the stop is ("Finish Loop #4 *same as #2 & Leave DC").
      const [name, ...note] = line.split(/\s+\*/)
      const also = /&\s*[^&]+$/.exec(note.join(' '))
      cur = { label: also ? `${name.trim()} ${also[0].trim()}` : name.trim(), pacer: false, crew: '' }
      nums = []
      rows.push(cur)
    }
  }
  finish()

  // Cutoffs, in course order. The first row's clock reading is the start when it isn't known.
  let startMinutes = ctx.startMinutes
  let inferredStart: string | undefined
  let prev = 0
  rows.forEach((r, i) => {
    if (!r.cutoffText) return
    if (startMinutes === undefined) {
      const guess = parseClock(r.cutoffText, { weekday: ctx.weekday, minutes: 0 })
      if (guess !== undefined && i === 0) { startMinutes = Math.round(guess * 60) % 1440; inferredStart = hhmm(startMinutes) }
    }
    const h = startMinutes === undefined ? undefined : parseClock(r.cutoffText, { weekday: ctx.weekday, minutes: startMinutes }, prev)
    if (h === undefined) { warnings.push(`"${r.label}": couldn't read the cutoff "${r.cutoffText}"`); return }
    if (h < prev - 1e-9) warnings.push(`"${r.label}": cutoff "${r.cutoffText}" is earlier than the one before it`)
    r.cutoffHours = h
    prev = Math.max(prev, h)
  })

  // The printed distances must agree with each other: a cheap check for misread numbers.
  rows.forEach((r, i) => {
    const next = rows[i + 1]
    if (r.mile !== undefined && next?.mile !== undefined && r.nextMiles !== undefined && Math.abs(next.mile - r.mile - r.nextMiles) > 0.15) {
      warnings.push(`"${r.label}": ${r.nextMiles} miles to the next station, but the next row is ${(next.mile - r.mile).toFixed(1)} further on`)
    }
    const last = rows[rows.length - 1]
    if (r.mile !== undefined && r.toFinish !== undefined && last?.mile !== undefined && Math.abs(last.mile - r.mile - r.toFinish) > 0.15) {
      warnings.push(`"${r.label}": ${r.toFinish} miles to the finish, but the finish is ${(last.mile - r.mile).toFixed(1)} further on`)
    }
  })
  return { rows, warnings, inferredStart }
}
