import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { BOARD, type Drive, idx, type Roller, splashCell, type World } from './rules.ts'

interface Skill {
  pace: number
  /** Seconds between new targets. */
  retarget: number
  /** Tile value a splash must win (of its 3 × 3) to be worth the cooldown. */
  splashMin: number
  /**
   * What a rival tile is worth next to a blank one: taking it also costs the
   * rival a tile, so a sharp painter hunts the rival's paint.
   */
  steal: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { pace: 0.7, retarget: 0.9, splashMin: 6, steal: 1 },
  normal: { pace: 1, retarget: 0.45, splashMin: 5, steal: 1.6 },
  hard: { pace: 1, retarget: 0.3, splashMin: 5.5, steal: 2.2 },
}

/**
 * One computer roller (one per roller, so 2 vs 2 teammates each keep their own
 * goal): heads for the best nearby patch of floor it does not own yet (rival
 * paint weighted by `steal`), keeps away from its teammate's patch, and
 * splashes when the 3 × 3 it would throw from where it rolls wins enough.
 * Bots run on the host only.
 */
export class PaintBot {
  private sk: Skill
  goalX = 0
  goalY = 0
  private t = 0
  private has = false

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.sk = SKILL[d]
  }

  decide(w: World, me: Roller, dt: number, mate?: { x: number; y: number }): Drive {
    this.t -= dt
    if (this.t <= 0 || !this.has) {
      this.pick(w, me, mate)
      this.t = this.sk.retarget * this.rng.range(0.8, 1.2)
    }
    const dx = this.goalX - me.x
    const dy = this.goalY - me.y
    const m = Math.hypot(dx, dy)
    const near = m < 14
    const { c, r } = splashCell(me)
    const splash = me.cd <= 0 && this.value(w, me, c, r) >= this.sk.splashMin
    return {
      jx: near ? 0 : (dx / m) * this.sk.pace,
      jy: near ? 0 : (dy / m) * this.sk.pace,
      splash,
    }
  }

  /** What the 3 × 3 around (c, r) is worth to `me`: blank tiles 1, rival tiles `steal`. */
  private value(w: World, me: Roller, c: number, r: number): number {
    let v = 0
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc
        const rr = r + dr
        if (cc < 0 || rr < 0 || cc >= BOARD.cols || rr >= BOARD.rows) continue
        const o = w.own[idx(cc, rr)]
        if (o === 0) v++
        else if (o !== me.side + 1) v += this.sk.steal
      }
    return v
  }

  /** Best goal: worth a lot around it, not too far away, not on the teammate's patch. */
  private pick(w: World, me: Roller, mate?: { x: number; y: number }): void {
    let best = -Infinity
    let bx = me.x
    let by = me.y
    for (let r = 0; r < BOARD.rows; r++)
      for (let c = 0; c < BOARD.cols; c++) {
        const x = BOARD.x0 + (c + 0.5) * BOARD.cell
        const y = BOARD.y0 + (r + 0.5) * BOARD.cell
        if (w.own[idx(c, r)] === me.side + 1) continue
        const gain = this.value(w, me, c, r)
        const d = Math.hypot(x - me.x, y - me.y)
        let score = gain / (1 + d / (BOARD.cell * 4))
        if (mate && Math.hypot(x - mate.x, y - mate.y) < BOARD.cell * 3) score *= 0.4
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
