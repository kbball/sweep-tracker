import type { KnownTracker, SweepEvent } from './types'
import { metersToMiles } from './format'

export type StepState = 'done' | 'todo' | 'waiting' | 'optional'

export interface SetupStep {
  id: string
  title: string
  state: StepState
  detail: string
  /** The id of the section on the page to jump to. */
  target: string
}

/**
 * The order an event is best set up in, and where each step stands. Later steps
 * depend on earlier ones: cutoffs read as clock times only with a start time,
 * aid stations, team start points and maps all need the course, and a team can
 * start from a stop only once the stops are set up.
 *
 * `tileCount` is how many map tiles are downloaded (maps are shared by all events).
 */
export function setupSteps(event: SweepEvent, known: KnownTracker[], tileCount = 0): SetupStep[] {
  const course = event.course
  const stops = (course?.waypoints ?? []).flatMap((w) => w.passes ?? []).filter((p) => p.use)
  const withDetails = stops.filter((p) => p.mile !== undefined || p.cutoffHours !== undefined)
  const outAndBack = (course?.waypoints ?? []).some((w) => (w.passes ?? []).filter((p) => p.use).length >= 2)
  const heard = new Set(known.map((k) => k.name))
  const teams = event.trackers
  const unplaced = teams.filter((t) => t.startM === undefined)
  const unheard = teams.filter((t) => !heard.has(t.trackerName))

  const steps: SetupStep[] = []
  steps.push(event.startTime
    ? { id: 'details', title: 'Event details', state: 'done', target: 'setup-details', detail: `Starts ${new Date(event.date).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' })} at ${event.startTime}.` }
    : { id: 'details', title: 'Event details', state: 'todo', target: 'setup-details', detail: 'Set the date and the start time, so cutoffs show as clock times. The date should be the first day of the race.' })

  steps.push(course
    ? { id: 'course', title: 'Course', state: 'done', target: 'setup-course', detail: `${metersToMiles(course.distanceM).toFixed(1)} miles, ${course.waypoints.length} waypoint${course.waypoints.length === 1 ? '' : 's'}.` }
    : { id: 'course', title: 'Course', state: 'todo', target: 'setup-course', detail: 'Upload the course GPX. Aid stations, team starts and maps all depend on it.' })

  if (!course) steps.push({ id: 'stops', title: 'Aid stations and cutoffs', state: 'waiting', target: 'setup-stops', detail: 'Needs the course first.' })
  else if (course.waypoints.length === 0) steps.push({ id: 'stops', title: 'Aid stations and cutoffs', state: 'optional', target: 'setup-stops', detail: 'The GPX has no waypoints, so there are no aid stations to set up.' })
  else if (withDetails.length > 0) steps.push({ id: 'stops', title: 'Aid stations and cutoffs', state: 'done', target: 'setup-stops', detail: `${withDetails.length} of ${stops.length} stops have an official mile or a cutoff.` })
  else steps.push({ id: 'stops', title: 'Aid stations and cutoffs', state: 'todo', target: 'setup-stops', detail: 'Fill the table from the runner handbook, or type the miles and cutoffs. Untick passes that are just the trail running close by.' })

  if (teams.length === 0) steps.push({ id: 'teams', title: 'Sweep teams', state: 'todo', target: 'setup-teams', detail: 'Add the tracker name of each sweep team. It can be typed before the tracker has been heard.' })
  else if (outAndBack && course && unplaced.length > 0) steps.push({ id: 'teams', title: 'Sweep teams', state: 'todo', target: 'setup-teams', detail: `Say where each team starts, so it is placed on the right leg of an out-and-back course: ${unplaced.map((t) => t.label || t.trackerName).join(', ')}.` })
  else steps.push({ id: 'teams', title: 'Sweep teams', state: 'done', target: 'setup-teams', detail: `${teams.length} team${teams.length === 1 ? '' : 's'}.` })

  if (!course) steps.push({ id: 'maps', title: 'Offline maps', state: 'waiting', target: 'setup-maps', detail: 'Needs the course first.' })
  else if (tileCount > 0) steps.push({ id: 'maps', title: 'Offline maps', state: 'done', target: 'setup-maps', detail: `${tileCount.toLocaleString()} tiles downloaded. Download again if the course changes.` })
  else steps.push({ id: 'maps', title: 'Offline maps', state: 'todo', target: 'setup-maps', detail: 'Download the map tiles while you have internet. The app runs offline after that.' })

  if (teams.length === 0) steps.push({ id: 'trackers', title: 'Trackers reporting', state: 'waiting', target: 'setup-teams', detail: 'Needs the sweep teams first.' })
  else if (unheard.length === 0) steps.push({ id: 'trackers', title: 'Trackers reporting', state: 'done', target: 'setup-teams', detail: 'Every team has been heard on the mesh.' })
  else steps.push({ id: 'trackers', title: 'Trackers reporting', state: 'todo', target: 'setup-teams', detail: `Not heard yet: ${unheard.map((t) => t.trackerName).join(', ')}. Switch each tracker on within range of the mesh, or try \`sweeptracker simulate\`.` })

  steps.push({ id: 'share', title: 'Share', state: 'optional', target: 'setup-share', detail: 'Export the event file to set up another aid station, or the aid station table for crews.' })
  return steps
}

/** How many of the steps that matter are done. */
export function setupProgress(steps: SetupStep[]): { done: number; total: number } {
  const needed = steps.filter((s) => s.state !== 'optional')
  return { done: needed.filter((s) => s.state === 'done').length, total: needed.length }
}
