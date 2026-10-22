import { frame, inFrame, textAngle } from '../../core/frame.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Side } from '../../core/game.ts'
import { banner, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import {
  BR,
  FOOT,
  groupOf,
  HEAD,
  POCKETS,
  raycast,
  TABLE,
  type Ball,
  type Group,
  type World,
} from './rules.ts'

/** The stroke being lined up: the flick direction, its power, and the pull (grab point to finger). */
export interface Aim {
  ox: number
  oy: number
  fx: number
  fy: number
  dx: number
  dy: number
  power: number
  /** The computer lining up: no rubber band, just the cue drawing back. */
  bot?: boolean
}

/** A stroke just played: the cue stick thrusts through and fades. */
export interface Stroke {
  x: number
  y: number
  dx: number
  dy: number
  power: number
  /** Seconds since the strike. */
  t: number
}

export interface Look {
  w: World
  balls: Ball[]
  aim: Aim | null
  stroke: Stroke | null
  names: [string, string]
  target: number
  status: [string | undefined, string | undefined]
  active: [boolean, boolean]
  /** Ball in hand carried by a finger. */
  hand: { x: number; y: number; ok: boolean } | null
  /** Per ball (n * 4): last drawn x, y, roll phase, roll heading. */
  roll: Float64Array
  /** Per ball contact pop (radius scale spring). */
  pop: { value: number }[]
  /** Tray pulse per side, 0..1. */
  pulse: [number, number]
  /** Recent cue ball positions while it flies. */
  trail: { x: number; y: number }[]
  /** The decided match and how long ago (s), once it is. */
  end: { side: Side; t: number } | null
}

const RAIL = 58

/** Standard ball colours; 9..15 are the same colours striped. */
const COLORS: Record<number, string> = {
  1: '#ffcd3c',
  2: '#2a63d6',
  3: '#ff4b5c',
  4: '#7c4dff',
  5: '#ff8b3d',
  6: '#1d9a5a',
  7: '#9a2a3c',
  8: '#1d1730',
  9: '#ffcd3c',
  10: '#2a63d6',
  11: '#ff4b5c',
  12: '#7c4dff',
  13: '#ff8b3d',
  14: '#1d9a5a',
  15: '#9a2a3c',
}

const IVORY = '#fffaf0'

/** Felt under an overhead lamp, wooden rails with team-coloured end inlays, cushions and pockets. */
function drawTable(g: Draw): void {
  const { x0, y0, x1, y1 } = TABLE
  const tw = x1 - x0
  const th = y1 - y0
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, shade(SIDE[1].main, -0.84)],
      [0.5, '#120e1f'],
      [1, shade(SIDE[0].main, -0.84)],
    ]),
  )
  // Lamp spill on the floor around the table.
  g.fillView(
    g.rad(W / 2, MID, 200, 1000, [
      [0, alpha('#ffffff', 0.06)],
      [1, alpha('#ffffff', 0)],
    ]),
  )
  g.shadow(W / 2, y1 + RAIL + 20, tw * 0.6, 40, 0.55)
  // Rails: dark lip, then the wood with a varnish highlight.
  const rx = x0 - RAIL
  const ry = y0 - RAIL
  const rw = tw + RAIL * 2
  const rh = th + RAIL * 2
  g.rrect(rx - 6, ry + 4, rw + 12, rh + 12, 64, '#0a0710')
  g.rrect(
    rx,
    ry,
    rw,
    rh,
    58,
    g.lin(rx, 0, rx + rw, 0, [
      [0, shade(C.woodDark, -0.15)],
      [0.5, shade(C.woodDark, 0.12)],
      [1, shade(C.woodDark, -0.15)],
    ]),
  )
  g.rrect(rx + 8, ry + 6, rw - 16, 10, 5, alpha('#ffffff', 0.12))
  // Each end rail carries its owner's colour.
  g.rrect(x0 + 40, ry + 18, tw - 80, 10, 5, alpha(SIDE[1].main, 0.85))
  g.rrect(x0 + 40, y1 + RAIL - 28, tw - 80, 10, 5, alpha(SIDE[0].main, 0.85))
  // Cushions: a darker felt band with a lit edge.
  g.rrect(x0 - 22, y0 - 22, tw + 44, th + 44, 26, shade(C.felt, -0.45))
  g.rrect(x0 - 22, y0 - 22, tw + 44, th + 44, 26, undefined, alpha('#000000', 0.35), 4)
  g.rrect(
    x0,
    y0,
    tw,
    th,
    10,
    g.rad(W / 2, MID, 120, th * 0.62, [
      [0, shade(C.felt, 0.16)],
      [0.65, C.felt],
      [1, shade(C.felt, -0.22)],
    ]),
  )
  g.clip(x0, y0, tw, th, 10, () => {
    // Faint cloth nap.
    for (let y = y0 + 12; y < y1; y += 24) g.line(x0, y, x1, y, alpha('#000000', 0.035), 2)
    // Head string and the "D" end in a soft line; spots.
    g.line(x0, HEAD.y - 40, x1, HEAD.y - 40, alpha('#ffffff', 0.12), 4)
  })
  // Diamond sights on the rails.
  for (let k = 1; k < 4; k++) {
    if (k === 2) continue
    const x = x0 + (tw / 4) * k
    for (const y of [y0 - RAIL / 2 - 4, y1 + RAIL / 2 + 4])
      g.poly([x, y - 9, x + 7, y, x, y + 9, x - 7, y], C.cream)
  }
  for (let k = 1; k < 8; k++) {
    if (k === 4) continue
    const y = y0 + (th / 8) * k
    for (const x of [x0 - RAIL / 2 - 4, x1 + RAIL / 2 + 4])
      g.poly([x - 9, y, x, y - 7, x + 9, y, x, y + 7], C.cream)
  }
  g.circle(HEAD.x, HEAD.y, 6, alpha('#ffffff', 0.25))
  g.circle(FOOT.x, FOOT.y, 6, alpha('#ffffff', 0.25))
  // Pockets: a deep hole set into the rail, with a leather jaw.
  for (const p of POCKETS) {
    const q = pocketDrawn(p)
    const r = 46
    g.circle(q.x, q.y + 4, r + 11, '#07050c')
    g.circle(q.x, q.y, r + 10, shade(C.woodDark, -0.6))
    g.circle(
      q.x,
      q.y,
      r,
      g.rad(q.x, q.y, 4, r, [
        [0, '#000000'],
        [0.7, '#07050c'],
        [1, '#231b30'],
      ]),
    )
    g.arc(q.x, q.y, r + 5, Math.PI * 1.1, Math.PI * 1.6, alpha('#ffffff', 0.16), 4)
  }
}

