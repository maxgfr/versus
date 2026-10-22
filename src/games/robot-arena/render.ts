import type { Side } from '../../core/game.ts'
import { banner, namePill, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { type ControlLook, drawStrip } from '../../engines/arena/index.ts'
import { MID, W } from '../../core/stage.ts'
import { lerp, outBack } from '../../core/fx/ease.ts'
import { angleTo } from '../../engines/arena/index.ts'
import type { State } from './index.ts'
import {
  ARENA,
  ARENA_BOTTOM,
  HP,
  OVERCHARGE_T,
  PITS,
  R,
  type Robot,
  SAW,
  ZAP_ARC,
  zapCdAt,
  ZAP_RANGE,
} from './rules.ts'

const STEEL = '#a3a9bd'
const PLATE_A = '#2c3048'
const PLATE_B = '#282b42'
const HAZARD = '#e0742c'
const TILE = 100

const clamp01 = (k: number): number => Math.max(0, Math.min(1, k))

/** Cosmetic extras from the game (never in the state). */
export interface Look {
  alpha: number
  /** Last step's pose of each robot (by id), for interpolation. */
  prev: readonly ({ x: number; y: number; a: number } | undefined)[]
  /** Squash of each robot (by id) along its facing: < 1 squashed, > 1 stretched. */
  squash: [number, number]
}

/** Tiny deterministic hash, so lightning jags are the same on host and guest. */
function jag(seed: number, i: number): number {
  const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453
  return v - Math.floor(v) - 0.5
}

/** Steel diamond-plate floor in the floodlights, tinted toward each team's end, inside a bolted rim. */
function floor(g: Draw): void {
  const { x0, y0, size } = ARENA
  g.rrect(x0 - 30, y0 - 22, size + 60, size + 60, 40, alpha('#000000', 0.45))
  g.rrect(x0 - 28, y0 - 28, size + 56, size + 56, 38, '#3a3a52')
  g.rrect(
    x0 - 28,
    y0 - 28,
    size + 56,
    size + 56,
    38,
    g.lin(0, y0 - 28, 0, y0 + size + 28, [
      [0, alpha(C.blue, 0.4)],
      [0.5, alpha(C.blue, 0)],
      [0.5, alpha(C.red, 0)],
      [1, alpha(C.red, 0.4)],
    ]),
  )
  g.rect(x0, y0, size, size, PLATE_A)
  const n = size / TILE
  for (let r = 0; r < n; r++)
    for (let c = r % 2; c < n; c += 2) g.rect(x0 + c * TILE, y0 + r * TILE, TILE, TILE, PLATE_B)
  // Diamond tread bumps.
  const bump = alpha('#ffffff', 0.05)
  for (let r = 0; r < n * 2; r++)
    for (let c = 0; c < n * 2; c++) {
      const x = x0 + c * (TILE / 2) + TILE / 4
      const y = y0 + r * (TILE / 2) + TILE / 4
      const d = (c + r) % 2 ? 5 : -5
      g.line(x - 6, y + d, x + 6, y - d, bump, 4)
    }
  g.rect(
    x0,
    y0,
    size,
    size,
    g.lin(0, y0, 0, y0 + size, [
      [0, alpha(C.blue, 0.13)],
      [0.5, alpha(C.blue, 0)],
      [0.5, alpha(C.red, 0)],
      [1, alpha(C.red, 0.13)],
    ]),
  )
  g.rect(
    x0,
    y0,
    size,
    size,
    g.rad(W / 2, MID, 60, size * 0.7, [
      [0, alpha('#dfe8ff', 0.08)],
      [1, alpha('#dfe8ff', 0)],
    ]),
  )
  // Rim bolts and the team stripe on each player's wall.
  for (let k = 0; k <= 8; k++) {
    const t = k / 8
    for (const [bx, by] of [
      [x0 - 14 + (size + 28) * t, y0 - 14],
      [x0 - 14 + (size + 28) * t, y0 + size + 14],
      [x0 - 14, y0 - 14 + (size + 28) * t],
      [x0 + size + 14, y0 - 14 + (size + 28) * t],
    ] as const) {
      g.circle(bx, by, 6, '#55556e')
      g.circle(bx - 1.5, by - 1.5, 2.5, alpha('#ffffff', 0.25))
    }
  }
  g.rrect(x0 + 120, y0 - 24, size - 240, 8, 4, alpha(C.blue, 0.8))
  g.rrect(x0 + 120, y0 + size + 16, size - 240, 8, 4, alpha(C.red, 0.8))
}

/** A pit in the floor: hazard-striped lip, then a deep dark hole with a faint glow far below. */
function pit(g: Draw, x: number, y: number, r: number, now: number): void {
  g.circle(x, y, r + 16, '#1a1826')
  g.ctx.save()
  g.path((c) => c.arc(x, y, r + 14, 0, Math.PI * 2))
  g.ctx.clip()
  for (let k = -6; k <= 6; k++) {
    const o = k * 22
    g.line(x + o - 40, y + 40, x + o + 40, y - 40, k % 2 ? HAZARD : '#1a1826', 11, 'butt')
  }
  g.ctx.restore()
  g.circle(
    x,
    y,
    r,
    g.rad(
      x,
      y,
      4,
      r,
      [
        [0, mix('#3a0f18', '#000000', 0.2 + 0.1 * Math.sin(now * 2 + x))],
        [0.6, '#0c0a14'],
        [1, '#221d36'],
      ],
      x,
      y + r * 0.15,
    ),
  )
  g.arc(x, y, r - 4, Math.PI * 1.1, Math.PI * 1.9, alpha('#ffffff', 0.08), 4)
}

/** The spinning saw: a steel blade on a hazard-striped mount, throwing sparks of light. */
function saw(g: Draw, now: number, hot: number): void {
  const { x, y, r } = SAW
  g.circle(x, y, r + 22, '#1a1826')
  g.ring(x, y, r + 18, alpha(HAZARD, 0.8), 6)
  g.shadow(x + 8, y + 14, r * 1.05, r * 0.75, 0.35)
  g.at(x, y, now * 7, () => {
    g.star(0, 0, r + 8, '#26263a', 14, 0.82)
    g.star(0, 0, r + 2, STEEL, 14, 0.8)
    g.star(0, 0, r - 12, shade(STEEL, -0.18), 14, 0.8)
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2
      g.circle(Math.cos(a) * r * 0.38, Math.sin(a) * r * 0.38, 7, shade(STEEL, -0.45))
    }
  })
  // A light streak that sweeps the blade so it reads as spinning.
  g.arc(x, y, r * 0.78, now * 7, now * 7 + 0.9, alpha('#ffffff', 0.35), 6)
  g.ball(x, y, r * 0.3, mix(C.orange, '#ff3b2f', hot), 0.7)
  if (hot > 0) g.circle(x, y, r + 30, alpha(C.orange, 0.2 * hot))
}

