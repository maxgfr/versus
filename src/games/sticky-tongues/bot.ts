import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { other } from '../../core/game.ts'
import { mouth, OUT_SPEED, REACH, tipOf, type Fly, type World } from './rules.ts'

/** Seconds between a tongue coming home and the bot's next look at the field. */
const REACTION: Record<Difficulty, [number, number]> = {
  easy: [1.1, 1.8],
  normal: [0.45, 0.75],
  hard: [0.2, 0.35],
}
/** Aim error (world units) per axis. */
const ERROR: Record<Difficulty, number> = { easy: 90, normal: 28, hard: 10 }
/** How much of a moving fly's travel the bot leads. */
const LEAD: Record<Difficulty, number> = { easy: 0, normal: 0.7, hard: 1 }
/** Tongue speed of its shots: harder bots flick (a human's hard flick reaches 3300). */
const SPEED: Record<Difficulty, number> = { easy: OUT_SPEED, normal: 2600, hard: 3000 }

/**
 * Computer frog: waits a human-ish reaction after its tongue is home, then
 * shoots at the best nearby fly (golden flies count triple). Harder bots lead
 * the fly and aim straighter; easy ones sometimes pick the runner-up.
 */
export class TongueBot {
  /** Game time the bot next looks at the field (-1 = not yet scheduled). */
  private at = -1

  constructor(
    private rng: Rng,
    private d: Difficulty,
    private side: Side,
  ) {}

  /** The aim point (and tongue speed) for a shot this step, or null. */
  step(now: number, w: World): { x: number; y: number; speed: number } | null {
    const frog = w.frogs[this.side]
    if (frog.tongue.phase !== 'idle' || frog.queue) return null
    if (this.at < 0) {
      const [a, b] = REACTION[this.d]
      this.at = now + this.rng.range(a, b)
      return null
    }
    if (now < this.at) return null
    this.at = -1
    const fly = this.pick(w)
    if (!fly) return null
    return this.aim(fly)
  }

  /**
   * Free flies within reach, best first (golden and near beat the rest).
   * Normal and hard leave alone a fly the rival's tongue is already about to
   * reach first.
   */
  private pick(w: World): Fly | null {
    const m = mouth(this.side)
    const rs = other(this.side)
    const rt = w.frogs[rs].tongue
    const rtip = rt.phase === 'out' ? tipOf(rs, rt) : null
    const cands: { fly: Fly; score: number }[] = []
    for (const fly of w.flies) {
      if (fly.held >= 0) continue
      const d = Math.hypot(fly.x - m.x, fly.y - m.y)
      if (d > REACH) continue
      if (rtip && this.d !== 'easy') {
        // On the rival's line and ahead of its tip: it will get there first.
        const ox = fly.x - rtip.x
        const oy = fly.y - rtip.y
        const ahead = ox * rt.dx + oy * rt.dy
        const off = Math.abs(ox * -rt.dy + oy * rt.dx)
        if (ahead > 0 && off < 60 && ahead / rt.speed < d / SPEED[this.d]) continue
      }
      cands.push({ fly, score: (fly.golden ? 3 : 1) / (d + 150) })
    }
    if (cands.length === 0) return null
    cands.sort((a, b) => b.score - a.score)
    const k = this.d === 'easy' ? this.rng.int(0, Math.min(2, cands.length - 1)) : 0
    return (cands[k] as { fly: Fly }).fly
  }

  private aim(fly: Fly): { x: number; y: number; speed: number } {
    const m = mouth(this.side)
    const d = Math.hypot(fly.x - m.x, fly.y - m.y)
    const speed = SPEED[this.d]
    // Time for the tongue to reach the fly; lead it along its heading.
    const travel = (d / speed) * LEAD[this.d]
    const e = ERROR[this.d]
    return {
      x: fly.x + fly.vx * travel + this.rng.range(-e, e),
      y: fly.y + fly.vy * travel + this.rng.range(-e, e),
      speed,
    }
  }
}
