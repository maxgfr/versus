import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/** Pure bomb-festival rules: board, movement, bombs, blasts and power-ups. No rendering, no randomness here. */

/**
 * The board: 9 × 15 cells of 84 units, x 122–878 and y 270–1530, centred on
 * the stage and clear of the pause button on the left edge.
 */
export const BOARD = { x0: 122, y0: 270, cell: 84, cols: 9, rows: 15 }
export const BOARD_BOTTOM = BOARD.y0 + BOARD.rows * BOARD.cell
export const PR = 24
export const BASE_SPEED = 170
export const MAX_SPEED = 230
export const BOMB_T = 2
export const FLAME_T = 0.5
export const MAX_RANGE = 6
export const MAX_BOMBS = 4
/**
 * Hurry up: a round still going after this many seconds starts dropping
 * blocks from the outside in (point-symmetric pairs), one pair every
 * `HURRY_EVERY` seconds. A player under a falling block is out.
 */
export const HURRY_T = 45
export const HURRY_EVERY = 0.35
/**
 * Corner assist: pushing along a lane while a little off its centre line
 * slides the player onto it (up to this share of a cell), so turning into a
 * corridor between pillars doesn't need pixel-perfect aim.
 */
export const ASSIST = 0.42

export const FLOOR = 0
export const PILLAR = 1
export const CRATE = 2

/** Power-up kinds: 0 = blast range, 1 = bomb count, 2 = speed. */
export const ITEMS = ['range', 'bomb', 'speed'] as const
export const ITEM_ICON = ['🔥', '💣', '👟'] as const

export interface Player {
  id: number
  side: Side
  x: number
  y: number
  alive: boolean
  bombsMax: number
  bombsOut: number
  range: number
  speed: number
  /** Facing (rad), from the last move. */
  a: number
  /** World time of the last bomb placed, and of death (-1 while alive). */
  placeT: number
  deadT: number
}

export interface Bomb {
  /** Cell index. */
  i: number
  owner: number
  /** Seconds until it goes off. */
  t: number
  range: number
  /** Players still standing on it since it was placed (they may walk off it). */
  through: number[]
}

export interface Flame {
  i: number
  /** Seconds left. */
  t: number
}

export interface Item {
  i: number
  k: number
}

export interface World {
  tiles: number[]
  /** Power-up hidden in each crate (-1 = nothing), by cell index. */
  hidden: number[]
  items: Item[]
  bombs: Bomb[]
  flames: Flame[]
  players: Player[]
  /** Seconds since the round began. */
  t: number
  /** Hurry-up blocks dropped so far (an index into `HURRY`), and when the next falls. */
  hurry: number
  hurryT: number
  /** Round decided: nobody can be knocked out any more (the ending plays). */
  frozen: boolean
}

export interface Drive {
  jx: number
  jy: number
  bomb: boolean
}

export type Ev =
  | { k: 'place'; x: number; y: number; side: Side }
  | { k: 'boom'; x: number; y: number; n: number }
  | { k: 'crate'; x: number; y: number }
  | { k: 'pick'; x: number; y: number; kind: number; side: Side }
  | { k: 'death'; x: number; y: number; side: Side }
  /** A hurry-up block lands on cell (x, y). */
  | { k: 'drop'; x: number; y: number }
  /** The hurry-up starts. */
  | { k: 'hurry' }

export const idx = (c: number, r: number): number => r * BOARD.cols + c
export const inBoard = (c: number, r: number): boolean =>
  c >= 0 && r >= 0 && c < BOARD.cols && r < BOARD.rows

export function cellOf(x: number, y: number): { c: number; r: number } {
  return {
    c: Math.floor((x - BOARD.x0) / BOARD.cell),
    r: Math.floor((y - BOARD.y0) / BOARD.cell),
  }
}

export function centreOf(c: number, r: number): { x: number; y: number } {
  return {
    x: BOARD.x0 + (c + 0.5) * BOARD.cell,
    y: BOARD.y0 + (r + 0.5) * BOARD.cell,
  }
}

