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
/** Rollers (with their frames) bump each other at this centre distance. */
export const BUMP_R = ROLL_R + 10
/**
 * A splash thrown while rolling flies ahead: at full speed its 3 × 3 lands
 * this many cells ahead of the roller (a standing splash lands under it).
 */
export const THROW = 1.5

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
  /** Velocity this step (units/s). */
  vx: number
  vy: number
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
  /** The closing stretch: splashes reload twice as fast for everyone. */
  frenzy: boolean
}

export interface Drive {
  jx: number
  jy: number
  splash: boolean
}

export type Ev =
  | { k: 'paint'; x: number; y: number; side: Side }
  /** `n` tiles changed colour, `stolen` of them were the rival's; `power` 0..1 is the throw. */
  | { k: 'splash'; x: number; y: number; side: Side; n: number; stolen: number; power: number }
  /** Two rollers knocking together at closing speed `speed`. */
  | { k: 'bump'; x: number; y: number; speed: number }

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
        vx: 0,
        vy: 0,
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
    frenzy: false,
  }
}

/** Paint a tile for a side. Returns true if it changed colour. */
function paint(w: World, i: number, side: Side): boolean {
  const want = side + 1
  if (w.own[i] === want) return false
  w.own[i] = want
  w.at[i] = w.t
  return true
}

/** Tiles touched by the roller's disc (the trail it leaves), as tile indices. */
function rollOver(ro: Roller, out: number[]): void {
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
      out.push(idx(c, r))
    }
}

/** 0..1: how fast the roller is going, as a share of full speed. */
export function speedOf(ro: Roller): number {
  return Math.min(1, Math.hypot(ro.vx, ro.vy) / ROLL_SPEED)
}

/** Centre cell of the splash the roller would throw now (ahead of it when rolling). */
export function splashCell(ro: Roller): { c: number; r: number } {
  const k = speedOf(ro) * THROW * BOARD.cell
  const x = ro.x + Math.cos(ro.a) * k
  const y = ro.y + Math.sin(ro.a) * k
  return {
    c: Math.max(0, Math.min(BOARD.cols - 1, Math.floor((x - BOARD.x0) / BOARD.cell))),
    r: Math.max(0, Math.min(BOARD.rows - 1, Math.floor((y - BOARD.y0) / BOARD.cell))),
  }
}

// Scratch for one step's claims (never part of the state).
const claimBy: number[] = []
const claimed: number[] = []
const touch: number[] = []

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
  const clamp = (ro: Roller) => {
    ro.x = Math.max(left, Math.min(right, ro.x))
    ro.y = Math.max(top, Math.min(bot, ro.y))
  }
  for (let i = 0; i < w.rollers.length; i++) {
    const ro = w.rollers[i] as Roller
    const d = drives[i]
    ro.cd = Math.max(0, ro.cd - dt)
    const m = d ? Math.min(1, Math.hypot(d.jx, d.jy)) : 0
    const ox = ro.x
    const oy = ro.y
    if (d && m > 0.12) {
      // How far the stick is pushed is how fast it rolls.
      const len = Math.hypot(d.jx, d.jy)
      ro.x += (d.jx / len) * ROLL_SPEED * m * dt
      ro.y += (d.jy / len) * ROLL_SPEED * m * dt
      ro.a = Math.atan2(d.jy, d.jx)
    }
    clamp(ro)
    ro.vx = (ro.x - ox) / dt
    ro.vy = (ro.y - oy) / dt
  }
  // Rollers shove each other instead of rolling through.
  for (let i = 0; i < w.rollers.length; i++)
    for (let j = i + 1; j < w.rollers.length; j++) {
      const a = w.rollers[i] as Roller
      const b = w.rollers[j] as Roller
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.hypot(dx, dy)
      if (dist >= BUMP_R * 2) continue
      const ux = dist > 1e-6 ? dx / dist : 1
      const uy = dist > 1e-6 ? dy / dist : 0
      const closing = (a.vx - b.vx) * ux + (a.vy - b.vy) * uy
      const push = (BUMP_R * 2 - dist) / 2
      a.x -= ux * push
      a.y -= uy * push
      b.x += ux * push
      b.y += uy * push
      clamp(a)
      clamp(b)
      if (closing > ROLL_SPEED * 0.6)
        ev.push({ k: 'bump', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, speed: closing })
    }
  // Claims: every tile a roller or a splash reaches this step. A tile both
  // sides reach on the same step keeps its colour, so neither side's place
  // in the list decides a tie.
  const n = BOARD.cols * BOARD.rows
  claimBy.length = n
  claimBy.fill(0)
  claimed.length = 0
  const mark = (i: number, side: Side) => {
    const bit = side + 1
    if (claimBy[i] === 0) claimed.push(i)
    claimBy[i] = (claimBy[i] as number) | bit
  }
  const splashes: { ro: Roller; c: number; r: number; tiles: number[]; power: number }[] = []
  for (let i = 0; i < w.rollers.length; i++) {
    const ro = w.rollers[i] as Roller
    touch.length = 0
    rollOver(ro, touch)
    for (const t of touch) mark(t, ro.side)
    if (drives[i]?.splash && ro.cd <= 0) {
      ro.cd = w.frenzy ? SPLASH_CD / 2 : SPLASH_CD
      ro.splashT = w.t
      const { c, r } = splashCell(ro)
      const tiles: number[] = []
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc
          const rr = r + dr
          if (cc < 0 || rr < 0 || cc >= BOARD.cols || rr >= BOARD.rows) continue
          tiles.push(idx(cc, rr))
          mark(idx(cc, rr), ro.side)
        }
      splashes.push({ ro, c, r, tiles, power: speedOf(ro) })
    }
  }
  // Who was where before this step's paint, for the splash tallies.
  const before = splashes.length ? w.own.slice() : null
  const changed: number[] = []
  for (const i of claimed) {
    const by = claimBy[i] as number
    if (by === 3) continue
    if (paint(w, i, by === 1 ? 0 : 1)) changed.push(i)
  }
  for (const ro of w.rollers) {
    if (w.t - ro.puffT <= PUFF_T) continue
    touch.length = 0
    rollOver(ro, touch)
    if (touch.some((t) => w.at[t] === w.t && w.own[t] === ro.side + 1)) {
      ro.puffT = w.t
      ev.push({ k: 'paint', x: ro.x, y: ro.y, side: ro.side })
    }
  }
  for (const sp of splashes) {
    let k = 0
    let stolen = 0
    for (const t of sp.tiles) {
      if (w.at[t] !== w.t || w.own[t] !== sp.ro.side + 1) continue
      k++
      if (before?.[t] === 2 - sp.ro.side) stolen++
    }
    ev.push({
      k: 'splash',
      x: BOARD.x0 + (sp.c + 0.5) * BOARD.cell,
      y: BOARD.y0 + (sp.r + 0.5) * BOARD.cell,
      side: sp.ro.side,
      n: k,
      stolen,
      power: sp.power,
    })
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
