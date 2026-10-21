import type { Side } from '../../core/game.ts'
import {
  angleTo,
  cellCenter,
  cellOf,
  collideCircle,
  type Grid,
  lineOfSight,
  parseMap,
} from '../../engines/arena/index.ts'

/**
 * Guard and Thief rules: a thief grabs every loot item in a museum maze while
 * a guard tries to touch them first. Pure functions, no DOM, no randomness.
 *
 * Map legend: '#' wall, '.' floor, '~' shadow (the thief can hide there),
 * '*' loot, 'R' / 'B' the red and blue spawns (red at the bottom).
 */

export const MAPS: string[][] = [
  [
    '##########',
    '#B...~..*#',
    '#.##.##..#',
    '#..*.....#',
    '###.##.###',
    '#*...~...#',
    '#.#.##.#.#',
    '#.#....#*#',
    '#~.##.##.#',
    '#..*..~..#',
    '#.##.##..#',
    '####R#####',
  ],
  [
    '##########',
    '#.~..B..~#',
    '#.#.##.#.#',
    '#.#*...#.#',
    '#...~~...#',
    '#*.....*.#',
    '#.#.##.#.#',
    '#.#..*.#.#',
    '#~.#...~.#',
    '#...*....#',
    '#.##.##.##',
    '####R#####',
  ],
  [
    '##########',
    '#...B~...#',
    '#.##.##.##',
    '#*......*#',
    '##.#~~#.##',
    '#...##...#',
    '#.*....*.#',
    '##.####.##',
    '#~...*...#',
    '#.##.##.##',
    '#...R....#',
    '##########',
  ],
]

/** Seconds a round lasts before the guard takes it. */
export const ROUND_T = 40
export const SPEED = { thief: 226, guard: 240 }
export const THIEF_R = 26
export const GUARD_R = 30
/** Centre distance at which the guard touches (and catches) the thief. */
export const CATCH = 54
/** Centre distance at which the thief picks up loot. */
export const LOOT_R = 46
/** Guard vision: range, and half-angle of the cone (rad). */
export const VIS = 330
export const VIS_A = 0.7
/** Thief hides for this long, then waits this long before hiding again. */
export const HIDE_T = 2.4
export const HIDE_CD = 3.6
/** Guard sprints for this long, then waits this long before sprinting again. */
export const SPRINT_T = 1.0
export const SPRINT_CD = 5
export const SPRINT_X = 1.35
/** After seeing the thief, the guard is faster for a little while. */
export const ALARM_T = 1.6
export const ALARM_X = 1.1
const ACCEL = 9

export interface Loot {
  x: number
  y: number
  /** World time the loot was taken (-1 = still there). */
  got: number
}

export interface Pawn {
  x: number
  y: number
  vx: number
  vy: number
  /** Facing (rad). The guard's cone points this way. */
  a: number
  /** Thief: hidden until this time. Guard: sprinting until this time. */
  until: number
  /** Button ready again at this time. */
  ready: number
  /** Guard: last time it saw the thief (-9 = never). */
  seen: number
  /** Distance walked, for the walk animation. */
  walk: number
}

export interface World {
  /** Seconds since the round began. */
  t: number
  /** Indexed by side. */
  pawns: [Pawn, Pawn]
  loot: Loot[]
  /** The side playing the thief this round; the other side guards. */
  thief: Side
  /** The side that won the round, null while it goes on. */
  won: Side | null
  /** Seconds the round took (the time of the win). */
  winT: number
}

export interface Drive {
  jx: number
  jy: number
  /** Button pressed this step (hide for the thief, sprint for the guard). */
  press: boolean
}

export type Ev =
  | { k: 'loot'; x: number; y: number; n: number }
  | { k: 'spot'; x: number; y: number }
  | { k: 'hide'; x: number; y: number }
  /** The thief pressed hide away from any shadow. */
  | { k: 'nohide'; x: number; y: number }
  | { k: 'sprint'; x: number; y: number; side: Side }
  | { k: 'catch'; x: number; y: number }
  | { k: 'timeout' }

