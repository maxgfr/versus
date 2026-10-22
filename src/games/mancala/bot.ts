import type { Difficulty, Side } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { apply, isOver, legalPits, type Position, STORE } from './rules.ts'

/**
 * How each level plays: search depth in moves (an extra turn counts as a move),
 * and how often it simply grabs a random pit instead. Easy only sees its own
 * next move and slips now and then; hard reads deep.
 */
const LEVEL: Record<Difficulty, { depth: number; slip: number }> = {
  easy: { depth: 1, slip: 0.3 },
  normal: { depth: 6, slip: 0 },
  hard: { depth: 12, slip: 0 },
}

/** Seeds on a side end up in that side's store when the board empties: worth a little. */
const SIDE_W = 0.25

function sideSum(pits: readonly number[], side: Side): number {
  const from = side === 0 ? 0 : 7
  let n = 0
  for (let i = from; i < from + 6; i++) n += pits[i] ?? 0
  return n
}

/** Score from `side`'s point of view: the store difference, and a little for seeds on each side. */
export function evaluate(p: Position, side: Side): number {
  const o = other(side)
  const stores = (p.pits[STORE[side]] ?? 0) - (p.pits[STORE[o]] ?? 0)
  if (isOver(p.pits)) return stores * 1000
  return stores + SIDE_W * (sideSum(p.pits, side) - sideSum(p.pits, o))
}

/** Moves worth looking at first: a sowing that ends in the store (another turn), then the rest, right to left. */
function ordered(p: Position): number[] {
  const store = STORE[p.turn]
  const moves = legalPits(p)
  const again: number[] = []
  const rest: number[] = []
  for (const m of moves) {
    if ((p.pits[m] ?? 0) === store - m) again.push(m)
    else rest.push(m)
  }
  // Pits nearest the store first: an extra turn from there leaves the others free.
  again.sort((a, b) => b - a)
  rest.sort((a, b) => b - a)
  return again.concat(rest)
}

/** Negamax with α-β; a move that keeps the turn is not negated. */
function search(p: Position, depth: number, a: number, b: number): number {
  if (depth === 0 || isOver(p.pits)) return evaluate(p, p.turn)
  let best = -Infinity
  for (const m of ordered(p)) {
    const next = apply(p, m)
    const v =
      next.turn === p.turn ? search(next, depth - 1, a, b) : -search(next, depth - 1, -b, -a)
    if (v > best) best = v
    if (best > a) a = best
    if (a >= b) break
  }
  return best
}

/** The pit the computer sows from. Ties between equally good pits are broken at random. */
export function choose(p: Position, difficulty: Difficulty, rng: Rng): number {
  const legal = legalPits(p)
  const lv = LEVEL[difficulty]
  if (lv.slip > 0 && rng.chance(lv.slip)) return rng.pick(legal)
  let best = -Infinity
  let ties: number[] = []
  for (const m of ordered(p)) {
    const next = apply(p, m)
    const v =
      next.turn === p.turn
        ? search(next, lv.depth - 1, -Infinity, Infinity)
        : -search(next, lv.depth - 1, -Infinity, Infinity)
    if (v > best + 1e-9) {
      best = v
      ties = [m]
    } else if (Math.abs(v - best) <= 1e-9) ties.push(m)
  }
  return ties.length ? (ties[rng.int(0, ties.length - 1)] as number) : rng.pick(legal)
}

/** Worker entry (see ai.ts): the same choice from a plain position and a seed. */
export function chooseSeeded(p: Position, difficulty: Difficulty, seed: number): number {
  return choose(p, difficulty, new Rng(seed))
}
