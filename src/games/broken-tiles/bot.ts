import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Board, COLS, CRACK, INTACT, nearestTile, ROWS, STAND, tileCentre } from './rules.ts'

interface Skill {
  /**
   * How a next tile is judged. 'room': free tiles around it (short-sighted).
   * 'smart': while the rival can still reach us, claim territory (tiles we get
   * to first, Tron style); once cut off, take the longest walk left.
   */
  mode: 'room' | 'smart'
  /** Longest-walk lookahead once cut off (tile steps). */
  depth: number
  /** Random wobble on each candidate's score: bigger means worse choices. */
  noise: number
  /** Chance to pick any free neighbour instead of the best one. */
  blunder: number
  /** Max pause on arriving at a tile (s), like a human deciding. */
  hesitate: number
  /** Chance to dash off a tile that is about to drop. */
  escape: number
  /** Chance per decision to dash at a nearby rival to win a race for space. */
  press: number
  /** Once cut off, the share of STAND to spend on each tile (0 = keep rushing). */
  linger: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: {
    mode: 'room',
    depth: 1,
    noise: 2.5,
    blunder: 0.15,
    hesitate: 0.35,
    escape: 0,
    press: 0,
    linger: 0,
  },
  normal: {
    mode: 'smart',
    depth: 3,
    noise: 3,
    blunder: 0.04,
    hesitate: 0.12,
    escape: 0.5,
    press: 0,
    linger: 0.6,
  },
  hard: {
    mode: 'smart',
    depth: 8,
    noise: 0.1,
    blunder: 0,
    hesitate: 0,
    escape: 1,
    press: 0.25,
    linger: 1,
  },
}

const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

const N = COLS * ROWS

/** Intact 4-neighbours of tile `i`, skipping `skip`. */
function around(st: readonly number[], i: number, skip = -1): number[] {
  const out: number[] = []
  const c = i % COLS
  const r = Math.floor(i / COLS)
  for (const [dc, dr] of DIRS) {
    const nc = c + dc
    const nr = r + dr
    if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue
    const ni = nr * COLS + nc
    if (ni !== skip && st[ni] === INTACT) out.push(ni)
  }
  return out
}

/** Steps over intact tiles from `start` (allowed whatever its state), `skip` blocked. -1 = unreachable. */
function distances(st: readonly number[], start: number, skip: number): number[] {
  const dist = Array.from({ length: N }, () => -1)
  if (start < 0) return dist
  dist[start] = 0
  const q = [start]
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi] as number
    for (const ni of around(st, cur, skip)) {
      if (dist[ni] !== -1) continue
      dist[ni] = (dist[cur] as number) + 1
      q.push(ni)
    }
  }
  return dist
}

/** Longest simple walk over intact tiles from `from`, up to `depth` steps (`seen` is scratch). */
function longest(st: readonly number[], from: number, depth: number, seen: Uint8Array): number {
  if (depth <= 0) return 0
  seen[from] = 1
  let best = 0
  for (const ni of around(st, from)) {
    if (seen[ni]) continue
    best = Math.max(best, 1 + longest(st, ni, depth - 1, seen))
    if (best >= depth) break
  }
  seen[from] = 0
  return best
}

/** Stick vector from (x, y) toward tile `i`'s centre, easing out over the last few units. */
function aim(x: number, y: number, i: number): { x: number; y: number } {
  if (i < 0) return { x: 0, y: 0 }
  const t = tileCentre(i)
  const dx = t.x - x
  const dy = t.y - y
  const d = Math.hypot(dx, dy)
  if (d < 1e-6) return { x: 0, y: 0 }
  const m = Math.min(1, d / 14)
  return { x: (dx / d) * m, y: (dy / d) * m }
}

/** What the bot does this step: stick vector and dash force (0 = no dash). */
export interface BotMove {
  x: number
  y: number
  dash: number
}

/**
 * The computer player for one side. It walks tile centre to tile centre over
 * intact tiles only (the tile it leaves cracks behind it), choosing each next
 * tile with the real rules: the tile it stands on is lost once it leaves, so
 * on 'smart' it claims the tiles it can reach before the rival (Voronoi
 * territory, which steers it to cut the board in its favour), and once the
 * two are cut off it plays its island for the longest walk. With no free
 * neighbour left it stands its ground: standing still lasts STAND + DROP,
 * which can still outlive the rival.
 */
export class TileBot {
  private next = -1
  private leaveAt = 0
  private paused = false
  private seen = new Uint8Array(N)

  constructor(
    private rng: Rng,
    private sk: Skill,
  ) {}

  static of(rng: Rng, d: Difficulty): TileBot {
    return new TileBot(rng, SKILL[d])
  }

