import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { PaintBot } from './bot.ts'
import {
  BOARD,
  type Ev,
  matchWinner,
  newWorld,
  NONE,
  ROLL_SPEED,
  SPLASH_CD,
  shares,
  spawn,
  stepWorld,
  type World,
} from './rules.ts'

const cellCentre = (c: number, r: number) => ({
  x: BOARD.x0 + (c + 0.5) * BOARD.cell,
  y: BOARD.y0 + (r + 0.5) * BOARD.cell,
})
const owner = (w: World, c: number, r: number) => w.own[r * BOARD.cols + c]

/** Red's roller on cell (c, r), blue's far away in the bottom-right corner. */
function at(c: number, r: number, teams = false): World {
  const w = newWorld(teams)
  const p = cellCentre(c, r)
  const red = w.rollers[0]
  if (!red) throw new Error('roller')
  red.x = p.x
  red.y = p.y
  const blue = w.rollers[1]
  if (blue) {
    blue.x = cellCentre(11, 19).x
    blue.y = cellCentre(11, 19).y
  }
  return w
}

describe('paint floor', () => {
  it('is 12 by 20 and the rollers start on it, mirrored for blue', () => {
    expect(BOARD.cols).toBe(12)
    expect(BOARD.rows).toBe(20)
    const red = spawn(0, 0, false)
    const blue = spawn(1, 0, false)
    expect(red.x + blue.x).toBe(1000)
    expect(red.y + blue.y).toBe(1800)
    const w = newWorld(false)
    expect(w.rollers.length).toBe(2)
    expect(w.own.every((o) => o === NONE)).toBe(true)
  })

  it('two a side in teams mode, lanes left and right', () => {
    const w = newWorld(true)
    expect(w.rollers.length).toBe(4)
    expect(w.rollers.filter((r) => r.side === 0).map((r) => r.lane)).toEqual([0, 1])
    expect(w.rollers.filter((r) => r.side === 1).map((r) => r.lane)).toEqual([0, 1])
    expect(spawn(0, 0, true).x).toBeLessThan(spawn(0, 1, true).x)
  })
})

describe('paint rolling', () => {
  it('paints the tiles it rolls over and overwrites the rival', () => {
    const w = at(5, 5)
    const blue = w.rollers[1]
    if (!blue) throw new Error('blue')
    // Blue painted a tile beforehand; red rolls over it and takes it.
    w.own[5 * BOARD.cols + 5] = 2
    stepWorld(w, [{ jx: 0, jy: 0, splash: false }, undefined], STEP, [])
    expect(owner(w, 5, 5)).toBe(1)
    expect(w.counts[0]).toBeGreaterThan(0)
  })

  it('a roll leaves a trail: the tiles it passes stay painted', () => {
    const w = at(2, 10)
    const ev: Ev[] = []
    for (let i = 0; i < 90; i++)
      stepWorld(w, [{ jx: 1, jy: 0, splash: false }, undefined], STEP, ev)
    for (let c = 2; c <= 6; c++) expect(owner(w, c, 10)).toBe(1)
    expect(ev.some((e) => e.k === 'paint')).toBe(true)
  })

  it('moves at the roller speed and stays on the floor', () => {
    const w = at(6, 10)
    const red = w.rollers[0]
    if (!red) throw new Error('red')
    const x0 = red.x
    for (let i = 0; i < 60; i++)
      stepWorld(w, [{ jx: 1, jy: 0, splash: false }, undefined], STEP, [])
    expect(red.x - x0).toBeCloseTo(ROLL_SPEED, 0)
    for (let i = 0; i < 2000; i++)
      stepWorld(w, [{ jx: 0, jy: 1, splash: false }, undefined], STEP, [])
    expect(red.y).toBeLessThanOrEqual(BOARD.y0 + BOARD.rows * BOARD.cell)
  })
})

describe('paint splash', () => {
  it('paints the 3 × 3 burst around the roller and then cools down', () => {
    const w = at(6, 10)
    const ev: Ev[] = []
    stepWorld(w, [{ jx: 0, jy: 0, splash: true }, undefined], STEP, ev)
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) expect(owner(w, 6 + dc, 10 + dr)).toBe(1)
    expect(owner(w, 8, 10)).toBe(NONE)
    // The roller's own trail already covered part of the burst: count what changed.
    expect(ev.some((e) => e.k === 'splash' && e.n >= 1 && e.n <= 9)).toBe(true)
    const red = w.rollers[0]
    expect(red?.cd).toBeCloseTo(SPLASH_CD, 6)
    // A second press during the cooldown does nothing.
    const before = w.own.slice()
    stepWorld(w, [{ jx: 0, jy: 0, splash: true }, undefined], STEP, ev)
    expect(w.own).toEqual(before)
  })

  it('a splash in the corner clips to the floor', () => {
    const w = at(0, 0)
    stepWorld(w, [{ jx: 0, jy: 0, splash: true }, undefined], STEP, [])
    expect(owner(w, 0, 0)).toBe(1)
    expect(owner(w, 1, 1)).toBe(1)
    expect(w.own.filter((o) => o === 1).length).toBe(4)
  })
})

describe('paint result', () => {
  it('the side with more painted tiles wins, a tie is a draw', () => {
    const w = newWorld(false)
    w.own[0] = 1
    w.own[1] = 1
    w.own[2] = 2
    w.counts = [2, 1]
    expect(matchWinner(w)).toBe(0)
    w.own[3] = 2
    expect(matchWinner(w)).toBe('draw')
    w.own[4] = 2
    expect(matchWinner(w)).toBe(1)
    expect(shares(w)[1]).toBeCloseTo(3 / (BOARD.cols * BOARD.rows))
  })
})

describe('paint bot vs bot', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`a ${difficulty} 60 s match paints both sides`, () => {
      for (const teams of [false, true]) {
        const rng = new Rng(teams ? 41 : 17)
        const w = newWorld(teams)
        const bots = w.rollers.map(() => new PaintBot(rng.fork(), difficulty))
        let steps = 0
        while (w.t < 60 && steps < 60 * 70) {
          const drives = w.rollers.map((r, i) => bots[i]?.decide(w, r, STEP))
          stepWorld(w, drives, STEP, [])
          steps++
        }
        const [red, blue] = shares(w)
        expect(red).toBeGreaterThan(0.15)
        expect(blue).toBeGreaterThan(0.15)
        expect(red + blue).toBeLessThanOrEqual(1)
      }
    })
  }
})
