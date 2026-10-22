import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  BOARD,
  BOMB_T,
  type Bomb,
  blastCells,
  FLAME_T,
  centreOf,
  cellOf,
  type Drive,
  dangerMap,
  hurryNext,
  idx,
  inBoard,
  type Player,
  walkable,
  type World,
} from './rules.ts'

interface Skill {
  /** Share of full stick. */
  pace: number
  /** Chance to actually drop a bomb when a good spot is reached. */
  bombChance: number
  /** Seconds between two bombs. */
  wait: number
  /** Steps it will detour to grab a power-up (0 = ignores them). */
  greed: number
  /** Hurry-up cells ahead it keeps clear of. */
  foresight: number
  /** Times its escapes against the fuses (chains included) instead of just fleeing the crosses. */
  careful: boolean
}

const SKILL: Record<Difficulty, Skill> = {
  easy: {
    pace: 0.75,
    bombChance: 0.5,
    wait: 0.9,
    greed: 0,
    foresight: 2,
    careful: false,
  },
  normal: {
    pace: 0.9,
    bombChance: 0.85,
    wait: 0.5,
    greed: 4,
    foresight: 5,
    careful: true,
  },
  hard: { pace: 1, bombChance: 1, wait: 0.1, greed: 10, foresight: 8, careful: true },
}

/** Steps a bot may need to be out of a fresh blast: it must beat the fuse. */
const ESCAPE_STEPS = 3

type Cell = { c: number; r: number }

/**
 * Breadth-first search over walkable cells (skipping cells flagged in `avoid`).
 * Returns the cells to walk to (empty if already there), or null.
 */
export function pathTo(
  w: World,
  from: Cell,
  goal: (c: number, r: number) => boolean,
  avoid?: Uint8Array,
): Cell[] | null {
  const start = idx(from.c, from.r)
  const prev = new Int32Array(BOARD.cols * BOARD.rows).fill(-2)
  prev[start] = -1
  const q: number[] = [start]
  let found = -1
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi] as number
    const c = cur % BOARD.cols
    const r = (cur - c) / BOARD.cols
    if (cur !== start && goal(c, r)) {
      found = cur
      break
    }
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nc = c + dc
      const nr = r + dr
      if (!inBoard(nc, nr) || !walkable(w, nc, nr)) continue
      const ni = idx(nc, nr)
      if (avoid?.[ni]) continue
      if (prev[ni] !== -2) continue
      prev[ni] = cur
      q.push(ni)
    }
  }
  if (found < 0) return goal(from.c, from.r) ? [] : null
  const out: Cell[] = []
  for (let cur = found; cur !== start; cur = prev[cur] as number) {
    const c = cur % BOARD.cols
    out.unshift({ c, r: (cur - c) / BOARD.cols })
  }
  return out
}

/** When each cell is on fire: from `from[i]` to `to[i]` seconds from now (Infinity = never). */
export interface Fire {
  from: Float32Array
  to: Float32Array
}

/**
 * Fire timeline of the board: burning flames now, and every ticking bomb's
 * cross at the moment it goes off, chain reactions included (a bomb caught in
 * an earlier blast goes off with it).
 */
export function fireTimes(w: World, extra?: Bomb): Fire {
  const n = BOARD.cols * BOARD.rows
  const from = new Float32Array(n).fill(Infinity)
  const to = new Float32Array(n).fill(-Infinity)
  for (const f of w.flames) {
    from[f.i] = 0
    to[f.i] = Math.max(to[f.i] as number, f.t)
  }
  const bombs = extra ? [...w.bombs, extra] : w.bombs
  const te = bombs.map((b) => b.t)
  const cells = bombs.map((b) => blastCells(w, b.i, b.range))
  for (let changed = true; changed;) {
    changed = false
    bombs.forEach((_, a) => {
      for (const k of cells[a] as number[])
        bombs.forEach((b, j) => {
          if (b.i === k && (te[j] as number) > (te[a] as number)) {
            te[j] = te[a] as number
            changed = true
          }
        })
    })
  }
  bombs.forEach((_, a) => {
    const t = te[a] as number
    for (const k of cells[a] as number[]) {
      if (t < (from[k] as number)) from[k] = t
      if (t + FLAME_T > (to[k] as number)) to[k] = t + FLAME_T
    }
  })
  return { from, to }
}

/**
 * Breadth-first search that keeps time: walking a cell takes `cellT` seconds,
 * and a cell may only be crossed when it is not on fire while the walker is
 * in it (with a safety margin). Returns the cells to walk to a goal, or null.
 */
export function safePath(
  w: World,
  from: Cell,
  cellT: number,
  fire: Fire,
  goal: (c: number, r: number) => boolean,
  margin = 0.18,
): Cell[] | null {
  const start = idx(from.c, from.r)
  const n = BOARD.cols * BOARD.rows
  const prev = new Int32Array(n).fill(-2)
  const steps = new Int32Array(n)
  prev[start] = -1
  const q: number[] = [start]
  let found = -1
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi] as number
    const c = cur % BOARD.cols
    const r = (cur - c) / BOARD.cols
    if (goal(c, r)) {
      found = cur
      break
    }
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nc = c + dc
      const nr = r + dr
      if (!inBoard(nc, nr) || !walkable(w, nc, nr)) continue
      const ni = idx(nc, nr)
      if (prev[ni] !== -2) continue
      // In that cell from (k - 0.5) to (k + 0.5) cells' time, give or take the margin.
      const k = (steps[cur] as number) + 1
      const enter = (k - 0.5) * cellT - margin
      const leave = (k + 0.5) * cellT + margin
      if ((fire.from[ni] as number) < leave && (fire.to[ni] as number) > enter) continue
      prev[ni] = cur
      steps[ni] = k
      q.push(ni)
    }
  }
  if (found < 0) return null
  const out: Cell[] = []
  for (let cur = found; cur !== start; cur = prev[cur] as number) {
    const c = cur % BOARD.cols
    out.unshift({ c, r: (cur - c) / BOARD.cols })
  }
  return out
}

