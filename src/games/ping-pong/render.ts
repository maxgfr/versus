import type { Side } from '../../core/game.ts'
import { outBack, prog } from '../../core/fx/ease.ts'
import { banner, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import type { Disc } from '../../engines/puck/index.ts'
import { BAT_R, bandOf, bounceY, TABLE, type World } from './rules.ts'

export interface Look {
  /** Interpolated positions for this frame. */
  ball: Disc
  bats: [Disc, Disc]
  /** Drawn height of the ball above the table. */
  z: number
  trail: { x: number; y: number; z: number }[]
  squash: number[]
  /** 0..1 pulse for the scorer's figure. */
  pulse: [number, number]
  /** 0..1 fade-in of a freshly launched ball. */
  serve: number
  /** Seconds since each bat last struck the ball. */
  since: [number, number]
  /** Seconds since the last point (the ball dropping off the end), or -1. */
  fell: number
  names: [string, string]
  bots: [boolean, boolean]
  target: number
  /** Seconds since the match was decided, or -1 while it is on. */
  ended: number
  winner: Side | null
}

/** Each player's scoreboard band ends here (the table sits between them). */
const BAND_T = 128
const BAND_B = 1672
const TABLE_DARK = '#173d86'
const TABLE_LIT = '#2559b8'
const RIM = '#0c1f4a'

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
/** Red-frame x to world x for a side (blue's layout is turned about the centre). */
const fx = (side: Side, x: number): number => (side === 0 ? x : W - x)

/** The hall: dark floor with a light pool, each player's end in their colour. */
function arena(g: Draw): void {
  const v = g.stage.view
  g.fillView(
    g.lin(0, v.y, 0, v.y + v.h, [
      [0, shade(C.blue, -0.8)],
      [0.5, C.ink],
      [1, shade(C.red, -0.8)],
    ]),
  )
  g.fillView(
    g.rad(W / 2, MID, 80, 1150, [
      [0, alpha('#ffffff', 0.08)],
      [1, alpha('#ffffff', 0)],
    ]),
  )
  for (const side of [0, 1] as Side[]) {
    const col = SIDE[side].main
    const y0 = side === 1 ? v.y - 2 : BAND_B
    const y1 = side === 1 ? BAND_T : v.y + v.h + 2
    g.rect(
      v.x - 2,
      y0,
      v.w + 4,
      y1 - y0,
      g.lin(0, y0, 0, y1, [
        [0, shade(col, side === 1 ? -0.52 : -0.7)],
        [1, shade(col, side === 1 ? -0.7 : -0.52)],
      ]),
    )
    g.rect(v.x - 2, side === 1 ? BAND_T - 5 : BAND_B, v.w + 4, 5, alpha(col, 0.6))
  }
}

function drawTable(g: Draw): void {
  const tw = TABLE.x1 - TABLE.x0
  const th = TABLE.y1 - TABLE.y0
  const pad = 22
  // Legs' shadow on the floor, then a chunky rim with a lip.
  g.shadow(W / 2, TABLE.y1 + pad + 16, tw * 0.56, 34, 0.5)
  g.rrect(TABLE.x0 - pad, TABLE.y0 - pad + 14, tw + pad * 2, th + pad * 2, 30, shade(RIM, -0.4))
  g.rrect(TABLE.x0 - pad, TABLE.y0 - pad, tw + pad * 2, th + pad * 2, 30, RIM)
  g.rrect(TABLE.x0 - pad + 30, TABLE.y0 - pad + 4, tw + pad * 2 - 60, 8, 4, alpha('#ffffff', 0.12))
  g.rrect(
    TABLE.x0,
    TABLE.y0,
    tw,
    th,
    10,
    g.lin(0, TABLE.y0, 0, TABLE.y1, [
      [0, TABLE_DARK],
      [0.5, TABLE_LIT],
      [1, TABLE_DARK],
    ]),
  )
  g.clip(TABLE.x0, TABLE.y0, tw, th, 10, () => {
    // Floodlight pool on the middle of the table.
    g.fillView(
      g.rad(W / 2, MID, 30, th * 0.62, [
        [0, alpha('#ffffff', 0.16)],
        [1, alpha('#ffffff', 0)],
      ]),
    )
    // Each end glows in the colour of the player who defends it.
    g.rect(
      TABLE.x0,
      TABLE.y0,
      tw,
      th,
      g.lin(0, TABLE.y0, 0, TABLE.y1, [
        [0, alpha(SIDE[1].main, 0.3)],
        [0.3, alpha(SIDE[1].main, 0)],
        [0.7, alpha(SIDE[0].main, 0)],
        [1, alpha(SIDE[0].main, 0.3)],
      ]),
    )
    // Each bat's zone, a faint lane in its colour.
    for (const side of [0, 1] as Side[]) {
      const b = bandOf(side)
      g.rrect(
        b.x0 - BAT_R,
        b.y0 - BAT_R,
        b.x1 - b.x0 + BAT_R * 2,
        b.y1 - b.y0 + BAT_R * 2,
        BAT_R,
        alpha(SIDE[side].light, 0.07),
      )
    }
  })
  // White edge lines and the centre line along the table.
  const line = alpha('#ffffff', 0.9)
  g.rrect(TABLE.x0 + 8, TABLE.y0 + 8, tw - 16, th - 16, 6, undefined, line, 10)
  g.line(W / 2, TABLE.y0 + 8, W / 2, TABLE.y1 - 8, alpha('#ffffff', 0.45), 5, 'butt')
  // Where the ball touches down on each half: faint dashes.
  for (const side of [0, 1] as Side[]) {
    g.dashed(
      TABLE.x0 + 40,
      bounceY(side),
      TABLE.x1 - 40,
      bounceY(side),
      alpha('#ffffff', 0.07),
      4,
      [14, 22],
    )
  }
}

/** The net across the midline: shadow on the table, mesh, a white tape and two clamps. */
function drawNet(g: Draw): void {
  const x0 = TABLE.x0 - 10
  const x1 = TABLE.x1 + 10
  g.rect(x0, MID + 6, x1 - x0, 22, alpha('#000000', 0.25))
  g.rect(x0, MID - 14, x1 - x0, 26, alpha(C.ink, 0.55))
  g.alpha(0.35, () => {
    for (let x = x0 + 8; x < x1; x += 16) g.rect(x, MID - 14, 2, 26, '#ffffff')
    g.rect(x0, MID - 2, x1 - x0, 2, '#ffffff')
  })
  g.rrect(x0, MID - 20, x1 - x0, 10, 4, '#ffffff')
  for (const x of [x0 - 6, x1 - 18]) {
    g.rrect(x, MID - 26, 24, 44, 8, shade(C.ink4, 0.1))
    g.rrect(x + 4, MID - 22, 16, 10, 4, alpha('#ffffff', 0.25))
  }
}

/** A bat seen from above: rubber head on a wooden blade, handle toward its own edge. */
function drawBat(
  g: Draw,
  p: Disc,
  side: Side,
  squash: number,
  since: number,
  serving: boolean,
): void {
  const col = SIDE[side].main
  const hl = 104
  // Handle points to the player's own edge; the bat leans with its motion.
  const lean = clamp(p.vx / 4200, -0.4, 0.4) * (side === 0 ? -1 : 1)
  const flash = 1 - prog(since, 0, 0.22)
  g.shadow(p.x + 10, p.y + 18, p.r * 1.0, p.r * 0.86, 0.4)
  g.at(
    p.x,
    p.y,
    lean,
    () => {
      // Handle: wood with a grip wrap in the team's dark colour, toward the player's edge.
      g.at(0, 0, side === 1 ? Math.PI : 0, () => {
        g.rrect(-22, p.r * 0.62, 44, hl, 20, shade(C.woodDark, -0.2))
        g.rrect(-20, p.r * 0.6, 40, hl - 6, 18, C.wood)
        g.rrect(-20, p.r * 0.6 + 34, 40, hl - 44, 16, SIDE[side].dark)
        for (let i = 0; i < 3; i++)
          g.rect(-20, p.r * 0.6 + 44 + i * 18, 40, 4, alpha('#000000', 0.18))
      })
      // Blade edge, then the rubber.
      g.circle(0, p.r * 0.12, p.r + 6, shade(C.woodDark, -0.3))
      g.circle(0, 0, p.r + 6, C.wood)
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
            [0, shade(col, 0.3)],
            [0.75, col],
            [1, shade(col, -0.2)],
          ],
          -p.r * 0.3,
          -p.r * 0.35,
        ),
      )
      // Pimpled rubber texture.
      g.alpha(0.13, () => {
        for (let yy = -p.r + 14; yy < p.r; yy += 18)
          for (let xx = -p.r + 14 + ((yy / 18) % 2) * 9; xx < p.r; xx += 18)
            if (xx * xx + yy * yy < (p.r - 10) ** 2) g.circle(xx, yy, 3, '#000000')
      })
      g.alpha(0.5, () => g.ellipse(-p.r * 0.35, -p.r * 0.42, p.r * 0.32, p.r * 0.14, '#fff', -0.6))
      g.sideMark(side, 0, 0, p.r * 0.17, alpha('#ffffff', 0.85))
      if (flash > 0) g.alpha(flash * 0.8, () => g.circle(0, 0, p.r, '#ffffff'))
    },
    squash,
    2 - squash,
  )
  if (serving) {
    const pulse = 0.5 + 0.5 * Math.sin(g.t * 6)
    g.ring(p.x, p.y, p.r + 24 + pulse * 10, alpha(C.yellow, 0.5 + pulse * 0.45), 7)
  }
}

