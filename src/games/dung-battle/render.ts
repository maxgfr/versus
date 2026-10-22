import { hudY, namePill, pips } from '../../core/hud.ts'
import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { clamp, outBack } from '../../core/fx/ease.ts'
import { MID, W } from '../../core/stage.ts'
import type { State } from './index.ts'
import {
  type Ball,
  type Bug,
  BEETLE_R,
  DASH_CD,
  FIELD,
  FLAT_T,
  flattens,
  type Pellet,
  ROUND_T,
  type World,
} from './rules.ts'

/** Where a beetle and its ball are drawn this frame (interpolated between steps). */
export interface Pose {
  bx: number
  by: number
  ba: number
  cx: number
  cy: number
}

/** Cosmetic extras the game keeps outside the state. */
export interface Look {
  poses: [Pose, Pose]
  trails: [{ x: number; y: number }[], { x: number; y: number }[]]
}

/** A stick as the online guest needs to draw it. */
export interface StickLook {
  side: Side
  bx: number
  by: number
  kx: number
  ky: number
  r: number
  on: boolean
}

const DIRT = '#7a4a22'
const DIRT_DARK = '#3f2410'
const SOIL = '#a8774a'

/** Speckles of grit on the dish floor (fixed, so they never flicker). */
const GRIT: [number, number, number][] = Array.from({ length: 70 }, (_, i) => {
  const a = i * 2.39996
  const d = Math.sqrt((i + 0.5) / 70) * 0.92
  return [
    FIELD.cx + Math.cos(a) * d * FIELD.a,
    FIELD.cy + Math.sin(a) * d * FIELD.b,
    3 + ((i * 7) % 5),
  ]
})

/** Team strips at both ends, a floodlit table, and the dish with its rim and grooves. */
function dish(g: Draw): void {
  const { cx, cy, a, b } = FIELD
  const v = g.stage.view
  g.fillView('#150f20')
  // Each player's end of the table is theirs: blue above the dish, red below.
  g.rect(v.x - 2, v.y - 2, v.w + 4, cy - v.y, shade(C.blue, -0.78))
  g.rect(v.x - 2, cy, v.w + 4, v.y + v.h - cy + 2, shade(C.red, -0.78))
  g.fillView(
    g.rad(cx, cy, 200, 1100, [
      [0, 'rgba(255,236,200,0.10)'],
      [1, 'rgba(0,0,0,0.35)'],
    ]),
  )
  // Rim: a raised clay lip with a contact shadow.
  g.ellipse(cx + 8, cy + 26, a + 48, b + 46, alpha('#000000', 0.45))
  g.ellipse(cx, cy + 10, a + 40, b + 40, '#2e1c10')
  g.ellipse(
    cx,
    cy,
    a + 40,
    b + 40,
    g.lin(0, cy - b, 0, cy + b, [
      [0, '#7a5232'],
      [1, '#4c301b'],
    ]),
  )
  g.ellipse(cx, cy - 4, a + 30, b + 30, alpha('#ffffff', 0.08))
  g.ellipse(cx, cy, a + 16, b + 16, '#2a1a0e')
  g.ellipse(
    cx,
    cy,
    a,
    b,
    g.rad(
      cx,
      cy,
      30,
      b * 1.1,
      [
        [0, '#caa070'],
        [0.55, '#a07346'],
        [1, '#6c4625'],
      ],
      cx - 120,
      cy - 180,
    ),
  )
  for (const [x, y, r] of GRIT) g.circle(x, y, r, alpha(shade(SOIL, -0.45), 0.35))
  for (let k = 1; k <= 4; k++) {
    const f = 1 - k * 0.19
    g.path(
      (c) => c.ellipse(cx, cy, a * f, b * f, 0, 0, Math.PI * 2),
      undefined,
      alpha('#4a2c14', 0.2),
      7,
    )
  }
  // Team ends: blue tints the top of the dish, red the bottom (inside the rim only).
  g.ellipse(
    cx,
    cy,
    a,
    b,
    g.lin(0, cy - b, 0, cy + b, [
      [0, alpha(SIDE[1].main, 0.3)],
      [0.4, alpha(SIDE[1].main, 0)],
      [0.6, alpha(SIDE[0].main, 0)],
      [1, alpha(SIDE[0].main, 0.32)],
    ]),
  )
  // Inner shading so the dish reads as a bowl.
  g.ellipse(
    cx,
    cy,
    a,
    b,
    g.rad(cx, cy, Math.min(a, b) * 0.7, b * 1.02, [
      [0, 'rgba(0,0,0,0)'],
      [1, 'rgba(30,14,4,0.45)'],
    ]),
  )
  g.dashed(cx - a + 40, MID, cx + a - 40, MID, alpha(C.white, 0.14), 5, [22, 18])
}

