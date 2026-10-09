import { act, renderHook, waitFor } from '@testing-library/react'
import { api } from './api'
import { useLive } from './useLive'
import { event, pos, track } from './test/fixtures'

class FakeES {
  static last: FakeES
  listeners: Record<string, (e: MessageEvent) => void> = {}
  onopen?: () => void
  onerror?: () => void
  closed = false
  constructor(public url: string) { FakeES.last = this }
  addEventListener(n: string, fn: (e: MessageEvent) => void) { this.listeners[n] = fn }
  close() { this.closed = true }
}

describe('useLive', () => {
  beforeEach(() => { vi.stubGlobal('EventSource', FakeES) })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('loads and applies live updates only to the matching tracker', async () => {
    vi.spyOn(api, 'getEvent').mockResolvedValue(event())
    vi.spyOn(api, 'positions').mockResolvedValue([track({ positions: [pos(1)] }), track({ trackerName: 'sw2', positions: [] })])
    const { result, unmount } = renderHook(() => useLive('e1'))
    await waitFor(() => expect(result.current.event?.id).toBe('e1'))
    expect(result.current.connected).toBe(false)

    act(() => FakeES.last.onopen?.())
    expect(result.current.connected).toBe(true)
    const fresh = pos(0, { id: 99, time: new Date().toISOString() })
    act(() => FakeES.last.listeners.position({ data: JSON.stringify(fresh) } as MessageEvent))
    expect(result.current.tracks[0].positions[0].id).toBe(99)
    expect(result.current.tracks[1].positions).toHaveLength(0)
    act(() => FakeES.last.onerror?.())
    expect(result.current.connected).toBe(false)

    unmount()
    expect(FakeES.last.closed).toBe(true)
  })

  it('reports load errors', async () => {
    vi.spyOn(api, 'getEvent').mockRejectedValue(new Error('not found'))
    vi.spyOn(api, 'positions').mockResolvedValue([])
    const { result } = renderHook(() => useLive('x'))
    await waitFor(() => expect(result.current.error).toBe('not found'))
  })
})