/** The ball with its drawn height: it grows and its shadow slides away as it rises. */
function drawBall(g: Draw, b: Disc, z: number, a: number, scale = 1): void {
  const r = b.r * (1 + z / 260) * scale
  g.alpha(a, () => {
    g.alpha(Math.max(0.15, 0.45 - z / 400), () =>
      g.ellipse(
        b.x + 4 + z * 0.3,
        b.y + 8 + z * 0.45,
        b.r * 0.95 * scale,
        b.r * 0.72 * scale,
        '#000',
      ),
    )
    g.ball(b.x, b.y, r, C.white, 1)
  })
}

function trailOf(g: Draw, b: Disc, trail: Look['trail'], hot: number): void {
  const col = mix(C.white, C.yellow, hot)
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i]
    if (!t) continue
    const k = (i + 1) / (trail.length + 1)
    g.alpha(k * (0.25 + hot * 0.3), () =>
      g.circle(t.x, t.y, b.r * (1 + t.z / 260) * (0.45 + 0.5 * k), col),
    )
  }
}

/** Score box, name pill and match progress at a player's edge, upright for them. */
function scoreboard(g: Draw, w: World, side: Side, look: Look): void {
  const y = hudY(g, side)
  const col = SIDE[side]
  const score = w.score[side]
  const pulse = look.pulse[side]
  const serving = w.phase !== 'play' && w.server === side && look.ended < 0
  namePill(g, side, look.names[side], {
    active: serving,
    text: serving ? (look.bots[side] ? 'Serving' : 'Your serve') : undefined,
  })
  g.forSide(side, fx(side, 112), y, () => {
    const s = 1 + pulse * 0.25
    g.rrect(-60 * s, -48 * s, 120 * s, 96 * s, 24, alpha(C.ink, 0.85))
    g.rrect(-60 * s, -48 * s, 120 * s, 96 * s, 24, undefined, alpha(col.main, 0.7 + pulse * 0.3), 5)
    g.text(score, 0, 4, { size: 70 * s, weight: 700, color: C.white, drop: col.dark })
  })
  const other: Side = side === 0 ? 1 : 0
  const lead = score - w.score[other]
  const atPoint = score + 1 >= look.target && lead >= 1 && look.ended < 0
  const deuce = score >= look.target - 1 && w.score[other] >= look.target - 1 && lead === 0
  g.forSide(side, fx(side, 850), y, () => {
    if (atPoint || deuce) {
      const pulseY = 0.85 + 0.15 * Math.sin(g.t * 5)
      const label = atPoint ? 'Match point' : 'Deuce'
      const wd = g.measure(label, 34, 700) + 36
      g.alpha(pulseY, () => g.rrect(-wd / 2, -26, wd, 52, 26, atPoint ? C.yellow : C.ink3))
      g.text(label, 0, 2, { size: 34, weight: 700, color: atPoint ? C.ink : C.white })
      return
    }
    const n = Math.min(look.target, 11)
    const gap = Math.min(34, 290 / Math.max(1, n - 1))
    const x0 = -((n - 1) * gap) / 2
    for (let i = 0; i < n; i++) {
      const on = i < score
      g.circle(x0 + i * gap, 0, 11, on ? col.main : alpha(C.white, 0.14))
      if (on) g.circle(x0 + i * gap - 3, -3, 4, alpha(C.white, 0.6))
    }
  })
}

