import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import { fwd, homeOf, landingOf, type Blob, type World } from './rules.ts'

interface Tuning {
  /** Blob top speed (units/s). */
  speed: number
  /** Seconds between decisions: slower bots react late. */
  react: number
  /** Positioning error on the landing spot (units, ±). */
  error: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { speed: 700, react: 0.5, error: 150 },
  normal: { speed: 950, react: 0.3, error: 90 },
  hard: { speed: 1500, react: 0.15, error: 30 },
}

export interface BotMemory {
  wait: number
  targets: ({ x: number; y: number } | null)[]
}

export const newMemory = (): BotMemory => ({ wait: 0, targets: [] })

const mine = (side: Side, y: number): boolean => (side === 0 ? y > MID : y < MID)

/**
 * Where each of `side`'s blobs should stand: under the spot where the ball will
 * land on its sand, a little behind it (so the bump sends it toward the net).
 * Blobs that are not needed go home. Indices match `w.blobs`.
 */
export function decide(
  w: World,
  side: Side,
  d: Difficulty,
  rng: Rng,
  mem: BotMemory,
  dt: number,
): ({ x: number; y: number } | null)[] {
  const tune = TUNING[d]
  mem.wait -= dt
  if (mem.wait > 0 && mem.targets.length === w.blobs.length) return mem.targets
  mem.wait = tune.react * (0.7 + rng.next() * 0.6)
  const b = w.ball
  const land = landingOf(b)
  const onOurs = land !== null && mine(side, land.y)
  const mates = w.blobs.filter((x) => x.side === side)
  // In 2 vs 2 the blob on the landing side takes the ball; the other covers its own lane.
  const striker: Blob | undefined =
    mates.length > 1 && land ? mates.find((x) => x.lane === (land.x < W / 2 ? 0 : 1)) : mates[0]
  const out = w.blobs.map((bl): { x: number; y: number } | null => {
    if (bl.side !== side) return null
    const home = homeOf(side, bl.lane)
    if (w.phase === 'point') return home
    if (bl === striker && land && onOurs) {
      const e = tune.error
      return {
        x: land.x + (rng.next() * 2 - 1) * e,
        y: land.y - fwd(side) * 46 + (rng.next() * 2 - 1) * e * 0.5,
      }
    }
    // Waiting: stand a little toward the ball's side of our half.
    const inMine = mine(side, b.y)
    const sx = bl.lane === undefined ? b.x : b.x * 0.6 + homeOf(side, bl.lane).x * 0.4
    return { x: sx, y: inMine ? home.y : home.y + fwd(side) * 60 }
  })
  mem.targets = out
  return out
}
