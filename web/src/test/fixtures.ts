import type { Position, SweepEvent, TrackerHistory } from '../types'

export const pos = (id: number, over: Partial<Position> = {}): Position => ({
  id, trackerName: 'sw1', hasFix: true, lat: 39.7 + id / 1000, lon: -105, alt: 1500, batteryV: 3.77, moving: true,
  time: new Date(Date.now() - id * 60_000).toISOString(), receivedAt: '', ...over,
})

export const track = (over: Partial<TrackerHistory> = {}): TrackerHistory => ({
  trackerName: 'sw1', label: 'Sweep 1', color: '#e6194b', positions: [pos(1), pos(2), pos(3)], ...over,
})

export const event = (over: Partial<SweepEvent> = {}): SweepEvent => ({
  id: 'e1', name: 'Test 50K', date: '2026-10-10T00:00:00Z', notes: '', updatedAt: 'u1',
  trackers: [{ trackerName: 'sw1', label: 'Sweep 1', color: '#e6194b' }],
  course: {
    name: 'Loop', distanceM: 16093.44,
    track: [{ lat: 39.7, lon: -105 }, { lat: 39.71, lon: -105.01 }],
    waypoints: [{ name: 'Aid 1', lat: 39.705, lon: -105.005 }, { name: '', lat: 39.706, lon: -105.006 }],
  },
  ...over,
})
