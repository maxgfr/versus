import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Spike Attacks rules: two blobs share a tile floor. Patterns of spike tiles
 * flash red, then shoot up; a blob touching a spike loses a heart. Pure
 * functions; the rng only picks the next pattern (host side).
 */

export const COLS = 10
export const ROWS = 12
export const TILE = 100
export const X0 = 0
export const Y0 = 300
export const HP = 3
export const BLOB_R = 30
const SPEED = 285
const ACCEL = 10
/** A dash: this speed held for DASH_T seconds (about a tile), then DASH_CD to recharge. */
export const DASH = 640
export const DASH_T = 0.16
export const DASH_CD = 1.1
/** Seconds of invulnerability after a hit. */
export const INVULN = 1
/** Seconds a spike takes to rise, and to sink again. */
export const RISE = 0.14
export const SINK = 0.25
/** Spike height at which a spike hurts (0..1). */
export const HURT = 0.6
/** Quiet time before the first pattern of a round (s). */
const GRACE = 1.4
/** At most this share of the floor may be spiked at once (so there is always room). */
export const CAP = 0.5

export interface Pattern {
  /** Cell indices, row-major (r * COLS + c). */
  cells: number[]
  /** Telegraph start (round time). */
  w: number
  /** When the spikes shoot up. */
  f: number
  /** When the spikes start to sink. */
  u: number
}

export interface Fighter {
  x: number
  y: number
  vx: number
  vy: number
  hp: number
  /** Round time of the last hit (-9 = never). */
  hit: number
  /** Round time of the death (-1 = alive). */
  died: number
  walk: number
  /** Round time of the last dash (-9 = never), and its direction. */
  dashT: number
  dx: number
  dy: number
}

export interface Floor {
  /** Round time in seconds. */
  t: number
  fighters: [Fighter, Fighter]
  pats: Pattern[]
  /** Round time of the next pattern. */
  next: number
}

export interface Drive {
  jx: number
  jy: number
  /** Dash this step (a flick of the stick), toward (jx, jy). */
  dash?: boolean
}

export type Ev =
  | { k: 'warn'; n: number }
  | { k: 'fire'; n: number }
  | { k: 'hit'; side: Side; x: number; y: number }
  | { k: 'dead'; side: Side; x: number; y: number }
  | { k: 'bump'; x: number; y: number; speed: number }
  | { k: 'dash'; side: Side; x: number; y: number; dx: number; dy: number }

/** Difficulty of the round at time `t`: 0 at the start, 7 at the most. */
export const levelAt = (t: number): number => Math.min(7, Math.floor(t / 11))

/** Telegraph / rise / sink timing for a level. */
export function timing(level: number): { warn: number; up: number; gap: number } {
  return {
    warn: Math.max(0.7, 1.45 - 0.12 * level),
    up: Math.min(1.5, 1 + 0.07 * level),
    gap: Math.max(0.85, 2.3 - 0.22 * level),
  }
}

export const cellX = (i: number): number => X0 + (i % COLS) * TILE
export const cellY = (i: number): number => Y0 + Math.floor(i / COLS) * TILE

export function newFloor(fighterX: [number, number], fighterY: [number, number]): Floor {
  const mk = (x: number, y: number): Fighter => ({
    x,
    y,
    vx: 0,
    vy: 0,
    hp: HP,
    hit: -9,
    died: -1,
    walk: 0,
    dashT: -9,
    dx: 0,
    dy: 0,
  })
  return {
    t: 0,
    fighters: [mk(fighterX[0], fighterY[0]), mk(fighterX[1], fighterY[1])],
    pats: [],
    next: GRACE,
  }
}

/** Spike state of one tile at round time `t`: height 0..1 and how close its telegraph is (0..1). */
export function spikeAt(
  pats: readonly Pattern[],
  i: number,
  t: number,
): { h: number; warn: number } {
  let h = 0
  let warn = 0
  for (const p of pats) {
    if (!p.cells.includes(i)) continue
    if (t >= p.w && t < p.f) warn = Math.max(warn, (t - p.w) / (p.f - p.w))
    else if (t >= p.f && t < p.u) h = Math.max(h, Math.min(1, (t - p.f) / RISE))
    else if (t >= p.u && t < p.u + SINK) h = Math.max(h, 1 - (t - p.u) / SINK)
  }
  return { h, warn }
}