/** Spawn corners: red bottom-left, blue top-right (point mirror images). */
export const SPAWN: [{ c: number; r: number }, { c: number; r: number }] = [
  { c: 0, r: BOARD.rows - 1 },
  { c: BOARD.cols - 1, r: 0 },
]

/**
 * A board of fixed pillars, scattered crates (some hiding power-ups), and two
 * clear corners. Crates and their power-ups are point-symmetric, so both
 * players dig out the same board.
 */
export function newBoard(rng: Rng): { tiles: number[]; hidden: number[] } {
  const n = BOARD.cols * BOARD.rows
  const tiles: number[] = Array.from({ length: n }, () => FLOOR)
  const hidden: number[] = Array.from({ length: n }, () => -1)
  for (let i = 0; i <= (n - 1) / 2; i++) {
    const c = i % BOARD.cols
    const r = (i - c) / BOARD.cols
    const pillar = c % 2 === 1 && r % 2 === 1
    const near = SPAWN.some((s) => Math.abs(s.c - c) + Math.abs(s.r - r) <= 2)
    let t = FLOOR
    if (pillar) t = PILLAR
    else if (!near && rng.chance(0.62)) t = CRATE
    const h = t === CRATE && rng.chance(0.35) ? rng.int(0, ITEMS.length - 1) : -1
    tiles[i] = tiles[n - 1 - i] = t
    hidden[i] = hidden[n - 1 - i] = h
  }
  return { tiles, hidden }
}

export function newWorld(rng: Rng): World {
  const { tiles, hidden } = newBoard(rng)
  const players: Player[] = ([0, 1] as Side[]).map((side) => {
    const sp = SPAWN[side] as { c: number; r: number }
    const p = centreOf(sp.c, sp.r)
    return {
      id: side,
      side,
      x: p.x,
      y: p.y,
      alive: true,
      bombsMax: 1,
      bombsOut: 0,
      range: 2,
      speed: BASE_SPEED,
      a: side === 0 ? -Math.PI / 2 : Math.PI / 2,
      placeT: -9,
      deadT: -1,
    }
  })
  return {
    tiles,
    hidden,
    items: [],
    bombs: [],
    flames: [],
    players,
    t: 0,
    hurry: 0,
    hurryT: HURRY_T,
    frozen: false,
  }
}

/**
 * Hurry-up drop order: a clockwise spiral from the top-left corner inward,
 * each cell followed by its point mirror so both players lose ground evenly.
 */
export const HURRY: readonly number[] = (() => {
  const n = BOARD.cols * BOARD.rows
  const seen = new Uint8Array(n)
  const out: number[] = []
  let c0 = 0
  let r0 = 0
  let c1 = BOARD.cols - 1
  let r1 = BOARD.rows - 1
  const add = (c: number, r: number) => {
    const i = idx(c, r)
    if (seen[i]) return
    seen[i] = seen[n - 1 - i] = 1
    out.push(i)
    if (n - 1 - i !== i) out.push(n - 1 - i)
  }
  while (c0 <= c1 && r0 <= r1) {
    for (let c = c0; c <= c1; c++) add(c, r0)
    for (let r = r0 + 1; r <= r1; r++) add(c1, r)
    for (let c = c1 - 1; c >= c0; c--) add(c, r1)
    for (let r = r1 - 1; r > r0; r--) add(c0, r)
    c0++
    r0++
    c1--
    r1--
  }
  return out
})()

/** The next `k` cells the hurry-up will drop a block on (empty before it starts). */
export function hurryNext(w: World, k: number): number[] {
  if (w.t < HURRY_T - 2) return []
  const out: number[] = []
  for (let j = w.hurry; j < HURRY.length && out.length < k; j++) {
    const i = HURRY[j] as number
    if (w.tiles[i] !== PILLAR) out.push(i)
  }
  return out
}

