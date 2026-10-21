import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { choose } from './bot.ts'
import {
  boardOf,
  findKing,
  legalMoves,
  MAX_PLIES,
  material,
  play,
  type Pos,
  START,
  targetsFrom,
  verdict,
} from './rules.ts'

const at = (fen: string, sq: string) =>
  boardOf(fen)[(8 - Number(sq[1])) * 8 + 'abcdefgh'.indexOf(sq[0] ?? '')]

/** Position with the given FEN and no history (fine for everything but repetition). */
const from = (fen: string): Pos => ({ fen, history: [] })

/** Play a list of SAN-free moves given as [from, to] pairs. */
function run(moves: [string, string][]): Pos {
  let pos = START
  for (const [a, b] of moves) pos = play(pos, a, b).pos
  return pos
}

describe('chess rules', () => {
  it('starts with twenty legal moves and both kings on e1 and e8', () => {
    expect(legalMoves(START.fen)).toHaveLength(20)
    expect(findKing(START.fen, 'w')).toBe('e1')
    expect(findKing(START.fen, 'b')).toBe('e8')
    expect(boardOf(START.fen).filter(Boolean)).toHaveLength(32)
    expect(material(START.fen)).toBe(0)
  })

  it('plays a legal move and records it in SAN', () => {
    const played = play(START, 'e2', 'e4')
    expect(played.san).toBe('e4')
    expect(played.color).toBe('w')
    expect(played.pos.history).toEqual(['e4'])
    expect(played.pos.fen.split(' ')[1]).toBe('b')
    expect(played.captured).toBeNull()
  })

  it('refuses an illegal move', () => {
    expect(() => play(START, 'e2', 'e5')).toThrow()
    expect(() => play(START, 'e7', 'e5')).toThrow()
  })

  it('lists only the legal targets of one piece', () => {
    expect(
      targetsFrom(START.fen, 'g1')
        .map((m) => m.to)
        .sort(),
    ).toEqual(['f3', 'h3'])
    expect(targetsFrom(START.fen, 'e4')).toEqual([])
  })

  it('reports a capture and the square it was taken on', () => {
    const pos = run([
      ['e2', 'e4'],
      ['d7', 'd5'],
    ])
    const took = play(pos, 'e4', 'd5')
    expect(took.captured).toBe('p')
    expect(took.capturedAt).toBe('d5')
    expect(took.san).toBe('exd5')
  })

  it('takes en passant and reports the pawn on its own square', () => {
    const pos = run([
      ['e2', 'e4'],
      ['a7', 'a6'],
      ['e4', 'e5'],
      ['d7', 'd5'],
    ])
    const ep = play(pos, 'e5', 'd6')
    expect(ep.captured).toBe('p')
    expect(ep.capturedAt).toBe('d5')
    expect(at(ep.pos.fen, 'd5')).toBeNull()
  })

  it('promotes to a queen automatically', () => {
    const pos = from('4k3/P7/8/8/8/8/8/4K3 w - - 0 1')
    const p = play(pos, 'a7', 'a8')
    expect(p.promoted).toBe(true)
    expect(at(p.pos.fen, 'a8')).toEqual({ type: 'q', color: 'w' })
    expect(legalMoves('4k3/P7/8/8/8/8/8/4K3 w - - 0 1').filter((m) => m.from === 'a7')).toEqual([
      { from: 'a7', to: 'a8', promotion: 'q' },
    ])
  })

  it('declares checkmate for the side that delivered it (Fool’s mate)', () => {
    const pos = run([
      ['f2', 'f3'],
      ['e7', 'e5'],
      ['g2', 'g4'],
      ['d8', 'h4'],
    ])
    expect(verdict(pos)).toEqual({ status: 'mate', winner: 1, note: 'Checkmate' })
  })

  it('draws stalemate', () => {
    expect(verdict(from('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))).toEqual({
      status: 'draw',
      winner: 'draw',
      note: 'Stalemate',
    })
  })

  it('draws when neither side can mate', () => {
    expect(verdict(from('8/8/8/4k3/8/8/8/4K3 w - - 0 1')).winner).toBe('draw')
  })

  it('draws on the fifty-move rule', () => {
    expect(verdict(from('4k3/8/8/8/8/8/8/4K2R w - - 100 80'))).toMatchObject({
      status: 'draw',
      note: 'Fifty-move rule',
    })
  })

  it('draws on threefold repetition, which needs the real history', () => {
    let pos = START
    for (const [a, b] of [
      ['g1', 'f3'],
      ['g8', 'f6'],
      ['f3', 'g1'],
      ['f6', 'g8'],
      ['g1', 'f3'],
      ['g8', 'f6'],
      ['f3', 'g1'],
    ] as const) {
      pos = play(pos, a, b).pos
      expect(verdict(pos).winner).toBeUndefined()
    }
    pos = play(pos, 'f6', 'g8').pos
    expect(verdict(pos)).toMatchObject({ status: 'draw', note: 'Threefold repetition' })
  })

  it('keeps the material count in pawns', () => {
    expect(material('4k3/8/8/8/8/8/8/4KQ2 w - - 0 1')).toBe(9)
    expect(material('4kq2/8/8/8/8/8/8/4K3 w - - 0 1')).toBe(-9)
  })

  it('never runs past the ply cap in random play', () => {
    const rng = new Rng(11)
    let pos = START
    let v = verdict(pos)
    while (v.winner === undefined) {
      const moves = legalMoves(pos.fen)
      const m = rng.pick(moves)
      pos = play(pos, m.from, m.to).pos
      v = verdict(pos)
      expect(pos.history.length).toBeLessThanOrEqual(MAX_PLIES)
    }
    expect(v.winner).toBeDefined()
  })
})

describe('chess bot', () => {
  it('finds mate in one on hard', () => {
    const m = choose(from('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'), 'hard', new Rng(1))
    expect(m).toEqual({ from: 'a1', to: 'a8' })
  })

  it('takes a hanging queen on hard', () => {
    const m = choose(from('4k3/8/8/8/3q4/8/8/3RK3 w - - 0 1'), 'hard', new Rng(2))
    expect(m).toEqual({ from: 'd1', to: 'd4' })
  })

  it('answers with a legal move for either side, at every level', () => {
    const black = from('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')
    for (const level of ['easy', 'normal', 'hard'] as const) {
      const m = choose(black, level, new Rng(3))
      expect(legalMoves(black.fen)).toContainEqual(expect.objectContaining(m))
    }
  })

  it('plays a whole computer-vs-computer game to a result', () => {
    const rng = new Rng(21)
    let pos = START
    let v = verdict(pos)
    while (v.winner === undefined) {
      const m = choose(pos, pos.fen.includes(' w ') ? 'easy' : 'normal', rng)
      pos = play(pos, m.from, m.to).pos
      v = verdict(pos)
      expect(pos.history.length).toBeLessThanOrEqual(MAX_PLIES)
    }
    expect(v.note).toBeDefined()
  }, 60_000)
})
