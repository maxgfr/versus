import type { Difficulty, Side } from '../../core/game.ts'
import {
  COLS,
  DASH_CD,
  cellX,
  cellY,
  type Drive,
  type Floor,
  HURT,
  ROWS,
  RISE,
  SINK,
  TILE,
  X0,
  Y0,
} from './rules.ts'

interface Skill {
  /** Seconds of safety wanted when stepping onto a tile. */
  margin: number
  /** Also keep clear of the tiles beside the one underfoot (the blob is wider than its tile's edge). */
  edges: boolean
  /** How many tiles ahead to plan. */
  depth: number
  /** Seconds between plans (a human's reaction time). */
  think: number
  /** Dash out of a tile about to spike. */
  escape: boolean
  /** Dash into a rival standing by spikes about to rise. */
  shove: boolean
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { margin: 0.15, edges: false, depth: 5, think: 0.25, escape: false, shove: false },
  normal: { margin: 0.35, edges: true, depth: 7, think: 0.09, escape: true, shove: false },
  hard: { margin: 0.45, edges: true, depth: 8, think: 0.04, escape: true, shove: true },
}

/** Seconds to cross one tile at full speed (about 285 units/s). */
const STEP_T = TILE / 285
const NEIGH = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

/**
 * The computer blob. For every tile it works out when it will start to hurt,
 * then searches the tiles it can reach and heads for the nearest one that will
 * still be safe when it gets there. It can take either side; nothing here is
 * snapshotted (bots run on the host only).
 */
export class SpikeBot {
  private sk: Skill
  private goal = -1
  private planT = 0
  private risk: Float64Array = new Float64Array(COLS * ROWS)

  constructor(d: Difficulty) {
    this.sk = SKILL[d]
  }

  decide(f: Floor, side: Side, dt: number): Drive {
    const me = f.fighters[side]
    if (me.died >= 0) return { jx: 0, jy: 0 }
    const mine = cellOf(me.x, me.y)
    this.planT -= dt
    if (this.planT <= 0) {
      this.risk = danger(f)
      this.goal = this.plan(this.risk, mine)
      this.planT = this.sk.think
    }
    const ready = f.t - me.dashT >= DASH_CD
    // Shove: a rival right beside a tile about to spike gets bumped onto it.
    if (this.sk.shove && ready && this.planT === this.sk.think) {
      const foe = f.fighters[side === 0 ? 1 : 0]
      const fx = foe.x - me.x
      const fy = foe.y - me.y
      const d = Math.hypot(fx, fy)
      const near =
        this.risk[
          cellOf(foe.x + (fx / (d || 1)) * TILE * 0.8, foe.y + (fy / (d || 1)) * TILE * 0.8)
        ]
      const safeHere = (this.risk[mine] ?? Infinity) > 0.6
      if (foe.died < 0 && d < 170 && d > 1 && safeHere && near !== undefined && near < 0.35)
        return { jx: fx / d, jy: fy / d, dash: true }
    }
    const gi = this.goal
    if (gi < 0) return { jx: 0, jy: 0 }
    const dx = cellX(gi) + TILE / 2 - me.x
    const dy = cellY(gi) + TILE / 2 - me.y
    const L = Math.hypot(dx, dy)
    if (L < 6) return { jx: 0, jy: 0 }
    const m = Math.min(1, L / 50 + 0.3)
    // Escape: the tile underfoot is about to spike and the way out is a tile over.
    const dash = this.sk.escape && ready && (this.risk[mine] ?? Infinity) < 0.3 && L > 60
    return dash ? { jx: dx / L, jy: dy / L, dash } : { jx: (dx / L) * m, jy: (dy / L) * m }
  }

  /** The tile to step to next (or -1 to stay put). */
  private plan(danger: Float64Array, mine: number): number {
    const n = COLS * ROWS
    const dist = new Int32Array(n).fill(-1)
    const from = new Int32Array(n).fill(-1)
    dist[mine] = 0
    const q: number[] = [mine]
    // Seconds until `i` hurts, less the time we need to get there.
    const margin = (i: number, steps: number): number => {
      let d = danger[i] ?? Infinity
      if (this.sk.edges) {
        const c = i % COLS
        const r = (i - c) / COLS
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const cc = c + dc
            const rr = r + dr
            if (cc < 0 || rr < 0 || cc >= COLS || rr >= ROWS) continue
            d = Math.min(d, (danger[rr * COLS + cc] ?? Infinity) + 0.2)
          }
      }
      return d - steps * STEP_T
    }
    let best = -1
    let bestScore = Infinity
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi] as number
      const k = dist[cur] ?? 0
      const m = margin(cur, k)
      if (m > this.sk.margin && k * 1 - Math.min(m, 3) * 0.12 < bestScore) {
        bestScore = k - Math.min(m, 3) * 0.12
        best = cur
      }
      if (k >= this.sk.depth) continue
      const c = cur % COLS
      const r = (cur - c) / COLS
      for (const [dc, dr] of NEIGH) {
        const nc = c + dc
        const nr = r + dr
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue
        const ni = nr * COLS + nc
        if (dist[ni] !== -1) continue
        dist[ni] = k + 1
        from[ni] = cur
        q.push(ni)
      }
    }
    if (best < 0) {
      // Nowhere is safe for long enough: take the tile that stays quiet the longest.
      let bd = -Infinity
      for (const i of q) {
        const m = margin(i, dist[i] ?? 0)
        if (m > bd) {
          bd = m
          best = i
        }
      }
    }
    if (best < 0 || best === mine) return -1
    return firstStep(from, mine, best)
  }
}

/** Per tile: seconds until it hurts (0 = hurting now or about to), Infinity if it will not within the round's plan. */
function danger(f: Floor): Float64Array {
  const out = new Float64Array(COLS * ROWS).fill(Infinity)
  const t = f.t
  for (const p of f.pats) {
    // Hurting from when the spike has risen enough until it has sunk too far.
    const from = p.f + RISE * HURT
    const to = p.u + SINK * (1 - HURT)
    const d = t >= p.f ? (t < to ? 0 : Infinity) : from - t
    for (const i of p.cells) if (d < (out[i] ?? Infinity)) out[i] = d
  }
  return out
}

const cellOf = (x: number, y: number): number => {
  const c = Math.max(0, Math.min(COLS - 1, Math.floor((x - X0) / TILE)))
  const r = Math.max(0, Math.min(ROWS - 1, Math.floor((y - Y0) / TILE)))
  return r * COLS + c
}

/** The first tile on the way from `start` to `goal`. */
function firstStep(from: Int32Array, start: number, goal: number): number {
  let cur = goal
  let guard = 0
  while (from[cur] !== start && guard++ < 200) {
    const p = from[cur] ?? -1
    if (p < 0) return goal
    cur = p
  }
  return cur
}
