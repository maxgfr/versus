/**
 * Aim engine: things you pull back and let fly. A top-down table view where a
 * projectile travels across the ground plane (x, y) with a simulated height z,
 * so shots lob over walls, are pushed by wind, cast a shadow, and land. Works
 * the same for both players because "up" is height, not a screen direction.
 *
 * How to build a game on it (copy src/games/cannon-duel):
 *  1. rules.ts — constants (`Ballistics`), the targets/blocks, and a pure
 *     `advance(state, dt)` that calls `stepShell`, then `blockAt` / landing
 *     checks, then `blast` on impact, and returns events.
 *  2. bot.ts — `solveShot(simulate, target, …)` searches direction × power by
 *     simulation and returns the best shot; add noise per difficulty.
 *  3. index.ts — extend `TurnGame` (engines/board) for turns. One `DragAim`
 *     per side (core/controls), updated only on its owner's turn; on `shot`,
 *     `launch` a shell. Set `ctx.input.assign = () => turn` so in local 2P the
 *     player whose turn it is can drag anywhere.
 *  4. render.ts — `drawTrajectory` for the preview (first part only: skill
 *     stays), `drawShell` (ball + shadow scaled by height), `drawWind`.
 */
import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, alpha, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'

export interface Ballistics {
  /** Gravity on z (units/s²). */
  g: number
  /** Ground speed at full power (units/s). */
  vmax: number
  /** vz / ground speed at launch: 1 = 45°. */
  elev: number
  /** Launch height. */
  z0: number
}

export interface Shell {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** Seconds in flight. */
  t: number
}

export interface ShotParams {
  /** Unit ground direction. */
  dx: number
  dy: number
  /** 0..1 */
  power: number
}

export function launch(x: number, y: number, shot: ShotParams, b: Ballistics): Shell {
  const v = b.vmax * shot.power
  return { x, y, z: b.z0, vx: shot.dx * v, vy: shot.dy * v, vz: v * b.elev, t: 0 }
}

/** Advance a shell. `wind` is a ground-plane acceleration along world x (units/s²). */
export function stepShell(s: Shell, dt: number, wind: number, b: Ballistics): void {
  s.vx += wind * dt
  s.x += s.vx * dt
  s.y += s.vy * dt
  s.vz -= b.g * dt
  s.z += s.vz * dt
  s.t += dt
}

export interface Block {
  x: number
  y: number
  w: number
  h: number
  /** How tall it stands: a shell lower than this over the footprint hits it. */
  height: number
  hp: number
  max: number
  kind: string
  side: Side
}

/** Index of the standing block the shell is inside of, or -1. */
export function blockAt(blocks: readonly Block[], x: number, y: number, z: number): number {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i] as Block
    if (b.hp <= 0 || z > b.height) continue
    if (x >= b.x - b.w / 2 && x <= b.x + b.w / 2 && y >= b.y - b.h / 2 && y <= b.y + b.h / 2)
      return i
  }
  return -1
}

/** Distance from a point to a block's footprint (0 inside). */
export function distToBlock(b: Block, x: number, y: number): number {
  const dx = Math.max(Math.abs(x - b.x) - b.w / 2, 0)
  const dy = Math.max(Math.abs(y - b.y) - b.h / 2, 0)
  return Math.hypot(dx, dy)
}

/**
 * Damage every standing block within `radius`; `direct` (if ≥ 0) takes
 * `directDamage` instead. Returns indices hit and destroyed.
 */
export function blast(
  blocks: Block[],
  x: number,
  y: number,
  radius: number,
  damage: number,
  direct = -1,
  directDamage = damage,
  /** Which blocks splash damage can reach (e.g. a keep that only falls to direct hits). */
  splash: (b: Block) => boolean = () => true,
): { hit: number[]; destroyed: number[] } {
  const hit: number[] = []
  const destroyed: number[] = []
  blocks.forEach((b, i) => {
    if (b.hp <= 0) return
    const dmg =
      i === direct ? directDamage : splash(b) && distToBlock(b, x, y) <= radius ? damage : 0
    if (dmg <= 0) return
    b.hp = Math.max(0, b.hp - dmg)
    hit.push(i)
    if (b.hp === 0) destroyed.push(i)
  })
  return { hit, destroyed }
}

