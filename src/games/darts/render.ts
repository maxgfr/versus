import { outBack } from '../../core/fx/ease.ts'
import type { Side } from '../../core/game.ts'
import { banner, bigScore, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, shade, SIDE } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { tally } from './look.ts'
import {
  BOARD,
  BULL,
  DARTS_PER_TURN,
  DOUBLE_IN,
  type Dart,
  forceOf,
  OUTER_BULL,
  type Pt,
  result,
  sagVec,
  SEGMENTS,
  spreadOf,
  type State,
  TREBLE_IN,
  TREBLE_OUT,
} from './rules.ts'

export interface Look {
  /** Where the flick on the side to move would land (the reticle), null when idle. */
  aim: Pt | null
  /** The finger's speed right now (world units/s): the reticle shows its sag and wobble. */
  speed: number
  /** The side to move has no darts thrown yet: show the "flick" hint to the human. */
  hint: boolean
}

const SEG = Math.PI / 10
/** Centre angle of the i-th segment clockwise from the top (20). */
const ang = (i: number): number => -Math.PI / 2 + i * SEG
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Each thrower stands at the middle of their own edge. */
export const THROWER: [Pt, Pt] = [
  { x: 500, y: 1585 },
  { x: 500, y: 215 },
]
/** The throwing hand: to the thrower's right. */
export function handOf(side: Side): Pt {
  const t = THROWER[side]
  return side === 0 ? { x: t.x + 78, y: t.y - 34 } : { x: t.x - 78, y: t.y + 34 }
}

/** One ring slice of the board, between radii r0 and r1 (r0 = 0 for a full wedge). */
function wedge(g: Draw, i: number, r0: number, r1: number, fill: string | CanvasGradient): void {
  const a0 = ang(i) - SEG / 2
  const a1 = ang(i) + SEG / 2
  const cx = BOARD.x
  const cy = BOARD.y
  g.path((c) => {
    c.moveTo(cx + Math.cos(a0) * r1, cy + Math.sin(a0) * r1)
    c.arc(cx, cy, r1, a0, a1)
    if (r0 <= 0) c.lineTo(cx, cy)
    else {
      c.lineTo(cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0)
      c.arc(cx, cy, r0, a1, a0, true)
    }
    c.closePath()
  }, fill)
}

const RED_RING = '#d8343f'
const GREEN_RING = '#1f9a5f'
const CREAM = '#f1dfb8'
const INK = '#1b1628'

/** The room: a dark wall, each team's half tinted, a spotlight pool on the board. */
function drawRoom(g: Draw): void {
  g.fillView(C.ink2)
  const v = g.stage.view
  g.rect(v.x - 2, v.y - 2, v.w + 4, MID - v.y, alpha(SIDE[1].dark, 0.28))
  g.rect(v.x - 2, MID, v.w + 4, v.y + v.h - MID + 2, alpha(SIDE[0].dark, 0.28))
  // Throwing lines (the oche) in front of each thrower.
  for (const side of [0, 1] as Side[]) {
    const y = side === 0 ? 1470 : 330
    g.rrect(250, y - 9, 500, 18, 9, alpha(SIDE[side].main, 0.55))
    g.rrect(250, y - 9, 500, 7, 4, alpha(C.white, 0.18))
  }
  g.fillView(
    g.rad(BOARD.x, BOARD.y, BOARD.r * 0.9, H * 0.62, [
      [0, 'rgba(255,240,200,0.14)'],
      [0.45, 'rgba(255,240,200,0.03)'],
      [1, 'rgba(0,0,0,0.45)'],
    ]),
  )
}

