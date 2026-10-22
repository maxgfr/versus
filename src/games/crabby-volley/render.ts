import { frame, inFrame, textAngle } from '../../core/frame.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Side } from '../../core/game.ts'
import { hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import {
  BALL_R,
  BAND_Y,
  CRAB_R,
  COURT,
  type Ball,
  type Crab,
  MAX_TOUCH,
  NET_H,
  POINT_PAUSE,
  type World,
} from './rules.ts'

export interface Look {
  w: World
  ball: Ball
  /** Recent ball positions while it flies fast, oldest first. */
  trail: { x: number; y: number; z: number }[]
  /** Ball squash spring (1 = round). */
  ballSquash: number
  /** Net sag spring (units), kicked when the ball hits it. */
  net: number
  crabs: Crab[]
  crabSides: Side[]
  /** Walk cycle per crab (radians-ish), for the legs. */
  walk: number[]
  squash: number[]
  /** Crabs that just bumped: 0..1 for a short "wow" face and a claw snap. */
  wow: number[]
  spin: number
  names: [string, string]
  target: number
  score: [number, number]
  status: [string | undefined, string | undefined]
  active: [boolean, boolean]
  /** Where the ball will come down, if it is in play. */
  landing: { x: number; y: number; t: number } | null
  teams: boolean
  pulse: [number, number]
  /** The decided match and how long ago (s), once it is. */
  end: { side: Side; t: number } | null
}

/** Height is a push away from the middle of the court, as for a camera above it. */
const LIFT = 0.00028

export function lifted(x: number, y: number, z: number): { x: number; y: number } {
  return { x, y: y + (y - MID) * z * LIFT }
}

const SHELLS = [
  { x: 170, y: 1120, e: '🐚', a: 0.4 },
  { x: 830, y: 1250, e: '⭐', a: -0.3 },
  { x: 220, y: 430, e: '⭐', a: 0.2 },
  { x: 800, y: 600, e: '🐚', a: -0.6 },
] as const

/** Sand with a surf band in each team's colour along its baseline, shells, and the lines. */
function drawSand(g: Draw, t: number, teams: boolean): void {
  const x0 = COURT.x0
  const y0 = COURT.y0
  const cw = COURT.x1 - COURT.x0
  const ch = COURT.y1 - COURT.y0
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, shade(SIDE[1].main, -0.78)],
      [0.5, '#1a1424'],
      [1, shade(SIDE[0].main, -0.78)],
    ]),
  )
  g.shadow(W / 2, COURT.y1 + 14, cw * 0.55, 34, 0.5)
  g.rrect(x0 - 20, y0 - 14, cw + 40, ch + 34, 34, shade(C.sand, -0.55))
  g.rrect(x0 - 20, y0 - 20, cw + 40, ch + 34, 34, shade(C.sand, -0.25))
  g.rrect(
    x0,
    y0,
    cw,
    ch,
    20,
    g.lin(0, y0, 0, COURT.y1, [
      [0, shade(C.sand, -0.06)],
      [0.5, C.sand],
      [1, shade(C.sand, -0.06)],
    ]),
  )
  g.clip(x0, y0, cw, ch, 20, () => {
    for (let i = 0; i < 24; i++) {
      const x = x0 + ((i * 397) % cw)
      const y = y0 + ((i * 613) % ch)
      g.arc(x, y + 40, 60, -Math.PI * 0.7, -Math.PI * 0.3, alpha(shade(C.sand, -0.3), 0.4), 5)
    }
    // Each side's baseline band is wet surf in its team colour, with a foam edge that laps.
    for (const side of [0, 1] as Side[]) {
      const col = SIDE[side]
      inFrame(g, side, () => {
        const y = BAND_Y[0]
        const lap = Math.sin(t * 1.4 + side * 2) * 8
        g.rect(x0, y - 120 + lap, cw, 400, alpha(shade(col.main, 0.25), 0.62))
        g.rect(
          x0,
          y - 120 + lap,
          cw,
          400,
          g.lin(0, y - 120, 0, y + 120, [
            [0, alpha('#ffffff', 0.12)],
            [1, alpha('#000000', 0.12)],
          ]),
        )
        // Foam scallops along the band's front edge.
        g.path(
          (c) => {
            c.moveTo(x0, y - 120 + lap)
            for (let x = x0; x <= COURT.x1 + 40; x += 40) {
              c.quadraticCurveTo(x + 20, y - 138 + lap, x + 40, y - 120 + lap)
            }
          },
          undefined,
          alpha('#ffffff', 0.6),
          7,
        )
      })
    }
    for (const y of [MID - 450, MID + 450]) {
      g.fillView(
        g.rad(W / 2, y, 40, 640, [
          [0, alpha('#ffffff', 0.14)],
          [1, alpha('#ffffff', 0)],
        ]),
      )
    }
  })
  for (const s of SHELLS) g.emoji(s.e, s.x, s.y, 44, s.a)
  const line = alpha(C.white, 0.85)
  g.rrect(x0 + 14, y0 + 14, cw - 28, ch - 28, 10, undefined, line, 8)
  if (teams) {
    g.dashed(W / 2, y0 + 14, W / 2, MID - 40, alpha(C.white, 0.22), 4, [14, 18])
    g.dashed(W / 2, MID + 40, W / 2, COURT.y1 - 14, alpha(C.white, 0.22), 4, [14, 18])
  }
}