/** Where a pocket is drawn: nudged out of the felt into the rail, away from the table's centre. */
function pocketDrawn(p: { x: number; y: number }): { x: number; y: number } {
  const side = p.x > TABLE.x0 + 1 && p.x < TABLE.x1 - 1
  return {
    x: p.x + (side ? 0 : Math.sign(p.x - W / 2) * 10),
    y: p.y + Math.sign(p.y - MID) * (side ? 16 : 10),
  }
}

/** A ball: glossy, striped for 9..15, with its number on an ivory disc. */
export function drawBall(
  g: Draw,
  b: Ball,
  angle: number,
  r = BR,
  shadow = true,
  /** How far the ball has rolled (radians) and which way, to turn its spot over. */
  phase = 0,
  heading = 0,
): void {
  const { x, y } = b
  if (shadow) g.shadow(x + 6, y + 10, r * 0.95, r * 0.8, 0.4)
  const col = b.n === 0 ? IVORY : (COLORS[b.n] ?? IVORY)
  if (b.n >= 9) {
    g.circle(x, y, r, IVORY)
    g.clip(x - r, y - r, r * 2, r * 2, r, () => g.rect(x - r, y - r * 0.5, r * 2, r, col))
  } else g.circle(x, y, r, col)
  // Sphere shading over the flat colours.
  g.circle(
    x,
    y,
    r,
    g.rad(
      x,
      y,
      r * 0.05,
      r,
      [
        [0, 'rgba(255,255,255,0.35)'],
        [0.5, 'rgba(255,255,255,0)'],
        [1, 'rgba(0,0,0,0.38)'],
      ],
      x - r * 0.35,
      y - r * 0.4,
    ),
  )
  // The spot rides over the top as the ball rolls and hides on the far side.
  const front = Math.cos(phase)
  const off = Math.sin(phase) * r * 0.55
  const sx = x + Math.cos(heading) * off
  const sy = y + Math.sin(heading) * off
  if (b.n === 0) {
    if (front > -0.2)
      g.circle(sx + r * 0.25 * front, sy + r * 0.2 * front, r * 0.12, alpha(C.red, 0.55))
  } else if (front > 0) {
    const fs = Math.max(0.2, front)
    g.at(sx, sy, heading, () => g.ellipse(0, 0, r * 0.52 * fs, r * 0.52, IVORY))
    if (front > 0.5)
      g.alpha(Math.min(1, (front - 0.5) * 4), () =>
        g.at(sx, sy, angle, () =>
          g.text(String(b.n), 0, r * 0.05, {
            size: r * (b.n >= 10 ? 0.66 : 0.78),
            weight: 700,
            color: C.ink,
          }),
        ),
      )
  }
  g.alpha(0.75, () => g.ellipse(x - r * 0.36, y - r * 0.44, r * 0.3, r * 0.14, '#fff', -0.6))
}

