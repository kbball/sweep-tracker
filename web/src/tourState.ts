const KEY = 'sweep-tour-seen'
export const TOUR_EVENT = 'sweep-tour-open'

export interface TourStep {
  title: string
  body: string
  /** Page to show while this step is up. */
  route: string
  /** Elements to highlight, tried in order: the first one on the page wins. Later ones are fallbacks for when there is no event yet. */
  targets: string[]
}

/** After the welcome screen: what a new user needs to know, in the order they will meet it. */
export const TOUR_STEPS: TourStep[] = [
  { title: 'Events and the live map', route: '/', targets: ['.events', '.empty'], body: 'The Events page lists every race. Open one to see the course on an offline topo map, with each sweep team, its last report, mile, next aid station and cutoff, and a progress strip along the bottom.' },
  { title: 'Set up in Admin', route: '/admin', targets: ['.guide'], body: 'The setup guide at the top of Admin lists the steps in the order an event is best set up, and tells you what is left to do.' },
  { title: 'Create or import an event', route: '/admin', targets: ['#admin-events'], body: 'Create an event here, or import a .sweep.json file someone shared. Edit opens it for setup; View opens its live map.' },
  { title: 'Course and aid stations', route: '/admin', targets: ['#setup-stops', '#setup-course', '.guide'], body: 'Upload the course GPX first: everything else depends on it. Then paste the aid station table from the runner handbook (or type it) to get official miles, cutoffs, pacer flags and crew notes.' },
  { title: 'Sweep teams and trackers', route: '/admin', targets: ['#setup-teams', '.guide'], body: 'Add each sweep team by the name its Meshcore tracker sends and pick where it starts. A team is only placed on the course from its start onwards.' },
  { title: 'Offline maps', route: '/admin', targets: ['#setup-maps'], body: 'Download map tiles once, while you have internet. After that the app runs with no connection at all, so do this before heading to the course.' },
]

/** True if the tour has never been shown here. Without working storage we can't remember it, so it stays quiet. */
export function tourUnseen(): boolean {
  try { return localStorage.getItem(KEY) === null } catch { return false }
}

export function markTourSeen() {
  try { localStorage.setItem(KEY, '1') } catch { /* storage unavailable: nothing to remember it with */ }
}

export const openTour = () => window.dispatchEvent(new Event(TOUR_EVENT))
