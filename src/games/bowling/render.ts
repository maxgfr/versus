import { outBack } from '../../core/fx/ease.ts'
import { textAngle } from '../../core/frame.ts'
import type { Side } from '../../core/game.ts'
import type { Draw, TextOpts } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import {
  BALL_R,
  type Ball,
  frameComplete,
  frameScores,
  LANE,
  type Lane,
  type Pin,
  PIN_R,
} from './rules.ts'

/** The swipe under the finger, in lane coordinates (cosmetic, never synced). */
export interface Trail {
  /** The finger's track so far. */
  pts: { x: number; y: number }[]
  /** Where the ball would go with the swipe as it stands. */
  path: { x: number; y: number }[]
}

/** A callout over the pins (strike, spare…), stamped with the game time it was called. */
export interface Call {
  text: string
  at: number
  big: boolean
}

export interface LaneLook {
  lane: Lane
  side: Side
  time: number
  trail: Trail | null
  /** Show the swipe coaching on this lane. */
  hint: boolean
  call: Call | null
  /** Recent ball positions, lane coordinates, newest last. */
  ballTrail: { x: number; y: number }[]
}

const TOP = LANE.pitY - 40
const LEN = 1800 - TOP
const MAPLE = '#e0ad6c'

export function backdrop(g: Draw): void {
  g.fillView(
    g.lin(0, 0, 0, 1800, [
      [0, shade(SIDE[1].main, -0.78)],
      [0.5, C.ink],
      [1, shade(SIDE[0].main, -0.78)],
    ]),
  )
  // Each player's side wall glows faintly in their colour.
  g.fillView(
    g.rad(W / 2, MID, 60, 1000, [
      [0, alpha('#fff2d6', 0.1)],
      [1, alpha('#000000', 0.35)],
    ]),
  )
}

/** Text that reads upright for the lane's player, drawn inside that lane's frame. */
function say(
  g: Draw,
  side: Side,
  s: string | number,
  x: number,
  y: number,
  o: TextOpts = {},
): void {
  g.text(s, x, y, { ...o, angle: (o.angle ?? 0) + textAngle(g, side) })
}

/** The lane in red's frame: gutters, planks, pit, dots, arrows, foul line. */
function drawBoard(g: Draw, side: Side): void {
  const { x0, x1, gutter0, gutter1, pitY } = LANE
  const col = SIDE[side]
  // Side kickbacks in the team colour, then the gutters: rounded channels.
  g.rrect(gutter0 - 34, TOP, 30, LEN, 12, shade(col.main, -0.55))
  g.rrect(gutter1 + 4, TOP, 30, LEN, 12, shade(col.main, -0.55))
  g.rrect(gutter0 - 30, TOP, 6, LEN, 3, alpha(col.light, 0.4))
  g.rrect(gutter1 + 24, TOP, 6, LEN, 3, alpha(col.light, 0.4))
  for (const [gx, gw] of [
    [gutter0, x0 - gutter0],
    [x1, gutter1 - x1],
  ] as const) {
    g.rect(
      gx,
      TOP,
      gw,
      LEN,
      g.lin(gx, 0, gx + gw, 0, [
        [0, shade(C.ink3, 0.15)],
        [0.5, shade(C.ink, -0.3)],
        [1, shade(C.ink3, 0.15)],
      ]),
    )
  }
  // Planks of maple up the lane, then the oil sheen and the floodlight streak.
  const board = 34
  g.clip(x0, TOP, x1 - x0, LEN, 0, () => {
    g.rect(x0, TOP, x1 - x0, LEN, MAPLE)
    for (let i = 0; i * board < x1 - x0; i++) {
      const x = x0 + i * board
      if (i % 2) g.rect(x, TOP, board, LEN, alpha(C.woodDark, 0.08))
      g.rect(x, TOP, 2, LEN, alpha(C.woodDark, 0.22))
    }
    g.rect(
      x0,
      TOP,
      x1 - x0,
      LEN,
      g.lin(x0, 0, x1, 0, [
        [0, alpha('#000000', 0.18)],
        [0.3, alpha('#ffffff', 0.04)],
        [0.5, alpha('#ffffff', 0.16)],
        [0.7, alpha('#ffffff', 0.04)],
        [1, alpha('#000000', 0.18)],
      ]),
    )
    g.rect(
      x0,
      TOP,
      x1 - x0,
      LEN,
      g.lin(0, TOP, 0, 1800, [
        [0, alpha('#000000', 0.45)],
        [0.16, alpha('#000000', 0.05)],
        [0.75, alpha('#000000', 0)],
        [1, alpha('#000000', 0.2)],
      ]),
    )
  })
  // The pit and its dark curtain at the far end.
  g.rrect(x0 - 10, TOP - 4, x1 - x0 + 20, pitY - TOP + 22, 12, shade(C.ink, -0.45))
  g.rect(x0 - 10, TOP - 4, x1 - x0 + 20, 12, shade(col.main, -0.4))
  // Pin deck spots.
  for (let s = 0; s < 10; s++) {
    const r = s < 1 ? 0 : s < 3 ? 1 : s < 6 ? 2 : 3
    const k = s - (r * (r + 1)) / 2
    g.circle(
      LANE.cx + (k - r / 2) * LANE.gap,
      LANE.pinY - r * LANE.rowGap,
      7,
      alpha(C.woodDark, 0.35),
    )
  }
  // Targeting arrows and the guide dots.
  for (let k = -3; k <= 3; k++) {
    const x = LANE.cx + k * 52
    const y = 1380 + Math.abs(k) * 22
    g.poly([x, y - 26, x + 14, y + 10, x - 14, y + 10], shade(C.woodDark, -0.1))
    g.poly([x, y - 20, x + 9, y + 4, x - 9, y + 4], alpha(col.main, 0.8))
  }
  for (let k = -2; k <= 2; k++) g.circle(LANE.cx + k * 70, 1560, 6, shade(C.woodDark, -0.1))
  // Foul line, then the approach.
  g.rect(x0, 1596, x1 - x0, 10, shade(col.main, -0.1))
  g.rect(x0, 1597, x1 - x0, 3, alpha('#ffffff', 0.5))
}

