import type { Rng } from '../../core/rng.ts'
import { mashNew, mashStep, mashTap, type MashState } from '../../engines/reflex/index.ts'

/**
 * Pure rules for Unfair Fishing. Each player has a rod at their edge of the
 * pond in the middle. Cast, wait for a bite, hook it with a fast tap, then mash
 * to reel it in while keeping the line's tension inside the green band.
 *
 * Rod coordinates are in the player's own frame (red's view), so the same
 * numbers serve both sides.
 */

/** Match length, seconds. */
export const LIMIT = 60
/** Seconds the float stays down before the fish gets away. */
export const BITE_WINDOW = 0.9
/** How long a surge lasts. */
export const SURGE_LEN = 0.7
/** How much harder a surging fish pulls. */
export const SURGE_MUL = 1.6
/** How hard tension responds to the mismatch between pull and mashing. */
export const TENSION_GAIN = 0.35
/** Fraction of reel progress lost per second while a surge drags the line back. */
export const PULL_BACK = 0.08
/** The green band of the tension bar: reeling is full speed inside it. */
export const BAND: readonly [number, number] = [0.3, 0.7]
/** Where a float may land (rod frame). */
export const POND = { x0: 110, x1: 890, y0: 960, y1: 1320 }
/** Where the rod is planted on the player's edge. */
export const DOCK = { x: 500, y: 1490 }

export interface FishKind {
  ch: string
  /** Points for landing it. */
  value: number
  /** Pull on the line; a fish of strength s is balanced by about 6·s taps/s. */
  strength: number
  /** Reel progress needed (scaled so a balanced reel takes 5 to 8 seconds). */
  need: number
  /** Relative chance of a bite being this fish. */
  weight: number
}

export const FISH: readonly FishKind[] = [
  { ch: '🐟', value: 1, strength: 0.5, need: 1.5, weight: 55 },
  { ch: '🐠', value: 3, strength: 0.85, need: 3, weight: 28 },
  { ch: '🐡', value: 6, strength: 1.15, need: 4.8, weight: 13 },
  { ch: '🦈', value: 10, strength: 1.35, need: 7, weight: 4 },
]

export type Phase = 'idle' | 'cast' | 'wait' | 'bite' | 'reel' | 'won' | 'lost'

export interface Rod {
  phase: Phase
  /** Seconds in the current phase. */
  t: number
  /** Float position (rod frame). */
  x: number
  y: number
  /** Seconds from the cast until the bite. */
  until: number
  /** Fish on the line, index into FISH, or -1. */
  kind: number
  /** 0 = slack, 1 = snapping, the green band is in the middle. */
  tension: number
  /** Reel progress 0..1. */
  reel: number
  /** Seconds of surge left. */
  surge: number
  /** Seconds until the next surge. */
  surgeIn: number
  mash: MashState
  points: number
  /** Last thing that happened, for the status line. */
  note: 'none' | 'caught' | 'snapped' | 'slack' | 'missed'
  /** Points from the last catch, shown briefly. */
  noteValue: number
}

/** Taps this step for one rod: how many, and where the first one landed (rod frame). */
export interface Taps {
  n: number
  at: { x: number; y: number } | null
}

export type Ev =
  | { k: 'cast'; x: number; y: number }
  | { k: 'reelin' }
  | { k: 'bite' }
  | { k: 'hook'; kind: number }
  | { k: 'tug' }
  | { k: 'surge' }
  | { k: 'won'; kind: number; value: number }
  | { k: 'lost'; why: 'slack' | 'snap' | 'missed' }

export const NO_TAPS: Taps = { n: 0, at: null }

export const rodNew = (): Rod => ({
  phase: 'idle',
  t: 0,
  x: 500,
  y: 1100,
  until: 0,
  kind: -1,
  tension: 0.5,
  reel: 0,
  surge: 0,
  surgeIn: 3,
  mash: mashNew(),
  points: 0,
  note: 'none',
  noteValue: 0,
})

/** Pick the fish for a bite, weighted by FISH.weight. */
export function pickFish(rng: Rng): number {
  const total = FISH.reduce((s, f) => s + f.weight, 0)
  let r = rng.next() * total
  for (let i = 0; i < FISH.length; i++) {
    r -= (FISH[i] as FishKind).weight
    if (r < 0) return i
  }
  return FISH.length - 1
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)