export function drawBoard(g: Draw): void {
  const R = BOARD.r
  const { x: cx, y: cy } = BOARD
  // Cabinet: a dark surround with a drop shadow, then the number ring.
  g.circle(cx + 14, cy + 26, R * 1.16, alpha('#000000', 0.45))
  g.circle(cx, cy, R * 1.15, shade(C.ink, 0.04))
  g.circle(
    cx,
    cy,
    R * 1.13,
    g.rad(cx, cy, R * 0.9, R * 1.13, [
      [0, '#2b2238'],
      [1, '#120e1c'],
    ]),
  )
  g.ring(cx, cy, R * 1.13, alpha(C.white, 0.08), 4)

  for (let i = 0; i < SEGMENTS.length; i++) {
    const even = i % 2 === 0
    wedge(g, i, DOUBLE_IN * R, R, even ? RED_RING : GREEN_RING)
    wedge(g, i, TREBLE_OUT * R, DOUBLE_IN * R, even ? CREAM : INK)
    wedge(g, i, TREBLE_IN * R, TREBLE_OUT * R, even ? RED_RING : GREEN_RING)
    wedge(g, i, OUTER_BULL * R, TREBLE_IN * R, even ? INK : CREAM)
  }
  g.circle(cx, cy, OUTER_BULL * R, GREEN_RING)
  g.circle(cx, cy, BULL * R, RED_RING)
  // Sisal sheen: light from the top left.
  g.circle(
    cx,
    cy,
    R,
    g.rad(cx - R * 0.35, cy - R * 0.4, 0, R * 1.3, [
      [0, 'rgba(255,255,255,0.14)'],
      [0.6, 'rgba(255,255,255,0)'],
      [1, 'rgba(0,0,0,0.22)'],
    ]),
  )

  // Wires between the segments and around the rings.
  const wire = alpha('#d8dde8', 0.55)
  for (let i = 0; i < SEGMENTS.length; i++) {
    const a = ang(i) - SEG / 2
    g.line(
      cx + Math.cos(a) * OUTER_BULL * R,
      cy + Math.sin(a) * OUTER_BULL * R,
      cx + Math.cos(a) * R,
      cy + Math.sin(a) * R,
      wire,
      2.5,
    )
  }
  for (const f of [BULL, OUTER_BULL, TREBLE_IN, TREBLE_OUT, DOUBLE_IN, 1])
    g.ring(cx, cy, f * R, wire, 2.5)

  // Numbers around the outside, upright like a real board's: in local 2P the top
  // half reads for blue and the bottom half (and the sides) for red.
  for (let i = 0; i < SEGMENTS.length; i++) {
    const a = ang(i)
    const top = Math.sin(a) < -0.01
    const r = R * 1.065
    g.text(String(SEGMENTS[i]), cx + Math.cos(a) * r, cy + Math.sin(a) * r, {
      size: 38,
      weight: 700,
      color: C.white,
      angle: g.flipTop ? (top ? Math.PI : 0) : g.stage.rot,
    })
  }
}

/** A dart in its own frame: the tip at the origin, the barrel and flights running along +x. */
function dartShape(g: Draw, side: Side, len = 1): void {
  g.at(
    0,
    0,
    0,
    () => {
      g.line(0, 0, 30, 0, '#e8edf5', 5)
      g.rrect(28, -8, 40, 16, 7, '#7d8aa3')
      for (let i = 0; i < 4; i++) g.line(34 + i * 8, -8, 34 + i * 8, 8, '#4c566b', 3)
      g.rrect(30, -7, 36, 5, 3, alpha('#ffffff', 0.45))
      g.line(68, 0, 92, 0, C.ink3, 6)
      const fin = SIDE[side].main
      g.poly([86, 0, 122, 28, 124, 4, 104, 0], fin)
      g.poly([86, 0, 122, -28, 124, -4, 104, 0], shade(fin, -0.25))
      g.line(90, 0, 122, 0, shade(fin, 0.3), 4)
    },
    len,
    1,
  )
}

/** A stuck dart: its tip in the board, the flight back toward its thrower, quivering after the thunk. */
export function drawStuck(g: Draw, d: Dart, now: number): void {
  const from = THROWER[d.side]
  const base = Math.atan2(from.y - d.y, from.x - d.x)
  const age = now - (d.at ?? -10)
  // A harder throw quivers faster and longer.
  const k = d.force ?? 0.5
  const wob =
    age < 1
      ? Math.sin(age * (38 + k * 22)) * (0.22 + k * 0.2) * Math.exp(-age * (6.5 - k * 2.5))
      : 0
  g.ellipse(d.x + 22, d.y + 26, 34, 8, alpha('#000000', 0.3), base)
  g.circle(d.x, d.y, 4, alpha(C.ink, 0.8))
  // Foreshortened: it sticks out toward the thrower.
  g.at(d.x, d.y, base + wob, () => dartShape(g, d.side, 0.72))
}

