import { Rng } from '../../core/rng.ts'

/**
 * Pure rules for Money Grabber. Each player has a lane (their half of the
 * table, in red's frame). Coins, bills, bags and bombs rain down the lane toward
 * the player's edge, where a basket slides along to catch them. Both lanes
 * share one seeded rain, so the two halves get the same money.
 */

/** Match length, seconds. */
export const LIMIT = 45
/** Local y of the basket's rim. */
export const BASKET_Y = 1600
/** Half the basket's width. */
export const BASKET_HALF = 92
/** Fastest the basket slides, world units per second. */
export const BASKET_SPEED = 1500
/** Seconds a bomb leaves the basket unable to move. */
export const STUN = 1
/** Where drops appear (just past the midline, in the lane). */
export const SPAWN_Y = 960

export const COIN = 0
export const BILL = 1
export const BAG = 2
export const BOMB = 3

export interface Kind {
  name: string
  value: number
  /** Radius for catching and drawing. */
  r: number
}

export const KINDS: readonly Kind[] = [
  { name: 'coin', value: 1, r: 34 },
  { name: 'bill', value: 5, r: 42 },
  { name: 'bag', value: 10, r: 46 },
  { name: 'bomb', value: -3, r: 44 },
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
  /** Spin, radians. */
  rot: number
  vr: number
}

export interface Lane {
  score: number
  /** Basket centre, lane x. */
  basket: number
  /** Game time until the basket can move again (bombs stun it). */
  stunUntil: number
  items: Item[]
  next: number
  nid: number
  /** Money caught, by kind. */
  caught: [number, number, number, number]
  /** Game time and kind of the last catch, for the basket's bounce. */
  hitAt: number
  hitKind: number
}

export type Ev =
  | { k: 'catch'; kind: number; value: number; x: number; y: number }
  | { k: 'bomb'; value: number; x: number; y: number }
  | { k: 'drop'; kind: number; x: number; y: number }

export const laneNew = (): Lane => ({
  score: 0,
  basket: 500,
  stunUntil: -1,
  items: [],
  next: 0,
  nid: 1,
  caught: [0, 0, 0, 0],
  hitAt: -10,
  hitKind: COIN,
})

/** The shared rain. Bombs get a little more common as the match goes on. */
export function schedule(seed: number, limit = LIMIT): Drop[] {
  const rng = new Rng(seed)
  const out: Drop[] = []
  let t = 1
  while (t < limit) {
    const k = t / limit
    const n = rng.chance(0.18) ? 2 : 1
    for (let i = 0; i < n; i++) {
      const roll = rng.next()
      const bombP = 0.12 + 0.08 * k
      const kind =
        roll < bombP ? BOMB : roll < bombP + 0.05 ? BAG : roll < bombP + 0.3 ? BILL : COIN
      out.push({
        t: t + i * 0.14,
        x: rng.range(90, 910),
        vy: rng.range(280, 340) + 90 * k,
        kind,
      })
    }
    t += rng.range(0.35, 0.8) * (1.05 - 0.45 * k)
  }
  return out
}

/** Clamp a basket position to the lane. */
export const clampBasket = (x: number): number =>
  Math.max(BASKET_HALF, Math.min(1000 - BASKET_HALF, x))

/**
 * One lane step: drop due items, move the basket toward `target` (the finger, or
 * the bot's aim) at most `speed` per second, fall, and catch.
 */
export function laneStep(
  l: Lane,
  dt: number,
  time: number,
  sched: readonly Drop[],
  target: number | null,
  speed = BASKET_SPEED,
): Ev[] {
  const out: Ev[] = []
  while (l.next < sched.length && (sched[l.next] as Drop).t <= time) {
    const d = sched[l.next] as Drop
    l.next++
    l.items.push({
      id: l.nid++,
      kind: d.kind,
      x: d.x,
      y: SPAWN_Y,
      vy: d.vy,
      rot: 0,
      vr: (d.x < 500 ? 1 : -1) * 3,
    })
    out.push({ k: 'drop', kind: d.kind, x: d.x, y: SPAWN_Y })
  }
  if (target !== null && time >= l.stunUntil) {
    const dx = clampBasket(target) - l.basket
    const step = Math.min(Math.abs(dx), speed * dt)
    l.basket += Math.sign(dx) * step
  }
  for (const it of l.items) {
    it.y += it.vy * dt
    it.rot += it.vr * dt
  }
  const kept: Item[] = []
  for (const it of l.items) {
    const kind = KINDS[it.kind] as Kind
    const near = Math.abs(it.x - l.basket) <= BASKET_HALF + kind.r * 0.5
    if (it.y >= BASKET_Y - 30 && it.y <= BASKET_Y + 40 && near) {
      l.hitAt = time
      l.hitKind = it.kind
      if (it.kind === BOMB) {
        l.score += kind.value
        l.stunUntil = time + STUN
        out.push({ k: 'bomb', value: kind.value, x: it.x, y: it.y })
      } else {
        l.score += kind.value
        l.caught[it.kind] = (l.caught[it.kind] ?? 0) + kind.value
        out.push({ k: 'catch', kind: it.kind, value: kind.value, x: it.x, y: it.y })
      }
      continue
    }
    // Past the basket: it lands on the edge and is gone.
    if (it.y > BASKET_Y + 90) continue
    kept.push(it)
  }
  l.items = kept
  return out
}

/** Most money wins; equal money draws. */
export function winnerOf(scores: [number, number]): 0 | 1 | 'draw' {
  if (scores[0] === scores[1]) return 'draw'
  return scores[0] > scores[1] ? 0 : 1
}
