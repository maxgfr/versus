import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  BASE,
  FINISH,
  legalTokens,
  SAFE,
  step,
  TRACK,
  trackOf,
  type Tokens,
  START,
} from './rules.ts'

/** Worth of a token at progress `prog`: advanced tokens are worth more to lose. */
export function value(prog: number): number {
  return prog < 0 ? 0 : 20 + prog * 1.5
}

/**
 * Chance that a token on `prog` is captured on the rivals' next roll. Each
 * rival sitting 1–6 squares behind it can hit it with one face of the die, so
 * the risk is 1 − (5/6)^threats. Safe squares, base and home are never at risk.
 */
export function risk(tok: Tokens, side: Side, prog: number): number {
  const cell = trackOf(side, prog)
  if (cell === null || SAFE.has(cell)) return 0
  const rival: Side = side === 0 ? 1 : 0
  let threats = 0
  for (const r of tok[rival]) {
    if (r < 0 || r >= TRACK) continue
    const need = ((cell - START[rival] + TRACK) % TRACK) - r
    if (need >= 1 && need <= 6) threats++
  }
  return 1 - (5 / 6) ** threats
}

/**
 * Which token to move with `face`. Easy plays at random. Normal takes a capture
 * first, then leaving base, then the furthest move that lands safe. Hard
 * weighs each move by captures, progress and the change in risk to its tokens.
 */
export function choose(
  tok: Tokens,
  side: Side,
  face: number,
  difficulty: Difficulty,
  rng: Rng,
): number {
  const legal = legalTokens(tok, side, face)
  const fallback = legal[0] ?? 0
  if (legal.length <= 1) return fallback
  if (difficulty === 'easy' || (difficulty === 'normal' && rng.chance(0.08))) return rng.pick(legal)
  let best = fallback
  let bestScore = -Infinity
  for (const i of legal) {
    const from = tok[side][i] ?? BASE
    const r = step(tok, side, i, face)
    let score: number
    if (difficulty === 'normal') {
      const safe = risk(r.tok, side, r.to) === 0
      score =
        (r.captured.length > 0 ? 1e9 : 0) + (from === BASE ? 1e8 : 0) + (safe ? 1e7 : 0) + r.to
    } else {
      const captureGain = r.captured.reduce((a, [o, j]) => a + 25 + value(tok[o][j] ?? BASE), 0)
      const before = risk(tok, side, from) * value(from)
      const after = risk(r.tok, side, r.to) * value(r.to)
      score =
        captureGain +
        (from === BASE ? 18 : 0) +
        (r.to === FINISH ? 40 : 0) +
        (r.to >= TRACK ? 8 : 0) +
        (r.to - from) * 0.5 +
        before -
        after
    }
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}
