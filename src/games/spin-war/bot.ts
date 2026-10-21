import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { BOWL, type Targets, type World } from './rules.ts'

interface Tuning {
  /** Seconds between spotting a target and charging it. */
  react: number
  /** How close an enemy must be before the bot charges. */
  range: number
  /** Aim error on the charge (world units). */
  noise: number
  /** Seconds of enemy motion the bot leads by. */
  lead: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { react: 0.8, range: 260, noise: 80, lead: 0 },
  normal: { react: 0.45, range: 340, noise: 35, lead: 0.2 },
  hard: { react: 0.2, range: 420, noise: 10, lead: 0.4 },
}

/** Per-bot memory, one slot per top (not synced). */
export interface BotMemory {
  timer: number[]
  noise: { x: number; y: number }[]
}

export const newMemory = (): BotMemory => ({ timer: [], noise: [] })

/**
 * Steering for every top of `side`. A top that has its spin charges the
 * nearest enemy after a reaction delay; otherwise it circles the middle and
 * keeps well away from the rim. Works for either side and for teams.
 */
export function decide(
  w: World,
  side: Side,
  d: Difficulty,
  rng: Rng,
  mem: BotMemory,
  dt: number,
): Targets {
  const tune = TUNING[d]
  const enemies = w.tops.filter((t) => t.side !== side && !t.out)
  return w.tops.map((top, i) => {
    if (top.side !== side || top.out || w.phase !== 'play') return null
    mem.timer[i] = (mem.timer[i] ?? 0) - dt
    const foe = enemies.reduce<(typeof enemies)[number] | null>((best, e) => {
      if (!best) return e
      const db = Math.hypot(best.x - top.x, best.y - top.y)
      const de = Math.hypot(e.x - top.x, e.y - top.y)
      return de < db ? e : best
    }, null)
    const rim = Math.hypot(top.x - BOWL.x, top.y - BOWL.y)
    // Keep away from the rim; a top near it runs back to the middle.
    if (rim > BOWL.r * 0.72) return { x: BOWL.x, y: BOWL.y }
    if (foe && top.spin > 0.2) {
      const dist = Math.hypot(foe.x - top.x, foe.y - top.y)
      if (dist < tune.range) {
        if (mem.timer[i]! <= 0) {
          // Charge: lead the enemy, with some error.
          const nz = mem.noise[i] ?? { x: 0, y: 0 }
          if (rng.next() < 0.5) {
            mem.noise[i] = {
              x: (rng.next() - 0.5) * 2 * tune.noise,
              y: (rng.next() - 0.5) * 2 * tune.noise,
            }
          }
          const n = mem.noise[i] ?? nz
          return {
            x: foe.x + foe.vx * tune.lead + n.x,
            y: foe.y + foe.vy * tune.lead + n.y,
          }
        }
        return null
      }
      // Not close yet: wait for the moment, and keep an eye on the enemy.
      mem.timer[i] = tune.react * (0.7 + rng.next() * 0.6)
    }
    // Circle the middle so the top keeps spinning and stays in the fight. Blue's orbits
    // mirror red's (half a turn apart, and in teams each blue lane takes the orbit of
    // the red lane it mirrors), so neither side gets the better orbit.
    const lane = top.side === 0 ? top.lane : w.teams ? 1 - top.lane : 0
    const a = w.t * 0.7 + top.side * Math.PI + lane * 2.1
    return { x: BOWL.x + Math.cos(a) * 170, y: BOWL.y + Math.sin(a) * 170 }
  })
}
