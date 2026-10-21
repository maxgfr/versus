import { inFrame } from '../../core/frame.ts'
import { clamp, outBack, outCubic } from '../../core/fx/ease.ts'
import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, shade, SIDE } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import {
  BOLT_TIME,
  BOW,
  type Bolt,
  FRESH,
  KINDS,
  MARK_TIME,
  type Miss,
  type Pop,
  RELOAD,
  type State,
  type Target,
} from './rules.ts'

/** Top and bottom of the gallery, where the marquee lights run. */
const TOP = 292
const BOTTOM = H - TOP

/** The shooting gallery floor: dark boards, each end washed in its team colour, marquee lights. */
export function drawField(g: Draw, s: State): void {
  g.fillView(shade('#2b1d3a', -0.35))
  const v = g.stage.view
  // Floor boards across the gallery.
  for (let y = TOP; y < BOTTOM; y += 90) {
    const i = Math.round((y - TOP) / 90)
    g.rect(v.x - 2, y, v.w + 4, 88, i % 2 ? shade('#3a2a4a', -0.25) : shade('#3a2a4a', -0.32))
  }
  // Team ends.
  g.rect(v.x - 2, v.y - 2, v.w + 4, TOP - v.y + 2, shade(SIDE[1].main, -0.7))
  g.rect(v.x - 2, BOTTOM, v.w + 4, v.y + v.h - BOTTOM + 2, shade(SIDE[0].main, -0.7))
  g.fillView(
    g.rad(W / 2, MID, 120, 900, [
      [0, alpha('#fff0d0', 0.1)],
      [1, alpha('#000000', 0.35)],
    ]),
  )
  // Marquee rails with chasing bulbs; a side's bulbs flash its colour when it scores.
  for (const side of [0, 1] as Side[]) {
    const y = side === 0 ? BOTTOM : TOP
    const last = s.pops.filter((p) => p.side === side).reduce((m, p) => Math.max(m, p.at), -9)
    const hot = clamp(1 - (s.now - last) / 0.5, 0, 1)
    g.rect(v.x - 2, y - 14, v.w + 4, 28, shade(C.ink, 0.05))
    g.rect(v.x - 2, y - 14, v.w + 4, 6, alpha('#ffffff', 0.08))
    const n = 16
    for (let i = 0; i < n; i++) {
      const x = 40 + (i * (W - 80)) / (n - 1)
      const on = (i + Math.floor(s.now * 6)) % 3 === 0
      const col = hot > 0 ? SIDE[side].light : on ? C.yellow : shade(C.yellow, -0.55)
      if (on || hot > 0) g.alpha(0.35, () => g.circle(x, y, 22, col))
      g.circle(x, y, 10, col)
    }
  }
  g.vignette(0.3)
}

const BALLOON = [C.pink, C.cyan, C.purple, C.orange, C.green]

/** Badge with a target's value, upright for whoever is nearer. */
function valueBadge(g: Draw, t: Target, k: number, pts: number, hot: boolean): void {
  const side: Side = t.y < MID ? 1 : 0
  const bx = t.x + t.r * k * 0.78
  const by = t.y - t.r * k * 0.78
  g.forSide(side, bx, by, () => {
    g.circle(0, 0, 25, hot ? C.yellow : C.ink)
    g.circle(0, 0, 25, undefined, hot ? shade(C.yellow, -0.4) : alpha('#ffffff', 0.5), 3)
    g.text(pts, 0, 2, { size: 34, weight: 700, color: hot ? C.ink : C.white })
  })
}

