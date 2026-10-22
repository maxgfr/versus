import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { chooseMove, PACE } from './bot.ts'
import {
  type Board,
  anyFit,
  canPlaceAny,
  clearLines,
  clearPoints,
  codeOf,
  COLORS,
  colorOf,
  fits,
  N,
  pieceSequence,
  SEQUENCE_TRAYS,
  SHAPES,
  type Shape,
  shapeOf,
  snap,
  step,
  TRAY,
  trayAt,
} from './rules.ts'

const DOT_SHAPE = SHAPES.find((s) => s.w === 1 && s.h === 1) as Shape
const DOMINO_SHAPE = SHAPES.find((s) => s.w === 2 && s.h === 1 && s.cells.length === 2) as Shape
const VDOMINO_SHAPE = SHAPES.find((s) => s.w === 1 && s.h === 2) as Shape
const BAR4_SHAPE = SHAPES.find((s) => s.w === 4 && s.h === 1) as Shape
const DOT = codeOf(SHAPES.indexOf(DOT_SHAPE), 0)
const DOMINO = codeOf(SHAPES.indexOf(DOMINO_SHAPE), 0)

const empty = (): number[] => Array<number>(N * N).fill(0)

/** A grid with every cell filled except the listed [column, row] holes. */
function almostFull(holes: [number, number][]): number[] {
  const g = Array<number>(N * N).fill(1)
  for (const [x, y] of holes) g[y * N + x] = 0
  return g
}

/** Holes on the diagonal from (2,2) to (7,7): one per row and column past the corner. */
function diagonal(): [number, number][] {
  return Array.from({ length: N - 2 }, (_, i) => [i + 2, i + 2] as [number, number])
}

describe('block shapes', () => {
  it('every shape is a normalised set of unique blocks inside its box', () => {
    for (const s of SHAPES) {
      expect(s.cells.length).toBeGreaterThan(0)
      expect(s.cells.length).toBeLessThanOrEqual(9)
      expect(new Set(s.cells.map(([x, y]) => `${x},${y}`)).size).toBe(s.cells.length)
      expect(Math.min(...s.cells.map(([x]) => x))).toBe(0)
      expect(Math.min(...s.cells.map(([, y]) => y))).toBe(0)
      for (const [x, y] of s.cells) {
        expect(x).toBeLessThan(s.w)
        expect(y).toBeLessThan(s.h)
      }
    }
  })

  it('codes round-trip through shape and colour', () => {
    for (let s = 0; s < SHAPES.length; s++) {
      for (let c = 0; c < COLORS; c++) {
        expect(shapeOf(codeOf(s, c))).toBe(s)
        expect(colorOf(codeOf(s, c))).toBe(c)
      }
    }
  })
})

describe('block deal', () => {
  it('is the same sequence for the same seed, on both halves', () => {
    expect(pieceSequence(12)).toEqual(pieceSequence(12))
    expect(pieceSequence(12)).not.toEqual(pieceSequence(13))
    expect(pieceSequence(12)).toHaveLength(SEQUENCE_TRAYS * TRAY)
  })

  it('deals trays from the sequence and wraps past its end', () => {
    const seq = pieceSequence(3)
    expect(trayAt(seq, 0)).toEqual(seq.slice(0, TRAY))
    expect(trayAt(seq, 2)).toEqual(seq.slice(6, 9))
    expect(trayAt(seq, SEQUENCE_TRAYS)).toEqual(trayAt(seq, 0))
  })
})

