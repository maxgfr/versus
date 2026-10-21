import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import { banner, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import {
  type Ball,
  GOAL,
  INTRO_T,
  KEEPER_Y,
  keeperOf,
  LINE,
  PITCH,
  REACH_DIVE,
  RESULT_T,
  SPOT,
  type World,
} from './rules.ts'

export type Outcome = 'goal' | 'save' | 'miss'

export interface Look {
  ball: Ball
  squash: number[]
  /** 0..1 pulse for each side's score figure. */
  pulse: [number, number]
  names: [string, string]
  bots: [boolean, boolean]
  /** Kicks each side takes before sudden death. */
  rounds: number
  /** Each side's kicks so far. */
  log: [Outcome[], Outcome[]]
  /** Preview of the aimed flight, when someone is swiping. */
  trail: { x: number; y: number }[] | null
  /** Seconds since the kick, or -1 before it. */
  kicked: number
  /** Seconds since the shootout was decided, or -1. */
  ended: number
  winner: Side | null
}

const KEEPER_R = 60
const BALL_R = 30
const NET_D = 66
const BAND_T = 118
const BAND_B = 1682
const GRASS = '#2f8c48'
const GRASS_DARK = '#287a3e'

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
const fx = (side: Side, x: number): number => (side === 0 ? x : W - x)
/** Toward a side's own edge (+1 down for red, -1 up for blue). */
const out = (side: Side): number => (side === 0 ? 1 : -1)

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
        [0, shade(col, side === 1 ? -0.52 : -0.7)],
        [1, shade(col, side === 1 ? -0.7 : -0.52)],
      ]),
    )
    g.rect(v.x - 2, side === 1 ? BAND_T - 5 : BAND_B, v.w + 4, 5, alpha(col, 0.6))
  }
}

/** Striped night pitch with floodlight pools, both penalty areas and the spots. */
function drawPitch(g: Draw, live: Side): void {
  const pw = PITCH.x1 - PITCH.x0
  const ph = PITCH.y1 - PITCH.y0
  g.rrect(PITCH.x0 - 20, PITCH.y0 - 6, pw + 40, ph + 24, 34, shade(GRASS, -0.6))
  g.rrect(PITCH.x0 - 20, PITCH.y0 - 12, pw + 40, ph + 24, 34, shade(GRASS, -0.45))
  g.rrect(PITCH.x0, PITCH.y0, pw, ph, 22, GRASS)
  g.clip(PITCH.x0, PITCH.y0, pw, ph, 22, () => {
    for (let y = MID - 64, i = 0; y > PITCH.y0 - 128; y -= 128, i++)
      if (i % 2 === 0) g.rect(PITCH.x0, y, pw, 128, GRASS_DARK)
    for (let y = MID + 64, i = 1; y < PITCH.y1; y += 128, i++)
      if (i % 2 === 0) g.rect(PITCH.x0, y, pw, 128, GRASS_DARK)
    // Floodlights: a soft pool on the middle and a hot one on the live goal.
    g.fillView(
      g.rad(W / 2, MID, 60, 900, [
        [0, alpha('#ffffff', 0.09)],
        [1, alpha('#ffffff', 0)],
      ]),
    )
    const gy = LINE[live]
    g.fillView(
      g.rad(W / 2, gy, 40, 640, [
        [0, alpha('#fff6d8', 0.2)],
        [1, alpha('#fff6d8', 0)],
      ]),
    )
    // Each end glows in the colour of its keeper.
    g.rect(
      PITCH.x0,
      PITCH.y0,
      pw,
      ph,
      g.lin(0, PITCH.y0, 0, PITCH.y1, [
        [0, alpha(SIDE[1].main, 0.22)],
        [0.25, alpha(SIDE[1].main, 0)],
        [0.75, alpha(SIDE[0].main, 0)],
        [1, alpha(SIDE[0].main, 0.22)],
      ]),
    )
  })
  const line = alpha('#ffffff', 0.85)
  const lw = 8
  g.line(PITCH.x0 + 20, MID, PITCH.x1 - 20, MID, line, lw)
  g.ring(W / 2, MID, 140, line, lw)
  g.circle(W / 2, MID, 9, line)
  for (const side of [0, 1] as Side[]) {
    const ly = LINE[side]
    const d = -out(side)
    // Goal line across the pitch, penalty area, goal area, the spot and the arc.
    g.line(PITCH.x0 + 20, ly, PITCH.x1 - 20, ly, line, lw)
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
    box(720, 400)
    box(360, 130)
    // The shooting spot for kicks at this goal, with a chalk ring around it.
    const spot = SPOT[side === 0 ? 1 : 0]
    g.circle(spot.x, spot.y, 11, line)
    g.ring(spot.x, spot.y, 58, alpha('#ffffff', 0.22), 5)
  }
}

