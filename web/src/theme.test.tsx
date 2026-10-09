import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeToggle } from './ThemeToggle'
import { applyTheme, nextTheme, storedTheme } from './theme'

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme') })

describe('theme', () => {
  it('cycles system → light → dark → system', () => {
    expect(nextTheme('system')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('system')
  })

  it('applies and remembers an explicit choice; system clears it', () => {
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(storedTheme()).toBe('dark')
    applyTheme('light')
    expect(storedTheme()).toBe('light')
    applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(storedTheme()).toBe('system')
  })

  it('ignores junk in storage and survives storage failures', () => {
    localStorage.setItem('sweep-theme', 'purple')
    expect(storedTheme()).toBe('system')
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(storedTheme()).toBe('system')
    expect(() => applyTheme('dark')).not.toThrow()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    get.mockRestore(); set.mockRestore()
  })
})

describe('ThemeToggle', () => {
  it('cycles through the themes and updates the page', async () => {
    const u = userEvent.setup()
    render(<ThemeToggle showLabel />)
    const btn = () => screen.getByRole('button')
    expect(btn()).toHaveAccessibleName('Theme: System. Switch to Light')
    await u.click(btn())
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(btn()).toHaveTextContent('Light')
    await u.click(btn())
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(btn()).toHaveAccessibleName('Theme: Dark. Switch to System')
    await u.click(btn())
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('starts from the stored choice and can hide its label', () => {
    localStorage.setItem('sweep-theme', 'dark')
    render(<ThemeToggle />)
    expect(screen.getByRole('button')).toHaveAccessibleName(/Theme: Dark/)
    expect(screen.getByRole('button')).not.toHaveTextContent('Dark')
  })
})