  /**
   * The move for this step (stick magnitude at most 1). `now` is the game time
   * the board's `since` stamps use.
   */
  drive(b: Board, side: Side, now: number): BotMove {
    const me = b.p[side]
    if (!me.alive) return { x: 0, y: 0, dash: 0 }
    const here = nearestTile(me.x, me.y)
    const onDrop = b.st[here] === CRACK
    const stale = this.next < 0 || b.st[this.next] !== INTACT || this.arrived(me.x, me.y)
    if (!stale) return { ...aim(me.x, me.y, this.next), dash: 0 }
    if (!this.paused) {
      // Just arrived: decide how long to stay on this tile.
      this.paused = true
      this.leaveAt = me.since + this.linger(b, side, here)
    }
    // Stay put (centred) while it is worth it, but never on a tile about to drop.
    if (now < this.leaveAt && !onDrop) return { ...aim(me.x, me.y, here), dash: 0 }
    this.next = this.choose(b, side, here)
    if (this.next < 0) return { ...aim(me.x, me.y, here), dash: 0 }
    this.paused = false
    const press = this.sk.press > 0 && this.near(b, side, 3) && this.rng.chance(this.sk.press)
    const escape = onDrop && this.rng.chance(this.sk.escape)
    return { ...aim(me.x, me.y, this.next), dash: press || escape ? 1 : 0 }
  }

  /**
   * Seconds after arriving on `here` before stepping on. Every tile left is a
   * tile lost, so once the two are cut off a smart bot makes each one last,
   * leaving just before standing would crack it. Easy only hesitates.
   */
  private linger(b: Board, side: Side, here: number): number {
    const rnd = this.rng.range(0, this.sk.hesitate)
    if (this.sk.mode !== 'smart') return rnd
    const foe = b.p[side === 0 ? 1 : 0]
    const cut = !foe.alive || (distances(b.st, here, -1)[nearestTile(foe.x, foe.y)] ?? -1) < 0
    return cut ? Math.max(rnd, STAND * this.sk.linger - 0.4) : rnd
  }

  /** Arrived on the planned tile's centre. */
  private arrived(x: number, y: number): boolean {
    const c = tileCentre(this.next)
    return Math.hypot(c.x - x, c.y - y) < 8
  }

  /** Is the rival alive and within `n` tile steps (grid distance)? */
  private near(b: Board, side: Side, n: number): boolean {
    const me = b.p[side]
    const foe = b.p[side === 0 ? 1 : 0]
    if (!foe.alive) return false
    const a = nearestTile(me.x, me.y)
    const f = nearestTile(foe.x, foe.y)
    const d =
      Math.abs((a % COLS) - (f % COLS)) + Math.abs(Math.floor(a / COLS) - Math.floor(f / COLS))
    return d <= n
  }

  /** The next tile to step onto (a free neighbour of `here`), or -1 to stand still. */
  choose(b: Board, side: Side, here: number): number {
    const opts = around(b.st, here)
    if (opts.length === 0) return -1
    if (opts.length === 1 || this.rng.chance(this.sk.blunder))
      return opts[this.rng.int(0, opts.length - 1)] as number
    const foe = b.p[side === 0 ? 1 : 0]
    const foeTile = foe.alive ? nearestTile(foe.x, foe.y) : -1
    // The rival's distances, with our tile gone (it cracks as we leave).
    const dr = this.sk.mode === 'smart' ? distances(b.st, foeTile, here) : null
    let best = -1
    let bestScore = -Infinity
    for (const n of opts) {
      let score: number
      if (!dr) {
        score = this.room(b.st, n, here)
      } else {
        const dm = distances(b.st, n, here)
        let mine = 0
        let theirs = 0
        let size = 0
        for (let j = 0; j < N; j++) {
          const a = dm[j] as number
          const r = dr[j] as number
          if (a >= 0) size++
          // We need one more step than the distances from n say.
          if (a >= 0 && (r < 0 || a + 1 < r)) mine++
          else if (r >= 0 && (a < 0 || r < a + 1)) theirs++
        }
        // Territory (once cut off, simply my island against theirs), but never
        // at the price of a dead end: look a few steps down the walk too.
        this.seen.fill(0)
        this.seen[here] = 1
        const walk = longest(b.st, n, Math.min(this.sk.depth, size), this.seen)
        score = mine - theirs + 4 * walk
      }
      score += this.rng.range(-this.sk.noise, this.sk.noise)
      if ((globalThis as { BTDBG?: boolean }).BTDBG)
        console.log('LOG choose', side, here, n, score.toFixed(2))
      if (score > bestScore) {
        bestScore = score
        best = n
      }
    }
    return best
  }

  /** Free tiles within two steps of `n` (not counting `skip`). */
  private room(st: readonly number[], n: number, skip: number): number {
    let c = 0
    for (const a of around(st, n, skip))
      c += 1 + around(st, a, skip).filter((x) => x !== n).length * 0.5
    return c
  }
}