/** Is cell (c, r) a wall for this player (pillar, crate, board edge, or a bomb it has left)? */
export function solidFor(w: World, c: number, r: number, id: number): boolean {
  if (!inBoard(c, r)) return true
  if (w.tiles[idx(c, r)] !== FLOOR) return true
  return w.bombs.some((b) => b.i === idx(c, r) && !b.through.includes(id))
}

/** Passable for bots' search: floor with no bomb on it. */
export function walkable(w: World, c: number, r: number): boolean {
  if (!inBoard(c, r) || w.tiles[idx(c, r)] !== FLOOR) return false
  return !w.bombs.some((b) => b.i === idx(c, r))
}

/** Push a circle of radius `rad` out of the solid cells it overlaps. */
function collide(w: World, p: { x: number; y: number }, id: number): void {
  for (let pass = 0; pass < 2; pass++) {
    const c0 = Math.floor((p.x - PR - BOARD.x0) / BOARD.cell)
    const c1 = Math.floor((p.x + PR - BOARD.x0) / BOARD.cell)
    const r0 = Math.floor((p.y - PR - BOARD.y0) / BOARD.cell)
    const r1 = Math.floor((p.y + PR - BOARD.y0) / BOARD.cell)
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        if (!solidFor(w, c, r, id)) continue
        const x0 = BOARD.x0 + c * BOARD.cell
        const y0 = BOARD.y0 + r * BOARD.cell
        const nx = Math.max(x0, Math.min(p.x, x0 + BOARD.cell))
        const ny = Math.max(y0, Math.min(p.y, y0 + BOARD.cell))
        const dx = p.x - nx
        const dy = p.y - ny
        const d2 = dx * dx + dy * dy
        if (d2 >= PR * PR) continue
        if (d2 < 1e-6) {
          const m = Math.min(p.x - x0, x0 + BOARD.cell - p.x, p.y - y0, y0 + BOARD.cell - p.y)
          if (m === p.x - x0) p.x = x0 - PR
          else if (m === x0 + BOARD.cell - p.x) p.x = x0 + BOARD.cell + PR
          else if (m === p.y - y0) p.y = y0 - PR
          else p.y = y0 + BOARD.cell + PR
          continue
        }
        const d = Math.sqrt(d2)
        p.x = nx + (dx / d) * PR
        p.y = ny + (dy / d) * PR
      }
  }
}

/** Blast cells of a bomb at cell `i`: the cross out to `range`, stopped by pillars and crates. */
export function blastCells(w: World, i: number, range: number): number[] {
  const c0 = i % BOARD.cols
  const r0 = (i - c0) / BOARD.cols
  const out = [i]
  for (const [dc, dr] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    for (let k = 1; k <= range; k++) {
      const c = c0 + dc * k
      const r = r0 + dr * k
      if (!inBoard(c, r)) break
      const t = w.tiles[idx(c, r)]
      if (t === PILLAR) break
      out.push(idx(c, r))
      if (t === CRATE) break
    }
  }
  return out
}

/** Cells on fire right now (explosion flames plus the blast cells of every ticking bomb). */
export function dangerMap(w: World): Uint8Array {
  const d = new Uint8Array(BOARD.cols * BOARD.rows)
  for (const f of w.flames) d[f.i] = 1
  for (const b of w.bombs) for (const i of blastCells(w, b.i, b.range)) d[i] = 1
  return d
}

