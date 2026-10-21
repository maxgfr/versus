import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Side } from '../../core/game.ts'
import { banner, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import type { Disc } from '../../engines/puck/index.ts'
import { GOAL_PAUSE, RINK, type World } from './rules.ts'

/** The shot being lined up: where the finger grabbed, where it is now, and the flick. */
export interface Aim {
  disc: number
  dx: number
  dy: number
  power: number
  ox: number
  oy: number
  fx: number
  fy: number
}

export interface Look {
  ball: Disc
  discs: Disc[]
  squash: number[]
  pulse: [number, number]
  spin: number
  trail: { x: number; y: number }[]
  aim: Aim | null
  names: [string, string]
  target: number
  /** Text in each player's name pill (undefined = just the name). */
  status: [string | undefined, string | undefined]
  /** Turn banner text for the side to play. */
  turnLabel: string
  /** The winner and how long ago the match was decided (s), once it is. */
  end: { side: Side; t: number } | null
}

const LINE = alpha(C.white, 0.5)
const NET_DEPTH = 62
/** HUD row: the score chip sits this far in from each player's left, the name pill as far from the right. */
const SCORE_X = 150
const PILL_X = 205

/** A regular polygon's vertices, centred on (cx, cy). */
function pentagon(cx: number, cy: number, r: number, rot: number): number[] {
  const pts: number[] = []
  for (let i = 0; i < 5; i++) {
    const a = rot + (i * Math.PI * 2) / 5 - Math.PI / 2
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
  }
  return pts
}

/** Which net is bulging, and how hard (0..1), from the goal phase timer. */
function netShake(w: World): { top: number; bottom: number } {
  if (w.phase !== 'goal') return { top: 0, bottom: 0 }
  const k = Math.max(0, 1 - w.t / 0.9)
  // After a goal `turn` is the conceding side (it kicks off next): its net shakes.
  return w.turn === 1 ? { top: k, bottom: 0 } : { top: 0, bottom: k }
}

/** A goal net behind the end line, glowing in its defender's colour; `shake` bulges it. */
function drawNet(g: Draw, top: boolean, shake: number): void {
  const gw = RINK.goal
  const gx = W / 2 - gw / 2
  const line = top ? RINK.y0 : RINK.y1
  const s = top ? -1 : 1
  const back = line + s * NET_DEPTH
  const col = SIDE[top ? 1 : 0].main
  const bulge = shake * Math.sin(shake * 18) * 18
  const y = Math.min(line, back)
  // Dark mouth with a team-coloured glow toward the back.
  g.rrect(gx, y, gw, NET_DEPTH, 10, shade(col, -0.78))
  g.rrect(
    gx,
    y,
    gw,
    NET_DEPTH,
    10,
    g.lin(0, line, 0, back, [
      [0, alpha(col, 0.05)],
      [1, alpha(col, 0.55 + shake * 0.4)],
    ]),
  )
  g.clip(gx, y, gw, NET_DEPTH, 10, () => {
    const mesh = alpha(C.white, 0.28 + shake * 0.3)
    for (let x = gx + 15; x < gx + gw; x += 26) {
      const k = Math.sin(((x - gx) / gw) * Math.PI)
      g.line(x, line, x + 0, back + s * bulge * k, mesh, 3)
    }
    for (let i = 1; i < 3; i++) {
      const yy = line + s * i * (NET_DEPTH / 3)
      g.line(gx, yy + s * bulge * 0.5, gx + gw, yy + s * bulge * 0.5, mesh, 3)
    }
  })
  // Posts and crossbar: chunky, white, with a dark lip.
  for (const px of [gx, gx + gw]) {
    g.line(px, line, px, back, shade(C.white, -0.45), 16)
    g.line(px, line, px, back, C.white, 11)
  }
  g.line(gx - 4, back, gx + gw + 4, back, shade(C.white, -0.45), 16)
  g.line(gx - 4, back, gx + gw + 4, back, C.white, 11)
  for (const px of [gx, gx + gw]) g.circle(px, line, 11, C.white)
}

/** Floodlit pitch with mowing stripes, markings, and a net at each end. */
function drawPitch(g: Draw, w: World): void {
  const x0 = RINK.x0
  const y0 = RINK.y0
  const pw = RINK.x1 - RINK.x0
  const ph = RINK.y1 - RINK.y0
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, shade(SIDE[1].main, -0.8)],
      [0.5, '#0a1512'],
      [1, shade(SIDE[0].main, -0.8)],
    ]),
  )
  // Stadium apron: dark turf band with a lip, so the pitch reads as a raised board.
  g.shadow(W / 2, RINK.y1 + 40, pw * 0.55, 40, 0.5)
  g.rrect(x0 - 34, y0 - 22, pw + 68, ph + 68, RINK.corner + 34, shade(C.grassDark, -0.7))
  g.rrect(x0 - 34, y0 - 34, pw + 68, ph + 68, RINK.corner + 34, shade(C.grassDark, -0.5))
  g.rrect(x0, y0, pw, ph, RINK.corner, shade(C.grass, -0.14))
  g.clip(x0, y0, pw, ph, RINK.corner, () => {
    const band = ph / 12
    for (let i = 0; i < 12; i++) {
      if (i % 2 === 1) g.rect(x0, y0 + i * band, pw, band, alpha('#000000', 0.08))
    }
    // Each half glows in its owner's colour, fading toward the halfway line.
    g.rect(
      x0,
      y0,
      pw,
      ph,
      g.lin(0, y0, 0, RINK.y1, [
        [0, alpha(SIDE[1].main, 0.3)],
        [0.42, alpha(SIDE[1].main, 0)],
        [0.58, alpha(SIDE[0].main, 0)],
        [1, alpha(SIDE[0].main, 0.3)],
      ]),
    )
    // Four floodlight pools from the corners, plus the centre spot light.
    for (const [cx, cy] of [
      [x0, y0],
      [RINK.x1, y0],
      [x0, RINK.y1],
      [RINK.x1, RINK.y1],
    ] as const) {
      g.fillView(
        g.rad(cx, cy, 20, 620, [
          [0, alpha('#ffffff', 0.16)],
          [1, alpha('#ffffff', 0)],
        ]),
      )
    }
    g.fillView(
      g.rad(W / 2, MID, 40, 520, [
        [0, alpha('#ffffff', 0.1)],
        [1, alpha('#ffffff', 0)],
      ]),
    )
  })
  // Markings: touchline, halfway line and circle, penalty areas, goal areas.
  g.rrect(x0 + 22, y0 + 22, pw - 44, ph - 44, RINK.corner - 22, undefined, LINE, 8)
  g.line(x0 + 22, MID, RINK.x1 - 22, MID, LINE, 8)
  g.ring(W / 2, MID, 150, LINE, 8)
  g.circle(W / 2, MID, 14, LINE)
  g.rrect(230, y0 + 22, 540, 258, 14, undefined, LINE, 8)
  g.rrect(230, RINK.y1 - 280, 540, 258, 14, undefined, LINE, 8)
  g.rrect(360, y0 + 22, 280, 88, 8, undefined, LINE, 8)
  g.rrect(360, RINK.y1 - 110, 280, 88, 8, undefined, LINE, 8)
  g.arc(W / 2, y0 + 280, 110, 0.35, Math.PI - 0.35, LINE, 8)
  g.arc(W / 2, RINK.y1 - 280, 110, Math.PI + 0.35, -0.35, LINE, 8)
  g.circle(W / 2, y0 + 200, 9, LINE)
  g.circle(W / 2, RINK.y1 - 200, 9, LINE)
  const shake = netShake(w)
  drawNet(g, true, shake.top)
  drawNet(g, false, shake.bottom)
}