/** A target popping up (flips up like a gallery target), its time running out on a ring. */
export function drawTarget(g: Draw, t: Target, now: number): void {
  const age = now - t.born
  const left = t.life - age
  const grow = outBack(clamp(age / 0.28, 0, 1))
  const fade = clamp(left / 0.25, 0, 1)
  if (fade <= 0 || grow <= 0.01) return
  const k = Math.max(0.01, grow)
  g.alpha(fade, () => {
    const frac = clamp(left / t.life, 0, 1)
    // Time left, as a ring that runs down and turns red at the end.
    g.circle(t.x, t.y, t.r * k + 16, undefined, alpha(C.ink, 0.5), 10)
    g.arc(
      t.x,
      t.y,
      t.r * k + 16,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * frac,
      frac < 0.3 ? C.red : alpha(C.white, 0.75),
      7,
    )
    if (t.kind === 'bull') drawBull(g, t.x, t.y, t.r, k)
    else if (t.kind === 'can') drawCan(g, t.x, t.y, t.r, k, 0)
    else drawBalloon(g, t, k, age)
    const fresh = t.kind === 'balloon' && age <= t.life * FRESH
    valueBadge(g, t, k, fresh ? 4 : KINDS[t.kind].pts, fresh)
  })
}

function drawBull(g: Draw, x: number, y: number, r0: number, k: number): void {
  const r = r0 * k
  g.shadow(x + 10, y + r * 0.55, r * 1.0, r * 0.4, 0.45)
  // Straw boss with painted rings, flipping up out of the floor.
  g.at(
    x,
    y,
    0,
    () => {
      g.circle(0, 8, r, shade('#c99a52', -0.4))
      g.circle(0, 0, r, '#e9c47e')
      g.circle(0, 0, r * 0.86, C.white)
      g.circle(0, 0, r * 0.72, C.red)
      g.circle(0, 0, r * 0.56, C.white)
      g.circle(0, 0, r * 0.4, C.red)
      g.circle(0, 0, r * 0.22, C.yellow)
      g.ring(0, 0, r * 0.22, shade(C.yellow, -0.4), 3)
      g.alpha(0.4, () => g.ellipse(-r * 0.32, -r * 0.4, r * 0.32, r * 0.14, '#fff', -0.6))
    },
    1,
    k,
  )
}

function drawCan(g: Draw, x: number, y: number, r0: number, k: number, rot: number): void {
  const r = r0 * k
  g.shadow(x + 10, y + r * 0.7, r * 0.95, r * 0.4, 0.45)
  g.at(x, y, rot, () => {
    // Label band round the rim, then the lid.
    g.circle(0, 6, r, shade(C.green, -0.45))
    g.circle(0, 0, r, C.green)
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      if (i % 2) g.arc(0, 0, r * 0.93, a, a + 0.5, alpha('#ffffff', 0.55), r * 0.12)
    }
    g.circle(
      0,
      0,
      r * 0.8,
      g.rad(
        0,
        0,
        r * 0.05,
        r * 0.8,
        [
          [0, '#ffffff'],
          [0.6, '#c3cbd9'],
          [1, '#7d889e'],
        ],
        -r * 0.25,
        -r * 0.25,
      ),
    )
    g.ring(0, 0, r * 0.68, alpha('#000000', 0.18), 3)
    g.rrect(-r * 0.32, -r * 0.13, r * 0.5, r * 0.26, r * 0.12, '#dfe5ee', alpha('#000', 0.3), 3)
    g.circle(r * 0.16, 0, r * 0.08, C.ink3)
  })
}

function drawBalloon(g: Draw, t: Target, k: number, age: number): void {
  const rx = t.r * 0.82 * k
  const ry = t.r * k
  const col = BALLOON[t.id % BALLOON.length] ?? C.pink
  const sway = Math.sin(age * 3 + t.id) * 6
  const cx = t.x + sway
  const cy = t.y - ry * 0.1
  g.shadow(t.x + 18, t.y + ry + 50, rx * 0.7, 12, 0.3)
  // String and knot.
  g.path(
    (c) => {
      c.moveTo(cx, cy + ry)
      c.quadraticCurveTo(cx - 14, cy + ry + 40, cx + 6, cy + ry + 84)
    },
    undefined,
    alpha(C.white, 0.6),
    3,
  )
  g.poly([cx - 9, cy + ry - 4, cx + 9, cy + ry - 4, cx, cy + ry + 12], shade(col, -0.3))
  g.ellipse(
    cx,
    cy,
    rx,
    ry,
    g.rad(
      cx,
      cy,
      rx * 0.1,
      ry,
      [
        [0, shade(col, 0.5)],
        [0.6, col],
        [1, shade(col, -0.35)],
      ],
      cx - rx * 0.35,
      cy - ry * 0.35,
    ),
  )
  g.alpha(0.75, () => g.ellipse(cx - rx * 0.36, cy - ry * 0.42, rx * 0.17, ry * 0.24, '#fff', -0.5))
}