/** Advance the world one step. `drives[i]` drives `players[i]`. Events are appended to `ev`. */
export function stepWorld(
  w: World,
  drives: readonly (Drive | undefined)[],
  dt: number,
  ev: Ev[],
): void {
  w.flames = w.flames.filter((f) => (f.t -= dt) > 0)
  const due: Bomb[] = []
  for (const b of w.bombs) {
    b.t -= dt
    if (b.t <= 0) due.push(b)
  }
  for (const p of w.players) {
    if (!p.alive) continue
    const d = drives[p.id]
    const m = d ? Math.min(1, Math.hypot(d.jx, d.jy)) : 0
    if (d && m > 0.12) {
      const sp = p.speed * m
      let ax = d.jx / Math.hypot(d.jx, d.jy)
      let ay = d.jy / Math.hypot(d.jx, d.jy)
      p.a = Math.atan2(ay, ax)
      // Corner assist: a mostly-axial push into a lane that is open ahead
      // eases the player onto the lane's centre line instead of snagging on
      // a pillar corner.
      const cell = cellOf(p.x, p.y)
      const ctr = centreOf(cell.c, cell.r)
      if (Math.abs(ax) > 0.8) {
        const dc = ax > 0 ? 1 : -1
        const off = p.y - ctr.y
        if (
          Math.abs(off) > 1 &&
          Math.abs(off) < BOARD.cell * ASSIST &&
          !solidFor(w, cell.c + dc, cell.r, p.id)
        ) {
          const fix = Math.min(Math.abs(off), sp * dt)
          p.y -= Math.sign(off) * fix
          ax = Math.sign(ax)
          ay = 0
        }
      } else if (Math.abs(ay) > 0.8) {
        const dr = ay > 0 ? 1 : -1
        const off = p.x - ctr.x
        if (
          Math.abs(off) > 1 &&
          Math.abs(off) < BOARD.cell * ASSIST &&
          !solidFor(w, cell.c, cell.r + dr, p.id)
        ) {
          const fix = Math.min(Math.abs(off), sp * dt)
          p.x -= Math.sign(off) * fix
          ay = Math.sign(ay)
          ax = 0
        }
      }
      p.x += ax * sp * dt
      p.y += ay * sp * dt
    }
    collide(w, p, p.id)
    const here = cellOf(p.x, p.y)
    for (const b of w.bombs)
      if (b.through.includes(p.id) && b.i !== idx(here.c, here.r))
        b.through = b.through.filter((k) => k !== p.id)
    // Power-ups: picked up on touch.
    w.items = w.items.filter((it) => {
      const cc = centreOf(it.i % BOARD.cols, Math.floor(it.i / BOARD.cols))
      if (Math.hypot(cc.x - p.x, cc.y - p.y) > BOARD.cell * 0.55) return true
      applyItem(p, it.k)
      ev.push({ k: 'pick', x: cc.x, y: cc.y, kind: it.k, side: p.side })
      return false
    })
    if (d?.bomb && p.bombsOut < p.bombsMax && !w.bombs.some((b) => b.i === idx(here.c, here.r))) {
      const bi = idx(here.c, here.r)
      w.bombs.push({
        i: bi,
        owner: p.id,
        t: BOMB_T,
        range: p.range,
        // Everyone overlapping the cell may walk off it (not just the one who
        // dropped it): otherwise a rival standing there is shoved out sideways.
        through: w.players.filter((q) => q.alive && overlaps(q, bi)).map((q) => q.id),
      })
      p.bombsOut++
      p.placeT = w.t
      const cc = centreOf(here.c, here.r)
      ev.push({ k: 'place', x: cc.x, y: cc.y, side: p.side })
    }
  }
  // Blasts: a bomb that goes off can set off the bombs in its cross.
  const gone = new Set<Bomb>()
  while (due.length) {
    const b = due.shift() as Bomb
    if (gone.has(b)) continue
    gone.add(b)
    const cells = blastCells(w, b.i, b.range)
    for (const i of cells) {
      if (!w.flames.some((f) => f.i === i)) w.flames.push({ i, t: FLAME_T })
      const other = w.bombs.find((k) => k.i === i && !gone.has(k) && !due.includes(k))
      if (other) due.push(other)
      if (w.tiles[i] === CRATE) {
        w.tiles[i] = FLOOR
        const kind = w.hidden[i] ?? -1
        w.hidden[i] = -1
        if (kind >= 0) w.items.push({ i, k: kind })
        const cc = centreOf(i % BOARD.cols, Math.floor(i / BOARD.cols))
        ev.push({ k: 'crate', x: cc.x, y: cc.y })
      }
    }
    const bc = centreOf(b.i % BOARD.cols, Math.floor(b.i / BOARD.cols))
    ev.push({ k: 'boom', x: bc.x, y: bc.y, n: cells.length })
    const owner = w.players[b.owner]
    if (owner && owner.bombsOut > 0) owner.bombsOut--
  }
  w.bombs = w.bombs.filter((b) => !gone.has(b))
  // Hurry up: blocks fall from the outside in.
  if (w.t + dt >= HURRY_T && w.t < HURRY_T) ev.push({ k: 'hurry' })
  if (w.t >= w.hurryT && w.hurry < HURRY.length) {
    w.hurryT = w.t + HURRY_EVERY
    // A pair of mirror cells per drop.
    for (let k = 0; k < 2 && w.hurry < HURRY.length; k++) drop(w, HURRY[w.hurry++] as number, ev)
  }
  if (w.frozen) {
    w.t += dt
    return
  }
  // Anyone standing in fire is out.
  for (const p of w.players) {
    if (!p.alive) continue
    const here = cellOf(p.x, p.y)
    if (w.flames.some((f) => f.i === idx(here.c, here.r))) {
      p.alive = false
      p.deadT = w.t
      ev.push({ k: 'death', x: p.x, y: p.y, side: p.side })
    }
  }
  w.t += dt
}