/** The net: a knotted rope band seen from above, with a post at each end. */
function drawNet(g: Draw, shake: number, sag: number): void {
  const x0 = COURT.x0 - 10
  const x1 = COURT.x1 + 10
  const wob = shake * Math.sin(shake * 30) * 8 + sag * 0.4
  g.alpha(0.22, () => g.rrect(x0, MID + 8, x1 - x0, 34, 12, '#000000'))
  g.rrect(x0, MID - 22, x1 - x0, 40, 8, alpha(C.ink, 0.35))
  g.clip(x0, MID - 22, x1 - x0, 40, 8, () => {
    for (let x = x0; x <= x1; x += 22)
      g.line(x, MID - 22, x + wob, MID + 18, alpha(C.cream, 0.55), 2.5)
  })
  g.line(x0, MID - 22, x1, MID - 22 + wob * 0.5, shade(C.cream, -0.3), 14)
  g.line(x0, MID - 24, x1, MID - 24 + wob * 0.5, C.cream, 10)
  for (let x = x0 + 40; x < x1; x += 80) g.circle(x, MID - 24 + wob * 0.5, 8, C.woodDark)
  for (const x of [x0 - 8, x1 + 8]) {
    g.shadow(x + 10, MID + 20, 24, 10, 0.4)
    g.rrect(x - 14, MID - NET_H * 0.5, 28, NET_H * 0.5, 12, shade(C.wood, -0.2))
    g.rrect(x - 14, MID - NET_H * 0.5, 18, NET_H * 0.5, 10, C.wood)
    g.circle(x, MID - NET_H * 0.5, 18, C.pink)
    g.circle(x - 5, MID - NET_H * 0.5 - 6, 5, alpha('#ffffff', 0.6))
  }
}

/**
 * A crab: a dome shell in its side's colour, eye stalks, claws, and legs, always
 * facing the net. `look` is where its pupils turn (unit-ish, crab frame).
 */
