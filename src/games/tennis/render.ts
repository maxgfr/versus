import type { Side } from '../../core/game.ts'
import { outBack, prog } from '../../core/fx/ease.ts'
import { banner, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import type { Disc } from '../../engines/puck/index.ts'
import { BLOB_R, COURT, REACH, type Reason, SWING_T, type Ball, type World } from './rules.ts'

export interface Mark {
  x: number
  y: number
  /** Game time it was made. */
  t: number
  out: boolean
}

export interface Look {
  ball: Ball
  /** Recent ball positions when it flies fast, oldest first. */
  trail: { x: number; y: number; z: number }[]
  /** Seam angle (rolls with the ball's travel). */
  roll: number
  /** Ball squash spring (1 = round). */
  ballSquash: number
  blobs: [Disc, Disc]
  squash: number[]
  pulse: [number, number]
  names: [string, string]
  bots: [boolean, boolean]
  target: number
  /** Game time now, for marks and calls stamped in state. */
  now: number
  marks: Mark[]
  /** The last call (out, net…) and when it was made. */
  call: { reason: Reason; side: Side; x: number; y: number; t: number } | null
  /** Seconds since the match was decided, or -1. */
  ended: number
  winner: Side | null
}

const PALETTE = {
  clay: {
    court: '#c8602f',
    band: '#bb5729',
    run: '#8d3f1f',
    stands: '#2a130c',
    line: '#fff4e4',
    dust: '#e8a070',
  },
  grass: {
    court: '#3f9c4e',
    band: '#378d45',
    run: '#25683a',
    stands: '#0d2416',
    line: '#f5fff1',
    dust: '#bff0b0',
  },
}

const BAND_T = 128
const BAND_B = 1672
/** Service lines sit this far either side of the net. */
const SERVICE = 360

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const fx = (side: Side, x: number): number => (side === 0 ? x : W - x)

/** Night stadium: dark stands, each player's end in their colour, floodlit court. */
function arena(g: Draw, surface: 'clay' | 'grass'): void {
  const pal = PALETTE[surface]
  const v = g.stage.view
  g.fillView(
    g.lin(0, v.y, 0, v.y + v.h, [
      [0, shade(C.blue, -0.8)],
      [0.5, pal.stands],
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
        [0, shade(col, side === 1 ? -0.52 : -0.7)],
        [1, shade(col, side === 1 ? -0.7 : -0.52)],
      ]),
    )
    g.rect(v.x - 2, side === 1 ? BAND_T - 5 : BAND_B, v.w + 4, 5, alpha(col, 0.6))
  }
}

function drawCourt(g: Draw, surface: 'clay' | 'grass'): void {
  const pal = PALETTE[surface]
  const cw = COURT.x1 - COURT.x0
  const ch = COURT.y1 - COURT.y0
  // Run-off apron around the lines, with a lip.
  const ax0 = COURT.x0 - 90
  const ay0 = BAND_T + 26
  const aw = cw + 180
  const ah = BAND_B - BAND_T - 52
  g.rrect(ax0, ay0 + 12, aw, ah, 40, shade(pal.run, -0.45))
  g.rrect(ax0, ay0, aw, ah, 40, pal.run)
  g.rrect(COURT.x0, COURT.y0, cw, ch, 6, pal.court)
  g.clip(COURT.x0, COURT.y0, cw, ch, 6, () => {
    // Mowing or raking stripes.
    for (let y = COURT.y0, i = 0; y < COURT.y1; y += 142, i++) {
      if (i % 2 === 1) g.rect(COURT.x0, y, cw, 142, pal.band)
    }
    // Each end glows in the colour of the player who defends it.
    g.rect(
      COURT.x0,
      COURT.y0,
      cw,
      ch,
      g.lin(0, COURT.y0, 0, COURT.y1, [
        [0, alpha(SIDE[1].main, 0.14)],
        [0.28, alpha(SIDE[1].main, 0)],
        [0.72, alpha(SIDE[0].main, 0)],
        [1, alpha(SIDE[0].main, 0.16)],
      ]),
    )
  })
  // Four floodlight pools over the whole court.
  g.clip(ax0, ay0, aw, ah, 40, () => {
    for (const [lx, ly] of [
      [COURT.x0, COURT.y0 + 260],
      [COURT.x1, COURT.y0 + 260],
      [COURT.x0, COURT.y1 - 260],
      [COURT.x1, COURT.y1 - 260],
    ] as const) {
      g.fillView(
        g.rad(lx, ly, 20, 620, [
          [0, alpha('#ffffff', 0.1)],
          [1, alpha('#ffffff', 0)],
        ]),
      )
    }
  })
  const line = alpha(pal.line, 0.95)
  const lw = 10
  g.rrect(COURT.x0 + 5, COURT.y0 + 5, cw - 10, ch - 10, 3, undefined, line, lw)
  g.line(COURT.x0 + 5, MID - SERVICE, COURT.x1 - 5, MID - SERVICE, line, lw, 'butt')
  g.line(COURT.x0 + 5, MID + SERVICE, COURT.x1 - 5, MID + SERVICE, line, lw, 'butt')
  g.line(W / 2, MID - SERVICE, W / 2, MID + SERVICE, line, lw, 'butt')
  // Centre marks on the baselines.
  g.line(W / 2, COURT.y0 + 5, W / 2, COURT.y0 + 34, line, lw, 'butt')
  g.line(W / 2, COURT.y1 - 34, W / 2, COURT.y1 - 5, line, lw, 'butt')
}

