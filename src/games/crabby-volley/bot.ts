import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MID } from '../../core/stage.ts'
import { HOP_H, landingOf, REACH, span, type World } from './rules.ts'

interface Tuning {
  /** Scuttle speed (units/s): how fast the crabs get across the band. */
  speed: number
  /** Seconds between decisions: slower bots react late. */
  react: number
  /** Positioning error on the landing spot (units, ±). */
  error: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { speed: 230, react: 0.45, error: 110 },
  normal: { speed: 360, react: 0.26, error: 60 },
  hard: { speed: 520, react: 0.12, error: 20 },
}

export interface BotMemory {
  wait: number
  x: (number | null)[]
  hop: boolean[]
}

export const newMemory = (): BotMemory => ({ wait: 0, x: [], hop: [] })

export interface Plan {
  x: (number | null)[]
  hop: boolean[]
}

const mine = (side: Side, y: number): boolean => (side === 0 ? y > MID : y < MID)

/**
 * What `side`'s crabs do: the striker scuttles under the spot where the ball will
 * land on its sand and hops when the ball is just above its reach. Others return
 * to the middle of their span. Indices match `w.crabs`.
 */
export function decide(
  w: World,
  side: Side,
  d: Difficulty,
  rng: Rng,
  mem: BotMemory,
  dt: number,
): Plan {
  const tune = TUNING[d]
  mem.wait -= dt
  if (mem.wait > 0 && mem.x.length === w.crabs.length)
    return { x: mem.x, hop: mem.hop.map(() => false) }
  mem.wait = tune.react * (0.7 + rng.next() * 0.6)
  const b = w.ball
  const land = landingOf(b)
  const ours = land !== null && mine(side, land.y)
  const mates = w.crabs.filter((c) => c.side === side)
  const striker =
    mates.length > 1 && land ? mates.find((c) => c.lane === (land.x < 500 ? 0 : 1)) : mates[0]
  const x: (number | null)[] = []
  const hop: boolean[] = []
  for (const c of w.crabs) {
    if (c.side !== side) {
      x.push(null)
      hop.push(false)
      continue
    }
    const sp = span(c.lane)
    const home = (sp.x0 + sp.x1) / 2
    if (w.phase === 'point' || !land || !ours || c !== striker) {
      x.push(w.phase === 'point' || !ours ? home : c.x)
      hop.push(false)
      continue
    }
    x.push(land.x + (rng.next() * 2 - 1) * tune.error)
    // Hop when the ball is just out of reach but about to drop into the hop's height.
    const soon = land.t < 0.8 && Math.abs(land.x - c.x) < 110
    const above = b.z > REACH && b.z < REACH + HOP_H + 140 && b.vz < 0
    hop.push(soon && above && rng.next() < 0.9)
  }
  mem.x = x
  mem.hop = hop
  return { x, hop }
}
