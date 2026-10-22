import { describe, expect, it } from 'vitest'
import type { Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { choose, planTurn, racing } from './bot.ts'
import {
  apply,
  BAR,
  CHECKERS,
  clone,
  continuations,
  legalSteps,
  mirror,
  nextSteps,
  other,
  type Pos,
  pips,
  result,
  sequences,
  start,
  type Step,
} from './rules.ts'

/** An empty board with the given signed counts per absolute point (red +, blue −). */
function board(counts: Record<number, number>, bar: [number, number] = [0, 0]): Pos {
  const pts = Array<number>(24).fill(0)
  for (const [p, n] of Object.entries(counts)) pts[Number(p) - 1] = n
  return { pts, bar, off: [0, 0] }
}

/** Play a whole turn by always taking the first next move. */
function playTurn(p: Pos, s: Side, dice: number[]): Pos {
  let cur = clone(p)
  const seqs = sequences(p, s, dice)
  const used: Step[] = []
  for (;;) {
    const st = nextSteps(seqs, used)[0]
    if (!st) break
    cur = apply(cur, s, st)
    used.push(st)
  }
  return cur
}

describe('start position', () => {
  it('has fifteen checkers a side and 167 pips each', () => {
    const p = start()
    expect(p.pts.reduce((a, n) => a + Math.abs(n), 0)).toBe(30)
    expect(pips(p, 0)).toBe(167)
    expect(pips(p, 1)).toBe(167)
  })

  it('mirrors the board for blue: its 6-point is absolute 19, its 8-point absolute 17', () => {
    expect(mirror(1)).toBe(24)
    expect(mirror(13)).toBe(12)
    expect(mirror(6)).toBe(19)
    const p = start()
    expect(p.pts[mirror(6) - 1]).toBe(-5)
    expect(p.pts[mirror(8) - 1]).toBe(-3)
    expect(p.pts[mirror(24) - 1]).toBe(-2)
  })

  it('plays 6-5 as 24/13 when the 6 goes first (the 5 from the 24-point is blocked)', () => {
    const p = start()
    const seqs = sequences(p, 0, [6, 5])
    expect(seqs.length).toBeGreaterThan(0)
    expect(seqs.every((q) => q.steps.length === 2)).toBe(true)
    const first = nextSteps(seqs, [])
    expect(first.some((st) => st.from === 24 && st.die === 5)).toBe(false)
    expect(first.some((st) => st.from === 24 && st.die === 6)).toBe(true)
    const twentyFourThirteen = seqs.find(
      (q) =>
        q.steps.some((st) => st.from === 24 && st.to === 18) &&
        q.steps.some((st) => st.from === 18 && st.to === 13),
    )
    expect(twentyFourThirteen?.end.pts[12]).toBe(6)
    expect(twentyFourThirteen?.end.pts[23]).toBe(1)
  })

  it('moves from the points that are open for a single one', () => {
    // Point 13 cannot step to 12: blue's mid-point (its 13) is there.
    const froms = legalSteps(start(), 0, [1]).map((m) => m.from)
    expect(froms.sort((a, b) => a - b)).toEqual([6, 8, 24])
  })
})

describe('moves', () => {
  it('must enter from the bar before any other checker moves', () => {
    const p = board({ 24: 2, 13: 5, 8: 3, 6: 5 }, [1, 0])
    const moves = legalSteps(p, 0, [3, 4])
    expect(moves.length).toBeGreaterThan(0)
    expect(moves.every((m) => m.from === BAR)).toBe(true)
  })

  it('cannot enter onto a point the opponent holds with two or more', () => {
    const p = board({ 24: -2 }, [1, 0])
    expect(legalSteps(p, 0, [1])).toEqual([])
  })

  it('hits a blot and sends it to the bar', () => {
    const p = board({ 10: 1, 7: -1, 20: 1 })
    const st = legalSteps(p, 0, [3]).find((m) => m.from === 10)
    expect(st?.hit).toBe(true)
    const next = apply(p, 0, st as Step)
    expect(next.pts[6]).toBe(1)
    expect(next.bar[1]).toBe(1)
  })

  it('may not bear off while a checker sits outside the home board', () => {
    const p = board({ 6: 2, 8: 1 })
    expect(legalSteps(p, 0, [6]).some((m) => m.to === 0)).toBe(false)
  })

  it('bears off with an exact die; a higher die only from the highest point', () => {
    const p = board({ 6: 1, 2: 1 })
    const threes = legalSteps(p, 0, [3])
    expect(threes.some((m) => m.from === 2 && m.to === 0)).toBe(false)
    expect(threes.some((m) => m.from === 6 && m.to === 3)).toBe(true)
    expect(legalSteps(p, 0, [6]).some((m) => m.from === 6 && m.to === 0)).toBe(true)
  })

  it('takes a checker off with a higher die when nothing sits above it', () => {
    const p = board({ 4: 1, 2: 1 })
    expect(legalSteps(p, 0, [5]).some((m) => m.from === 4 && m.to === 0)).toBe(true)
    expect(legalSteps(p, 0, [5]).some((m) => m.from === 2 && m.to === 0)).toBe(false)
  })

  it('uses both dice when both can be played', () => {
    const seqs = sequences(start(), 0, [2, 1])
    expect(seqs.every((q) => q.steps.length === 2)).toBe(true)
  })

  it('plays the higher die when only one die can be played', () => {
    // Red's checker on 7 can take either die alone, but not both: blue holds 14 and 19.
    const p = board({ 7: 1, 20: 1, 14: -2, 19: -2 })
    const seqs = sequences(p, 0, [6, 1])
    expect(seqs.length).toBeGreaterThan(0)
    expect(seqs.every((q) => q.steps.length === 1 && q.steps[0]?.die === 6)).toBe(true)
  })

  it('a double is four moves when the board allows it', () => {
    const seqs = sequences(start(), 0, [1, 1, 1, 1])
    expect(seqs.every((q) => q.steps.length === 4)).toBe(true)
  })

  it('continuations keep the moves already played', () => {
    const seqs = sequences(start(), 0, [4, 3])
    const first = nextSteps(seqs, [])[0] as Step
    const rest = continuations(seqs, [first])
    expect(rest.length).toBeGreaterThan(0)
    expect(rest.every((q) => sameFirst(q.steps[0], first))).toBe(true)
  })

  it('plays a whole turn to a position that can be reached', () => {
    const p = playTurn(start(), 0, [6, 5])
    expect(pips(p, 0)).toBe(167 - 11)
  })
})

const sameFirst = (a: Step | undefined, b: Step): boolean =>
  !!a && a.from === b.from && a.to === b.to && a.die === b.die

describe('outcome', () => {
  it('a finished side wins a single point when the other has borne off', () => {
    const p = { ...start(), off: [CHECKERS, 3] as [number, number] }
    expect(result(p)).toEqual({ winner: 0, points: 1 })
  })

  it('a gammon when the loser has borne off nothing and has no checker in the way home', () => {
    const p = {
      pts: Array<number>(24).fill(0),
      bar: [0, 0] as [number, number],
      off: [CHECKERS, 0] as [number, number],
    }
    p.pts[0] = 15
    p.pts[12] = -15
    expect(result(p)).toEqual({ winner: 0, points: 2 })
  })

  it('a backgammon when the loser still has a checker in the winner’s home board', () => {
    const p = {
      pts: Array<number>(24).fill(0),
      bar: [0, 0] as [number, number],
      off: [CHECKERS, 0] as [number, number],
    }
    p.pts[0] = 14
    p.pts[2] = -1
    p.pts[12] = -14
    expect(result(p)).toEqual({ winner: 0, points: 3 })
  })

  it('is undecided until a side has borne off all fifteen', () => {
    expect(result(start())).toBeNull()
  })
})

describe('bot', () => {
  it('plays a legal move on every difficulty, for either side', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      for (const s of [0, 1] as Side[]) {
        const p = start()
        const dice = [5, 3]
        const st = choose(p, s, dice, [], d, new Rng(7))
        expect(st).not.toBeNull()
        expect(legalSteps(p, s, dice)).toContainEqual(
          expect.objectContaining({ from: st?.from, to: st?.to }),
        )
      }
    }
  })

  it('returns null when nothing can move', () => {
    const p = board({ 20: 2, 14: -2 })
    expect(choose(p, 0, [6, 6], [], 'hard', new Rng(1))).toBeNull()
  })
})