/** A map ready to play: its grid, which cells are shadows, and where the loot is. */
export interface Level {
  index: number
  grid: Grid
  shadow: Uint8Array
  loot: { x: number; y: number }[]
  spawn: [{ x: number; y: number }, { x: number; y: number }]
}

export function levelOf(index: number): Level {
  const rows = MAPS[index % MAPS.length] ?? MAPS[0] ?? []
  const grid = parseMap(rows)
  const shadow = new Uint8Array(grid.cols * grid.rows)
  const loot: { x: number; y: number }[] = []
  rows.forEach((row, r) => {
    ;[...row].forEach((ch, c) => {
      if (ch === '~') shadow[r * grid.cols + c] = 1
      if (ch === '*') loot.push(cellCenter(grid, c, r))
    })
  })
  const red = grid.spawns.R ?? { x: 500, y: 1500 }
  const blue = grid.spawns.B ?? { x: 500, y: 300 }
  // Indexed by side: each player's pawn starts at their own end of the museum.
  return { index, grid, shadow, loot, spawn: [red, blue] }
}

/** Is the point on a shadow tile? */
export function inShadow(level: Level, x: number, y: number): boolean {
  const { c, r } = cellOf(level.grid, x, y)
  if (c < 0 || r < 0 || c >= level.grid.cols || r >= level.grid.rows) return false
  return level.shadow[r * level.grid.cols + c] === 1
}

/** Is the thief hidden right now? Only the thief can hide. */
export function hidden(w: World, side: Side): boolean {
  return side === w.thief && w.pawns[side].until > w.t
}

/** Can the guard see the thief? Range, the cone, and a clear line (walls block). */
export function sees(level: Level, w: World): boolean {
  const g = w.pawns[w.thief === 0 ? 1 : 0]
  const th = w.pawns[w.thief]
  if (hidden(w, w.thief)) return false
  const dx = th.x - g.x
  const dy = th.y - g.y
  if (dx * dx + dy * dy > VIS * VIS) return false
  if (Math.abs(angleTo(g.a, Math.atan2(dy, dx))) > VIS_A) return false
  return lineOfSight(level.grid, g.x, g.y, th.x, th.y, 14)
}

export function newWorld(level: Level, thief: Side): World {
  const mk = (side: Side): Pawn => {
    const s = level.spawn[side]
    // Face the middle of the museum.
    const a = side === 0 ? -Math.PI / 2 : Math.PI / 2
    return {
      x: s.x,
      y: s.y,
      vx: 0,
      vy: 0,
      a,
      until: -9,
      ready: 0,
      seen: -9,
      walk: 0,
    }
  }
  return {
    t: 0,
    pawns: [mk(0), mk(1)],
    loot: level.loot.map((l) => ({ x: l.x, y: l.y, got: -1 })),
    thief,
    won: null,
    winT: 0,
  }
}

