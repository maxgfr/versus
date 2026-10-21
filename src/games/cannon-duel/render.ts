import type { Side } from '../../core/game.ts'
import { banner } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { H, MID } from '../../core/stage.ts'
import {
  type Block,
  drawBlock,
  drawShell,
  drawTrajectory,
  drawWind,
} from '../../engines/aim/index.ts'
import { cannonOf, type State, WIND_MAX } from './rules.ts'

/** Top-down meadow: mowed stripes, a dirt track across the middle, each end tinted by its team. */
export function drawField(g: Draw): void {
  g.fillView(C.grassDark)
  const v = g.stage.view
  for (let y = Math.floor(v.y / 120) * 120; y < v.y + v.h; y += 120) {
    if ((y / 120) % 2 === 0) g.rect(v.x - 2, y, v.w + 4, 120, shade(C.grass, -0.08))
  }
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, alpha(SIDE[1].dark, 0.35)],
      [0.25, alpha(SIDE[1].dark, 0)],
      [0.75, alpha(SIDE[0].dark, 0)],
      [1, alpha(SIDE[0].dark, 0.35)],
    ]),
  )
  // Dirt track along the midline, wobbly edges baked from a fixed sine.
  g.path(
    (c) => {
      c.moveTo(v.x - 10, MID - 70)
      for (let x = v.x; x <= v.x + v.w + 20; x += 40)
        c.lineTo(x, MID - 70 + Math.sin(x * 0.013) * 12)
      for (let x = v.x + v.w + 20; x >= v.x - 20; x -= 40)
        c.lineTo(x, MID + 70 + Math.sin(x * 0.011 + 2) * 12)
      c.closePath()
    },
    shade(C.sand, -0.25),
  )
  g.vignette(0.22)
}

/** The keep: a round tower in the team colour with a flag that flutters in the wind. */
export function drawKeep(g: Draw, b: Block, wind: number, t: number): void {
  const col = SIDE[b.side]
  if (b.hp <= 0) {
    // Rubble.
    g.shadow(b.x, b.y + 30, 70, 20, 0.4)
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4
      g.rrect(
        b.x + Math.cos(a) * 30 - 16,
        b.y + Math.sin(a) * 22 - 12,
        32,
        24,
        6,
        shade('#8d86a8', -0.2 - (i % 3) * 0.1),
      )
    }
    return
  }
  const r = b.w * 0.55
  g.shadow(b.x + 6, b.y + r * 0.7, r * 1.1, r * 0.45, 0.45)
  g.circle(b.x, b.y + 16, r, shade('#8d86a8', -0.4))
  g.circle(
    b.x,
    b.y,
    r,
    g.rad(
      b.x,
      b.y,
      4,
      r,
      [
        [0, shade('#8d86a8', 0.2)],
        [1, '#8d86a8'],
      ],
      b.x - r * 0.3,
      b.y - r * 0.3,
    ),
  )
  // Crenellations
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    g.circle(
      b.x + Math.cos(a) * r * 0.86,
      b.y + Math.sin(a) * r * 0.86,
      r * 0.13,
      shade('#8d86a8', 0.28),
    )
  }
  g.circle(b.x, b.y, r * 0.62, col.main)
  g.circle(b.x, b.y, r * 0.42, col.dark)
  // Flag on a pole, streaming with the wind.
  const dir = wind >= 0 ? 1 : -1
  const flap = Math.sin(t * 8) * 6
  g.line(b.x, b.y, b.x, b.y - r * 1.2, C.ink, 6)
  g.poly(
    [
      b.x,
      b.y - r * 1.2,
      b.x + dir * (50 + Math.abs(wind) * 0.08),
      b.y - r * 1.05 + flap,
      b.x,
      b.y - r * 0.85,
    ],
    col.light,
  )
  // Damage: dark scorch marks per lost stone.
  for (let i = 0; i < b.max - b.hp; i++) {
    const a = 0.8 + i * 2.1
    g.alpha(0.55, () =>
      g.circle(b.x + Math.cos(a) * r * 0.5, b.y + Math.sin(a) * r * 0.5, r * 0.28, C.ink),
    )
  }
}

export function drawCannon(
  g: Draw,
  side: Side,
  dir: { dx: number; dy: number },
  recoil: number,
  power: number,
): void {
  const c = cannonOf(side)
  const col = SIDE[side]
  const a = Math.atan2(dir.dy, dir.dx)
  g.shadow(c.x + 6, c.y + 26, 64, 24, 0.4)
  g.at(c.x, c.y, a, () => {
    // Carriage and wheels, barrel along +x.
    g.rrect(-46, -40, 70, 80, 16, shade(C.wood, -0.25))
    g.rrect(-42, -46, 60, 14, 6, C.ink)
    g.rrect(-42, 32, 60, 14, 6, C.ink)
    const len = 96 + power * 20 - recoil * 26
    g.rrect(-20, -20, len, 40, 18, shade(C.ink3, -0.2))
    g.rrect(-20, -20, len, 16, 8, alpha('#ffffff', 0.12))
    g.rrect(len - 34, -24, 18, 48, 8, col.main)
    g.circle(-24, 0, 26, col.dark)
    g.circle(-24, 0, 14, col.main)
  })
}

export interface Look {
  /** Current aim for the side whose turn it is (finger or bot), null when idle. */
  aim: {
    dx: number
    dy: number
    power: number
    preview: { x: number; y: number; z: number }[]
  } | null
  recoil: [number, number]
  hint: [boolean, boolean]
}

export function render(g: Draw, s: State, look: Look, now: number): void {
  drawField(g)
  drawWind(g, s.wind, WIND_MAX)
  // Back to front so lips overlap correctly.
  const order = s.blocks
    .map((_, i) => i)
    .sort((i, j) => (s.blocks[i]?.y ?? 0) - (s.blocks[j]?.y ?? 0))
  for (const i of order) {
    const b = s.blocks[i] as Block
    if (b.kind === 'core') drawKeep(g, b, s.wind, now)
    else drawBlock(g, b, SIDE[b.side].main)
  }
  for (const side of [0, 1] as Side[]) {
    const dir = s.turn === side && look.aim ? look.aim : s.aim[side]
    drawCannon(g, side, dir, look.recoil[side], s.turn === side && look.aim ? look.aim.power : 0)
  }
  if (look.aim && s.phase === 'aim') drawTrajectory(g, look.aim.preview, SIDE[s.turn].light)
  if (s.shell) drawShell(g, s.shell, C.ink2, 22)
  for (const side of [0, 1] as Side[]) {
    if (!look.hint[side]) continue
    const y = side === 0 ? MID + 330 : MID - 330
    banner(g, side, 'Pull back anywhere, let go to fire', y, {
      size: 38,
      alpha: 0.75 + 0.25 * Math.sin(now * 4),
    })
  }
}