/** The net: shadow on the court, mesh, white tape, centre strap and two posts. */
function drawNet(g: Draw): void {
  const x0 = COURT.x0 - 40
  const x1 = COURT.x1 + 40
  g.rect(x0, MID + 4, x1 - x0, 30, alpha('#000000', 0.22))
  g.rect(x0, MID - 18, x1 - x0, 30, alpha(C.ink, 0.6))
  g.alpha(0.4, () => {
    for (let x = x0 + 8; x < x1; x += 14) g.rect(x, MID - 18, 2, 30, '#ffffff')
    for (let y = MID - 12; y < MID + 12; y += 10) g.rect(x0, y, x1 - x0, 2, '#ffffff')
  })
  g.rrect(x0, MID - 24, x1 - x0, 12, 5, '#ffffff')
  g.rect(W / 2 - 6, MID - 24, 12, 36, alpha('#ffffff', 0.9))
  for (const x of [x0, x1]) {
    g.circle(x, MID + 6, 15, shade(C.ink4, -0.3))
    g.circle(x, MID, 15, '#e8e4dc')
    g.circle(x - 4, MID - 4, 5, alpha('#ffffff', 0.8))
  }
}

/**
 * Racket in world space: it points toward the net with the side's forehand
 * offset; `q` runs 0 at contact to 1 at rest, sweeping the head across.
 */
function drawRacket(g: Draw, p: Disc, side: Side, q: number, wind: number): void {
  const fwd = side === 0 ? 0 : Math.PI
  // Contact, follow-through across the body, then back to the ready position,
  // drawn further back (the wind-up) as a playable ball closes in.
  const a = q < 0.35 ? -0.1 - 1.3 * (q / 0.35) : -1.4 + (2.3 + wind * 0.7) * ((q - 0.35) / 0.65)
  g.at(p.x, p.y, fwd + a, () => {
    if (q < 0.35)
      g.alpha(0.55 * (1 - q / 0.35), () =>
        g.arc(0, 0, BLOB_R + 104, -Math.PI / 2, -Math.PI / 2 + (-0.1 - a), '#ffffff', 30),
      )
    const s = -BLOB_R * 0.75
    g.line(0, s, 0, s - 54, shade(C.woodDark, -0.2), 16)
    g.line(0, s, 0, s - 30, SIDE[side].dark, 16)
    const hy = s - 54 - 50
    g.ellipse(0, hy + 6, 44, 56, alpha('#000000', 0.25))
    g.ellipse(0, hy, 42, 54, alpha(C.white, 0.18))
    g.alpha(0.35, () => {
      for (let x = -30; x <= 30; x += 12) g.line(x, hy - 46, x, hy + 46, '#ffffff', 2)
      for (let y = -40; y <= 40; y += 12) g.line(-36, hy + y, 36, hy + y, '#ffffff', 2)
    })
    g.path((c) => c.ellipse(0, hy, 42, 54, 0, 0, Math.PI * 2), undefined, SIDE[side].main, 10)
    g.path((c) => c.ellipse(0, hy, 42, 54, 0, 0, Math.PI * 2), undefined, alpha('#ffffff', 0.4), 3)
  })
}

