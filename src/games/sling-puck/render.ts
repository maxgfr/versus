import type { Side } from '../../core/game.ts'
import { banner, bigScore, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, shade, SIDE } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import {
  BAND_X0,
  BAND_X1,
  BAND_Y,
  GAP,
  local,
  MIN_POWER,
  owned,
  type Puck,
  shotFrom,
  stretchAt,
  type Table,
  WALL_T,
} from './rules.ts'

export interface Look {
  names: [string, string]
  /** Pucks per side at the start (the match length). */
  target: number
  /** Show the "pull back on the band" hint on each side. */
  hint: [boolean, boolean]
  /** The decided match (stamped in state), for the ending. */
  end: { at: number; winner: Side | 'draw' } | null
}

const FRAME = 22
const RIM = '#5a3a22'

/** World point of a red-frame point for `side`. */
const P = local

function drawTable(g: Draw, t: Table): void {
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, shade(C.blue, -0.84)],
      [0.5, C.ink],
      [1, shade(C.red, -0.84)],
    ]),
  )
  // Wooden frame with a lip, then the floodlit board.
  g.shadow(W / 2, H - 6, W * 0.52, 40, 0.5)
  g.rrect(-FRAME, -FRAME + 14, W + FRAME * 2, H + FRAME * 2, 70, shade(RIM, -0.45))
  g.rrect(
    -FRAME,
    -FRAME,
    W + FRAME * 2,
    H + FRAME * 2,
    70,
    g.lin(0, 0, W, 0, [
      [0, shade(C.wood, -0.2)],
      [0.5, C.wood],
      [1, shade(C.wood, -0.25)],
    ]),
  )
  g.rrect(
    0,
    0,
    W,
    H,
    52,
    g.lin(0, 0, 0, H, [
      [0, shade(C.blue, -0.55)],
      [0.47, shade(C.ink3, -0.1)],
      [0.53, shade(C.ink3, -0.1)],
      [1, shade(C.red, -0.55)],
    ]),
  )
  g.clip(0, 0, W, H, 52, () => {
    // Light pool in the middle of the table, and each end glowing in its owner's colour.
    g.fillView(
      g.rad(W / 2, MID, 40, 900, [
        [0, alpha('#ffffff', 0.1)],
        [1, alpha('#ffffff', 0)],
      ]),
    )
    // Fine wood-grain lines, very faint.
    for (let x = 60; x < W; x += 110) g.line(x, 0, x, H, alpha(C.white, 0.03), 3)
    // Behind each band: the darker pull pocket, with chevrons pointing back.
    for (const side of [0, 1] as Side[]) {
      const a = P(side, 0, BAND_Y)
      const y0 = side === 0 ? a.y : 0
      g.rect(0, y0, W, H - BAND_Y, alpha(C.ink, 0.35))
      const glow = owned(t, side) > 0 && !t.aims[side] ? 0.5 + 0.5 * Math.sin(g.t * 3) : 0
      for (let i = 0; i < 3; i++) {
        const c = P(side, W / 2, BAND_Y + 70 + i * 48)
        const s = side === 0 ? 1 : -1
        g.alpha(0.1 + glow * 0.08 * (3 - i), () =>
          g.poly(
            [c.x - 40, c.y - 14 * s, c.x, c.y + 14 * s, c.x + 40, c.y - 14 * s],
            undefined,
            C.white,
            8,
          ),
        )
      }
    }
  })
  g.rrect(0, 0, W, H, 52, undefined, alpha(C.white, 0.12), 5)
}