/**
 * Each side's goals on a scoreboard chip in the free corner beside its own goal
 * mouth (off the pitch, so it never sits under a disc), with a pip row.
 */
function pitchScore(g: Draw, side: Side, value: number, target: number, pulse: number): void {
  const x = side === 0 ? SCORE_X : W - SCORE_X
  const y = hudY(g, side)
  const col = SIDE[side]
  g.forSide(side, x, y, () => {
    const s = 1 + pulse * 0.25
    g.at(
      0,
      0,
      0,
      () => {
        g.rrect(-104, -42, 208, 84, 30, alpha(C.ink, 0.85))
        g.rrect(-104, -42, 208, 84, 30, undefined, alpha(col.main, 0.5 + pulse * 0.5), 5)
        g.text(value, -56, 4, {
          size: 66,
          weight: 700,
          color: pulse > 0.05 ? C.white : col.main,
          drop: alpha('#000000', 0.45),
        })
        const gap = Math.min(30, 104 / Math.max(1, target - 1))
        const r = Math.min(11, gap * 0.4)
        const x0 = 34 - ((target - 1) * gap) / 2
        for (let i = 0; i < target; i++) {
          const on = i < value
          g.circle(x0 + i * gap, 0, r, on ? col.main : alpha(C.white, 0.16))
          if (on) g.circle(x0 + i * gap - r * 0.3, -r * 0.3, r * 0.35, alpha(C.white, 0.7))
        }
      },
      s,
    )
  })
}

