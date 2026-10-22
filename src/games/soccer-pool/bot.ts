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
  /** Points of the rival goal mouth it tries to drive the ball at (offsets from the centre). */
  aims: readonly number[]
  /** Whether it weighs where the ball ends up (and the danger to its own goal), not just the chance. */
  safe: boolean
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { angle: 0.2, power: 0.2, think: 1.2, refine: 0, aims: [-120, 0, 120], safe: false },
  normal: { angle: 0.045, power: 0.05, think: 0.8, refine: 2, aims: [-120, 0, 120], safe: true },
  hard: {
    angle: 0.008,
    power: 0.015,
    think: 0.5,
    refine: 3,
    aims: [-150, -75, 0, 75, 150],
    safe: true,
  },
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
 * is played forward with the real rules. A goal wins outright (the search stops
 * there) and an own goal is never chosen; otherwise easy goes for the closest
 * chance, while normal and hard also weigh where the ball comes to rest: deep in
 * the rival half is good, loose in front of their own goal (a gift for the
 * rival's next shot) is bad. Then a few rounds of finer turns and power steps
 * around the best two.
 *
 * A generator: it yields after every trial so the game can spread the search
 * over the bot's thinking time instead of freezing a frame. `choose` runs it
 * to the end in one go.
 */
export function* plan(w: World, side: Side, d: Difficulty, rng: Rng): Generator<void, Pick> {
  const tune = TUNING[d]
  const goal = attackPoint(side)
  const own = attackPoint(side === 0 ? 1 : 0)
  const b = w.ball
  const aims = tune.aims.map((o) => ({ x: W / 2 + o, y: goal.y }))
  const test = (disc: number, dx: number, dy: number, power: number): Cand => {
    const r = trial(w, disc, dx, dy, power)
    if (r.goal !== null) return { disc, dx, dy, power, score: r.goal === side ? 1e6 : -1e6 }
    if (!tune.safe) return { disc, dx, dy, power, score: -r.near }
    const rest = Math.hypot(r.x - goal.x, r.y - goal.y)
    const danger = Math.max(0, 700 - Math.hypot(r.x - own.x, r.y - own.y))
    return { disc, dx, dy, power, score: -(r.near * 0.55 + rest * 0.45) - danger * 1.4 }
  }
  // Every first-round shot, as (disc, direction, power).
  const shots: [number, number, number, number][] = []
  for (const i of ownDiscs(w, side)) {
    const p = w.discs[i]
    if (!p) continue
    const [bx, by] = unit(b.x - p.x, b.y - p.y)
    shots.push([i, bx, by, 1], [i, bx, by, 0.6])
    for (const g of aims) {
      const [gx, gy] = unit(g.x - b.x, g.y - b.y)
      // Strike point: just behind the ball, on the line from the goal through it.
      // Kept on the pitch, so the disc can actually reach it.
      const sx = clamp(b.x - gx * (BALL_R + DISC_R - 6), RINK.x0 + DISC_R, RINK.x1 - DISC_R)
      const sy = clamp(b.y - gy * (BALL_R + DISC_R - 6), RINK.y0 + DISC_R, RINK.y1 - DISC_R)
      const [dx, dy] = unit(sx - p.x, sy - p.y)
      for (const power of [0.6, 0.85, 1]) shots.push([i, dx, dy, power])
    }
  }
  const cands: Cand[] = []
  let scored = false
  for (const [i, dx, dy, power] of shots) {
    const c = test(i, dx, dy, power)
    cands.push(c)
    yield
    if (c.score >= 1e6) {
      scored = true
      break
    }
  }
  cands.sort((a, c) => c.score - a.score)
  let best = cands[0]
  if (!best) return { disc: ownDiscs(w, side)[0] ?? 0, dx: 0, dy: -1, power: 0.5 }
  // Refine around the best two, each round finer than the last.
  let seeds = cands.slice(0, 2)
  for (let r = 0; r < tune.refine && !scored; r++) {
    const da = 0.06 / (r + 1)
    const dp = 0.08 / (r + 1)
    const next: Cand[] = []
    for (const s of seeds) {
      const base = Math.atan2(s.dy, s.dx)
      for (const a of [base - da, base + da]) {
        for (const pw of [s.power - dp, s.power + dp]) {
          const c = test(s.disc, Math.cos(a), Math.sin(a), Math.min(1, Math.max(0.1, pw)))
          next.push(c)
          if (c.score > best.score) best = c
          yield
        }
      }
    }
    next.sort((a, c) => c.score - a.score)
    seeds = [best, ...next.filter((c) => c !== best)].slice(0, 2)
  }
  // Execution error: the flick never lands exactly where it was aimed.
  const ang = Math.atan2(best.dy, best.dx) + (rng.next() * 2 - 1) * tune.angle
  const power = Math.min(1, Math.max(0.08, best.power * (1 + (rng.next() * 2 - 1) * tune.power)))
  return { disc: best.disc, dx: Math.cos(ang), dy: Math.sin(ang), power }
}

/** Run the whole search at once (tests, simulations). */
export function choose(w: World, side: Side, d: Difficulty, rng: Rng): Pick {
  const it = plan(w, side, d, rng)
  for (;;) {
    const r = it.next()
    if (r.done) return r.value
  }
}