/** A pellet: a small glossy dung ball that pops back up when it respawns, and glints now and then. */
function pellet(g: Draw, p: Pellet, t: number, now: number, i: number): void {
  const k = outBack(clamp((t - p.back) / 0.35, 0, 1))
  if (k <= 0.01) return
  const r = 14 * k
  g.shadow(p.x + 4, p.y + 9, r * 1.1, r * 0.55, 0.35)
  g.ball(p.x, p.y, r, '#6a3e1b', 0.7)
  const glint = Math.sin(now * 1.3 + i * 2.17)
  if (glint > 0.94) {
    const a = (glint - 0.94) / 0.06
    g.alpha(a, () => g.star(p.x - 4, p.y - 5, 4 + a * 5, '#fff3d6'))
  }
}

/**
 * A rolling dung ball: its surface speckles turn with the roll, its rim is
 * the owner's colour, it bulges for a moment after each pellet and squashes
 * along the hit on a hard knock. A ball big enough to flatten the rival wears
 * a pulsing yellow ring. A fast ball drags a dust trail.
 */
function ball(
  g: Draw,
  c: Ball,
  side: Side,
  t: number,
  threat: boolean,
  x: number,
  y: number,
  trail: readonly { x: number; y: number }[],
  hop: number,
): void {
  const pop = c.eat >= 0 ? Math.max(0, 1 - (t - c.eat) / 0.22) : 0
  const r = c.r * (1 + 0.12 * pop + hop)
  for (let i = 0; i < trail.length; i++) {
    const p = trail[i] as { x: number; y: number }
    const f = (i + 1) / (trail.length + 1)
    g.circle(p.x, p.y, r * (0.45 + 0.45 * f), alpha('#c9a06a', 0.16 * f))
  }
  const age = c.hit >= 0 ? t - c.hit : 9
  const q = age < 0.6 ? c.hitK * 0.22 * Math.exp(-age * 9) * Math.cos(age * 26) : 0
  const ra = r * (1 - q)
  const rb = r * (1 + q * 0.7)
  g.shadow(x + 10, y + 16, r * 0.98, r * 0.6, 0.38)
  if (threat) {
    const p = 0.5 + 0.5 * Math.sin(t * 9)
    g.circle(x, y, r + 16 + p * 6, alpha(C.yellow, 0.18 + p * 0.12))
    g.ring(x, y, r + 10 + p * 4, alpha(C.yellow, 0.85), 6)
  }
  g.ellipse(
    x,
    y,
    ra,
    rb,
    g.rad(
      x,
      y,
      r * 0.1,
      r,
      [
        [0, '#b8834a'],
        [0.6, DIRT],
        [1, DIRT_DARK],
      ],
      x - r * 0.35,
      y - r * 0.4,
    ),
    c.ha,
  )
  // Straw and grit stuck in the ball, rolling with it.
  const sq = 1 - Math.abs(q)
  for (let i = 0; i < 11; i++) {
    const a = i * 2.4 + c.roll
    const k = (0.2 + 0.65 * (((i * 7) % 11) / 11)) * sq
    const px = x + Math.cos(a) * r * k
    const py = y + Math.sin(a) * r * k * 0.92
    if (i % 3 === 0) {
      const s = r * 0.16
      g.line(px - Math.cos(a + 1) * s, py - Math.sin(a + 1) * s, px, py, alpha('#d9b26a', 0.75), 4)
    } else g.circle(px, py, r * (0.06 + 0.03 * ((i * 3) % 2)), alpha(DIRT_DARK, 0.7))
  }
  g.path(
    (cx) => cx.ellipse(x, y, Math.max(1, ra - 4), Math.max(1, rb - 4), c.ha, 0, Math.PI * 2),
    undefined,
    alpha(SIDE[side].light, 0.95),
    8,
  )
  g.alpha(0.35, () => g.ellipse(x - r * 0.36, y - r * 0.42, r * 0.26, r * 0.13, '#ffffff', -0.6))
}