/** A flat team disc: lipped, glossy, with the side mark (circle red, square blue). */
function drawDisc(
  g: Draw,
  p: Disc,
  side: Side,
  squash: number,
  ready: number,
  selected: boolean,
): void {
  const col = SIDE[side].main
  g.shadow(p.x + 6, p.y + 18, p.r * 1.02, p.r * 0.86, 0.45)
  if (selected) {
    g.ring(p.x, p.y, p.r + 20, alpha(C.yellow, 0.9), 10)
  } else if (ready > 0) {
    // Your pieces breathe on your turn, so the touch targets read at a glance.
    const k = 0.5 + 0.5 * Math.sin(g.t * 5)
    g.ring(p.x, p.y, p.r + 14 + k * 6, alpha(SIDE[side].light, (0.25 + k * 0.35) * ready), 7)
  }
  g.at(
    p.x,
    p.y,
    0,
    () => {
      g.circle(0, p.r * 0.16, p.r, shade(col, -0.52))
      g.circle(
        0,
        0,
        p.r,
        g.rad(
          0,
          0,
          p.r * 0.1,
          p.r,
          [
            [0, shade(col, 0.32)],
            [0.8, col],
            [1, shade(col, -0.12)],
          ],
          -p.r * 0.3,
          -p.r * 0.35,
        ),
      )
      g.ring(0, 0, p.r * 0.7, alpha('#000000', 0.2), p.r * 0.08)
      g.ring(0, 0, p.r * 0.92, alpha('#ffffff', 0.18), p.r * 0.05)
      g.sideMark(side, 0, 0, p.r * 0.26, alpha(C.white, 0.94))
      g.alpha(0.55, () => g.ellipse(-p.r * 0.36, -p.r * 0.44, p.r * 0.32, p.r * 0.13, '#fff', -0.6))
    },
    squash,
    2 - squash,
  )
}

