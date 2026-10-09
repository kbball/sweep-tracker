export interface Point { lat: number; lon: number; ele?: number }
/** A place the course goes by an aid station; `use` marks the passes that are real visits. */
export interface Pass {
  distM: number
  use: boolean
  label?: string // handbook name, e.g. "Finish Loop #4 & Leave DC"
  mile?: number // official mile (can differ from the GPX distance)
  cutoffHours?: number // hours after the race start
  pacer?: boolean
  crew?: string // crew access / drop bag, as printed
}
/** What the organiser says about one pass, in course order. */
export interface StopInput { use: boolean; label: string; mile?: number; cutoffHours?: number; pacer: boolean; crew: string }
export interface Waypoint extends Point { name: string; desc?: string; type?: string; passes?: Pass[] }
export interface Course { name: string; track: Point[]; waypoints: Waypoint[]; distanceM: number }
export interface EventTracker { trackerName: string; label: string; color: string; startM?: number /* metres along the course this team starts from */ }
export interface SweepEvent {
  id: string
  name: string
  date: string
  startTime?: string // local wall-clock start, "HH:MM"
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
