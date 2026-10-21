import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  BOARD,
  BOMB_T,
  blastCells,
  centreOf,
  cellOf,
  type Drive,
  dangerMap,
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
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { pace: 0.75, bombChance: 0.5, wait: 0.9 },
  normal: { pace: 0.9, bombChance: 0.8, wait: 0.4 },
  hard: { pace: 1, bombChance: 1, wait: 0.2 },
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

    if (danger[hi]) {
      const path = pathTo(w, here, (c, r) => danger[idx(c, r)] === 0)
      return this.step(me, path)
    }

    const canBomb =
      this.cool <= 0 &&
      me.bombsOut < me.bombsMax &&
      !w.bombs.some((b) => b.i === hi) &&
      this.wantsBomb(w, me, here.c, here.r, foe)
    if (canBomb && this.escapes(w, me, here) && this.rng.chance(this.sk.bombChance)) {
      this.cool = this.sk.wait
      return { jx: 0, jy: 0, bomb: true }
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
    for (const k of blastCells(w, i, me.range)) {
      if (k === idx(fc.c, fc.r)) return true
      if (w.tiles[k] === 2) return true
    }
    return false
  }

  /** After dropping a bomb here, is there a cell out of every blast within reach of the fuse? */
  private escapes(w: World, me: Player, here: Cell): boolean {
    const i = idx(here.c, here.r)
    const danger = dangerMap(w)
    for (const k of blastCells(w, i, me.range)) danger[k] = 1
    const reach = (c: number, r: number) => danger[idx(c, r)] === 0
    // Walk as if the bomb were already there: the cell it sits on is still left to walk out of.
    const path = pathTo(
      {
        ...w,
        bombs: [...w.bombs, { i, owner: me.id, t: BOMB_T, range: me.range, through: [me.id] }],
      },
      here,
      reach,
    )
    return path !== null && path.length > 0 && path.length <= ESCAPE_STEPS
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