/** The cue stick, tip at (tx, ty), pointing along (dx, dy). */
function drawCue(g: Draw, tx: number, ty: number, dx: number, dy: number): void {
  const len = 640
  const bx = tx - dx * len
  const by = ty - dy * len
  const px = -dy
  const py = dx
  g.alpha(0.35, () =>
    g.poly(
      [
        tx + 10,
        ty + 16 + 6,
        bx + px * 15 + 10,
        by + py * 15 + 16,
        bx - px * 15 + 10,
        by - py * 15 + 16,
        tx + 10 - px * 6,
        ty + 16 - py * 6,
      ],
      '#000000',
    ),
  )
  const shaft = (a: number, b: number, w0: number, w1: number, fill: string) => {
    const ax = tx - dx * a
    const ay = ty - dy * a
    const cx = tx - dx * b
    const cy = ty - dy * b
    g.poly(
      [
        ax + px * w0,
        ay + py * w0,
        cx + px * w1,
        cy + py * w1,
        cx - px * w1,
        cy - py * w1,
        ax - px * w0,
        ay - py * w0,
      ],
      fill,
    )
  }
  shaft(0, len * 0.62, 6, 10, '#f3dcae')
  shaft(len * 0.62, len, 10, 15, shade(C.woodDark, -0.1))
  shaft(len * 0.6, len * 0.64, 10, 10.5, C.cream)
  shaft(len * 0.94, len, 15, 15, '#1b1424')
  g.line(tx, ty, tx - dx * 14, ty - dy * 14, '#5bb8ff', 12, 'butt')
  g.line(
    tx - px * 2,
    ty - py * 2,
    tx - dx * len * 0.6 - px * 3,
    ty - dy * len * 0.6 - py * 3,
    alpha('#ffffff', 0.35),
    3,
  )
}

/** The guide: the cue ball's line, a ghost ball where it touches, the object ball's path, and the cue stick. */
function drawAim(g: Draw, w: World, aim: Aim, turn: Side): void {
  const cue = w.balls[0]
  if (!cue || !cue.on) return
  const col = SIDE[turn]
  if (!aim.bot) {
    g.line(aim.ox, aim.oy, aim.fx, aim.fy, alpha(col.light, 0.35), 8)
    g.circle(aim.fx, aim.fy, 22, alpha(col.main, 0.85))
  }
  const hit = raycast(w, cue.x, cue.y, aim.dx, aim.dy)
  const ex = cue.x + aim.dx * hit.t
  const ey = cue.y + aim.dy * hit.t
  g.dashed(cue.x, cue.y, ex, ey, alpha('#ffffff', 0.65), 6, [18, 14])
  g.circle(ex, ey, BR, alpha('#ffffff', 0.14), alpha('#ffffff', 0.8), 5)
  if (hit.hit >= 0) {
    const t = w.balls[hit.hit]
    if (t) {
      const ux = t.x - ex
      const uy = t.y - ey
      const L = Math.hypot(ux, uy) || 1
      const legal = isLegal(w, turn, t.n)
      const lc = legal ? C.yellow : C.red
      g.ring(t.x, t.y, BR + 8, alpha(lc, 0.9), 5)
      g.clip(TABLE.x0, TABLE.y0, TABLE.x1 - TABLE.x0, TABLE.y1 - TABLE.y0, 10, () =>
        g.dashed(t.x, t.y, t.x + (ux / L) * 300, t.y + (uy / L) * 300, alpha(lc, 0.9), 7, [14, 12]),
      )
      // The cue ball glances off at right angles to the object ball's path.
      const sx = -uy / L
      const sy = ux / L
      const side = sx * aim.dx + sy * aim.dy >= 0 ? 1 : -1
      g.dashed(
        ex,
        ey,
        ex + sx * side * 120,
        ey + sy * side * 120,
        alpha('#ffffff', 0.3),
        5,
        [10, 12],
      )
    }
  }
  // Cue stick: behind the cue ball, pulled back further the harder the stroke.
  const back = BR + 14 + aim.power * 160
  drawCue(g, cue.x - aim.dx * back, cue.y - aim.dy * back, aim.dx, aim.dy)
  // Power arc around the cue ball.
  const a0 = -Math.PI / 2
  g.arc(cue.x, cue.y, BR + 16, 0, Math.PI * 2, alpha('#000000', 0.3), 9)
  g.arc(cue.x, cue.y, BR + 16, a0, a0 + aim.power * Math.PI * 2, C.yellow, 9)
}

