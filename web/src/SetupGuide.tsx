import { setupProgress, setupSteps } from './setup'
import type { SetupStep, StepState } from './setup'
import type { KnownTracker, SweepEvent } from './types'

const LABEL: Record<StepState, string> = { done: 'Done', todo: 'To do', waiting: 'Waiting', optional: 'Optional' }
const TONE: Record<StepState, string> = { done: 'ok', todo: 'warn', waiting: 'neutral', optional: 'neutral' }

/** What setting up an event involves, in order, before there is an event to look at. */
const OUTLINE: Pick<SetupStep, 'title' | 'detail'>[] = [
  { title: 'Event details', detail: 'Name, date and start time.' },
  { title: 'Course', detail: 'The GPX. Everything below depends on it.' },
  { title: 'Aid stations and cutoffs', detail: 'Miles, cutoffs, pacers and crew access for each stop, from the runner handbook.' },
  { title: 'Sweep teams', detail: 'Who they are and where each one starts.' },
  { title: 'Offline maps', detail: 'Downloaded once, while you have internet.' },
  { title: 'Trackers reporting', detail: 'Check each tracker is heard on the mesh before race day.' },
]

const jump = (id: string) => document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })

interface Props {
  event?: SweepEvent
  known: KnownTracker[]
  tileCount?: number
}

/** A checklist for the selected event, or an outline of the order when none is selected. */
export function SetupGuide({ event, known, tileCount }: Props) {
  if (!event) {
    return (
      <section className="guide card" aria-label="Setup guide">
        <h2>Setting up an event</h2>
        <p className="muted">Do these in order: each step needs the ones before it. Create or select an event to start.</p>
        <ol className="outline">
          {OUTLINE.map((s) => <li key={s.title}><strong>{s.title}</strong> <span className="muted">{s.detail}</span></li>)}
        </ol>
      </section>
    )
  }
  const steps = setupSteps(event, known, tileCount)
  const { done, total } = setupProgress(steps)
  return (
    <details className="guide card" open aria-label="Setup guide">
      <summary>
        <h2>Setup guide</h2>
        <span className={`chip ${done === total ? 'ok' : 'neutral'}`}>{done} of {total} done</span>
      </summary>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.id} className={`step ${s.state}`}>
            <span className="num" aria-hidden="true">{i + 1}</span>
            <div className="what">
              <strong>{s.title}</strong> <span className={`chip ${TONE[s.state]}`}>{LABEL[s.state]}</span>
              <p>{s.detail}</p>
            </div>
            <button type="button" className="ghost" aria-label={`Go to ${s.title}`} onClick={() => jump(s.target)}>Go</button>
          </li>
        ))}
      </ol>
    </details>
  )
}
