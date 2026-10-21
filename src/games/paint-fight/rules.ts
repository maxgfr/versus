import type { Side } from '../../core/game.ts'

/** Pure paint rules: a 12 × 20 floor, rollers that paint as they roll, splash bursts. No rendering, no randomness here. */

/** The floor: 12 × 20 tiles of 64 units, from y = 260 to 1540 (clear of the pause button at x < 110). */
export const BOARD = { x0: 116, y0: 260, cell: 64, cols: 12, rows: 20 }
export const BOARD_BOTTOM = BOARD.y0 + BOARD.rows * BOARD.cell
export const ROLL_R = 30
export const ROLL_SPEED = 230
/** Seconds between splashes. */
export const SPLASH_CD = 4
/** Seconds between paint puffs, so a trail is not one event per step. */
const PUFF_T = 0.12

/** Tile owner: 0 = unpainted, 1 = red, 2 = blue (side + 1). */
export const NONE = 0

export interface Roller {
  id: number
  side: Side
  /** 0 = the left roller (from its player's seat), 1 = the right one. */
  lane: 0 | 1
  x: number
  y: number
  /** Heading (rad), from the last move. */
  a: number
  /** Splash cooldown left (s). */
  cd: number
  /** World time of the last paint puff. */
  puffT: number
  /** World time of the last splash. */
  splashT: number
}

export interface World {
  own: number[]
  /** World time each tile last changed colour (for the paint pop), -9 if never. */
  at: number[]
  rollers: Roller[]
  /** Painted tiles per side, red first. */
  counts: [number, number]
  /** Seconds since the match began. */
  t: number
}

export interface Drive {
  jx: number
  jy: number
  splash: boolean
}

export type Ev =
  | { k: 'paint'; x: number; y: number; side: Side }
  | { k: 'splash'; x: number; y: number; side: Side; n: number }

export const idx = (c: number, r: number): number => r * BOARD.cols + c

/** Spawn points, lane 0 (left from the seat) and lane 1; blue's are the point mirror of red's. */
export function spawn(side: Side, lane: 0 | 1, teams: boolean): { x: number; y: number } {
  const x = teams ? (lane === 0 ? 300 : 700) : 500
  const red = { x, y: 1420 }
  return side === 0 ? red : { x: 1000 - red.x, y: 1800 - red.y }
}

export function newWorld(teams: boolean): World {
  const rollers: Roller[] = []
  for (const side of [0, 1] as Side[])
    for (const lane of (teams ? [0, 1] : [0]) as (0 | 1)[]) {
      const p = spawn(side, lane, teams)
      rollers.push({
        id: rollers.length,
        side,
        lane,
        x: p.x,
        y: p.y,
        a: side === 0 ? -Math.PI / 2 : Math.PI / 2,
        cd: 0,
        puffT: -9,
        splashT: -9,
      })
    }
  return {
    own: Array.from({ length: BOARD.cols * BOARD.rows }, () => NONE),
    at: Array.from({ length: BOARD.cols * BOARD.rows }, () => -9),
    rollers,
    counts: [0, 0],
    t: 0,
  }
}

/** Paint a tile for a side. Returns true if it changed colour. */
function paint(w: World, c: number, r: number, side: Side): boolean {
  if (c < 0 || r < 0 || c >= BOARD.cols || r >= BOARD.rows) return false
  const i = idx(c, r)
  const want = side + 1
  if (w.own[i] === want) return false
  w.own[i] = want
  if (w.at) w.at[i] = w.t
  return true
}

/** Tiles touched by the roller's disc (the trail it leaves). */
function rollOver(w: World, ro: Roller): number {
  let n = 0
  const c0 = Math.floor((ro.x - ROLL_R - BOARD.x0) / BOARD.cell)
  const c1 = Math.floor((ro.x + ROLL_R - BOARD.x0) / BOARD.cell)
  const r0 = Math.floor((ro.y - ROLL_R - BOARD.y0) / BOARD.cell)
  const r1 = Math.floor((ro.y + ROLL_R - BOARD.y0) / BOARD.cell)
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      if (c < 0 || r < 0 || c >= BOARD.cols || r >= BOARD.rows) continue
      const x0 = BOARD.x0 + c * BOARD.cell
      const y0 = BOARD.y0 + r * BOARD.cell
      const nx = Math.max(x0, Math.min(ro.x, x0 + BOARD.cell))
      const ny = Math.max(y0, Math.min(ro.y, y0 + BOARD.cell))
      if ((ro.x - nx) ** 2 + (ro.y - ny) ** 2 > ROLL_R * ROLL_R) continue
      if (paint(w, c, r, ro.side)) n++
    }
  return n
}

/** Advance the match one step. `drives[i]` drives `rollers[i]`. Events are appended to `ev`. */
export function stepWorld(
  w: World,
  drives: readonly (Drive | undefined)[],
  dt: number,
  ev: Ev[],
): void {
  const left = BOARD.x0 + ROLL_R
  const right = BOARD.x0 + BOARD.cols * BOARD.cell - ROLL_R
  const top = BOARD.y0 + ROLL_R
  const bot = BOARD_BOTTOM - ROLL_R
  for (let i = 0; i < w.rollers.length; i++) {
    const ro = w.rollers[i] as Roller
    const d = drives[i]
    ro.cd = Math.max(0, ro.cd - dt)
    const m = d ? Math.min(1, Math.hypot(d.jx, d.jy)) : 0
    if (d && m > 0.12) {
      const len = Math.hypot(d.jx, d.jy)
      ro.x += (d.jx / len) * ROLL_SPEED * m * dt
      ro.y += (d.jy / len) * ROLL_SPEED * m * dt
      ro.a = Math.atan2(d.jy, d.jx)
    }
    ro.x = Math.max(left, Math.min(right, ro.x))
    ro.y = Math.max(top, Math.min(bot, ro.y))
    const n = rollOver(w, ro)
    if (n > 0 && w.t - ro.puffT > PUFF_T) {
      ro.puffT = w.t
      ev.push({ k: 'paint', x: ro.x, y: ro.y, side: ro.side })
    }
    if (d?.splash && ro.cd <= 0) {
      ro.cd = SPLASH_CD
      ro.splashT = w.t
      const c = Math.floor((ro.x - BOARD.x0) / BOARD.cell)
      const r = Math.floor((ro.y - BOARD.y0) / BOARD.cell)
      let k = 0
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) if (paint(w, c + dc, r + dr, ro.side)) k++
      const cx = BOARD.x0 + (c + 0.5) * BOARD.cell
      const cy = BOARD.y0 + (r + 0.5) * BOARD.cell
      ev.push({ k: 'splash', x: cx, y: cy, side: ro.side, n: k })
    }
  }
  w.counts = countTiles(w)
  w.t += dt
}

export function countTiles(w: World): [number, number] {
  let red = 0
  let blue = 0
  for (const o of w.own) {
    if (o === 1) red++
    else if (o === 2) blue++
  }
  return [red, blue]
}

/** Share of the floor each side has painted, 0..1. */
export function shares(w: World): [number, number] {
  const total = BOARD.cols * BOARD.rows
  const [red, blue] = countTiles(w)
  return [red / total, blue / total]
}

/** The side with more painted tiles when time is up; 'draw' on a tie. */
export function matchWinner(w: World): Side | 'draw' {
  const [red, blue] = countTiles(w)
  if (red === blue) return 'draw'
  return red > blue ? 0 : 1
}
