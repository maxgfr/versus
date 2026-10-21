import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { BOARD, type Drive, idx, type Roller, type World } from './rules.ts'

interface Skill {
  pace: number
  /** Seconds between new targets. */
  retarget: number
  /** Fresh tiles a splash must cover (of its 3 × 3) to be worth the cooldown. */
  splashMin: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { pace: 0.7, retarget: 0.9, splashMin: 6 },
  normal: { pace: 0.9, retarget: 0.6, splashMin: 5 },
  hard: { pace: 1, retarget: 0.4, splashMin: 4 },
}

/**
 * One computer roller: heads for the nearest big patch of floor it does not
 * own yet (unpainted or rival tiles, weighted by how many are around them), and
 * splashes when a 3 × 3 burst would win enough. Bots run on the host only.
 */
export class PaintBot {
  private sk: Skill
  private goalX = 0
  private goalY = 0
  private t = 0
  private has = false

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.sk = SKILL[d]
  }

  decide(w: World, me: Roller, dt: number): Drive {
    this.t -= dt
    if (this.t <= 0 || !this.has) {
      this.pick(w, me)
      this.t = this.sk.retarget * this.rng.range(0.8, 1.2)
    }
    const dx = this.goalX - me.x
    const dy = this.goalY - me.y
    const m = Math.hypot(dx, dy)
    const near = m < 14
    const fresh = this.freshAround(w, me, 1)
    const splash = me.cd <= 0 && fresh >= this.sk.splashMin
    return {
      jx: near ? 0 : (dx / m) * this.sk.pace,
      jy: near ? 0 : (dy / m) * this.sk.pace,
      splash,
    }
  }

  /** Tiles in the 3 × 3 around the roller that its side does not own yet. */
  private freshAround(w: World, me: Roller, radius: number): number {
    const c = Math.floor((me.x - BOARD.x0) / BOARD.cell)
    const r = Math.floor((me.y - BOARD.y0) / BOARD.cell)
    let n = 0
    for (let dr = -radius; dr <= radius; dr++)
      for (let dc = -radius; dc <= radius; dc++) {
        const cc = c + dc
        const rr = r + dr
        if (cc < 0 || rr < 0 || cc >= BOARD.cols || rr >= BOARD.rows) continue
        if (w.own[idx(cc, rr)] !== me.side + 1) n++
      }
    return n
  }

  /** Best goal: many fresh tiles around it, not too far away. */
  private pick(w: World, me: Roller): void {
    let best = -Infinity
    let bx = me.x
    let by = me.y
    for (let r = 0; r < BOARD.rows; r++)
      for (let c = 0; c < BOARD.cols; c++) {
        const x = BOARD.x0 + (c + 0.5) * BOARD.cell
        const y = BOARD.y0 + (r + 0.5) * BOARD.cell
        const own = w.own[idx(c, r)]
        if (own === me.side + 1) continue
        let gain = 0
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const cc = c + dc
            const rr = r + dr
            if (cc < 0 || rr < 0 || cc >= BOARD.cols || rr >= BOARD.rows) continue
            if (w.own[idx(cc, rr)] !== me.side + 1) gain++
          }
        const d = Math.hypot(x - me.x, y - me.y)
        const score = gain / (1 + d / (BOARD.cell * 4))
        if (score > best) {
          best = score
          bx = x
          by = y
        }
      }
    this.goalX = bx
    this.goalY = by
    this.has = true
  }
}
