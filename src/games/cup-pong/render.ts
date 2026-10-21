import type { Side } from '../../core/game.ts'
import { banner, hudY } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { drawTrajectory, type Shell, type ShotParams, trace } from '../../engines/aim/index.ts'
import { BALL, type Cup, CUP_R, originOf, type State } from './rules.ts'

/** Where a cup's rim sits relative to its foot: up toward the light, so the wall shows below it. */
const LX = -6
const LY = -16
/** The foot sits a little below the footprint centre. */
const FOOT = 14
const DRINK = '#ffe2a0'
const BALL_COL = '#fff8ef'

/** The table: dark lacquer, each half washed in its owner's colour, floodlights on the cups, a white rim and centre line. */
export function drawTable(g: Draw): void {
  g.fillView('#141826')
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, alpha(SIDE[1].main, 0.34)],
      [0.47, alpha(SIDE[1].dark, 0.1)],
      [0.53, alpha(SIDE[0].dark, 0.1)],
      [1, alpha(SIDE[0].main, 0.34)],
    ]),
  )
  // Lacquer sheen: long soft streaks.
  for (let i = 0; i < 5; i++) {
    const x = 120 + i * 190
    g.alpha(0.04, () => g.rect(x, -100, 46, H + 200, '#ffffff'))
  }
  for (const y of [1500, 300]) {
    g.fillView(
      g.rad(W / 2, y, 30, 460, [
        [0, alpha('#fff6dc', 0.18)],
        [1, alpha('#fff6dc', 0)],
      ]),
    )
  }
  // Side rails run on past both ends: the table carries on under each player's
  // HUD row to their edge, so the name pills and trays never sit on a rail.
  const v = g.stage.view
  for (const x of [36, W - 36]) {
    g.line(x + 4, v.y - 10, x + 4, v.y + v.h + 10, alpha('#000000', 0.35), 12, 'butt')
    g.line(x, v.y - 10, x, v.y + v.h + 10, alpha(C.white, 0.7), 10, 'butt')
  }
  g.line(36, MID, W - 36, MID, alpha(C.white, 0.5), 8)
  g.ring(W / 2, MID, 120, alpha(C.white, 0.22), 8)
  g.ring(W / 2, MID, 26, alpha(C.white, 0.22), 8)
  g.vignette(0.4)
}

/** A party cup standing on the table: its wall below the rim, a rolled white lip, a drink inside. */
function cupBody(g: Draw, x: number, y: number, col: string, k = 1): void {
  const r = CUP_R * k
  const rb = r * 0.72
  const fx = x
  const fy = y + FOOT * k
  const rx = x + LX * k
  const ry = y + LY * k
  g.shadow(fx + 12, fy + 6, r * 1.05, r * 0.45, 0.5)
  // Wall: from the foot up to the rim, shaded like a cylinder.
  const wall = g.lin(x - r, 0, x + r, 0, [
    [0, shade(col, -0.5)],
    [0.28, col],
    [0.5, shade(col, 0.3)],
    [0.7, col],
    [1, shade(col, -0.55)],
  ])
  g.path((c) => {
    c.moveTo(rx - r, ry)
    c.lineTo(fx - rb, fy)
    c.arc(fx, fy, rb, Math.PI, 0, true)
    c.lineTo(rx + r, ry)
    c.closePath()
  }, wall)
  // Ridges round the wall.
  for (const f of [0.35, 0.65]) {
    const cy = fy + (ry - fy) * f
    const cr = rb + (r - rb) * f
    g.arc(x + LX * k * f, cy, cr, 0.3, Math.PI - 0.3, alpha('#000000', 0.22), 4 * k)
  }
  // Rolled lip, then the inside and the drink.
  g.circle(rx, ry, r, '#f4eee6')
  g.circle(rx, ry, r * 0.88, shade(col, -0.62))
  g.circle(rx + 1 * k, ry + 6 * k, r * 0.66, shade(DRINK, -0.25))
  g.circle(rx + 1 * k, ry + 5 * k, r * 0.62, DRINK)
  g.alpha(0.8, () => g.ellipse(rx - r * 0.18, ry - r * 0.02, r * 0.26, r * 0.09, '#ffffff', -0.3))
  g.alpha(0.6, () => g.arc(rx, ry, r * 0.95, Math.PI * 1.08, Math.PI * 1.45, '#ffffff', 4 * k))
}

/**
 * A cup: standing, or (once sunk) the ball dropping in with a splash, then the
 * cup lifted off the table leaving a wet ring.
 */
export function drawCup(g: Draw, c: Cup, hop: number): void {
  const col = SIDE[c.side].main
  if (c.alive) {
    cupBody(g, c.x, c.y - hop, col)
    return
  }
  g.ring(c.x, c.y + FOOT, CUP_R * 0.72, alpha(DRINK, 0.12), 6)
  const t = c.fall
  if (t < 0.32) {
    // The ball sinks in; the water jumps.
    cupBody(g, c.x, c.y, col, 1 + Math.sin((t / 0.32) * Math.PI) * 0.12)
    const k = 1 - t / 0.32
    g.ball(c.x + LX + 2, c.y + LY + 4, 15 * (0.5 + 0.5 * k), BALL_COL, 0.8)
    g.alpha(k, () => g.ring(c.x + LX, c.y + LY, CUP_R * (0.6 + (1 - k) * 0.9), DRINK, 8))
    return
  }
  const p = (t - 0.32) / 0.5
  if (p >= 1) return
  // Lifted off the table: up toward the light, a little bigger, fading.
  g.alpha(1 - p, () => cupBody(g, c.x, c.y - p * 140, col, 1 + p * 0.25))
}

