import type { Side } from '../../core/game.ts'
import { banner } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { H, MID } from '../../core/stage.ts'
import {
  type Block,
  drawBlock,
  type Shell,
  drawShell,
  drawTrajectory,
  drawWind,
} from '../../engines/aim/index.ts'
import { cannonOf, coreOf, type State, WIND_MAX } from './rules.ts'

/** Top-down meadow: mowed stripes, a dirt track across the middle, each end tinted by its team. */
export function drawField(g: Draw): void {
  // A meadow at night: dark mowed stripes, each fort floodlit, each end owned by its team.
  g.fillView(shade(C.grassDark, -0.62))
  const v = g.stage.view
  for (let y = Math.floor(v.y / 120) * 120; y < v.y + v.h; y += 120) {
    if ((y / 120) % 2 === 0) g.rect(v.x - 2, y, v.w + 4, 120, alpha(shade(C.grass, -0.45), 0.55))
  }
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, alpha(SIDE[1].dark, 0.62)],
      [0.3, alpha(SIDE[1].dark, 0)],
      [0.7, alpha(SIDE[0].dark, 0)],
      [1, alpha(SIDE[0].dark, 0.62)],
    ]),
  )
  // Floodlight pools on both forts.
  for (const side of [0, 1] as Side[]) {
    const k = coreOf(side)
    g.fillView(
      g.rad(k.x, k.y, 60, 560, [
        [0, alpha('#fff4d8', 0.16)],
        [1, alpha('#fff4d8', 0)],
      ]),
    )
  }
  // Dirt track along the midline, wobbly edges baked from a fixed sine, with a lip and pebbles.
  const edge = (c: CanvasRenderingContext2D, dy: number) => {
    c.moveTo(v.x - 10, MID - 70 + dy)
    for (let x = v.x; x <= v.x + v.w + 20; x += 40)
      c.lineTo(x, MID - 70 + dy + Math.sin(x * 0.013) * 12)
    for (let x = v.x + v.w + 20; x >= v.x - 20; x -= 40)
      c.lineTo(x, MID + 70 + dy + Math.sin(x * 0.011 + 2) * 12)
    c.closePath()
  }
  g.path((c) => edge(c, 8), alpha('#000000', 0.3))
  g.path((c) => edge(c, 0), shade(C.sand, -0.58))
  g.path((c) => edge(c, 0), undefined, alpha(shade(C.sand, -0.3), 0.6), 4)
  for (let i = 0; i < 14; i++) {
    const x = (i * 173 + 61) % 1000
    const y = MID + Math.sin(i * 2.7) * 44
    g.ellipse(x, y, 9 + (i % 3) * 4, 6 + (i % 2) * 2, alpha(shade(C.sand, -0.2), 0.45))
  }
  g.vignette(0.36)
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
  flash = 1,
): void {
  const c = cannonOf(side)
  const col = SIDE[side]
  const a = Math.atan2(dir.dy, dir.dx)
  // Anticipation: the carriage squats as the pull grows and trembles near full power.
  const squat = 1 - power * 0.1 + recoil * 0.12
  const tremble = power > 0.8 ? Math.sin(g.t * 70) * (power - 0.8) * 12 : 0
  g.shadow(c.x + 6, c.y + 26, 64, 24, 0.4)
  if (flash < 0.12) {
    const k = 1 - flash / 0.12
    g.alpha(k, () =>
      g.circle(c.x + dir.dx * 140, c.y + dir.dy * 140, 30 + 30 * k, alpha(C.yellow, 0.8)),
    )
  }
  g.at(
    c.x + tremble,
    c.y,
    a,
    () => {
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
    },
    squat,
    1 / squat,
  )
}

let cachedOrder: number[] = []
let cachedFor: Block[] | null = null
function order(s: State): number[] {
  if (cachedFor !== s.blocks) {
    cachedFor = s.blocks
    cachedOrder = s.blocks
      .map((_, i) => i)
      .sort((i, j) => (s.blocks[i]?.y ?? 0) - (s.blocks[j]?.y ?? 0))
  }
  return cachedOrder
}