/** The ball: a white football with black patches, turning as it rolls. */
function drawBall(g: Draw, b: Disc, spin: number, trail: Look['trail'], scale = 1): void {
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i]
    if (!t) continue
    const k = (i + 1) / (trail.length + 1)
    g.alpha(k * 0.28, () => g.circle(t.x, t.y, b.r * (0.45 + 0.5 * k), C.white))
  }
  const r = b.r * scale
  g.shadow(b.x + 6, b.y + 13, r * 0.95, r * 0.8, 0.42)
  g.circle(
    b.x,
    b.y,
    r,
    g.rad(
      b.x,
      b.y,
      r * 0.1,
      r,
      [
        [0, '#ffffff'],
        [0.7, '#e7edf6'],
        [1, '#a7b4c8'],
      ],
      b.x - r * 0.35,
      b.y - r * 0.4,
    ),
  )
  g.clip(b.x - r, b.y - r, r * 2, r * 2, r, () => {
    g.at(b.x, b.y, spin, () => {
      g.poly(pentagon(0, 0, r * 0.42, 0), C.ink2)
      for (let k = 0; k < 5; k++) {
        const a = (k * Math.PI * 2) / 5 - Math.PI / 2
        g.poly(pentagon(Math.cos(a) * r * 1.02, Math.sin(a) * r * 1.02, r * 0.4, a), C.ink2)
      }
    })
  })
  g.ring(b.x, b.y, r, alpha('#000000', 0.3), 4)
  g.alpha(0.8, () => g.ellipse(b.x - r * 0.36, b.y - r * 0.42, r * 0.3, r * 0.15, '#fff', -0.6))
}

/** The slingshot preview: rubber band from the grab point, flick arrow and power arc on the disc. */
function drawAim(g: Draw, discs: Disc[], aim: Aim, side: Side): void {
  const d = discs[aim.disc]
  if (!d) return
  const col = SIDE[side]
  // Rubber band from the grab point to the finger.
  g.line(aim.ox, aim.oy, aim.fx, aim.fy, alpha(col.light, 0.6), 10)
  g.circle(aim.ox, aim.oy, 14, alpha(C.white, 0.85))
  g.circle(aim.fx, aim.fy, 26, alpha(col.main, 0.9))
  g.ring(aim.fx, aim.fy, 26, alpha(C.white, 0.7), 4)
  // Flick arrow: dashed, length and thickness grow with power.
  const len = 110 + aim.power * 560
  const sx = d.x + aim.dx * (d.r + 18)
  const sy = d.y + aim.dy * (d.r + 18)
  const ex = d.x + aim.dx * (d.r + len)
  const ey = d.y + aim.dy * (d.r + len)
  const lw = 8 + aim.power * 8
  g.dashed(sx, sy, ex, ey, alpha('#000000', 0.25), lw + 6, [22, 18])
  g.dashed(sx, sy, ex, ey, C.yellow, lw, [22, 18])
  const px = -aim.dy
  const py = aim.dx
  const ah = 24 + aim.power * 10
  g.poly(
    [
      ex + aim.dx * ah * 1.2,
      ey + aim.dy * ah * 1.2,
      ex - px * ah,
      ey - py * ah,
      ex + px * ah,
      ey + py * ah,
    ],
    C.yellow,
    shade(C.yellow, -0.4),
    4,
  )
  // Power arc around the disc: fills clockwise, glows at full pull.
  const a0 = -Math.PI / 2
  g.arc(d.x, d.y, d.r + 30, 0, Math.PI * 2, alpha('#000000', 0.3), 12)
  g.arc(d.x, d.y, d.r + 30, a0, a0 + aim.power * Math.PI * 2, C.yellow, 12)
  if (aim.power > 0.97)
    g.ring(d.x, d.y, d.r + 44, alpha(C.yellow, 0.4 + 0.3 * Math.sin(g.t * 20)), 6)
}

/** Where the ball is drawn: during a goal it keeps rolling into the back of the net. */
function ballInGoal(w: World, b: Disc): { ball: Disc; scale: number } {
  if (w.phase !== 'goal') return { ball: b, scale: 1 }
  const top = w.turn === 1
  const back = top ? RINK.y0 - NET_DEPTH + b.r * 0.7 : RINK.y1 + NET_DEPTH - b.r * 0.7
  const k = outCubic(prog(w.t, 0, 0.35))
  const fade = 1 - prog(w.t, GOAL_PAUSE - 0.35, GOAL_PAUSE)
  return {
    ball: { ...b, y: b.y + (back - b.y) * k },
    scale: (1 - 0.12 * k) * (0.2 + 0.8 * fade),
  }
}