/** A bowling pin seen from a high camera, along the lane. Knocked pins tip over and slide. */
function drawPin(g: Draw, p: Pin, side: Side): void {
  const sp = Math.hypot(p.vx, p.vy)
  const angle = p.down ? (sp > 5 ? Math.atan2(p.vy, p.vx) + Math.PI / 2 : 1.2) : 0
  const sx = p.down ? 0.86 : 1
  const stripe = SIDE[side].main
  g.alpha(p.down ? 0.85 : 1, () => {
    g.shadow(p.x + 7, p.y + 16, PIN_R * 0.95, PIN_R * 0.5, 0.4)
    g.at(
      p.x,
      p.y,
      angle,
      () => {
        const body = g.lin(-24, 0, 24, 0, [
          [0, shade(C.white, -0.22)],
          [0.35, '#ffffff'],
          [1, shade(C.white, -0.3)],
        ])
        g.path((c) => {
          c.moveTo(0, -46)
          c.bezierCurveTo(10, -46, 12, -33, 11, -20)
          c.bezierCurveTo(25, -10, 27, 8, 23, 26)
          c.bezierCurveTo(20, 41, 10, 43, 0, 43)
          c.bezierCurveTo(-10, 43, -20, 41, -23, 26)
          c.bezierCurveTo(-27, 8, -25, -10, -11, -20)
          c.bezierCurveTo(-12, -33, -10, -46, 0, -46)
        }, body)
        g.rrect(-12, -31, 24, 5, 2, stripe)
        g.rrect(-12, -24, 24, 5, 2, stripe)
        g.ellipse(-8, -38, 4, 6, alpha('#ffffff', 0.9))
        g.ellipse(-9, 4, 6, 16, alpha('#ffffff', 0.7))
      },
      sx,
      1,
    )
  })
}