/** A hit target bursting: rings scatter, cans fly off, balloons pop. */
export function drawPop(g: Draw, p: Pop, now: number): void {
  const t = now - p.at
  if (t < 0 || t > MARK_TIME) return
  const bow = BOW[p.side] as { x: number; y: number }
  const away = Math.atan2(p.y - bow.y, p.x - bow.x)
  if (p.kind === 'can') {
    const d = outCubic(clamp(t / 0.7, 0, 1)) * 380
    const x = p.x + Math.cos(away) * d
    const y = p.y + Math.sin(away) * d
    g.alpha(1 - clamp((t - 0.35) / 0.35, 0, 1), () => drawCan(g, x, y, p.r, 1 + t * 0.4, t * 14))
    return
  }
  if (p.kind === 'bull') {
    const k = outCubic(clamp(t / 0.45, 0, 1))
    g.alpha(1 - k, () => {
      // The boss splits in two and the halves slide apart.
      for (const sgn of [-1, 1]) {
        const ox = Math.cos(away + Math.PI / 2) * sgn * k * 90
        const oy = Math.sin(away + Math.PI / 2) * sgn * k * 90
        g.at(p.x + ox, p.y + oy, sgn * k * 0.8, () =>
          g.clip(sgn < 0 ? -p.r : 0, -p.r, p.r, p.r * 2, 0, () => drawBull(g, 0, 0, p.r, 1)),
        )
      }
    })
    stuckBolt(g, p.side, p.x, p.y, away, 1 - clamp((t - 0.5) / 0.3, 0, 1))
    return
  }
  // Balloon: a quick star of rubber, then nothing.
  const k = clamp(t / 0.22, 0, 1)
  g.alpha(1 - k, () =>
    g.star(p.x, p.y, p.r * (1 + k * 0.9), BALLOON[p.id % BALLOON.length] ?? C.pink, 9, 0.45),
  )
}

/** A bolt lodged where it landed, pointing the way it flew. */
function stuckBolt(g: Draw, side: Side, x: number, y: number, a: number, fade: number): void {
  if (fade <= 0) return
  g.alpha(fade, () =>
    g.at(x, y, a, () => {
      g.line(-70, 0, 0, 0, shade(C.woodDark, -0.2), 7)
      g.poly([-70, 0, -88, -12, -80, 0, -88, 12], SIDE[side].main)
      g.circle(0, 0, 7, C.ink)
    }),
  )
}

export function drawMiss(g: Draw, m: Miss, now: number): void {
  const t = now - m.at
  const bow = BOW[m.side] as { x: number; y: number }
  const a = Math.atan2(m.y - bow.y, m.x - bow.x)
  const wob = t < 0.25 ? Math.sin(t * 60) * 0.12 * (1 - t / 0.25) : 0
  stuckBolt(g, m.side, m.x, m.y, a + wob, 1 - clamp((t - 0.5) / 0.4, 0, 1))
}

