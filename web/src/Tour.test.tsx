import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { Tour } from './Tour'
import { TOUR_STEPS, openTour, tourUnseen } from './tourState'

const Where = () => <span data-testid="where">{useLocation().pathname}</span>
function Harness({ at = '/', maps = true }: { at?: string; maps?: boolean }) {
  return (
    <MemoryRouter initialEntries={[at]}>
      <Tour /><Where />
      <Routes>
        <Route path="/" element={<ul className="events"><li>an event</li></ul>} />
        <Route path="/admin" element={<><section className="guide">guide</section><fieldset id="admin-events">events</fieldset>{maps && <div id="setup-maps">maps</div>}</>} />
        <Route path="*" element={<p>other</p>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('Tour', () => {
  it('shows once on first use and never again after', async () => {
    const { unmount } = render(<Harness />)
    expect(screen.getByRole('dialog', { name: 'Welcome to Sweep Tracker' })).toBeInTheDocument()
    expect(tourUnseen()).toBe(false)
    unmount()
    render(<Harness />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('can be skipped on the first screen', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'No thanks' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('walks through every step, back and forth, then finishes', async () => {
    const u = userEvent.setup()
    render(<Harness />)
    await u.click(screen.getByRole('button', { name: 'Take the tour' }))
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length}`)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { name: TOUR_STEPS[1].title })).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: TOUR_STEPS[0].title })).toBeInTheDocument()
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) await u.click(screen.getByRole('button', { name: 'Next' }))
    await u.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on Escape and can be reopened from the header', async () => {
    const u = userEvent.setup()
    render(<Harness />)
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => openTour())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('stays quiet when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    render(<Harness />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('Tour highlighting', () => {
  it('goes to each step\'s page and spotlights what it describes, then returns to where the user was', async () => {
    const u = userEvent.setup()
    render(<Harness at="/other" />)
    expect(screen.queryByTestId('tour-spot')).not.toBeInTheDocument() // welcome has nothing to point at
    await u.click(screen.getByRole('button', { name: 'Take the tour' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/')
    expect(await screen.findByTestId('tour-spot')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/admin'))
    expect(await screen.findByTestId('tour-spot')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/other')
  })

  it('falls back to a later target, and to a plain dialog when nothing is on the page', async () => {
    const u = userEvent.setup()
    render(<Harness at="/admin" />)
    await u.click(screen.getByRole('button', { name: 'Take the tour' }))
    for (let i = 0; i < 3; i++) await u.click(screen.getByRole('button', { name: 'Next' })) // → Course and aid stations: only .guide exists
    expect(screen.getByRole('heading', { name: 'Course and aid stations' })).toBeInTheDocument()
    expect(await screen.findByTestId('tour-spot')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Back' })) // → Create or import: #admin-events
    expect(await screen.findByTestId('tour-spot')).toBeInTheDocument()
  })

  it('stops looking for a target that never appears', async () => {
    vi.useFakeTimers()
    try {
      render(<Harness at="/admin" maps={false} />)
      act(() => screen.getByRole('button', { name: 'Take the tour' }).click())
      for (let i = 0; i < 5; i++) act(() => screen.getByRole('button', { name: 'Next' }).click())
      await act(() => vi.advanceTimersByTimeAsync(3000))
      expect(screen.queryByTestId('tour-spot')).not.toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    } finally { vi.useRealTimers() }
  })
})
