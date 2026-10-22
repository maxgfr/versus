import { describe, expect, it } from 'vitest'
import type { GameContext } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import game from './index.ts'

/** Effects and sound do nothing; both sides are bots, so the rounds play themselves out. */
function ctx(target?: number, difficulty: GameContext['difficulty'] = 'hard'): GameContext {
  const sink = new Proxy({}, { get: () => () => {} })
  return {
    stage: sink,
    input: { player: () => ({ downs: [], ups: [], held: new Map() }) },
    fx: sink,
    audio: sink,
    rng: new Rng(3),
    mode: '2p',
    difficulty,
    bots: [true, true],
    teams: false,
    names: ['Red', 'Blue'],
    local: 0,
    seed: 23,
    target,
  } as never
}

function play(g: ReturnType<typeof game>): void {
  for (let i = 0; i < 60 * 1800 && !g.result; i++) g.update(1 / 60)
}

describe('sudoku match', () => {
  it('a single puzzle ends with a winner or a dead heat', () => {
    const g = game()
    g.init(ctx())
    play(g)
    expect(g.result).not.toBeNull()
    expect(g.result?.score).toBeUndefined()
  })

  it('plays puzzles until one side has the chosen number of round wins', () => {
    const g = game()
    g.init(ctx(2, 'normal'))
    play(g)
    const score = g.result?.score
    expect(score && Math.max(...score)).toBe(2)
    expect(g.result?.winner).toBe(score?.[0] === 2 ? 0 : 1)
    const s = (g.snapshot() as { s: { round: number } }).s
    expect(s.round).toBeGreaterThanOrEqual(1)
  })

  it('keeps the state plain JSON', () => {
    const g = game()
    g.init(ctx())
    for (let i = 0; i < 600; i++) g.update(1 / 60)
    const snap = g.snapshot()
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap)
  })
})