/** Would hitting ball `n` first be legal for `side`? */
function isLegal(w: World, side: Side, n: number): boolean {
  const g = w.groups[side]
  if (g === null) return n !== 8
  if (groupOf(n) === g) return true
  return n === 8 && !w.balls.some((b) => b.on && groupOf(b.n) === g)
}

/** Ball in hand: the cue ball floats at the head spot (or where it lies), pulsing, with a hint. */
function drawInHand(g: Draw, w: World, turn: Side, human: boolean, hand: Look['hand']): void {
  const cue = w.balls[0]
  const at = hand ?? (cue && cue.on ? cue : { x: HEAD.x, y: HEAD.y })
  const k = 0.5 + 0.5 * Math.sin(g.t * 6)
  // Carried by a finger: lifted higher (bigger shadow offset), red ring where it won't fit.
  const lift = hand ? 22 : 8 + k * 4
  g.shadow(at.x + lift * 0.6, at.y + lift, BR * 0.9, BR * 0.7, hand ? 0.3 : 0.2)
  g.alpha(hand ? 0.95 : 0.55 + 0.3 * k, () =>
    drawBall(g, { ...(cue as Ball), x: at.x, y: at.y - lift }, 0, BR, false),
  )
  const ring = hand && !hand.ok ? C.red : C.yellow
  g.ring(at.x, at.y, BR + 12 + k * 8, alpha(ring, 0.8), 6)
  if (human && !hand) {
    const y = turn === 0 ? MID + 360 : MID - 360
    banner(g, turn, 'Ball in hand: drag or tap', y, { size: 44, color: C.yellow, alpha: 0.95 })
  }
}

/**
 * The HUD row sits tight to each edge so the pills clear the end rail and its
 * pockets (the table runs almost edge to edge).
 */
const HUD_INSET = 40

/** Each player's tray: their group's balls still to pot (or "Open table"), and rack pips. */
function tray(g: Draw, w: World, side: Side, target: number, pulse: number): void {
  const y = hudY(g, side, HUD_INSET)
  const ang = textAngle(g, side)
  const grp: Group = w.groups[side]
  inFrame(g, side, () => {
    const yy = frame(side, 0, y).y
    g.rrect(560, yy - 34, 380, 68, 34, alpha(C.ink, 0.86))
    const pk = Math.min(1, pulse)
    g.rrect(
      560,
      yy - 34,
      380,
      68,
      34,
      undefined,
      alpha(SIDE[side].main, 0.45 + 0.55 * pk),
      3 + 5 * pk,
    )
    if (grp === null) {
      g.at(750, yy, ang, () =>
        g.text('Open table', 0, 2, { size: 34, weight: 600, color: alpha(C.white, 0.7) }),
      )
    } else {
      const nums = grp === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]
      const cleared = nums.every((n) => !w.balls[n]?.on)
      const list = cleared ? [8] : nums
      list.forEach((n, i) => {
        const x = cleared ? 750 : 598 + i * 51
        const b = w.balls[n]
        const on = b?.on ?? false
        g.alpha(on ? 1 : 0.18, () => drawBall(g, { ...(b as Ball), n, x, y: yy }, ang, 21, false))
      })
      if (cleared)
        g.at(750, yy, ang, () =>
          g.text('Black!', 70, 2, { size: 34, weight: 700, color: C.yellow }),
        )
    }
    // Racks won, only when the match is longer than one rack: a column of
    // pips in the corner beside the name pill, clear of the rail.
    if (target > 1) {
      const gap = 26
      for (let i = 0; i < target; i++) {
        const x = 80 + (i - (target - 1) / 2) * gap
        const on = i < w.wins[side]
        g.circle(x, yy, 10, on ? SIDE[side].main : alpha(C.white, 0.18))
        if (on) g.circle(x - 3, yy - 3, 3.5, alpha(C.white, 0.6))
      }
    }
  })
}

