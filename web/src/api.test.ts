import { api, ApiError } from './api'

const ok = (body: unknown, status = 200) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status }))

describe('api', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => vi.unstubAllGlobals())

  it('sends JSON bodies', async () => {
    fetchMock.mockReturnValue(ok({ id: '1' }))
    await api.createEvent({ name: 'x' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/events')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Authorization).toBeUndefined()
    expect(init.body).toBe('{"name":"x"}')
  })
  it('handles 204', async () => {
    fetchMock.mockReturnValue(ok(null, 204))
    await expect(api.deleteEvent('1')).resolves.toBeUndefined()
  })
  it('throws ApiError with server message, falling back to status text', async () => {
    fetchMock.mockReturnValueOnce(ok({ error: 'name is required' }, 400))
    await expect(api.listEvents()).rejects.toMatchObject({ status: 400, message: 'name is required' })
    fetchMock.mockReturnValueOnce(Promise.resolve(new Response('oops', { status: 502, statusText: 'Bad Gateway' })))
    await expect(api.listEvents()).rejects.toBeInstanceOf(ApiError)
  })
  it('builds the expected requests', async () => {
    fetchMock.mockImplementation(() => ok({}))
    await api.config(); await api.getEvent('e'); await api.updateEvent('e', {}); await api.positions('e', 3)
    await api.knownTrackers(); await api.maps(); await api.refreshMaps('e', 8, 14, 2000)
    await api.uploadCourse('e', new Blob(['x'])); await api.importEvent(new Blob(['x']))
    expect(fetchMock.mock.calls.map((c) => `${c[1].method} ${c[0]}`)).toEqual([
      'GET /api/config', 'GET /api/events/e', 'PUT /api/events/e', 'GET /api/events/e/positions?history=3',
      'GET /api/trackers', 'GET /api/maps', 'POST /api/maps/refresh',
      'PUT /api/events/e/course', 'POST /api/events/import',
    ])
    expect(api.exportUrl('e')).toBe('/api/events/e/export')
  })
})
