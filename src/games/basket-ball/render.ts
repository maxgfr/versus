import { frame, inFrame, textAngle } from '../../core/frame.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Side } from '../../core/game.ts'
import { banner, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import {
  aimPath,
  type Ball,
  BALL_R,
  BOARD_HALF,
  BOARD_OFF,
  BOARD_Z,
  HOOP_DIST,
  hoopAt,
  OVERTIME,
  RIM_H,
  RIM_R,
  ready,
  SWISH_R,
  swipeOK,
  type World,
} from './rules.ts'

/** Screen lift per unit of height: a 3/4 view, so the arc reads as an arc. */
const K = 0.36
const LINE = alpha(C.white, 0.55)
/** Hoop ground point and backboard ground line, in red's frame. */
const HY = MID + HOOP_DIST
const BY = HY - BOARD_OFF

/** A finger's swipe in world units: where it went down and where it is now. */
export interface Drag {
  x0: number
  y0: number
  x: number
  y: number
  /** Finger speed (world units/s): the flick's tempo. */
  v?: number
}

export interface Look {
  w: World
  /** Interpolated balls for this frame. */
  balls: Ball[]
  drag: [Drag | null, Drag | null]
  /** Each ball's squash (1 = round, < 1 = flattened, > 1 = stretched). */
  squash: [number, number]
  /** Recent flight positions (world), oldest first. */
  trail: [{ x: number; y: number; z: number }[], { x: number; y: number; z: number }[]]
  names: [string, string]
  target: number
  status: [string | undefined, string | undefined]
  /** Show the "swipe up" hint chevrons on a ready ball (humans, early on). */
  hint: [boolean, boolean]
  /** Score plate punch (0..1) after a basket. */
  pulse: [number, number]
  /** The decided match and how long ago (s), once it is. */
  end: { winner: Side | 'draw'; t: number } | null
}

/** Floor, sidelines, halfway line, and each half's team-coloured paint and three-point arc. */
function drawCourt(g: Draw): void {
  const x0 = 60
  const x1 = W - 60
  const y0 = 20
  const y1 = H - 20
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, shade(SIDE[1].main, -0.8)],
      [0.5, '#120d1d'],
      [1, shade(SIDE[0].main, -0.8)],
    ]),
  )
  g.shadow(W / 2, y1 + 10, (x1 - x0) * 0.55, 30, 0.5)
  g.rrect(x0 - 16, y0 - 16, x1 - x0 + 32, y1 - y0 + 32, 34, shade(C.woodDark, -0.5))
  g.rrect(
    x0,
    y0,
    x1 - x0,
    y1 - y0,
    24,
    g.lin(0, y0, 0, y1, [
      [0, shade(C.wood, -0.28)],
      [0.5, shade(C.wood, -0.04)],
      [1, shade(C.wood, -0.28)],
    ]),
  )
  g.clip(x0, y0, x1 - x0, y1 - y0, 24, () => {
    // Floor boards: long planks with staggered joints.
    for (let y = y0, i = 0; y < y1; y += 48, i++) {
      if (i % 2) g.rect(x0, y, x1 - x0, 48, alpha('#000000', 0.06))
      g.line(x0, y, x1, y, alpha('#000000', 0.08), 2)
      const off = (i * 263) % 400
      for (let x = x0 + off; x < x1; x += 400) g.line(x, y, x, y + 48, alpha('#000000', 0.1), 2)
    }
    // Each half warms toward its owner's colour.
    g.rect(
      x0,
      y0,
      x1 - x0,
      y1 - y0,
      g.lin(0, y0, 0, y1, [
        [0, alpha(SIDE[1].main, 0.34)],
        [0.4, alpha(SIDE[1].main, 0)],
        [0.6, alpha(SIDE[0].main, 0)],
        [1, alpha(SIDE[0].main, 0.34)],
      ]),
    )
    // Arena lights: a pool on each hoop.
    for (const side of [0, 1] as Side[]) {
      const h = hoopAt(side)
      g.fillView(
        g.rad(h.x, h.y, 30, 560, [
          [0, alpha('#ffffff', 0.16)],
          [1, alpha('#ffffff', 0)],
        ]),
      )
    }
  })
  g.rrect(x0 + 24, y0 + 24, x1 - x0 - 48, y1 - y0 - 48, 12, undefined, LINE, 7)
  g.line(x0 + 24, MID, x1 - 24, MID, LINE, 7)
  g.ring(W / 2, MID, 120, LINE, 7)
  for (const side of [0, 1] as Side[]) {
    const col = SIDE[side].main
    inFrame(g, side, () => {
      // Paint from the free-throw line to the baseline, filled in the team colour.
      g.rrect(330, HY + 40, 340, y1 - 24 - HY - 40, 4, alpha(col, 0.32))
      g.rrect(330, HY + 40, 340, y1 - 24 - HY - 40, 4, undefined, LINE, 7)
      g.arc(W / 2, HY + 40, 150, 0, Math.PI, LINE, 7)
      g.arc(W / 2, HY + 40, 150, Math.PI, Math.PI * 2, alpha(C.white, 0.25), 7)
      // Three-point arc around the hoop.
      g.arc(W / 2, HY, 380, 0.08, Math.PI - 0.08, LINE, 7)
    })
  }
}

