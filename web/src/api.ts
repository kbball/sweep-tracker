import type { AppConfig, KnownTracker, MapsInfo, RefreshStatus, StopInput, SweepEvent, TrackerHistory } from './types'

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function req<T>(method: string, path: string, body?: BodyInit | null, json = false): Promise<T> {
  const headers: Record<string, string> = {}
  if (json) headers['Content-Type'] = 'application/json'
  const res = await fetch(path, { method, headers, body })
  if (!res.ok) {
    let msg = res.statusText
    try { msg = (await res.json()).error ?? msg } catch { /* not JSON */ }
    throw new ApiError(res.status, msg)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

const send = <T>(method: string, path: string, obj: unknown) => req<T>(method, path, JSON.stringify(obj), true)

export const api = {
  config: () => req<AppConfig>('GET', '/api/config'),
  listEvents: () => req<SweepEvent[]>('GET', '/api/events'),
  getEvent: (id: string) => req<SweepEvent>('GET', `/api/events/${id}`),
  createEvent: (e: Partial<SweepEvent>) => send<SweepEvent>('POST', '/api/events', e),
  updateEvent: (id: string, e: Partial<SweepEvent>) => send<SweepEvent>('PUT', `/api/events/${id}`, e),
  deleteEvent: (id: string) => req<void>('DELETE', `/api/events/${id}`),
  uploadCourse: (id: string, gpx: Blob) => req<SweepEvent>('PUT', `/api/events/${id}/course`, gpx),
  setStops: (id: string, stops: StopInput[]) => send<SweepEvent>('PUT', `/api/events/${id}/stops`, { stops }),
  importEvent: (bundle: Blob) => req<SweepEvent>('POST', '/api/events/import', bundle),
  exportUrl: (id: string) => `/api/events/${id}/export`,
  positions: (id: string, history = 10) => req<TrackerHistory[]>('GET', `/api/events/${id}/positions?history=${history}`),
  knownTrackers: () => req<KnownTracker[]>('GET', '/api/trackers'),
  maps: () => req<MapsInfo>('GET', '/api/maps'),
  clearMaps: () => req<void>('DELETE', '/api/maps'),
  refreshMaps: (eventId: string, minZoom: number, maxZoom: number, bufferM: number) =>
    send<RefreshStatus>('POST', '/api/maps/refresh', { eventId, minZoom, maxZoom, bufferM }),
}
