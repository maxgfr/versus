import { describe, expect, it } from 'vitest'
import { STEP, type Difficulty, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { choose } from './bot.ts'
import {
  advance,
  APPLE,
  BODY,
  flight,
  GAP0,
  GAP_MAX,
  LIVES,
  loose,
  lineY,
  newState,
  rollWind,
  RESULT_PAUSE,
  type Shot,
  type State,
  TO_WIN,
  verdict,
  winner,
} from './rules.ts'

/** Play one arrow to its end (release, flight, result pause). */
function shootAndSettle(s: State, shot: Shot, rng: Rng): void {
  expect(loose(s, shot)).toBe(true)
  let guard = 0
  while (s.phase !== 'aim' && s.phase !== 'over' && guard++ < 60 * 20) advance(s, STEP, rng)
}

/** The power that puts a straight-on arrow at the apple from `side`, found by search. */
function applePower(side: Side, gap: number): number {
  let best = 0.5
  let bestD = Infinity
  for (let p = 0.25; p <= 1; p += 0.001) {
    const f = flight(side, { dx: 0, dy: side === 0 ? -1 : 1, power: p }, gap, 0)
    const d = Math.hypot(f.x - 500, f.z - APPLE.z)
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

const straight = (side: Side, power: number): Shot => ({ dx: 0, dy: side === 0 ? -1 : 1, power })

describe('archery: the arrow', () => {
  it('a straight arrow at the right power hits the apple', () => {
    const p = applePower(0, GAP0)
    expect(flight(0, straight(0, p), GAP0, 0).outcome).toBe('apple')
  })

  it('too little power falls short, too much flies over', () => {
    expect(flight(0, straight(0, 0.2), GAP0, 0).outcome).toBe('short')
    expect(flight(0, straight(0, 0.95), GAP0, 0).outcome).toBe('over')
  })

  it('a sideways arrow misses the dummy', () => {
    const p = applePower(0, GAP0)
    const f = flight(0, { dx: 0.5, dy: -0.866, power: p }, GAP0, 0)
    expect(f.outcome).toBe('wide')
  })

  it("a shot in the dummy's window costs a life, the apple window scores", () => {
    const p = applePower(0, GAP0)
    expect(flight(0, straight(0, p - 0.05), GAP0, 0).outcome).toBe('dummy')
    expect(flight(0, straight(0, p), GAP0, 0).outcome).toBe('apple')
  })

  it('wind pushes the arrow sideways', () => {
    const p = applePower(0, GAP0)
    const calm = flight(0, straight(0, p), GAP0, 0)
    const windy = flight(0, straight(0, p), GAP0, 110)
    expect(windy.x).toBeGreaterThan(calm.x + 20)
  })

  it('blue shoots from the top, toward the dummy', () => {
    expect(lineY(1, GAP0)).toBeLessThan(900)
    const p = applePower(1, GAP0)
    expect(flight(1, straight(1, p), GAP0, 0).outcome).toBe('apple')
  })

  it('the shooting lines back off each round, up to a limit', () => {
    expect(lineY(0, GAP0)).toBe(900 + GAP0)
    expect(GAP_MAX).toBeGreaterThan(GAP0)
  })
})

describe('archery: turns, lives and points', () => {
  it('shots alternate, a round ends after both have shot and the lines back off', () => {
    const rng = new Rng(1)
    const s = newState(0, 0)
    shootAndSettle(s, straight(0, 0.2), rng)
    expect(s.turn).toBe(1)
    expect(s.round).toBe(1)
    shootAndSettle(s, straight(1, 0.2), rng)
    expect(s.round).toBe(2)
    expect(s.turn).toBe(0)
    expect(s.gap).toBeGreaterThan(GAP0)
  })

  it('an apple is a point, a dummy hit costs the shooter a life', () => {
    const rng = new Rng(2)
    const s = newState(0, 0)
    shootAndSettle(s, straight(0, applePower(0, GAP0)), rng)
    expect(s.apples).toEqual([1, 0])
    expect(s.lives).toEqual([LIVES, LIVES])
    shootAndSettle(s, straight(1, applePower(1, GAP0) - 0.05), rng)
    expect(s.apples).toEqual([1, 0])
    expect(s.lives).toEqual([LIVES, LIVES - 1])
  })

  it('a shot out of turn is refused and nothing is loosed', () => {
    const s = newState(0, 0)
    expect(loose(s, straight(0, 0.5))).toBe(true)
    expect(loose(s, straight(0, 0.5))).toBe(false)
  })

  it('first to five apples wins', () => {
    const s = newState(0, 0)
    s.apples = [TO_WIN - 1, 2]
    expect(winner(s)).toBeNull()
    s.apples[0] = TO_WIN
    expect(winner(s)).toBe(0)
  })

  it('a chosen match length replaces the default: first to 3 apples', () => {
    const s = newState(0, 0, 3)
    s.apples = [2, 2]
    expect(winner(s)).toBeNull()
    s.apples[0] = 3
    expect(winner(s)).toBe(0)
    expect(winner(newState(0, 0))).toBeNull()
  })

  it('out of lives loses to the archer who still has some', () => {
    const s = newState(0, 0)
    s.lives = [0, 2]
    expect(winner(s)).toBe(1)
    s.lives = [2, 0]
    expect(winner(s)).toBe(0)
  })

  it('the match ends at the end of a result pause', () => {
    const rng = new Rng(3)
    const s = newState(0, 0)
    s.apples = [TO_WIN - 1, 0]
    shootAndSettle(s, straight(0, applePower(0, GAP0)), rng)
    expect(s.apples[0]).toBe(TO_WIN)
    expect(s.phase).toBe('over')
    expect(RESULT_PAUSE).toBeGreaterThan(0)
  })

  it('the wind is rolled within its range', () => {
    const rng = new Rng(4)
    for (let i = 0; i < 50; i++) expect(Math.abs(rollWind(rng))).toBeLessThanOrEqual(110)
  })

  it('a dummy hit sticks in the dummy for the round', () => {
    const rng = new Rng(6)
    const s = newState(0, 0)
    shootAndSettle(s, straight(0, applePower(0, GAP0) - 0.05), rng)
    expect(s.stuck).toHaveLength(1)
    expect(BODY.w).toBeGreaterThan(0)
  })
})

describe('archery: computer players', () => {
  it('a hard bot finds the apple most of the time', () => {
    const rng = new Rng(7)
    let hits = 0
    const n = 20
    for (let i = 0; i < n; i++) {
      const s = newState(0, rng.range(-110, 110))
      s.gap = GAP0 + 60 * rng.int(0, 3)
      const sh = choose(s, 0, 'hard', rng)
      if (flight(0, sh, s.gap, s.wind).outcome === 'apple') hits++
    }
    expect(hits).toBeGreaterThanOrEqual(Math.floor(n * 0.7))
  })

  it('the bot shoots for either side', () => {
    const rng = new Rng(8)
    expect(choose(newState(1, 0), 1, 'hard', rng).dy).toBeGreaterThan(0)
    expect(choose(newState(0, 0), 0, 'hard', rng).dy).toBeLessThan(0)
  })

  it('a bot match ends in bounded steps, with the hard bot ahead of the easy one', () => {
    const play = (a: Difficulty, b: Difficulty, seed: number) => {
      const rng = new Rng(seed)
      const s = newState(rng.chance(0.5) ? 0 : 1, rollWind(rng))
      let steps = 0
      while (s.phase !== 'over' && steps < 60 * 60 * 4) {
        if (s.phase === 'aim') {
          const d = s.turn === 0 ? a : b
          loose(s, choose(s, s.turn, d, rng))
        }
        advance(s, STEP, rng)
        steps++
      }
      return { winner: winner(s), steps, apples: s.apples }
    }
    let hardWins = 0
    for (let seed = 1; seed <= 4; seed++) {
      const r = play('normal', 'normal', seed)
      expect(r.steps).toBeLessThan(60 * 60 * 4)
      if (play('hard', 'easy', seed).winner === 0) hardWins++
    }
    expect(hardWins).toBeGreaterThanOrEqual(3)
  }, 60000)
})

describe('archery: the same arrows for both', () => {
  const apple = (s: State) => straight(s.turn, applePower(s.turn, s.gap))
  const dummy = (s: State) => straight(s.turn, applePower(s.turn, s.gap) - 0.05)
  const miss = (s: State) => straight(s.turn, 0.2)

  it('the second archer still gets the equalising arrow, then sudden death', () => {
    const rng = new Rng(21)
    const s = newState(0, 0)
    s.apples = [TO_WIN - 1, TO_WIN - 1]
    shootAndSettle(s, apple(s), rng)
    expect(s.phase).toBe('aim')
    expect(s.turn).toBe(1)
    shootAndSettle(s, apple(s), rng)
    // Level on the target: play on.
    expect(s.phase).toBe('aim')
    expect(s.round).toBe(2)
    shootAndSettle(s, miss(s), rng)
    shootAndSettle(s, apple(s), rng)
    expect(s.phase).toBe('over')
    expect(s.won).toBe(1)
    expect(s.apples).toEqual([TO_WIN, TO_WIN + 1])
  })

  it('the match ends at once when the second arrow cannot change it', () => {
    const rng = new Rng(22)
    const s = newState(0, 0)
    s.apples = [TO_WIN - 1, TO_WIN - 3]
    shootAndSettle(s, apple(s), rng)
    expect(s.phase).toBe('over')
    expect(s.won).toBe(0)
  })

  it('a starter out of lives still waits for the rival unless the rival is ahead anyway', () => {
    const rng = new Rng(23)
    const s = newState(0, 0)
    s.lives = [1, 1]
    s.apples = [2, 1]
    shootAndSettle(s, dummy(s), rng)
    expect(s.lives[0]).toBe(0)
    expect(s.phase).toBe('aim')
    // Both out in the same round: the apples decide.
    shootAndSettle(s, dummy(s), rng)
    expect(s.phase).toBe('over')
    expect(s.won).toBe(0)

    const t = newState(0, 0)
    t.lives = [1, 2]
    t.apples = [1, 3]
    shootAndSettle(t, dummy(t), rng)
    expect(t.phase).toBe('over')
    expect(t.won).toBe(1)
  })

  it('both out of lives on level apples is a draw', () => {
    expect(verdict([2, 2], [0, 0], TO_WIN)).toBe('draw')
    expect(verdict([TO_WIN, TO_WIN], [2, 2], TO_WIN)).toBeNull()
    expect(verdict([TO_WIN + 1, TO_WIN], [2, 2], TO_WIN)).toBe(0)
  })

  it('a careful bot hits the dummy less than a careless one', () => {
    const rng = new Rng(24)
    const hits = { easy: 0, hard: 0 }
    for (let i = 0; i < 30; i++) {
      const s = newState(0, rollWind(rng))
      for (const d of ['easy', 'hard'] as const)
        if (flight(0, choose(s, 0, d, rng), s.gap, s.wind).outcome === 'dummy') hits[d]++
    }
    expect(hits.hard).toBeLessThan(hits.easy)
  }, 60000)
})
