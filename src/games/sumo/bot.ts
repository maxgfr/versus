import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { RING, type Pt, type Target, WRESTLER_R, type Wrestler } from './rules.ts'

/** How a bot reads the bout: how often it re-thinks, how loose its aim is, how eagerly it dashes. */
const TUNE: Record<Difficulty, { react: number; noise: number; dash: number; edge: number }> = {
  easy: { react: 0.35, noise: 70, dash: 0.1, edge: 0.6 },
  normal: { react: 0.2, noise: 28, dash: 0.25, edge: 0.7 },
  hard: { react: 0.1, noise: 8, dash: 0.4, edge: 0.76 },
}

/** Per bot wrestler: the target it is steering to, the next time it thinks, and a dash it has decided on. */
export interface BotMem {
  next: number
  target: Target
  dashNow: boolean
}

export const newMem = (): BotMem => ({ next: 0, target: null, dashNow: false })

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * The steering of one bot wrestler. Charge the nearest rival through the
 * middle; if the rival is near the edge, drive through it toward the edge; if
 * this wrestler is near the edge itself, go back to the centre. Re-thought every
 * few hundred milliseconds, with the aim error of the difficulty.
 */
export function steer(
  w: readonly Wrestler[],
  k: number,
  side: Side,
  time: number,
  ring: number,
  d: Difficulty,
  rng: Rng,
  mem: BotMem,
): { target: Target; dash: boolean } {
  const tune = TUNE[d]
  if (time >= mem.next) {
    const me = w[k] as Wrestler
    const rivals = w.filter((o) => o.side !== side)
    let rival = rivals[0]
    for (const r of rivals) if (rival === undefined || dist(me, r) < dist(me, rival)) rival = r
    const centre = { x: RING.x, y: RING.y }
    let target: Pt = centre
    if (dist(me, centre) > ring * tune.edge) {
      target = centre
    } else if (rival) {
      const fromC = dist(rival, centre)
      const ux = (rival.x - centre.x) / (fromC || 1)
      const uy = (rival.y - centre.y) / (fromC || 1)
      // Drive through the rival: aim just beyond it, so the shove goes outward.
      const push = 100
      target = {
        x: rival.x + ux * push + rival.vx * 0.25,
        y: rival.y + uy * push + rival.vy * 0.25,
      }
    }
    mem.target = {
      x: target.x + (rng.next() - 0.5) * 2 * tune.noise,
      y: target.y + (rng.next() - 0.5) * 2 * tune.noise,
    }
    const inReach = rival !== undefined && dist(me, rival) < WRESTLER_R * 2.7
    mem.dashNow = inReach && time >= me.cool && rng.chance(tune.dash)
    mem.next = time + tune.react * (0.7 + rng.next() * 0.6)
  }
  const dash = mem.dashNow
  mem.dashNow = false
  return { target: mem.target, dash }
}
