import { Chess } from 'chess.js'
import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { fromFen, keyOf, make, nameOf, fromOf, rootScores, toOf, unmake } from './engine.ts'
import type { Pos, Step } from './rules.ts'

/**
 * The computer player: the fast engine in engine.ts (α-β with iterative
 * deepening, quiescence, move ordering) under a node budget, so an answer is
 * quick and the same on every device; `ai.ts` runs it in a Web Worker.
 * Easy reads two plies, adds a lot of noise and now and then plays any move;
 * normal reads three with a little noise; hard reads as deep as its budget goes
 * (usually six to eight plies plus captures) and plays its best.
 */

const LEVEL: Record<Difficulty, { depth: number; budget: number; noise: number; random: number }> =
  {
    easy: { depth: 2, budget: 4000, noise: 160, random: 0.12 },
    normal: { depth: 3, budget: 30000, noise: 25, random: 0 },
    hard: { depth: 12, budget: 250000, noise: 0, random: 0 },
  }

/** What a repetition draw costs the computer, in centipawns: it would rather play on. */
const CONTEMPT = 40

/** A position without its move clocks or en passant, as repetition counts it here. */
const key = (k: string) => k.slice(0, -2)

/** Every position the game has passed through. */
function positionsSeen(history: readonly string[], start?: string): Set<string> {
  const c = new Chess(start)
  const out = new Set([key(keyOf(fromFen(c.fen())))])
  for (const san of history) {
    c.move(san)
    out.add(key(keyOf(fromFen(c.fen()))))
  }
  return out
}

/** Best move for the side to move in `pos`. Always a legal move (promotions are queens). */
export function choose(pos: Pos, difficulty: Difficulty, rng: Rng): Step {
  const lv = LEVEL[difficulty]
  const e = fromFen(pos.fen)
  const seen = positionsSeen(pos.history, pos.start)
  // Going back to a position already seen heads for a repetition draw: worth a
  // little less than level, so the computer plays on unless it is worse off.
  const avoid = (m: number) => {
    make(e, m)
    const k = key(keyOf(e))
    unmake(e)
    return seen.has(k)
  }
  const scored = rootScores(e, lv.depth, lv.budget, avoid, CONTEMPT)
  let pick = scored[0]?.move
  if (scored.length && lv.random > 0 && rng.chance(lv.random)) pick = rng.pick(scored).move
  else if (scored.length && lv.noise > 0) {
    let best = -Infinity
    for (const s of scored) {
      const v = s.score + rng.range(-lv.noise, lv.noise)
      if (v > best) {
        best = v
        pick = s.move
      }
    }
  } else {
    // Ties at the top broken at random so the computer is not predictable.
    const top = scored.filter((s) => s.score === scored[0]?.score)
    if (top.length > 1) pick = rng.pick(top).move
  }
  if (pick === undefined) {
    const any = new Chess(pos.fen).moves({ verbose: true })[0]
    return { from: any?.from ?? 'a1', to: any?.to ?? 'a1' }
  }
  const from = nameOf(fromOf(pick))
  const to = nameOf(toOf(pick))
  const piece = e.b[fromOf(pick)] as number
  const promo = (piece & 7) === 1 && (to[1] === '8' || to[1] === '1')
  return promo ? { from, to, promotion: 'q' } : { from, to }
}