/** Can a blob at (x, y) with radius r touch tile i? */
export function touches(i: number, x: number, y: number, r: number): boolean {
  const x0 = cellX(i)
  const y0 = cellY(i)
  const nx = Math.max(x0, Math.min(x, x0 + TILE))
  const ny = Math.max(y0, Math.min(y, y0 + TILE))
  return (x - nx) ** 2 + (y - ny) ** 2 < r * r
}

/** Cells that are spiked (hurting) at time t. */
export function hurtingCells(pats: readonly Pattern[], t: number): Set<number> {
  const out = new Set<number>()
  for (const p of pats)
    if (t >= p.f && t < p.u + SINK)
      for (const i of p.cells) if (spikeAt([p], i, t).h >= HURT) out.add(i)
  return out
}

/** A pattern shape around a fighter's cell, or a fixed shape, picked by the rng. */
function shape(rng: Rng, level: number, aim: number): number[] {
  const kinds: string[] = ['row', 'col', 'block', 'scatter']
  if (level >= 1) kinds.push('cross', 'checker')
  if (level >= 2) kinds.push('aim', 'aim')
  if (level >= 3) kinds.push('ring')
  const k = rng.pick(kinds)
  const cells = new Set<number>()
  const idx = (c: number, r: number) => r * COLS + c
  switch (k) {
    case 'row': {
      const r = rng.int(0, ROWS - 1)
      for (let c = 0; c < COLS; c++) cells.add(idx(c, r))
      if (rng.chance(0.5)) cells.delete(idx(rng.int(0, COLS - 1), r))
      break
    }
    case 'col': {
      const c = rng.int(0, COLS - 1)
      for (let r = 0; r < ROWS; r++) cells.add(idx(c, r))
      break
    }
    case 'cross': {
      const c = rng.int(1, COLS - 2)
      const r = rng.int(1, ROWS - 2)
      for (let i = 0; i < COLS; i++) cells.add(idx(i, r))
      for (let j = 0; j < ROWS; j++) cells.add(idx(c, j))
      break
    }
    case 'checker': {
      const c0 = rng.int(0, 3)
      const r0 = rng.int(0, 5)
      const p = rng.int(0, 1)
      for (let c = c0; c < c0 + 6; c++)
        for (let r = r0; r < r0 + 6; r++) if ((c + r) % 2 === p) cells.add(idx(c, r))
      break
    }
    case 'block': {
      for (let b = 0; b < 2; b++) {
        const c = rng.int(0, COLS - 2)
        const r = rng.int(0, ROWS - 2)
        for (const [dc, dr] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ] as const)
          cells.add(idx(c + dc, r + dr))
      }
      break
    }
    case 'aim': {
      const c = aim % COLS
      const r = Math.floor(aim / COLS)
      for (let dc = -1; dc <= 1; dc++)
        for (let dr = -1; dr <= 1; dr++) {
          const cc = c + dc
          const rr = r + dr
          if (cc >= 0 && rr >= 0 && cc < COLS && rr < ROWS) cells.add(idx(cc, rr))
        }
      break
    }
    case 'ring': {
      for (let c = 0; c < COLS; c++) {
        cells.add(idx(c, 0))
        cells.add(idx(c, ROWS - 1))
      }
      for (let r = 0; r < ROWS; r++) {
        cells.add(idx(0, r))
        cells.add(idx(COLS - 1, r))
      }
      break
    }
    default: {
      const n = 6 + 2 * level
      while (cells.size < n) cells.add(rng.int(0, COLS * ROWS - 1))
    }
  }
  return [...cells]
}

