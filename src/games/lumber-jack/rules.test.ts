import { describe, expect, it } from 'vitest'
import { STEP, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { ChopBot } from './bot.ts'
import {
  chop,
  chopperNew,
  isStunned,
  NONE,
  safeSide,
  STUN,
  TARGET,
  TRUNK_LEN,
  trunkNew,
  winnerOf,
  type State,
} from './rules.ts'

/** A state with a given trunk (branch per segment) and fresh choppers. */
function stateWith(seq: number[]): State {
  return { seq, p: [chopperNew(), chopperNew()] }
}

describe('lumber jack: trunk', () => {
  it('is the same for the same seed and has the full length', () => {
    const a = trunkNew(new Rng(42))
    const b = trunkNew(new Rng(42))
    expect(a).toEqual(b)
    expect(a).toHaveLength(TRUNK_LEN)
  })

  it('opens clear and only ever holds -1, 0 or 1', () => {
    for (let seed = 0; seed < 20; seed++) {
      const seq = trunkNew(new Rng(seed))
      expect(seq[0]).toBe(NONE)
      expect(seq[1]).toBe(NONE)
      for (const b of seq) expect([NONE, 0, 1]).toContain(b)
    }
  })

  it('has branches on both sides somewhere', () => {
    const seq = trunkNew(new Rng(7))
    expect(seq).toContain(0)
    expect(seq).toContain(1)
  })
})

describe('lumber jack: chopping', () => {
  it('a chop from the side away from the branch is safe', () => {
    const s = stateWith([NONE, NONE, 0, NONE])
    const r = chop(s, 0, 1, 1)
    expect(r).toBe('chop')
    expect(s.p[0].chops).toBe(1)
    expect(s.p[0].bonk).toBe(false)
    expect(isStunned(s.p[0], 1)).toBe(false)
  })

  it('a chop from the branch side bonks: the chop counts and the chopper is stunned', () => {
    const s = stateWith([NONE, NONE, 0, NONE])
    s.p[0].chops = 2
    const r = chop(s, 0, 0, 5)
    expect(r).toBe('bonk')
    expect(s.p[0].chops).toBe(3)
    expect(s.p[0].bonk).toBe(true)
    expect(isStunned(s.p[0], 5 + STUN - 0.01)).toBe(true)
    expect(isStunned(s.p[0], 5 + STUN + 0.01)).toBe(false)
  })

  it('chops are ignored during the stun, and the other player is unaffected', () => {
    const s = stateWith([0, 0, 0, 0])
    expect(chop(s, 0, 0, 10)).toBe('bonk')
    expect(chop(s, 0, 1, 10.5)).toBe('ignored')
    expect(s.p[0].chops).toBe(1)
    expect(chop(s, 1, 1, 10.5)).toBe('chop')
    expect(s.p[1].chops).toBe(1)
    expect(chop(s, 0, 1, 11.1)).toBe('chop')
  })

  it('a bare segment never bonks, from either side', () => {
    const s = stateWith([NONE, NONE, NONE, NONE, NONE])
    expect(chop(s, 0, 0, 1)).toBe('chop')
    expect(chop(s, 0, 1, 1.1)).toBe('chop')
    expect(s.p[0].chops).toBe(2)
  })

  it('reading the segment for the next chop: the branch belongs to the segment being cut', () => {
    // Segment index 0 has a branch on the right; cutting it from the left is safe.
    const s = stateWith([1, NONE])
    expect(chop(s, 0, 0, 1)).toBe('chop')
    expect(s.p[0].branch).toBe(1)
  })

  it('ignores chops after the target', () => {
    const s = stateWith([])
    s.p[0].chops = TARGET
    expect(chop(s, 0, 0, 1)).toBe('ignored')
    expect(s.p[0].chops).toBe(TARGET)
  })
})

describe('lumber jack: winner', () => {
  it('nobody until someone has TARGET segments', () => {
    const s = stateWith([])
    s.p[0].chops = TARGET - 1
    expect(winnerOf(s)).toBeNull()
  })

  it('first to TARGET wins', () => {
    const s = stateWith([])
    s.p[1].chops = TARGET
    expect(winnerOf(s)).toBe(1)
    s.p[1].chops = 0
    s.p[0].chops = TARGET
    expect(winnerOf(s)).toBe(0)
  })

  it('both on TARGET in the same step is a draw', () => {
    const s = stateWith([])
    s.p[0].chops = TARGET
    s.p[1].chops = TARGET
    expect(winnerOf(s)).toBe('draw')
  })
})

describe('lumber jack: match length', () => {
  it('a shorter match is decided at the chosen segment count', () => {
    const s = stateWith([])
    s.p[0].chops = 20
    expect(winnerOf(s, 20)).toBe(0)
    expect(winnerOf(s)).toBeNull()
  })

  it('chopping stops at the chosen segment count', () => {
    const s = stateWith([])
    expect(chop(s, 0, 0, 1, 2)).toBe('chop')
    expect(chop(s, 0, 1, 2, 2)).toBe('chop')
    expect(chop(s, 0, 1, 3, 2)).toBe('ignored')
    expect(s.p[0].chops).toBe(2)
  })
})

describe('lumber jack: safe side', () => {
  it('never picks the branch side without a mistake', () => {
    const seq = [0, 1, NONE]
    const rng = new Rng(1)
    for (let i = 0; i < 50; i++) {
      expect(safeSide(seq, 0, rng, 0)).toBe(1)
      expect(safeSide(seq, 1, rng, 0)).toBe(0)
    }
  })

  it('picks the branch side on a certain mistake', () => {
    expect(safeSide([0], 0, new Rng(2), 1)).toBe(0)
  })
})

/** A whole match, bot against bot, at the real step. */
function botMatch(seed: number, red: 'easy' | 'normal' | 'hard', blue: 'easy' | 'normal' | 'hard') {
  const rng = new Rng(seed)
  const s = stateWith(trunkNew(rng))
  const bots = [new ChopBot(rng.fork(), red, 0), new ChopBot(rng.fork(), blue, 1)] as const
  let t = 0
  const limit = 240
  let bonks = [0, 0]
  while (t < limit && winnerOf(s) === null) {
    t += STEP
    for (const side of [0, 1] as Side[]) {
      const from = bots[side].step(t, s)
      if (from !== null && chop(s, side, from, t) === 'bonk') bonks[side] = (bonks[side] ?? 0) + 1
    }
  }
  return { s, t, bonks, winner: winnerOf(s) }
}

describe('lumber jack: bots', () => {
  it('bot vs bot reaches a winner in bounded time', () => {
    for (let seed = 0; seed < 6; seed++) {
      const r = botMatch(seed, 'normal', 'normal')
      expect(r.winner).not.toBeNull()
      expect(r.t).toBeLessThan(120)
    }
  })

  it('a hard bot bonks rarely', () => {
    let bonks = 0
    for (let seed = 0; seed < 4; seed++) bonks += botMatch(20 + seed, 'hard', 'hard').bonks[0] ?? 0
    expect(bonks).toBeLessThanOrEqual(4)
  })

  it('a hard bot beats an easy bot most of the time', () => {
    let hard = 0
    const games = 12
    for (let seed = 0; seed < games; seed++) {
      if (botMatch(100 + seed, 'hard', 'easy').winner === 0) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(Math.ceil(games * 0.7))
  })
})