function drawCrab(
  g: Draw,
  c: Crab,
  side: Side,
  walk: number,
  squash: number,
  wow: number,
  look: [number, number],
  hot: number,
): void {
  const p = lifted(c.x, c.y, c.z)
  const r = CRAB_R
  const hop = Math.min(1, c.z / 260)
  g.shadow(c.x, c.y + 6, r * (1 - hop * 0.35), r * 0.45 * (1 - hop * 0.35), 0.4 * (1 - hop * 0.5))
  if (hot > 0)
    g.alpha(0.5 + 0.3 * Math.sin(g.t * 14), () => g.ring(c.x, c.y + 6, r * 1.15, C.yellow, 7))
  const claw = c.hop >= 0 ? 0.9 : 0
  const snap = wow
  const col = SIDE[side].main
  const dark = shade(col, -0.45)
  // Always facing the net: blue's crab is turned around, whoever looks at it.
  g.at(p.x, p.y, side === 1 ? Math.PI : 0, () => {
    // Legs: three a side, splayed out from under the shell, stepping with the walk cycle.
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const ph = walk + k * 1.3 + (s > 0 ? Math.PI : 0)
        const lift = Math.max(0, Math.sin(ph)) * 10 + hop * 12
        const ry = -r * 0.02 + k * r * 0.17
        const kx = s * r * (1.12 + k * 0.04)
        const ky = ry - r * 0.16 - lift
        const fx = s * r * (1.38 + k * 0.05)
        const fy = ry + r * 0.1 + k * 4 - lift * 0.4
        g.line(s * r * 0.6, ry, kx, ky, dark, 11)
        g.line(kx, ky, fx, fy, dark, 8)
      }
    }
    // Claws reach forward and up while hopping, and snap on a bump.
    for (const s of [-1, 1]) {
      const ax = s * r * 0.7
      const ay = -r * 0.05
      const cx = s * (r * 1.1 + claw * 20)
      const cy = -r * (0.75 + claw * 0.2)
      g.line(ax, ay, cx, cy, shade(col, -0.25), 18)
      g.line(ax, ay, cx, cy, shade(col, 0.05), 10)
      g.circle(cx, cy + 4, r * 0.36, dark)
      g.circle(cx, cy, r * 0.36, shade(col, 0.08))
      g.alpha(0.5, () => g.ellipse(cx - r * 0.1, cy - r * 0.14, r * 0.14, r * 0.07, '#fff', -0.5))
      // The pincer gap opens wide on a snap.
      const open = 0.25 + snap * 0.35
      g.poly(
        [
          cx + s * r * 0.06,
          cy - r * open,
          cx + s * r * 0.44,
          cy - r * 0.02,
          cx + s * r * 0.06,
          cy + r * open * 0.6,
        ],
        C.ink3,
      )
    }
    // Eye stalks, then the eyes, looking at the ball.
    const er = r * (0.2 + snap * 0.05)
    for (const s of [-1, 1]) {
      g.line(s * r * 0.36, -r * 0.4, s * r * 0.42, -r * 0.92, dark, 10)
      g.circle(s * r * 0.44, -r * 0.98, er + 4, dark)
      g.circle(s * r * 0.44, -r * 0.98, er, '#ffffff')
      const pr = r * (snap > 0.5 ? 0.06 : 0.1)
      g.circle(s * r * 0.44 + look[0] * er * 0.45, -r * 0.98 + look[1] * er * 0.45, pr, C.ink)
    }
    // Shell: a glossy dome with a scalloped rim and the side mark.
    g.at(
      0,
      0,
      0,
      () => {
        g.ellipse(0, r * 0.1, r * 0.95, r * 0.64, dark)
        g.path(
          (cc) => cc.ellipse(0, 0, r * 0.95, r * 0.64, 0, 0, Math.PI * 2),
          g.rad(
            0,
            -r * 0.2,
            r * 0.1,
            r,
            [
              [0, shade(col, 0.35)],
              [0.8, col],
              [1, shade(col, -0.2)],
            ],
            -r * 0.3,
            -r * 0.4,
          ),
        )
        for (let k = -2; k <= 2; k++)
          g.circle(k * r * 0.3, r * 0.44 - Math.abs(k) * r * 0.06, r * 0.07, alpha(dark, 0.6))
        // Little smile under the shell's lip.
        g.arc(0, r * 0.1, r * 0.16, 0.3, Math.PI - 0.3, alpha(C.ink, 0.7), 5)
      },
      squash,
      2 - squash,
    )
  })
  // Mark and gloss drawn unrotated so the light always comes from the top of the screen.
  g.alpha(0.55, () => g.ellipse(p.x - r * 0.35, p.y - r * 0.28, r * 0.3, r * 0.12, '#fff', -0.3))
  g.sideMark(side, p.x, p.y - r * 0.08, r * 0.15, alpha(C.white, 0.92))
}

