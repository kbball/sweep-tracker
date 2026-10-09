import { formatClock, hhmm, minutesOf, parseClock, parseHandbook, weekdayOf } from './handbook'

// The table as pasted from the runner handbook PDF: one cell per line, some blank cells lost.
const HANDBOOK = `Aid Station
Mile
Miles to next AS
Miles to Finish
Cut-off Time
Pacer
Crew Access/
Drop-Bag
Convention Center
0
3.2


12pm




Powerlines
3.2
8.4
96.8
1PM 


NO 
Stover
11.6
7.2
88.4
NO DROPS


NO 
Snake
18.8
6.5
81.2
6PM Friday


Yes/Yes
Pocket Rd.
25.3
3.3
74.7
8:15PM Friday


NO
John’s Mtn
28.6
7.5
71.4
NO DROPS


NO 
Arrive at Dry Creek
36.1
6.7
63.9
12AM Saturday


Yes/Yes
Finish Loop #1
42.8
7.2
57.2
2AM Saturday


Yes/Yes
Finish Loop #2
50
7.2
50
4:30 AM Saturday
Yes
Yes/Yes
Finish Loop #3
*this is the same loop as #1
57.2
6.7
42.8
7AM Saturday
Yes
Yes/Yes
Finish Loop #4 *this is the same loop as #2  & Leave DC
63.9
7.5
36.1
9:15 AM Saturday
Yes
Yes/Yes
John’s Mtn 
71.4
3.3
28.6
NO DROPS


NO 
Pocket Rd. 
74.7
6.5
25.3
1:15 PM Saturday
Yes
Yes/NO
Snake Creek
81.2
7.2
18.8
3:30 PM Saturday
Yes
Yes/Yes
Stover
88.4
8.4
11.6




NO 
Powerlines
96.8
3.2
3.2
9:30 PM Saturday 


NO 
Finish 
100




11 PM Saturday





`

const FRIDAY_NOON = { weekday: 5, minutes: 12 * 60 }

describe('clock times', () => {
  it('reads the day and time as hours after the start', () => {
    expect(parseClock('12pm', FRIDAY_NOON)).toBe(0)
    expect(parseClock('6PM Friday', FRIDAY_NOON)).toBe(6)
    expect(parseClock('8:15PM Friday', FRIDAY_NOON)).toBe(8.25)
    expect(parseClock('12AM Saturday', FRIDAY_NOON)).toBe(12)
    expect(parseClock('4:30 AM Saturday', FRIDAY_NOON)).toBe(16.5)
    expect(parseClock('11 PM Saturday', FRIDAY_NOON)).toBe(35)
    expect(parseClock('noon Friday', FRIDAY_NOON)).toBe(0)
    expect(parseClock('midnight Saturday', FRIDAY_NOON)).toBe(12)
  })
  it('puts a time with no day after the previous cutoff', () => {
    expect(parseClock('1PM', FRIDAY_NOON)).toBe(1)
    expect(parseClock('1PM', FRIDAY_NOON, 30)).toBe(49) // the next 1 PM after 30 hours (1, 25, 49)
    expect(parseClock('11AM', FRIDAY_NOON)).toBe(23) // earlier than the start's clock: the next day
  })
  it('treats an earlier time on the start day as next week', () => {
    expect(parseClock('11AM Friday', FRIDAY_NOON)).toBe(167)
  })
  it('rejects things that are not times', () => {
    for (const bad of ['', 'NO DROPS', '13PM', '0AM', '6:75PM', '6PM Funday', '6', 'later']) expect(parseClock(bad, FRIDAY_NOON)).toBeUndefined()
  })
  it('formats hours after the start as a clock time and day', () => {
    expect(formatClock(0, FRIDAY_NOON)).toBe('Fri 12:00 PM')
    expect(formatClock(6, FRIDAY_NOON)).toBe('Fri 6:00 PM')
    expect(formatClock(12, FRIDAY_NOON)).toBe('Sat 12:00 AM')
    expect(formatClock(16.5, FRIDAY_NOON)).toBe('Sat 4:30 AM')
    expect(formatClock(35, FRIDAY_NOON)).toBe('Sat 11:00 PM')
    expect(formatClock(100, FRIDAY_NOON)).toBe('Tue 4:00 PM')
  })
  it('converts start times and dates', () => {
    expect(minutesOf('12:00')).toBe(720)
    expect(minutesOf('07:05')).toBe(425)
    for (const bad of [undefined, '', 'noon', '24:00', '12:60', '9:00']) expect(minutesOf(bad)).toBeUndefined()
    expect(hhmm(720)).toBe('12:00')
    expect(hhmm(425)).toBe('07:05')
    expect(weekdayOf('2026-10-09')).toBe(5) // a Friday
    expect(weekdayOf('2026-10-10T00:00:00Z')).toBe(6)
  })
})

