import { describe, expect, it } from 'vitest'
import { STEP, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { ChopBot } from './bot.ts'
import { match } from './index.ts'
import {
  chop,
  chopperNew,
  COMBO_GAP,
  isStunned,
  NONE,
  plan,
  REBONK,
  safeSide,
  STUN,
  STUN_MAX,
  STUN_STEP,
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

/** Share of branched segments, and of branches that switch side, over [from, to) across many seeds. */
function trunkStats(target: number, from: number, to: number) {
  let segs = 0
  let branches = 0
  let pairs = 0
  let switches = 0
  for (let seed = 0; seed < 200; seed++) {
    const seq = trunkNew(new Rng(seed), target)
    let last = NONE
    for (let i = 0; i < seq.length && i < to; i++) {
      const b = seq[i] ?? NONE
      if (i >= from) {
        segs++
        if (b !== NONE) branches++
        if (b !== NONE && last !== NONE) {
          pairs++
          if (b !== last) switches++
        }
      }
      if (b !== NONE) last = b
    }
  }
  return { density: branches / segs, zig: switches / pairs }
}

describe('lumber jack: the trunk ramps up', () => {
  it('branches are denser and zig-zag more near the finish than at the start', () => {
    const start = trunkStats(TARGET, 2, 17)
    const finish = trunkStats(TARGET, TARGET - 15, TARGET)
    expect(finish.density).toBeGreaterThan(start.density + 0.2)
    expect(finish.zig).toBeGreaterThan(start.zig + 0.15)
  })

  it('the ramp follows the chosen match length', () => {
    // A short match reaches its dense run-in by its own finish line.
    const short = trunkStats(20, 14, 20)
    const long = trunkStats(70, 14, 20)
    expect(short.density).toBeGreaterThan(long.density + 0.15)
  })

  it('still opens clear and stays the same for the same seed and length', () => {
    for (const target of [20, 50, 70]) {
      const a = trunkNew(new Rng(3), target)
      expect(a).toEqual(trunkNew(new Rng(3), target))
      expect(a[0]).toBe(NONE)
      expect(a[1]).toBe(NONE)
    }
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

describe('lumber jack: repeat bonks', () => {
  it('a bonk soon after the last stun stuns longer, up to a cap', () => {
    const s = stateWith(Array(20).fill(0))
    expect(chop(s, 0, 0, 10)).toBe('bonk')
    expect(s.p[0].stunUntil).toBeCloseTo(10 + STUN)
    // Right after the stun ends, into the branch again.
    expect(chop(s, 0, 0, 11.05)).toBe('bonk')
    expect(s.p[0].dizzy).toBe(1)
    expect(s.p[0].stunUntil).toBeCloseTo(11.05 + STUN + STUN_STEP)
    let t = s.p[0].stunUntil + 0.05
    for (let i = 0; i < 4; i++) {
      chop(s, 0, 0, t)
      t = s.p[0].stunUntil + 0.05
    }
    expect(s.p[0].stunUntil - (t - 0.05 - STUN_MAX)).toBeGreaterThan(0)
    expect(s.p[0].stunUntil - s.p[0].chopAt).toBeCloseTo(STUN_MAX)
  })

  it('a lone bonk long after the last one is a plain stun again', () => {
    const s = stateWith(Array(20).fill(0))
    chop(s, 0, 0, 10)
    chop(s, 0, 0, 11.05)
    expect(s.p[0].dizzy).toBe(1)
    const t = s.p[0].stunUntil + REBONK + 0.1
    expect(chop(s, 0, 0, t)).toBe('bonk')
    expect(s.p[0].dizzy).toBe(0)
    expect(s.p[0].stunUntil).toBeCloseTo(t + STUN)
  })

  it('blind mashing on one side loses to a normal bot that reads the trunk', () => {
    let masher = 0
    for (let seed = 0; seed < 6; seed++) {
      const rng = new Rng(300 + seed)
      const s = stateWith(trunkNew(rng))
      const bot = new ChopBot(rng.fork(), 'normal', 1)
      let t = 0
      let nextTap = 0
      while (t < 120 && winnerOf(s) === null) {
        t += STEP
        // Nine taps a second, always from the left, never looking.
        if (t >= nextTap) {
          chop(s, 0, 0, t)
          nextTap = t + 1 / 9
        }
        const from = bot.step(t, s)
        if (from !== null) chop(s, 1, from, t)
      }
      if (winnerOf(s) === 0) masher++
    }
    expect(masher).toBeLessThanOrEqual(1)
  })
})

describe('lumber jack: combo and pace', () => {
  it('quick clean chops build a combo; a pause or a bonk breaks it', () => {
    const s = stateWith([NONE, NONE, NONE, NONE, 0, NONE, NONE])
    chop(s, 0, 0, 1)
    expect(s.p[0].combo).toBe(1)
    expect(s.p[0].pace).toBe(0)
    chop(s, 0, 1, 1.2)
    chop(s, 0, 0, 1.4)
    expect(s.p[0].combo).toBe(3)
    expect(s.p[0].pace).toBeGreaterThan(0.8)
    chop(s, 0, 0, 1.4 + COMBO_GAP + 0.1)
    expect(s.p[0].combo).toBe(1)
    expect(s.p[0].pace).toBe(0)
    expect(chop(s, 0, 0, 2.2)).toBe('bonk')
    expect(s.p[0].combo).toBe(0)
  })
})

describe('lumber jack: reading ahead', () => {
  it('chops away from the branch of the segment being cut', () => {
    expect(plan([0, NONE], 0, 0)).toBe(1)
    expect(plan([1, NONE], 0, 1)).toBe(0)
  })

  it('cuts a bare segment from the side the next branch needs, saving a hop', () => {
    expect(plan([NONE, NONE, 1], 0, 1)).toBe(0)
    expect(plan([NONE, 0], 0, 0)).toBe(1)
  })

  it('stays put on a bare stretch', () => {
    expect(plan([NONE, NONE, NONE, NONE, NONE], 0, 1)).toBe(1)
    expect(plan([NONE, NONE, NONE, NONE, NONE], 0, 0)).toBe(0)
    expect(plan([NONE], 0, -1)).toBe(0)
  })

  it('the trunk is long enough for the longest match plus the visible stack', () => {
    expect(TRUNK_LEN).toBeGreaterThanOrEqual(match.max + 5)
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

  it('difficulty orders the bots: hard beats normal and normal beats easy most of the time', () => {
    let hard = 0
    let normal = 0
    const games = 12
    for (let seed = 0; seed < games; seed++) {
      if (botMatch(200 + seed, 'hard', 'normal').winner === 0) hard++
      if (botMatch(400 + seed, 'normal', 'easy').winner === 0) normal++
    }
    expect(hard).toBeGreaterThanOrEqual(Math.ceil(games * 0.75))
    expect(normal).toBeGreaterThanOrEqual(Math.ceil(games * 0.75))
  })

  it('a bot waits out its stun and never chops into it', () => {
    const rng = new Rng(9)
    const s = stateWith(Array(60).fill(0))
    const bot = new ChopBot(rng.fork(), 'hard', 0)
    chop(s, 0, 0, 0.5)
    let t = 0.5
    while (t < 3) {
      t += STEP
      const from = bot.step(t, s)
      if (from !== null) {
        expect(isStunned(s.p[0], t)).toBe(false)
        expect(chop(s, 0, from, t)).not.toBe('ignored')
      }
    }
    expect(s.p[0].chops).toBeGreaterThan(3)
  })

  it('a hard bot beats an easy bot most of the time', () => {
    let hard = 0
    const games = 16
    for (let seed = 0; seed < games; seed++) {
      if (botMatch(100 + seed, 'hard', 'easy').winner === 0) hard++
      // Sides swapped, so the result does not hang on who is red.
      if (botMatch(600 + seed, 'easy', 'hard').winner === 1) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(Math.ceil(games * 2 * 0.9))
  })

  it('a hard bot is fast but humanly so, and normal sits clearly between', () => {
    const time = (d: 'easy' | 'normal' | 'hard') => {
      let t = 0
      for (let seed = 0; seed < 8; seed++) t += botMatch(700 + seed, d, d).t
      return t / 8
    }
    const [easy, normal, hard] = [time('easy'), time('normal'), time('hard')]
    // 50 segments: hard well under 6 chops a second, easy a relaxed pace.
    expect(hard).toBeGreaterThan(TARGET / 6)
    expect(hard).toBeLessThan(normal * 0.8)
    expect(normal).toBeLessThan(easy * 0.65)
  })
})