/** A top-down beetle, facing its heading. Flattens into a pancake when its ball loses. */
function beetle(
  g: Draw,
  bug: Bug,
  w: World,
  scared: boolean,
  now: number,
  x0: number,
  y0: number,
  heading: number,
): void {
  const b = bug.beetle
  const col = SIDE[bug.side]
  const p = w.flattened === bug.side ? Math.min(1, Math.max(0, (w.t - w.flatT) / FLAT_T)) : 0
  const e = p * p * (3 - 2 * p)
  // Charge: a lunge that stretches along the heading. Knock: a wobbling squash.
  const da = b.dashT >= 0 ? w.t - b.dashT : 9
  const lunge = da < 0.5 ? (0.14 + 0.2 * b.dashK) * Math.exp(-da * 9) : 0
  const ha = b.hit >= 0 ? w.t - b.hit : 9
  const knock = ha < 0.5 ? b.hitK * 0.24 * Math.exp(-ha * 11) * Math.cos(ha * 30) : 0
  // Idle life: a slow breath when standing still.
  const still = Math.max(0, 1 - Math.hypot(b.vx, b.vy) / 60)
  const breath = still * 0.035 * Math.sin(now * 3.1 + bug.side * 1.7)
  const sx = (1 - 0.42 * e) * (1 + lunge - knock)
  const sy = (1 + 1.1 * e) * (1 - lunge * 0.55 + knock * 0.6 + breath)
  const shiver = scared ? Math.sin(now * 40) * 1.6 : 0
  g.shadow(x0 + 6, y0 + 10, BEETLE_R * 1.3 * sx, BEETLE_R * 1.05 * sy, 0.4)
  // Speed lines behind a charging beetle.
  if (da < 0.3 && p === 0) {
    const a = 1 - da / 0.3
    const c = Math.cos(heading)
    const s = Math.sin(heading)
    for (const off of [-22, 0, 22]) {
      const len = (50 + 50 * b.dashK) * a
      const bx = x0 - c * 50 - s * off
      const by = y0 - s * 50 + c * off
      g.line(bx, by, bx - c * len, by - s * len, alpha('#fff3d6', 0.5 * a), 6)
    }
  }
  g.at(
    x0 + shiver,
    y0,
    heading,
    () => {
      // Legs: three pairs, alternating like a tripod gait (a little twitch at rest).
      const phase = b.walk * 0.11 + still * Math.sin(now * 2.3 + bug.side) * 0.5
      for (const [i, x] of [16, 0, -16].entries()) {
        for (const s of [-1, 1]) {
          const swing = Math.sin(phase + i * 1.9 + (s > 0 ? Math.PI : 0)) * 9
          g.line(x, s * 22, x + swing, s * 52, DIRT_DARK, 8)
          g.line(x + swing, s * 52, x + swing + 7, s * 59, DIRT_DARK, 6)
        }
      }
      // Horns (twitching at rest) and head.
      const tw = still * 3 * Math.sin(now * 5.3 + bug.side * 2)
      g.line(40, -6, 60, -17 - tw, C.ink, 7)
      g.line(40, 6, 60, 17 + tw, C.ink, 7)
      g.circle(38, 0, 16, shade(col.main, -0.6))
      for (const ey of [-8, 8]) {
        g.circle(36, ey, 5.2, C.white)
        g.circle(38.5, ey, 2.8, C.ink)
      }
      // Pronotum (the shield behind the head).
      g.ellipse(14, 0, 22, 25, shade(col.main, -0.32))
      g.ellipse(17, -7, 9, 5, alpha('#ffffff', 0.18))
      // Elytra, the hard wing cases with a seam and a gloss.
      g.ellipse(-12, 3, 39, 33, shade(col.main, -0.6))
      g.ellipse(
        -12,
        0,
        39,
        33,
        g.lin(-40, -30, 20, 30, [
          [0, shade(col.main, 0.12)],
          [1, shade(col.main, -0.42)],
        ]),
      )
      g.line(-48, 0, 20, 0, alpha(C.ink, 0.55), 3)
      g.alpha(0.55, () => g.ellipse(-22, -15, 16, 6, '#ffffff', -0.3))
      // Side mark on the back: circle for red, square for blue (never colour alone).
      if (bug.side === 0) g.circle(-16, 13, 8, alpha(C.white, 0.9))
      else g.rrect(-24, 5, 16, 16, 4, alpha(C.white, 0.9))
    },
    sx,
    sy,
  )
  if (p >= 1) {
    // Dizzy stars circle the pancake.
    for (let i = 0; i < 3; i++) {
      const a = now * 4 + (i * Math.PI * 2) / 3
      g.star(x0 + Math.cos(a) * 46, y0 + Math.sin(a) * 26 - 30, 13, C.yellow)
    }
  }
}

/**
 * The stick, with its charge meter around the base: an arc that fills while
 * the charge recovers and glows yellow when a flick will fire one.
 */