/** The zap: a forked arc of lightning across the robot's front, flickering out over 0.25 s. */
function zap(g: Draw, r: Robot, now: number): void {
  const k = 1 - (now - r.zapT) / 0.25
  if (k <= 0) return
  const col = SIDE[r.side].light
  const reach = ZAP_RANGE + R
  g.path(
    (c) => {
      c.moveTo(r.x, r.y)
      c.arc(r.x, r.y, reach, r.a - ZAP_ARC, r.a + ZAP_ARC)
      c.closePath()
    },
    alpha(col, 0.16 * k),
  )
  g.arc(r.x, r.y, reach, r.a - ZAP_ARC, r.a + ZAP_ARC, alpha(col, 0.7 * k), 6)
  const flick = Math.floor(now * 30)
  for (let b = 0; b < 4; b++) {
    const a = r.a + ((b + 0.5) / 4 - 0.5) * ZAP_ARC * 1.8
    let px = r.x + Math.cos(r.a) * R
    let py = r.y + Math.sin(r.a) * R
    const pts = [px, py]
    const segs = 6
    for (let s = 1; s <= segs; s++) {
      const d = R + ((reach - R) * s) / segs
      const off = jag(r.zapT * 100 + flick, b * 10 + s) * 34
      px = r.x + Math.cos(a) * d - Math.sin(a) * off
      py = r.y + Math.sin(a) * d + Math.cos(a) * off
      pts.push(px, py)
    }
    const stroke = (col2: string, lw: number) =>
      g.path(
        (c) => {
          c.moveTo(pts[0]!, pts[1]!)
          for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i]!, pts[i + 1]!)
          c.lineJoin = 'round'
        },
        undefined,
        col2,
        lw,
      )
    stroke(alpha(col, 0.8 * k), 12)
    stroke(alpha('#ffffff', k), 4)
  }
}

