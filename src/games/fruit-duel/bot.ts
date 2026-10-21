import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { BOMB, crossesBomb, FRUITS, type Lane, type Seg } from './rules.ts'

/**
 * Computer slicer. It sees a fruit only after a reaction delay, swipes at the
 * best fruit it can reach, and (below 100% accuracy) sometimes swipes through
 * a bomb it failed to notice. Its finger is virtual: the path it returns goes
 * through the same slicing code as a human's.
 */

const CFG: Record<Difficulty, { speed: number; react: [number, number]; accuracy: number }> = {
  easy: { speed: 900, react: [0.55, 0.85], accuracy: 0.55 },
  normal: { speed: 1400, react: [0.32, 0.5], accuracy: 0.85 },
  hard: { speed: 2100, react: [0.18, 0.28], accuracy: 1 },
}

/** Where the finger rests between swipes, in lane coordinates. */
const REST = { x: 500, y: 1400 }

interface Target {
  id: number
  /** Aim error, so the bot is not a perfect cutter. */
  ox: number
  oy: number
  /** Does this swipe respect bombs (decided once per target). */
  respect: boolean
}

export class SliceBot {
  /** Fruit id → when the bot first saw it, and how long it takes to react. */
  private seen = new Map<number, { t0: number; react: number }>()
  private target: Target | null = null
  private pos = { x: REST.x, y: REST.y }

  constructor(
    private rng: Rng,
    private d: Difficulty,
  ) {}

  /** The finger's move this step (lane coordinates), or null when it is resting. */
  step(l: Lane, time: number, dt: number): Seg | null {
    const c = CFG[this.d]
    const alive = new Set(l.fruit.map((f) => f.id))
    for (const f of l.fruit) {
      if (!this.seen.has(f.id)) {
        const [a, b] = c.react
        this.seen.set(f.id, { t0: time, react: this.rng.range(a, b) })
      }
    }
    // Deleting the current key while iterating a Map is safe.
    for (const id of this.seen.keys()) if (!alive.has(id)) this.seen.delete(id)
    if (this.target && !alive.has(this.target.id)) this.target = null
    if (!this.target) this.pick(l, time)

    const t = this.target
    const fruit = t ? l.fruit.find((f) => f.id === t.id) : undefined
    if (!t || !fruit) {
      // Nothing to cut: ease back to rest without slicing anything.
      this.moveTo(REST.x, REST.y, c.speed * 0.5 * dt)
      return null
    }
    const aimX = fruit.x + t.ox + fruit.vx * 0.04
    const aimY = fruit.y + t.oy + fruit.vy * 0.04
    const seg = this.moveTo(aimX, aimY, c.speed * dt)
    if (t.respect && crossesBomb(l, seg)) {
      // A bomb has drifted into the way: wait for a clear path.
      this.target = null
      return null
    }
    return seg
  }

  /** Move the finger toward a point by at most `dist`; returns the segment covered. */
  private moveTo(x: number, y: number, dist: number): Seg {
    const from = { x: this.pos.x, y: this.pos.y }
    const dx = x - from.x
    const dy = y - from.y
    const len = Math.hypot(dx, dy)
    const k = len > 0 ? Math.min(1, dist / len) : 0
    this.pos = { x: from.x + dx * k, y: from.y + dy * k }
    return [from.x, from.y, this.pos.x, this.pos.y]
  }

  private ready(id: number, time: number): boolean {
    const s = this.seen.get(id)
    return s !== undefined && time - s.t0 >= s.react
  }

  /** Choose the best fruit the bot has seen long enough. */
  private pick(l: Lane, time: number): void {
    const c = CFG[this.d]
    const cands = l.fruit
      .filter((f) => f.kind !== BOMB && this.ready(f.id, time))
      .map((f) => {
        const value = (FRUITS[f.kind] as (typeof FRUITS)[number]).value
        const dist = Math.hypot(f.x - this.pos.x, f.y - this.pos.y)
        // Valuable fruit first, fruit on its way down first, near ones first.
        return { f, score: value * 2 + (f.vy > 0 ? 1.2 : 0) - dist / 700 }
      })
      .sort((a, b) => b.score - a.score)
    for (const { f } of cands) {
      const respect = this.rng.chance(c.accuracy)
      const line: Seg = [this.pos.x, this.pos.y, f.x, f.y]
      if (respect && crossesBomb(l, line)) continue
      this.target = {
        id: f.id,
        ox: this.rng.range(-16, 16),
        oy: this.rng.range(-16, 16),
        respect,
      }
      return
    }
  }
}
