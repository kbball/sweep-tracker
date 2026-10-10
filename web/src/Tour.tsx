import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { TOUR_EVENT, TOUR_STEPS, markTourSeen, tourUnseen } from './tourState'

interface Box { top: number; left: number; width: number; height: number }

const PAD = 6
const findTarget = (targets: string[]) => {
  for (const t of targets) { const el = document.querySelector(t); if (el) return el }
  return null
}

/** First-run walkthrough. Shown once (the flag is set as soon as it appears); the welcome screen can opt out, and the header can reopen it.
 *  Each step goes to the page it is about and spotlights the part of it being described. */
export function Tour() {
  const [step, setStep] = useState<number>() // undefined = closed, -1 = welcome
  const [box, setBox] = useState<Box>()
  const primary = useRef<HTMLButtonElement>(null)
  const origin = useRef<string>('/')
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const here = useRef(pathname)
  here.current = pathname

  const open = useCallback(() => { origin.current = here.current; setStep(-1) }, [])
  useEffect(() => {
    if (tourUnseen()) { markTourSeen(); open() }
    window.addEventListener(TOUR_EVENT, open)
    return () => window.removeEventListener(TOUR_EVENT, open)
  }, [open])

  const s = step !== undefined && step >= 0 ? TOUR_STEPS[step] : undefined

  // Go to the step's page, then wait for its target to appear (pages load their data first) and scroll it into view.
  useEffect(() => {
    setBox(undefined)
    if (!s) return
    if (pathname !== s.route) { navigate(s.route); return }
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    const find = () => {
      const el = findTarget(s.targets)
      if (el) { el.scrollIntoView?.({ block: 'center' }); measure() } else if (++tries < 20) timer = setTimeout(find, 100)
    }
    const measure = () => {
      const el = findTarget(s.targets)
      if (!el) return setBox(undefined)
      const r = el.getBoundingClientRect()
      setBox({ top: r.top - PAD, left: r.left - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD })
    }
    find()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { clearTimeout(timer); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [s, pathname, navigate])

  useEffect(() => { if (step !== undefined) primary.current?.focus() }, [step])

  if (step === undefined) return null
  const close = () => {
    setStep(undefined)
    if (here.current !== origin.current) navigate(origin.current) // back to where the user was
  }
  const last = step === TOUR_STEPS.length - 1
  // Put the card on the far side of the spotlight so it never covers it.
  const below = box ? box.top + box.height / 2 < window.innerHeight / 2 : false

  return (
    <div className={box ? 'tour-backdrop' : 'modal-backdrop'} onKeyDown={(e) => { if (e.key === 'Escape') close() }}>
      {box && <div className="tour-spot" data-testid="tour-spot" style={box} />}
      <div role="dialog" aria-modal="true" aria-labelledby="tour-title" className={`modal tour${box ? (below ? ' at-bottom' : ' at-top') : ''}`}>
        {s ? (
          <>
            <p className="muted tour-count">Step {step + 1} of {TOUR_STEPS.length}</p>
            <h3 id="tour-title">{s.title}</h3>
            <p>{s.body}</p>
          </>
        ) : (
          <>
            <h3 id="tour-title">Welcome to Sweep Tracker</h3>
            <p>See where your race's sweep teams are, on a map that works with no internet. Want a one-minute tour of how to set up an event?</p>
            <p className="muted">You won't be asked again. You can replay it any time from the header.</p>
          </>
        )}
        <div className="row tour-actions">
          {s ? (
            <>
              <button onClick={close}>Close</button>
              {step > 0 && <button onClick={() => setStep(step - 1)}>Back</button>}
              <button ref={primary} className="primary" onClick={() => (last ? close() : setStep(step + 1))}>{last ? 'Done' : 'Next'}</button>
            </>
          ) : (
            <>
              <button onClick={close}>No thanks</button>
              <button ref={primary} className="primary" onClick={() => setStep(0)}>Take the tour</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