/** Advance the round by `dt`. `drives[side]` steers that side's pawn. */
export function stepWorld(
  w: World,
  level: Level,
  drives: readonly Drive[],
  dt: number,
  ev: Ev[],
): void {
  if (w.won !== null) {
    w.t += dt
    return
  }
  w.t += dt
  const t = w.t
  for (const side of [0, 1] as Side[]) {
    const p = w.pawns[side]
    const d = drives[side] ?? { jx: 0, jy: 0, press: false }
    const thief = side === w.thief
    // Buttons: the thief hides (only on a shadow tile), the guard sprints.
    if (d.press && p.ready <= t) {
      if (thief) {
        if (inShadow(level, p.x, p.y)) {
          p.until = t + HIDE_T
          p.ready = t + HIDE_T + HIDE_CD
          ev.push({ k: 'hide', x: p.x, y: p.y })
        } else ev.push({ k: 'nohide', x: p.x, y: p.y })
      } else {
        p.until = t + SPRINT_T
        p.ready = t + SPRINT_CD
        ev.push({ k: 'sprint', x: p.x, y: p.y, side })
      }
    }
    let speed = thief ? SPEED.thief : SPEED.guard
    if (!thief) {
      if (p.until > t) speed *= SPRINT_X
      if (t - p.seen < ALARM_T) speed *= ALARM_X
    }
    const m = Math.min(1, Math.hypot(d.jx, d.jy))
    const len = Math.hypot(d.jx, d.jy) || 1
    const tvx = m > 0 ? (d.jx / len) * m * speed : 0
    const tvy = m > 0 ? (d.jy / len) * m * speed : 0
    const k = Math.min(1, ACCEL * dt)
    p.vx += (tvx - p.vx) * k
    p.vy += (tvy - p.vy) * k
    p.x += p.vx * dt
    p.y += p.vy * dt
    collideCircle(level.grid, p, thief ? THIEF_R : GUARD_R)
    const v = Math.hypot(p.vx, p.vy)
    if (v > 20) p.a += Math.max(-7 * dt, Math.min(7 * dt, angleTo(p.a, Math.atan2(p.vy, p.vx))))
    p.walk += v * dt
  }

  const th = w.pawns[w.thief]
  const gu = w.pawns[w.thief === 0 ? 1 : 0]

  // Sightings: the guard's alarm starts on a fresh sighting.
  if (sees(level, w)) {
    if (t - gu.seen > 1) ev.push({ k: 'spot', x: th.x, y: th.y })
    gu.seen = t
  }

  // Loot: the thief grabs what it touches.
  for (const l of w.loot) {
    if (l.got >= 0 || Math.hypot(l.x - th.x, l.y - th.y) > LOOT_R) continue
    l.got = t
    ev.push({ k: 'loot', x: l.x, y: l.y, n: w.loot.filter((o) => o.got >= 0).length })
  }
  if (w.loot.length > 0 && w.loot.every((l) => l.got >= 0)) {
    w.won = w.thief
    w.winT = t
    return
  }

  // Caught: the guard touches the thief, who is not hidden.
  if (!hidden(w, w.thief) && Math.hypot(gu.x - th.x, gu.y - th.y) < CATCH) {
    w.won = w.thief === 0 ? 1 : 0
    w.winT = t
    ev.push({ k: 'catch', x: th.x, y: th.y })
    return
  }

  if (t >= ROUND_T) {
    w.won = w.thief === 0 ? 1 : 0
    w.winT = ROUND_T
    ev.push({ k: 'timeout' })
  }
}

/** The side that won the round, or null while it goes on. */
export function roundWinner(w: World): Side | null {
  return w.won
}

/** Running score of a match: round wins and the time each side's wins took. */
export interface Score {
  wins: [number, number]
  /** Sum of the winning times, for the tie-break (faster wins count more). */
  time: [number, number]
  played: number
  /** Rounds in the match. */
  total: number
}

export const scoreNew = (total: number): Score => ({
  wins: [0, 0],
  time: [0, 0],
  played: 0,
  total,
})

export function scoreAdd(sc: Score, w: Side, sec: number): void {
  sc.wins[w]++
  sc.time[w] += sec
  sc.played++
}

/** The match winner: most round wins, then the lower winning time. Null while rounds remain. */
export function matchWinner(sc: Score): Side | 'draw' | null {
  if (sc.played < sc.total) return null
  if (sc.wins[0] !== sc.wins[1]) return sc.wins[0] > sc.wins[1] ? 0 : 1
  if (Math.abs(sc.time[0] - sc.time[1]) > 0.01) return sc.time[0] < sc.time[1] ? 0 : 1
  return 'draw'
}

/** The thief of round `k` (0-based): red first, then they alternate. */
export const thiefOf = (k: number): Side => (k % 2 === 0 ? 0 : 1)