/**
 * A top-down toy robot facing +x: chunky wheels, a team-coloured chassis lit
 * from the top, a visor with eyes, and a zap fork that glows yellow when ready.
 */
function robot(g: Draw, r: Robot, now: number, cheer: boolean, squash = 1): void {
  const full = zapCdAt(now)
  const col = SIDE[r.side]
  const hurt = clamp01(1 - (now - r.hitT) / 0.16)
  const fall = r.fell ? clamp01((now - r.koT) / 0.7) : 0
  if (!r.alive && !r.fell) {
    // A scorched wreck.
    g.shadow(r.x + 6, r.y + 12, R * 1.1, R * 0.8, 0.3)
    g.at(r.x, r.y, r.a + 0.4, () => {
      g.rrect(-R * 0.85, -R * 0.85, R * 1.7, R * 1.7, 18, '#2b2733')
      g.rrect(-R * 0.7, -R * 0.7, R * 1.4, R * 1.2, 14, '#3a3542')
      g.circle(R * 0.1, 0, R * 0.36, '#24202b')
      g.line(-R * 0.6, -R * 0.3, R * 0.5, R * 0.4, alpha('#000000', 0.5), 5)
      g.line(R * 0.5, -R * 0.2, R * 1.1, -R * 0.5, '#3a3542', 6)
    })
    return
  }
  const ready = r.cd <= 0
  const charge = clamp01(1 - r.cd / full)
  const shake = hurt > 0 ? jag(now * 50, r.id) * 8 * hurt : 0
  const hop = cheer ? Math.abs(Math.sin(now * 9)) * 10 : 0
  const sc = 1.12 * (1 - fall * 0.75) * (1 + hop / 120)
  // Idle hum of the motor, a stretch into speed and the spring's squash.
  const speed = Math.hypot(r.vx, r.vy) / 300
  const hum = 1 + Math.sin(now * 14 + r.id * 3) * 0.015
  const sx = sc * squash * (1 + speed * 0.05)
  const sy = (sc * hum) / Math.sqrt(Math.max(0.5, squash))
  g.alpha(1 - fall * 0.9, () => {
    if (fall < 0.5) g.shadow(r.x + 6, r.y + 14, R * 1.15, R * 0.8, 0.35)
    g.at(
      r.x + shake,
      r.y - hop,
      r.a + (cheer ? Math.sin(now * 9) * 0.25 : 0) + fall * Math.PI * 2,
      () => {
        // Wheels with turning treads.
        const roll = ((r.x + r.y) * 0.4) % 12
        for (const sy of [-1, 1]) {
          g.rrect(-R * 0.82, sy * R * 0.72 - R * 0.24, R * 1.64, R * 0.48, R * 0.2, '#1c1a26')
          for (let x = -R * 0.7 + roll; x < R * 0.7; x += 12)
            g.line(x, sy * R * 0.72 - R * 0.16, x, sy * R * 0.72 + R * 0.16, '#3a3648', 3)
        }
        // Chassis.
        g.rrect(-R * 0.8, -R * 0.74, R * 1.6, R * 1.56, 22, shade(col.main, -0.45))
        g.rrect(
          -R * 0.8,
          -R * 0.8,
          R * 1.6,
          R * 1.5,
          22,
          g.lin(0, -R * 0.8, 0, R * 0.7, [
            [0, shade(col.main, 0.22)],
            [1, shade(col.main, -0.15)],
          ]),
        )
        g.rrect(-R * 0.6, -R * 0.66, R * 1.1, R * 0.24, 8, alpha('#ffffff', 0.28))
        // Side marker on the back: red's circle, blue's square.
        g.sideMark(r.side, -R * 0.5, 0, 9, alpha(C.white, 0.85))
        // Zap fork at the front: two prongs, a yellow spark between them when ready.
        for (const sy of [-1, 1])
          g.rrect(R * 0.62, sy * R * 0.26 - 5, R * 0.5, 10, 5, shade(STEEL, -0.2))
        if (ready) {
          const f = 0.7 + 0.3 * Math.sin(now * 30)
          g.circle(R * 1.05, 0, 13 * f, alpha(C.yellow, 0.35))
          g.circle(R * 1.05, 0, 7 * f, C.yellow)
        } else
          g.arc(
            R * 1.05,
            0,
            9,
            -Math.PI / 2,
            -Math.PI / 2 + Math.PI * 2 * charge,
            alpha(C.white, 0.5),
            3,
          )
        // Visor with eyes looking forward.
        g.rrect(R * 0.05, -R * 0.42, R * 0.48, R * 0.84, 12, C.ink)
        const blink = Math.sin(now * 1.3 + r.id * 2) > 0.97
        for (const ey of [-1, 1]) {
          if (r.alive && !blink) {
            g.circle(R * 0.3, ey * R * 0.2, 6.5, cheer ? C.yellow : '#e8f6ff')
            g.circle(R * 0.36, ey * R * 0.2, 3, C.ink)
          } else g.line(R * 0.22, ey * R * 0.2, R * 0.4, ey * R * 0.2, '#e8f6ff', 3)
        }
        if (hurt > 0)
          g.alpha(0.75 * hurt, () =>
            g.rrect(-R * 0.84, -R * 0.84, R * 1.68, R * 1.62, 22, '#ffffff'),
          )
      },
      sx,
      sy,
    )
  })
  if (r.alive) {
    // A small health bar over the robot, upright for its player.
    g.forSide(r.side, r.x, r.y, () => {
      const w = 92
      const f = clamp01(r.hp / HP)
      g.rrect(-w / 2 - 4, -R * 1.5 - 10, w + 8, 20, 10, alpha(C.ink, 0.8))
      g.rrect(-w / 2, -R * 1.5 - 6, Math.max(12, w * f), 12, 6, f < 0.35 ? C.orange : col.light)
    })
  }
}

