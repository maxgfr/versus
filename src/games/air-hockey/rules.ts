import type { Side } from '../../core/game.ts'
import { MID, W } from '../../core/stage.ts'
import {
  capSpeed,
  collideKinematic,
  collideWalls,
  type Contact,
  type Disc,
  disc,
  driveTo,
  halfBox,
  integrate,
  rink,
  scoredBy,
} from '../../engines/puck/index.ts'

/** Pure air hockey: world state and a deterministic step. No DOM, no sound. */

export const RINK = rink()
export const PUCK_R = 42
export const MALLET_R = 64
export const MAX_PUCK = 3000
export const TARGET = 7
const SUBSTEPS = 4

export interface Mallet extends Disc {
  side: Side
  /** 2 vs 2: which lane of the half it is confined to. Undefined in 1 vs 1. */
  lane?: 0 | 1
}

export interface World {
  puck: Disc
  mallets: Mallet[]
  score: [number, number]
  /** 'play', or 'goal' while the scored puck is off the table. */
  phase: 'play' | 'goal'
  /** Seconds left in the current goal pause. */
  pause: number
  /** Who serves next (the side that conceded). */
  server: Side
}

export type Event =
  | Contact
  | { kind: 'goal'; side: Side; speed: number; x: number; y: number }
  | { kind: 'serve'; side: Side; speed: number; x: number; y: number }

export function homeOf(side: Side, lane?: 0 | 1): { x: number; y: number } {
  const x = lane === undefined ? W / 2 : lane === 0 ? W * 0.3 : W * 0.7
  return { x, y: side === 0 ? RINK.y1 - 190 : RINK.y0 + 190 }
}

export function newWorld(teams: boolean, server: Side): World {
  const mallets: Mallet[] = []
  for (const side of [0, 1] as Side[]) {
    const lanes: (0 | 1 | undefined)[] = teams ? [0, 1] : [undefined]
    for (const lane of lanes) {
      const h = homeOf(side, lane)
      const m: Mallet = { ...disc(h.x, h.y, MALLET_R), side }
      if (lane !== undefined) m.lane = lane
      mallets.push(m)
    }
  }
  const w: World = {
    puck: disc(W / 2, MID, PUCK_R),
    mallets,
    score: [0, 0],
    phase: 'play',
    pause: 0,
    server,
  }
  serve(w, server)
  return w
}

/** Put the puck, at rest, in the server's half. */
export function serve(w: World, side: Side): void {
  w.puck = disc(W / 2, side === 0 ? MID + 260 : MID - 260, PUCK_R)
  w.phase = 'play'
  w.server = side
}

export type Target = { x: number; y: number } | null

/**
 * Advance one fixed step. `targets[i]` is where mallet i wants to go (null =
 * stay), `speeds[i]` its top speed. Returns what happened for juice.
 */
export function step(w: World, dt: number, targets: Target[], speeds: number[]): Event[] {
  const events: Event[] = []
  if (w.phase === 'goal') {
    w.pause -= dt
    // Mallets may still move while the puck is away.
    w.mallets.forEach((m, i) => {
      const t = targets[i]
      if (t) driveTo(m, t.x, t.y, speeds[i] ?? 3000, dt, halfBox(m.side, RINK, m.r, m.lane))
      else m.vx = m.vy = 0
    })
    if (w.pause <= 0) {
      serve(w, w.server)
      events.push({ kind: 'serve', side: w.server, speed: 0, x: w.puck.x, y: w.puck.y })
    }
    return events
  }
  const h = dt / SUBSTEPS
  for (let s = 0; s < SUBSTEPS; s++) {
    w.mallets.forEach((m, i) => {
      const t = targets[i]
      if (t) driveTo(m, t.x, t.y, speeds[i] ?? 3000, h, halfBox(m.side, RINK, m.r, m.lane))
      else m.vx = m.vy = 0
    })
    integrate(w.puck, h, 0.3)
    const c = collideWalls(w.puck, RINK)
    if (c && c.speed > 60) events.push(c)
    for (const m of w.mallets) {
      const hit = collideKinematic(w.puck, m)
      if (hit) {
        events.push(hit)
        // A puck squeezed against a wall by a mallet must not tunnel out.
        collideWalls(w.puck, RINK)
      }
    }
    capSpeed(w.puck, MAX_PUCK)
    const scorer = scoredBy(w.puck, RINK)
    if (scorer !== null) {
      w.score[scorer]++
      w.phase = 'goal'
      w.pause = 1.1
      w.server = scorer === 0 ? 1 : 0
      events.push({
        kind: 'goal',
        side: scorer,
        speed: Math.hypot(w.puck.vx, w.puck.vy),
        x: w.puck.x,
        y: w.puck.y,
      })
      return events
    }
  }
  return events
}

/** The side that reached `target` goals first, if any. */
export function winner(w: World, target = TARGET): Side | null {
  if (w.score[0] >= target) return 0
  if (w.score[1] >= target) return 1
  return null
}