/** Trophy and rays on the winner's half while the result screen waits. */
function victory(g: Draw, side: Side, e: number): void {
  const p = prog(e, 0, 0.55)
  const s = outBack(p)
  const y = side === 0 ? MID + 380 : MID - 380
  g.forSide(side, W / 2, y, () => {
    g.alpha(0.55 * p, () => {
      for (let i = 0; i < 12; i++) {
        const a0 = g.t * 0.5 + (i * Math.PI * 2) / 12
        const a1 = a0 + 0.13
        g.poly(
          [0, 0, Math.cos(a0) * 520, Math.sin(a0) * 520, Math.cos(a1) * 520, Math.sin(a1) * 520],
          alpha(C.yellow, 0.22),
        )
      }
    })
    g.emoji('🏆', 0, -30, 190 * s)
    g.text('WINNER!', 0, 130, {
      size: 76 * s,
      weight: 700,
      color: C.yellow,
      stroke: alpha(C.ink, 0.9),
      strokeWidth: 14,
    })
  })
}

export function render(g: Draw, w: World, look: Look): void {
  arena(g)
  drawTable(g)
  // Faint big score on each half, upright for its player, near the net on their right.
  for (const side of [0, 1] as Side[]) {
    const pulse = look.pulse[side]
    g.forSide(side, fx(side, 760), side === 0 ? MID + 150 : MID - 150, () =>
      g.text(w.score[side], 0, 0, {
        size: 150 * (1 + pulse * 0.3),
        weight: 700,
        color: alpha(SIDE[side].light, 0.16 + pulse * 0.5),
      }),
    )
  }
  const ball = look.ball
  if (w.phase === 'serve' && look.ended < 0) {
    const s = w.server
    if (!look.bots[s]) banner(g, s, 'Tap to serve', s === 0 ? MID + 140 : MID - 140, { size: 52 })
  }
  look.bats.forEach((b, i) => {
    const side = i as Side
    drawBat(
      g,
      b,
      side,
      look.squash[i] ?? 1,
      look.since[side],
      w.phase === 'serve' && w.server === side && look.ended < 0,
    )
  })
  drawNet(g)
  if (w.phase === 'play' || w.phase === 'serve') {
    const hot = clamp((w.speed - 1300) / 800, 0, 1)
    if (w.phase === 'play') trailOf(g, ball, look.trail, hot)
    if (hot > 0 && w.phase === 'play')
      g.alpha(hot * 0.35, () => g.circle(ball.x, ball.y, ball.r * 1.9, alpha(C.yellow, 0.5)))
    drawBall(g, ball, look.z, look.serve)
    if (look.serve < 1)
      g.ring(ball.x, ball.y, ball.r * (2.6 - look.serve * 1.4), alpha(C.yellow, 1 - look.serve), 6)
  } else if (look.fell >= 0 && look.fell < 0.6) {
    // The ball sails off the end of the table and drops to the floor.
    const k = look.fell / 0.6
    const fb = {
      ...ball,
      x: ball.x + ball.vx * look.fell * 0.4,
      y: ball.y + ball.vy * look.fell * 0.4,
    }
    drawBall(g, fb, 0, 1 - k, 1 - 0.45 * k)
  }
  for (const side of [0, 1] as Side[]) scoreboard(g, w, side, look)
  if (look.ended >= 0 && look.winner !== null) victory(g, look.winner, look.ended)
}