/** The zap button: a lightning glyph, a charge ring while it reloads, a yellow halo when ready. */
function controls(g: Draw, c: ControlLook): void {
  const col = SIDE[c.side]
  g.alpha(c.on ? 0.95 : 0.6, () => {
    g.circle(c.bx, c.by, c.r, alpha(col.dark, 0.45), alpha(col.light, 0.45), 5)
    g.ball(c.kx, c.ky, c.r * 0.46, col.main, 0.6)
  })
  const ready = c.ready >= 1
  const depth = c.fr * 0.16
  const p = c.pressed ? depth : 0
  const face = ready ? col.main : mix(col.main, C.ink3, 0.55)
  if (ready) g.circle(c.fx, c.fy, c.fr + 10 + Math.sin(g.t * 6) * 3, alpha(col.light, 0.18))
  g.circle(c.fx, c.fy + depth, c.fr, shade(face, -0.45))
  g.circle(
    c.fx,
    c.fy + p,
    c.fr,
    g.rad(
      c.fx,
      c.fy,
      c.fr * 0.1,
      c.fr,
      [
        [0, shade(face, 0.3)],
        [1, face],
      ],
      c.fx - c.fr * 0.3,
      c.fy - c.fr * 0.4,
    ),
  )
  if (!ready)
    g.arc(
      c.fx,
      c.fy + p,
      c.fr + 10,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * c.ready,
      alpha(C.white, 0.75),
      7,
    )
  g.forSide(c.side, c.fx, c.fy + p, () => {
    const k = c.fr / 92
    g.poly(
      [8, -48, -26, 6, -2, 6, -10, 48, 28, -10, 4, -10, 16, -48].map((v) => v * k),
      ready ? C.white : alpha(C.white, 0.5),
    )
  })
}

/** A fighting-game health bar along a player's edge: name, chunky segmented fill, flashing on a hit. */
function healthBar(
  g: Draw,
  side: Side,
  r: Robot | undefined,
  name: string,
  y: number,
  now: number,
): void {
  const col = SIDE[side]
  const w = 760
  const hp = r ? Math.max(0, r.hp) : 0
  const f = clamp01(hp / HP)
  const hit = r ? clamp01(1 - (now - r.hitT) / 0.2) : 0
  const low = f < 0.35
  g.forSide(side, W / 2 + jag(now * 40, side) * 10 * hit, y, () => {
    g.rrect(-w / 2 - 8, -32, w + 16, 64, 32, alpha(C.ink, 0.85))
    g.rrect(-w / 2, -24, w, 48, 24, shade(col.main, -0.65))
    if (f > 0) {
      const fill = low ? mix(C.orange, '#ff3b2f', 0.5 + 0.5 * Math.sin(now * 10)) : col.main
      g.rrect(
        -w / 2,
        -24,
        Math.max(48, w * f),
        48,
        24,
        g.lin(0, -24, 0, 24, [
          [0, shade(fill, 0.12)],
          [1, shade(fill, -0.12)],
        ]),
      )
      g.rrect(-w / 2 + 12, -19, Math.max(24, w * f - 24), 10, 5, alpha('#ffffff', 0.28))
    }
    // Segment ticks every 10 HP.
    for (let k = 1; k < 10; k++)
      g.line(-w / 2 + (w * k) / 10, -18, -w / 2 + (w * k) / 10, 18, alpha('#000000', 0.22), 3)
    if (hit > 0) g.alpha(0.6 * hit, () => g.rrect(-w / 2, -24, w, 48, 24, '#ffffff'))
    g.sideMark(side, -w / 2 + 30, 0, 11, C.white)
    g.text(name, -w / 2 + 54, 2, {
      size: 34,
      weight: 700,
      color: C.white,
      align: 'left',
      drop: alpha('#000000', 0.5),
      maxWidth: 420,
    })
    g.text(Math.ceil(hp), w / 2 - 24, 2, {
      size: 38,
      weight: 700,
      color: low ? C.yellow : C.white,
      align: 'right',
      drop: alpha('#000000', 0.5),
    })
  })
}

