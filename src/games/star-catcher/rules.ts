import { Rng } from '../../core/rng.ts'

/**
 * Pure rules for Star Catcher. Each player has a sky (their half of the table,
 * in red's frame). Stars fall toward the player's edge, where a basket slides
 * along to catch them. Golden stars are worth three, comets fall faster and
 * are worth two. Both skies share one seeded pattern.
 */

/** Match length, seconds. */
export const LIMIT = 40
/** Local y of the basket's rim. */
export const BASKET_Y = 1600
/** Half the basket's width. */
export const BASKET_HALF = 96
/** Fastest the basket slides, world units per second. */
export const BASKET_SPEED = 1500
/** Where stars appear (just past the midline, in the sky). */
export const SPAWN_Y = 960

export const STAR = 0
export const GOLD = 1
export const COMET = 2

export interface Kind {
  name: string
  points: number
  /** Radius for catching and drawing. */
  r: number
  /** Fall speed multiplier. */
  speed: number
}

export const KINDS: readonly Kind[] = [
  { name: 'star', points: 1, r: 36, speed: 1 },
  { name: 'gold', points: 3, r: 40, speed: 1 },
  { name: 'comet', points: 2, r: 44, speed: 1.7 },
]

export interface Drop {
  /** Seconds from the start of the match. */
  t: number
  x: number
  vy: number
  kind: number
}

export interface Item {
  id: number
  kind: number
  x: number
  y: number
  vy: number
  /** Twinkle / spin phase. */
  rot: number
}

export interface Sky {
  score: number
  /** Basket centre, sky x. */
  basket: number
  items: Item[]
  next: number
  nid: number
  /** Caught by kind. */
  caught: [number, number, number]
  /** Game time and kind of the last catch, for the basket's bounce. */
  hitAt: number
  hitKind: number
}

export type Ev =
  | { k: 'drop'; kind: number; x: number; y: number }
  | { k: 'catch'; kind: number; points: number; x: number; y: number }

export const skyNew = (): Sky => ({
  score: 0,
  basket: 500,
  items: [],
  next: 0,
  nid: 1,
  caught: [0, 0, 0],
  hitAt: -10,
  hitKind: STAR,
})

/** The shared pattern. Volleys now and then; comets and golden stars grow more common late. */
export function schedule(seed: number, limit = LIMIT): Drop[] {
  const rng = new Rng(seed)
  const out: Drop[] = []
  let t = 1
  while (t < limit) {
    const k = t / limit
    const n = rng.chance(0.15) ? 2 : 1
    for (let i = 0; i < n; i++) {
      const roll = rng.next()
      const cometP = 0.08 + 0.06 * k
      const goldP = 0.12
      const kind = roll < cometP ? COMET : roll < cometP + goldP ? GOLD : STAR
      out.push({
        t: t + i * 0.14,
        x: rng.range(90, 910),
        vy: rng.range(280, 330) + 40 * k,
        kind,
      })
    }
    t += rng.range(0.4, 0.85) * (1.05 - 0.4 * k)
  }
  return out
}

export const clampBasket = (x: number): number =>
  Math.max(BASKET_HALF, Math.min(1000 - BASKET_HALF, x))

/**
 * One sky step: drop due stars, slide the basket toward `target` at most `speed`
 * per second, fall, and catch.
 */
export function skyStep(
  s: Sky,
  dt: number,
  time: number,
  sched: readonly Drop[],
  target: number | null,
  speed = BASKET_SPEED,
): Ev[] {
  const out: Ev[] = []
  while (s.next < sched.length && (sched[s.next] as Drop).t <= time) {
    const d = sched[s.next] as Drop
    s.next++
    s.items.push({
      id: s.nid++,
      kind: d.kind,
      x: d.x,
      y: SPAWN_Y,
      vy: d.vy * ((KINDS[d.kind] as Kind).speed ?? 1),
      rot: 0,
    })
    out.push({ k: 'drop', kind: d.kind, x: d.x, y: SPAWN_Y })
  }
  if (target !== null) {
    const dx = clampBasket(target) - s.basket
    s.basket += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt)
  }
  const kept: Item[] = []
  for (const it of s.items) {
    it.y += it.vy * dt
    it.rot += dt * 4
    const kind = KINDS[it.kind] as Kind
    const near = Math.abs(it.x - s.basket) <= BASKET_HALF + kind.r * 0.4
    if (it.y >= BASKET_Y - 30 && it.y <= BASKET_Y + 40 && near) {
      s.score += kind.points
      s.hitAt = time
      s.hitKind = it.kind
      s.caught[it.kind] = (s.caught[it.kind] ?? 0) + kind.points
      out.push({ k: 'catch', kind: it.kind, points: kind.points, x: it.x, y: it.y })
      continue
    }
    // Past the basket: it fades out of the sky.
    if (it.y > BASKET_Y + 90) continue
    kept.push(it)
  }
  s.items = kept
  return out
}

/** Most points wins; equal points draw. */
export function winnerOf(scores: [number, number]): 0 | 1 | 'draw' {
  if (scores[0] === scores[1]) return 'draw'
  return scores[0] > scores[1] ? 0 : 1
}