/** A coral ball with pale spots, turning as it flies. */
function drawBall(g: Draw, b: Ball, spin: number, pop: number, squash = 1): void {
  const sh = BALL_R * (1 - Math.min(0.5, b.z / 900))
  g.shadow(b.x, b.y, sh, sh * 0.42, 0.38 * (1 - Math.min(0.7, b.z / 600)))
  const p = lifted(b.x, b.y, b.z)
  const s = (1 + Math.min(0.35, b.z / 1400)) * pop
  if (s <= 0.01) return
  // Squash in screen space: wide and flat on a hit or a landing.
  const sq = Math.max(0.65, Math.min(1.35, squash))
  g.at(
    p.x,
    p.y,
    0,
    () => {
      g.ball(0, 0, BALL_R, C.pink, 0)
      g.at(0, 0, spin, () => {
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI * 2) / 6
          g.circle(
            Math.cos(a) * BALL_R * 0.55,
            Math.sin(a) * BALL_R * 0.55,
            BALL_R * 0.11,
            alpha('#ffffff', 0.85),
          )
        }
        g.circle(0, 0, BALL_R * 0.13, alpha('#ffffff', 0.85))
      })
      g.ring(0, 0, BALL_R, alpha(shade(C.pink, -0.5), 0.6), 4)
      g.alpha(0.7, () =>
        g.ellipse(-BALL_R * 0.36, -BALL_R * 0.42, BALL_R * 0.3, BALL_R * 0.15, '#fff', -0.6),
      )
    },
    s * sq,
    s * (2 - sq),
  )
}

/** Faint copies of the ball behind a spike. */
function drawTrail(g: Draw, trail: Look['trail']): void {
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i]
    if (!t) continue
    const k = (i + 1) / (trail.length + 1)
    const p = lifted(t.x, t.y, t.z)
    const r = BALL_R * (1 + Math.min(0.35, t.z / 1400)) * (0.5 + 0.45 * k)
    g.alpha(k * 0.3, () => g.circle(p.x, p.y, r, C.pink))
  }
}

/** Where the ball comes down: a target on the sand in the colour of the side that must play it. */
function drawLanding(g: Draw, land: { x: number; y: number; t: number }, z: number): void {
  const side: Side = land.y > MID ? 0 : 1
  const col = SIDE[side]
  const k = Math.min(1, z / 500)
  const r = BALL_R * (0.7 + 0.6 * Math.min(1, land.t))
  g.alpha(0.55 + 0.4 * (1 - k), () => {
    g.circle(land.x, land.y, r, alpha(col.main, 0.18))
    g.ring(land.x, land.y, r, col.light, 7)
    g.circle(land.x, land.y, 8, col.light)
  })
}

/** Touch counter under the ball: one dot per touch the side with the ball has used. */
function drawTouches(g: Draw, w: World, ball: Ball): void {
  if (w.phase !== 'rally' || w.last === -1) return
  const side = w.last
  const p = lifted(ball.x, ball.y, ball.z)
  const s = 1 + Math.min(0.35, ball.z / 1400)
  g.forSide(side, p.x, p.y, () => {
    for (let i = 0; i < MAX_TOUCH; i++) {
      const x = (i - (MAX_TOUCH - 1) / 2) * 30
      const on = i < w.count
      g.circle(x, BALL_R * s + 30, 11, on ? SIDE[side].main : alpha(C.ink, 0.35))
      if (on) g.circle(x - 3, BALL_R * s + 27, 4, alpha(C.white, 0.7))
    }
  })
}