/** The big GOAL! stamp on the scorer's half, punching in then fading. */
function goalStamp(g: Draw, w: World): void {
  if (w.phase !== 'goal') return
  const scorer: Side = w.turn === 1 ? 0 : 1
  const t = w.t
  const s = outBack(prog(t, 0, 0.3))
  const a = 1 - prog(t, GOAL_PAUSE - 0.4, GOAL_PAUSE)
  const y = scorer === 0 ? MID + 330 : MID - 330
  g.alpha(a, () =>
    g.forSide(scorer, W / 2, y, () => {
      g.at(0, 0, -0.08, () => {
        g.text('GOAL!', 0, 0, {
          size: 170 * s,
          weight: 700,
          color: SIDE[scorer].main,
          stroke: C.white,
          strokeWidth: 16,
          drop: alpha('#000000', 0.4),
        })
      })
    }),
  )
}

/** The decided match: winner's half lights up, a ribbon reads the result. */
function ending(g: Draw, end: { side: Side; t: number }, name: string): void {
  const k = outCubic(prog(end.t, 0, 0.5))
  const win = end.side
  g.alpha(k * 0.45, () => {
    if (win === 0) g.rect(-400, -400, W + 800, MID + 400, '#000000')
    else g.rect(-400, MID, W + 800, H + 400, '#000000')
  })
  g.alpha(k, () =>
    g.fillView(
      g.rad(W / 2, win === 0 ? H * 0.78 : H * 0.22, 60, 900, [
        [0, alpha(SIDE[win].main, 0.35)],
        [1, alpha(SIDE[win].main, 0)],
      ]),
    ),
  )
  const s = outBack(prog(end.t, 0.15, 0.55))
  if (s > 0)
    g.forSide(win, W / 2, win === 0 ? MID + 460 : MID - 460, () => {
      g.at(
        0,
        0,
        0,
        () => {
          const label = `${name} wins!`
          const tw = Math.max(420, g.measure(label, 72, 700) + 120)
          g.tile(-tw / 2, -70, tw, 150, 40, SIDE[win].main, 14)
          g.text(label, 0, 2, {
            size: 72,
            weight: 700,
            color: C.white,
            drop: alpha('#000000', 0.3),
          })
        },
        s,
      )
    })
}

export function render(g: Draw, w: World, look: Look): void {
  drawPitch(g, w)
  const turnSide = w.turn
  const shooting = w.phase === 'aim' && !look.end
  w.discs.forEach((piece, i) => {
    const p = look.discs[i]
    if (!p) return
    const selected = look.aim?.disc === i
    const ready = shooting && piece.side === turnSide ? 1 : 0
    drawDisc(g, p, piece.side, look.squash[i] ?? 1, ready, selected)
  })
  const { ball, scale } = ballInGoal(w, look.ball)
  drawBall(g, ball, look.spin, w.phase === 'roll' ? look.trail : [], scale)
  if (look.aim && shooting) drawAim(g, look.discs, look.aim, turnSide)
  // Whose shot: a short banner on the shooter's half when the turn starts.
  if (shooting && w.t < 1.1 && !look.aim) {
    const a = prog(w.t, 0, 0.15) * (1 - prog(w.t, 0.8, 1.1))
    banner(g, turnSide, look.turnLabel, turnSide === 0 ? MID + 330 : MID - 330, {
      size: 52,
      alpha: a,
      color: SIDE[turnSide].light,
    })
  }
  goalStamp(g, w)
  // HUD: score and name beside the goal mouths (never on top of the goal or the pitch).
  for (const side of [0, 1] as Side[]) {
    pitchScore(g, side, w.score[side], look.target, look.pulse[side])
    namePill(g, side, look.names[side], {
      active: shooting && turnSide === side,
      text: look.status[side],
      x: side === 0 ? W - PILL_X : PILL_X,
    })
  }
  if (look.end) ending(g, look.end, look.names[look.end.side])
}
