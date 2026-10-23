import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Neon Snake, pure rules. Two snakes share one grid. Each tick both move one
 * cell in the direction their player asked for (up to two turns are queued,
 * so a quick double swipe makes a U-turn). Eating a dot grows the snake by
 * one. Running into a wall or any body ends it, except a tail that moves away
 * on that same tick; if both heads reach the same cell the round is a draw.
 * The ticks speed up as a round goes on so no round drags. Nothing here draws
 * or touches the browser.
 */

export const COLS = 18
export const ROWS = 28
export const CELL = 50
/** Top-left of the grid in world units (centred; the pills sit above and below). */
export const X0 = (1000 - COLS * CELL) / 2
export const Y0 = 200
/** Seconds between two moves at the start of a round. */
export const TICK = 0.13
/** Fastest tick, reached RAMP seconds into a round. */
export const TICK_MIN = 0.08
export const RAMP = 45

/**
 * Against the computer its level also sets the pace: every tick of the ramp is
 * shortened (hard) or stretched (easy). Local 2P and online play at 1.
 */
export const TEMPO: Record<Difficulty, number> = { easy: 0.85, normal: 1, hard: 1.25 }

/** The tempo of a match, fixed once at setup. */
export function tempoOf(d: Difficulty, bots: readonly boolean[]): number {
  return bots.some(Boolean) ? TEMPO[d] : 1
}
/** Once at top speed, both snakes grow a cell every this many ticks, so no round runs forever. */
export const GROW_EVERY = 6
/** Countdown before a round starts moving (s). */
export const COUNT = 2.4
/** Dots on the board at any time. */
export const DOTS = 3

/**
 * Wall blocks on both side edges at mid-height (rows BLOCK_Y0..BLOCK_Y1 of the
 * first and last column): the left one sits under the pause button, the right
 * one mirrors it. They count as outside the board.
 */
export const BLOCK_Y0 = 12
export const BLOCK_Y1 = 15

/** Directions: 0 north, 1 east, 2 south, 3 west. */
export const DX = [0, 1, 0, -1] as const
export const DY = [-1, 0, 1, 0] as const

export interface Cell {
  x: number
  y: number
}

/** A dot, stamped with the time it appeared (for its pop-in). */
export interface Dot extends Cell {
  t?: number
}

export interface Snake {
  side: Side
  /** Head first. */
  body: Cell[]
  /** Direction the snake is moving in. */
  dir: number
  /** Direction its player asked for; applied on the next tick. */
  want: number
  /** A second queued turn, applied on the tick after `want` (-1 = none). */
  next: number
  alive: boolean
  /** Time it crashed (s), -1 while alive. */
  diedT: number
  /** Dots eaten. */
  eaten: number
  /** Time of its last tick that turned it (s), for the head's squash. */
  turnT: number
  /** Time of its last tick that grew it (a meal or the late-round growth), s. */
  grewT: number
}

export interface Board {
  snakes: [Snake, Snake]
  dots: Dot[]
  /** Seconds since the last tick, for drawing. */
  acc: number
  /** Time the snakes start moving (s). */
  go: number
  /** Seconds between moves right now (shrinks as the round goes on). */
  len: number
  /** Head start on the speed ramp (s): a match-point round starts quicker. */
  boost: number
  /** Ticks played this round. */
  n: number
}

export type Ev =
  | { k: 'eat'; side: Side; x: number; y: number; n: number }
  | { k: 'crash'; side: Side; x: number; y: number; n: number; speed: number }

export const reverse = (d: number): number => (d + 2) % 4

export function cellCentre(c: Cell): { x: number; y: number } {
  return { x: X0 + (c.x + 0.5) * CELL, y: Y0 + (c.y + 0.5) * CELL }
}

/** The direction (0..3) a stick or swipe vector points to, favouring the dominant axis. */
export function dirOf(x: number, y: number): number {
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 1 : 3
  return y > 0 ? 2 : 0
}

/** Top speed reached: the snakes now grow on their own every GROW_EVERY ticks. */
export function growing(b: Board, now: number): boolean {
  return now - b.go + (b.boost ?? 0) >= RAMP
}

/**
 * Seconds between moves `t` seconds into a round: from TICK down to TICK_MIN
 * over RAMP s, divided by the match tempo.
 */
export function tickLen(t: number, tempo = 1): number {
  const k = Math.min(1, Math.max(0, t / RAMP))
  return (TICK + (TICK_MIN - TICK) * k) / tempo
}