function drawBall(g: Draw, b: Ball, side: Side, live: boolean, trail: { x: number; y: number }[]) {
  const col = SIDE[side].main
  for (let i = 0; i < trail.length; i++) {
    const p = trail[i] as { x: number; y: number }
    const f = (i + 1) / (trail.length + 1)
    g.alpha(f * 0.3, () => g.circle(p.x, p.y, BALL_R * (0.5 + 0.45 * f), SIDE[side].light))
  }
  const { x, y } = b
  g.shadow(x + 8, y + 18, BALL_R * 1.05, BALL_R * 0.75, 0.5)
  g.ball(x, y, BALL_R, col, 1)
  // Finger holes roll with the ball: their phase follows the distance travelled.
  const roll = (LANE.ballY - y) / BALL_R
  const hole = (a: number, dx: number, r: number) => {
    const c = Math.cos(roll + a)
    if (c < 0.1) return
    g.ellipse(x + dx * c, y - Math.sin(roll + a) * BALL_R * 0.55, r, r * c, shade(col, -0.75))
  }
  hole(0.5, -9, 5)
  hole(0.5, 9, 5)
  hole(0.0, 0, 5.5)
  g.sideMark(side, x + 16, y + 16, 6, alpha('#ffffff', live ? 0.85 : 0.45))
}

function symbol(rolls: readonly number[], i: number): string {
  const v = rolls[i]
  if (v === undefined) return ''
  if (i === 0 && v === 10) return 'X'
  if (i === 1 && (rolls[0] ?? 0) !== 10 && (rolls[0] ?? 0) + v === 10) return '/'
  return v === 0 ? '–' : String(v)
}

/** Frame-by-frame score sheet in the lane's left margin. */
function drawSheet(g: Draw, lane: Lane, side: Side, time: number): void {
  const x = 22
  const w = 156
  const top = 1040
  const rowH = Math.min(96, 640 / lane.total)
  const rows = lane.total
  const sums = frameScores(lane.frames)
  const cur = lane.frames.length - 1
  const col = SIDE[side]
  g.rrect(x, top - 12, w, rowH * rows + 74, 26, alpha(C.ink, 0.82))
  g.rrect(x, top - 12, w, rowH * rows + 74, 26, undefined, alpha(col.main, 0.35), 4)
  say(g, side, 'FRAME', x + w / 2, top + 24, {
    size: 30,
    weight: 700,
    color: alpha(C.white, 0.6),
  })
  for (let f = 0; f < rows; f++) {
    const y = top + 70 + f * rowH
    const rolls = lane.frames[f] ?? []
    const active = f === cur && lane.phase !== 'done'
    if (active) {
      const p = 0.5 + 0.5 * Math.sin(time * 5)
      g.tile(x + 8, y - 6, w - 16, rowH - 8, 18, shade(col.main, -0.3 + p * 0.08), 6)
    }
    const big = rowH >= 80
    say(g, side, String(f + 1), x + 24, y + (big ? 16 : rowH / 2 - 8), {
      size: 28,
      weight: 600,
      color: alpha(C.white, 0.55),
    })
    const sy = y + (big ? 16 : rowH / 2 - 8)
    const s0 = symbol(rolls, 0)
    const s1 = symbol(rolls, 1)
    // When the frame is turned but the reader is not (blue's sheet seen from red's chair),
    // swap the two rolls so they still read first-to-second.
    const [r0, r1] = Math.abs(textAngle(g, side)) > 1 ? [x + 124, x + 82] : [x + 82, x + 124]
    say(g, side, s0, r0, sy, { size: 38, weight: 700, color: s0 === 'X' ? C.yellow : C.white })
    say(g, side, s1, r1, sy, { size: 38, weight: 700, color: s1 === '/' ? C.yellow : C.white })
    const total = sums[f]
    if (big && total !== undefined && frameComplete(rolls))
      say(g, side, total, x + w / 2 + 10, y + 58, { size: 34, weight: 700, color: col.light })
  }
}

/** Ghost finger showing the swipe, looping over the ball. */
function drawHint(g: Draw, side: Side, time: number): void {
  const k = (time * 0.8) % 1
  const y0 = LANE.ballY + 40
  const y = y0 - outBack(Math.min(1, k * 1.6)) * 300
  const a = k < 0.7 ? 1 : (1 - k) / 0.3
  g.alpha(a * 0.9, () => {
    g.line(LANE.cx, y0, LANE.cx, y + 20, alpha(SIDE[side].light, 0.4), 18)
    // The hand points up the lane, toward the pins, whichever way the lane faces.
    g.emoji('👆', LANE.cx + 14, y + 40, 76)
  })
}

