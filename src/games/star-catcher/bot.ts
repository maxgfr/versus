import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { BASKET_HALF, BASKET_SPEED, BASKET_Y, type Item, KINDS, type Sky } from './rules.ts'

/**
 * Computer catcher. It only sees what is already falling in its sky. Every
 * `lag` seconds it re-plans: easy chases whatever lands next; normal and hard
 * plan a route through the next few stars (which ones it can still reach in
 * time, one after the other) and take the route worth the most points, so a
 * golden star or a comet can be worth skipping a plain star for. Easy slides
 * slowly; hard slides as fast as a finger can.
 */

interface Cfg {
  lag: number
  speed: number
  /** Stars it plans ahead through (0 = just the next one). */
  plan: number
  /** Aim wobble (± units). */
  wobble: number
}

const CFG: Record<Difficulty, Cfg> = {
  easy: { lag: 0.8, speed: 420, plan: 0, wobble: 30 },
  normal: { lag: 0.22, speed: 1050, plan: 3, wobble: 18 },
  hard: { lag: 0.07, speed: BASKET_SPEED, plan: 7, wobble: 0 },
}

/** Seconds until an item reaches the basket's catch line. */
const eta = (it: Item): number => Math.max(0, (BASKET_Y - 10 - it.y) / Math.max(1, it.vy))

/** How far off centre the basket can be and still catch it. */
const slack = (it: Item): number => BASKET_HALF + (KINDS[it.kind]?.r ?? 36) * 0.4 - 12

export class StarBot {
  private aim = 500
  private timer = 0

  constructor(
    private rng: Rng,
    private d: Difficulty,
  ) {}

  /** The basket speed this bot can manage, world units per second. */
  get speed(): number {
    return Math.min(BASKET_SPEED, CFG[this.d].speed)
  }

  /** Basket target (sky x) this step. */
  step(s: Sky, dt: number): number {
    this.timer -= dt
    if (this.timer <= 0) {
      this.timer = CFG[this.d].lag
      this.aim = this.choose(s)
    }
    return this.aim
  }

  private choose(s: Sky): number {
    const cfg = CFG[this.d]
    const live = s.items.filter((it) => it.y <= BASKET_Y - 20).sort((a, b) => eta(a) - eta(b))
    if (!live.length) return s.basket
    const wobble = cfg.wobble ? this.rng.range(-cfg.wobble, cfg.wobble) : 0
    if (cfg.plan === 0) return (live[0] as Item).x + wobble
    const first = route(live.slice(0, cfg.plan), s.basket, this.speed)
    return (first?.x ?? s.basket) + wobble
  }
}

/**
 * The first star of the most valuable route through `items` (sorted by
 * arrival) that a basket at `from`, sliding at `speed`, can catch in order.
 */
export function route(items: readonly Item[], from: number, speed: number): Item | null {
  const n = items.length
  // best[i]: most points from catching item i onward.
  const best: number[] = Array.from({ length: n }, () => 0)
  for (let i = n - 1; i >= 0; i--) {
    const a = items[i] as Item
    let tail = 0
    for (let j = i + 1; j < n; j++) {
      const b = items[j] as Item
      const reach = speed * (eta(b) - eta(a)) + slack(a) + slack(b) * 0.5
      if (Math.abs(b.x - a.x) <= reach) tail = Math.max(tail, best[j] ?? 0)
    }
    best[i] = (KINDS[a.kind]?.points ?? 1) + tail
  }
  let pick: Item | null = null
  let score = 0
  for (let i = 0; i < n; i++) {
    const a = items[i] as Item
    if (Math.abs(a.x - from) > speed * eta(a) + slack(a)) continue
    // Ties go to the one landing first.
    if ((best[i] ?? 0) > score) {
      score = best[i] ?? 0
      pick = a
    }
  }
  return pick
}
