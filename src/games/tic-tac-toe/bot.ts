import type { Difficulty, Side } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { bestMove, type SearchSpec } from '../../engines/board/index.ts'
import { type Cell, lineWinner, moves, outcome, place } from './rules.ts'

interface Pos {
  cells: Cell[]
  turn: Side
}

const spec: SearchSpec<Pos, number> = {
  moves: (s) => moves(s.cells),
  play: (s, m) => ({ cells: place(s.cells, m, s.turn), turn: other(s.turn) }),
  over: (s) => outcome(s.cells) !== null,
  turn: (s) => s.turn,
  evaluate: (s, side) => {
    const w = lineWinner(s.cells)
    if (!w) return 0
    // Prefer quicker wins and slower losses.
    const empties = moves(s.cells).length
    return (w.side === side ? 10 : -10) * (1 + empties)
  },
}

/** Move that completes three for `side`, if any. */
function finishing(cells: Cell[], side: Side): number | undefined {
  return moves(cells).find((m) => lineWinner(place(cells, m, side))?.side === side)
}

export function choose(cells: Cell[], side: Side, difficulty: Difficulty, rng: Rng): number {
  const legal = moves(cells)
  const random = () => rng.pick(legal)
  const perfect = () =>
    bestMove(spec, { cells, turn: side }, 9, (n) => rng.int(0, n - 1)) ?? random()
  if (difficulty === 'hard') return perfect()
  const win = finishing(cells, side)
  if (win !== undefined && (difficulty === 'normal' || rng.chance(0.6))) return win
  const block = finishing(cells, other(side))
  if (block !== undefined && (difficulty === 'normal' ? rng.chance(0.9) : rng.chance(0.4)))
    return block
  if (difficulty === 'normal' && rng.chance(0.5)) return perfect()
  return random()
}
