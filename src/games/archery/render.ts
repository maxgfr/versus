import type { Side } from '../../core/game.ts'
import { banner, bigScore, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, shade, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { floodlit, tally, windSock } from './look.ts'
import { type Arrow, BOW, type Pt, result, TARGET, type State, WIND_MAX } from './rules.ts'

export interface Look {
  /** The draw on the side to move: its pull (0..1), the aim angle, and where the arrow would land. */
  draw: { power: number; angle: number; landing: Pt } | null
  /** Show the "pull back" hint to the human on turn. */
  hint: boolean
  /** Flight clock interpolated for this frame. */
  ft: number
  /** Spring offset of the boss rocking after a strike. */
  thump: number
  /** Archer squash springs (1 = rest). */
  squash: [number, number]
}

const hash = (i: number, k: number): number => {
  const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453
  return v - Math.floor(v)
}

/** Ring colours from the outside (1) in (10), with the line between rings. */
const FACE: [string, string][] = [
  ['#f4efe4', '#1b1628'],
  ['#f4efe4', '#1b1628'],
  ['#221c30', '#f4efe4'],
  ['#221c30', '#f4efe4'],
  ['#2f8df0', '#1b1628'],
  ['#2f8df0', '#1b1628'],
  ['#ef3b4a', '#1b1628'],
  ['#ef3b4a', '#1b1628'],
  ['#ffd23f', '#1b1628'],
  ['#ffd23f', '#1b1628'],
]

/** The range: mown lanes, a shooting line at each end in the team colour, floodlit. */
function drawRange(g: Draw): void {
  const v = g.stage.view
  g.fillView(shade(C.grassDark, -0.12))
  for (let i = 0; i < 16; i++)
    g.rect(
      v.x - 2,
      i * 120,
      v.w + 4,
      120,
      i % 2 === 0 ? shade(C.grass, -0.06) : shade(C.grass, -0.14),
    )
  for (let i = 0; i < 70; i++) {
    const x = v.x + hash(i, 1) * v.w
    const y = v.y + hash(i, 2) * v.h
    g.circle(x, y, 10 + hash(i, 3) * 16, alpha(shade(C.grassDark, -0.35), 0.12))
  }
  for (const side of [0, 1] as Side[]) {
    const y = side === 0 ? 1500 : 300
    g.rect(v.x - 2, y - 7, v.w + 4, 14, alpha(SIDE[side].main, 0.6))
    g.rect(v.x - 2, y - 7, v.w + 4, 5, alpha(C.white, 0.2))
  }
}

/** The target: a straw boss with a ten-ring face and an X in the gold. */
export function drawTarget(g: Draw): void {
  const { x, y, r } = TARGET
  g.ellipse(x + 18, y + 34, r * 1.12, r * 1.06, alpha('#000000', 0.38))
  // Straw boss, wound in rings.
  g.circle(x, y, r * 1.1, '#b48a3c')
  for (let i = 0; i < 6; i++)
    g.ring(x, y, r * (1.02 + i * 0.016), alpha(shade('#b48a3c', i % 2 ? 0.2 : -0.25), 0.7), 5)
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2 + hash(i, 4) * 0.1
    const r0 = r * (1.01 + hash(i, 5) * 0.02)
    g.line(
      x + Math.cos(a) * r0,
      y + Math.sin(a) * r0,
      x + Math.cos(a + 0.05) * r * 1.1,
      y + Math.sin(a + 0.05) * r * 1.1,
      alpha('#e8c97a', 0.6),
      3,
    )
  }
  // The face: ring 1 outside, ring 10 in the middle.
  for (let k = 1; k <= 10; k++) {
    const [fill, line] = FACE[k - 1] ?? ['#f4efe4', '#1b1628']
    g.circle(x, y, (r * (11 - k)) / 10, fill)
    g.ring(x, y, (r * (11 - k)) / 10, alpha(line, 0.5), 2.5)
  }
  g.ring(x, y, r * 0.05, alpha(C.ink, 0.6), 2.5)
  g.line(x - 8, y, x + 8, y, alpha(C.ink, 0.7), 3)
  g.line(x, y - 8, x, y + 8, alpha(C.ink, 0.7), 3)
  // Floodlight sheen.
  g.circle(
    x,
    y,
    r,
    g.rad(x - r * 0.4, y - r * 0.45, 0, r * 1.4, [
      [0, 'rgba(255,255,255,0.16)'],
      [0.55, 'rgba(255,255,255,0)'],
      [1, 'rgba(0,0,0,0.18)'],
    ]),
  )
}

