import type { Side } from '../../core/game.ts'
import { outBack, prog } from '../../core/fx/ease.ts'
import { banner, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import type { Disc } from '../../engines/puck/index.ts'
import { BALL_R, COOLDOWN, GOAL_PAUSE, RINK, type World } from './rules.ts'

export interface Look {
  ball: Disc
  players: Disc[]
  trail: { x: number; y: number }[]
  /** Uniform punch per disc (1 = rest). */
  pop: number[]
  /** 0..1 pulse for each side's score figure. */
  pulse: [number, number]
  names: [string, string]
  bots: [boolean, boolean]
  /** The last goal (for the net ripple), stamped in game time. */
  goal: { x: number; side: Side; e: number } | null
  /** Seconds since the match was decided, or -1. */
  ended: number
  winner: Side | null
}

const BAND_T = 118
const BAND_B = 1682
const NET_D = 74
const GRASS = '#2f8c48'
const GRASS_DARK = '#287a3e'
const GOAL_HALF = RINK.goal / 2

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const fx = (side: Side, x: number): number => (side === 0 ? x : W - x)
/** Toward a side's own edge (+1 down for red, -1 up for blue). */
const out = (side: Side): number => (side === 0 ? 1 : -1)
/** The goal line a side defends. */
const lineOf = (side: Side): number => (side === 0 ? RINK.y1 : RINK.y0)

function arena(g: Draw): void {
  const v = g.stage.view
  g.fillView(
    g.lin(0, v.y, 0, v.y + v.h, [
      [0, shade(C.blue, -0.8)],
      [0.5, '#0b1a12'],
      [1, shade(C.red, -0.8)],
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
        // Lighter than the name pill (shade -0.62) so the pill reads as a chip on the band.
        [0, shade(col, side === 1 ? -0.36 : -0.5)],
        [1, shade(col, side === 1 ? -0.5 : -0.36)],
      ]),
    )
    g.rect(v.x - 2, side === 1 ? BAND_T - 5 : BAND_B, v.w + 4, 5, alpha(col, 0.6))
  }
}

/** Night pitch inside rounded boards, floodlit, with each end tinted by its defender. */
function drawPitch(g: Draw): void {
  const pw = RINK.x1 - RINK.x0
  const ph = RINK.y1 - RINK.y0
  const pad = 24
  g.rrect(
    RINK.x0 - pad,
    RINK.y0 - pad + 12,
    pw + pad * 2,
    ph + pad * 2,
    RINK.corner + pad,
    '#0f2a18',
  )
  g.rrect(RINK.x0 - pad, RINK.y0 - pad, pw + pad * 2, ph + pad * 2, RINK.corner + pad, '#1d4a2b')
  g.rrect(
    RINK.x0 + RINK.corner,
    RINK.y0 - pad + 4,
    pw - RINK.corner * 2,
    8,
    4,
    alpha('#ffffff', 0.12),
  )
  g.rrect(RINK.x0, RINK.y0, pw, ph, RINK.corner, GRASS)
  g.clip(RINK.x0, RINK.y0, pw, ph, RINK.corner, () => {
    for (let y = MID - 70, i = 0; y > RINK.y0 - 140; y -= 140, i++)
      if (i % 2 === 0) g.rect(RINK.x0, y, pw, 140, GRASS_DARK)
    for (let y = MID + 70, i = 1; y < RINK.y1; y += 140, i++)
      if (i % 2 === 0) g.rect(RINK.x0, y, pw, 140, GRASS_DARK)
    g.fillView(
      g.rad(W / 2, MID, 60, 950, [
        [0, alpha('#ffffff', 0.1)],
        [1, alpha('#ffffff', 0)],
      ]),
    )
    g.rect(
      RINK.x0,
      RINK.y0,
      pw,
      ph,
      g.lin(0, RINK.y0, 0, RINK.y1, [
        [0, alpha(SIDE[1].main, 0.2)],
        [0.25, alpha(SIDE[1].main, 0)],
        [0.75, alpha(SIDE[0].main, 0)],
        [1, alpha(SIDE[0].main, 0.14)],
      ]),
    )
  })
  const line = alpha('#ffffff', 0.8)
  const lw = 8
  const inset = 20
  g.rrect(
    RINK.x0 + inset,
    RINK.y0 + inset,
    pw - inset * 2,
    ph - inset * 2,
    RINK.corner - inset,
    undefined,
    line,
    lw,
  )
  g.line(RINK.x0 + inset, MID, RINK.x1 - inset, MID, line, lw)
  g.ring(W / 2, MID, 140, line, lw)
  g.circle(W / 2, MID, 10, line)
  for (const side of [0, 1] as Side[]) {
    const ly = lineOf(side) - out(side) * inset
    const d = -out(side)
    const box = (w: number, depth: number) =>
      g.poly(
        [
          W / 2 - w / 2,
          ly,
          W / 2 - w / 2,
          ly + d * depth,
          W / 2 + w / 2,
          ly + d * depth,
          W / 2 + w / 2,
          ly,
        ],
        undefined,
        line,
        lw,
      )
    box(560, 230)
    box(300, 90)
    g.circle(W / 2, ly + d * 170, 8, line)
    g.arc(
      W / 2,
      ly + d * 170,
      120,
      side === 1 ? 0.52 : Math.PI + 0.52,
      side === 1 ? Math.PI - 0.52 : -0.52,
      line,
      lw,
    )
  }
}

