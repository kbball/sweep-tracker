export interface Point { lat: number; lon: number; ele?: number }
/** A place the course goes by an aid station; `use` marks the passes that are real visits. */
export interface Pass { distM: number; use: boolean }
export interface Waypoint extends Point { name: string; desc?: string; type?: string; passes?: Pass[] }
export interface Course { name: string; track: Point[]; waypoints: Waypoint[]; distanceM: number }
export interface EventTracker { trackerName: string; label: string; color: string }
export interface SweepEvent {
  id: string
  name: string
  date: string
  notes: string
  course?: Course | null
  trackers: EventTracker[]
  updatedAt?: string
}
export interface Position {
  id: number
  trackerName: string
  hasFix: boolean
  lat: number
  lon: number
  alt?: number
  batteryV?: number
  sats?: number
  moving: boolean
  time: string
  receivedAt: string
}
export interface TrackerHistory extends EventTracker { positions: Position[] }
export interface KnownTracker { name: string; lastSeen: string }
export interface MapLayer { id: string; name: string; attribution: string; minZoom: number; maxZoom: number; tileCount: number; sizeBytes: number; minTileZoom: number; maxTileZoom: number }
export interface RefreshStatus { running: boolean; layer?: string; done: number; total: number; error?: string }
export interface MapsInfo { layers: MapLayer[]; status: RefreshStatus }
export interface AppConfig { version: string }
