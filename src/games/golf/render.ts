import { outBack } from '../../core/fx/ease.ts'
import { other, type Side } from '../../core/game.ts'
import { banner, bigScore, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, shade, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { drawTrajectory } from '../../engines/aim/index.ts'
import { floodlit, tally, windSock } from './look.ts'
import {
  type Ball,
  CUP_R,
  FAIRWAY_R,
  GREEN_R,
  type Hole,
  holeOf,
  holesWon,
  type Pt,
  result,
  type State,
  TEE_R,
  WIND_MAX,
} from './rules.ts'

export interface Look {
  /** The stroke the side on turn is lining up (finger or computer), null when idle. */
  aim: {
    dx: number
    dy: number
    power: number
    preview: { x: number; y: number; z: number }[]
  } | null
  /** Show the "pull back anywhere" hint to the human on turn. */
  hint: boolean
}

const BALL_R = 17

/** Stable pseudo-random in [0, 1) per index, so the rough looks the same on every device. */
const hash = (i: number, k: number): number => {
  const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453
  return v - Math.floor(v)
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

function course(g: Draw, h: Hole, w: number, col: string, dash?: number[]): void {
  const c = g.ctx
  c.beginPath()
  c.moveTo(h.tee.x, h.tee.y)
  c.lineTo(h.bend.x, h.bend.y)
  c.lineTo(h.cup.x, h.cup.y)
  c.strokeStyle = col
  c.lineWidth = w
  c.lineJoin = 'round'
  c.lineCap = dash ? 'butt' : 'round'
  if (dash) c.setLineDash(dash)
  c.stroke()
  if (dash) c.setLineDash([])
}

/** Deep rough: dark turf mown in wide diagonal bands, with tufts. */
function drawRough(g: Draw): void {
  const v = g.stage.view
  const base = shade(C.grassDark, -0.2)
  g.fillView(base)
  const c = g.ctx
  c.save()
  c.translate(W / 2, MID)
  c.rotate(-0.5)
  for (let i = -12; i < 12; i += 2) g.rect(-1400, i * 110, 2800, 110, shade(C.grassDark, -0.14))
  c.restore()
  for (let i = 0; i < 90; i++) {
    const x = v.x + hash(i, 1) * v.w
    const y = v.y + hash(i, 2) * v.h
    const s = 6 + hash(i, 3) * 8
    const col = alpha(shade(C.grassDark, -0.45), 0.5)
    g.line(x - s, y + s, x - s * 0.4, y - s, col, 4)
    g.line(x, y + s, x, y - s * 1.3, col, 4)
    g.line(x + s, y + s, x + s * 0.4, y - s, col, 4)
  }
}

function drawHole(g: Draw, h: Hole, now: number): void {
  // Fairway: a soft collar, the turf, then mown bands across it (a dashed stroke).
  course(g, h, FAIRWAY_R * 2 + 30, alpha('#000000', 0.18))
  course(g, h, FAIRWAY_R * 2 + 14, shade(C.grassDark, 0.06))
  course(g, h, FAIRWAY_R * 2, C.grass)
  course(g, h, FAIRWAY_R * 2, shade(C.grass, 0.1), [70, 70])

  // Tee box: a raised pad with two white markers.
  g.circle(h.tee.x, h.tee.y + 8, TEE_R, shade(C.grassDark, -0.1))
  g.circle(h.tee.x, h.tee.y, TEE_R, shade(C.grass, 0.16))
  g.circle(h.tee.x, h.tee.y, TEE_R - 18, undefined, alpha(C.white, 0.18), 4)
  for (const s of [-1, 1]) g.disc(h.tee.x + s * 58, h.tee.y - 30, 11, C.white, 4)

  for (const b of h.bunkers) {
    g.circle(b.x, b.y, b.r + 10, shade(C.grassDark, -0.05))
    g.circle(b.x, b.y + 5, b.r + 2, shade(C.sand, -0.4))
    g.circle(
      b.x,
      b.y,
      b.r,
      g.rad(
        b.x,
        b.y,
        b.r * 0.1,
        b.r,
        [
          [0, shade(C.sand, 0.12)],
          [1, shade(C.sand, -0.12)],
        ],
        b.x - b.r * 0.3,
        b.y - b.r * 0.4,
      ),
    )
    // Rake marks.
    for (let i = -2; i <= 2; i++) {
      const yy = b.y + i * b.r * 0.3
      const half = Math.sqrt(Math.max(0, b.r * b.r * 0.72 - (yy - b.y) ** 2))
      g.line(b.x - half, yy, b.x + half, yy, alpha(shade(C.sand, -0.3), 0.45), 3)
    }
  }

  for (const p of h.ponds) {
    g.circle(p.x, p.y, p.r + 12, shade(C.grassDark, -0.05))
    g.circle(p.x, p.y, p.r + 4, shade(C.water, -0.55))
    g.circle(
      p.x,
      p.y,
      p.r,
      g.rad(
        p.x,
        p.y,
        p.r * 0.1,
        p.r,
        [
          [0, shade(C.water, 0.2)],
          [0.7, C.water],
          [1, shade(C.water, -0.35)],
        ],
        p.x - p.r * 0.3,
        p.y - p.r * 0.35,
      ),
    )
    for (let k = 0; k < 3; k++) {
      const f = (now * 0.4 + k / 3) % 1
      g.alpha((1 - f) * 0.4, () =>
        g.ring(p.x + (k - 1) * 14, p.y + (k - 1) * 10, p.r * (0.15 + f * 0.6), C.white, 4),
      )
    }
    g.alpha(0.6, () => g.ellipse(p.x - p.r * 0.35, p.y - p.r * 0.45, p.r * 0.3, p.r * 0.12, '#fff'))
  }

  // Green: a collar, mown rings, and the cup.
  g.circle(h.cup.x, h.cup.y, GREEN_R + 14, shade(C.grassDark, 0.1))
  g.circle(h.cup.x, h.cup.y, GREEN_R, shade(C.grass, 0.24))
  for (let i = 1; i <= 4; i++)
    g.circle(h.cup.x, h.cup.y, GREEN_R * (1 - i * 0.2), i % 2 ? shade(C.grass, 0.32) : undefined)
  g.circle(h.cup.x, h.cup.y, CUP_R + 8, alpha(C.white, 0.85))
  g.circle(h.cup.x, h.cup.y, CUP_R, C.ink)
  g.circle(h.cup.x, h.cup.y + 6, CUP_R - 7, shade(C.ink, 0.12))
}

/** The pin: a shadow on the green, a white pole and a flag streaming with the wind. */
function drawFlag(g: Draw, cup: Pt, wind: number, now: number, lift: number): void {
  const top = cup.y - 190 - lift
  const dir = wind >= 0 ? 1 : -1
  const k = Math.min(1, Math.abs(wind) / WIND_MAX)
  const flap = Math.sin(now * (5 + 6 * k)) * 8
  // Shadow of the pole laid on the green, away from the light.
  g.line(cup.x + 8, cup.y + 6, cup.x + 46, cup.y + 40, alpha('#000000', 0.16), 7)
  g.line(cup.x, cup.y - lift, cup.x, top, shade(C.white, -0.15), 10)
  g.line(cup.x - 2, cup.y - lift, cup.x - 2, top, C.white, 5)
  const len = 66 + 40 * k
  g.poly(
    [
      cup.x,
      top + 4,
      cup.x + dir * len * 0.5,
      top + 14 + flap * 0.5,
      cup.x + dir * len,
      top + 30 + flap,
      cup.x + dir * len * 0.5,
      top + 46 + flap * 0.5,
      cup.x,
      top + 58,
    ],
    C.white,
  )
  g.poly(
    [cup.x, top + 20, cup.x + dir * len * 0.7, top + 28 + flap * 0.7, cup.x, top + 40],
    C.orange,
  )
  g.ball(cup.x, top, 10, C.yellow, 0.8)
}

/** A team golf ball: glossy in the side's colour, with its circle or square mark. */
function drawBall(g: Draw, side: Side, x: number, y: number, r: number): void {
  g.ball(x, y, r, SIDE[side].main, 1)
  g.alpha(0.85, () => g.sideMark(side, x + r * 0.15, y + r * 0.2, r * 0.32, C.white))
}

function drawFlying(g: Draw, side: Side, b: Ball): void {
  const k = 1 + Math.max(0, b.z) / 300
  const sx = b.x - b.z * 0.12
  const sy = b.y - b.z * 0.18
  g.shadow(b.x + 4, b.y + 6, BALL_R * 0.9, BALL_R * 0.45, 0.4 / k)
  // Streak behind the ball, along its screen motion.
  const vx = b.vx - b.vz * 0.12
  const vy = b.vy - b.vz * 0.18
  for (let i = 1; i <= 4; i++) {
    g.alpha(0.22 - i * 0.045, () =>
      g.circle(sx - vx * 0.018 * i, sy - vy * 0.018 * i, BALL_R * k * (1 - i * 0.12), C.white),
    )
  }
  drawBall(g, side, sx, sy, BALL_R * k)
}

/** The side's golfer: a blob standing behind its ball, a club in hand drawn back with the pull. */
function drawGolfer(
  g: Draw,
  side: Side,
  ball: Pt,
  dir: { dx: number; dy: number },
  power: number,
  swing: number,
  mood: 'happy' | 'wow' | 'sad' | 'grin',
): void {
  // Standing beside the ball (addressing it), a step back from the line.
  const bx = ball.x - dir.dx * 26 + dir.dy * 78
  const by = ball.y - dir.dy * 26 - dir.dx * 78
  // The club: from the golfer's hands to a head just behind the ball, swung back by the pull.
  const back = power * 1.4 - swing * 1.6
  const hx = bx + dir.dx * 30
  const hy = by + dir.dy * 30
  const rx = ball.x - dir.dx * (BALL_R + 10) - hx
  const ry = ball.y - dir.dy * (BALL_R + 10) - hy
  const ca = Math.cos(back * (side === 0 ? 1 : -1))
  const sa = Math.sin(back * (side === 0 ? 1 : -1))
  const cx = hx + rx * ca - ry * sa
  const cy = hy + rx * sa + ry * ca
  g.shadow(bx + 6, by + 40, 44, 14, 0.35)
  g.line(hx, hy, cx, cy, '#c9ced9', 7)
  g.ball(cx, cy, 10, '#8f98ab', 0.6)
  const squash = swing > 0 ? 1 + 0.18 * swing : 1
  g.blob(bx, by, 46, SIDE[side].main, {
    mood,
    look: [dir.dx * 0.9, dir.dy * 0.9],
    angle: g.orient(side),
    sx: squash,
    sy: 2 - squash,
  })
}

export function render(g: Draw, s: State, look: Look, now: number): void {
  const h = holeOf(s)
  drawRough(g)
  drawHole(g, h, now)
  floodlit(g, 0.38)

  // Balls still in play. The one on turn gets the yellow ring.
  const sunkAge = now - s.sunkAt
  // The waiting ball first, the one on turn on top; a waiting ball sharing the spot steps aside.
  for (const side of [other(s.turn), s.turn]) {
    let b: Pt = s.balls[side]
    const mine = s.balls[s.turn]
    if (side !== s.turn && Math.hypot(b.x - mine.x, b.y - mine.y) < BALL_R * 2.4)
      b = { x: b.x + 44, y: b.y + (side === 0 ? 20 : -20) }
    const flying = s.phase === 'fly' && s.turn === side
    if (s.holed[side]) {
      // In the cup: drops in over a beat, then a little dot of colour inside.
      const sinking = s.turn === side && s.phase === 'beat' && sunkAge < 0.35
      if (sinking) {
        const r = BALL_R * (1 - sunkAge / 0.35) + 4
        drawBall(g, side, h.cup.x, h.cup.y, r)
      } else if (!doneAt(s)) g.circle(h.cup.x + (side ? 8 : -8), h.cup.y + 4, 7, SIDE[side].main)
      continue
    }
    if (flying && s.balls[side].air) continue
    const on = s.phase === 'aim' && s.turn === side && !doneAt(s)
    if (on) {
      const p = 0.5 + 0.5 * Math.sin(now * 6)
      g.alpha(0.5 + p * 0.5, () => g.ring(b.x, b.y, BALL_R + 14 + p * 6, C.yellow, 6))
    }
    g.shadow(b.x + 4, b.y + 7, BALL_R * 0.9, BALL_R * 0.45, 0.4)
    drawBall(g, side, b.x, b.y, BALL_R)
  }

  // The pin, lifted out while a ball drops.
  const lift =
    s.phase === 'beat' && sunkAge < 1.2 ? Math.sin(Math.min(1, sunkAge / 0.5) * Math.PI) * 30 : 0
  // Whichever stands nearer the bottom of the screen is drawn last, so a golfer
  // putting beside the pin is never speared by the flag (or hidden behind it).
  let golferY = -Infinity
  let golfer: (() => void) | null = null

  // The golfer on turn stands behind the ball and looks where it goes.
  if (!doneAt(s)) {
    const side = s.turn
    const from = s.rest[side]
    let dir = { dx: h.cup.x - from.x, dy: h.cup.y - from.y }
    if (look.aim) dir = { dx: look.aim.dx, dy: look.aim.dy }
    const m = Math.hypot(dir.dx, dir.dy)
    dir = m > 1 ? { dx: dir.dx / m, dy: dir.dy / m } : { dx: 0, dy: side === 0 ? -1 : 1 }
    const sw = now - s.swingAt
    const swing = sw < 0.3 ? 1 - sw / 0.3 : 0
    const mood =
      s.phase === 'beat' && s.after === 'water'
        ? 'sad'
        : s.phase === 'beat' && (s.after === 'sunk' || s.after === 'hole') && sunkAge < 1.6
          ? 'grin'
          : look.aim && look.aim.power > 0.8
            ? 'wow'
            : 'happy'
    if (!(s.holed[side] && s.phase !== 'beat')) {
      const d = dir
      golferY = from.y - d.dy * 26 - d.dx * 78
      golfer = () => drawGolfer(g, side, from, d, look.aim?.power ?? 0, swing, mood)
    }
  }
  const golferFirst = golferY + 40 < h.cup.y
  if (golfer && golferFirst) golfer()
  drawFlag(g, h.cup, s.wind, now, lift)
  if (golfer && !golferFirst) golfer()

  if (look.aim) {
    const side = s.turn
    const b = s.rest[side]
    drawTrajectory(g, look.aim.preview, SIDE[side].light)
    // Power arc around the ball, turning yellow at full pull.
    const p = look.aim.power
    g.arc(b.x, b.y, BALL_R + 30, 0, Math.PI * 2, alpha(C.ink, 0.5), 12)
    g.arc(
      b.x,
      b.y,
      BALL_R + 30,
      -Math.PI / 2,
      -Math.PI / 2 + p * Math.PI * 2,
      mix(SIDE[side].light, C.yellow, p * p),
      12,
    )
  }
  if (s.phase === 'fly') drawFlying(g, s.turn, s.balls[s.turn])

  const sp = sockSpot(h)
  windSock(g, s.wind, WIND_MAX, sp.x, sp.y)

  const holeAge = now - s.holeAt
  if (holeAge < 2.4 && s.hole < s.holes.length && s.endAt < 0) {
    const k = outBack(clamp01(holeAge / 0.35))
    g.alpha(Math.min(1, (2.4 - holeAge) * 2.5), () =>
      g.at(
        W / 2,
        MID,
        0,
        () => {
          g.ctx.translate(-W / 2, -MID)
          banner(g, undefined, `Hole ${s.hole + 1} of ${s.holes.length} · Par ${h.par}`, MID, {
            size: 46,
            gap: 120,
          })
        },
        k,
      ),
    )
  }
  if (look.hint) {
    const side = s.turn
    banner(g, side, 'Pull back anywhere, let go to swing', side === 0 ? MID + 380 : MID - 380, {
      size: 38,
      alpha: 0.75 + 0.25 * Math.sin(now * 4),
    })
  }
  if (s.endAt >= 0) tally(g, s.strokes, result(s), now - s.endAt - 0.6, 'Strokes')
}

/** A spot for the wind sock along the side edges that sits clear of the hole's features. */
function sockSpot(h: Hole): Pt {
  const seg = (p: Pt, a: Pt, b: Pt) => {
    const vx = b.x - a.x
    const vy = b.y - a.y
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy)))
    return Math.hypot(p.x - a.x - vx * t, p.y - a.y - vy * t)
  }
  const free = (p: Pt) =>
    Math.min(seg(p, h.tee, h.bend), seg(p, h.bend, h.cup)) > FAIRWAY_R + 110 &&
    Math.hypot(p.x - h.cup.x, p.y - h.cup.y) > GREEN_R + 120 &&
    Math.hypot(p.x - h.tee.x, p.y - h.tee.y) > TEE_R + 110 &&
    [...h.bunkers, ...h.ponds].every((b) => Math.hypot(p.x - b.x, p.y - b.y) > b.r + 115)
  const right = W - 106
  const left = 106
  const spots: Pt[] = [
    { x: right, y: MID },
    { x: right, y: MID - 260 },
    { x: right, y: MID + 260 },
    { x: left, y: MID - 260 },
    { x: left, y: MID + 260 },
    { x: right, y: MID - 520 },
    { x: right, y: MID + 520 },
    { x: left, y: MID - 520 },
    { x: left, y: MID + 520 },
  ]
  return spots.find(free) ?? { x: right, y: MID }
}

const doneAt = (s: State): boolean => s.endAt >= 0 || s.hole >= s.holes.length

/** HUD: strokes big at the edge, holes won as pips. */
export function hud(g: Draw, s: State): void {
  for (const side of [0, 1] as const) {
    bigScore(g, side, s.strokes[side], { x: 130, size: 64 })
    pips(g, side, holesWon(s, side), s.holes.length, { x: W - 150 })
  }
}