export interface View {
  names: [string, string]
  over: boolean
}

/** The arena, its pits and saw, the robots and their zaps, the controls and the edge HUD. */
export function renderRobots(g: Draw, s: State, now: number, v: View, look: Look): void {
  const w = s.w
  const r = s.rounds
  // Blend each robot between the last two steps.
  const shown = w.robots.map((k) => {
    const p = look.prev[k.id]
    if (!p) return k
    const t = look.alpha
    return { ...k, x: lerp(p.x, k.x, t), y: lerp(p.y, k.y, t), a: p.a + angleTo(p.a, k.a) * t }
  })
  g.fillView(C.ink)
  drawStrip(g, ARENA.y0 - 28, ARENA_BOTTOM + 28)
  floor(g)
  if (w.t >= OVERCHARGE_T) {
    // Overcharge: the arena rim crackles yellow.
    const k = Math.min(1, (w.t - OVERCHARGE_T) / 1)
    g.alpha(k * (0.3 + 0.25 * Math.sin(g.t * 11)), () =>
      g.rrect(
        ARENA.x0 - 14,
        ARENA.y0 - 14,
        ARENA.size + 28,
        ARENA.size + 28,
        30,
        undefined,
        C.yellow,
        8,
      ),
    )
  }
  for (const p of PITS) pit(g, p.x, p.y, p.r, w.t)
  const hot = Math.max(0, ...w.robots.map((k) => clamp01(1 - (w.t - k.sawT) / 0.3)))
  saw(g, w.t, hot)
  const champ = v.over && r.last !== 'draw' ? r.last : null
  for (const k of shown) if (k.fell) robot(g, k, w.t, false)
  for (const k of shown) if (!k.alive && !k.fell) robot(g, k, w.t, false)
  for (const k of shown)
    if (k.alive) robot(g, k, w.t, champ === k.side, look.squash[k.id as 0 | 1] ?? 1)
  for (const k of shown) zap(g, k, w.t)
  g.vignette(0.3)
  // Online, each phone shows only its own player's stick and button.
  for (const c of s.ctl) if (g.viewer === null || c.side === g.viewer) controls(g, c)
  for (const side of [0, 1] as const) {
    const rob = w.robots.find((k) => k.side === side)
    const y = side === 0 ? ARENA_BOTTOM + 72 : ARENA.y0 - 72
    healthBar(g, side, rob, v.names[side], y, w.t)
    namePill(g, side, v.names[side], { inset: 44, active: champ === side })
    pips(g, side, r.wins[side], r.target, { inset: 44 })
  }
  if (v.over) return
  if (r.phase === 'between' && r.text) {
    const col =
      r.last === 'draw' || r.last === null ? C.white : mix(C.white, SIDE[r.last].light, 0.4)
    banner(g, undefined, r.text, MID, {
      size: 56,
      alpha: Math.min(1, (now - r.at) * 4),
      color: col,
    })
  } else if (r.phase === 'play' && r.round > 1 && now - r.at < 1.1) {
    // Pops in, then fades as the robots roll out.
    const k = now - r.at
    const size = 64 * outBack(Math.min(1, k / 0.3))
    banner(g, undefined, `Round ${r.round}`, MID, { size, alpha: Math.min(1, (1.1 - k) / 0.3) })
  }
}