describe('backgammon games', () => {
  /** A whole game, bot against bot, with the rules the screen uses (the 400-turn cap included). */
  const play = (difficulty: 'easy' | 'normal' | 'hard', seed: number) => {
    const rng = new Rng(seed)
    let p = start()
    let turn: Side = rng.chance(0.5) ? 0 : 1
    for (let ply = 1; ply <= 400; ply++) {
      const a = rng.int(1, 6)
      const b = rng.int(1, 6)
      const dice = a === b ? [a, a, a, a] : [a, b]
      const origin = clone(p)
      const used: Step[] = []
      for (;;) {
        const st = choose(origin, turn, dice, used, difficulty, rng)
        if (!st) break
        p = apply(p, turn, st)
        used.push(st)
      }
      const r = result(p)
      if (r) return { winner: r.winner, plies: ply }
      turn = other(turn)
    }
    return { winner: pips(p, 0) < pips(p, 1) ? 0 : 1, plies: 400 }
  }

  for (const difficulty of ['easy', 'normal'] as const) {
    it(`a ${difficulty} vs ${difficulty} game ends within the cap`, () => {
      const g = play(difficulty, 11)
      expect(g.plies).toBeLessThanOrEqual(400)
      expect([0, 1]).toContain(g.winner)
    })
  }

  it('a hard vs hard game ends within the cap', () => {
    const g = play('hard', 5)
    expect(g.plies).toBeLessThanOrEqual(400)
    expect([0, 1]).toContain(g.winner)
  }, 120_000)
})