export function inside(c: Cell): boolean {
  if (c.x < 0 || c.y < 0 || c.x >= COLS || c.y >= ROWS) return false
  return !((c.x === 0 || c.x === COLS - 1) && c.y >= BLOCK_Y0 && c.y <= BLOCK_Y1)
}

/** Every cell a snake body occupies (heads and tails included). */
export function occupied(b: Board, x: number, y: number): boolean {
  for (const s of b.snakes) for (const c of s.body) if (c.x === x && c.y === y) return true
  return false
}

/** A cell a head may enter: on the board and not under a body. Dots are fine. */
export function passable(b: Board, x: number, y: number): boolean {
  return inside({ x, y }) && !occupied(b, x, y)
}

export function newBoard(now: number, rng: Rng): Board {
  const mk = (side: Side, x: number, y: number, dir: number): Snake => {
    const back = reverse(dir)
    const body = [0, 1, 2].map((i) => ({
      x: x + (DX[back] ?? 0) * i,
      y: y + (DY[back] ?? 0) * i,
    }))
    return {
      side,
      body,
      dir,
      want: dir,
      next: -1,
      alive: true,
      diedT: -1,
      eaten: 0,
      turnT: -9,
      grewT: -9,
    }
  }
  const b: Board = {
    snakes: [mk(0, 9, ROWS - 6, 0), mk(1, COLS - 1 - 9, ROWS - 1 - (ROWS - 6), 2)],
    dots: [],
    acc: 0,
    go: now + COUNT,
    len: TICK,
    boost: 0,
    n: 0,
  }
  for (let i = 0; i < DOTS; i++) spawnDot(b, rng, now + COUNT - 0.4 + i * 0.12)
  return b
}

const free = (b: Board, x: number, y: number): boolean =>
  passable(b, x, y) && !b.dots.some((d) => d.x === x && d.y === y)

/** Put a dot on a random free cell (an exhaustive pick when the board is crowded). */
export function spawnDot(b: Board, rng: Rng, now = 0): void {
  for (let tries = 0; tries < 200; tries++) {
    const x = rng.int(0, COLS - 1)
    const y = rng.int(0, ROWS - 1)
    if (free(b, x, y)) {
      b.dots.push({ x, y, t: now })
      return
    }
  }
  const cells: Cell[] = []
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) if (free(b, x, y)) cells.push({ x, y })
  if (!cells.length) return
  const c = cells[rng.int(0, cells.length - 1)] as Cell
  b.dots.push({ x: c.x, y: c.y, t: now })
}

/**
 * Ask for a direction. A reversal (straight back into the body) is ignored.
 * While a turn is pending, a further, different turn is queued behind it (a
 * quick double swipe makes a U-turn). Asking again for the pending turn or the
 * current heading changes nothing, so a held stick never undoes the queue.
 */
export function want(s: Snake, d: number): void {
  if (!s.alive) return
  if (s.want === s.dir) {
    if (d !== reverse(s.dir)) s.want = d
    return
  }
  // A turn is pending.
  if (d === s.want || d === s.dir) return
  if (d === reverse(s.want)) {
    // The opposite turn: a change of mind, not a U-turn.
    s.want = d
    s.next = -1
  } else s.next = d
}

/**
 * Advance one tick: apply each snake's wanted direction, then move the heads.
 * A head that leaves the board or enters a body crashes, unless that cell is a
 * tail moving away this tick (its snake survives and does not eat); two heads
 * on the same cell both crash. Returns the side still standing: 'draw' when
 * nobody is, null while the round goes on.
 */
