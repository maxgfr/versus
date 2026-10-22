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

/** Seconds between the computer's actions (a play or a draw): never faster than a quick human. */
export const PACE: Record<Difficulty, number> = { easy: 1.6, normal: 0.75, hard: 0.5 }

/** Random score added to each option: easier computers choose less well. */
const NOISE: Record<Difficulty, number> = { easy: 70, normal: 8, hard: 0 }

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

/**
 * A king a player can see that would use an empty column: on the waste, or
 * face up on hidden cards in a column. The face-down stock is never looked at.
 */
function kingWaiting(d: Deal): boolean {
  if (d.waste.some((c) => rankOf(c) === 13)) return true
  for (let c = 0; c < d.tab.length; c++) {
    const down = d.down[c] ?? 0
    const card = (d.tab[c] ?? [])[down]
    if (down > 0 && card !== undefined && rankOf(card) === 13) return true
  }
  return false
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
 * Only what a player sees is used: face-down cards stay unknown.
 */
export function chooseAction(d: Deal, level: Difficulty, rng: Rng): Action | null {
  return choose(d, NOISE[level], rng)
}

/** `chooseAction` with a given amount of noise (0 = the best the computer can do). */
function choose(d: Deal, noise: number, rng: Rng): Action | null {
  let best: Action | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const src of pickable(d)) {
    const dst = destinationFor(d, src)
    if (!dst) continue
    const base = value(d, src, dst)
    if (base === null) continue
    const score = base + rng.range(0, noise)
    if (score > bestScore) {
      bestScore = score
      best = { kind: 'play', src, dst }
    }
  }
  if (d.stock.length || d.waste.length) {
    const score = 10 + rng.range(0, noise)
    if (score > bestScore) best = { kind: 'draw' }
  }
  return best
}

/**
 * Actions the best computer takes to clear this deal (plays and draws), or -1
 * when it cannot (within `steps` actions).
 */
export function clearIn(d: Deal, steps = 700): number {
  const rng = new Rng(1)
  let b = d
  let idle = 0
  for (let i = 0; i < steps; i++) {
    if (home(b) === CARDS) return i
    const act = choose(b, 0, rng)
    if (!act) return -1
    if (act.kind === 'draw') {
      const n = draw(b)
      if (!n) return -1
      b = n
      // A full turn of the deck with nothing played: it is going nowhere.
      if (++idle > b.stock.length + b.waste.length + 2) return -1
    } else {
      b = apply(b, act.src, act.dst)
      idle = 0
    }
  }
  return home(b) === CARDS ? steps : -1
}

/** Does the best computer clear this deal on its own? */
export const clears = (d: Deal): boolean => clearIn(d) >= 0

/**
 * How tough a clearable deal is, by how long careful play needs to clear it
 * (more trips through the deck, deeper digging): 0 short, 1 medium, 2 long.
 * -1: the best computer cannot clear it.
 */
export function dealTier(d: Deal): number {
  const n = clearIn(d)
  if (n < 0) return -1
  return n <= 122 ? 0 : n <= 134 ? 1 : 2
}

/** The deal tier of a level, and of a later round of a match (a step tougher every two rounds). */
export function tierFor(level: Difficulty, round: number): number {
  const base = level === 'easy' ? 0 : level === 'normal' ? 1 : 2
  return Math.min(2, base + Math.floor(round / 2))
}

/**
 * The deal for a race: the first of a run of shuffles derived from `seed` that
 * the computer can clear and that is as tough as `tier` asks, so nobody races
 * on a dead deal. Same seed, same deal on both phones. Falls back to the
 * closest tier it saw, then to the plain shuffle.
 */
export function playableDeal(seed: number, tier = 1, tries = 120): Deal {
  let best: Deal | null = null
  let bestGap = 9
  for (let i = 0; i < tries; i++) {
    const d = deal(seed + i * 7919)
    const t = dealTier(d)
    if (t < 0) continue
    if (t === tier) return d
    if (Math.abs(t - tier) < bestGap) {
      bestGap = Math.abs(t - tier)
      best = d
    }
  }
  return best ?? deal(seed)
}