/** A dart in flight: it leaves the hand big (near the viewer's edge), arcs up and shrinks into the board. */
export function drawFlight(g: Draw, side: Side, from: Pt, to: Pt, k: number, force = 0.5): void {
  const e = k * (2 - k)
  const x = from.x + (to.x - from.x) * e
  const y = from.y + (to.y - from.y) * e
  // A soft throw lobs high; a hard one flies flat.
  const lift = Math.sin(k * Math.PI) * (100 - force * 60)
  const scale = 1.5 - 0.78 * e
  const angle = Math.atan2(from.y - to.y, from.x - to.x)
  g.ellipse(
    x + 30 * (1 - e) + 12,
    y + 30,
    40 * scale,
    8 * scale,
    alpha('#000000', 0.2 + 0.1 * e),
    angle,
  )
  // Motion streak, longer the harder it was thrown.
  g.alpha(0.18 + force * 0.17, () =>
    g.line(
      x,
      y - lift,
      x + Math.cos(angle) * (100 + force * 140) * scale,
      y - lift + Math.sin(angle) * (100 + force * 140) * scale,
      C.white,
      10 * scale,
    ),
  )
  g.at(x, y - lift, angle, () => dartShape(g, side, scale), scale, scale)
}

/** The side's thrower: a blob at its edge, a dart in hand while it has one to throw. */
function drawThrower(
  g: Draw,
  side: Side,
  holding: boolean,
  active: boolean,
  mood: 'happy' | 'wow' | 'sad' | 'grin',
  lunge: number,
  aim: Pt | null,
): void {
  const t = THROWER[side]
  const f = side === 0 ? -1 : 1
  const y = t.y + f * lunge * 24
  g.shadow(t.x + 6, y + 50, 56, 16, 0.4)
  const look: [number, number] = aim
    ? [Math.max(-1, Math.min(1, (aim.x - t.x) / 300)), f * 0.9]
    : [0, f * 0.9]
  g.blob(t.x, y, 58, active ? SIDE[side].main : shade(SIDE[side].main, -0.35), {
    mood,
    look,
    angle: g.orient(side),
    sx: 1 + lunge * 0.12,
    sy: 1 - lunge * 0.12,
  })
  if (holding) {
    const h = handOf(side)
    const target = aim ?? BOARD
    const a = Math.atan2(h.y - target.y, h.x - target.x)
    const hy = h.y + f * lunge * 24
    g.at(h.x, hy, a, () => dartShape(g, side, 0.9), 0.9, 0.9)
    // The hand pinches the barrel.
    g.ball(h.x + Math.cos(a) * 40, hy + Math.sin(a) * 40, 15, shade(SIDE[side].main, -0.1), 0.6)
  }
}

