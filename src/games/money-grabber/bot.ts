import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  BASKET_HALF,
  BASKET_SPEED,
  BASKET_Y,
  BOMB,
  clampBasket,
  type Item,
  KINDS,
  type Lane,
} from './rules.ts'

/**
 * Computer catcher. It tracks the best money it can reach, but only re-aims
 * every `lag` seconds, so it is always a little behind the rain. Below perfect
 * accuracy it sometimes ignores a bomb that is closing on the basket.
 */

const CFG: Record<
  Difficulty,
  { lag: number; speed: number; accuracy: number; react: [number, number] }
> = {
  easy: { lag: 0.9, speed: 340, accuracy: 0.25, react: [0.5, 0.8] },
  normal: { lag: 0.45, speed: 700, accuracy: 0.7, react: [0.28, 0.45] },
  hard: { lag: 0.1, speed: 1400, accuracy: 1, react: [0.12, 0.2] },
}

/** Bombs the bot has noticed: when, and whether it will react to this one. */
interface Seen {
  t0: number
  react: number
  respect: boolean
}

/**
 * Computer catcher. It tracks the best money it can reach, but only re-aims
 * every `lag` seconds, so it is always a little behind the rain. Bombs get their
 * own quicker reaction: it notices one falling toward the basket after a short
 * delay and slides away, unless its accuracy lets it miss this one.
 */
export class CatchBot {
  private aim = 500
  private timer = 0
  private now = 0
  private seen = new Map<number, Seen>()

  constructor(
    private rng: Rng,
    private d: Difficulty,
  ) {}

  /** The basket speed this bot can manage, world units per second. */
  get speed(): number {
    return Math.min(BASKET_SPEED, CFG[this.d].speed)
  }

  /** Basket target (lane x) this step. */
  step(l: Lane, dt: number): number {
    this.now += dt
    const c = CFG[this.d]
    const bombs = l.items.filter(
      (it) => it.kind === BOMB && it.y < BASKET_Y + 40 && it.y > BASKET_Y - 700,
    )
    for (const b of bombs) {
      if (!this.seen.has(b.id)) {
        const [lo, hi] = c.react
        this.seen.set(b.id, {
          t0: this.now,
          react: this.rng.range(lo, hi),
          respect: this.rng.chance(c.accuracy),
        })
      }
    }
    for (const id of this.seen.keys()) if (!l.items.some((it) => it.id === id)) this.seen.delete(id)

    // Danger first: a bomb the bot has noticed and will react to, close to the basket.
    for (const b of bombs) {
      const k = this.seen.get(b.id)
      if (!k || !k.respect || this.now - k.t0 < k.react) continue
      if (Math.abs(b.x - l.basket) < BASKET_HALF + 70) {
        const away = b.x < l.basket ? 1 : -1
        this.aim = clampBasket(l.basket + away * (BASKET_HALF * 2 + 40))
        this.timer = 0
        return this.aim
      }
    }

    this.timer -= dt
    if (this.timer <= 0) {
      this.timer = c.lag
      this.aim = this.choose(l, bombs)
    }
    return this.aim
  }

  /** The best money to go for, skipping money a respected bomb will land on or near. */
  private choose(l: Lane, bombs: readonly Item[]): number {
    const watched = bombs.filter((b) => this.seen.get(b.id)?.respect)
    let best: { x: number; score: number } | null = null
    for (const it of l.items) {
      if (it.kind === BOMB || it.y > BASKET_Y - 40) continue
      if (watched.some((b) => inWay(b.x, l.basket, it.x) || Math.abs(b.x - it.x) < 170)) continue
      const value = (KINDS[it.kind] as (typeof KINDS)[number]).value
      const dist = Math.abs(it.x - l.basket)
      const score = value / (1 + dist / 320)
      if (!best || score > best.score) best = { x: it.x, score }
    }
    return best ? best.x : l.basket
  }
}

/** Would the basket sweeping from `from` to `to` pass under a bomb at `bx`? */
function inWay(bx: number, from: number, to: number): boolean {
  const lo = Math.min(from, to) - BASKET_HALF - 60
  const hi = Math.max(from, to) + BASKET_HALF + 60
  return bx >= lo && bx <= hi
}