/** The ping-pong ball: shadow on the table, the ball lifted by its height, a short trail. */
export function drawBall(g: Draw, sh: Shell, side: Side): void {
  for (let i = 5; i >= 1; i--) {
    const tau = i * 0.025
    const z = sh.z - sh.vz * tau - 0.5 * BALL.g * tau * tau
    if (z < 0) continue
    const x = sh.x - sh.vx * tau
    const y = sh.y - sh.vy * tau
    g.alpha(0.3 - i * 0.05, () =>
      g.circle(x - z * 0.12, y - z * 0.18, 16 + z * 0.03, SIDE[side].light),
    )
  }
  const k = 1 + Math.max(0, sh.z) / 380
  g.alpha(0.45 / k, () =>
    g.ellipse(sh.x, sh.y, 20 * (1.2 - Math.min(0.5, sh.z / 1200)), 12, '#000'),
  )
  g.ball(sh.x - sh.z * 0.12, sh.y - sh.z * 0.18, 18 * k, BALL_COL, 1)
}

/** Dotted start of the flick being held: the first part only, so the aim is still a skill. */
function drawPreview(g: Draw, side: Side, shot: ShotParams): void {
  const o = originOf(side)
  drawTrajectory(g, trace(o.x, o.y, shot, BALL, 0, 0.5, 12), SIDE[side].light)
}

export interface Look {
  /** The flick being previewed for the side whose turn it is, if any. */
  preview: ShotParams | null
  /** Seconds since the last cup fell, or -1 while playing. */
  end: number
  winner: Side | null
}

export function render(g: Draw, s: State, look: Look, now: number): void {
  drawTable(g)
  // Back to front so nearer cups overlap farther ones.
  const order = s.cups.map((_, i) => i).sort((i, j) => (s.cups[i]?.y ?? 0) - (s.cups[j]?.y ?? 0))
  for (const i of order) {
    const c = s.cups[i] as Cup
    let hop = 0
    if (look.end >= 0 && look.winner === c.side) {
      // The winner's cups do a wave.
      const k = (i % 6) * 0.12
      hop = Math.max(0, Math.sin((look.end - k) * 9)) * 18
    }
    drawCup(g, c, hop)
  }
  // The ball waits on its tee in front of whoever may flick.
  if (s.phase === 'aim' && look.end < 0) {
    const o = originOf(s.turn)
    const col = SIDE[s.turn]
    const born = Math.min(1, (s.t - s.turnAt) / 0.3)
    g.circle(o.x, o.y, 40, alpha(col.dark, 0.6))
    g.ring(o.x, o.y, 44 + Math.sin(now * 5) * 4, alpha(col.light, 0.75), 6)
    g.shadow(o.x + 3, o.y + 6, 18, 9, 0.45)
    g.ball(o.x, o.y - 6 - (1 - born) * 60, 18, BALL_COL, 1)
    if (look.preview) drawPreview(g, s.turn, look.preview)
  }
  if (s.ball) drawBall(g, s.ball.shell, s.ball.side)
}

/** The explanation for the player whose turn it is: chevrons toward the rival and a banner. */
export function hint(g: Draw, s: State, now: number): void {
  if (s.phase !== 'aim' || s.aiming) return
  const side = s.turn
  const o = originOf(side)
  const dir = side === 0 ? -1 : 1
  for (let i = 0; i < 3; i++) {
    const p = (now * 1.4 + i / 3) % 1
    const y = o.y + dir * (70 + p * 150)
    g.alpha(Math.sin(p * Math.PI) * 0.9, () =>
      g.poly([o.x - 34, y - dir * 18, o.x, y + dir * 10, o.x + 34, y - dir * 18], SIDE[side].light),
    )
  }
  const y = side === 0 ? 1010 : 790
  banner(g, side, 'Flick toward their cups', y, {
    size: 40,
    alpha: 0.75 + 0.25 * Math.sin(now * 4),
  })
}

/** Cups this side has sunk, as balls in a tray beside its name pill. */
export function drawTray(g: Draw, s: State, side: Side, sunk: number, now: number): void {
  const y = hudY(g, side, 70)
  const x = side === 0 ? W - 205 : 205
  const col = SIDE[side]
  g.forSide(side, x, y, () => {
    g.rrect(-150, -32, 300, 64, 32, alpha(C.ink, 0.7))
    const n = s.goal
    for (let i = 0; i < n; i++) {
      const bx = (i - (n - 1) / 2) * 44
      if (i < sunk) {
        const fresh = s.t - (lastSunk(s, side, i) ?? -9)
        const pop = fresh >= 0 && fresh < 0.35 ? 1 + (1 - fresh / 0.35) * 0.6 : 1
        g.circle(bx, 0, 17 * pop, col.main)
        g.ball(bx, -1, 13 * pop, BALL_COL, 0.9)
      } else {
        g.circle(bx, 0, 14, alpha('#ffffff', 0.1))
      }
    }
    if (sunk >= n - 1 && sunk < n) {
      g.alpha(0.5 + 0.5 * Math.sin(now * 8), () =>
        g.rrect(-150, -32, 300, 64, 32, undefined, C.yellow, 5),
      )
    }
  })
}

/** Match time the i-th cup sunk by `side` went down. */
function lastSunk(s: State, side: Side, i: number): number | undefined {
  const fell = s.cups
    .filter((c) => c.side !== side && !c.alive)
    .map((c) => s.t - c.fall)
    .sort((a, b) => a - b)
  return fell[i]
}