/** The crossbow at a player's edge, turned toward its last shot; kicks back when it fires. */
export function drawBow(g: Draw, s: State, side: Side): void {
  const col = SIDE[side]
  const b = BOW[0] as { x: number; y: number }
  const ready = 1 - Math.min(1, s.reload[side] / RELOAD)
  const since = s.now - s.shotAt[side]
  const kick = since >= 0 && since < 0.25 ? Math.exp(-since * 14) * 22 : 0
  // World aim → this side's frame (blue's frame is turned half a turn).
  const local = s.aim[side] - (side === 1 ? Math.PI : 0)
  const rot = local + Math.PI / 2
  inFrame(g, side, () => {
    g.shadow(b.x + 8, b.y + 50, 90, 26, 0.45)
    g.at(b.x, b.y, rot, () =>
      g.at(0, kick, 0, () => {
        // Stock in the team's paint, with a metal band (short enough to clear the name pill).
        g.rrect(-30, -12, 60, 92, 24, shade(col.main, -0.45))
        g.rrect(-26, -16, 52, 88, 22, col.main)
        g.rrect(-18, -10, 14, 70, 7, alpha('#ffffff', 0.25))
        g.rrect(-28, 24, 56, 12, 4, '#9aa3b5')
        g.sideMark(side, 0, 56, 13, C.white)
        // Rail.
        g.rrect(-12, -150, 24, 156, 8, shade(C.woodDark, -0.25))
        g.rrect(-8, -146, 6, 148, 3, alpha('#ffffff', 0.15))
        // Limbs.
        g.arc(0, 4, 132, Math.PI + 0.38, Math.PI * 2 - 0.38, shade(C.woodDark, -0.35), 26)
        g.arc(0, 4, 132, Math.PI + 0.38, Math.PI * 2 - 0.38, C.wood, 13)
        g.alpha(0.35, () => g.arc(0, 0, 134, Math.PI + 0.5, Math.PI * 1.4, '#ffffff', 5))
        // String, drawn back while cocked.
        const sx = Math.cos(0.38) * 130
        const sy = -Math.sin(0.38) * 130 + 4
        const mid = sy + 64 * ready
        g.line(-sx, sy, 0, mid, C.cream, 5)
        g.line(sx, sy, 0, mid, C.cream, 5)
        if (ready >= 1) {
          // Loaded bolt: steel head, team fletching.
          g.line(0, mid, 0, -136, shade(C.woodDark, -0.1), 7)
          g.poly([0, -164, -12, -134, 12, -134], '#dfe6f2')
          g.poly([0, mid - 6, -12, mid + 14, 0, mid + 6, 12, mid + 14], col.light)
        }
      }),
    )
    if (ready < 1) {
      // Reload gauge: an arc over the limbs, toward the targets, never across the HUD row.
      g.arc(b.x, b.y + 4, 172, Math.PI + 0.3, Math.PI * 2 - 0.3, alpha(C.ink, 0.45), 10)
      g.arc(
        b.x,
        b.y + 4,
        172,
        Math.PI + 0.3,
        Math.PI + 0.3 + (Math.PI - 0.6) * ready,
        alpha(col.light, 0.9),
        8,
      )
    }
  })
}

/** A bolt in flight from the crossbow to where it was aimed, with a streak behind. */
export function drawBolt(g: Draw, b: Bolt, now: number): void {
  const o = BOW[b.side] as { x: number; y: number }
  const p = clamp(1 - (b.at - now) / BOLT_TIME, 0, 1)
  const hx = o.x + (b.x - o.x) * p
  const hy = o.y + (b.y - o.y) * p
  const a = Math.atan2(b.y - o.y, b.x - o.x)
  const col = SIDE[b.side]
  const q = Math.max(0, p - 0.18)
  g.line(o.x + (b.x - o.x) * q, o.y + (b.y - o.y) * q, hx, hy, alpha(col.light, 0.3), 14)
  g.at(hx, hy, a, () => {
    g.line(-80, 0, 0, 0, shade(C.woodDark, -0.1), 7)
    g.poly([18, 0, -6, -11, -6, 11], '#dfe6f2')
    g.poly([-80, 0, -98, -13, -88, 0, -98, 13], col.main)
  })
}

export function render(g: Draw, s: State): void {
  drawField(g, s)
  for (const m of s.misses) drawMiss(g, m, s.now)
  for (const t of [...s.targets].sort((a, b) => a.y - b.y)) drawTarget(g, t, s.now)
  for (const p of s.pops) drawPop(g, p, s.now)
  for (const b of s.bolts) drawBolt(g, b, s.now)
  for (const side of [0, 1] as Side[]) drawBow(g, s, side)
}
