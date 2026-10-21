import { frame, inFrame, textAngle } from '../../core/frame.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Side } from '../../core/game.ts'
import { hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import type { Disc } from '../../engines/puck/index.ts'
import { H, MID, W } from '../../core/stage.ts'
import {
  BALL_R,
  BLOB_R,
  COURT,
  MAX_TOUCH,
  POINT_PAUSE,
  REACH,
  type Ball,
  type World,
} from './rules.ts'

/** Height of the ball is drawn as a push away from the table's middle (a camera above it). */
const LIFT = 0.0006

export interface Look {
  w: World
  ball: Ball
  blobs: Disc[]
  blobSides: Side[]
  squash: number[]
  /** Blobs that just bumped: 0..1 for a short "wow" face. */
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

/** Screen position of a point at height z: pushed away from the middle of the table. */
export function lifted(x: number, y: number, z: number): { x: number; y: number } {
  return { x, y: y + (y - MID) * z * LIFT }
}

/** Sand, the court, the lines, and a few ripples and shells so the sand reads as a beach. */
function drawSand(g: Draw, teams: boolean): void {
  const x0 = COURT.x0
  const y0 = COURT.y0
  const cw = COURT.x1 - COURT.x0
  const ch = COURT.y1 - COURT.y0
  // Night beach: dark water lapping both ends of the view.
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
      [0, shade(C.sand, -0.08)],
      [0.5, C.sand],
      [1, shade(C.sand, -0.08)],
    ]),
  )
  g.clip(x0, y0, cw, ch, 20, () => {
    // Each half takes its team's colour, strongest at the back line.
    g.rect(
      x0,
      y0,
      cw,
      ch,
      g.lin(0, y0, 0, COURT.y1, [
        [0, alpha(SIDE[1].main, 0.17)],
        [0.4, alpha(SIDE[1].main, 0)],
        [0.6, alpha(SIDE[0].main, 0)],
        [1, alpha(SIDE[0].main, 0.17)],
      ]),
    )
    // Wind ripples and pebbles.
    for (let i = 0; i < 30; i++) {
      const x = x0 + ((i * 397) % cw)
      const y = y0 + ((i * 613) % ch)
      g.arc(x, y + 40, 60, -Math.PI * 0.7, -Math.PI * 0.3, alpha(shade(C.sand, -0.3), 0.4), 5)
    }
    for (let i = 0; i < 14; i++) {
      const x = x0 + ((i * 271 + 90) % cw)
      const y = y0 + ((i * 457 + 140) % ch)
      g.ellipse(x, y, 9, 6, alpha(shade(C.sand, -0.4), 0.7), i * 0.4)
    }
    // Floodlight pools on each half.
    for (const y of [MID - 450, MID + 450]) {
      g.fillView(
        g.rad(W / 2, y, 40, 640, [
          [0, alpha('#ffffff', 0.14)],
          [1, alpha('#ffffff', 0)],
        ]),
      )
    }
  })
  const line = alpha(C.white, 0.85)
  g.rrect(x0 + 14, y0 + 14, cw - 28, ch - 28, 10, undefined, line, 8)
  // Attack lines, a third of the way back from the net.
  g.dashed(x0 + 14, MID - 300, COURT.x1 - 14, MID - 300, alpha(C.white, 0.4), 5, [26, 20])
  g.dashed(x0 + 14, MID + 300, COURT.x1 - 14, MID + 300, alpha(C.white, 0.4), 5, [26, 20])
  if (teams) {
    g.dashed(W / 2, y0 + 14, W / 2, MID - 40, alpha(C.white, 0.22), 4, [14, 18])
    g.dashed(W / 2, MID + 40, W / 2, COURT.y1 - 14, alpha(C.white, 0.22), 4, [14, 18])
  }
}

/** The net seen from above: its shadow on the sand, a mesh band, the top tape and two posts. */
function drawNet(g: Draw, shake: number): void {
  const x0 = COURT.x0 - 10
  const x1 = COURT.x1 + 10
  const wob = shake * Math.sin(shake * 30) * 8
  g.alpha(0.22, () => g.rrect(x0, MID + 8, x1 - x0, 34, 12, '#000000'))
  g.rrect(x0, MID - 22, x1 - x0, 40, 8, alpha(C.ink, 0.35))
  g.clip(x0, MID - 22, x1 - x0, 40, 8, () => {
    for (let x = x0; x <= x1; x += 22)
      g.line(x, MID - 22, x + wob, MID + 18, alpha(C.white, 0.5), 2.5)
    g.line(x0, MID - 2, x1, MID - 2 + wob, alpha(C.white, 0.4), 2.5)
  })
  g.line(x0, MID - 22, x1, MID - 22 + wob * 0.5, shade(C.white, -0.3), 12)
  g.line(x0, MID - 24, x1, MID - 24 + wob * 0.5, C.white, 9)
  for (const x of [x0 - 8, x1 + 8]) {
    g.shadow(x + 10, MID + 20, 24, 10, 0.4)
    g.circle(x, MID - 12, 22, shade(C.wood, -0.3))
    g.circle(x, MID - 16, 20, C.wood)
    g.circle(x - 6, MID - 22, 6, alpha(C.white, 0.5))
  }
}

