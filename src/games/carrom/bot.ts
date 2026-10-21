import type { Difficulty, Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import {
  type Board,
  BASE_X,
  CENTRE,
  BASE_Y,
  dist,
  DRAG,
  PIECE_R,
  POCKETS,
  type Outcome,
  simulate,
  STRIKER_R,
  VMAX,
} from './rules.ts'

/** Where the striker is set down and how it is flicked. */
export interface Shot {
  x: number
  dx: number
  dy: number
  power: number
}

/** How far a bot's placement (world units), aim (radians) and power wander. */
const ERR: Record<Difficulty, { x: number; ang: number; pow: number }> = {
  easy: { x: 14, ang: 0.012, pow: 0.04 },
  normal: { x: 5, ang: 0.005, pow: 0.015 },
  hard: { x: 0, ang: 0, pow: 0 },
}

interface Candidate {
  x: number
  dx: number
  dy: number
  /** Rough power for the piece to reach the pocket. */
  p0: number
  score: number
  /** Fixed powers to try (breaks); otherwise powers around `p0`. */
  powers: number[] | null
}

/** Distance from (px, py) to the segment (ax, ay)–(bx, by). */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

/**
 * Shots worth simulating. For each of the bot's pieces and each pocket: the
 * contact point that sends the piece in, and a baseline spot the striker can
 * reach it from. Clear lines rank first. A few break shots at the middle of the
 * board open the formation. The physics then judges every candidate.
 */
export function candidates(b: Board, side: Side): Candidate[] {
  const out: Candidate[] = []
  const own = b.pieces.filter((p) => p.owner === side)
  const xs: number[] = []
  for (let x = BASE_X.x0; x <= BASE_X.x1; x += 40) xs.push(x)
  const forward = side === 0 ? -1 : 1
  const sy = BASE_Y[side]
  const spotClear = (x: number) =>
    b.pieces.every((o) => dist(x, sy, o.x, o.y) >= STRIKER_R + PIECE_R + 4)
  for (const p of own) {
    for (const k of POCKETS) {
      const L = dist(p.x, p.y, k.x, k.y)
      if (L < 1) continue
      // Unit vector from the pocket through the piece: the striker meets it from the far side.
      const ux = (p.x - k.x) / L
      const uy = (p.y - k.y) / L
      const qx = p.x + ux * (PIECE_R + STRIKER_R)
      const qy = p.y + uy * (PIECE_R + STRIKER_R)
      const pathBlocked = !b.pieces.every(
        (o) => o === p || segDist(o.x, o.y, p.x, p.y, k.x, k.y) >= PIECE_R * 2 + 4,
      )
      for (const x of xs) {
        if ((qy - sy) * forward <= 0 || !spotClear(x)) continue
        const D = dist(x, sy, qx, qy)
        const runBlocked = !b.pieces.every(
          (o) => o === p || segDist(o.x, o.y, x, sy, qx, qy) >= STRIKER_R + PIECE_R + 4,
        )
        // Friction takes DRAG × distance off the striker's speed, and the hit passes
        // on about 1.2× of what is left: enough to carry the piece its whole way.
        const p0 = Math.min(1, Math.max(0.12, ((L * DRAG) / 1.2 + DRAG * D) / VMAX))
        const score = -(D * 0.5 + L * 0.4) - (pathBlocked ? 150 : 0) - (runBlocked ? 200 : 0)
        out.push({ x, dx: (qx - x) / D, dy: (qy - sy) / D, p0, score, powers: null })
      }
    }
  }
  out.sort((a, b) => b.score - a.score)
  const top = out.slice(0, 16)
  // Break shots: straight at the middle of the board, at a few strengths.
  for (let x = BASE_X.x0; x <= BASE_X.x1; x += 100) {
    if (!spotClear(x)) continue
    const D = dist(x, sy, CENTRE.x, CENTRE.y)
    top.push({
      x,
      dx: (CENTRE.x - x) / D,
      dy: (CENTRE.y - sy) / D,
      p0: 0.8,
      score: -1000,
      powers: [0.55, 0.75, 0.95],
    })
  }
  return top
}

/** A pot is worth most; a rival's piece or a foul is a loss. */
export function value(o: Outcome): number {
  if (o.foul) return -1200
  return o.own * 1000 - o.rival * 500 + (o.queen ? 350 : 0) - (o.own === 0 ? 40 : 0)
}

/** The bot's best shot, with the error of its difficulty. */
export function search(b: Board, d: Difficulty, rng: Rng): Shot {
  const side = b.turn
  let best: { c: Candidate; pow: number; v: number } | null = null
  for (const c of candidates(b, side)) {
    const powers = c.powers ?? [0.9, 1, 1.12].map((f) => c.p0 * f)
    for (const raw of powers) {
      const pow = Math.min(1, Math.max(0.1, raw))
      const v = value(simulate(b, c.x, c.dx, c.dy, pow))
      if (!best || v > best.v) best = { c, pow, v }
    }
  }
  const err = ERR[d]
  if (!best) {
    // Nothing clean: knock the nearest piece toward the centre, gently.
    const x = (BASE_X.x0 + BASE_X.x1) / 2 + (rng.next() - 0.5) * 2 * err.x
    const sy = BASE_Y[side]
    const target = b.pieces.reduce(
      (a, p) => (dist(p.x, p.y, x, sy) < dist(a.x, a.y, x, sy) ? p : a),
      b.pieces[0] ?? { x: 500, y: 900, vx: 0, vy: 0, r: PIECE_R, owner: 2 },
    )
    const len = Math.hypot(target.x - x, target.y - sy) || 1
    return { x, dx: (target.x - x) / len, dy: (target.y - sy) / len, power: 0.5 }
  }
  return {
    x: best.c.x + (rng.next() - 0.5) * 2 * err.x,
    dx: best.c.dx + (rng.next() - 0.5) * 2 * err.ang,
    dy: best.c.dy + (rng.next() - 0.5) * 2 * err.ang,
    power: Math.min(1, Math.max(0.05, best.pow * (1 + (rng.next() - 0.5) * 2 * err.pow))),
  }
}

/** Entry point for the bot (also used by the worker through ai.ts). */
export function choose(input: { board: Board }, d: Difficulty, seed: number): Shot {
  return search(input.board, d, new Rng(seed))
}