/** Does the player's disc overlap cell `i`? */
function overlaps(p: Player, i: number): boolean {
  const c = i % BOARD.cols
  const r = (i - c) / BOARD.cols
  const x0 = BOARD.x0 + c * BOARD.cell
  const y0 = BOARD.y0 + r * BOARD.cell
  const nx = Math.max(x0, Math.min(p.x, x0 + BOARD.cell))
  const ny = Math.max(y0, Math.min(p.y, y0 + BOARD.cell))
  return (p.x - nx) ** 2 + (p.y - ny) ** 2 < PR * PR
}

/** A hurry-up block lands on cell `i`: it crushes whoever stands there and wipes the cell. */
function drop(w: World, i: number, ev: Ev[]): void {
  if (w.tiles[i] === PILLAR) return
  w.tiles[i] = PILLAR
  w.hidden[i] = -1
  w.items = w.items.filter((it) => it.i !== i)
  w.flames = w.flames.filter((f) => f.i !== i)
  for (const b of w.bombs)
    if (b.i === i) {
      const owner = w.players[b.owner]
      if (owner && owner.bombsOut > 0) owner.bombsOut--
    }
  w.bombs = w.bombs.filter((b) => b.i !== i)
  const cc = centreOf(i % BOARD.cols, Math.floor(i / BOARD.cols))
  ev.push({ k: 'drop', x: cc.x, y: cc.y })
  if (w.frozen) return
  for (const p of w.players) {
    if (!p.alive) continue
    const here = cellOf(p.x, p.y)
    if (idx(here.c, here.r) !== i) continue
    p.alive = false
    p.deadT = w.t
    ev.push({ k: 'death', x: p.x, y: p.y, side: p.side })
  }
}

function applyItem(p: Player, kind: number): void {
  if (kind === 0) p.range = Math.min(MAX_RANGE, p.range + 1)
  else if (kind === 1) p.bombsMax = Math.min(MAX_BOMBS, p.bombsMax + 1)
  else p.speed = Math.min(MAX_SPEED, p.speed + 20)
}

/** The side still standing, 'draw' if nobody is (or both fell together), null while two are left. */
export function roundWinner(w: World): Side | 'draw' | null {
  const alive = w.players.filter((p) => p.alive)
  if (alive.length === 2) return null
  if (alive.length === 1) return (alive[0] as Player).side
  return 'draw'
}