function stick(g: Draw, c: StickLook, ready: number, now: number): void {
  const col = SIDE[c.side]
  g.alpha(c.on ? 0.95 : 0.6, () => {
    g.circle(c.bx, c.by, c.r, alpha(col.dark, 0.5), alpha(col.light, 0.55), 5)
    g.circle(c.bx, c.by, c.r * 0.55, undefined, alpha(col.light, 0.18), 4)
    if (ready < 1) {
      const a0 = -Math.PI / 2
      g.arc(c.bx, c.by, c.r + 14, a0, a0 + ready * Math.PI * 2, alpha(col.light, 0.7), 8)
    } else {
      const p = 0.5 + 0.5 * Math.sin(now * 6)
      g.ring(c.bx, c.by, c.r + 14, alpha(C.yellow, 0.45 + p * 0.35), 6 + p * 3)
    }
    g.ball(c.kx, c.ky, c.r * 0.46, col.main, 0.6)
  })
}

/**
 * The size duel by a player's name: their ball against the rival's, drawn to
 * scale, with what it means right now: Flatten (yellow, you are big enough),
 * Run (the rival is), or Grow.
 */
function sizeChip(g: Draw, side: Side, w: World, now: number): void {
  const me = w.bugs[side].ball.r
  const foe = w.bugs[side === 0 ? 1 : 0].ball.r
  const win = flattens(me, foe)
  const lose = flattens(foe, me)
  const x = side === 0 ? 136 : W - 136
  const y = hudY(g, side)
  const label = win ? 'Flatten!' : lose ? 'Run!' : 'Grow'
  const col = win ? C.yellow : lose ? SIDE[side === 0 ? 1 : 0].light : alpha(C.white, 0.75)
  const ate = w.bugs[side].ball.eat
  const pop = ate >= 0 ? Math.max(0, 1 - (w.t - ate) / 0.25) : 0
  const pulse = (win || lose ? 1 + 0.06 * Math.sin(now * 10) : 1) * (1 + 0.1 * pop)
  g.forSide(side, x, y, () => {
    g.at(
      0,
      0,
      0,
      () => {
        g.rrect(-112, -36, 224, 72, 36, win ? alpha(C.yellow, 0.2) : alpha(C.ink, 0.75))
        if (win) g.rrect(-112, -36, 224, 72, 36, undefined, alpha(C.yellow, 0.8), 4)
        // Mine and theirs, to scale (max ball = 22 units here), side by side.
        const k = 22 / 118
        g.ball(-84, 0, Math.max(8, me * k), shade(SIDE[side].main, -0.1), 0.6)
        g.ball(-46, 0, Math.max(8, foe * k), shade(SIDE[side === 0 ? 1 : 0].main, -0.1), 0.6)
        g.text(label, 40, 2, { size: 34, weight: 700, color: col, maxWidth: 136 })
      },
      pulse,
    )
  })
}

/** Seconds left in the round, above the name pill. */
function roundClock(g: Draw, side: Side, left: number): void {
  const sec = Math.max(0, Math.ceil(left))
  const urgent = sec <= 5
  const y = hudY(g, side, 150)
  // The last seconds thump: a pop on each tick.
  const beat = urgent && left > 0 ? Math.max(0, 1 - (sec - left) / 0.25) : 0
  g.forSide(side, W / 2, y, () => {
    g.rrect(-62, -24, 124, 48, 24, urgent ? alpha(C.yellow, 0.2 + beat * 0.25) : alpha(C.ink, 0.7))
    g.text(`0:${String(sec).padStart(2, '0')}`, 0, 2, {
      size: 36 * (1 + beat * 0.18),
      weight: 700,
      color: urgent ? C.yellow : alpha(C.white, 0.85),
    })
  })
}

/** A big word that pops in for both players (two copies in local 2P), stamped by state time. */
export function stamp(
  g: Draw,
  title: string,
  sub: string,
  age: number,
  color: string,
  y = MID,
): void {
  if (age < 0) return
  const k = outBack(clamp(age / 0.34, 0, 1))
  const one = (angle: number, cy: number) =>
    g.at(W / 2, cy, angle, () =>
      g.at(
        0,
        0,
        -0.05 * (1 - k),
        () => {
          const tw = Math.max(g.measure(title, 96, 700), g.measure(sub, 38, 600)) + 110
          const h = sub ? 190 : 150
          g.rrect(-tw / 2, -h / 2 + 8, tw, h, 44, alpha('#000000', 0.4))
          g.rrect(-tw / 2, -h / 2, tw, h, 44, alpha(C.ink, 0.92))
          g.rrect(-tw / 2, -h / 2, tw, h, 44, undefined, alpha(color, 0.9), 6)
          g.text(title, 0, sub ? -22 : 4, {
            size: 96,
            weight: 700,
            color,
            drop: alpha('#000000', 0.45),
          })
          if (sub) g.text(sub, 0, 52, { size: 38, weight: 600, color: alpha(C.white, 0.85) })
        },
        k,
      ),
    )
  g.alpha(clamp(age * 6, 0, 1), () => {
    if (g.flipTop) {
      one(g.orient(0), y + 150)
      one(g.orient(1), y - 150)
    } else one(g.orient(), y)
  })
}

