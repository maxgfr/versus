import { describe, expect, it } from 'vitest'
import type { Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { choose, risk } from './bot.ts'
import {
  BASE,
  FINISH,
  HOME_CELLS,
  landing,
  legalTokens,
  SAFE,
  START,
  step,
  TOKENS,
  TRACK,
  TRACK_CELLS,
  type Tokens,
  trackOf,
  won,
} from './rules.ts'

const none = (): Tokens => [Array(TOKENS).fill(BASE), Array(TOKENS).fill(BASE)]

/** Blue progress of the track square that red progress `redProg` stands on. */
const blueProgOn = (redProg: number): number => {
  const cell = trackOf(0, redProg) ?? 0
  return (cell - START[1] + TRACK) % TRACK
}

const adjacent = (a: readonly [number, number], b: readonly [number, number]) =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) === 1

describe('track geometry', () => {
  it('has 52 distinct squares forming a closed loop', () => {
    expect(TRACK_CELLS).toHaveLength(TRACK)
    expect(new Set(TRACK_CELLS.map(([c, r]) => `${c},${r}`)).size).toBe(TRACK)
    for (let i = 0; i < TRACK; i++) {
      const a = TRACK_CELLS[i]
      const b = TRACK_CELLS[(i + 1) % TRACK]
      expect(a && b && adjacent(a, b)).toBe(true)
    }
  })

  it('starts each side on a square next to its base', () => {
    // Red's base is the bottom-left quadrant (cols 0–5, rows 9–14).
    expect(TRACK_CELLS[START[0]]).toEqual([6, 14])
    // Blue's base is the top-right quadrant (cols 9–14, rows 0–5).
    expect(TRACK_CELLS[START[1]]).toEqual([8, 0])
  })

  it('puts the two starts half a lap apart', () => {
    expect((START[0] - START[1] + TRACK) % TRACK).toBe(26)
  })

  it('enters each home column from the square just before its start', () => {
    expect(TRACK_CELLS[trackOf(0, 51) ?? -1]).toEqual([7, 14])
    expect(TRACK_CELLS[trackOf(1, 51) ?? -1]).toEqual([7, 0])
    expect(HOME_CELLS[0]).toHaveLength(6)
    expect(HOME_CELLS[1]).toHaveLength(6)
  })

  it('keeps home columns off the track and apart from each other', () => {
    const track = new Set(TRACK_CELLS.map(([c, r]) => `${c},${r}`))
    const home = [...(HOME_CELLS[0] ?? []), ...(HOME_CELLS[1] ?? [])].map(([c, r]) => `${c},${r}`)
    expect(home.some((h) => track.has(h))).toBe(false)
    expect(new Set(home).size).toBe(12)
  })

  it('marks four safe squares: each start and the star eight ahead', () => {
    expect([...SAFE].sort((a, b) => a - b)).toEqual([2, 10, 28, 36])
  })
})

describe('moves', () => {
  it('leaves base only on a six', () => {
    expect(landing(BASE, 5)).toBeNull()
    expect(landing(BASE, 6)).toBe(0)
  })

  it('never overshoots home', () => {
    expect(landing(51, 6)).toBe(57)
    expect(landing(53, 5)).toBeNull()
    expect(landing(53, 4)).toBe(57)
    expect(landing(FINISH, 1)).toBeNull()
  })

  it('lists only legal tokens', () => {
    const tok = none()
    tok[0] = [BASE, 10, 55, FINISH]
    // A six takes the base token out and carries the 10 on, but overshoots from 55.
    expect(legalTokens(tok, 0, 6)).toEqual([0, 1])
    expect(legalTokens(tok, 0, 2)).toEqual([1, 2])
  })

  it('captures a rival on a non-safe square', () => {
    const tok = none()
    tok[0][0] = 7
    tok[1][0] = blueProgOn(10)
    const r = step(tok, 0, 0, 3)
    expect(r.to).toBe(10)
    expect(r.captured).toEqual([[1, 0]])
    expect(r.tok[1][0]).toBe(BASE)
  })

  it('does not capture on a safe square', () => {
    const tok = none()
    // Blue stands on red's start square, which is safe.
    tok[1][0] = blueProgOn(0)
    const r = step(tok, 0, 0, 6)
    expect(r.to).toBe(0)
    expect(r.captured).toEqual([])
    expect(r.tok[1][0]).toBe(blueProgOn(0))
  })

  it('sends every rival on the square home', () => {
    const tok = none()
    tok[1][0] = blueProgOn(12)
    tok[1][2] = blueProgOn(12)
    tok[0][0] = 10
    const r = step(tok, 0, 0, 2)
    expect(r.captured.map(([, j]) => j).sort()).toEqual([0, 2])
  })

  it('a rival in its home column cannot be captured', () => {
    const tok = none()
    tok[1][0] = 55
    tok[0][0] = 50
    const r = step(tok, 0, 0, 5)
    expect(r.to).toBe(55)
    expect(r.captured).toEqual([])
  })

  it('is won when all four tokens are home', () => {
    const tok = none()
    tok[0] = [FINISH, FINISH, FINISH, FINISH]
    expect(won(tok, 0)).toBe(true)
    expect(won(tok, 1)).toBe(false)
  })
})