/**
 * One computer player: leaves blast cells first, drops a bomb only where a
 * crate or the rival lies in its cross and it can get clear before the fuse,
 * and otherwise walks toward such a spot (or toward the rival). Bots run on the
 * host only, so none of this lives in the snapshot.
 */
export class BombBot {
  private sk: Skill
  private cool = 0

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.sk = SKILL[d]
  }

  decide(w: World, me: Player, dt: number): Drive {
    const foe = w.players.find((p) => p.alive && p.id !== me.id)
    if (!me.alive || !foe) return { jx: 0, jy: 0, bomb: false }
    this.cool = Math.max(0, this.cool - dt)
    const here = cellOf(me.x, me.y)
    const hi = idx(here.c, here.r)
    const danger = dangerMap(w)
    // Cells the hurry-up is about to crush count as fire.
    for (const i of hurryNext(w, this.sk.foresight)) danger[i] = 1

    if (danger[hi]) {
      // Get out along a route that is not on fire while walking it.
      const fire = fireTimes(w)
      const safe = (c: number, r: number) => danger[idx(c, r)] === 0
      const path =
        (this.sk.careful ? safePath(w, here, this.cellT(me), fire, safe) : null) ??
        pathTo(w, here, safe)
      return this.step(me, path)
    }

    const free = this.cool <= 0 && me.bombsOut < me.bombsMax && !w.bombs.some((b) => b.i === hi)
    const canBomb = free && this.wantsBomb(w, me, here.c, here.r, foe)
    if (canBomb && this.escapes(w, me, here) && this.rng.chance(this.sk.bombChance)) {
      this.cool = this.sk.wait
      return { jx: 0, jy: 0, bomb: true }
    }

    // Power-ups within a short safe walk are worth the detour.
    if (this.sk.greed > 0 && w.items.length) {
      const items = new Set(w.items.map((it) => it.i))
      const grab = pathTo(w, here, (c, r) => items.has(idx(c, r)), danger)
      if (grab && grab.length > 0 && grab.length <= this.sk.greed) return this.step(me, grab, here)
    }
    // Out of danger, never step back into a blast cell: wait it out instead.
    const spot = pathTo(w, here, (c, r) => this.wantsBomb(w, me, c, r, foe), danger)
    if (spot) return this.step(me, spot, here)
    const fc = cellOf(foe.x, foe.y)
    return this.step(
      me,
      pathTo(w, here, (c, r) => c === fc.c && r === fc.r, danger),
      here,
    )
  }

  /** A bomb here would hit a crate or the rival in its cross. */
  private wantsBomb(w: World, me: Player, c: number, r: number, foe: Player): boolean {
    const i = idx(c, r)
    const fc = cellOf(foe.x, foe.y)
    const fi = idx(fc.c, fc.r)
    const cells = blastCells(w, i, me.range)
    for (const k of cells) {
      if (k === fi) return true
      if (w.tiles[k] === 2) return true
    }
    return false
  }

  /** After dropping a bomb here, is there a cell out of every blast within reach of the fuse? */
  private escapes(w: World, me: Player, here: Cell): boolean {
    const i = idx(here.c, here.r)
    const bomb: Bomb = { i, owner: me.id, t: BOMB_T, range: me.range, through: [me.id] }
    const danger = dangerMap(w)
    for (const k of blastCells(w, i, me.range)) danger[k] = 1
    for (const k of hurryNext(w, this.sk.foresight)) danger[k] = 1
    const reach = (c: number, r: number) => danger[idx(c, r)] === 0
    if (!this.sk.careful) {
      const path = pathTo({ ...w, bombs: [...w.bombs, bomb] }, here, reach)
      return path !== null && path.length > 0 && path.length <= ESCAPE_STEPS
    }
    // Walk as if the bomb were already there (chains included), timing every
    // cell on the way: the cell it sits on is still left to walk out of.
    const path = safePath(w, here, this.cellT(me), fireTimes(w, bomb), reach)
    return path !== null && path.length > 0 && path.length <= ESCAPE_STEPS + 1
  }

  /** Seconds this player takes to walk one cell, with a little slack. */
  private cellT(me: Player): number {
    return (BOARD.cell / (me.speed * this.sk.pace)) * 1.15
  }

  /**
   * Walk the first cell of a path (toward its centre). With nowhere to go,
   * settle in the middle of `here` rather than idle on a cell border.
   */
  private step(me: Player, path: Cell[] | null, here?: Cell): Drive {
    const next = path?.[0] ?? here
    if (!next) return { jx: 0, jy: 0, bomb: false }
    const t = centreOf(next.c, next.r)
    if (!path?.[0] && Math.hypot(t.x - me.x, t.y - me.y) < 6) return { jx: 0, jy: 0, bomb: false }
    const dx = t.x - me.x
    const dy = t.y - me.y
    const m = Math.hypot(dx, dy) || 1
    return { jx: (dx / m) * this.sk.pace, jy: (dy / m) * this.sk.pace, bomb: false }
  }
}