/** A ring bursting out of the pip a player just won. */
function pipPop(g: Draw, side: Side, wins: number, target: number, age: number): void {
  if (age < 0 || age > 0.7 || wins < 1) return
  const k = age / 0.7
  const gap = 46
  const px = target > 5 ? -40 : -((target - 1) * gap) / 2 + (wins - 1) * gap
  g.forSide(side, side === 0 ? W - 130 : 130, hudY(g, side), () => {
    g.ring(px, 0, 15 + k * 46, alpha(SIDE[side].light, 1 - k), 8 * (1 - k) + 2)
    g.circle(px, 0, 15 * (1 + 0.5 * Math.sin(k * Math.PI)), alpha(SIDE[side].light, 0.6 * (1 - k)))
  })
}

export function renderDung(
  g: Draw,
  s: State,
  now: number,
  names: [string, string],
  over: boolean,
  look: Look,
): void {
  const w = s.w
  const r = s.rounds
  dish(g)
  w.pellets.forEach((p, i) => {
    if (p.on) pellet(g, p, w.t, now, i)
  })
  const [A, B] = w.bugs
  const threat: [boolean, boolean] = [
    w.flattened === null && flattens(A.ball.r, B.ball.r),
    w.flattened === null && flattens(B.ball.r, A.ball.r),
  ]
  // Beetles first: each one pushes from behind, its head tucked under its ball.
  for (const bug of w.bugs) {
    const o = look.poses[bug.side]
    beetle(g, bug, w, threat[bug.side === 0 ? 1 : 0] && r.phase === 'play', now, o.bx, o.by, o.ba)
  }
  // The round's winner does a little victory hop between rounds.
  const since = now - r.at
  for (const bug of w.bugs) {
    const o = look.poses[bug.side]
    const hop =
      (r.phase === 'between' || over) && r.last === bug.side
        ? 0.09 * Math.abs(Math.sin(since * 7)) * Math.exp(-since * 0.9)
        : 0
    ball(g, bug.ball, bug.side, w.t, threat[bug.side], o.cx, o.cy, look.trails[bug.side], hop)
  }
  for (const st of s.sticks) {
    // Online, each phone shows only its own player's stick.
    if (g.viewer !== null && st.side !== g.viewer) continue
    const b = w.bugs[st.side].beetle
    stick(g, st, clamp(1 - (b.ready - w.t) / DASH_CD, 0, 1), now)
  }
  for (const side of [0, 1] as Side[]) {
    namePill(g, side, names[side], { active: threat[side] })
    pips(g, side, r.wins[side], r.target, { x: side === 0 ? W - 130 : 130 })
    if (r.phase === 'between' && r.last === side) pipPop(g, side, r.wins[side], r.target, since)
    sizeChip(g, side, w, now)
    if (r.phase === 'play') roundClock(g, side, ROUND_T - w.t)
  }
  // Round start (with the charge tip on the first), round end and the final whistle.
  const intro = r.round > 1 ? 1.2 : 1.9
  if (r.phase === 'play' && since < intro && w.t < intro) {
    const a = 1 - clamp((since - intro + 0.35) / 0.35, 0, 1)
    const title = r.round > 1 ? `Round ${r.round}` : 'Roll!'
    const sub = r.round > 1 ? '' : 'Flick the stick to charge'
    g.alpha(a, () => stamp(g, title, sub, since, C.white))
  } else if (r.phase === 'between' || over) {
    const last = r.last
    const flat = w.flattened !== null
    const title = flat ? 'Splat!' : 'Time!'
    const col = last === 0 || last === 1 ? SIDE[last].light : C.white
    const who =
      last === 'draw' || last === null
        ? 'Level balls: draw'
        : over
          ? `${names[last]} wins the match`
          : flat
            ? `${names[last]} flattens!`
            : `${names[last]}'s ball is bigger`
    stamp(g, title, who, since - (flat ? 0.35 : 0), col)
  }
}