/** The arrow in its own frame: the tip at the origin, the shaft running back along -x. */
export function arrowShape(g: Draw, side: Side, len = 110): void {
  const fin = SIDE[side].main
  g.line(-len, 0, -6, 0, shade('#e8d3a6', -0.25), 8)
  g.line(-len, -1.5, -6, -1.5, '#f1dfb8', 4)
  g.poly([2, 0, -16, 9, -16, -9], '#c9ced9')
  g.poly([-len, 0, -len + 30, 16, -len + 34, 0], fin)
  g.poly([-len, 0, -len + 30, -16, -len + 34, 0], shade(fin, -0.25))
  g.rect(-len + 36, -4, 8, 8, C.white)
}

/** The side's bow: limbs bent toward the aim, the string drawn back by the pull, an arrow nocked. */
export function drawBow(g: Draw, side: Side, angle: number, pull: number, nocked: boolean): void {
  const b = BOW[side]
  const h = 118
  // Grip forward (+x, toward the aim), tips swept back, the string straight across the tips at rest.
  // The draw stays short enough that a full pull never runs under the name pill at the edge.
  const tipX = -26 - pull * 16
  const nock = tipX - pull * 84
  g.shadow(b.x + 8, b.y + 24, 62, 16, 0.35)
  g.at(
    b.x,
    b.y,
    angle,
    () => {
      // String first, under the limbs.
      g.path(
        (c) => {
          c.moveTo(tipX, -h)
          c.lineTo(nock, 0)
          c.lineTo(tipX, h)
        },
        undefined,
        C.cream,
        4,
      )
      if (nocked) g.at(nock + 150, 0, 0, () => arrowShape(g, side, 150))
      const limb = (c: CanvasRenderingContext2D) => {
        c.moveTo(tipX, -h)
        c.quadraticCurveTo(26, -h * 0.75, 22, 0)
        c.quadraticCurveTo(26, h * 0.75, tipX, h)
      }
      g.path(limb, undefined, shade(C.woodDark, -0.25), 20)
      g.path(limb, undefined, C.wood, 13)
      g.path(limb, undefined, alpha(C.white, 0.3), 4)
      // Recurve tips in the team colour.
      g.circle(tipX, -h, 9, SIDE[side].main)
      g.circle(tipX, h, 9, SIDE[side].main)
      // Grip.
      g.rrect(8, -26, 26, 52, 12, shade(C.woodDark, -0.35))
      g.rrect(12, -22, 18, 16, 8, alpha(C.white, 0.15))
    },
    0.86,
  )
}

/** An arrow stuck in the target, foreshortened toward its archer, quivering after the strike. */
export function drawStuck(g: Draw, a: Arrow, now: number): void {
  const b = BOW[a.side]
  const base = Math.atan2(a.y - b.y, a.x - b.x)
  const age = now - (a.at ?? -10)
  const wob = age < 0.9 ? Math.sin(age * 42) * 0.28 * Math.exp(-age * 5) : 0
  g.ellipse(a.x + 26, a.y + 22, 40, 8, alpha('#000000', 0.3), base)
  g.circle(a.x, a.y, 5, alpha(C.ink, 0.75))
  g.at(a.x, a.y, base + wob, () => arrowShape(g, a.side, 74))
}

/** The archer: a blob beside its bow, looking down the range. */
function drawArcher(
  g: Draw,
  side: Side,
  active: boolean,
  mood: 'happy' | 'wow' | 'sad' | 'grin',
  pull: number,
  squash: number,
  now: number,
): void {
  const b = BOW[side]
  const f = side === 0 ? 1 : -1
  const x = b.x - f * 150
  const y = b.y + f * 6
  // Idle breathing, the draw stretching it tall, the release squashing it.
  const breathe = Math.sin(now * 2.4 + side * 1.7) * 0.025
  const sq = squash + breathe
  g.shadow(x + 6, y + 44, 50, 14, 0.35)
  g.blob(x, y, 52, active ? SIDE[side].main : shade(SIDE[side].main, -0.35), {
    mood,
    look: [f * 0.5, -f * 0.9],
    angle: g.orient(side),
    sx: (1 - pull * 0.08) * (2 - sq),
    sy: (1 + pull * 0.08) * sq,
  })
}

