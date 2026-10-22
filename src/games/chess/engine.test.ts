import { Chess, type Square } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { choose } from './bot.ts'
import {
  evaluate,
  fromFen,
  fromOf,
  inCheck,
  legal,
  make,
  MATE,
  nameOf,
  rootScores,
  toOf,
  unmake,
} from './engine.ts'
import { play, START, verdict, type Pos } from './rules.ts'

/** Moves as 'e2e4' strings: the engine's, and chess.js's with promotions to a queen only. */
const mine = (e: ReturnType<typeof fromFen>) =>
  legal(e)
    .map((m) => nameOf(fromOf(m)) + nameOf(toOf(m)))
    .sort()
const theirs = (c: Chess) =>
  c
    .moves({ verbose: true })
    .filter((m) => !m.promotion || m.promotion === 'q')
    .map((m) => m.from + m.to)
    .sort()

/** Walk the tree in step with chess.js, comparing the legal moves at every node. */
function walk(fen: string, depth: number): number {
  const e = fromFen(fen)
  const c = new Chess(fen)
  let nodes = 0
  const go = (d: number) => {
    nodes++
    expect(mine(e)).toEqual(theirs(c))
    if (d === 0) return
    for (const m of legal(e)) {
      const from = nameOf(fromOf(m))
      const to = nameOf(toOf(m))
      make(e, m)
      const pawn = c.get(from as Square)?.type === 'p'
      c.move({ from, to, promotion: pawn && (to[1] === '8' || to[1] === '1') ? 'q' : undefined })
      go(d - 1)
      c.undo()
      unmake(e)
    }
  }
  go(depth)
  return nodes
}

describe('chess engine move generation (checked against chess.js)', () => {
  const positions: [string, string, number][] = [
    ['start', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 3],
    ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 2],
    ['rook ending, en passant', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 3],
    ['promotions and pins', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 2],
    ['under-promotion race', 'n1n5/PPPk4/8/8/8/8/4Kppp/5N1N b - - 0 1', 2],
    ['castling through check', 'r3k2r/8/8/8/8/8/5q2/R3K2R w KQkq - 0 1', 2],
  ]
  for (const [name, fen, depth] of positions) {
    it(`agrees on every legal move: ${name}`, () => {
      expect(walk(fen, depth)).toBeGreaterThan(1)
    })
  }

  it('make and unmake leave the position exactly as it was', () => {
    const e = fromFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1')
    const before = Array.from(e.b)
    for (const m of legal(e)) {
      make(e, m)
      unmake(e)
    }
    expect(Array.from(e.b)).toEqual(before)
    expect(e.side).toBe(0)
  })
})

describe('chess engine search', () => {
  it('finds a mate in one', () => {
    // Back-rank mate: Ra8#.
    const e = fromFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1')
    const best = rootScores(e, 3, 50000)[0]
    expect(best && nameOf(fromOf(best.move)) + nameOf(toOf(best.move))).toBe('a1a8')
    expect(best?.score).toBeGreaterThan(MATE - 10)
  })

  it('finds the queen mate on f7', () => {
    // Scholar's mate: Qxf7 is mate in one.
    const e = fromFen('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4')
    const best = rootScores(e, 3, 50000)[0]
    expect(best && nameOf(fromOf(best.move)) + nameOf(toOf(best.move))).toBe('h5f7')
  })

  it('takes a hanging queen and does not hang its own', () => {
    const e = fromFen('4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1')
    const best = rootScores(e, 4, 50000)[0]
    expect(best && nameOf(fromOf(best.move)) + nameOf(toOf(best.move))).toBe('d2d5')
  })

  it('evaluates the start as level', () => {
    const e = fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    expect(evaluate(e)).toBe(0)
    expect(inCheck(e)).toBe(false)
  })
})

/** A game between two levels from the start; returns the verdict's winner. */
function duel(white: 'easy' | 'normal' | 'hard', black: 'easy' | 'normal' | 'hard', seed: number) {
  const rng = new Rng(seed)
  let pos: Pos = START
  for (;;) {
    const v = verdict(pos)
    if (v.winner !== undefined) return v.winner
    const turn = pos.fen.split(' ')[1] === 'w' ? white : black
    const m = choose(pos, turn, rng)
    pos = play(pos, m.from, m.to).pos
  }
}

describe('chess computer strength', () => {
  it('normal beats easy, playing either colour', () => {
    let normal = 0
    for (let seed = 1; seed <= 2; seed++) {
      if (duel('normal', 'easy', seed) === 0) normal++
      if (duel('easy', 'normal', seed + 10) === 1) normal++
    }
    expect(normal).toBeGreaterThanOrEqual(3)
  }, 120000)

  it('hard beats easy with either colour', () => {
    expect(duel('hard', 'easy', 3)).toBe(0)
    expect(duel('easy', 'hard', 4)).toBe(1)
  }, 120000)
})