/** Net depth behind the line at x, bulged by a ripple around hx. */
function netBack(side: Side, x: number, hx: number, amp: number): number {
  const k = (x - hx) / 120
  return LINE[side] + out(side) * (NET_D + amp * Math.exp(-k * k))
}

/** A goal seen from above: netting behind the line, posts, crossbar; it ripples on a goal. */
function drawGoal(
  g: Draw,
  side: Side,
  ripple: { x: number; e: number } | null,
  live: boolean,
): void {
  const ly = LINE[side]
  const o = out(side)
  const e = ripple ? ripple.e : 9
  const amp = ripple ? 70 * Math.exp(-3.2 * e) * (0.55 + 0.45 * Math.cos(13 * e)) : 0
  const hx = ripple ? ripple.x : W / 2
  const xs: number[] = []
  for (let x = GOAL.x0; x <= GOAL.x1 + 0.5; x += 24) xs.push(x)
  // Netting floor.
  const pts: number[] = [GOAL.x0, ly]
  for (const x of xs) pts.push(x, netBack(side, x, hx, amp))
  pts.push(GOAL.x1, ly)
  g.poly(pts, alpha(C.ink, 0.6))
  const mesh = alpha('#ffffff', live ? 0.45 : 0.28)
  for (const x of xs) g.line(x, ly, x, netBack(side, x, hx, amp), mesh, 2, 'butt')
  for (let f = 0.25; f < 1.01; f += 0.25) {
    g.path(
      (c) => {
        xs.forEach((x, i) => {
          const y = ly + (netBack(side, x, hx, amp) - ly) * f
          if (i === 0) c.moveTo(x, y)
          else c.lineTo(x, y)
        })
      },
      undefined,
      mesh,
      2,
    )
  }
  // Frame: back stanchion, side bars, crossbar on the line and the posts.
  const by = ly + o * NET_D
  g.line(GOAL.x0, by, GOAL.x1, by, alpha('#ffffff', 0.55), 5)
  g.line(GOAL.x0, ly, GOAL.x0, by, alpha('#ffffff', 0.7), 6)
  g.line(GOAL.x1, ly, GOAL.x1, by, alpha('#ffffff', 0.7), 6)
  g.rrect(GOAL.x0 - 10, ly - 9 + 6, GOAL.x1 - GOAL.x0 + 20, 18, 9, alpha('#000000', 0.3))
  g.rrect(GOAL.x0 - 10, ly - 9, GOAL.x1 - GOAL.x0 + 20, 18, 9, '#f6f2ea')
  g.rrect(GOAL.x0, ly - 6, GOAL.x1 - GOAL.x0, 5, 3, alpha('#ffffff', 0.9))
  for (const px of [GOAL.x0, GOAL.x1]) {
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

/** A keeper glove: a padded palm with a cuff in the team colour. */
function glove(g: Draw, x: number, y: number, side: Side, angle: number): void {
  g.at(x, y, angle, () => {
    g.rrect(-16, 14, 32, 16, 6, SIDE[side].dark)
    g.ball(0, 0, 25, C.yellow, 0.8)
    g.rrect(-21, -26, 11, 20, 5, shade(C.yellow, -0.1))
    g.line(-8, -6, 8, -6, alpha('#000000', 0.18), 3)
  })
}

/** Gloved blob keeper: arms up when standing, stretched toward the dive, lying flat after. */
function drawKeeper(
  g: Draw,
  side: Side,
  x: number,
  k: { dive: number; diveT: number; lie: number },
  squash: number,
  ball: Ball,
  mood: 'happy' | 'grin' | 'sad' | 'wow' | 'dizzy',
): void {
  const y = KEEPER_Y[side]
  const flip = g.orient(side)
  const diving = k.diveT > 0
  const lying = !diving && k.lie > 0
  const dir = k.dive || 1
  const flipped = Math.abs(flip) > 1
  // Lean so the head (and the gloves above it) point along the dive, whichever way the body faces.
  const tilt = (flipped ? -1 : 1) * dir * (diving ? 1.0 : lying ? 1.4 : 0)
  const stretch = diving ? 1.2 : lying ? 1.08 : 1
  let lx = clamp((ball.x - x) / 220, -1, 1) * 0.8
  let ly = clamp((ball.y - y) / 300, -1, 1) * 0.8
  if (flipped) {
    lx = -lx
    ly = -ly
  }
  g.shadow(
    x + 6 + dir * (diving || lying ? 40 : 0),
    y + 50,
    KEEPER_R * 1.25 * stretch,
    KEEPER_R * 0.42,
    0.35,
  )
  // Reach ring on the line while a dive is on.
  if (diving)
    g.alpha(0.35, () => g.ring(x + dir * 40, LINE[side], REACH_DIVE, alpha(C.yellow, 0.7), 5))
  // Gloves in the body frame: out to the sides when set, stretched over the head in a dive.
  const gl: [number, number, number][] =
    diving || lying
      ? [
          [-20, -116, -0.2],
          [24, -102, 0.25],
        ]
      : [
          [-88, -16, -0.4],
          [88, -16, 0.4],
        ]
  g.at(x, y, tilt + flip, () => {
    if (diving)
      g.alpha(0.5, () => {
        g.line(-50, 40, -70, 110, alpha('#ffffff', 0.7), 6)
        g.line(0, 50, 0, 125, alpha('#ffffff', 0.7), 6)
        g.line(50, 40, 70, 110, alpha('#ffffff', 0.7), 6)
      })
    for (const [gx, gy, ga] of gl) glove(g, gx, gy, side, ga)
    g.blob(0, 0, KEEPER_R, SIDE[side].main, {
      look: [lx, ly],
      mood: lying ? 'dizzy' : diving ? 'wow' : mood,
      outline: true,
      sx: squash / stretch,
      sy: (2 - squash) * stretch,
    })
  })
  g.at(x, y, tilt + flip, () =>
    g.sideMark(side, 0, -KEEPER_R * 0.66, KEEPER_R * 0.12, alpha('#ffffff', 0.9)),
  )
}

/** The shooter stands behind the ball and lunges into it on the kick. */
function drawShooter(
  g: Draw,
  side: Side,
  ball: Ball,
  squash: number,
  kicked: number,
  mood: 'happy' | 'grin' | 'sad' | 'wow',
): void {
  const s = SPOT[side]
  const run = kicked < 0 ? 0 : kicked < 0.12 ? outCubic(kicked / 0.12) : 1 - prog(kicked, 0.3, 0.8)
  const y = s.y + out(side) * (150 - run * 80)
  const flip = g.orient(side)
  let lx = clamp((ball.x - s.x) / 200, -1, 1) * 0.5
  let ly = -out(side) * 0.9
  if (Math.abs(flip) > 1) {
    lx = -lx
    ly = -ly
  }
  g.shadow(s.x + 6, y + 52, KEEPER_R * 1.1, KEEPER_R * 0.4, 0.32)
  g.at(s.x, y, flip, () => {
    g.blob(0, 0, KEEPER_R, SIDE[side].main, {
      look: [lx, ly],
      mood: kicked >= 0 && kicked < 0.4 ? 'wow' : mood,
      outline: true,
      sx: squash,
      sy: 2 - squash,
    })
    g.sideMark(side, 0, -KEEPER_R * 0.66, KEEPER_R * 0.12, alpha('#ffffff', 0.9))
  })
}

/** Where to draw the ball: in flight as simulated, then into the net, off the gloves or away wide. */
function ballPos(w: World, b: Ball): { x: number; y: number; scale: number; a: number } {
  const shooter = w.shooter
  const keeper = keeperOf(shooter)
  const spot = SPOT[shooter]
  if (w.phase === 'shot') {
    // A lofted kick rises mid-flight: drawn a little larger.
    const p = clamp(Math.abs(b.y - spot.y) / Math.abs(LINE[keeper] - spot.y), 0, 1)
    const sp = Math.hypot(b.vx, b.vy)
    return { x: b.x, y: b.y, scale: 1 + Math.sin(Math.PI * p) * (0.15 + sp / 9000), a: 1 }
  }
  if (w.phase === 'result' || w.phase === 'over') {
    const e = w.phase === 'result' ? RESULT_T - w.timer : RESULT_T
    const o = out(keeper)
    if (w.outcome === 'goal') return { x: b.x, y: b.y + o * Math.min(46, e * 420), scale: 1, a: 1 }
    if (w.outcome === 'save') {
      const t = Math.min(e, 0.6)
      const away = (b.x < W / 2 ? -1 : 1) * 260 * t
      return {
        x: b.x + away,
        y: b.y - o * (420 * t - 300 * t * t),
        scale: 1,
        a: 1 - prog(e, 0.9, 1.4),
      }
    }
    return { x: b.x, y: b.y + o * e * 700, scale: 1, a: 1 - prog(e, 0, 0.35) }
  }
  return { x: b.x, y: b.y, scale: 1, a: 1 }
}

function kickMarks(g: Draw, side: Side, log: Outcome[], rounds: number, y: number): void {
  const col = SIDE[side]
  const n = Math.max(rounds, log.length)
  const show = Math.min(n, 10)
  const start = n - show
  const gap = Math.min(46, 300 / Math.max(1, show - 1))
  const r = Math.min(16, gap * 0.42)
  g.forSide(side, fx(side, 840), y, () => {
    const x0 = -((show - 1) * gap) / 2
    for (let i = 0; i < show; i++) {
      const o = log[start + i]
      const cx = x0 + i * gap
      const sudden = start + i >= rounds
      if (!o) {
        g.ring(cx, 0, r, alpha(sudden ? C.yellow : C.white, 0.3), 4)
        continue
      }
      if (o === 'goal') {
        g.circle(cx, 0, r, col.main)
        g.line(cx - r * 0.45, 0, cx - r * 0.1, r * 0.38, '#ffffff', 5)
        g.line(cx - r * 0.1, r * 0.38, cx + r * 0.5, -r * 0.4, '#ffffff', 5)
      } else {
        g.circle(cx, 0, r, alpha(C.ink, 0.9))
        g.ring(cx, 0, r, alpha(col.main, 0.5), 3)
        g.line(cx - r * 0.4, -r * 0.4, cx + r * 0.4, r * 0.4, alpha('#ffffff', 0.6), 5)
        g.line(cx - r * 0.4, r * 0.4, cx + r * 0.4, -r * 0.4, alpha('#ffffff', 0.6), 5)
      }
    }
  })
}

function scoreboard(g: Draw, w: World, side: Side, look: Look): void {
  const y = hudY(g, side)
  const col = SIDE[side]
  const keeper = keeperOf(w.shooter)
  const shooting = side === w.shooter && (w.phase === 'intro' || w.phase === 'aim')
  const guarding = side === keeper && (w.phase === 'aim' || w.phase === 'shot')
  const acting = look.ended < 0 && (shooting || guarding)
  namePill(g, side, look.names[side], {
    active: acting,
    text: acting ? (shooting ? 'Shoot!' : 'Save it!') : undefined,
  })
  const pulse = look.pulse[side]
  g.forSide(side, fx(side, 112), y, () => {
    const s = 1 + pulse * 0.25
    g.rrect(-60 * s, -48 * s, 120 * s, 96 * s, 24, alpha(C.ink, 0.85))
    g.rrect(-60 * s, -48 * s, 120 * s, 96 * s, 24, undefined, alpha(col.main, 0.7 + pulse * 0.3), 5)
    g.text(w.score[side], 0, 4, { size: 70 * s, weight: 700, color: C.white, drop: col.dark })
  })
  kickMarks(g, side, look.log[side], look.rounds, y)
}

/** A ghost finger sweeping from the ball toward the goal, for a human shooter. */
function swipeHint(g: Draw, side: Side, ball: Ball): void {
  const t = (g.t % 1.4) / 1.4
  const k = outCubic(prog(t, 0.1, 0.7))
  const d = -out(side)
  const x = ball.x + 30 * k
  const y = ball.y + d * (40 + 330 * k)
  g.alpha(0.6 * (1 - prog(t, 0.75, 1)), () => {
    g.dashed(
      ball.x,
      ball.y + d * 40,
      ball.x + 34,
      ball.y + d * 400,
      alpha(C.yellow, 0.7),
      6,
      [16, 14],
    )
    g.emoji('👆', x + 20, y + 30 * -d, 70, side === 0 ? 0 : g.orient(side))
  })
}

function victory(g: Draw, side: Side, e: number): void {
  const p = prog(e, 0, 0.55)
  const s = outBack(p)
  const y = side === 0 ? MID + 360 : MID - 360
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
  const keeper = keeperOf(w.shooter)
  arena(g)
  drawPitch(g, keeper)
  const resultE = w.phase === 'result' ? RESULT_T - w.timer : 9
  for (const side of [0, 1] as Side[]) {
    const ripple = side === keeper && w.outcome === 'goal' ? { x: look.ball.x, e: resultE } : null
    drawGoal(g, side, ripple, side === keeper)
  }
  // Flight preview while the shooter swipes.
  if (look.trail) {
    look.trail.forEach((p, i) => {
      const k = (i + 1) / (look.trail?.length ?? 1)
      g.alpha(0.3 + k * 0.5, () => g.circle(p.x, p.y, 6 + k * 6, C.yellow))
    })
  }
  const mood = (side: Side, role: 'shooter' | 'keeper'): 'happy' | 'grin' | 'sad' => {
    if (look.winner !== null) return look.winner === side ? 'grin' : 'sad'
    if (w.phase !== 'result' || !w.outcome) return role === 'shooter' ? 'grin' : 'happy'
    const shooterWon = w.outcome === 'goal'
    return (role === 'shooter') === shooterWon ? 'grin' : 'sad'
  }
  const k = w.keepers[keeper]
  const bp = ballPos(w, look.ball)
  const spin = (look.ball.x * 0.6 + look.ball.y) / BALL_R
  const drawBall = () =>
    g.alpha(bp.a, () => {
      g.shadow(bp.x + 6, bp.y + 14, BALL_R * 0.95, BALL_R * 0.55, 0.4)
      football(g, bp.x, bp.y, BALL_R * bp.scale, spin)
    })
  // A ball already in the net sits under the keeper; otherwise it flies over everything.
  const inNet = w.outcome === 'goal'
  if (inNet) drawBall()
  drawShooter(
    g,
    w.shooter,
    look.ball,
    look.squash[w.shooter] ?? 1,
    look.kicked,
    mood(w.shooter, 'shooter'),
  )
  drawKeeper(g, keeper, k.x, k, look.squash[keeper] ?? 1, look.ball, mood(keeper, 'keeper'))
  if (!inNet) drawBall()
  // Hints and calls, upright for whoever acts.
  const humanShooter = !look.bots[w.shooter]
  if (w.phase === 'intro') {
    const e = INTRO_T - w.timer
    const s = outBack(prog(e, 0, 0.3))
    const sudden = w.done >= look.rounds * 2
    const n = (w.done >> 1) + 1
    const title = sudden ? 'Sudden death' : `Kick ${n} of ${look.rounds}`
    g.alpha(1 - prog(e, INTRO_T - 0.2, INTRO_T), () => {
      banner(g, undefined, title, MID, {
        size: 60 * s,
        color: sudden ? C.yellow : C.white,
        gap: 80,
      })
    })
  } else if (w.phase === 'aim') {
    const s = w.shooter
    if (humanShooter) {
      if (!look.trail) swipeHint(g, s, look.ball)
      banner(g, s, 'Swipe at the goal', SPOT[s].y + out(s) * 290, { size: 46 })
    }
    if (!look.bots[keeper])
      banner(g, keeper, 'Drag to move · flick to dive', MID + out(keeper) * 160, { size: 38 })
  } else if (w.phase === 'result' && w.outcome) {
    const e = resultE
    const s = outBack(prog(e, 0, 0.3))
    const text = w.outcome === 'goal' ? 'GOAL!' : w.outcome === 'save' ? 'SAVED!' : 'MISSED!'
    const col =
      w.outcome === 'goal'
        ? SIDE[w.shooter].light
        : w.outcome === 'save'
          ? SIDE[keeper].light
          : C.white
    g.alpha(1 - prog(e, RESULT_T - 0.25, RESULT_T), () =>
      banner(g, undefined, text, MID, { size: 84 * s, color: col, gap: 90 }),
    )
  }
  for (const side of [0, 1] as Side[]) scoreboard(g, w, side, look)
  if (look.ended >= 0 && look.winner !== null) victory(g, look.winner, look.ended)
}
