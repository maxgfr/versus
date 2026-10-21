import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import { predictX } from '../../engines/puck/index.ts'
import { homeOf, MALLET_R, PUCK_R, RINK, type Target, type World } from './rules.ts'

interface Tuning {
  speed: number
  /** Seconds between decisions: slower bots react late. */
  react: number
  /** Aim error (world units) on the attack point. */
  noise: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { speed: 1150, react: 0.22, noise: 140 },
  normal: { speed: 1900, react: 0.1, noise: 60 },
  hard: { speed: 2900, react: 0.03, noise: 18 },
}

/** Per-bot memory carried between steps (not part of the synced state). */
export interface BotMemory {
  wait: number
  targets: Target[]
  aimX: number
}

export const newMemory = (): BotMemory => ({ wait: 0, targets: [], aimX: W / 2 })

/** Decide targets for every mallet of `side`. Indices match `w.mallets`. */
export function decide(
  w: World,
  side: Side,
  d: Difficulty,
  rng: Rng,
  mem: BotMemory,
  dt: number,
): Target[] {
  const tune = TUNING[d]
  mem.wait -= dt
  if (mem.wait > 0 && mem.targets.length) return mem.targets
  mem.wait = tune.react * (0.7 + rng.next() * 0.6)
  const p = w.puck
  const fwd = side === 1 ? 1 : -1
  const mine = side === 1 ? p.y < MID : p.y > MID
  const towardMe = p.vy * fwd < -150
  const goalY = side === 1 ? RINK.y1 + 60 : RINK.y0 - 60
  if (rng.next() < 0.15) mem.aimX = W / 2 + (rng.next() - 0.5) * 2 * tune.noise
  const out: Target[] = w.mallets.map((m) => {
    if (m.side !== side) return null
    const home = homeOf(side, m.lane)
    const inLane = m.lane === undefined || (m.lane === 0 ? p.x < W / 2 + 60 : p.x > W / 2 - 60)
    if (w.phase === 'goal') return home
    if (towardMe && !(mine && inLane && Math.abs(p.y - home.y) > 260)) {
      const x = predictX(p, home.y, RINK, 2) ?? p.x
      return { x: x + (rng.next() - 0.5) * tune.noise * 0.5, y: home.y }
    }
    if (mine && inLane) {
      // Attack: approach from behind the puck along the line to the rival goal.
      const ax = mem.aimX - p.x
      const ay = goalY - p.y
      const al = Math.hypot(ax, ay) || 1
      const ux = ax / al
      const uy = ay / al
      const rel = (m.x - p.x) * ux + (m.y - p.y) * uy
      const reach = PUCK_R + MALLET_R
      if (rel < -reach * 0.4) return { x: p.x + ux * 90, y: p.y + uy * 90 }
      // Wrong side of the puck: circle back behind it, sidestepping.
      const side2 = (m.x - p.x) * uy - (m.y - p.y) * ux > 0 ? 1 : -1
      return {
        x: p.x - ux * (reach + 40) + uy * side2 * reach * 0.8,
        y: p.y - uy * (reach + 40) - ux * side2 * reach * 0.8,
      }
    }
    // Defend: shade toward the puck's x, sitting in front of the goal.
    return { x: W / 2 + (p.x - W / 2) * 0.45, y: home.y }
  })
  mem.targets = out
  return out
}