/** A hit block shudders; a destroyed one sinks into rubble instead of vanishing. */
function drawFortBlock(g: Draw, s: State, i: number, now: number): void {
  const b = s.blocks[i] as Block
  const since = now - (s.hitAt[i] ?? -1)
  const fresh = (s.hitAt[i] ?? -1) >= 0
  if (b.hp <= 0) {
    if (!fresh || since > CRUMBLE) return
    const k = since / CRUMBLE
    g.alpha(1 - k, () =>
      g.at(b.x, b.y, 0, () => g.at(-b.x, -b.y, 0, () => draw({ ...b, hp: 1 })), 1 - k * 0.5),
    )
    return
  }
  const shudder = fresh && since < WOBBLE ? Math.sin(since * 70) * 7 * (1 - since / WOBBLE) : 0
  if (shudder) g.at(shudder, 0, 0, () => draw(b))
  else draw(b)
  function draw(bb: Block) {
    if (bb.kind === 'core') drawKeep(g, bb, s.wind, now)
    else drawBlock(g, bb, SIDE[bb.side].main)
  }
}

/** Shell with a puff trail: the trail dots sit at the shell's lifted position, fading with age. */
function drawFlight(g: Draw, shell: Shell | null, trail: Look['trail']): void {
  for (let i = 0; i < trail.length; i++) {
    const p = trail[i] as { x: number; y: number; z: number }
    const a = (i + 1) / (trail.length + 1)
    g.alpha(a * 0.45, () =>
      g.circle(p.x - p.z * 0.12, p.y - p.z * 0.18, 6 + a * 10, alpha('#e8e2f0', 0.8)),
    )
  }
  if (!shell) return
  drawShell(g, shell, C.ink4, 22)
  // A lit fuse on top so the ball reads against the dark meadow.
  const k = 1 + Math.max(0, shell.z) / 380
  const fx = shell.x - shell.z * 0.12 + 8 * k
  const fy = shell.y - shell.z * 0.18 - 20 * k
  g.circle(fx, fy, 5 + Math.sin(g.t * 40) * 2, C.yellow)
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
  /** The shell in flight, interpolated for this frame. */
  shell: Shell | null
  /** Recent shell positions, oldest first: the smoke trail. */
  trail: readonly { x: number; y: number; z: number }[]
  /** Seconds since the last shot (muzzle flash). */
  fired: number
}

/** How long a hit block shudders, and a destroyed one takes to crumble. */
const WOBBLE = 0.35
const CRUMBLE = 0.4

export function render(g: Draw, s: State, look: Look, now: number): void {
  drawField(g)
  for (const c of s.craters) {
    g.ellipse(c.x, c.y, c.r, c.r * 0.62, alpha('#1a120c', 0.5))
    g.ellipse(c.x - 3, c.y - 2, c.r * 0.55, c.r * 0.34, alpha('#000000', 0.35))
  }
  drawWind(g, s.wind, WIND_MAX)
  // Back to front so lips overlap correctly (the fort layout never changes, so this order is fixed).
  for (const i of order(s)) drawFortBlock(g, s, i, now)
  for (const side of [0, 1] as Side[]) {
    const dir = s.turn === side && look.aim ? look.aim : s.aim[side]
    drawCannon(
      g,
      side,
      dir,
      look.recoil[side],
      s.turn === side && look.aim ? look.aim.power : 0,
      s.turn === side ? look.fired : 1,
    )
  }
  if (look.aim && s.phase === 'aim') drawTrajectory(g, look.aim.preview, SIDE[s.turn].light)
  drawFlight(g, look.shell, look.trail)
  for (const side of [0, 1] as Side[]) {
    if (!look.hint[side]) continue
    const y = side === 0 ? MID + 330 : MID - 330
    banner(g, side, 'Pull back anywhere, let go to fire', y, {
      size: 38,
      alpha: 0.75 + 0.25 * Math.sin(now * 4),
    })
  }
}
