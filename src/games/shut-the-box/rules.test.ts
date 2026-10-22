import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { decide } from './bot.ts'
import {
  ALL_OPEN,
  canShut,
  countOf,
  diceCount,
  expectedFinal,
  options,
  playTurn,
  rollOutcomes,
  subsetsSumming,
  sumOf,
  tileBit,
  winChance,
} from './rules.ts'

const mask = (...tiles: number[]) => tiles.reduce((m, t) => m | tileBit(t), 0)

/** Dice total for a box, as the game rolls it. */
const rollFor = (rng: Rng) => (n: 1 | 2) =>
  n === 1 ? rng.int(1, 6) : rng.int(1, 6) + rng.int(1, 6)

describe('shut the box tiles and sums', () => {
  it('sums open tiles', () => {
    expect(sumOf(ALL_OPEN)).toBe(45)
    expect(sumOf(mask(3, 5))).toBe(8)
    expect(sumOf(0)).toBe(0)
    expect(countOf(ALL_OPEN)).toBe(9)
  })

  it('rolls one die once 7, 8 and 9 are all shut', () => {
    expect(diceCount(ALL_OPEN)).toBe(2)
    expect(diceCount(ALL_OPEN & ~mask(7, 8))).toBe(2)
    expect(diceCount(ALL_OPEN & ~mask(7, 8, 9))).toBe(1)
    expect(diceCount(mask(1, 2, 3, 4, 5, 6))).toBe(1)
  })

  it('finds every set of open tiles that adds up to the roll', () => {
    expect(subsetsSumming(ALL_OPEN, 2)).toEqual([mask(2)])
    const twelve = subsetsSumming(ALL_OPEN, 12)
    expect(twelve).toContain(mask(3, 9))
    expect(twelve).toContain(mask(1, 2, 9))
    expect(twelve.every((m) => sumOf(m) === 12 && (ALL_OPEN & m) === m)).toBe(true)
  })

  it('only uses open tiles', () => {
    const open = mask(1, 2, 4)
    expect(subsetsSumming(open, 3)).toEqual([mask(1, 2)])
    expect(canShut(open, 5)).toBe(true) // 1 + 4
    expect(canShut(open, 7)).toBe(true) // 1 + 2 + 4
    expect(canShut(open, 8)).toBe(false) // more than the open sum
    expect(canShut(0, 1)).toBe(false)
  })

  it('weights rolls: two dice make 11 outcomes that add to 1', () => {
    const two = rollOutcomes(2)
    expect(two).toHaveLength(11)
    expect(two.reduce((a, o) => a + o.p, 0)).toBeCloseTo(1, 9)
    expect(two.find((o) => o.total === 7)?.p).toBeCloseTo(6 / 36, 9)
    const one = rollOutcomes(1)
    expect(one.map((o) => o.total)).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('shut the box turn', () => {
  it('ends with the open sum when the roll cannot be matched', () => {
    const r = playTurn(
      mask(1, 9),
      () => 11,
      () => null,
    )
    expect(r).toMatchObject({ open: mask(1, 9), score: 10, shutAll: false, rolls: 1 })
  })

  it('shuts the tiles that match and keeps going', () => {
    const rolls = [10, 3, 4]
    let i = 0
    const r = playTurn(
      mask(1, 2, 3, 4, 9),
      () => rolls[i++] ?? 0,
      (open, total) => subsetsSumming(open, total)[0] ?? null,
    )
    expect(r.rolls).toBeGreaterThan(1)
    expect(r.score).toBe(sumOf(r.open))
  })

  it('wins on the spot by shutting every tile', () => {
    const r = playTurn(
      mask(1, 9),
      () => 10,
      (open, total) => subsetsSumming(open, total)[0] ?? null,
    )
    expect(r).toMatchObject({ open: 0, score: 0, shutAll: true })
  })

  it('refuses a shut that does not match the roll', () => {
    expect(() =>
      playTurn(
        mask(1, 9),
        () => 10,
        () => mask(1),
      ),
    ).toThrow('bad shut')
  })
})

describe('shut the box expected score', () => {
  it('is zero for a shut box and never more than the open sum', () => {
    expect(expectedFinal(0)).toBe(0)
    for (let m = 0; m <= ALL_OPEN; m++) {
      expect(expectedFinal(m)).toBeLessThanOrEqual(sumOf(m) + 1e-9)
      expect(expectedFinal(m)).toBeGreaterThanOrEqual(0)
    }
  })

  it('values a full box between a fair and a sane total', () => {
    const e = expectedFinal(ALL_OPEN)
    expect(e).toBeGreaterThan(5)
    expect(e).toBeLessThan(40)
  })

  it('prefers the option that leaves the lowest expected score', () => {
    const opts = options(ALL_OPEN, 9)
    expect(opts.length).toBeGreaterThan(1)
    const best = Math.min(...opts.map((o) => o.value))
    const hard = decide(ALL_OPEN, 9, 'hard', new Rng(5))
    expect(hard).toBeDefined()
    const chosen = opts.find((o) => o.mask === hard)
    expect(chosen?.value).toBeCloseTo(best, 9)
  })
})

describe('shut the box bot', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`${difficulty} always picks a valid set of open tiles`, () => {
      const rng = new Rng(7)
      for (let k = 0; k < 200; k++) {
        const open = rng.int(1, ALL_OPEN)
        const total = rng.int(1, 12)
        const m = decide(open, total, difficulty, rng)
        if (canShut(open, total)) {
          expect(m).toBeDefined()
          expect(sumOf(m ?? 0)).toBe(total)
          expect((open & (m ?? 0)) === (m ?? 0)).toBe(true)
        } else expect(m).toBeUndefined()
      }
    })
  }

  it('normal leaves the lowest expected score', () => {
    const rng = new Rng(3)
    const m = decide(ALL_OPEN, 10, 'normal', rng) ?? 0
    const best = Math.min(...options(ALL_OPEN, 10).map((o) => o.value))
    expect(expectedFinal(ALL_OPEN ^ m)).toBeCloseTo(best, 9)
  })

  it('values the chance to beat a known score', () => {
    expect(winChance(0, 5)).toBe(1)
    // Tiles 1 and 2 left (3) against a 4: whatever happens next, it wins.
    expect(winChance(tileBit(1) | tileBit(2), 4)).toBeCloseTo(1, 9)
    expect(winChance(ALL_OPEN, 1)).toBeLessThan(winChance(ALL_OPEN, 20))
  })

  it('hard, playing second, picks the shut with the best chance to beat the score', () => {
    const rng = new Rng(5)
    let differs = 0
    for (let k = 0; k < 400; k++) {
      const open = rng.int(1, ALL_OPEN)
      const total = rng.int(2, 12)
      const beat = rng.int(1, 30)
      const m = decide(open, total, 'hard', rng, beat)
      if (m === undefined) continue
      const chances = subsetsSumming(open, total).map((x) => winChance(open ^ x, beat))
      expect(winChance(open ^ m, beat)).toBeCloseTo(Math.max(...chances), 9)
      const ev = decide(open, total, 'normal', rng) ?? 0
      if (winChance(open ^ ev, beat) < winChance(open ^ m, beat) - 1e-9) differs++
    }
    // Playing for the average would sometimes throw away real winning chances.
    expect(differs).toBeGreaterThan(0)
  })

  it('playing second, hard beats the score more often than normal does', () => {
    const rate = (difficulty: 'normal' | 'hard') => {
      const rng = new Rng(21)
      const roll = rollFor(rng)
      let won = 0
      for (let k = 0; k < 2000; k++) {
        const beat = 4 + (k % 16)
        const r = playTurn(
          ALL_OPEN,
          roll,
          (open, total) => decide(open, total, difficulty, rng, beat) ?? null,
        )
        won += r.score < beat ? 1 : r.score === beat ? 0.5 : 0
      }
      return won / 2000
    }
    expect(rate('hard')).toBeGreaterThan(rate('normal'))
  })

  it('plays a full bot vs bot game to a result in bounded steps', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = new Rng(seed)
      const roll = rollFor(rng)
      const scores: number[] = []
      let steps = 0
      for (const difficulty of ['hard', 'normal'] as const) {
        const r = playTurn(ALL_OPEN, roll, (open, total) => {
          steps++
          expect(steps).toBeLessThan(2000)
          return decide(open, total, difficulty, rng) ?? null
        })
        if (r.shutAll) {
          scores.push(0)
          break
        }
        scores.push(r.score)
      }
      expect(scores.length).toBeGreaterThan(0)
      expect(scores.every((x) => x >= 0 && x <= 45)).toBe(true)
    }
  })

  it('hard scores lower than easy on average', () => {
    const avg = (difficulty: 'easy' | 'hard') => {
      const rng = new Rng(11)
      const roll = rollFor(rng)
      let sum = 0
      const n = 300
      for (let k = 0; k < n; k++) {
        const r = playTurn(
          ALL_OPEN,
          roll,
          (open, total) => decide(open, total, difficulty, rng) ?? null,
        )
        sum += r.score
      }
      return sum / n
    }
    expect(avg('hard')).toBeLessThan(avg('easy'))
  })
})