describe('backgammon computer', () => {
  it('opens 3-1 the classic way on normal: 8/5 6/5, making the 5-point', () => {
    const steps = planTurn(start(), 0, [3, 1], 'normal', new Rng(1))
    const moves = steps.map((st) => `${st.from}/${st.to}`).sort()
    expect(moves).toEqual(['6/5', '8/5'])
  })

  it('knows a race once the armies have passed each other', () => {
    expect(racing(start())).toBe(false)
    // Red all home, blue all home on the other side: nothing can hit any more.
    expect(racing(board({ 1: 5, 2: 5, 3: 5, 22: -5, 23: -5, 24: -5 }))).toBe(true)
    // One blue checker still behind a red one (point 2, with red on 3 and 5): contact.
    expect(racing(board({ 1: 5, 3: 5, 5: 5, 2: -1, 23: -7, 24: -7 }))).toBe(false)
  })

  it('normal beats easy most of the time over seeded games (the dice still have a say)', () => {
    const game = (seed: number) => {
      const rng = new Rng(seed)
      let p = start()
      let turn: Side = seed % 2 === 0 ? 0 : 1
      for (let ply = 1; ply <= 600; ply++) {
        const a = rng.int(1, 6)
        const b = rng.int(1, 6)
        const dice = a === b ? [a, a, a, a] : [a, b]
        for (const st of planTurn(p, turn, dice, turn === 0 ? 'normal' : 'easy', rng))
          p = apply(p, turn, st)
        const r = result(p)
        if (r) return r.winner
        turn = other(turn)
      }
      return pips(p, 0) < pips(p, 1) ? 0 : 1
    }
    let normal = 0
    for (let seed = 1; seed <= 20; seed++) if (game(seed) === 0) normal++
    expect(normal).toBeGreaterThanOrEqual(15)
  })
})