/** Net depth behind the line at x, bulged by a ripple around hx. */
function netBack(side: Side, x: number, hx: number, amp: number): number {
  const k = (x - hx) / 110
  return lineOf(side) + out(side) * (NET_D + amp * Math.exp(-k * k))
}

/** A goal in its pocket: netting, frame and posts, rippling after a goal. */
function drawGoal(g: Draw, side: Side, ripple: { x: number; e: number } | null): void {
  const ly = lineOf(side)
  const o = out(side)
  const x0 = W / 2 - GOAL_HALF
  const x1 = W / 2 + GOAL_HALF
  const e = ripple ? ripple.e : 9
  const amp = ripple ? 50 * Math.exp(-3 * e) * (0.55 + 0.45 * Math.cos(13 * e)) : 0
  const hx = ripple ? ripple.x : W / 2
  const xs: number[] = []
  for (let x = x0; x <= x1 + 0.5; x += 24) xs.push(x)
  const pts: number[] = [x0, ly]
  for (const x of xs) pts.push(x, netBack(side, x, hx, amp))
  pts.push(x1, ly)
  g.poly(pts, alpha(C.ink, 0.7))
  g.poly(pts, alpha(SIDE[side].main, 0.16))
  const mesh = alpha('#ffffff', 0.4)
  for (const x of xs) g.line(x, ly, x, netBack(side, x, hx, amp), mesh, 2, 'butt')
  for (let f = 0.25; f < 1.01; f += 0.25) {
    g.path(
      (c) =>
        xs.forEach((x, i) => {
          const y = ly + (netBack(side, x, hx, amp) - ly) * f
          if (i === 0) c.moveTo(x, y)
          else c.lineTo(x, y)
        }),
      undefined,
      mesh,
      2,
    )
  }
  const by = ly + o * NET_D
  g.line(x0, by, x1, by, alpha('#ffffff', 0.55), 5)
  g.line(x0, ly, x0, by, alpha('#ffffff', 0.75), 6)
  g.line(x1, ly, x1, by, alpha('#ffffff', 0.75), 6)
  g.rrect(x0 - 8, ly - 8 + 5, x1 - x0 + 16, 16, 8, alpha('#000000', 0.3))
  g.rrect(x0 - 8, ly - 8, x1 - x0 + 16, 16, 8, '#f6f2ea')
  for (const px of [x0, x1]) {
    g.circle(px, ly + 5, 17, alpha('#000000', 0.3))
    g.circle(px, ly, 17, '#ffffff')
    g.circle(px - 5, ly - 5, 6, alpha(SIDE[side].light, 0.8))
  }
}

/** Five-panel football; the pattern turns with the distance rolled. */
function football(g: Draw, x: number, y: number, r: number, spin: number): void {
  g.ball(x, y, r, '#f2efe8', 0)
  const pent = (cx: number, cy: number, s: number, rot: number) => {
    const p: number[] = []
    for (let i = 0; i < 5; i++) {
      const a = rot + (i * Math.PI * 2) / 5
      p.push(cx + Math.cos(a) * s, cy + Math.sin(a) * s)
    }
    g.poly(p, C.ink2)
  }
  g.clip(x - r, y - r, r * 2, r * 2, r, () => {
    const cx = x + Math.cos(spin * 0.7) * r * 0.18
    const cy = y + Math.sin(spin * 0.7) * r * 0.18
    pent(cx, cy, r * 0.32, spin)
    for (let k = 0; k < 5; k++) {
      const a = spin + Math.PI / 5 + (k * Math.PI * 2) / 5
      g.line(cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, alpha(C.ink2, 0.35), 2)
      pent(cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95, r * 0.3, a + Math.PI)
    }
  })
  g.ring(x, y, r, alpha('#000000', 0.25), 2)
  g.alpha(0.75, () => g.ellipse(x - r * 0.35, y - r * 0.42, r * 0.32, r * 0.18, '#fff', -0.6))
}