function drawBlob(
  g: Draw,
  p: Disc,
  side: Side,
  squash: number,
  swing: number,
  ball: Ball,
  mood: 'happy' | 'wow' | 'grin' | 'sad',
  wind: number,
): void {
  const flip = g.orient(side)
  const q = 1 - clamp(swing / SWING_T, 0, 1)
  // Running bob from the blob's speed.
  const sp = Math.hypot(p.vx, p.vy)
  const run = clamp(sp / 900, 0, 1)
  const bob = Math.abs(Math.sin(g.t * 16)) * run
  let lx = clamp((ball.x - p.x) / REACH, -1, 1) * 0.7
  let ly = clamp((ball.y - p.y) / REACH, -1, 1) * 0.7
  if (Math.abs(flip) > 1) {
    lx = -lx
    ly = -ly
  }
  g.shadow(p.x + 8, p.y + BLOB_R * 0.85, BLOB_R * (0.95 - bob * 0.1), BLOB_R * 0.4, 0.38)
  drawRacket(g, p, side, q, wind)
  g.at(p.x, p.y - bob * 12 * (Math.abs(flip) > 1 ? -1 : 1), flip, () => {
    g.blob(0, 0, BLOB_R, SIDE[side].main, {
      look: [lx, ly],
      mood: swing > 0 ? 'wow' : mood,
      outline: true,
      sx: squash * (1 + bob * 0.05),
      sy: (2 - squash) * (1 - bob * 0.05),
    })
    g.sideMark(side, 0, -BLOB_R * 0.66, BLOB_R * 0.12, alpha(C.white, 0.9))
  })
}

/** Ball with pseudo height: it grows as it rises and its shadow slides away. */
function drawBall(g: Draw, b: Ball, held: boolean, roll = 0, squash = 1): void {
  const lift = Math.max(0, b.z)
  const k = 1 + lift / 360
  const sh = Math.max(0.25, 1 - lift / 500)
  g.alpha(0.45 * sh, () =>
    g.ellipse(b.x + lift * 0.3, b.y + lift * 0.45, 22 * sh, 15 * sh, '#000000'),
  )
  const r = 21 * k
  if (!held && lift > 30)
    g.alpha(0.18, () => g.line(b.x, b.y, b.x + lift * 0.3, b.y + lift * 0.45, '#000000', 3))
  // Squashed along its travel on a bounce or a hit.
  const dir = Math.atan2(b.vy, b.vx)
  const sq = clamp(squash, 0.6, 1.4)
  g.at(
    b.x,
    b.y,
    dir,
    () => {
      g.ball(0, 0, r, '#dcf542', 1)
      // The seams turn as it rolls.
      g.at(0, 0, roll, () => {
        g.arc(-r * 0.95, 0, r * 0.75, -0.9, 0.9, alpha('#ffffff', 0.85), r * 0.14)
        g.arc(r * 0.95, 0, r * 0.75, Math.PI - 0.9, Math.PI + 0.9, alpha('#ffffff', 0.85), r * 0.14)
      })
    },
    sq,
    2 - sq,
  )
}

/** Fading fuzz behind a fast ball. */
function drawTrail(g: Draw, trail: Look['trail']): void {
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i]
    if (!t) continue
    const k = (i + 1) / (trail.length + 1)
    g.alpha(k * 0.35, () => g.circle(t.x, t.y, 21 * (1 + t.z / 360) * (0.45 + 0.5 * k), '#dcf542'))
  }
}

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
  const atPoint = score + 1 >= look.target && look.ended < 0
  g.forSide(side, fx(side, 850), y, () => {
    if (atPoint) {
      const pulseY = 0.85 + 0.15 * Math.sin(g.t * 5)
      const wd = g.measure('Match point', 34, 700) + 36
      g.alpha(pulseY, () => g.rrect(-wd / 2, -26, wd, 52, 26, C.yellow))
      g.text('Match point', 0, 2, { size: 34, weight: 700, color: C.ink })
      return
    }
    const n = Math.min(look.target, 11)
    const gap = Math.min(34, 290 / Math.max(1, n - 1))
    const x0 = -((n - 1) * gap) / 2
    // Past 11 points each pip stands for a share of the target, so the row
    // fills at the end of the match instead of halfway through.
    const lit = Math.floor((score * n) / look.target)
    for (let i = 0; i < n; i++) {
      const on = i < lit
      g.circle(x0 + i * gap, 0, 11, on ? col.main : alpha(C.white, 0.14))
      if (on) g.circle(x0 + i * gap - 3, -3, 4, alpha(C.white, 0.6))
    }
  })
}

const CALL: Record<Reason, string> = {
  out: 'OUT',
  short: 'SHORT',
  net: 'NET',
  double: 'TWO BOUNCES',
  ace: 'ACE!',
}