/** Pole, backboard and the far half of the rim: everything the ball can pass in front of. */
function hoopBack(g: Draw, side: Side): void {
  const cx = W / 2
  const col = SIDE[side].main
  const rimY = HY - RIM_H * K
  const top = BY - BOARD_Z[1] * K
  const bot = BY - BOARD_Z[0] * K
  // The hoop's soft shadow on the floor, then the glass board.
  g.shadow(cx, HY + 8, RIM_R * 1.05, RIM_R * 0.32, 0.22)
  g.rrect(cx - BOARD_HALF, top + 8, BOARD_HALF * 2, bot - top, 16, shade(col, -0.45))
  g.rrect(
    cx - BOARD_HALF,
    top,
    BOARD_HALF * 2,
    bot - top,
    16,
    g.lin(0, top, 0, bot, [
      [0, '#ffffff'],
      [1, '#cfdaea'],
    ]),
    col,
    10,
  )
  g.alpha(0.5, () =>
    g.poly(
      [
        cx - BOARD_HALF + 20,
        top + 6,
        cx - BOARD_HALF + 70,
        top + 6,
        cx - BOARD_HALF + 40,
        bot - 6,
        cx - BOARD_HALF + 14,
        bot - 6,
      ],
      '#ffffff',
    ),
  )
  g.rrect(cx - 46, BY - 355 * K, 92, 70 * K, 6, undefined, C.orange, 6)
  // Bracket from the board to the rim.
  g.rrect(cx - 14, bot - 8, 28, rimY - RIM_R * 0.3 - bot + 14, 6, shade(C.orange, -0.45))
  // Far half of the rim.
  g.path(
    (c) => c.ellipse(cx, rimY, RIM_R, RIM_R * 0.3, 0, Math.PI, Math.PI * 2),
    undefined,
    shade(C.orange, -0.3),
    13,
  )
}