/** Advance the floor by `dt`. `drives[side]` moves that fighter. Events go to `ev`. */
export function stepFloor(
  f: Floor,
  rng: Rng,
  drives: readonly Drive[],
  dt: number,
  ev: Ev[],
): void {
  f.t += dt
  const t = f.t
  // Fighters.
  for (const side of [0, 1] as Side[]) {
    const p = f.fighters[side]
    if (p.died >= 0) continue
    const d = drives[side] ?? { jx: 0, jy: 0 }
    const m = Math.min(1, Math.hypot(d.jx, d.jy))
    const len = Math.hypot(d.jx, d.jy) || 1
    const tvx = m > 0 ? (d.jx / len) * m * SPEED : 0
    const tvy = m > 0 ? (d.jy / len) * m * SPEED : 0
    // A flick dashes: about a tile at once, to dodge or to shove the rival.
    if (d.dash && m > 0.3 && t - p.dashT >= DASH_CD) {
      p.dashT = t
      p.dx = d.jx / len
      p.dy = d.jy / len
      ev.push({ k: 'dash', side, x: p.x, y: p.y, dx: p.dx, dy: p.dy })
    }
    if (t - p.dashT < DASH_T) {
      p.vx = p.dx * DASH
      p.vy = p.dy * DASH
    } else {
      const k = Math.min(1, ACCEL * dt)
      p.vx += (tvx - p.vx) * k
      p.vy += (tvy - p.vy) * k
    }
    p.x = Math.max(X0 + BLOB_R, Math.min(X0 + COLS * TILE - BLOB_R, p.x + p.vx * dt))
    p.y = Math.max(Y0 + BLOB_R, Math.min(Y0 + ROWS * TILE - BLOB_R, p.y + p.vy * dt))
    p.walk += Math.hypot(p.vx, p.vy) * dt
  }

  // Blobs are solid: they bump and shove each other (into the spikes, with luck).
  const [a, b] = f.fighters
  if (a.died < 0 && b.died < 0) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.hypot(dx, dy)
    const min = BLOB_R * 2
    if (d < min && d > 0.001) {
      const nx = dx / d
      const ny = dy / d
      const push = (min - d) / 2
      a.x -= nx * push
      a.y -= ny * push
      b.x += nx * push
      b.y += ny * push
      const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
      if (vn < -40) {
        // A springy shove along the line of contact.
        const j = -vn * 1.1
        a.vx -= nx * j
        a.vy -= ny * j
        b.vx += nx * j
        b.vy += ny * j
        ev.push({ k: 'bump', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, speed: -vn })
      }
      for (const p of [a, b]) {
        p.x = Math.max(X0 + BLOB_R, Math.min(X0 + COLS * TILE - BLOB_R, p.x))
        p.y = Math.max(Y0 + BLOB_R, Math.min(Y0 + ROWS * TILE - BLOB_R, p.y))
      }
    }
  }

  // New pattern: the shape depends on the level and the current spikes stay under the cap.
  if (t >= f.next) {
    const level = levelAt(t)
    const tm = timing(level)
    const live = new Set<number>()
    for (const p of f.pats) if (t < p.u + SINK) for (const i of p.cells) live.add(i)
    const alive = f.fighters.filter((k) => k.died < 0)
    const target = alive.length > 0 ? rng.pick(alive) : null
    const aim = target
      ? Math.floor((target.y - Y0) / TILE) * COLS + Math.floor((target.x - X0) / TILE)
      : 0
    let cells = shape(rng, level, Math.max(0, Math.min(COLS * ROWS - 1, aim)))
    cells = cells.filter((i) => !live.has(i))
    const room = Math.floor(CAP * COLS * ROWS) - live.size
    if (cells.length > room) cells = cells.slice(0, Math.max(0, room))
    if (cells.length > 0) {
      f.pats.push({ cells, w: t, f: t + tm.warn, u: t + tm.warn + tm.up })
      ev.push({ k: 'warn', n: cells.length })
    }
    f.next = t + tm.warn + tm.gap
  }

  // Spikes: fire events and hits.
  for (const p of f.pats)
    if (Math.abs(t - p.f) < dt / 2 + 1e-9) ev.push({ k: 'fire', n: p.cells.length })
  f.pats = f.pats.filter((p) => t < p.u + SINK + 0.05)
  const hurt = hurtingCells(f.pats, t)
  for (const side of [0, 1] as Side[]) {
    const p = f.fighters[side]
    if (p.died >= 0 || t - p.hit < INVULN) continue
    for (const i of hurt) {
      if (!touches(i, p.x, p.y, BLOB_R)) continue
      p.hp--
      p.hit = t
      ev.push({ k: 'hit', side, x: p.x, y: p.y })
      if (p.hp <= 0) {
        p.died = t
        ev.push({ k: 'dead', side, x: p.x, y: p.y })
      }
      break
    }
  }
}

/**
 * The round's outcome: the last fighter standing wins; both down at once is a
 * draw. Null while both still stand.
 */
export function roundWinner(f: Floor): Side | 'draw' | null {
  const [a, b] = f.fighters
  const aliveA = a.died < 0
  const aliveB = b.died < 0
  if (aliveA && aliveB) return null
  if (!aliveA && !aliveB) {
    if (a.died === b.died) return 'draw'
    // The one that went down later lasted longer.
    return a.died > b.died ? 0 : 1
  }
  return aliveA ? 0 : 1
}
