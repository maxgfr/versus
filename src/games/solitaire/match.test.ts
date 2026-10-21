import { describe, expect, it } from 'vitest'
import type { GameContext } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import game, { match } from './index.ts'

/** Effects and sound do nothing. Sides run as bots (or stay idle) on hard, so the races play themselves out. */
function ctx(target: number | undefined, bots: [boolean, boolean]): GameContext {
  const sink = new Proxy({}, { get: () => () => {} })
  return {
    stage: sink,
    input: { player: () => ({ downs: [], ups: [], held: new Map() }) },
    fx: sink,
    audio: sink,
    rng: new Rng(5),
    mode: '2p',
    difficulty: 'hard',
    bots,
    teams: false,
    names: ['Red', 'Blue'],
    local: 0,
    seed: 17,
    target,
  } as never
}

describe('solitaire match length', () => {
  it('declares one race as the default, first to five at most', () => {
    expect(match).toEqual({ unit: 'wins', default: 1, min: 1, max: 5 })
  })

  it('gives each race to the side ahead on the clock, until the chosen number of wins', () => {
    // Red's bot clears some cards and blue never taps: every race is decided on the four-minute clock.
    const g = game()
    g.init(ctx(2, [true, false]))
    for (let i = 0; i < 60 * 700 && !g.result; i++) g.update(1 / 60)
    expect(g.result?.winner).toBe(0)
    expect(g.result?.score).toEqual([2, 0])
    expect((g.snapshot() as { s: { round: number } }).s.round).toBe(1)
  })
})