export interface Impact {
  x: number
  y: number
  /** Block index hit directly, or -1 for the ground. */
  block: number
  /** Left the table. */
  out: boolean
  t: number
}

/** Fly a shell to its first impact without touching anything (for previews and bots). */
export function simulate(
  x: number,
  y: number,
  shot: ShotParams,
  b: Ballistics,
  wind: number,
  blocks: readonly Block[],
  ignore: (block: Block) => boolean = () => false,
  dt = 1 / 60,
): Impact {
  const s = launch(x, y, shot, b)
  for (let i = 0; i < 600; i++) {
    stepShell(s, dt, wind, b)
    const hit = blockAt(blocks, s.x, s.y, s.z)
    if (hit >= 0 && !ignore(blocks[hit] as Block))
      return { x: s.x, y: s.y, block: hit, out: false, t: s.t }
    if (s.z <= 0) return { x: s.x, y: s.y, block: -1, out: false, t: s.t }
    if (s.x < -300 || s.x > W + 300 || s.y < -400 || s.y > 2200)
      return { x: s.x, y: s.y, block: -1, out: true, t: s.t }
  }
  return { x: s.x, y: s.y, block: -1, out: true, t: 10 }
}

/** Points of the flight path (ground position + height), for the dotted preview. */
export function trace(
  x: number,
  y: number,
  shot: ShotParams,
  b: Ballistics,
  wind: number,
  fraction = 0.5,
  n = 14,
): { x: number; y: number; z: number }[] {
  const v = b.vmax * shot.power
  const tFlight = (v * b.elev + Math.sqrt((v * b.elev) ** 2 + 2 * b.g * b.z0)) / b.g
  const s = launch(x, y, shot, b)
  const out: { x: number; y: number; z: number }[] = []
  const dt = (tFlight * fraction) / n
  for (let i = 0; i < n; i++) {
    stepShell(s, dt, wind, b)
    out.push({ x: s.x, y: s.y, z: s.z })
  }
  return out
}

/**
 * Search direction × power for the shot whose first impact lands closest to
 * (tx, ty). `sim` returns the impact of a candidate. Coarse grid, then refine.
 */
export function solveShot(
  sim: (shot: ShotParams) => Impact,
  from: { x: number; y: number },
  target: { x: number; y: number },
  score: (impact: Impact) => number = (im) =>
    im.out ? 1e9 : Math.hypot(im.x - target.x, im.y - target.y),
): ShotParams {
  const base = Math.atan2(target.y - from.y, target.x - from.x)
  let best: ShotParams = { dx: Math.cos(base), dy: Math.sin(base), power: 0.7 }
  let bestScore = Infinity
  const tryShot = (a: number, p: number) => {
    if (p <= 0.05 || p > 1) return
    const shot = { dx: Math.cos(a), dy: Math.sin(a), power: p }
    const sc = score(sim(shot))
    if (sc < bestScore) {
      bestScore = sc
      best = shot
    }
  }
  for (let ia = -10; ia <= 10; ia++)
    for (let p = 0.2; p <= 1.0001; p += 0.04) tryShot(base + ia * 0.035, p)
  const a0 = Math.atan2(best.dy, best.dx)
  const p0 = best.power
  for (let ia = -4; ia <= 4; ia++)
    for (let ip = -4; ip <= 4; ip++) tryShot(a0 + ia * 0.008, p0 + ip * 0.008)
  return best
}

/** Shake a solved shot by difficulty: angle and power error. */
export function jitter(shot: ShotParams, rng: Rng, angleErr: number, powerErr: number): ShotParams {
  const a = Math.atan2(shot.dy, shot.dx) + (rng.next() * 2 - 1) * angleErr
  return {
    dx: Math.cos(a),
    dy: Math.sin(a),
    power: Math.min(1, Math.max(0.1, shot.power + (rng.next() * 2 - 1) * powerErr)),
  }
}

