import type { Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import {
  apply,
  CARDS,
  type Deal,
  deal,
  destinationFor,
  draw,
  type Dst,
  home,
  isRed,
  pickable,
  rankOf,
  reveals,
  type Src,
  stacks,
  suitOf,
} from './rules.ts'

/** Seconds between the computer's actions (a play or a draw). */
export const PACE: Record<Difficulty, number> = { easy: 1.5, normal: 0.9, hard: 0.5 }

/** Random score added to each option: easier computers choose less well. */
const NOISE: Record<Difficulty, number> = { easy: 70, normal: 14, hard: 0 }

export type Action = { kind: 'draw' } | { kind: 'play'; src: Src; dst: Dst }

/**
 * Sending a card home is safe when no card of the other colour could still
 * need it to stack on: both foundations of the other colour are at least one
 * rank below it (aces and twos are always safe).
 */
function safeHome(d: Deal, card: number): boolean {
  const r = rankOf(card)
  if (r <= 2) return true
  const red = isRed(card)
  let low = 13
  for (let s = 0; s < 4; s++) if ((s === 1 || s === 2) !== red) low = Math.min(low, d.found[s] ?? 0)
  return low >= r - 1
}

/** A king the deck or waste can deliver to an empty column. */
function kingWaiting(d: Deal): boolean {
  return d.stock.some((c) => rankOf(c) === 13) || d.waste.some((c) => rankOf(c) === 13)
}

/**
 * How good a play is, or null when it is pointless (shuffling a run between
 * two equal parents). Looks one move ahead: a run lifted off a face-up card is
 * only worth it when the card it uncovers can then go home or take the waste.
 */
function value(d: Deal, src: Src, dst: Dst): number | null {
  if (dst.to === 'found') {
    const card =
      src.from === 'waste'
        ? (d.waste[d.waste.length - 1] as number)
        : ((d.tab[src.col] ?? [])[src.idx] as number)
    return safeHome(d, card) ? 100 : 48
  }
  if (src.from === 'waste') return 40
  const down = d.down[src.col] ?? 0
  if (reveals(d, src)) return 60 + down * 3
  if (src.idx === 0) {
    // Emptying a column only helps when a king is waiting for it.
    return kingWaiting(d) ? 22 : null
  }
  // The run sits on its parent: lifting it pays only if the uncovered card goes somewhere.
  const under = (d.tab[src.col] ?? [])[src.idx - 1] as number
  if ((d.found[suitOf(under)] ?? 0) === rankOf(under) - 1) return 70
  const w = d.waste[d.waste.length - 1]
  if (w !== undefined && stacks(w, under)) return 30
  return null
}

/**
 * The computer's next action. Foundation plays first (unsafe ones a little
 * later), then plays that turn a hidden card face up (the deepest column
 * first), then waste plays, then useful column moves. Turning the stock is
 * worth a little, so the waste keeps moving. Null when there is nothing left to do.
 */
export function chooseAction(d: Deal, level: Difficulty, rng: Rng): Action | null {
  let best: Action | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const src of pickable(d)) {
    const dst = destinationFor(d, src)
    if (!dst) continue
    const base = value(d, src, dst)
    if (base === null) continue
    const score = base + rng.range(0, NOISE[level])
    if (score > bestScore) {
      bestScore = score
      best = { kind: 'play', src, dst }
    }
  }
  if (d.stock.length || d.waste.length) {
    const score = 10 + rng.range(0, NOISE[level])
    if (score > bestScore) best = { kind: 'draw' }
  }
  return best
}

/** Does the best computer clear this deal on its own (within `steps` actions)? */
export function clears(d: Deal, steps = 700): boolean {
  const rng = new Rng(1)
  let b = d
  let idle = 0
  for (let i = 0; i < steps && home(b) < CARDS; i++) {
    const act = chooseAction(b, 'hard', rng)
    if (!act) return false
    if (act.kind === 'draw') {
      const n = draw(b)
      if (!n) return false
      b = n
      // A full turn of the deck with nothing played: it is going nowhere.
      if (++idle > b.stock.length + b.waste.length + 2) return false
    } else {
      b = apply(b, act.src, act.dst)
      idle = 0
    }
  }
  return home(b) === CARDS
}

/**
 * The deal for a race: the first of a run of shuffles derived from `seed` that
 * can be cleared, so nobody races on a dead deal. Same seed, same deal on both
 * phones. Falls back to the plain shuffle if none of the tries clears.
 */
export function playableDeal(seed: number, tries = 80): Deal {
  for (let i = 0; i < tries; i++) {
    const d = deal(seed + i * 7919)
    if (clears(d)) return d
  }
  return deal(seed)
}
