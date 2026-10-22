import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Grid, cellCenter, cellOf, solidCell } from '../../engines/arena/index.ts'
import { type Drive, type Level, hidden, inShadow, type Pawn, sees, type World } from './rules.ts'

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

interface Skill {
  /** Seconds between re-plans of the path (a human's reaction). */
  think: number
  /** Chance to take a shadow when it could hide. */
  hide: number
  /** Seconds ahead to lead a moving target. */
  lead: number
  /** Max aim error for the chase (world units). */
  err: number
  /** Walking distance (cells from the guard) at which the thief runs. */
  flee: number
  /** Guard heads for the loot the thief is nearest to (else the loot nearest itself). */
  intercept: boolean
  /** Guard's stick while patrolling out of sight of the thief (it strolls). */
  stroll: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { think: 0.5, hide: 0.45, lead: 0, err: 60, flee: 2, intercept: false, stroll: 0.6 },
  normal: { think: 0.14, hide: 0.9, lead: 0.45, err: 12, flee: 3, intercept: false, stroll: 0.75 },
  hard: { think: 0.06, hide: 1, lead: 0.7, err: 0, flee: 3, intercept: true, stroll: 0.95 },
}

/** Breadth-first search over floor cells. `dist` is -1 where unreachable. */
export function flood(
  g: Grid,
  start: number,
  block?: Uint8Array,
): { dist: Int32Array; from: Int32Array } {
  const n = g.cols * g.rows
  const dist = new Int32Array(n).fill(-1)
  const from = new Int32Array(n).fill(-1)
  dist[start] = 0
  const q: number[] = [start]
  for (let i = 0; i < q.length; i++) {
    const cur = q[i] as number
    const c = cur % g.cols
    const r = (cur - c) / g.cols
    for (const [dc, dr] of DIRS) {
      const nc = c + dc
      const nr = r + dr
      if (solidCell(g, nc, nr)) continue
      const ni = nr * g.cols + nc
      if (dist[ni] !== -1) continue
      if (block && block[ni] === 1) continue
      dist[ni] = (dist[cur] ?? 0) + 1
      from[ni] = cur
      q.push(ni)
    }
  }
  return { dist, from }
}

/** The first cell on the shortest path from `start` to `goal` (or null). */
function firstStep(from: Int32Array, start: number, goal: number): number | null {
  if (goal === start || from[goal] === -1) return null
  let cur = goal
  let guard = 0
  while (from[cur] !== start && guard++ < 4000) {
    const p = from[cur] ?? -1
    if (p < 0) return null
    cur = p
  }
  return cur
}

const idxOf = (g: Grid, x: number, y: number): number => {
  const { c, r } = cellOf(g, x, y)
  return r * g.cols + c
}

/**
 * The computer player for either role. The thief walks to the loot the guard
 * is least likely to reach first, keeps out of the guard's reach, and hides in
 * a shadow when the guard is close. The guard chases the thief when it sees
 * them (sprinting when close), and otherwise heads for the loot nearest the
 * thief. Bots run on the host only; nothing here goes in the snapshot.
 */
