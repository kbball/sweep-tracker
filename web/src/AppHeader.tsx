import { NavLink } from 'react-router-dom'
import { ThemeToggle } from './ThemeToggle'

/** Top bar for the non-map pages: brand, navigation and the theme toggle. */
export function AppHeader() {
  return (
    <header className="app-header card">
      <span className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20 10 6l4 8 2-4 4 10" /></svg>
        </span>
        <strong>Sweep Tracker</strong>
      </span>
      <nav aria-label="Main">
        <NavLink to="/" end>Events</NavLink>
        <NavLink to="/admin">Admin</NavLink>
      </nav>
      <ThemeToggle showLabel />
    </header>
  )
}
