import { describe, expect, it } from 'vitest'
import { other, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { choose } from './bot.ts'
import {
  type Board,
  BOX_COUNT,
  boxEdges,
  boxesOf,
  completes,
  countBoxes,
  doubleDealsAfter,
  drawLine,
  EDGES,
  emptyBoard,
  givesBox,
  hLine,
  legalLines,
  lineEnds,
  outcome,
  takeAll,
  vLine,
} from './rules.ts'

/** Draw each line in order, all by `side`, returning the resulting board. */
function drawAll(b: Board, lines: number[], side: Side): Board {
  let cur = b
  for (const e of lines) cur = drawLine(cur, e, side).board
  return cur
}

describe('dots and boxes rules', () => {
  it('starts with sixty lines and twenty-five open boxes', () => {
    const b = emptyBoard()
    expect(EDGES).toBe(60)
    expect(legalLines(b)).toHaveLength(60)
    expect(b.boxes).toHaveLength(BOX_COUNT)
    expect(outcome(b)).toBeNull()
  })

  it('numbers lines and boxes consistently', () => {
    expect(lineEnds(hLine(0, 0))).toEqual([
      [0, 0],
      [0, 1],
    ])
    expect(lineEnds(vLine(0, 0))).toEqual([
      [0, 0],
      [1, 0],
    ])
    expect(boxesOf(hLine(0, 0))).toEqual([0])
    expect(boxesOf(hLine(5, 0))).toEqual([20])
    expect(boxesOf(vLine(0, 5))).toEqual([4])
    expect(boxesOf(hLine(1, 2)).sort((a, c) => a - c)).toEqual([2, 7])
    expect(boxEdges(0)).toEqual([hLine(0, 0), hLine(1, 0), vLine(0, 0), vLine(0, 1)])
  })

  it('a box completes on its fourth side, and only the drawer owns it', () => {
    const sides = boxEdges(0)
    let b = emptyBoard()
    b = drawAll(b, sides.slice(0, 3), 0)
    expect(completes(b, sides[3] as number)).toBe(true)
    const r = drawLine(b, sides[3] as number, 1)
    expect(r.completed).toEqual([0])
    expect(r.board.boxes[0]).toBe(1)
    expect(countBoxes(r.board)).toEqual([0, 1])
  })

  it('a line shared by two boxes completes both when it is their last side', () => {
    // Boxes 6 and 7 each have three sides; the line between them completes both.
    const b = drawAll(
      emptyBoard(),
      [...boxEdges(6).slice(0, 3), ...boxEdges(7).filter((e) => e !== vLine(1, 2))],
      0,
    )
    expect(completes(b, vLine(1, 2))).toBe(true)
    expect(drawLine(b, vLine(1, 2), 0).completed.sort((x, y) => x - y)).toEqual([6, 7])
  })

  it('giving a third side is detected before it happens', () => {
    const b = drawAll(emptyBoard(), [hLine(0, 0), hLine(1, 0)], 0)
    expect(givesBox(b, vLine(0, 0))).toBe(true)
    expect(givesBox(b, vLine(0, 1))).toBe(true)
    expect(givesBox(b, hLine(3, 3))).toBe(false)
    expect(givesBox(emptyBoard(), hLine(0, 0))).toBe(false)
  })

  it('refuses to draw a line twice', () => {
    const b = drawLine(emptyBoard(), 4, 0).board
    expect(() => drawLine(b, 4, 1)).toThrow()
  })

  it('a long chain is worth its length to the rival who takes it', () => {
    // Five boxes in a row, each with top and bottom drawn; the left end is open.
    let b = emptyBoard()
    const sides: number[] = []
    for (let c = 0; c < 5; c++) sides.push(hLine(0, c), hLine(1, c))
    b = drawAll(b, sides, 0)
    expect(takeAll(b)).toBe(0)
    b = drawLine(b, vLine(0, 0), 0).board
    expect(takeAll(b)).toBe(5)
  })

  it('a double-cross declines the last two boxes of a chain', () => {
    let b = emptyBoard()
    b = drawAll(b, [hLine(0, 3), hLine(1, 3), hLine(0, 4), hLine(1, 4), vLine(0, 3)], 0)
    // Box 3 can be taken by its right side, which opens box 4 for the rival.
    expect(takeAll(b)).toBe(2)
    expect(completes(b, vLine(0, 4))).toBe(true)
    expect(doubleDealsAfter(b, vLine(0, 4), 0)).toBe(false)
    // Drawing the far end of box 4 instead leaves both boxes on one line.
    expect(doubleDealsAfter(b, vLine(0, 5), 0)).toBe(true)
    const after = drawLine(b, vLine(0, 5), 0).board
    const taken = drawLine(after, vLine(0, 4), 1)
    expect(taken.completed.sort((x, y) => x - y)).toEqual([3, 4])
  })

  it('the scoreboard counts boxes per side and the most boxes wins', () => {
    const all = Array.from({ length: EDGES }, (_, e) => e)
    let b = emptyBoard()
    // Red draws everything in order; each completion goes to whoever drew last.
    b = drawAll(b, all.slice(0, 40), 0)
    b = drawAll(b, all.slice(40), 1)
    const o = outcome(b)
    expect(o).not.toBeNull()
    expect((o?.counts[0] ?? 0) + (o?.counts[1] ?? 0)).toBe(BOX_COUNT)
    expect(o?.winner).toBe(
      countBoxes(b)[0] > countBoxes(b)[1] ? 0 : countBoxes(b)[1] > countBoxes(b)[0] ? 1 : 'draw',
    )
  })

  it('an even split is a draw', () => {
    const boxes: (Side | null)[] = Array.from({ length: BOX_COUNT }, (_, i) =>
      i < 24 ? ((i % 2) as Side) : null,
    )
    const b: Board = { lines: Array<Side | null>(EDGES).fill(0), boxes }
    expect(outcome(b)).toEqual({ winner: 'draw', counts: [12, 12] })
  })
})

describe('dots and boxes bot', () => {
  it('only ever draws a free line', () => {
    const rng = new Rng(4)
    let b = emptyBoard()
    let turn: Side = 0
    for (let i = 0; i < EDGES; i++) {
      const e = choose(b, turn, 'easy', rng)
      expect(b.lines[e]).toBeNull()
      const r = drawLine(b, e, turn)
      b = r.board
      if (!r.completed.length) turn = other(turn)
    }
    expect(outcome(b)).not.toBeNull()
  })

  it('takes a box that is on offer rather than giving one away', () => {
    const b = drawAll(emptyBoard(), boxEdges(0).slice(0, 3), 0)
    expect(choose(b, 1, 'normal', new Rng(1))).toBe(boxEdges(0)[3])
    expect(choose(b, 1, 'hard', new Rng(1))).toBe(boxEdges(0)[3])
  })

  it('avoids a line that hands over a third side when a safe line exists', () => {
    // Box 0 has two sides; drawing either remaining side would give it a third.
    const b = drawAll(emptyBoard(), [hLine(0, 0), hLine(1, 0)], 0)
    for (let i = 0; i < 20; i++) {
      const e = choose(b, 1, 'normal', new Rng(i))
      expect(givesBox(b, e)).toBe(false)
    }
  })

  it('finishes whole games computer against computer, lines drawn exactly once', () => {
    for (const [seed, a, c] of [
      [21, 'normal', 'hard'],
      [22, 'hard', 'hard'],
      [23, 'easy', 'normal'],
      [24, 'hard', 'easy'],
    ] as const) {
      const rng = new Rng(seed)
      let b = emptyBoard()
      let turn: Side = seed % 2 === 0 ? 0 : 1
      let steps = 0
      while (!outcome(b)) {
        const e = choose(b, turn, turn === 0 ? a : c, rng)
        const r = drawLine(b, e, turn)
        b = r.board
        steps++
        expect(steps).toBeLessThanOrEqual(EDGES)
        if (!r.completed.length) turn = other(turn)
      }
      expect(steps).toBe(EDGES)
      const [red, blue] = countBoxes(b)
      expect(red + blue).toBe(BOX_COUNT)
    }
  })
})