export function render(g: Draw, s: State, look: Look, now: number): void {
  drawRoom(g)
  drawBoard(g)

  // Darts come out between visits: the current visit is on the board, the last one fades out.
  const between = s.throws === 0 && s.endAt < 0
  const visit = s.darts.slice(-(between ? DARTS_PER_TURN : s.throws || DARTS_PER_TURN))
  g.alpha(between ? 0.35 : 1, () => {
    for (const d of visit) drawStuck(g, d, now)
  })

  // Reticle: where the flick on the side to move would land, and how the release
  // would go at the finger's current speed: a ghost where a limp release sags to,
  // a ring as wide as the wobble of a wild one.
  if (look.aim && s.phase === 'aim') {
    const a = look.aim
    const p = 0.5 + 0.5 * Math.sin(now * 8)
    const sag = sagVec(s.turn, look.speed)
    const spread = spreadOf(look.speed)
    const wild = Math.min(1, (spread - 4) / 28)
    const soft = sag.y !== 0
    const col = soft ? C.cyan : wild > 0.05 ? (wild > 0.5 ? C.orange : C.yellow) : C.green
    if (soft) {
      g.alpha(0.6, () => g.circle(a.x + sag.x, a.y + sag.y, 12, col))
      g.line(a.x, a.y, a.x + sag.x, a.y + sag.y, alpha(col, 0.7), 4)
    }
    if (spread > 6) g.ring(a.x, a.y, 30 + spread * 1.6, alpha(col, 0.35 + wild * 0.3), 4)
    g.ring(a.x, a.y, 26 + p * 4, alpha(C.ink, 0.6), 10)
    g.ring(a.x, a.y, 26 + p * 4, col, 5)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      g.line(a.x + dx * 12, a.y + dy * 12, a.x + dx * 38, a.y + dy * 38, col, 4)
    // Force bar beside the reticle: how hard the finger is moving right now.
    const f = forceOf(look.speed)
    g.rrect(a.x + 52, a.y - 34, 12, 68, 6, alpha(C.ink, 0.6))
    g.rrect(a.x + 52, a.y + 34 - 68 * f, 12, 68 * f, 6, col)
  }

  // Throwers: the side on turn holds its next dart until it flies.
  for (const side of [0, 1] as Side[]) {
    const on = s.turn === side && s.endAt < 0
    const mine = s.last?.side === side && s.phase === 'beat'
    const ring = s.last?.ring
    const w = s.endAt >= 0 ? result(s) : null
    const mood =
      w !== null && w !== 'draw'
        ? w === side
          ? 'grin'
          : 'sad'
        : mine && ring === 'miss'
          ? 'sad'
          : mine && (ring === 'bull' || ring === 'treble' || ring === 'double')
            ? 'grin'
            : on && look.aim
              ? 'wow'
              : 'happy'
    const throwAge = s.flight && s.flight.side === side ? s.flight.t : 9
    const force = s.flight?.force ?? 0.5
    // Lean back while lining up (anticipation), then lunge into the throw, harder for a harder throw.
    const lunge =
      throwAge < 0.2
        ? Math.sin((throwAge / 0.2) * Math.PI) * (0.6 + force * 0.7)
        : on && look.aim
          ? -0.35 - 0.1 * Math.sin(now * 6)
          : 0
    const holding = on && s.phase === 'aim'
    drawThrower(g, side, holding, on, mood, lunge, on ? look.aim : null)
    // This turn's running total beside the thrower.
    if (on && s.throws > 0) {
      const mineDarts = s.darts.filter((d) => d.side === side)
      const sum = mineDarts.slice(mineDarts.length - s.throws).reduce((a, d) => a + d.pts, 0)
      const t = THROWER[side]
      const x = side === 0 ? t.x - 190 : t.x + 190
      g.forSide(side, x, t.y, () => {
        g.rrect(-70, -34, 140, 68, 34, alpha(C.ink, 0.85))
        g.text(`+${sum}`, 0, 2, { size: 40, weight: 700, color: SIDE[side].light })
      })
    }
  }

  if (s.flight) {
    const f = s.flight
    drawFlight(g, f.side, handOf(f.side), f.to, Math.min(1, f.t / f.dur), f.force ?? 0.5)
  }

  // Round banner as each round starts.
  const roundAge = now - s.roundAt
  if (roundAge < 2 && s.rounds < s.total && s.endAt < 0) {
    const label = s.rounds === s.total - 1 ? 'Final round' : `Round ${s.rounds + 1} of ${s.total}`
    const k = outBack(clamp01(roundAge / 0.35))
    g.alpha(Math.min(1, (2 - roundAge) * 2.5), () =>
      g.at(
        W / 2,
        MID,
        0,
        () => {
          g.ctx.translate(-W / 2, -MID)
          banner(g, undefined, label, MID, { size: 48, gap: 560 })
        },
        k,
      ),
    )
  }
  if (look.hint && roundAge > 1.8) {
    const side = s.turn
    banner(g, side, 'Flick toward the board', side === 0 ? MID + 470 : MID - 470, {
      size: 38,
      alpha: 0.75 + 0.25 * Math.sin(now * 4),
    })
  }
  if (s.endAt >= 0) tally(g, s.totals, result(s), now - s.endAt - 0.8, 'Final score')
}

/** HUD: totals big at the edge, darts left in the turn as pips. */
export function hud(g: Draw, s: State, pulse: [number, number] = [0, 0]): void {
  for (const side of [0, 1] as const) {
    bigScore(g, side, s.totals[side], { x: 130, size: 64 + Math.min(30, pulse[side] * 1.6) })
    const left = s.turn === side ? DARTS_PER_TURN - s.throws : DARTS_PER_TURN
    pips(g, side, left, DARTS_PER_TURN, { x: W - 150 })
  }
}