describe('bot', () => {
  it('risk is zero on safe squares and grows with a rival behind', () => {
    const tok = none()
    expect(risk(tok, 0, 0)).toBe(0)
    // A blue token four squares behind red's progress 10.
    tok[1][0] = blueProgOn(10) - 4
    expect(risk(tok, 0, 10)).toBeGreaterThan(0)
  })

  it('takes a capture on normal over other moves', () => {
    const tok = none()
    tok[0] = [5, 20, BASE, BASE]
    tok[1][0] = blueProgOn(9)
    expect(choose(tok, 0, 4, 'normal', new Rng(3))).toBe(0)
  })

  it('leaves base before advancing on normal when there is no capture', () => {
    const tok = none()
    tok[0] = [20, BASE, BASE, BASE]
    expect(choose(tok, 0, 6, 'normal', new Rng(5))).toBe(1)
  })

  it('always picks a legal token', () => {
    const tok = none()
    tok[0] = [3, 40, BASE, 55]
    for (const d of ['easy', 'normal', 'hard'] as const) {
      for (let face = 1; face <= 6; face++) {
        const legal = legalTokens(tok, 0, face)
        if (legal.length === 0) continue
        expect(legal).toContain(choose(tok, 0, face, d, new Rng(face)))
      }
    }
  })
})

/** Plays one side's full turn sequence until a result; returns the winner and turn count. */
function playOut(
  difficulty: 'easy' | 'normal' | 'hard',
  seed: number,
): { winner: Side; turns: number } {
  const rng = new Rng(seed)
  let tok = none()
  let turn: Side = rng.chance(0.5) ? 0 : 1
  let turns = 0
  for (;;) {
    if (++turns > 4000) throw new Error('game did not end')
    const face = rng.int(1, 6)
    const legal = legalTokens(tok, turn, face)
    if (legal.length > 0) {
      const r = step(tok, turn, choose(tok, turn, face, difficulty, rng), face)
      tok = r.tok
      if (won(tok, turn)) return { winner: turn, turns }
    }
    // A six rolls again (even with no move); anything else passes the turn.
    if (face !== 6) turn = turn === 0 ? 1 : 0
  }
}

describe('ludo games', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    for (const seed of [1, 2, 3]) {
      it(`a ${difficulty} computer game (seed ${seed}) finishes in bounded turns`, () => {
        const { winner, turns } = playOut(difficulty, seed)
        expect(winner === 0 || winner === 1).toBe(true)
        expect(turns).toBeLessThan(4000)
      })
    }
  }
})

describe('ludo computer strength', () => {
  const duel = (a: 'easy' | 'normal' | 'hard', b: 'easy' | 'normal' | 'hard', seed: number) => {
    const rng = new Rng(seed)
    let tok = none()
    let turn: Side = seed % 2 === 0 ? 0 : 1
    for (;;) {
      const face = rng.int(1, 6)
      if (legalTokens(tok, turn, face).length) {
        tok = step(tok, turn, choose(tok, turn, face, turn === 0 ? a : b, rng), face).tok
        if (won(tok, turn)) return turn
      }
      if (face !== 6) turn = turn === 0 ? 1 : 0
    }
  }

  it('hard and normal beat easy most of the time over seeded games (the dice still have a say)', () => {
    let hard = 0
    let normal = 0
    for (let seed = 1; seed <= 60; seed++) {
      if (duel('hard', 'easy', seed) === 0) hard++
      if (duel('normal', 'easy', seed) === 0) normal++
    }
    expect(hard).toBeGreaterThanOrEqual(42)
    expect(normal).toBeGreaterThanOrEqual(42)
  })

  it('hard steps out of reach of a rival right behind rather than run a pawn that is safe', () => {
    const tok = none()
    // Red pawn A sits 2 squares ahead of a blue pawn; pawn B is far away and unthreatened.
    const a = 10
    tok[0] = [a, 30, BASE, BASE]
    tok[1][0] = blueProgOn(a - 2)
    // With a 5, moving A puts it 7 ahead (out of reach of one roll); moving B leaves A hanging.
    expect(choose(tok, 0, 5, 'hard', new Rng(1))).toBe(0)
  })
})