/** Points on a plate at each player's left, upright for them. */
function scorePlate(g: Draw, side: Side, value: number, target: number, pulse: number): void {
  const y = hudY(g, side)
  const col = SIDE[side]
  const ang = textAngle(g, side)
  inFrame(g, side, () => {
    const yy = frame(side, 0, y).y
    g.at(
      150,
      yy,
      ang,
      () => {
        g.rrect(-84, -44, 168, 88, 26, alpha(C.ink, 0.82))
        g.rrect(-84, -44, 168, 88, 26, undefined, alpha(col.main, 0.6 + pulse * 0.4), 5)
        g.text(value, -16, 4, {
          size: 64,
          weight: 700,
          color: pulse > 0.05 ? C.white : col.main,
          align: 'right',
        })
        g.text(`/${target}`, -8, 12, {
          size: 34,
          weight: 600,
          color: alpha(C.white, 0.6),
          align: 'left',
        })
      },
      1 + pulse * 0.25,
    )
  })
}

const WHY: Record<string, string> = {
  net: 'Into the net!',
  touches: 'Too many touches!',
  out: 'Out!',
  slow: 'Too slow!',
}

/** The point stamp: who won it, and why on the loser's half. */
function pointStamp(g: Draw, w: World): void {
  if (w.phase !== 'point') return
  const side = w.server
  const t = w.pause
  const s = outBack(prog(t, 0, 0.28))
  const a = 1 - prog(t, POINT_PAUSE - 0.3, POINT_PAUSE)
  const loser: Side = side === 0 ? 1 : 0
  const why = WHY[w.why]
  g.alpha(a, () => {
    g.forSide(side, W / 2, side === 0 ? MID + 330 : MID - 330, () =>
      g.at(0, 0, -0.06, () => {
        g.text('POINT!', 0, 0, {
          size: 130 * s,
          weight: 700,
          color: SIDE[side].main,
          stroke: C.white,
          strokeWidth: 14,
          drop: alpha('#000000', 0.35),
        })
      }),
    )
    if (why)
      g.forSide(loser, W / 2, loser === 0 ? MID + 330 : MID - 330, () =>
        g.text(why, 0, 0, { size: 56 * s, weight: 700, color: C.white, stroke: alpha(C.ink, 0.8) }),
      )
  })
}

/** The decided match: the winner's half lights up and a ribbon reads the result. */
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
    g.forSide(win, W / 2, win === 0 ? MID + 480 : MID - 480, () =>
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
      ),
    )
}

export function render(g: Draw, look: Look): void {
  const w = look.w
  drawSand(g, g.t, look.teams)
  if (look.landing && w.phase === 'rally') drawLanding(g, look.landing, look.ball.z)
  const netShake = w.phase === 'point' && w.why === 'net' ? Math.max(0, 1 - w.pause / 0.8) : 0
  drawNet(g, netShake, look.net)
  const land = look.landing
  look.crabs.forEach((c, i) => {
    const side = look.crabSides[i] ?? 0
    // Pupils follow the ball, in the crab's own (net-facing) frame.
    const dx = look.ball.x - c.x
    const dy = look.ball.y - c.y
    const m = Math.hypot(dx, dy) || 1
    const eye: [number, number] = side === 1 ? [-dx / m, -dy / m] : [dx / m, dy / m]
    const near = land && w.phase === 'rally' && (side === 0 ? land.y > MID : land.y < MID)
    const hot = near && Math.abs(land.x - c.x) < CRAB_R + BALL_R && land.t < 0.7 ? 1 : 0
    drawCrab(g, c, side, look.walk[i] ?? 0, look.squash[i] ?? 1, look.wow[i] ?? 0, eye, hot)
  })
  const pop = w.phase === 'rally' ? outBack(prog(w.rally, 0, 0.3)) : 1
  if (w.phase === 'rally') drawTrail(g, look.trail)
  drawBall(g, look.ball, look.spin, Math.max(0.01, pop), look.ballSquash)
  drawTouches(g, w, look.ball)
  pointStamp(g, w)
  for (const side of [0, 1] as Side[]) {
    namePill(g, side, look.names[side], {
      active: look.active[side] && !look.end,
      text: look.status[side],
    })
    scorePlate(g, side, look.score[side], look.target, look.pulse[side])
  }
  if (look.end) ending(g, look.end, look.names[look.end.side])
}