/** A footballer token: a chunky lipped disc in the team colour with a face that watches the ball. */
function drawPlayer(
  g: Draw,
  p: Disc,
  side: Side,
  pop: number,
  cool: number,
  ball: Disc,
  mood: 'happy' | 'grin' | 'sad' | 'wow',
  ready: boolean,
): void {
  const col = SIDE[side].main
  const r = p.r * pop
  g.shadow(p.x + 8, p.y + 18, r * 1.02, r * 0.9, 0.38)
  // Cooldown: a dim track filling back up, then a soft ready glow.
  if (cool > 0) {
    const k = 1 - clamp(cool / COOLDOWN, 0, 1)
    g.ring(p.x, p.y, r + 15, alpha('#000000', 0.3), 9)
    g.arc(p.x, p.y, r + 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k, alpha(C.white, 0.9), 9)
  } else if (ready) {
    const pulse = 0.5 + 0.5 * Math.sin(g.t * 4 + p.x * 0.01)
    g.ring(p.x, p.y, r + 12 + pulse * 4, alpha(SIDE[side].light, 0.25 + pulse * 0.2), 6)
  }
  g.circle(p.x, p.y + r * 0.16, r, shade(col, -0.45))
  g.circle(
    p.x,
    p.y,
    r,
    g.rad(
      p.x,
      p.y,
      r * 0.1,
      r,
      [
        [0, shade(col, 0.28)],
        [0.8, col],
        [1, shade(col, -0.15)],
      ],
      p.x - r * 0.3,
      p.y - r * 0.35,
    ),
  )
  g.ring(p.x, p.y, r * 0.84, alpha('#ffffff', 0.85), r * 0.09)
  // The face, upright for its player, eyes on the ball.
  const flip = g.orient(side)
  let lx = clamp((ball.x - p.x) / 300, -1, 1)
  let ly = clamp((ball.y - p.y) / 300, -1, 1)
  if (Math.abs(flip) > 1) {
    lx = -lx
    ly = -ly
  }
  g.at(p.x, p.y, flip, () => {
    g.blob(0, 2, r * 0.6, shade(col, 0.08), { look: [lx, ly], mood, cheeks: true })
    g.sideMark(side, 0, -r * 0.47, r * 0.1, alpha('#ffffff', 0.9))
  })
}

/** The slingshot preview of a drag: a band pulled back and an arrow where the disc will go. */
function drawAim(g: Draw, p: Disc, side: Side, a: { dx: number; dy: number; power: number }): void {
  const back = 40 + a.power * 150
  const len = 140 + a.power * 380
  const bx = p.x - a.dx * (p.r + back)
  const by = p.y - a.dy * (p.r + back)
  g.line(p.x - a.dx * p.r, p.y - a.dy * p.r, bx, by, alpha(SIDE[side].light, 0.85), 10)
  g.circle(bx, by, 16, SIDE[side].light)
  g.ring(p.x, p.y, p.r + 18, alpha(C.yellow, 0.9), 7)
  const sx = p.x + a.dx * (p.r + 20)
  const sy = p.y + a.dy * (p.r + 20)
  const ex = p.x + a.dx * (p.r + len)
  const ey = p.y + a.dy * (p.r + len)
  g.dashed(sx, sy, ex, ey, alpha(C.yellow, 0.85), 10, [22, 14])
  const ang = Math.atan2(a.dy, a.dx)
  g.at(ex, ey, ang, () => g.poly([22, 0, -16, -20, -16, 20], C.yellow))
}

function scoreboard(g: Draw, w: World, side: Side, look: Look): void {
  const y = hudY(g, side)
  const col = SIDE[side]
  namePill(g, side, look.names[side], { x: fx(side, 470) })
  const pulse = look.pulse[side]
  g.forSide(side, fx(side, 112), y, () => {
    const s = 1 + pulse * 0.25
    g.rrect(-60 * s, -48 * s, 120 * s, 96 * s, 24, alpha(C.ink, 0.85))
    g.rrect(-60 * s, -48 * s, 120 * s, 96 * s, 24, undefined, alpha(col.main, 0.7 + pulse * 0.3), 5)
    g.text(w.score[side], 0, 4, { size: 70 * s, weight: 700, color: C.white, drop: col.dark })
  })
  // Match clock on the right of each player's row.
  const sec = Math.max(0, Math.ceil(w.left))
  const golden = w.golden
  const label = golden
    ? 'Golden goal'
    : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  const hot = golden || sec <= 10
  g.forSide(side, fx(side, 836), y, () => {
    const beat = hot && w.phase === 'play' ? 1 + 0.06 * Math.max(0, Math.sin(g.t * 10)) : 1
    const wd = Math.max(170, g.measure(label, 38, 700) + 56) * beat
    g.rrect(-wd / 2, -36 * beat, wd, 72 * beat, 36 * beat, golden ? C.yellow : alpha(C.ink, 0.85))
    if (!golden)
      g.rrect(
        -wd / 2,
        -36 * beat,
        wd,
        72 * beat,
        36 * beat,
        undefined,
        alpha(hot ? C.yellow : C.white, 0.35),
        4,
      )
    g.text(label, 0, 3, {
      size: 38 * beat,
      weight: 700,
      color: golden ? C.ink : hot ? C.yellow : C.white,
    })
  })
}

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
    g.text('CHAMPIONS!', 0, 130, {
      size: 70 * s,
      weight: 700,
      color: C.yellow,
      stroke: alpha(C.ink, 0.9),
      strokeWidth: 14,
    })
  })
}