describe('block placement', () => {
  it('rejects pieces off the grid and on filled blocks', () => {
    const g = empty()
    expect(fits(g, DOT_SHAPE.cells, 0, 0)).toBe(true)
    expect(fits(g, DOT_SHAPE.cells, -1, 0)).toBe(false)
    expect(fits(g, DOT_SHAPE.cells, N, 0)).toBe(false)
    const withBlock = empty()
    withBlock[9] = 1
    expect(fits(withBlock, DOT_SHAPE.cells, 1, 1)).toBe(false)
    expect(fits(withBlock, DOT_SHAPE.cells, 2, 1)).toBe(true)
  })

  it('finds room for a shape only where it actually fits', () => {
    // Two stacked holes in the middle: room for a vertical domino, not a 4-bar.
    const g = almostFull([
      [3, 3],
      [3, 4],
    ])
    expect(anyFit(g, VDOMINO_SHAPE)).toBe(true)
    expect(anyFit(g, BAR4_SHAPE)).toBe(false)
  })

  it('scores a placement by its blocks and deals a new tray once the old one is used', () => {
    const seq = pieceSequence(8)
    const start: Board = { grid: empty(), tray: trayAt(seq, 0), k: 0 }
    const first = step(start, seq, 0, 0, 0)
    expect(first?.points).toBe(SHAPES[shapeOf(start.tray[0] as number)]?.cells.length)
    expect(first?.board.tray[0]).toBeNull()
    expect(first?.board.k).toBe(0)
    let board = first?.board ?? start
    for (const slot of [1, 2]) {
      const s = SHAPES[shapeOf(board.tray[slot] as number)] as Shape
      let placed: ReturnType<typeof step> = null
      for (let y = 0; y < N && !placed; y++) {
        for (let x = 0; x < N && !placed; x++) {
          if (fits(board.grid, s.cells, x, y)) placed = step(board, seq, slot, x, y)
        }
      }
      expect(placed).not.toBeNull()
      board = placed?.board ?? board
    }
    expect(board.k).toBe(1)
    expect(board.tray).toEqual(trayAt(seq, 1))
  })

  it('refuses a drop that does not fit, or from an empty slot', () => {
    const seq = pieceSequence(8)
    const b: Board = { grid: almostFull([[0, 0]]), tray: [DOMINO, null, null], k: 0 }
    expect(step(b, seq, 0, 0, 0)).toBeNull()
    expect(step(b, seq, 1, 0, 0)).toBeNull()
  })
})

describe('line clears', () => {
  it('clears a row and a column together, each block once', () => {
    // Row 0 and column 0 are full except the corner, which the dot fills.
    const g = empty()
    for (let x = 1; x < N; x++) g[x] = 1
    for (let y = 1; y < N; y++) g[y * N] = 1
    g[N * N - 1] = 1
    const filled = g.slice()
    filled[0] = 1
    const r = clearLines(filled)
    expect(r.lines).toBe(2)
    expect(r.cleared).toHaveLength(2 * N - 1)
    expect(r.grid[0]).toBe(0)
    expect(r.grid[N - 1]).toBe(0)
    expect(r.grid[N * N - 1]).toBe(1)
    expect(clearPoints(r.lines)).toBe(40)
  })

  it('leaves partly filled lines alone', () => {
    const g = empty()
    for (let x = 0; x < N - 1; x++) g[x] = 1
    const r = clearLines(g)
    expect(r.lines).toBe(0)
    expect(r.grid).toEqual(g)
  })

  it('the bonus grows with the square of the lines cleared', () => {
    expect(clearPoints(1)).toBe(10)
    expect(clearPoints(2)).toBe(40)
    expect(clearPoints(3)).toBe(90)
  })

  it('reports each cleared cell with the value it held', () => {
    const seq = pieceSequence(8)
    // Row 7 is full except its last block: a dot there clears it (column 7 is not full).
    const g = empty()
    for (let x = 0; x < N - 1; x++) g[7 * N + x] = 3
    const r = step({ grid: g, tray: [DOT, null, null], k: 0 }, seq, 0, N - 1, N - 1)
    expect(r?.lines).toBe(1)
    expect(r?.cleared.find((c) => c.cell === 7 * N)?.value).toBe(3)
    expect(r?.cleared.find((c) => c.cell === N * N - 1)?.value).toBe(1)
    expect(r?.points).toBe(1 + 10)
  })
})

describe('game over', () => {
  it('is reached when no remaining piece fits anywhere', () => {
    const seq = pieceSequence(8)
    // Holes at the corner and beside it, and one on each other row and column so
    // nothing clears: the dot fits at the corner, then the domino has nowhere to go.
    const g = almostFull([[0, 0], [1, 0], [0, 1], ...diagonal()])
    const r = step({ grid: g, tray: [DOT, DOMINO, null], k: 0 }, seq, 0, 0, 0)
    expect(r?.lines).toBe(0)
    expect(r?.dead).toBe(true)
  })

  it('stays alive while a remaining piece still fits', () => {
    const seq = pieceSequence(8)
    // Same as above, plus a free pair in the top row where the domino still fits.
    const g = almostFull([[0, 0], [1, 0], [0, 1], [5, 0], [6, 0], ...diagonal()])
    const r = step({ grid: g, tray: [DOT, DOMINO, null], k: 0 }, seq, 0, 0, 0)
    expect(r?.dead).toBe(false)
    expect(canPlaceAny(r?.board.grid ?? [], r?.board.tray ?? [])).toBe(true)
  })
})

