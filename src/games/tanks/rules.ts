import type { Side } from '../../core/game.ts'
import {
  angleTo,
  collideCircle,
  type Grid,
  lineOfSight,
  mirrorMap,
  moveBouncing,
  separate,
  solidAt,
} from '../../engines/arena/index.ts'

/** Pure tank physics and combat. No rendering, no randomness. */

export const TANK_R = 34
export const SPEED = 250
export const TURN = 4.4
export const SHELL_SPEED = 640
export const SHELL_R = 10
export const MAX_BOUNCES = 2
export const SHELL_LIFE = 3.6
export const RELOAD = 0.5
export const MAX_SHELLS = 3
export const HP = 3
/** A shell can't hit its own tank until it has flown this long (s). */
export const SAFE = 0.25
/** Round wins to take the match by default (best of three). */
export const TARGET = 2

/** Top halves (blue's end); `mirrorMap` completes them point-symmetrically. */
export const MAPS: string[][] = [
  mirrorMap(['..b....B..', '.##....##.', '.#......#.', '....##....', '#........#', '...#..#...']),
  mirrorMap(['B.......b.', '..#....#..', '..#.##.#..', '......#...', '.##.......', '....##..#.']),
  mirrorMap(['...B..b...', '.#.####.#.', '.#......#.', '...#..#...', '#........#', '..##..#...']),
]

export interface Tank {
  id: number
  side: Side
  /** 2 vs 2: which teammate (0 = world-left spawn). */
  lane: 0 | 1
  x: number
  y: number
  /** Heading (rad); the gun points this way. */
  a: number
  vx: number
  vy: number
  hp: number
  alive: boolean
  /** Reload left (s). */
  cd: number
  /** Distance driven, for the tread animation. */
  tread: number
  /** World time of the last hit / shot, for flashes and recoil. */
  hitT: number
  fireT: number
}

export interface Shell {
  id: number
  owner: number
  side: Side
  x: number
  y: number
  vx: number
  vy: number
  bounces: number
  born: number
}

export interface World {
  tanks: Tank[]
  shells: Shell[]
  nextId: number
  /** Seconds since the round began. */
  t: number
}

export interface Drive {
  jx: number
  jy: number
  fire: boolean
}

export type Ev =
  | { k: 'shot'; x: number; y: number; a: number; side: Side }
  | { k: 'bounce'; x: number; y: number }
  | { k: 'hit'; x: number; y: number; side: Side; vx: number; vy: number }
  | { k: 'kill'; x: number; y: number; side: Side }
  | { k: 'clash'; x: number; y: number }
  | { k: 'fizz'; x: number; y: number }

export function newWorld(grid: Grid, teams: boolean): World {
  const tanks: Tank[] = []
  const add = (key: string, side: Side) => {
    const p = grid.spawns[key]
    if (!p) return
    tanks.push({
      id: tanks.length,
      side,
      lane: 0,
      x: p.x,
      y: p.y,
      a: side === 0 ? -Math.PI / 2 : Math.PI / 2,
      vx: 0,
      vy: 0,
      hp: HP,
      alive: true,
      cd: 0.6,
      tread: 0,
      hitT: -9,
      fireT: -9,
    })
  }
  add('R', 0)
  if (teams) add('r', 0)
  add('B', 1)
  if (teams) add('b', 1)
  // Face the first open direction: forward if free, else toward the middle.
  for (const t of tanks) {
    const fwd = t.side === 0 ? -Math.PI / 2 : Math.PI / 2
    const mid = t.x < grid.x0 + (grid.cols * grid.cell) / 2 ? 0 : Math.PI
    for (const a of [fwd, mid, mid + Math.PI]) {
      if (!solidAt(grid, t.x + Math.cos(a) * grid.cell, t.y + Math.sin(a) * grid.cell)) {
        t.a = a
        break
      }
    }
  }
  // Lanes follow world x so 2 vs 2 teammates get the tank on their own side of the strip.
  for (const side of [0, 1] as Side[]) {
    const mine = tanks.filter((t) => t.side === side).sort((a, b) => a.x - b.x)
    mine.forEach((t, i) => (t.lane = mine.length === 1 ? 0 : (i as 0 | 1)))
  }
  return { tanks, shells: [], nextId: 1, t: 0 }
}