/** The midline wall with its gap: chunky wooden bars, glossy posts, a yellow glow in the gap. */
function drawWall(g: Draw): void {
  const gapL = W / 2 - GAP / 2
  const gapR = W / 2 + GAP / 2
  const pulse = 0.5 + 0.5 * Math.sin(g.t * 4)
  // Gap glow: the one place that matters.
  g.alpha(0.55 + pulse * 0.35, () =>
    g.fillView(
      g.rad(W / 2, MID, 10, GAP * 0.75, [
        [0, alpha(C.yellow, 0.32)],
        [1, alpha(C.yellow, 0)],
      ]),
    ),
  )
  g.rrect(gapL + 14, MID - 4, GAP - 28, 8, 4, alpha(C.yellow, 0.35 + pulse * 0.3))
  const bar = (x0: number, x1: number) => {
    g.rrect(x0, MID - WALL_T / 2 + 8, x1 - x0, WALL_T, WALL_T / 2, shade(RIM, -0.4))
    g.rrect(
      x0,
      MID - WALL_T / 2,
      x1 - x0,
      WALL_T,
      WALL_T / 2,
      g.lin(0, MID - WALL_T / 2, 0, MID + WALL_T / 2, [
        [0, shade(C.wood, 0.15)],
        [1, shade(C.wood, -0.2)],
      ]),
    )
    g.rrect(x0 + 8, MID - WALL_T / 2 + 3, x1 - x0 - 16, 5, 2.5, alpha(C.white, 0.3))
  }
  bar(-FRAME, gapL)
  bar(gapR, W + FRAME)
  for (const px of [gapL, gapR]) {
    g.shadow(px + 4, MID + 14, WALL_T * 0.8, WALL_T * 0.45, 0.4)
    g.ball(px, MID, WALL_T * 0.85, C.cream, 0.8)
  }
}

/** The band: from post to post, wrapping round the back of a puck that stretches it. */
function drawBand(g: Draw, t: Table, side: Side): void {
  const col = SIDE[side]
  const aim = t.aims[side]
  const held = aim ? t.pucks[aim.idx] : undefined
  const A = P(side, BAND_X0, BAND_Y)
  const B = P(side, BAND_X1, BAND_Y)
  const s = side === 0 ? 1 : -1
  const band = (pts: number[], lw: number, color: string) => {
    const c = g.ctx
    c.save()
    c.lineJoin = 'round'
    c.lineCap = 'round'
    c.strokeStyle = color
    c.lineWidth = lw
    c.beginPath()
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i] as number
      const y = pts[i + 1] as number
      if (i === 0) c.moveTo(x, y)
      else c.lineTo(x, y)
    }
    c.stroke()
    c.restore()
  }
  let pts: number[]
  if (held && stretchAt(local(side, held.x, held.y).y, held.r) > 0) {
    // Wrap round the back of the puck: two straight runs plus the back arc.
    const l = local(side, held.x, held.y)
    const pts2: number[] = [BAND_X0, BAND_Y]
    const r = held.r + 6
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI - (Math.PI * i) / 10
      pts2.push(l.x + Math.cos(a) * r, l.y + Math.sin(a) * r * 0.9)
    }
    pts2.push(BAND_X1, BAND_Y)
    pts = []
    for (let i = 0; i < pts2.length; i += 2) {
      const w = P(side, pts2[i] as number, pts2[i + 1] as number)
      pts.push(w.x, w.y)
    }
  } else {
    // Twang after a shot: a decaying wobble along the band.
    const sh = t.shots[side]
    const age = t.t - sh.at
    const amp = age < 0.9 ? 46 * sh.power * Math.exp(-age * 5) * Math.cos(age * 38) : 0
    pts = []
    for (let i = 0; i <= 16; i++) {
      const k = i / 16
      const x = BAND_X0 + (BAND_X1 - BAND_X0) * k
      const w = P(side, x, BAND_Y + amp * Math.sin(Math.PI * k))
      pts.push(w.x, w.y)
    }
  }
  band(
    pts.map((v, i) => (i % 2 ? v + 6 * s : v)),
    18,
    alpha('#000000', 0.35),
  )
  band(pts, 16, shade(col.main, -0.35))
  band(pts, 9, col.light)
  for (const p of [A, B]) {
    g.shadow(p.x + 4, p.y + 12, 26, 14, 0.4)
    g.ball(p.x, p.y, 24, col.main, 0.9)
  }
}