describe('parseHandbook', () => {
  const { rows, warnings, inferredStart } = parseHandbook(HANDBOOK, { weekday: 5, startMinutes: 720 })

  it('finds every station in the pasted table', () => {
    expect(rows).toHaveLength(17)
    expect(rows.map((r) => r.mile)).toEqual([0, 3.2, 11.6, 18.8, 25.3, 28.6, 36.1, 42.8, 50, 57.2, 63.9, 71.4, 74.7, 81.2, 88.4, 96.8, 100])
    expect(rows[0].label).toBe('Convention Center')
    expect(rows[10].label).toBe('Finish Loop #4 & Leave DC') // the footnote on the same line is dropped, but not what it adds
    expect(rows[16].label).toBe('Finish')
  })

  it('keeps a trailing "& …" from a footnote and drops the rest', () => {
    const r = parseHandbook('Loop 1 *same as the first loop\n1\nLoop 2 *same as #1 & Leave DC\n2\nLoop 3 * just a note\n3', { weekday: 5, startMinutes: 720 })
    expect(r.rows.map((x) => x.label)).toEqual(['Loop 1', 'Loop 2 & Leave DC', 'Loop 3'])
  })

  it('reads each cutoff as hours after the Friday noon start, in course order', () => {
    expect(rows.map((r) => r.cutoffHours)).toEqual([0, 1, undefined, 6, 8.25, undefined, 12, 14, 16.5, 19, 21.25, undefined, 25.25, 27.5, undefined, 33.5, 35])
    expect(rows[1].cutoffText).toBe('1PM')
  })

  it('reads pacers and crew access, ignoring the "NO DROPS" notes', () => {
    expect(rows.filter((r) => r.pacer).map((r) => r.label)).toEqual(['Finish Loop #2', 'Finish Loop #3', 'Finish Loop #4 & Leave DC', 'Pocket Rd.', 'Snake Creek'])
    expect(rows.map((r) => r.crew)).toEqual(['', 'NO', 'NO', 'Yes/Yes', 'NO', 'NO', 'Yes/Yes', 'Yes/Yes', 'Yes/Yes', 'Yes/Yes', 'Yes/Yes', 'NO', 'Yes/NO', 'Yes/Yes', 'NO', 'NO', ''])
  })

  it('reads the printed distances and finds nothing wrong with this table', () => {
    expect(rows[1]).toMatchObject({ mile: 3.2, nextMiles: 8.4, toFinish: 96.8 })
    expect(rows[16].nextMiles).toBeUndefined()
    expect(warnings).toEqual([])
    expect(inferredStart).toBeUndefined() // the start was given
  })

  it('works out the start from the first row when it is not known', () => {
    const r = parseHandbook(HANDBOOK, { weekday: 5 })
    expect(r.inferredStart).toBe('12:00')
    expect(r.rows.map((x) => x.cutoffHours)).toEqual(rows.map((x) => x.cutoffHours))
  })

  it('warns about distances that disagree and cutoffs it cannot read or that are out of order', () => {
    const table = ['Start', '0', '5', '10', '12pm', 'Aid', '6', '4', '4', '6PM Friday', 'Late', '10', '9', '5', '2PM Friday', 'Finish', '10', '9PM Friday'].join('\n')
    const bad = parseHandbook(table, { weekday: 5, startMinutes: 720 })
    expect(bad.warnings.some((w) => w.includes('"Start": 5 miles to the next station, but the next row is 6.0 further on'))).toBe(true)
    expect(bad.warnings.some((w) => w.includes('"Aid"'))).toBe(false) // 4 to the next and 4 to the finish agree with the rows
    expect(bad.warnings.some((w) => w.includes('"Late": 5 miles to the finish, but the finish is 0.0 further on'))).toBe(true)
    expect(bad.warnings.some((w) => w.includes('"Late": cutoff "2PM Friday" is earlier than the one before it'))).toBe(true)
  })

  it('copes with junk: no rows, stray values before any row, rows without a mile', () => {
    expect(parseHandbook('', { weekday: 5 }).rows).toEqual([])
    expect(parseHandbook('3.5\n6PM\nYes\nYes/NO\nNO DROPS', { weekday: 5, startMinutes: 720 }).rows).toEqual([])
    const r = parseHandbook('Mystery stop\nYes/Yes', { weekday: 5, startMinutes: 720 })
    expect(r.rows).toHaveLength(1)
    expect(r.warnings).toEqual(['"Mystery stop": no mile found'])
    // Cutoffs with no way to know the start (the first row has none) are reported rather than guessed.
    const noStart = parseHandbook('Start\n0\nAid\n3\n6PM Saturday', { weekday: 5 })
    expect(noStart.warnings[0]).toContain("couldn't read the cutoff")
    expect(noStart.rows[1].cutoffHours).toBeUndefined()
  })
})
