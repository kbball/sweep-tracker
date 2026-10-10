import { afterEach, expect, it, vi } from 'vitest'

async function loadWithBase(href: string) {
  vi.resetModules()
  const base = document.createElement('base')
  base.href = href
  document.head.append(base)
  const mod = await import('./basePath')
  base.remove()
  return mod
}

afterEach(() => vi.resetModules())

it('has no prefix at the root', async () => {
  const { basePath, withBase } = await loadWithBase('http://localhost/')
  expect(basePath).toBe('')
  expect(withBase('/api/events')).toBe('/api/events')
})

it('follows <base href> behind a proxy prefix', async () => {
  const { basePath, withBase } = await loadWithBase('http://localhost/sweep/')
  expect(basePath).toBe('/sweep')
  expect(withBase('/api/events')).toBe('/sweep/api/events')
})