/** Net and the near half of the rim: drawn over a ball that is dropping through. */
function hoopFront(g: Draw, time: number, swishAt: number): void {
  const cx = W / 2
  const rimY = HY - RIM_H * K
  // Net: cords from the rim down to a smaller ring, sagging and flaring on a basket.
  const tau = time - swishAt
  const live = tau >= 0 && tau < 1.1
  const sag = live ? 30 * Math.exp(-3 * tau) * Math.abs(Math.sin(9 * tau)) : 0
  const flare = live ? 10 * Math.exp(-4 * tau) : 0
  const botY = HY - (RIM_H - 95) * K + sag
  const br = 62 + flare
  const net = alpha(C.white, 0.9)
  for (let i = 0; i < 14; i++) {
    const a = (i * Math.PI * 2) / 14
    const tx = cx + Math.cos(a) * RIM_R
    const ty = rimY + Math.sin(a) * RIM_R * 0.3
    const bx = cx + Math.cos(a) * br
    const by = botY + Math.sin(a) * br * 0.3
    const mx = (tx + bx) / 2 + Math.cos(a) * 4
    const my = (ty + by) / 2
    g.path(
      (c) => {
        c.moveTo(tx, ty)
        c.quadraticCurveTo(mx, my, bx, by)
      },
      undefined,
      net,
      3,
    )
  }
  // Diagonal knots: a ring halfway down.
  const midY = (rimY + botY) / 2
  const mr = (RIM_R + br) / 2
  g.path((c) => c.ellipse(cx, midY, mr, mr * 0.3, 0, 0, Math.PI), undefined, alpha(C.white, 0.6), 3)
  g.path(
    (c) => c.ellipse(cx, botY, br, br * 0.3, 0, 0, Math.PI * 2),
    undefined,
    alpha(C.white, 0.75),
    3,
  )
  // Near half of the rim, with a glint.
  g.path(
    (c) => c.ellipse(cx, rimY + 4, RIM_R, RIM_R * 0.3, 0, 0, Math.PI),
    undefined,
    shade(C.orange, -0.35),
    14,
  )
  g.path((c) => c.ellipse(cx, rimY, RIM_R, RIM_R * 0.3, 0, 0, Math.PI), undefined, C.orange, 13)
  g.path(
    (c) => c.ellipse(cx, rimY + 1, RIM_R - 2, RIM_R * 0.3 - 2, 0, 0.6, 1.4),
    undefined,
    alpha('#ffffff', 0.7),
    4,
  )
  if (live) {
    const a = 1 - prog(tau, 0, 0.7)
    g.alpha(a, () => g.ring(cx, rimY, RIM_R + 30 * outCubic(prog(tau, 0, 0.7)), C.yellow, 8))
  }
}

/** The ball's body and seams at the origin, radius `r` (shared by the court ball and the HUD chip). */
function ballFace(g: Draw, r: number): void {
  g.ball(0, 0, r, '#f07a2a', 0)
  const seam = alpha(C.ink, 0.85)
  const lw = Math.max(3, r * 0.1)
  g.line(0, -r, 0, r, seam, lw)
  g.line(-r, 0, r, 0, seam, lw)
  // The two side seams bow out toward the edge of the ball.
  g.arc(r * 1.2, 0, r * 1.9, Math.PI - 0.55, Math.PI + 0.55, seam, lw)
  g.arc(-r * 1.2, 0, r * 1.9, -0.55, 0.55, seam, lw)
}

/**
 * A basketball: orange, black seams, turning as it flies, and lifted by its
 * height. `squash` < 1 flattens it (landing, wind-up), > 1 stretches it (launch).
 */
function drawBall(
  g: Draw,
  lx: number,
  ly: number,
  z: number,
  spin: number,
  pop = 1,
  squash = 1,
): void {
  const s = (1 + 0.26 * Math.min(1, z / 360)) * pop
  const sh = BALL_R * (1 - Math.min(0.5, z / 700)) * pop
  g.shadow(lx, ly + 6, sh, sh * 0.42, 0.4 * (1 - Math.min(0.7, z / 500)))
  const q = Math.max(0.6, Math.min(1.4, squash))
  // Squash about the ball's base so a landing ball sits on the floor.
  const cy = ly - z * K + BALL_R * s * (1 - q)
  g.at(lx, cy, 0, () => g.at(0, 0, spin, () => ballFace(g, BALL_R)), s * (2 - q), s * q)
  // Highlight stays put while the ball spins.
  g.alpha(0.6, () =>
    g.ellipse(
      lx - BALL_R * 0.35 * s,
      cy - BALL_R * 0.42 * s,
      BALL_R * 0.3 * s,
      BALL_R * 0.17 * s,
      '#fff',
      -0.6,
    ),
  )
}