function drawPuck(g: Draw, p: Puck, lift = 0): void {
  const r = p.r * (1 + lift * 0.08)
  const sx = p.x
  const sy = p.y - lift * 10
  g.shadow(p.x + 6 + lift * 8, p.y + 14 + lift * 10, r * 0.95, r * 0.75, 0.4 - lift * 0.1)
  if (p.half === 0) {
    // Red pucks are round.
    g.disc(sx, sy, r, C.red)
    g.ring(sx, sy, r * 0.56, alpha(C.white, 0.3), 6)
    g.circle(sx, sy, r * 0.16, alpha(C.white, 0.5))
  } else {
    // Blue pucks are square, so the two sides never rely on colour alone.
    const s = r * 1.72
    g.tile(sx - s / 2, sy - s / 2, s, s, s * 0.26, C.blue, 16)
    g.rrect(
      sx - s * 0.28,
      sy - s * 0.32,
      s * 0.56,
      s * 0.56,
      s * 0.12,
      undefined,
      alpha(C.white, 0.3),
      6,
    )
  }
}

/** Shot preview from a stretched band: dots along the flight, yellow when it threads the gap. */
function drawPreview(g: Draw, t: Table, side: Side): void {
  const aim = t.aims[side]
  const p = aim ? t.pucks[aim.idx] : undefined
  if (!aim || !p) return
  const l = local(side, p.x, p.y)
  const shot = shotFrom(l.x, l.y, p.r)
  if (shot.power < MIN_POWER) {
    g.ring(p.x, p.y, p.r + 22, alpha(SIDE[side].light, 0.5 + 0.2 * Math.sin(g.t * 8)), 6)
    return
  }
  const k = (MID - l.y) / (shot.dy || -1e-6)
  const crossX = l.x + shot.dx * k
  const through = Math.abs(crossX - W / 2) < GAP / 2 - p.r * 0.6
  const col = through ? C.yellow : SIDE[side].light
  const len = 220 + shot.power * 900
  for (let i = 1; i <= 12; i++) {
    const f = i / 13
    const d = len * f
    const w = P(side, l.x + shot.dx * d, l.y + shot.dy * d)
    g.alpha((1 - f) * 0.9, () => g.circle(w.x, w.y, 11 - f * 6, col))
  }
  // Power ring round the puck.
  g.arc(p.x, p.y, p.r + 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * shot.power, col, 12)
}

export function render(g: Draw, t: Table, look: Look): void {
  drawTable(g, t)
  drawWall(g)
  for (const side of [0, 1] as Side[]) drawBand(g, t, side)
  // Pucks: resting ones first, then the held ones lifted on top.
  for (const p of t.pucks) if (!p.held) drawPuck(g, p)
  for (const side of [0, 1] as Side[]) drawPreview(g, t, side)
  for (const p of t.pucks) if (p.held) drawPuck(g, p, 1)

  for (const side of [0, 1] as Side[]) {
    const n = owned(t, side)
    namePill(g, side, look.names[side], {
      x: W / 2,
      active: n === 1 && !look.end,
      text: n === 1 && !look.end ? 'LAST PUCK!' : undefined,
    })
    bigScore(g, side, n, { x: side === 0 ? 120 : W - 120 })
    if (look.hint[side] && t.t < 9 && !t.aims[side] && !look.end) {
      const y = side === 0 ? MID + 150 : MID - 150
      g.alpha(0.6 + 0.3 * Math.sin(g.t * 4), () =>
        g.sideText(side, 'DRAG A PUCK BACK ON THE BAND', W / 2, y, {
          size: 38,
          weight: 700,
          color: C.white,
          stroke: alpha(C.ink, 0.8),
          strokeWidth: 8,
        }),
      )
    }
  }
  const end = look.end
  if (end) {
    const k = Math.min(1, (t.t - end.at) / 0.35)
    if (end.winner === 'draw') banner(g, undefined, 'DRAW', MID, { alpha: k })
    else
      banner(g, end.winner, 'TABLE CLEAR!', end.winner === 0 ? MID + 300 : MID - 300, {
        alpha: k,
        color: SIDE[end.winner].light,
        size: 64 + (1 - k) * 30,
      })
  }
}