/** Foul call-out on the half of the player who fouled. */
function foulStamp(g: Draw, w: World): void {
  if (w.phase !== 'place' || !w.foul) return
  const fouler: Side = w.turn === 0 ? 1 : 0
  const label =
    w.foul === 'scratch'
      ? 'Scratch!'
      : w.foul === 'miss'
        ? 'Missed!'
        : w.foul === 'eight'
          ? 'Black too early!'
          : 'Wrong ball!'
  banner(g, fouler, label, fouler === 0 ? MID + 360 : MID - 360, { size: 52, color: C.red })
}

/** End of a rack: the winner's name on their half. */
function rackStamp(g: Draw, w: World, names: [string, string], last: boolean): void {
  if (w.phase !== 'rack' || w.rackWinner < 0 || last) return
  const side = w.rackWinner as Side
  const s = outBack(prog(w.t, 0, 0.3))
  g.forSide(side, W / 2, side === 0 ? MID + 300 : MID - 300, () =>
    g.text(`Rack to ${names[side]}!`, 0, 0, {
      size: 84 * s,
      weight: 700,
      color: SIDE[side].main,
      stroke: C.white,
      strokeWidth: 12,
    }),
  )
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
    g.forSide(win, W / 2, win === 0 ? MID + 420 : MID - 420, () =>
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

export function render(g: Draw, look: Look, human: [boolean, boolean]): void {
  const w = look.w
  drawTable(g)
  // Pocketed balls drop into their pocket.
  for (const b of look.balls) {
    if (b.on) continue
    const k = (w.time - b.at) / 0.35
    if (b.pocket < 0 || k < 0 || k > 1) continue
    const p0 = POCKETS[b.pocket]
    if (!p0) continue
    const p = pocketDrawn(p0)
    const s = 1 - outCubic(k) * 0.7
    g.alpha(1 - k * k, () => drawBall(g, { ...b, x: p.x, y: p.y }, 0, BR * s, false))
  }
  // A fast cue ball leaves a short comet tail.
  look.trail.forEach((p, i) => {
    const k = (i + 1) / (look.trail.length + 1)
    g.circle(p.x, p.y, BR * (0.4 + 0.5 * k), alpha(IVORY, 0.18 * k))
  })
  for (const b of look.balls) {
    if (!b.on) continue
    if (b.n === 0 && w.phase === 'place') continue
    const o = b.n * 4
    const pop = Math.max(0.85, Math.min(1.2, look.pop[b.n]?.value ?? 1))
    drawBall(
      g,
      b,
      b.y < MID ? g.orient(1) : g.orient(0),
      BR * pop,
      true,
      look.roll[o + 2] ?? 0,
      look.roll[o + 3] ?? 0,
    )
  }
  if (w.phase === 'place') drawInHand(g, w, w.turn, human[w.turn], look.hand)
  if (look.aim && w.phase === 'aim') drawAim(g, w, look.aim, w.turn)
  // The stroke: the stick thrusts through the cue ball's old spot and fades.
  const st = look.stroke
  if (st && st.t < 0.35) {
    const thrust = outCubic(prog(st.t, 0, 0.06))
    const back = (BR + 14 + st.power * 160) * (1 - thrust) + BR * thrust
    g.alpha(1 - prog(st.t, 0.12, 0.35), () =>
      drawCue(g, st.x - st.dx * back, st.y - st.dy * back, st.dx, st.dy),
    )
  }
  foulStamp(g, w)
  rackStamp(g, w, look.names, look.end !== null)
  for (const side of [0, 1] as Side[]) {
    namePill(g, side, look.names[side], {
      active: look.active[side] && !look.end,
      text: look.status[side],
      x: side === 0 ? 310 : W - 310,
      inset: HUD_INSET,
    })
    tray(g, w, side, look.target, look.pulse[side])
  }
  if (look.end) ending(g, look.end, look.names[look.end.side])
}