/** A blob mascot in its owner's colour, upright for the owner, with its side mark on the sand. */
function drawBlob(g: Draw, p: Disc, side: Side, squash: number, wow: number, hot: number): void {
  const r = BLOB_R
  g.shadow(p.x + 6, p.y + 22, r * 0.95, r * 0.5, 0.4)
  // Reach ring on the sand: lights up yellow when the ball is low enough to bump.
  const ring = alpha(hot > 0 ? C.yellow : SIDE[side].light, 0.35 + hot * 0.5)
  g.ring(p.x, p.y + 10, r * 1.12, ring, 6)
  g.sideMark(side, p.x, p.y + 10 + r * 1.12, r * 0.15, hot > 0 ? C.yellow : SIDE[side].light)
  g.forSide(side, p.x, p.y, () => {
    g.blob(0, 0, r, SIDE[side].main, {
      mood: wow > 0.5 ? 'wow' : hot > 0 ? 'grin' : 'happy',
      look: [0, -0.6],
      sx: squash,
      sy: 2 - squash,
    })
  })
}

/** A beach ball: six coloured panels, turning as it flies, lifted by its height. */
function drawBall(g: Draw, b: Ball, spin: number, pop: number): void {
  const sh = BALL_R * (1 - Math.min(0.5, b.z / 900))
  g.shadow(b.x, b.y, sh, sh * 0.42, 0.38 * (1 - Math.min(0.7, b.z / 600)))
  const p = lifted(b.x, b.y, b.z)
  const s = (1 + Math.min(0.32, b.z / 1400)) * pop
  if (s <= 0.01) return
  const panels = [C.red, C.white, C.yellow, C.white, C.blue, C.white]
  g.at(
    p.x,
    p.y,
    spin,
    () => {
      const a = (Math.PI * 2) / panels.length
      panels.forEach((col, k) => {
        g.path(
          (c) => {
            c.moveTo(0, 0)
            c.arc(0, 0, BALL_R, k * a, (k + 1) * a)
            c.closePath()
          },
          col,
          alpha(C.ink, 0.18),
          3,
        )
      })
      g.circle(0, 0, BALL_R * 0.16, C.white, alpha(C.ink, 0.2), 3)
    },
    s,
    s,
  )
  // Shading and gloss stay put while the panels turn.
  const r = BALL_R * s
  g.circle(
    p.x,
    p.y,
    r,
    g.rad(
      p.x,
      p.y,
      r * 0.2,
      r,
      [
        [0, 'rgba(255,255,255,0)'],
        [0.7, 'rgba(0,0,0,0.05)'],
        [1, 'rgba(0,0,0,0.3)'],
      ],
      p.x - r * 0.3,
      p.y - r * 0.35,
    ),
    alpha(C.ink, 0.35),
    4,
  )
  g.alpha(0.7, () => g.ellipse(p.x - r * 0.36, p.y - r * 0.42, r * 0.3, r * 0.15, '#fff', -0.6))
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
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + g.t * 1.5
      g.line(
        land.x + Math.cos(a) * (r + 8),
        land.y + Math.sin(a) * (r + 8),
        land.x + Math.cos(a) * (r + 24),
        land.y + Math.sin(a) * (r + 24),
        col.light,
        6,
      )
    }
  })
}

/** Touch counter: one dot per touch the side with the ball has used. */
function drawTouches(g: Draw, w: World, ball: Ball): void {
  if (w.phase !== 'rally' || w.last === -1) return
  const side = w.last
  const p = lifted(ball.x, ball.y, ball.z)
  const s = 1 + Math.min(0.32, ball.z / 1400)
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

/** Stamps sit between the net and the blob's home spot, so they never cover the player. */
const STAMP_DY = 200

/** The point stamp: who won it and why, on the winner's half. */
function pointStamp(g: Draw, w: World): void {
  if (w.phase !== 'point') return
  const side = w.server
  const t = w.pause
  const s = outBack(prog(t, 0, 0.28))
  const a = 1 - prog(t, POINT_PAUSE - 0.3, POINT_PAUSE)
  const why = w.why === 'net' ? 'Into the net!' : w.why === 'touches' ? 'Too many touches!' : 'In!'
  const loser: Side = side === 0 ? 1 : 0
  g.alpha(a, () => {
    g.forSide(side, W / 2, side === 0 ? MID + STAMP_DY : MID - STAMP_DY, () =>
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
    if (w.why !== 'land')
      g.forSide(loser, W / 2, loser === 0 ? MID + STAMP_DY : MID - STAMP_DY, () =>
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
    g.forSide(win, W / 2, win === 0 ? MID + 520 : MID - 520, () =>
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
  drawSand(g, look.teams)
  if (look.landing && w.phase === 'rally') drawLanding(g, look.landing, look.ball.z)
  const netShake = w.phase === 'point' && w.why === 'net' ? Math.max(0, 1 - w.pause / 0.8) : 0
  // Blobs on the far side of the net from the camera's view are drawn first.
  const ballLow = w.phase === 'rally' && look.ball.z <= REACH
  const ballSide: Side = look.ball.y > MID ? 0 : 1
  look.blobs.forEach((p, i) => {
    const side = look.blobSides[i] ?? 0
    const near = Math.hypot(p.x - look.ball.x, p.y - look.ball.y) < BLOB_R + BALL_R + 90
    const hot = ballLow && side === ballSide && near ? 1 : 0
    drawBlob(g, p, side, look.squash[i] ?? 1, look.wow[i] ?? 0, hot)
  })
  drawNet(g, netShake)
  const pop = w.phase === 'rally' ? outBack(prog(w.rally, 0, 0.3)) : 1
  drawBall(g, look.ball, look.spin, Math.max(0.01, pop))
  drawTouches(g, w, look.ball)
  pointStamp(g, w)
  // HUD: names (with whose ball it is) and points.
  for (const side of [0, 1] as Side[]) {
    namePill(g, side, look.names[side], {
      active: look.active[side] && !look.end,
      text: look.status[side],
    })
    scorePlate(g, side, look.score[side], look.target, look.pulse[side])
  }
  if (look.end) ending(g, look.end, look.names[look.end.side])
}