/** Arc preview: dots along the flight the current swipe would launch, green when it would drop in. */
function drawPreview(g: Draw, b: Ball, d: Drag, side: Side): void {
  const dx = d.x - d.x0
  const dy = d.y - d.y0
  const len = Math.hypot(dx, dy)
  if (!swipeOK(side, dy, len)) return
  const path = aimPath({ x: b.x, y: b.y }, dx / len, dy / len, len, d.v)
  const hoop = hoopAt(side)
  let color: string = C.yellow
  // The first point below the rim plane tells where the ball will cross it.
  for (let i = 1; i < path.length; i++) {
    const p = path[i]
    const q = path[i - 1]
    if (!p || !q) continue
    if (q.z >= RIM_H && p.z < RIM_H) {
      const t = (q.z - RIM_H) / (q.z - p.z)
      const cx = q.x + (p.x - q.x) * t
      const cy = q.y + (p.y - q.y) * t
      const dd = Math.hypot(cx - hoop.x, cy - hoop.y)
      if (dd < SWISH_R) color = C.green
      break
    }
  }
  path.forEach((p, i) => {
    const lp = frame(side, p.x, p.y)
    const k = i / path.length
    if (i % 2 === 0 && p.z >= 0) {
      g.alpha(0.3 + 0.6 * k, () => {
        g.circle(lp.x, lp.y - p.z * K, 10 + k * 4, alpha('#000000', 0.3))
        g.circle(lp.x, lp.y - p.z * K, 7 + k * 4, color)
      })
    }
  })
}

/** "Swipe up" chevrons above a ready ball, for players who have not scored yet. */
function drawHint(g: Draw, lx: number, ly: number, t: number): void {
  for (let i = 0; i < 3; i++) {
    const k = (t * 1.6 + i / 3) % 1
    const y = ly - 110 - k * 150
    g.alpha(Math.sin(k * Math.PI) * 0.9, () =>
      g.poly(
        [lx - 34, y + 18, lx, y - 10, lx + 34, y + 18, lx + 34, y + 32, lx, y + 4, lx - 34, y + 32],
        C.yellow,
      ),
    )
  }
}

/** True when the ball should be drawn behind the net and near rim. */
function behindRim(b: Ball, ly: number, lz: number): boolean {
  if (b.state !== 'fly') return false
  if (b.scored && lz < RIM_H + BALL_R) return true
  return ly < HY - RIM_R * 0.3 && lz < BOARD_Z[1]
}

/** Score plate on the player's left, clock on the player's right (same for both players). */
function hud(g: Draw, look: Look, side: Side): void {
  const w = look.w
  const y = hudY(g, side)
  const col = SIDE[side]
  const ang = textAngle(g, side)
  inFrame(g, side, () => {
    const yy = frame(side, 0, y).y
    // Score plate.
    const p = look.pulse[side]
    g.at(
      150,
      yy,
      ang,
      () => {
        g.rrect(-80, -44, 160, 88, 26, alpha(C.ink, 0.8))
        g.rrect(-80, -44, 160, 88, 26, undefined, alpha(col.main, 0.6 + p * 0.4), 5)
        g.at(-40, 0, -0.5, () => ballFace(g, 22))
        g.alpha(0.55, () => g.ellipse(-48, -8, 7, 4, '#fff', -0.6))
        g.text(w.score[side], 26, 4, {
          size: 62,
          weight: 700,
          color: p > 0.05 ? C.white : col.main,
        })
      },
      1 + p * 0.25,
    )
    // Clock: urgent in the last five seconds.
    const s = Math.max(0, Math.ceil(w.left))
    const label = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    const urgent = !w.ended && s <= 5
    const beat = urgent ? 1 + 0.08 * Math.max(0, Math.sin((w.left % 1) * Math.PI)) : 1
    g.at(
      850,
      yy,
      ang,
      () => {
        g.rrect(
          -84,
          -40,
          168,
          80,
          24,
          urgent ? alpha(shade(C.yellow, -0.6), 0.9) : alpha(C.ink, 0.8),
        )
        g.text(label, 0, 3, { size: 50, weight: 700, color: urgent ? C.yellow : C.white })
      },
      beat,
    )
  })
}