/** STRIKE / SPARE / gutter callout over the pin deck, popping in and fading. */
function drawCall(g: Draw, side: Side, call: Call, time: number): void {
  const k = time - call.at
  if (k < 0 || k > 1.6) return
  const s = outBack(Math.min(1, k / 0.25))
  const a = k > 1.2 ? (1.6 - k) / 0.4 : 1
  const y = 1150
  g.alpha(a, () =>
    g.at(LANE.cx, y, textAngle(g, side), () => {
      const size = call.big ? 96 : 64
      g.at(
        0,
        0,
        call.big ? -0.08 : 0,
        () => {
          const w = g.measure(call.text, size, 700) + size
          if (call.big)
            g.rrect(-w / 2, -size * 0.8, w, size * 1.6, size * 0.4, alpha(SIDE[side].dark, 0.9))
          g.text(call.text, 0, 0, {
            size,
            weight: 700,
            color: call.big ? C.yellow : C.white,
            stroke: alpha(C.ink, 0.9),
            drop: alpha('#000000', 0.4),
          })
        },
        s,
      )
    }),
  )
}

/** One lane, in red's frame: call inside `inFrame(g, side, …)`. */
export function drawLane(g: Draw, look: LaneLook): void {
  const { lane, side } = look
  drawBoard(g, side)
  drawSheet(g, lane, side, look.time)
  // Standing pins first (back row to front), then the ones flying off on top.
  const pins = [...lane.pins].sort((a, b) => Number(a.down) - Number(b.down) || a.y - b.y)
  // Anything that flies into the pit disappears behind the curtain.
  const clipTop = TOP + 12
  g.clip(LANE.gutter0 - 40, clipTop, LANE.gutter1 - LANE.gutter0 + 80, 1800 - clipTop, 0, () => {
    for (const p of pins) drawPin(g, p, side)
  })
  const trail = look.trail
  if (trail && trail.path.length > 1) {
    const pts = trail.path
    for (let i = 2; i < pts.length; i += 2) {
      const p = pts[i] as { x: number; y: number }
      g.circle(p.x, p.y, 12, alpha(C.ink, 0.25))
      g.circle(p.x, p.y, 9, alpha(C.yellow, 0.35 + 0.6 * (i / pts.length)))
    }
  }
  if (trail && trail.pts.length > 1) {
    const pts = trail.pts
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as { x: number; y: number }
      const b = pts[i] as { x: number; y: number }
      g.alpha(i / pts.length, () => g.line(a.x, a.y, b.x, b.y, alpha('#ffffff', 0.9), 10))
    }
  }
  if (lane.phase !== 'done') {
    const ready = lane.phase === 'ready'
    if (ready && !trail) {
      const p = 0.5 + 0.5 * Math.sin(look.time * 6)
      g.ring(lane.ball.x, lane.ball.y, BALL_R + 14 + p * 6, alpha(C.yellow, 0.85), 6)
    }
    // A ball that reached the pit has dropped out of sight.
    const gone = !ready && !lane.ball.live && lane.ball.y < LANE.pitY + 2
    if (!gone)
      g.clip(LANE.gutter0 - 40, clipTop, LANE.gutter1 - LANE.gutter0 + 80, 1800 - clipTop, 0, () =>
        drawBall(g, lane.ball, side, ready || lane.ball.live, look.ballTrail),
      )
  }
  if (look.hint && lane.phase === 'ready' && !trail) drawHint(g, side, look.time)
  if (look.call) drawCall(g, side, look.call, look.time)
}

/** The pinsetter hood across the middle of the table, over both pits. */
export function drawHood(g: Draw): void {
  const x0 = LANE.gutter0 - 40
  const w = LANE.gutter1 - LANE.gutter0 + 80
  const y = MID - 34
  g.rrect(x0, y + 8, w, 68, 22, alpha('#000000', 0.45))
  g.rrect(
    x0,
    y,
    w,
    68,
    22,
    g.lin(0, y, 0, y + 68, [
      [0, shade(C.ink3, 0.1)],
      [0.5, C.ink2],
      [1, shade(C.ink3, 0.1)],
    ]),
  )
  g.rrect(x0 + 18, y + 8, w - 36, 8, 4, alpha(SIDE[1].main, 0.9))
  g.rrect(x0 + 18, y + 52, w - 36, 8, 4, alpha(SIDE[0].main, 0.9))
  for (const dx of [-1, 1]) g.circle(W / 2 + dx * 210, MID, 9, alpha('#ffffff', 0.25))
}
