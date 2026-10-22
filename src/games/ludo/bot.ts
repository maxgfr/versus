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

/** What a move is worth on its own: captures, leaving base, getting home, progress, and safety. */
function worth(tok: Tokens, side: Side, i: number, face: number): { score: number; after: Tokens } {
  const from = tok[side][i] ?? BASE
  const r = step(tok, side, i, face)
  const captureGain = r.captured.reduce((a, [o, j]) => a + 25 + value(tok[o][j] ?? BASE), 0)
  const before = risk(tok, side, from) * value(from)
  const after = risk(r.tok, side, r.to) * value(r.to)
  const score =
    captureGain +
    (from === BASE ? 18 : 0) +
    (r.to === FINISH ? 40 : 0) +
    (r.to >= TRACK ? 8 : 0) +
    (r.to - from) * 0.5 +
    before -
    after
  return { score, after: r.tok }
}

/**
 * What the rival's next roll is expected to cost `side`: for each face, the
 * rival plays its best answer, and the pawns of ours it would send back count.
 */
function threat(tok: Tokens, side: Side): number {
  const rival: Side = side === 0 ? 1 : 0
  let total = 0
  for (let face = 1; face <= 6; face++) {
    let worst = 0
    for (const j of legalTokens(tok, rival, face)) {
      const r = step(tok, rival, j, face)
      let loss = 0
      for (const [o, k] of r.captured) if (o === side) loss += 25 + value(tok[side][k] ?? BASE)
      if (loss > worst) worst = loss
    }
    total += worst
  }
  return total / 6
}

/**
 * Which token to move with `face`. Easy plays at random. Normal weighs each
 * move by captures, progress and the change in risk to its tokens. Hard also
 * plays out every face of the rival's next roll and its best answer to each,
 * and keeps the move that leaves it least exposed (and, on a six, the follow-up
 * roll is its own).
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
  if (difficulty === 'easy') return rng.pick(legal)
  let best = fallback
  let bestScore = -Infinity
  for (const i of legal) {
    const w = worth(tok, side, i, face)
    // A six rolls again before the rival can answer: the danger waits a turn.
    const score = difficulty === 'hard' && face !== 6 ? w.score - threat(w.after, side) : w.score
    const v = score + rng.range(0, 0.01)
    if (v > bestScore) {
      bestScore = v
      best = i
    }
  }
  return best
}