/** Advance the world one step. `drives[i]` drives `tanks[i]`. Events are appended to `ev`. */
export function stepWorld(
  w: World,
  grid: Grid,
  drives: readonly (Drive | undefined)[],
  dt: number,
  ev: Ev[],
): void {
  for (let i = 0; i < w.tanks.length; i++) {
    const t = w.tanks[i] as Tank
    if (!t.alive) continue
    const d = drives[i]
    t.cd = Math.max(0, t.cd - dt)
    let speed = 0
    if (d) {
      const m = Math.min(1, Math.hypot(d.jx, d.jy))
      if (m > 0.12) {
        const diff = angleTo(t.a, Math.atan2(d.jy, d.jx))
        const turn = Math.max(-TURN * dt, Math.min(TURN * dt, diff))
        t.a += turn
        const align = Math.max(0, Math.cos(diff))
        speed = SPEED * m * align * align
      }
    }
    t.vx = Math.cos(t.a) * speed
    t.vy = Math.sin(t.a) * speed
    t.x += t.vx * dt
    t.y += t.vy * dt
    t.tread += speed * dt
    collideCircle(grid, t, TANK_R)
    if (d?.fire && t.cd <= 0) {
      const mine = w.shells.filter((s) => s.owner === t.id).length
      const tx = t.x + Math.cos(t.a) * (TANK_R + 18)
      const ty = t.y + Math.sin(t.a) * (TANK_R + 18)
      if (mine >= MAX_SHELLS) continue
      t.cd = RELOAD
      if (solidAt(grid, tx, ty) || !lineOfSight(grid, t.x, t.y, tx, ty, 6)) {
        ev.push({ k: 'fizz', x: tx, y: ty })
        continue
      }
      w.shells.push({
        id: w.nextId++,
        owner: t.id,
        side: t.side,
        x: tx,
        y: ty,
        vx: Math.cos(t.a) * SHELL_SPEED,
        vy: Math.sin(t.a) * SHELL_SPEED,
        bounces: 0,
        born: w.t,
      })
      t.fireT = w.t
      t.x -= Math.cos(t.a) * 6
      t.y -= Math.sin(t.a) * 6
      collideCircle(grid, t, TANK_R)
      ev.push({ k: 'shot', x: tx, y: ty, a: t.a, side: t.side })
    }
  }
  // Tanks bump each other.
  for (let i = 0; i < w.tanks.length; i++)
    for (let j = i + 1; j < w.tanks.length; j++) {
      const a = w.tanks[i] as Tank
      const b = w.tanks[j] as Tank
      if (a.alive && b.alive && separate(a, b, TANK_R, TANK_R)) {
        collideCircle(grid, a, TANK_R)
        collideCircle(grid, b, TANK_R)
      }
    }
  // Shells fly, bounce and hit.
  const dead = new Set<number>()
  for (const s of w.shells) {
    const n = moveBouncing(grid, s, dt)
    if (n) {
      s.bounces += n
      if (s.bounces > MAX_BOUNCES) {
        dead.add(s.id)
        ev.push({ k: 'fizz', x: s.x, y: s.y })
        continue
      }
      ev.push({ k: 'bounce', x: s.x, y: s.y })
    }
    if (w.t - s.born > SHELL_LIFE) {
      dead.add(s.id)
      ev.push({ k: 'fizz', x: s.x, y: s.y })
      continue
    }
    for (const t of w.tanks) {
      if (!t.alive) continue
      if (t.id === s.owner && w.t - s.born < SAFE) continue
      if ((t.x - s.x) ** 2 + (t.y - s.y) ** 2 > (TANK_R + SHELL_R) ** 2) continue
      dead.add(s.id)
      t.hp--
      t.hitT = w.t
      const k = 16 / SHELL_SPEED
      t.x += s.vx * k
      t.y += s.vy * k
      collideCircle(grid, t, TANK_R)
      ev.push({ k: 'hit', x: s.x, y: s.y, side: t.side, vx: s.vx, vy: s.vy })
      if (t.hp <= 0) {
        t.alive = false
        ev.push({ k: 'kill', x: t.x, y: t.y, side: t.side })
      }
      break
    }
  }
  // Shells cancel each other out.
  for (let i = 0; i < w.shells.length; i++)
    for (let j = i + 1; j < w.shells.length; j++) {
      const a = w.shells[i] as Shell
      const b = w.shells[j] as Shell
      if (dead.has(a.id) || dead.has(b.id)) continue
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < (SHELL_R * 2) ** 2) {
        dead.add(a.id)
        dead.add(b.id)
        ev.push({ k: 'clash', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      }
    }
  if (dead.size) w.shells = w.shells.filter((s) => !dead.has(s.id))
  w.t += dt
}

/** The side still standing, 'draw' if nobody is, null while both fight on. */
export function roundWinner(w: World): Side | 'draw' | null {
  const red = w.tanks.some((t) => t.side === 0 && t.alive)
  const blue = w.tanks.some((t) => t.side === 1 && t.alive)
  if (red && blue) return null
  if (red) return 0
  if (blue) return 1
  return 'draw'
}