describe('snapping a drag', () => {
  it('lands exactly where the piece centre is over a free spot', () => {
    expect(snap(empty(), DOT_SHAPE, 3.5, 4.5)).toEqual({ x: 3, y: 4, ok: true })
  })

  it('nudges a near miss to a free spot within a block', () => {
    const g = empty()
    g[3 * N + 3] = 1
    const s = snap(g, DOT_SHAPE, 3.2, 3.2)
    expect(s.ok).toBe(true)
    expect(fits(g, DOT_SHAPE.cells, s.x, s.y)).toBe(true)
  })

  it('reports nothing fits when there is no room near the drag', () => {
    expect(snap(almostFull([[0, 0]]), DOMINO_SHAPE, 7.5, 7.5).ok).toBe(false)
  })
})

describe('block bot', () => {
  it('takes a line-clearing drop when one is there', () => {
    const g = empty()
    for (let x = 1; x < N; x++) g[7 * N + x] = 1
    expect(chooseMove(g, [DOT, null, null], 'hard', new Rng(1))).toEqual({ slot: 0, x: 0, y: 7 })
  })

  it('always returns a legal drop, or nothing when nothing fits', () => {
    const rng = new Rng(4)
    for (let i = 0; i < 40; i++) {
      const g = Array.from({ length: N * N }, () => (rng.chance(0.35) ? 1 : 0))
      const tray = trayAt(pieceSequence(i), 0)
      const m = chooseMove(g, tray, 'normal', rng)
      if (!m) {
        expect(canPlaceAny(g, tray)).toBe(false)
        continue
      }
      const code = tray[m.slot] as number
      expect(fits(g, (SHAPES[shapeOf(code)] as Shape).cells, m.x, m.y)).toBe(true)
    }
  })

  it('the hard computer never strands a piece it still has to place when it can help it', () => {
    // Room for exactly one 3x3 in the corner, and a dot: the dot must not take the 3x3's spot.
    const g = empty()
    for (let i = 0; i < N * N; i++) {
      const x = i % N
      const y = Math.floor(i / N)
      if (!(x < 3 && y < 3) && !(x === 7 && y === 7) && !(x === 7 && y === 0)) g[i] = 1
    }
    const sq = SHAPES.findIndex((s) => s.w === 3 && s.h === 3 && s.cells.length === 9)
    const m = chooseMove(g, [DOT, codeOf(sq, 0), null], 'hard', new Rng(1))
    expect(m?.slot === 1 || (m?.slot === 0 && !(m.x < 3 && m.y < 3))).toBe(true)
  })

  it('hard outscores easy over the same 90 s, course after course', () => {
    const play = (seed: number, d: 'easy' | 'hard'): number => {
      const seq = pieceSequence(seed)
      let b: Board = { grid: empty(), tray: trayAt(seq, 0), k: 0 }
      const rng = new Rng(seed)
      let score = 0
      for (let t = 0; t < 90; t += PACE[d]) {
        const m = chooseMove(b.grid, b.tray, d, rng)
        if (!m) break
        const r = step(b, seq, m.slot, m.x, m.y)
        if (!r) break
        score += r.points
        b = r.board
        if (r.dead) break
      }
      return score
    }
    let wins = 0
    for (let seed = 1; seed <= 5; seed++) if (play(seed, 'hard') > play(seed, 'easy')) wins++
    expect(wins).toBe(5)
  })

  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`plays a whole two-player match on ${d} to the end, within the clock`, () => {
      const seq = pieceSequence(31)
      const rng = new Rng(9)
      const boards: Board[] = [0, 1].map(() => ({ grid: empty(), tray: trayAt(seq, 0), k: 0 }))
      const dead = [false, false]
      let lines = 0
      let drops = 0
      let t = 0
      // Each side drops every PACE seconds until it is out, or the 90 s clock runs out.
      while (!dead.every(Boolean) && t < 90) {
        t += PACE[d]
        for (const side of [0, 1]) {
          if (dead[side]) continue
          const b = boards[side] as Board
          const m = chooseMove(b.grid, b.tray, d, rng)
          if (!m) {
            dead[side] = true
            continue
          }
          const r = step(b, seq, m.slot, m.x, m.y)
          expect(r).not.toBeNull()
          if (!r) continue
          lines += r.lines
          drops++
          boards[side] = r.board
          if (r.dead) dead[side] = true
        }
      }
      expect(drops).toBeGreaterThan(10)
      expect(lines).toBeGreaterThan(0)
    })
  }
})
