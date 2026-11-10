import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

function storage(setItem: (k: string, v: string) => void) {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      setItem(k, v)
      data.set(k, v)
    },
    removeItem: (k: string) => void data.delete(k),
  }
}

describe('store', () => {
  it('saves under its own versus key and says it did', async () => {
    const ls = storage(() => {})
    vi.stubGlobal('localStorage', ls)
    const { save, store } = await import('./store.ts')
    store.settings.sound = false
    expect(save()).toBe(true)
    expect([...ls.data.keys()]).toEqual(['versus:v1'])
    expect(JSON.parse(ls.data.get('versus:v1') ?? '{}').settings.sound).toBe(false)
  })

  it('reports a write the browser refused (storage full), without throwing', async () => {
    vi.stubGlobal(
      'localStorage',
      storage(() => {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }),
    )
    const { resetScores, save } = await import('./store.ts')
    expect(save()).toBe(false)
    expect(resetScores()).toBe(false)
  })

  it('starts on defaults when the saved value is not JSON', async () => {
    const ls = storage(() => {})
    ls.data.set('versus:v1', '{not json')
    vi.stubGlobal('localStorage', ls)
    const { store } = await import('./store.ts')
    expect(store.score).toEqual([0, 0])
  })

  it('loads a save from before game settings existed', async () => {
    const ls = storage(() => {})
    ls.data.set('versus:v1', JSON.stringify({ v: 1, score: [2, 1], match: { chess: 3 } }))
    vi.stubGlobal('localStorage', ls)
    const { store } = await import('./store.ts')
    expect(store.options).toEqual({})
    expect(store.match).toEqual({ chess: 3 })
  })
})