// ---------- drawing ----------

/** Dotted ground track of the preview; dots grow with height so the arc reads. */
export function drawTrajectory(
  g: Draw,
  pts: readonly { x: number; y: number; z: number }[],
  color: string = C.white,
): void {
  pts.forEach((p, i) => {
    const a = 1 - i / (pts.length + 2)
    g.alpha(a * 0.25, () => g.circle(p.x, p.y, 8, '#000'))
    g.alpha(a, () => g.circle(p.x - p.z * 0.12, p.y - p.z * 0.18, 7 + p.z * 0.03, color))
  })
}

/** Shell in flight: ground shadow under it, the ball lifted toward the light and scaled by height. */
export function drawShell(g: Draw, s: Shell, color: string = C.ink2, r = 20): void {
  const k = 1 + Math.max(0, s.z) / 380
  g.alpha(0.4 / k, () =>
    g.ellipse(s.x, s.y, r * (1.2 - Math.min(0.5, s.z / 1200)), r * 0.7, '#000'),
  )
  g.ball(s.x - s.z * 0.12, s.y - s.z * 0.18, r * k, color, 0.9)
}

/**
 * Wind sock at the midline: an arrow along world x whose length and colour
 * say the strength. `max` is the strongest wind the game rolls.
 */
export function drawWind(g: Draw, wind: number, max: number, y = MID): void {
  const k = Math.min(1, Math.abs(wind) / max)
  const dir = Math.sign(wind) || 1
  const col = k < 0.35 ? C.green : k < 0.7 ? C.yellow : C.orange
  g.rrect(W / 2 - 170, y - 46, 340, 92, 46, alpha(C.ink, 0.72))
  if (k < 0.05) {
    g.both('Calm', { size: 36, weight: 600, color: alpha(C.white, 0.8), gap: 0 }, y)
    return
  }
  const len = 70 + 150 * k
  const x0 = W / 2 - (dir * len) / 2
  const x1 = W / 2 + (dir * len) / 2
  g.line(x0, y, x1 - dir * 22, y, col, 14)
  g.poly([x1, y, x1 - dir * 34, y - 26, x1 - dir * 34, y + 26], col)
  // Gust streaks drifting with the wind.
  for (let i = 0; i < 3; i++) {
    const f = (g.t * (0.6 + k) + i / 3) % 1
    const sx = W / 2 - dir * 150 + dir * 300 * f
    g.alpha(Math.sin(f * Math.PI) * 0.6, () =>
      g.line(sx, y - 30 + i * 30, sx + dir * 40, y - 30 + i * 30, alpha(C.white, 0.7), 4),
    )
  }
}

/** Stone block with a team stripe, chunky lip by height, cracks when hurt. */
export function drawBlock(g: Draw, b: Block, team: string, stone = '#8d86a8'): void {
  if (b.hp <= 0) return
  const lip = Math.min(26, b.height * 0.2)
  const x = b.x - b.w / 2
  const y = b.y - b.h / 2 - lip
  g.shadow(b.x + 8, b.y + b.h / 2 + 4, b.w * 0.6, 12, 0.35)
  g.tile(x, y, b.w, b.h + lip, 12, stone, lip)
  g.rrect(x + 6, y + 6, b.w - 12, 10, 5, team)
  const dmg = 1 - b.hp / b.max
  if (dmg > 0) {
    const c = shade(stone, -0.55)
    g.line(b.x - b.w * 0.3, y + 22, b.x, y + b.h * 0.5, c, 4)
    g.line(b.x, y + b.h * 0.5, b.x + b.w * 0.15, y + b.h * 0.85, c, 4)
    if (dmg > 0.5) {
      g.line(b.x + b.w * 0.32, y + 24, b.x + b.w * 0.05, y + b.h * 0.45, c, 4)
      g.line(b.x - b.w * 0.05, y + b.h * 0.6, b.x - b.w * 0.35, y + b.h * 0.8, c, 4)
    }
  }
}
