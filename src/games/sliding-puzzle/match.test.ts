import { describe, expect, it } from 'vitest'
import type { GameContext } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import game, { match } from './index.ts'

/** Effects and sound do nothing; both sides are bots on hard, so the races play themselves out. */
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

function playToResult(g: ReturnType<typeof game>): void {
  for (let i = 0; i < 60 * 400 && !g.result; i++) g.update(1 / 60)
}

describe('sliding puzzle match length', () => {
  it('declares one race as the default, first to five at most', () => {
    expect(match).toEqual({ unit: 'wins', default: 1, min: 1, max: 5 })
  })

  it('decides a single race when the length is the default', () => {
    const g = game()
    g.init(ctx())
    playToResult(g)
    expect(g.result?.winner).toBeDefined()
    expect(g.result?.score).toBeUndefined()
    expect((g.snapshot() as { s: { round: number } }).s.round).toBe(0)
  })

  it('plays races until one side reaches the chosen number of wins', () => {
    const g = game()
    g.init(ctx(2))
    playToResult(g)
    expect(g.result).not.toBeNull()
    const score = g.result?.score
    expect(score && Math.max(...score)).toBe(2)
    expect(g.result?.winner).toBe(score?.[0] === 2 ? 0 : 1)
    // The first race was decided and a fresh one dealt before the match ended.
    expect((g.snapshot() as { s: { round: number } }).s.round).toBeGreaterThanOrEqual(1)
  })
})
