import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { W } from '../../core/stage.ts'
import { BALL_R, DISC_R, RINK, attackPoint, ownDiscs, trial, type World } from './rules.ts'

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

interface Tuning {
  /** Angular error on the executed flick (radians, ±). */
  angle: number
  /** Relative power error (±). */
  power: number
  /** Seconds the computer "thinks" before it flicks. */
  think: number
  /** Local refinement rounds around the best candidate (more = better aim). */
  refine: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { angle: 0.2, power: 0.2, think: 1.2, refine: 0 },
  normal: { angle: 0.07, power: 0.08, think: 0.8, refine: 1 },
  hard: { angle: 0.015, power: 0.02, think: 0.5, refine: 2 },
}

export interface Pick {
  disc: number
  dx: number
  dy: number
  power: number
}

interface Cand extends Pick {
  score: number
}

const unit = (x: number, y: number): [number, number] => {
  const m = Math.hypot(x, y) || 1
  return [x / m, y / m]
}

/**
 * Best flick for `side` in the current position. Candidates aim each own disc
 * so that it strikes the ball toward several points of the rival goal mouth; each
 * is simulated, and the one that gets the ball closest to (or into) the goal wins.
 */
export function choose(w: World, side: Side, d: Difficulty, rng: Rng): Pick {
  const tune = TUNING[d]
  const goal = attackPoint(side)
  const b = w.ball
  const aims = [-120, 0, 120].map((o) => ({ x: W / 2 + o, y: goal.y }))
  const cands: Cand[] = []
  const test = (disc: number, dx: number, dy: number, power: number): Cand => {
    const r = trial(w, disc, dx, dy, power)
    const score = r.goal === side ? 1e6 : r.goal !== null ? -1e6 : -r.near
    return { disc, dx, dy, power, score }
  }
  for (const i of ownDiscs(w, side)) {
    const p = w.discs[i]
    if (!p) continue
    const [bx, by] = unit(b.x - p.x, b.y - p.y)
    cands.push(test(i, bx, by, 1), test(i, bx, by, 0.6))
    for (const g of aims) {
      const [gx, gy] = unit(g.x - b.x, g.y - b.y)
      // Strike point: just behind the ball, on the line from the goal through it.
      // Kept on the pitch, so the disc can actually reach it.
      const sx = clamp(b.x - gx * (BALL_R + DISC_R - 6), RINK.x0 + DISC_R, RINK.x1 - DISC_R)
      const sy = clamp(b.y - gy * (BALL_R + DISC_R - 6), RINK.y0 + DISC_R, RINK.y1 - DISC_R)
      const [dx, dy] = unit(sx - p.x, sy - p.y)
      for (const power of [0.6, 0.85, 1]) cands.push(test(i, dx, dy, power))
    }
  }
  cands.sort((a, c) => c.score - a.score)
  let best = cands[0]
  if (!best) return { disc: ownDiscs(w, side)[0] ?? 0, dx: 0, dy: -1, power: 0.5 }
  // Refine around the best few: small rotations and power steps.
  for (let r = 0; r < tune.refine; r++) {
    const seeds = cands.slice(0, 2)
    for (const s of seeds) {
      const base = Math.atan2(s.dy, s.dx)
      for (const da of [-0.06, 0.06]) {
        for (const dp of [-0.08, 0.08]) {
          const a = base + da
          const c = test(s.disc, Math.cos(a), Math.sin(a), Math.min(1, Math.max(0.1, s.power + dp)))
          if (c.score > best.score) best = c
        }
      }
    }
  }
  // Execution error: the flick never lands exactly where it was aimed.
  const ang = Math.atan2(best.dy, best.dx) + (rng.next() * 2 - 1) * tune.angle
  const power = Math.min(1, Math.max(0.08, best.power * (1 + (rng.next() * 2 - 1) * tune.power)))
  return { disc: best.disc, dx: Math.cos(ang), dy: Math.sin(ang), power }
}
