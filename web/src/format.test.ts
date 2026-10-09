import { ageLabel, fadeOpacity, lastFix, mergePosition, metersToMiles, sweepState } from './format'
import type { Position } from './types'

const pos = (id: number, over: Partial<Position> = {}): Position => ({
  id, trackerName: 'a', hasFix: true, lat: 1, lon: 2, moving: false,
  time: new Date(1_700_000_000_000 + id * 1000).toISOString(), receivedAt: '', ...over,
})

describe('format', () => {
  it('fades older reports down to a floor', () => {
    expect(fadeOpacity(0)).toBe(1)
    expect(fadeOpacity(1)).toBeLessThan(1)
    expect(fadeOpacity(2)).toBeLessThan(fadeOpacity(1))
    expect(fadeOpacity(50)).toBe(0.12)
  })
  it('derives sweep state', () => {
    expect(sweepState()).toBe('unknown')
    expect(sweepState(pos(1, { hasFix: false }))).toBe('nofix')
    expect(sweepState(pos(1, { moving: true }))).toBe('moving')
    expect(sweepState(pos(1))).toBe('stopped')
  })
  it('labels age', () => {
    const t = new Date(0).toISOString()
    expect(ageLabel(t, 5_000)).toBe('5s ago')
    expect(ageLabel(t, 120_000)).toBe('2m ago')
    expect(ageLabel(t, 3_900_000)).toBe('1h 5m ago')
    expect(ageLabel(t, 2 * 86_400_000)).toBe('2d ago')
    expect(ageLabel(t, -5_000)).toBe('0s ago')
  })
  it('converts units', () => {
    expect(metersToMiles(1609.344)).toBeCloseTo(1)
  })
  it('finds last fix', () => {
    expect(lastFix([pos(3, { hasFix: false }), pos(2)])?.id).toBe(2)
    expect(lastFix([pos(1, { hasFix: false })])).toBeUndefined()
  })
  it('merges live positions newest-first, deduped and capped', () => {
    const base = [pos(2), pos(1)]
    expect(mergePosition(base, pos(3), 8).map((p) => p.id)).toEqual([3, 2, 1])
    expect(mergePosition(base, pos(2), 8)).toBe(base)
    expect(mergePosition(base, pos(3), 2).map((p) => p.id)).toEqual([3, 2])
    expect(mergePosition(base, pos(0, { time: new Date(0).toISOString() }), 8)).toHaveLength(3)
  })
})