/** The umpire's call, popped at the spot for a moment after a point. */
function drawCall(g: Draw, call: NonNullable<Look['call']>, now: number): void {
  const e = now - call.t
  if (e > 1.2) return
  const s = outBack(prog(e, 0, 0.25))
  const a = 1 - prog(e, 0.9, 1.2)
  const x = clamp(call.x, 230, W - 230)
  const y = clamp(call.y, BAND_T + 90, BAND_B - 90)
  const my = clamp(call.y, BAND_T + 40, BAND_B - 40)
  if (call.reason === 'out' || call.reason === 'short') {
    g.alpha(a, () => {
      g.ring(call.x, my, 30 + e * 20, alpha(C.yellow, 0.9), 6)
      g.line(call.x - 18, my - 18, call.x + 18, my + 18, C.yellow, 7)
      g.line(call.x - 18, my + 18, call.x + 18, my - 18, C.yellow, 7)
    })
  }
  const loser: Side = call.side === 0 ? 1 : 0
  const ty =
    call.reason === 'net' ? (loser === 0 ? MID + 130 : MID - 130) : y + (y > MID ? -90 : 90)
  g.alpha(a, () =>
    g.forSide(loser, x, ty, () => {
      const label = CALL[call.reason]
      const wd = g.measure(label, 50 * s, 700) + 50
      g.rrect(-wd / 2, -38 * s, wd, 76 * s, 38 * s, C.ink)
      g.rrect(-wd / 2, -38 * s, wd, 76 * s, 38 * s, undefined, C.yellow, 5)
      g.text(label, 0, 3, { size: 50 * s, weight: 700, color: C.yellow })
    }),
  )
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
    g.text('GAME, SET!', 0, 130, {
      size: 70 * s,
      weight: 700,
      color: C.yellow,
      stroke: alpha(C.ink, 0.9),
      strokeWidth: 14,
    })
  })
}

export function render(g: Draw, w: World, look: Look): void {
  const pal = PALETTE[w.surface]
  arena(g, w.surface)
  drawCourt(g, w.surface)
  // Ball marks: clay keeps them, grass only flashes them.
  for (const m of look.marks) {
    const age = look.now - m.t
    const life = w.surface === 'clay' ? 4 : 0.8
    if (age > life) continue
    const a = 1 - age / life
    g.alpha(a * (m.out ? 0.75 : 0.45), () =>
      g.ellipse(m.x, m.y, 20, 13, shade(pal.run, w.surface === 'clay' ? -0.25 : 0.4)),
    )
  }
  // Blob on the far half first, then the net, then the near blob (from the viewer).
  const flipped = Math.abs(g.orient()) > 1
  const far: Side = flipped ? 0 : 1
  const near: Side = far === 0 ? 1 : 0
  const ball = look.ball
  const held = w.phase === 'serve'
  const mood = (side: Side): 'happy' | 'grin' | 'sad' => {
    if (look.winner !== null) return look.winner === side ? 'grin' : 'sad'
    if (look.call && look.now - look.call.t < 1.2) return look.call.side === side ? 'grin' : 'sad'
    return 'happy'
  }
  const ballSide: Side = ball.y < MID ? 1 : 0
  const drawB = () => {
    if (w.phase === 'point') return
    // Held: the ball sits in the server's hand (the rules keep it there), then rises with the toss.
    if (!held) drawTrail(g, look.trail)
    drawBall(g, ball, held, look.roll, look.ballSquash)
  }
  // Wind-up: the racket draws back as a ball this side can play closes in.
  const wind = (side: Side): number => {
    if (w.phase !== 'play' || w.hitter === side || w.swing[side] > 0) return 0
    const p = look.blobs[side]
    const d = Math.hypot(ball.x - p.x, ball.y - p.y)
    return clamp(1 - (d - REACH) / 420, 0, 1)
  }
  const blob = (side: Side) =>
    drawBlob(
      g,
      look.blobs[side],
      side,
      look.squash[side] ?? 1,
      w.swing[side],
      ball,
      mood(side),
      wind(side),
    )
  blob(far)
  if (ballSide === far) drawB()
  drawNet(g)
  if (ballSide === near) drawB()
  blob(near)
  // A ball above the near blob still reads on top of it.
  if (ballSide === near && ball.z > 40 && w.phase === 'play')
    drawBall(g, ball, false, look.roll, look.ballSquash)
  if (w.phase === 'serve' && w.toss < 0 && look.ended < 0) {
    const s = w.server
    // Online, each phone shows only its own player's prompt.
    if (!look.bots[s] && (g.viewer === null || g.viewer === s))
      banner(g, s, 'Tap to serve', s === 0 ? MID + 200 : MID - 200, { size: 52 })
    const p = look.blobs[s]
    const pulse = 0.5 + 0.5 * Math.sin(g.t * 6)
    g.ring(p.x, p.y, BLOB_R + 26 + pulse * 10, alpha(C.yellow, 0.45 + pulse * 0.45), 7)
  }
  if (look.call) drawCall(g, look.call, look.now)
  for (const side of [0, 1] as Side[]) scoreboard(g, w, side, look)
  if (look.ended >= 0 && look.winner !== null) victory(g, look.winner, look.ended)
}
