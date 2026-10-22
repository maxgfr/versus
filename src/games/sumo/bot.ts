import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { RING, type Pt, type Target, WRESTLER_R, type Wrestler } from './rules.ts'

/** How a bot reads the bout. */
interface Tune {
  /** Seconds between re-thinks. */
  react: number
  /** Aim error (± units). */
  noise: number
  /** Chance it dashes when a dash would land. */
  dash: number
  /** Share of the ring past which it heads back to the middle. */
  edge: number
  /** Takes the inside line (between the rival and the middle) before it charges. */
  inside: boolean
  /** Sidesteps a rival charging at it near the edge. */
  dodge: boolean
  /** How hard it dashes (0..1). */
  power: number
}

const TUNE: Record<Difficulty, Tune> = {
  easy: { react: 0.35, noise: 70, dash: 0.1, edge: 0.6, inside: false, dodge: false, power: 0.45 },
  normal: {
    react: 0.14,
    noise: 16,
    dash: 0.45,
    edge: 0.72,
    inside: true,
    dodge: false,
    power: 0.75,
  },
  hard: { react: 0.06, noise: 4, dash: 0.8, edge: 0.78, inside: true, dodge: true, power: 1 },
}

/** Per bot wrestler: the target it is steering to, the next time it thinks, and a dash it has decided on. */
export interface BotMem {
  next: number
  target: Target
  dashNow: number
}

export const newMem = (): BotMem => ({ next: 0, target: null, dashNow: 0 })

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * The steering of one bot wrestler. Near the edge it heads back to the
 * middle. Otherwise it charges the nearest rival through the middle, driving
 * just beyond it so the shove goes outward. Normal and hard first win the
 * inside line (so the shove points at the edge) and dash only when the rival
 * stands between them and the edge; hard also sidesteps a rival charging at it
 * near the edge. Re-thought every few tens of milliseconds, with the aim error
 * of the difficulty.
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
): { target: Target; dash: number } {
  const tune = TUNE[d]
  if (time >= mem.next) {
    const me = w[k] as Wrestler
    const rivals = w.filter((o) => o.side !== side)
    let rival = rivals[0]
    for (const r of rivals) if (rival === undefined || dist(me, r) < dist(me, rival)) rival = r
    const centre = { x: RING.x, y: RING.y }
    const out = dist(me, centre)
    let target: Pt = centre
    mem.dashNow = 0
    if (out > ring * tune.edge) {
      target = centre
    } else if (rival) {
      const fromC = dist(rival, centre)
      const ux = (rival.x - centre.x) / (fromC || 1)
      const uy = (rival.y - centre.y) / (fromC || 1)
      const gap = dist(me, rival)
      // Is the rival charging at me? (its velocity along the line to me)
      const toMe = ((me.x - rival.x) * rival.vx + (me.y - rival.y) * rival.vy) / (gap || 1)
      if (tune.dodge && toMe > 450 && out > ring * 0.4 && gap < WRESTLER_R * 4) {
        // Step aside, toward the middle, and let it fly past.
        const px = -(rival.y - me.y) / (gap || 1)
        const py = (rival.x - me.x) / (gap || 1)
        const s = px * (centre.x - me.x) + py * (centre.y - me.y) >= 0 ? 1 : -1
        target = { x: me.x + px * s * 220, y: me.y + py * s * 220 }
      } else if (tune.inside && out > fromC - WRESTLER_R * 0.3 && gap > WRESTLER_R * 2.4) {
        // Take the inside line first: just on the middle's side of the rival.
        const r = Math.max(0, fromC - WRESTLER_R * 2.3)
        target = { x: centre.x + ux * r, y: centre.y + uy * r }
      } else {
        // Drive through the rival: aim just beyond it, so the shove goes outward.
        const push = 100
        target = {
          x: rival.x + ux * push + rival.vx * 0.25,
          y: rival.y + uy * push + rival.vy * 0.25,
        }
        const inReach = gap < WRESTLER_R * 2.7
        // A dash lands when the rival is between me and the edge.
        const lined = (rival.x - me.x) * ux + (rival.y - me.y) * uy > 0
        if (inReach && time >= me.cool && (lined || !tune.inside) && rng.chance(tune.dash))
          mem.dashNow = tune.power
      }
    }
    mem.target = {
      x: target.x + (rng.next() - 0.5) * 2 * tune.noise,
      y: target.y + (rng.next() - 0.5) * 2 * tune.noise,
    }
    mem.next = time + tune.react * (0.7 + rng.next() * 0.6)
  }
  const dash = mem.dashNow
  mem.dashNow = 0
  return { target: mem.target, dash }
}