export function render(g: Draw, s: State, look: Look, now: number): void {
  drawRange(g)
  // The boss rocks back on a strike, arrows and all.
  const rock = 1 + look.thump * 0.035
  g.at(
    TARGET.x,
    TARGET.y,
    look.thump * 0.01,
    () =>
      g.at(-TARGET.x, -TARGET.y, 0, () => {
        drawTarget(g)
        for (const a of s.stuck) drawStuck(g, a, now)
      }),
    rock,
  )
  floodlit(g, 0.36)

  // The shooter's aim: a dotted line down the arrow's path and a reticle where it would land.
  if (look.draw && s.phase === 'aim') {
    const b = BOW[s.turn]
    const L = look.draw.landing
    g.alpha(0.55, () => g.dashed(b.x, b.y, L.x, L.y, SIDE[s.turn].light, 6, [20, 18]))
    const p = 0.5 + 0.5 * Math.sin(now * 8)
    g.ring(L.x, L.y, 26 + p * 4, alpha(C.ink, 0.6), 10)
    g.ring(L.x, L.y, 26 + p * 4, C.yellow, 5)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      g.line(L.x + dx * 12, L.y + dy * 12, L.x + dx * 38, L.y + dy * 38, C.yellow, 4)
  }

  // Archers and bows; the side to move draws back.
  for (const side of [0, 1] as const) {
    const on = s.turn === side && s.endAt < 0
    const drawing = on && look.draw
    const pull = drawing && look.draw ? look.draw.power : 0
    const forward = side === 0 ? -Math.PI / 2 : Math.PI / 2
    const angle = drawing && look.draw ? look.draw.angle : forward
    const mine = s.last?.side === side && s.phase === 'beat'
    const sc = s.last?.score ?? 0
    const w = s.endAt >= 0 ? result(s) : null
    const mood =
      w !== null && w !== 'draw'
        ? w === side
          ? 'grin'
          : 'sad'
        : mine
          ? sc === 0
            ? 'sad'
            : sc >= 9
              ? 'grin'
              : 'happy'
          : pull > 0.8
            ? 'wow'
            : 'happy'
    drawArcher(g, side, on, mood, pull, look.squash[side], now)
    const looseAge = now - s.looseAt
    const twang =
      s.flight?.side === side && looseAge < 0.25
        ? Math.sin(looseAge * 80) * (1 - looseAge / 0.25) * 0.15
        : 0
    drawBow(g, side, angle, pull + twang, on && s.phase === 'aim')
    // Power meter beside the bow.
    if (drawing) {
      const b = BOW[side]
      g.arc(b.x, b.y, 130, angle - Math.PI * 0.5, angle + Math.PI * 0.5, alpha(C.ink, 0.35), 10)
      g.arc(
        b.x,
        b.y,
        130,
        angle - pull * Math.PI * 0.5,
        angle + pull * Math.PI * 0.5,
        mix(SIDE[side].light, C.yellow, pull),
        10,
      )
    }
  }

  if (s.flight) {
    const f = s.flight
    const k = Math.min(1, look.ft / f.dur)
    const e = k * (2 - k)
    const x = f.from.x + (f.to.x - f.from.x) * e
    const y = f.from.y + (f.to.y - f.from.y) * e
    const dist = Math.hypot(f.to.x - f.from.x, f.to.y - f.from.y)
    const lift = Math.sin(k * Math.PI) * dist * 0.08
    const angle = Math.atan2(f.to.y - f.from.y, f.to.x - f.from.x)
    const scale = 1.15 + Math.sin(k * Math.PI) * 0.2 - 0.3 * e
    g.ellipse(
      x - Math.cos(angle) * 50,
      y - Math.sin(angle) * 50,
      60 * scale,
      6,
      alpha('#000000', 0.22),
      angle,
    )
    // Speed streak: longer and brighter the harder the draw.
    const streak = 120 + 260 * f.power
    g.alpha(0.2 + 0.25 * f.power, () =>
      g.line(
        x,
        y - lift,
        x - Math.cos(angle) * streak,
        y - lift - Math.sin(angle) * streak,
        C.white,
        4 + 4 * f.power,
      ),
    )
    g.at(x, y - lift, angle, () => arrowShape(g, f.side, 120), scale, scale)
  }

  // Wind sock in the shooter's half, to their right.
  const ws = s.turn === 0 ? { x: 850, y: 1585 } : { x: 150, y: 215 }
  windSock(g, s.wind, WIND_MAX, ws.x, ws.y)

  if (look.hint) {
    const side = s.turn
    banner(g, side, 'Pull back to aim, let go to shoot', side === 0 ? MID + 470 : MID - 470, {
      size: 36,
      alpha: 0.75 + 0.25 * Math.sin(now * 4),
    })
  }
  if (s.endAt >= 0) tally(g, s.totals, result(s), now - s.endAt - 0.8, 'Final score')
}

/** HUD: totals big at the edge (they jump when they grow), arrows left as pips. */
export function hud(g: Draw, s: State, pulse: [number, number]): void {
  for (const side of [0, 1] as const) {
    bigScore(g, side, s.totals[side], { x: 130, size: 64 * (1 + pulse[side] * 0.35) })
    pips(g, side, s.arrows - s.shot[side], s.arrows, { x: W - 150 })
  }
}
