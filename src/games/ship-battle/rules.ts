import type { Side } from '../../core/game.ts'
import { H, W } from '../../core/stage.ts'
import { angleTo, separate } from '../../engines/arena/index.ts'

/** Pure ship physics and broadside combat. No rendering, no randomness. */

export const SHIP_R = 30
/** Half the beam: cannons sit just outside the hull. */
export const HULL_HALF = 22
export const MAX_SPEED = 170
/** Turn rate (rad/s) at full throttle. */
export const TURN = 1.5
export const HP = 3
/** Seconds between salvos. */
export const RELOAD = 1.6
export const SALVO = 6
export const BALL_SPEED = 560
/** Cannonball reach (world units) before it drops into the sea. */
export const RANGE = 440
export const BALL_LIFE = RANGE / BALL_SPEED
export const BALL_R = 8
/** How long a sinking ship takes to disappear (s). */
export const SINK_T = 2.4
/** Seconds a wake point lingers (the trail itself is cosmetic, drawn from frames). */
export const WAKE_T = 1.5
/** Closing speed under which two hulls just nudge each other (no bump event). */
export const BUMP_MIN = 60

/**
 * Open water between the two docks (the controls sit in the dock bands) and
 * the rocky shores on the sides, which keep ships clear of the pause button.
 */
export const SEA = { left: 100, right: W - 100, top: 330, bottom: H - 330 }

export interface Isle {
  x: number
  y: number
  r: number
}

/** Blue's half of each layout; the red half is its point mirror. */
const TOP: { isles: [number, number, number][]; spawn: [number, number] }[] = [
  {
    isles: [
      [200, 520, 70],
      [250, 575, 42],
      [790, 620, 85],
      [725, 665, 40],
      [500, 760, 55],
    ],
    spawn: [330, 420],
  },
  {
    isles: [
      [500, 470, 60],
      [470, 520, 34],
      [150, 640, 58],
      [850, 700, 70],
      [880, 760, 40],
    ],
    spawn: [330, 420],
  },
  {
    isles: [
      [120, 430, 55],
      [880, 430, 55],
      [500, 620, 90],
      [300, 800, 40],
    ],
    spawn: [330, 420],
  },
]

export const LAYOUTS = TOP.length

export function layoutIsles(i: number): Isle[] {
  const top = TOP[i % LAYOUTS]?.isles ?? []
  const mirror = top.map(([x, y, r]) => ({ x: W - x, y: H - y, r }))
  return [...top.map(([x, y, r]) => ({ x, y, r })), ...mirror]
}

export function layoutSpawn(i: number, side: Side): { x: number; y: number } {
  const [x, y] = TOP[i % LAYOUTS]?.spawn ?? [330, 420]
  return side === 1 ? { x, y } : { x: W - x, y: H - y }
}

export interface Ship {
  id: number
  side: Side
  x: number
  y: number
  /** Heading (rad). The bow points along it; starboard is at +90°. */
  a: number
  /** Speed in world units per second. */
  v: number
  hp: number
  alive: boolean
  /** Reload left (s). */
  cd: number
  /** World time of the last hit and of the last salvo (flashes, recoil). */
  hitT: number
  fireT: number
  /** Broadside of the last salvo: 1 starboard, -1 port. */
  fireSide: 1 | -1
  /** World time the ship went down, or -1 while afloat. */
  sunkT: number
}

export interface Ball {
  id: number
  /** Salvo this ball belongs to: one salvo hits a given ship at most once. */
  salvo: number
  owner: number
  side: Side
  x: number
  y: number
  vx: number
  vy: number
  born: number
}

