import { rememberStop, storedStop } from './activeStop'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('activeStop', () => {
  it('remembers a station per event and forgets it', () => {
    rememberStop('a', '100')
    rememberStop('b', '200')
    expect(storedStop('a')).toBe('100')
    rememberStop('a', undefined)
    expect(storedStop('a')).toBeUndefined()
    expect(storedStop('b')).toBe('200')
  })
  it('survives storage failures', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(storedStop('a')).toBeUndefined()
    expect(() => rememberStop('a', '1')).not.toThrow()
  })
})