/** The decided match: the winner's half lights up and a ribbon reads the result. */
function ending(g: Draw, end: NonNullable<Look['end']>, names: [string, string]): void {
  const k = outCubic(prog(end.t, 0, 0.5))
  const s = outBack(prog(end.t, 0.15, 0.55))
  if (end.winner === 'draw') {
    g.alpha(k * 0.4, () => g.fillView('#000000'))
    if (s > 0) banner(g, undefined, 'Draw!', MID, { size: 80 * s, color: C.yellow, gap: 170 })
    return
  }
  const win = end.winner
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
  if (s > 0)
    g.forSide(win, W / 2, win === 0 ? MID + 520 : MID - 520, () => {
      g.at(
        0,
        0,
        0,
        () => {
          const label = `${names[win]} wins!`
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

export function render(g: Draw, look: Look): void {
  const w = look.w
  drawCourt(g)
  for (const side of [0, 1] as Side[]) {
    const b = look.balls[side]
    const live = b && b.state !== 'wait' ? b : null
    const lp = live ? frame(side, live.x, live.y) : null
    const lz = live ? Math.max(0, live.z) : 0
    // A quick flat shot spins faster than a lob.
    const spin = live ? (live.t * 9 * 1.2) / (live.arc || 1.2) : 0
    const pop = live ? outBack(prog(w.time - live.born, 0, 0.35)) : 1
    // Wind-up: a ready ball sinks into the swipe as it gets longer, and breathes when idle.
    const d = look.drag[side]
    let sq = look.squash[side]
    if (live && live.state === 'ready') {
      const pull = d ? prog(Math.hypot(d.x - d.x0, d.y - d.y0), 0, 600) : 0
      sq *= d ? 1 - 0.22 * pull : 1 + 0.03 * Math.sin(w.time * 4 + side * 2)
    }
    const tr = look.trail[side]
    inFrame(g, side, () => {
      const ball = () => {
        if (!live || !lp) return
        if (live.state === 'ready') {
          const pulse = 6 * Math.sin(w.time * 5)
          g.ring(lp.x, lp.y, BALL_R * 1.3 + pulse, alpha(C.yellow, 0.85 * pop), 7)
        }
        if (live.state === 'fly' && tr.length > 1) {
          for (let i = 0; i < tr.length - 1; i++) {
            const q = tr[i]
            if (!q) continue
            const tp = frame(side, q.x, q.y)
            const k = (i + 1) / tr.length
            g.circle(tp.x, tp.y - q.z * K, BALL_R * (0.35 + 0.55 * k), alpha('#f6a25a', 0.18 * k))
          }
        }
        drawBall(g, lp.x, lp.y, lz, spin, Math.max(0.01, pop), sq)
      }
      const deep = live && lp ? live.state === 'fly' && lp.y < BY - 20 && lz < BOARD_Z[0] : false
      if (deep) ball()
      hoopBack(g, side)
      const behind = live && lp ? !deep && behindRim(live, lp.y, lz) : false
      if (behind) ball()
      hoopFront(g, w.time, w.swishAt[side])
      if (!deep && !behind) ball()
      if (live && lp && live.state === 'ready' && look.hint[side] && !look.drag[side])
        drawHint(g, lp.x, lp.y, w.time)
    })
  }
  for (const side of [0, 1] as Side[]) {
    const b = look.balls[side]
    const d = look.drag[side]
    if (!b || !d || !ready(w, side)) continue
    inFrame(g, side, () => drawPreview(g, b, d, side))
  }
  // The finger's swipe: a tapered streak in the team colour.
  for (const side of [0, 1] as Side[]) {
    const d = look.drag[side]
    if (!d || !ready(w, side)) continue
    // The streak heats up with the flick's speed.
    const hot = prog(d.v ?? 0, 900, 3400)
    g.line(d.x0, d.y0, d.x, d.y, alpha(SIDE[side].light, 0.25 + hot * 0.25), 22 + hot * 14)
    g.line(d.x0, d.y0, d.x, d.y, alpha(hot > 0.5 ? C.yellow : C.white, 0.5 + hot * 0.3), 7)
    g.circle(d.x0, d.y0, 10, alpha(C.white, 0.6))
    g.circle(d.x, d.y, 22, alpha(SIDE[side].main, 0.9))
  }
  // Sudden death call-out.
  if (w.overtime && !w.ended) {
    const t = OVERTIME - w.left
    if (t < 1.8) {
      const a = prog(t, 0, 0.15) * (1 - prog(t, 1.4, 1.8))
      banner(g, undefined, 'Sudden death!', MID, { size: 60, color: C.yellow, gap: 150, alpha: a })
    }
  }
  g.vignette(0.3)
  for (const side of [0, 1] as Side[]) {
    namePill(g, side, look.names[side], {
      active: ready(w, side) && !look.end,
      text: look.status[side],
    })
    hud(g, look, side)
  }
  if (look.end) ending(g, look.end, look.names)
}