export interface World {
  ships: Ship[]
  balls: Ball[]
  isles: Isle[]
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
  | { k: 'fire'; x: number; y: number; a: number; side: Side }
  | { k: 'splash'; x: number; y: number }
  | { k: 'rock'; x: number; y: number }
  | {
      k: 'hit'
      x: number
      y: number
      side: Side
      left: number
      /** 0..1: how close the shot was fired from (point-blank = 1). */
      close: number
      vx: number
      vy: number
    }
  | { k: 'sink'; x: number; y: number; side: Side; vx: number; vy: number }
  /** Two hulls knocking together at `speed` (closing speed, units/s). */
  | { k: 'bump'; x: number; y: number; speed: number }

export function newWorld(layout: number): World {
  const ships: Ship[] = ([0, 1] as Side[]).map((side) => {
    const p = layoutSpawn(layout, side)
    return {
      id: side,
      side,
      x: p.x,
      y: p.y,
      a: side === 0 ? -Math.PI / 2 : Math.PI / 2,
      v: 0,
      hp: HP,
      alive: true,
      cd: 0.8,
      hitT: -9,
      fireT: -9,
      fireSide: 1,
      sunkT: -1,
    }
  })
  return { ships, balls: [], isles: layoutIsles(layout), nextId: 1, t: 0 }
}

/** Is (x, y) inside an island, grown by `pad`? */
export function onIsle(isles: readonly Isle[], x: number, y: number, pad = 0): boolean {
  for (const i of isles) {
    const r = i.r + pad
    if ((x - i.x) ** 2 + (y - i.y) ** 2 < r * r) return true
  }
  return false
}

/** Straight water path between two points, sampled; false if an island is in the way. */
export function clearLine(
  isles: readonly Isle[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step = 14,
): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step))
  for (let i = 1; i < n; i++) {
    const t = i / n
    if (onIsle(isles, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false
  }
  return true
}

/** Push a ship out of an island; it grinds to a near stop if it was heading into it. */
function pushOut(s: Ship, i: Isle): void {
  const dx = s.x - i.x
  const dy = s.y - i.y
  const min = i.r + SHIP_R
  const d2 = dx * dx + dy * dy
  if (d2 >= min * min) return
  const d = Math.sqrt(d2)
  const nx = d < 1e-3 ? 1 : dx / d
  const ny = d < 1e-3 ? 0 : dy / d
  const into = Math.cos(s.a) * -nx + Math.sin(s.a) * -ny
  if (into > 0) s.v *= 0.3
  s.x = i.x + nx * min
  s.y = i.y + ny * min
}

function clampSea(s: Ship): void {
  if (s.x < SEA.left + SHIP_R) {
    s.x = SEA.left + SHIP_R
    s.v *= 0.5
  } else if (s.x > SEA.right - SHIP_R) {
    s.x = SEA.right - SHIP_R
    s.v *= 0.5
  }
  if (s.y < SEA.top + SHIP_R) {
    s.y = SEA.top + SHIP_R
    s.v *= 0.5
  } else if (s.y > SEA.bottom - SHIP_R) {
    s.y = SEA.bottom - SHIP_R
    s.v *= 0.5
  }
}

/** Fire a broadside at the side the rival lies on. Four balls leave along the hull. */
function salvo(w: World, s: Ship, foe: Ship, ev: Ev[]): void {
  const fx = Math.cos(s.a)
  const fy = Math.sin(s.a)
  const dx = foe.x - s.x
  const dy = foe.y - s.y
  // Starboard is (-sin a, cos a): fire out the side the rival is on.
  const side: 1 | -1 = dx * -fy + dy * fx >= 0 ? 1 : -1
  const nx = -fy * side
  const ny = fx * side
  const base = Math.atan2(ny, nx)
  const salvo = w.nextId++
  s.cd = RELOAD
  s.fireT = w.t
  s.fireSide = side
  for (let k = 0; k < SALVO; k++) {
    const spread = k - (SALVO - 1) / 2
    const along = spread * 10
    // A wide fan of rays: a rival roughly abeam (even while it drifts) is caught by one.
    const ang = base + spread * 0.12
    w.balls.push({
      id: w.nextId++,
      salvo,
      owner: s.id,
      side: s.side,
      x: s.x + fx * along + nx * (HULL_HALF + 10),
      y: s.y + fy * along + ny * (HULL_HALF + 10),
      vx: Math.cos(ang) * BALL_SPEED,
      vy: Math.sin(ang) * BALL_SPEED,
      born: w.t,
    })
  }
  ev.push({
    k: 'fire',
    x: s.x + nx * (HULL_HALF + 10),
    y: s.y + ny * (HULL_HALF + 10),
    a: base,
    side: s.side,
  })
}

/** Advance the world one step. `drives[i]` steers `ships[i]`. Events are appended to `ev`. */
export function stepWorld(
  w: World,
  drives: readonly (Drive | undefined)[],
  dt: number,
  ev: Ev[],
): void {
  for (let i = 0; i < w.ships.length; i++) {
    const s = w.ships[i] as Ship
    if (!s.alive) continue
    const d = drives[i]
    s.cd = Math.max(0, s.cd - dt)
    const m = d ? Math.min(1, Math.hypot(d.jx, d.jy)) : 0
    let want = 0
    if (d && m > 0.12) {
      const diff = angleTo(s.a, Math.atan2(d.jy, d.jx))
      s.a += Math.max(-TURN * dt, Math.min(TURN * dt, diff))
      // Boats carry speed through a turn but crawl when they must come about.
      want = MAX_SPEED * m * (0.3 + 0.7 * Math.max(0, Math.cos(diff)))
    }
    s.v += (want - s.v) * Math.min(1, dt * 1.6)
    s.x += Math.cos(s.a) * s.v * dt
    s.y += Math.sin(s.a) * s.v * dt
    for (const isle of w.isles) pushOut(s, isle)
    clampSea(s)
    if (d?.fire && s.cd <= 0) {
      const foe = w.ships.find((f) => f.alive && f.side !== s.side)
      if (foe) salvo(w, s, foe, ev)
    }
  }
  for (let i = 0; i < w.ships.length; i++)
    for (let j = i + 1; j < w.ships.length; j++) {
      const a = w.ships[i] as Ship
      const b = w.ships[j] as Ship
      if (!a.alive || !b.alive) continue
      // Closing speed along the line between them, before they are pushed apart.
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 1
      const close =
        ((Math.cos(a.a) * a.v - Math.cos(b.a) * b.v) * dx +
          (Math.sin(a.a) * a.v - Math.sin(b.a) * b.v) * dy) /
        d
      if (separate(a, b, SHIP_R, SHIP_R)) {
        clampSea(a)
        clampSea(b)
        if (close > BUMP_MIN) {
          // A knock bleeds the speed of both hulls; it never sinks anyone.
          a.v *= 0.55
          b.v *= 0.55
          ev.push({ k: 'bump', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, speed: close })
        }
      }
    }
  const keep: Ball[] = []
  // A salvo that lands a hit is spent: its other balls drop into the sea.
  const spent = new Set<number>()
  for (const b of w.balls) {
    if (spent.has(b.salvo)) continue
    b.x += b.vx * dt
    b.y += b.vy * dt
    if (w.t - b.born > BALL_LIFE) {
      ev.push({ k: 'splash', x: b.x, y: b.y })
      continue
    }
    if (onIsle(w.isles, b.x, b.y)) {
      ev.push({ k: 'rock', x: b.x, y: b.y })
      continue
    }
    let hit = false
    for (const s of w.ships) {
      if (!s.alive || s.side === b.side) continue
      if ((s.x - b.x) ** 2 + (s.y - b.y) ** 2 > (SHIP_R + BALL_R) ** 2) continue
      s.hp--
      s.hitT = w.t
      spent.add(b.salvo)
      ev.push({
        k: 'hit',
        x: b.x,
        y: b.y,
        side: s.side,
        left: Math.max(0, s.hp),
        close: Math.max(0, 1 - (w.t - b.born) / BALL_LIFE),
        vx: b.vx,
        vy: b.vy,
      })
      if (s.hp <= 0) {
        s.alive = false
        s.sunkT = w.t
        s.v = 0
        ev.push({ k: 'sink', x: s.x, y: s.y, side: s.side, vx: b.vx, vy: b.vy })
      }
      hit = true
      break
    }
    if (!hit) keep.push(b)
  }
  w.balls = keep.filter((b) => !spent.has(b.salvo))
  w.t += dt
}

/**
 * The round is decided: every cannonball still flying drops into the sea, so
 * a stray one can't sink the survivor under the banner or during the ending.
 */
export function settle(w: World, ev: Ev[]): void {
  for (const b of w.balls) ev.push({ k: 'splash', x: b.x, y: b.y })
  w.balls = []
}

/** The side still afloat, 'draw' if neither is, null while both fight on. */
export function roundWinner(w: World): Side | 'draw' | null {
  const red = w.ships.some((s) => s.side === 0 && s.alive)
  const blue = w.ships.some((s) => s.side === 1 && s.alive)
  if (red && blue) return null
  if (red) return 0
  if (blue) return 1
  return 'draw'
}
