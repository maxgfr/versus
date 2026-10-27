import { describe, expect, it } from 'vitest'
import type { GameContext } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import game, { match } from './index.ts'

/** Effects and sound do nothing; both sides are bots, so the match plays itself out. */
function ctx(target?: number): GameContext {
  const sink = new Proxy({}, { get: () => () => {} })
  return {
    stage: sink,
    input: { player: () => ({ downs: [], ups: [], held: new Map() }) },
    fx: sink,
    audio: sink,
    rng: new Rng(5),
    mode: '2p',
    difficulty: 'hard',
    bots: [true, true],
    teams: false,
    names: ['Red', 'Blue'],
    local: 0,
    seed: 17,
    target,
  } as never
}

describe('blocks match length', () => {
  it('declares the 90 s clock as the default, in 15 s steps', () => {
    expect(match).toEqual({ unit: 'seconds', default: 90, min: 15, max: 180, step: 15 })
  })

  it('starts on the default clock when the context omits a length', () => {
    const g = game()
    g.init(ctx())
    expect((g.snapshot() as { s: { sec: number } }).s.sec).toBe(90)
  })

  it('blows the whistle when the chosen length runs out', () => {
    const g = game()
    g.init(ctx(30))
    expect((g.snapshot() as { s: { sec: number } }).s.sec).toBe(30)
    for (let i = 0; i < 60 * 40 && !g.result; i++) g.update(1 / 60)
    expect(g.result?.note).toBe('Time up')
    // Result shows after the whistle's delay, well short of the 90 s default.
    const t = (g.snapshot() as { t: number }).t
    expect(t).toBeGreaterThanOrEqual(30)
    expect(t).toBeLessThan(35)
  })

  it('ends at once when one board is out of moves and the other is already ahead', () => {
    const g = game()
    g.init(ctx(90))
    const s = (g.snapshot() as { s: { boards: { dead: boolean; score: number }[] } }).s
    const [a, b] = s.boards as [{ dead: boolean; score: number }, { dead: boolean; score: number }]
    a.dead = true
    a.score = 40
    b.score = 30
    // Behind: blue plays on.
    g.update(1 / 60)
    expect(g.result).toBeNull()
    b.score = 41
    for (let i = 0; i < 60 * 3 && !g.result; i++) g.update(1 / 60)
    expect(g.result?.winner).toBe(1)
    expect((g.snapshot() as { t: number }).t).toBeLessThan(5)
  })
})

describe('blocks drop', () => {
  it('lands a quick flick under the piece as drawn, not a full lift above it', () => {
    const pi = { downs: [] as unknown[], ups: [] as unknown[], held: new Map<number, unknown>() }
    const c = { ...ctx(90), mode: '1p', bots: [false, false], input: { player: () => pi } }
    const g = game()
    g.init(c as unknown as GameContext)
    const board = () => (g.snapshot() as { s: { boards: { placed: number[] }[] } }).s.boards[0]
    const ptr = (x: number, y: number) => ({ id: 1, x, y, x0: x, y0: y, px: x, py: y, t0: 0 })
    const dt = 1 / 60
    // Seed 17 deals a 4 × 1 bar first: pick it up from the tray, sweep it onto the grid, let go.
    const down = ptr(150, 1300)
    pi.downs = [down]
    pi.held = new Map([[1, down]])
    g.update(dt)
    pi.downs = []
    for (const y of [1000, 760]) {
      pi.held = new Map([[1, ptr(400, y)]])
      g.update(dt)
    }
    pi.held = new Map()
    pi.ups = [ptr(400, 760)]
    g.update(dt)
    // Two steps after pickup the bar is drawn (and ghosted) on row 3; a full lift dropped it on row 2.
    expect(board()?.placed).toEqual([25, 26, 27, 28])
  })
})