export function tick(b: Board, now: number, ev: Ev[], rng: Rng): Side | 'draw' | null {
  b.n = (b.n ?? 0) + 1
  const grow = growing(b, now) && b.n % GROW_EVERY === 0
  for (const s of b.snakes) {
    if (!s.alive) continue
    if (s.want !== reverse(s.dir) && s.want !== s.dir) {
      s.dir = s.want
      s.turnT = now
    }
    if (s.next >= 0) {
      s.want = s.next
      s.next = -1
    } else s.want = s.dir
  }
  const heads = b.snakes.map((s) => {
    const h = s.body[0] ?? { x: 0, y: 0 }
    return { x: h.x + (DX[s.dir] ?? 0), y: h.y + (DY[s.dir] ?? 0) }
  })
  // A snake that eats (or grows this tick) keeps its tail where it is.
  const eats = b.snakes.map(
    (s, i) => s.alive && (grow || b.dots.some((d) => d.x === heads[i]?.x && d.y === heads[i]?.y)),
  )
  const die = new Set<number>()
  const [h0, h1] = heads
  if (b.snakes[0].alive && b.snakes[1].alive && h0 && h1 && h0.x === h1.x && h0.y === h1.y) {
    die.add(0)
    die.add(1)
  }
  /** Is (x, y) solid this tick? A tail is not while its snake moves on without eating. */
  const solid = (x: number, y: number): boolean => {
    for (let j = 0; j < b.snakes.length; j++) {
      const s = b.snakes[j] as Snake
      const last = s.body.length - 1
      for (let k = 0; k <= last; k++) {
        const c = s.body[k] as Cell
        if (c.x !== x || c.y !== y) continue
        if (k === last && k > 0 && s.alive && !die.has(j) && !eats[j]) continue
        return true
      }
    }
    return false
  }
  // Deaths can pin a tail in place and so cause more deaths: settle them.
  for (let changed = true; changed;) {
    changed = false
    b.snakes.forEach((s, i) => {
      if (!s.alive || die.has(i)) return
      const h = heads[i] ?? { x: 0, y: 0 }
      if (!inside(h) || solid(h.x, h.y)) {
        die.add(i)
        changed = true
      }
    })
  }
  const speed = TICK / b.len
  let eaten = 0
  b.snakes.forEach((s, i) => {
    if (!s.alive) return
    const h = heads[i] ?? { x: 0, y: 0 }
    if (die.has(i)) {
      s.alive = false
      s.diedT = now
      const c = cellCentre(h)
      ev.push({ k: 'crash', side: s.side, x: c.x, y: c.y, n: s.body.length, speed })
      return
    }
    s.body.unshift(h)
    const di = b.dots.findIndex((d) => d.x === h.x && d.y === h.y)
    if (di >= 0) {
      b.dots.splice(di, 1)
      s.eaten++
      eaten++
      s.grewT = now
      const c = cellCentre(h)
      ev.push({ k: 'eat', side: s.side, x: c.x, y: c.y, n: s.body.length })
    } else if (grow) s.grewT = now
    else s.body.pop()
  })
  // One new dot per dot eaten, only once every body has moved, so none lands under a head.
  for (let i = 0; i < eaten; i++) spawnDot(b, rng, now)
  return roundWinner(b)
}

/** The side still moving: 'draw' when both crashed, null while both are alive. */
export function roundWinner(b: Board): Side | 'draw' | null {
  const [a, c] = b.snakes
  if (a.alive && c.alive) return null
  if (!a.alive && !c.alive) return 'draw'
  return a.alive ? 0 : 1
}

/** Free cells reachable from (x, y) (counted up to `cap`). */
export function room(b: Board, x: number, y: number, cap = 200): number {
  if (!passable(b, x, y)) return 0
  const seen = new Set<number>([y * COLS + x])
  const q: Cell[] = [{ x, y }]
  for (let qi = 0; qi < q.length && q.length < cap; qi++) {
    const cur = q[qi] as Cell
    for (let d = 0; d < 4; d++) {
      const nx = cur.x + (DX[d] ?? 0)
      const ny = cur.y + (DY[d] ?? 0)
      if (!passable(b, nx, ny) || seen.has(ny * COLS + nx)) continue
      seen.add(ny * COLS + nx)
      q.push({ x: nx, y: ny })
    }
  }
  return Math.min(q.length, cap)
}

/** Steps from (x, y) to the nearest dot over free cells, or -1 when none is reachable. */
export function foodDistance(b: Board, x: number, y: number): number {
  if (b.dots.some((d) => d.x === x && d.y === y)) return 0
  const seen = new Set<number>([y * COLS + x])
  let frontier: Cell[] = [{ x, y }]
  for (let steps = 1; frontier.length; steps++) {
    const next: Cell[] = []
    for (const cur of frontier) {
      for (let d = 0; d < 4; d++) {
        const nx = cur.x + (DX[d] ?? 0)
        const ny = cur.y + (DY[d] ?? 0)
        if (!inside({ x: nx, y: ny }) || seen.has(ny * COLS + nx)) continue
        seen.add(ny * COLS + nx)
        if (b.dots.some((k) => k.x === nx && k.y === ny)) return steps
        if (occupied(b, nx, ny)) continue
        next.push({ x: nx, y: ny })
      }
    }
    frontier = next
  }
  return -1
}