export function render(g: Draw, w: World, look: Look): void {
  arena(g)
  drawPitch(g)
  for (const side of [0, 1] as Side[]) {
    const r = look.goal && look.goal.side === side ? { x: look.goal.x, e: look.goal.e } : null
    drawGoal(g, side, r)
  }
  const ball = look.ball
  const mood = (side: Side): 'happy' | 'grin' | 'sad' => {
    if (look.winner !== null) return look.winner === side ? 'grin' : 'sad'
    if (w.phase === 'goal' && look.goal) return look.goal.side === side ? 'sad' : 'grin'
    return 'happy'
  }
  // Aims under everything so the arrow never hides a disc.
  w.aims.forEach((a, i) => {
    const p = look.players[i]
    if (a && p) drawAim(g, p, (i >> 1) as Side, a)
  })
  // Ball trail and the ball itself (it sits on the grass, under the discs).
  const sp = Math.hypot(ball.vx, ball.vy)
  for (let i = 0; i < look.trail.length; i++) {
    const t = look.trail[i]
    if (!t) continue
    const k = (i + 1) / (look.trail.length + 1)
    g.alpha(k * 0.3, () =>
      g.circle(t.x, t.y, BALL_R * (0.5 + 0.5 * k), sp > 1800 ? C.yellow : C.white),
    )
  }
  if (w.phase !== 'goal' || (look.goal && look.goal.e < 0.5)) {
    g.shadow(ball.x + 8, ball.y + 16, BALL_R * 0.95, BALL_R * 0.6, 0.4)
    football(g, ball.x, ball.y, BALL_R, (ball.x * 0.6 + ball.y) / BALL_R)
  }
  const order = [0, 1, 2, 3].sort((a, b) => (look.players[a]?.y ?? 0) - (look.players[b]?.y ?? 0))
  for (const i of order) {
    const p = look.players[i]
    if (!p) continue
    const side = (i >> 1) as Side
    const cool = w.cool[i] ?? 0
    drawPlayer(
      g,
      p,
      side,
      look.pop[i] ?? 1,
      cool,
      ball,
      cool > COOLDOWN * 0.6 ? 'wow' : mood(side),
      !look.bots[side] && w.phase === 'play',
    )
  }
  // Calls in the middle: goal, kick-off, golden goal, full time.
  if (w.phase === 'goal' && look.goal) {
    const e = GOAL_PAUSE - w.pause
    const s = outBack(prog(e, 0, 0.3))
    const late = e > GOAL_PAUSE - 0.55
    banner(g, undefined, late ? 'Kick-off!' : 'GOAL!', MID, {
      size: (late ? 56 : 92) * (late ? 1 : s),
      color: late ? C.white : SIDE[look.goal.side].light,
      gap: 90,
    })
  } else if (w.phase === 'end' && look.ended >= 0) {
    if (look.ended < 1.1)
      banner(g, undefined, w.golden ? 'GOLDEN GOAL!' : 'FULL TIME', MID, {
        size: 70 * outBack(prog(look.ended, 0, 0.3)),
        color: C.yellow,
        gap: 80,
      })
  } else if (w.golden && w.stall < 1.6) {
    banner(g, undefined, 'Golden goal!', MID, {
      size: 60 * outBack(prog(w.stall, 0, 0.3)),
      color: C.yellow,
      alpha: 1 - prog(w.stall, 1.2, 1.6),
      gap: 80,
    })
  }
  for (const side of [0, 1] as Side[]) scoreboard(g, w, side, look)
  if (look.ended >= 1 && look.winner !== null) victory(g, look.winner, look.ended - 1)
}