/** Where a cast lands: the tap, pulled into the pond. */
export function landingSpot(x: number, y: number): { x: number; y: number } {
  return { x: clamp(x, POND.x0, POND.x1), y: clamp(y, POND.y0, POND.y1) }
}

/** Advance one rod by a step. `time` is the match clock (for mash rate). */
export function rodStep(r: Rod, dt: number, time: number, inp: Taps, rng: Rng): Ev[] {
  const out: Ev[] = []
  r.t += dt
  switch (r.phase) {
    case 'idle':
      if (inp.n > 0 && inp.at) {
        const spot = landingSpot(inp.at.x, inp.at.y)
        r.x = spot.x
        r.y = spot.y
        r.phase = 'cast'
        r.t = 0
        r.until = rng.range(2.2, 5.6)
        out.push({ k: 'cast', x: spot.x, y: spot.y })
      }
      break
    case 'cast':
      if (r.t >= 0.45) {
        r.phase = 'wait'
        r.t = 0
      }
      break
    case 'wait':
      // Tapping while the float bobs reels the line straight back in.
      if (inp.n > 0) {
        r.phase = 'idle'
        r.t = 0
        out.push({ k: 'reelin' })
      } else if (r.t >= r.until) {
        r.phase = 'bite'
        r.t = 0
        out.push({ k: 'bite' })
      }
      break
    case 'bite':
      if (inp.n > 0) {
        r.kind = pickFish(rng)
        r.phase = 'reel'
        r.t = 0
        r.tension = 0.5
        r.reel = 0
        r.surge = 0
        r.surgeIn = rng.range(1.6, 2.8)
        // Start the meter at this fish's balance rate, so the first second is a fight, not a snap.
        r.mash = mashNew()
        r.mash.rate = FISH[r.kind]!.strength * 6
        out.push({ k: 'hook', kind: r.kind })
      } else if (r.t >= BITE_WINDOW) {
        r.phase = 'lost'
        r.t = 0
        r.note = 'missed'
        out.push({ k: 'lost', why: 'missed' })
      }
      break
    case 'reel':
      reel(r, dt, time, inp, rng, out)
      break
    case 'won':
    case 'lost':
      if (r.t >= 1.1) {
        r.phase = 'idle'
        r.t = 0
      }
      break
  }
  return out
}

function reel(r: Rod, dt: number, time: number, inp: Taps, rng: Rng, out: Ev[]): void {
  const f = FISH[r.kind] as FishKind
  if (inp.n > 0) {
    mashTap(r.mash, time, inp.n)
    out.push({ k: 'tug' })
  }
  mashStep(r.mash, dt, time)

  r.surgeIn -= dt
  if (r.surge <= 0 && r.surgeIn <= 0) {
    r.surge = SURGE_LEN
    r.surgeIn = rng.range(2.4, 4)
    out.push({ k: 'surge' })
  }
  let pull = f.strength
  if (r.surge > 0) {
    r.surge -= dt
    pull *= SURGE_MUL
  }

  const rate = r.mash.rate
  r.tension += (pull - rate / 6) * TENSION_GAIN * dt
  const inBand = r.tension >= BAND[0] && r.tension <= BAND[1]
  if (r.surge > 0) {
    // The fish pulls the line back out of your hands.
    r.reel = Math.max(0, r.reel - PULL_BACK * dt)
  } else {
    // Reeling only gains ground at full speed inside the green band.
    r.reel += ((rate * 0.1 * (inBand ? 1 : 0.4)) / f.need) * dt
  }

  if (r.tension >= 1) return lose(r, 'snap', out)
  if (r.tension <= 0) return lose(r, 'slack', out)
  if (r.reel >= 1) {
    r.phase = 'won'
    r.t = 0
    r.note = 'caught'
    r.noteValue = f.value
    r.points += f.value
    out.push({ k: 'won', kind: r.kind, value: f.value })
  }
}

function lose(r: Rod, why: 'slack' | 'snap', out: Ev[]): void {
  r.phase = 'lost'
  r.t = 0
  r.note = why === 'snap' ? 'snapped' : 'slack'
  out.push({ k: 'lost', why })
}
