import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { BOWL, rimAt, TOP_R, type Top, type Targets, type World } from './rules.ts'

interface Tuning {
  /** Seconds between spotting a target and charging it. */
  react: number
  /** How close an enemy must be before the bot charges. */
  range: number
  /** Aim error on the charge (world units). */
  noise: number
  /** Seconds of enemy motion the bot leads by. */
  lead: number
  /** Fights for the inside line (between the rival and the middle) before charging outward. */
  inside: boolean
  /** Chance per charge that it flicks a dash, and how hard. */
  dash: number
  dashPower: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: {
    react: 0.8,
    range: 260,
    noise: 80,
    lead: 0,
    inside: false,
    dash: 0,
    dashPower: 0,
  },
  normal: {
    react: 0.32,
    range: 380,
    noise: 26,
    lead: 0.3,
    inside: true,
    dash: 0.35,
    dashPower: 0.6,
  },
  hard: {
    // Measured: waiting a beat before the charge beats charging at once.
    react: 0.32,
    range: 380,
    noise: 6,
    lead: 0.3,
    inside: true,
    dash: 0.35,
    dashPower: 0.6,
  },
}

/** Per-bot memory, one slot per top (not synced). */
export interface BotMemory {
  timer: number[]
  noise: { x: number; y: number }[]
}

export const newMemory = (): BotMemory => ({ timer: [], noise: [] })

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Steering for every top of `side`. Easy charges the nearest rival when it
 * comes close. Normal and hard first win the inside line (between the rival
 * and the middle) so their knock sends the rival toward the closing rim, lead
 * the rival's motion, and flick a dash on the final approach; hard aims
 * tighter. Every level runs back to the middle
 * near the rim. Works for either side and for teams.
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
  const rim = rimAt(w.t)
  return w.tops.map((top, i) => {
    if (top.side !== side || top.out || w.phase !== 'play') return null
    mem.timer[i] = (mem.timer[i] ?? 0) - dt
    const foe = enemies.reduce<Top | null>(
      (best, e) => (!best || dist(e, top) < dist(best, top) ? e : best),
      null,
    )
    const out = dist(top, BOWL)
    // Keep away from the rim; a top near it runs back to the middle.
    if (out > rim * 0.72) return { x: BOWL.x, y: BOWL.y }
    if (foe && top.spin > 0.2) {
      const gap = dist(foe, top)
      if (gap < tune.range) {
        const foeOut = dist(foe, BOWL)
        // The inside line: sit between the rival and the middle before the charge.
        if (tune.inside && out > foeOut - TOP_R && gap > TOP_R * 3) {
          const a = Math.atan2(foe.y - BOWL.y, foe.x - BOWL.x)
          const r = Math.max(0, foeOut - TOP_R * 2.4)
          return { x: BOWL.x + Math.cos(a) * r, y: BOWL.y + Math.sin(a) * r }
        }
        if ((mem.timer[i] ?? 0) <= 0) {
          // Charge: lead the enemy, with some error.
          if (rng.next() < 0.5) {
            mem.noise[i] = {
              x: (rng.next() - 0.5) * 2 * tune.noise,
              y: (rng.next() - 0.5) * 2 * tune.noise,
            }
          }
          const n = mem.noise[i] ?? { x: 0, y: 0 }
          const aim = {
            x: foe.x + foe.vx * tune.lead + n.x,
            y: foe.y + foe.vy * tune.lead + n.y,
          }
          // Through the rival rather than at it, so the knock carries on outward.
          const ax = aim.x - top.x
          const ay = aim.y - top.y
          const al = Math.hypot(ax, ay) || 1
          const through = { x: aim.x + (ax / al) * 120, y: aim.y + (ay / al) * 120 }
          // Dash only from the inside line, and only as hard as the gap needs, so a miss
          // runs on toward the middle instead of over the rim.
          const close = gap < tune.range * 0.55 && gap > TOP_R * 2.6 && out < foeOut
          if (close && top.dash <= 0 && tune.dash > 0 && rng.next() < tune.dash * dt * 8)
            return { ...through, dash: tune.dashPower * Math.min(1, gap / 420) }
          return through
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
    const r = Math.min(170, rim * 0.4)
    return { x: BOWL.x + Math.cos(a) * r, y: BOWL.y + Math.sin(a) * r }
  })
}