export class CatBot {
  private sk: Skill
  private plan = -1
  private planT = 0
  private err = { x: 0, y: 0 }
  private errT = 0
  /** Guard: the loot it is walking its round to, and where it last saw the thief. */
  private patrol = -1
  /** Guard: a cell near the last piece it walks to between visits (-1 = none). */
  private beat = -1
  private lastX = 0
  private lastY = 0
  private lastT = -9
  /** Thief: keeps running to this cell until `runT` (no dithering at the guard's reach). */
  private runCell = -1
  private runT = -9

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.sk = SKILL[d]
  }

  decide(w: World, level: Level, side: Side, dt: number): Drive {
    const none: Drive = { jx: 0, jy: 0, press: false }
    if (w.won !== null) return none
    this.errT -= dt
    if (this.errT <= 0) {
      this.err = { x: this.rng.range(-1, 1), y: this.rng.range(-1, 1) }
      this.errT = 0.6
    }
    const me = w.pawns[side]
    const foe = w.pawns[side === 0 ? 1 : 0]
    const g = level.grid
    const mine = idxOf(g, me.x, me.y)
    const theirs = idxOf(g, foe.x, foe.y)
    const dist = Math.hypot(foe.x - me.x, foe.y - me.y)
    return side === w.thief
      ? this.thief(w, level, me, mine, theirs)
      : this.guard(w, level, me, foe, mine, theirs, dist)
  }

  private thief(w: World, level: Level, me: Pawn, mine: number, theirs: number): Drive {
    const g = level.grid
    const side = w.thief
    // Keep one tile of clearance around the guard when routing.
    const block = new Uint8Array(g.cols * g.rows)
    const fc = theirs % g.cols
    const fr = (theirs - fc) / g.cols
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const c = fc + dc
        const r = fr + dr
        if (c >= 0 && r >= 0 && c < g.cols && r < g.rows) block[r * g.cols + c] = 1
      }
    block[mine] = 0
    const route = flood(g, mine, block)
    // Where the guard's clearance walls off a loot tile, route without it.
    const open = flood(g, mine)
    const guardF = flood(g, theirs)
    const hiding = hidden(w, side)
    const gd = guardF.dist[mine] ?? 99
    // Bold: the guard looks the other way and only guarded loot is left, so go for it.
    const gu = w.pawns[side === 0 ? 1 : 0]
    const away = Math.cos(gu.a) * (me.x - gu.x) + Math.sin(gu.a) * (me.y - gu.y) < 0
    const left = w.loot.filter((l) => l.got < 0)
    const guarded = left.every((l) => (guardF.dist[idxOf(g, l.x, l.y)] ?? 0) <= 3)
    const bold = away && guarded && !sees(level, w) && gd >= 2

    // Hide: stay still on a shadow tile while the guard is close.
    if (gd <= this.sk.flee + 1 && !hiding && me.ready <= w.t && inShadow(level, me.x, me.y)) {
      if (this.rng.chance(this.sk.hide)) return { jx: 0, jy: 0, press: true }
    }
    if (gd <= this.sk.flee + 1 && !hiding && !bold) {
      // Run for a shadow tile close by, if there is one.
      let best = -1
      let bd = 5
      for (let i = 0; i < level.shadow.length; i++) {
        if (level.shadow[i] !== 1) continue
        const d = route.dist[i] ?? -1
        if (d >= 0 && d < bd && (guardF.dist[i] ?? 0) > 1) {
          bd = d
          best = i
        }
      }
      if (best >= 0 && me.ready <= w.t) {
        const step = firstStep(route.from, mine, best)
        if (step !== null) return this.toward(g, step, me)
      }
    }

    // Keep running for a moment once started, instead of turning back at once.
    if (!bold && !hiding && this.runT > w.t && this.runCell >= 0 && this.runCell !== mine) {
      const step = firstStep(open.from, mine, this.runCell)
      if (step !== null) return this.toward(g, step, me)
    }
    // Run: the tile within reach where I stay furthest ahead of the guard.
    if (gd <= this.sk.flee && !hiding && !bold) {
      let best = -1
      let bestLead = 0
      for (let i = 0; i < route.dist.length; i++) {
        const md = route.dist[i] ?? -1
        if (md < 0 || md > 7) continue
        const lead = (guardF.dist[i] ?? 0) - md
        if (lead > bestLead) {
          bestLead = lead
          best = i
        }
      }
      if (best >= 0) {
        const step = firstStep(route.from, mine, best)
        if (step !== null) {
          this.runCell = best
          this.runT = w.t + 0.5
          return this.toward(g, step, me)
        }
      }
    }

    // Loot: the piece I reach soonest, penalised when the guard is closer to it.
    if (this.planT <= w.t || this.plan < 0 || (w.loot[this.plan]?.got ?? 0) >= 0) {
      let bestI = -1
      let bestS = Infinity
      w.loot.forEach((l, i) => {
        if (l.got >= 0) return
        const li = idxOf(g, l.x, l.y)
        const reach = (route.dist[li] ?? -1) >= 0 ? route : open
        const dMe = reach.dist[li] ?? -1
        if (dMe < 0) return
        const dG = guardF.dist[li] ?? 0
        const score = dMe + (dG < dMe ? 3 * (dMe - dG) + 6 : 0) + (dG <= 3 ? 40 : 0)
        if (score < bestS) {
          bestS = score
          bestI = i
        }
      })
      this.plan = bestI
      this.planT = w.t + this.sk.think
    }
    const target = w.loot[this.plan]
    if (!target || target.got >= 0) return { jx: 0, jy: 0, press: false }
    const li = idxOf(g, target.x, target.y)
    const reach = (route.dist[li] ?? -1) >= 0 ? route : open
    const step = firstStep(reach.from, mine, li)
    if (step === null) return { jx: 0, jy: 0, press: false }
    return this.toward(g, step, me)
  }

  private guard(
    w: World,
    level: Level,
    me: Pawn,
    foe: Pawn,
    mine: number,
    theirs: number,
    dist: number,
  ): Drive {
    const g = level.grid
    const seeing = sees(level, w)
    const close = dist < 200 && !hidden(w, w.thief)
    const sprint = (seeing || close) && dist < 220 && me.ready <= w.t
    let tx: number
    let ty: number
    let cell: number | null = null
    if (seeing) {
      this.lastX = foe.x
      this.lastY = foe.y
      this.lastT = w.t
    }
    if (seeing || close) {
      // Lead the thief a little, then follow the path to them.
      tx = foe.x + foe.vx * this.sk.lead
      ty = foe.y + foe.vy * this.sk.lead
      tx += this.err.x * this.sk.err
      ty += this.err.y * this.sk.err
      const f = flood(g, mine)
      cell = firstStep(f.from, mine, idxOf(g, tx, ty))
    } else if (w.t - this.lastT < 2.5 && Math.hypot(this.lastX - me.x, this.lastY - me.y) > 50) {
      // Lost sight: search where the thief was last seen.
      tx = this.lastX
      ty = this.lastY
      const f = flood(g, mine)
      cell = firstStep(f.from, mine, idxOf(g, tx, ty))
    } else {
      // Thief out of sight: walk a round of the loot, never camping on one piece.
      const left = w.loot.map((l, i) => (l.got < 0 ? i : -1)).filter((i) => i >= 0)
      const cur = w.loot[this.patrol]
      const there = cur && Math.hypot(cur.x - me.x, cur.y - me.y) < 60
      if (!cur || cur.got >= 0 || there) {
        const others = left.filter((i) => i !== this.patrol)
        const pool = others.length ? others : left
        if (this.sk.intercept && pool.length) {
          // Hard: the piece the thief is nearest to.
          const tf = flood(g, theirs)
          let bd = Infinity
          for (const i of pool) {
            const l = w.loot[i] as { x: number; y: number }
            const d = tf.dist[idxOf(g, l.x, l.y)] ?? -1
            if (d >= 0 && d < bd) {
              bd = d
              this.patrol = i
            }
          }
        } else this.patrol = pool.length ? this.rng.pick(pool) : -1
      }
      const l = w.loot[this.patrol]
      let goal = l ? idxOf(g, l.x, l.y) : theirs
      if (l && left.length === 1) {
        // One piece left: walk a beat round it rather than standing on it.
        if (this.beat === mine || (this.beat >= 0 && this.rng.chance(0.004))) this.beat = -1
        if (this.beat < 0 && goal === mine) {
          const near = flood(g, goal).dist
          const ring: number[] = []
          near.forEach((d, i) => {
            if (d >= 2 && d <= 3) ring.push(i)
          })
          if (ring.length) this.beat = this.rng.pick(ring)
        }
        if (this.beat >= 0) goal = this.beat
      } else this.beat = -1
      const gc = goal % g.cols
      tx = cellCenter(g, gc, (goal - gc) / g.cols).x
      ty = cellCenter(g, gc, (goal - gc) / g.cols).y
      const f = flood(g, mine)
      cell = firstStep(f.from, mine, goal)
    }
    const drive = cell !== null ? this.toward(g, cell, me) : this.aim(tx, ty, me)
    const k = seeing || close ? 1 : this.sk.stroll
    return { jx: drive.jx * k, jy: drive.jy * k, press: sprint }
  }

  /** Unit stick towards a neighbouring cell's centre. */
  private toward(g: Grid, cell: number, me: Pawn): Drive {
    const c = cell % g.cols
    const r = (cell - c) / g.cols
    const p = cellCenter(g, c, r)
    return this.aim(p.x, p.y, me)
  }

  private aim(x: number, y: number, me: Pawn): Drive {
    const dx = x - me.x
    const dy = y - me.y
    const L = Math.hypot(dx, dy)
    if (L < 4) return { jx: 0, jy: 0, press: false }
    const m = Math.min(1, L / 60 + 0.25)
    return { jx: (dx / L) * m, jy: (dy / L) * m, press: false }
  }
}
