import type { Side } from '../../core/game.ts'
import { inOutCubic, outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { floodlight } from './ending.ts'
import { CAP } from './rules.ts'

/** Nut colours: distinct hues, and each also carries its own engraved mark (never colour alone). */
export const NUT_COLOURS = [C.pink, C.cyan, C.yellow, C.green, C.purple, C.orange] as const

/** Nut radius (centre to corner), half the height of its sides, and the stack pitch. */
const R = 54
const HH = 30
export const STEP = HH * 2 + 3
/** How far a lifted run is spun up its bolt, above where it sat. */
export const LIFT = 56
/** How much of the top face shows: the table is seen from a little above. */
const TILT = 0.3
/** The angle at which a nut shows one face square on. */
const REST = -Math.PI / 6
/** Seconds for a lifted run to spin up, and for a dropped run to fly over and screw down. */
export const LIFT_T = 0.18
export const MOVE_T = 0.42

/**
 * Where the bolts stand in a panel of w × h. A half holds all eight in one row
 * near the player's edge; solo (the whole stage) stands them bigger in two rows
 * of four, the first row ending above the pause button on the left edge.
 */
export interface Geo {
  solo: boolean
  /** Scale of nuts and bolts. */
  k: number
  pitch: number
  /** Plate top of each row. */
  bases: number[]
  w: number
}

export function geometry(w: number, h: number): Geo {
  const solo = h > 1000
  return solo
    ? { solo, k: 1.22, pitch: 235, bases: [735, 1620], w }
    : { solo, k: 1, pitch: 120, bases: [772], w }
}

/** Centre x and plate top of bolt i. */
export function place(g: Geo, i: number): { x: number; base: number } {
  if (!g.solo) return { x: g.w / 2 + (i - 3.5) * g.pitch, base: g.bases[0] ?? 0 }
  return { x: g.w / 2 + ((i % 4) - 1.5) * g.pitch, base: g.bases[i < 4 ? 0 : 1] ?? 0 }
}

/** Centre y of nut j (0 = bottom) on a bolt standing on `base`. */
export function nutY(g: Geo, base: number, j: number): number {
  return base - g.k * (HH + 6 + j * STEP)
}

/** Top of the threaded rod. */
export function rodTop(g: Geo, base: number): number {
  return base - g.k * (HH + 6 + (CAP - 1) * STEP + HH + LIFT + 26)
}

/** Centre y of nut k of a run lifted off a bolt that keeps `below` nuts. */
export function hoverY(g: Geo, base: number, below: number, k: number): number {
  return nutY(g, base, below + k) - g.k * LIFT
}

/** Hit test for the bolt under a panel-local point, or -1. */
export function boltAt(g: Geo, bolts: number, px: number, py: number): number {
  for (let i = 0; i < bolts; i++) {
    const p = place(g, i)
    const top = rodTop(g, p.base) - 110 * g.k
    if (Math.abs(px - p.x) <= g.pitch / 2 && py >= top && py <= p.base + 52 * g.k) return i
  }
  return -1
}

/** The engraved mark of a colour, centred on (0, 0) with radius r. */
function mark(g: Draw, kind: number, r: number, ink: string): void {
  switch (kind % 6) {
    case 0:
      g.ring(0, 0, r * 0.62, ink, r * 0.32)
      break
    case 1:
      g.rrect(-r * 0.62, -r * 0.62, r * 1.24, r * 1.24, r * 0.2, ink)
      break
    case 2:
      g.poly([0, -r * 0.78, r * 0.74, r * 0.56, -r * 0.74, r * 0.56], ink)
      break
    case 3:
      g.star(0, r * 0.06, r * 0.86, ink)
      break
    case 4:
      g.poly([0, -r * 0.8, r * 0.66, 0, 0, r * 0.8, -r * 0.66, 0], ink)
      break
    default:
      g.line(-r * 0.66, 0, r * 0.66, 0, ink, r * 0.34, 'round')
      g.line(0, -r * 0.66, 0, r * 0.66, ink, r * 0.34, 'round')
  }
}

/**
 * A hex nut seen from a little above: six side faces turned by `spin` (only
 * those facing the viewer are drawn, each lit by how much it faces the light),
 * a bevelled top face with the bolt hole, and the colour's mark on the faces.
 * `glow` (0..1) washes it towards white for a glint.
 */
export function nut(
  g: Draw,
  cx: number,
  cy: number,
  colour: number,
  k: number,
  spin = 0,
  glow = 0,
): void {
  const col = NUT_COLOURS[colour % NUT_COLOURS.length] ?? C.pink
  const r = R * k
  const hh = HH * k
  const dy = r * TILT
  const theta = REST + spin
  const vx: number[] = []
  const vz: number[] = []
  for (let v = 0; v < 6; v++) {
    const a = theta + (v * Math.PI) / 3
    vx.push(cx + Math.sin(a) * r)
    vz.push(Math.cos(a))
  }
  const top = cy - hh
  const bot = cy + hh
  const lit = (c: string) => (glow > 0 ? mix(c, '#ffffff', glow * 0.7) : c)
  // Contact shadow on whatever it rests on.
  g.ellipse(cx + 3 * k, bot + dy * 0.55, r * 0.98, dy * 1.05, alpha('#000000', 0.28))
  // Side faces, back to front is not needed: only faces turned to the viewer are drawn.
  for (let v = 0; v < 6; v++) {
    const w = (v + 1) % 6
    const n = theta + (v * Math.PI) / 3 + Math.PI / 6
    const facing = Math.cos(n)
    if (facing <= 0.02) continue
    const x0 = vx[v] ?? cx
    const x1 = vx[w] ?? cx
    const z0 = vz[v] ?? 0
    const z1 = vz[w] ?? 0
    // Light from the front left.
    const light = Math.max(0, -0.45 * Math.sin(n) + 0.9 * facing)
    const face = lit(mix(shade(col, -0.5), shade(col, 0.18), light))
    const pts = [x0, top + z0 * dy, x1, top + z1 * dy, x1, bot + z1 * dy, x0, bot + z0 * dy]
    g.poly(pts, face)
    // Brushed-metal sheen: bright under the top chamfer, darker towards the bottom.
    g.poly(
      pts,
      g.lin(0, top - dy, 0, bot + dy, [
        [0, 'rgba(255,255,255,0.34)'],
        [0.32, 'rgba(255,255,255,0.04)'],
        [0.7, 'rgba(0,0,0,0)'],
        [1, 'rgba(0,0,0,0.3)'],
      ]),
    )
    // The colour's mark, foreshortened with the face.
    if (facing > 0.4) {
      const mx = (x0 + x1) / 2
      const my = cy + ((z0 + z1) / 2) * dy + hh * 0.06
      g.at(mx, my, 0, () => mark(g, colour, hh * 0.56, alpha(C.ink, 0.62)), facing, 1)
    }
    // Crisp edge between faces.
    g.line(x0, top + z0 * dy + 2, x0, bot + z0 * dy - 2, alpha('#000000', 0.18), 2)
  }
  // Top face: a lighter hexagon with a chamfer and the threaded hole.
  const tp: number[] = []
  for (let v = 0; v < 6; v++) tp.push(vx[v] ?? cx, top + (vz[v] ?? 0) * dy)
  g.poly(tp, lit(shade(col, 0.3)), shade(col, -0.45), 3 * k)
  g.ellipse(cx, top, r * 0.5, dy * 0.52, alpha('#ffffff', 0.16))
  g.ellipse(cx, top, r * 0.34, dy * 0.36, '#2a2433')
  g.ellipse(cx, top + dy * 0.08, r * 0.24, dy * 0.24, '#9aa6b8')
}

/** The steel gradient across a rod of half-width hw at x. */
function steel(g: Draw, x: number, hw: number): CanvasGradient {
  return g.lin(x - hw, 0, x + hw, 0, [
    [0, '#5b6577'],
    [0.38, '#eef2f8'],
    [0.6, '#b9c3d1'],
    [1, '#46505f'],
  ])
}

/** A threaded bolt: a washer plate, a rod with thread marks and a domed cap. */
export function bolt(g: Draw, cx: number, base: number, top: number, k: number): void {
  const hw = 15 * k
  // Washer plate: a short cylinder.
  const pr = 62 * k
  const pd = 15 * k
  const py = base + 8 * k
  g.ellipse(cx + 4, py + pd + 10 * k, pr * 1.05, pd * 1.1, alpha('#000000', 0.35))
  g.rrect(cx - pr, py, pr * 2, pd, 0, shade('#6f7a8c', -0.3))
  g.ellipse(cx, py + pd, pr, pd * 0.9, shade('#6f7a8c', -0.4))
  g.rect(cx - pr, py, pr * 2, pd, steel(g, cx, pr))
  g.ellipse(cx, py, pr, pd * 0.9, shade('#9aa6b8', 0.1))
  g.ellipse(cx, py, pr * 0.7, pd * 0.55, alpha('#ffffff', 0.18))
  // Rod with a helical thread.
  g.rect(cx - hw, top, hw * 2, py - top, steel(g, cx, hw))
  const pitch = 13 * k
  for (let y = top + 18 * k; y < py - 4; y += pitch) {
    g.line(cx - hw + 1, y + 5 * k, cx + hw - 1, y - 5 * k, alpha('#262c38', 0.42), 3.5 * k)
    g.line(cx - hw + 2, y + 8 * k, cx + hw - 2, y - 2 * k, alpha('#ffffff', 0.22), 2 * k)
  }
  g.ellipse(cx, top, hw, hw * 0.6, steel(g, cx, hw))
  g.ellipse(cx - hw * 0.25, top - hw * 0.1, hw * 0.45, hw * 0.25, alpha('#ffffff', 0.55))
}

export interface Hand {
  from: number
  c: number
  n: number
  at: number
}

export interface Move {
  from: number
  to: number
  c: number
  /** Nuts that went onto `to`, and those that did not fit and went back on `from`. */
  n: number
  back: number
  at: number
}

export interface BoltsView {
  side: Side
  bolts: readonly (readonly number[])[]
  hand: Hand | null
  move: Move | null
  /** Bolts that would take the hand (cued while a run is lifted). */
  accepts: readonly boolean[]
  /** Per bolt: when it was completed (full and one colour), or -10. */
  capAt: readonly number[]
  bad: number
  badAt: number
  now: number
}

/**
 * Where a flying nut is at t (0..1): it spins up off its bolt to `over`, crosses
 * above the rods, then screws straight down onto the target.
 */
function hop(x0: number, y0: number, x1: number, y1: number, over: number, t: number) {
  const x = x0 + (x1 - x0) * inOutCubic(prog(t, 0.22, 0.66))
  const up = outCubic(prog(t, 0, 0.3))
  const down = inOutCubic(prog(t, 0.62, 1))
  const y = t < 0.62 ? y0 + (over - y0) * up : over + (y1 - over) * down
  return { x, y }
}

/** Every bolt with its stack, the lifted run spinning above its source, flying runs, and the cues for taps. */
export function drawBolts(g: Draw, geo: Geo, v: BoltsView): void {
  const k = geo.k
  const col = SIDE[v.side]
  const mv = v.move && v.now - v.move.at < MOVE_T ? v.move : null
  const flying: { x: number; y: number; c: number; spin: number; sq: number }[] = []
  // Back row first in solo so the front row's flying nuts read on top.
  v.bolts.forEach((stack, i) => {
    const { x: cx, base } = place(geo, i)
    const top = rodTop(geo, base)
    if (v.accepts[i]) {
      // A soft column of light on the bolts that would take the run.
      const pulse = 0.5 + 0.5 * Math.sin(v.now * 7)
      g.rrect(
        cx - geo.pitch / 2 + 8,
        top - 30 * k,
        geo.pitch - 16,
        base - top + 70 * k,
        40 * k,
        alpha(col.light, 0.06 + pulse * 0.05),
      )
    }
    bolt(g, cx, base, top, k)
    const hot = v.bad === i && v.now - v.badAt < 0.4
    const wob = hot ? Math.sin((v.now - v.badAt) * 50) * 9 * (1 - (v.now - v.badAt) / 0.4) : 0
    // Nuts still in flight are not on their bolt yet.
    let shown = stack.length
    if (mv && i === mv.to) shown -= mv.n
    if (mv && i === mv.from) shown -= mv.back
    const cap = v.capAt[i] ?? -10
    const sweep = v.now - cap
    for (let j = 0; j < shown; j++) {
      const c = stack[j] ?? 0
      const y = nutY(geo, base, j)
      // A glint runs up a bolt as it is completed.
      const glow = sweep >= 0 && sweep < 0.7 ? Math.max(0, 1 - Math.abs(sweep * 8 - j - 0.5)) : 0
      nut(g, cx + wob, y, c, k, 0, glow)
    }
    if (hot) g.text('✕', cx, top - 40 * k, { size: 44 * k, weight: 700, color: C.red })
    // The completed badge under the plate.
    if (cap > 0 && stack.length === CAP) {
      const s = outBack(prog(v.now - cap, 0, 0.35))
      g.at(
        cx,
        base + 58 * k,
        0,
        () => {
          g.circle(0, 2, 20, shade(C.green, -0.4))
          g.circle(0, 0, 20, C.green)
          g.line(-9, 0, -2, 7, C.white, 6)
          g.line(-2, 7, 10, -7, C.white, 6)
        },
        s * k,
      )
    }
    // The lifted run, spinning up off its bolt and bobbing while it waits.
    if (v.hand?.from === i) {
      const h = v.hand
      const t = prog(v.now - h.at, 0, LIFT_T)
      const e = outCubic(t)
      const bob = t >= 1 ? Math.sin(v.now * 5) * 4 * k : 0
      const glowY = hoverY(geo, base, stack.length, 0)
      const pulse = 0.55 + 0.45 * Math.sin(v.now * 6)
      g.path(
        (c) => c.ellipse(cx, glowY + (HH + 14) * k, 70 * k, 20 * k, 0, 0, Math.PI * 2),
        undefined,
        alpha(C.yellow, 0.35 + pulse * 0.4 * e),
        5,
      )
      for (let n = 0; n < h.n; n++) {
        const y0 = nutY(geo, base, stack.length + n)
        const y1 = hoverY(geo, base, stack.length, n)
        const spin = -(1 - e) * Math.PI * 0.9 + (t >= 1 ? Math.sin(v.now * 2.4) * 0.12 : 0)
        flying.push({ x: cx, y: y0 + (y1 - y0) * e + bob, c: h.c, spin, sq: 1 })
      }
    }
  })
  // A dropped run flies over the bolts and screws down onto its target.
  if (mv) {
    const t = prog(v.now - mv.at, 0, MOVE_T)
    const src = place(geo, mv.from)
    const dst = place(geo, mv.to)
    const srcStack = v.bolts[mv.from] ?? []
    const dstStack = v.bolts[mv.to] ?? []
    const below = srcStack.length - mv.back
    const over = Math.min(rodTop(geo, src.base), rodTop(geo, dst.base)) - (HH + 30) * k
    const bump = Math.max(0, 1 - Math.abs(t - 0.96) * 14)
    for (let n = 0; n < mv.n + mv.back; n++) {
      const y0 = hoverY(geo, src.base, below, n)
      if (n >= mv.n) {
        // What did not fit spins back down onto its own bolt.
        const y1 = nutY(geo, src.base, below + (n - mv.n))
        const e = inOutCubic(t)
        flying.push({ x: src.x, y: y0 + (y1 - y0) * e, c: mv.c, spin: e * Math.PI, sq: 1 })
        continue
      }
      const y1 = nutY(geo, dst.base, dstStack.length - mv.n + n)
      if (mv.from === mv.to) {
        const e = inOutCubic(t)
        flying.push({ x: src.x, y: y0 + (y1 - y0) * e, c: mv.c, spin: e * Math.PI, sq: 1 })
        continue
      }
      // The run keeps its spacing in the air.
      const p = hop(src.x, y0, dst.x, y1, over - n * STEP * k, t)
      const spin = -outCubic(prog(t, 0, 0.3)) * Math.PI + prog(t, 0.62, 1) * Math.PI * 2
      flying.push({ x: p.x, y: p.y, c: mv.c, spin, sq: 1 + bump * 0.12 })
    }
  }
  for (const f of flying) {
    g.at(f.x, f.y, 0, () => nut(g, 0, 0, f.c, k, f.spin), f.sq, 2 - f.sq)
  }
}

/** The workshop: a pegboard and a floodlight pool behind the bolts. */
export function backdrop(g: Draw, side: Side, geo: Geo, h: number): void {
  for (const base of geo.bases) floodlight(g, side, geo.w / 2, base - 220 * geo.k, 560 * geo.k)
  for (let y = 130; y < h; y += 56) {
    for (let x = 28; x < geo.w; x += 56) g.circle(x, y, 2.5, alpha(C.white, 0.06))
  }
  // A shelf the bolts stand on.
  for (const base of geo.bases) {
    const y = base + 30 * geo.k
    g.rrect(16, y, geo.w - 32, 26 * geo.k, 13 * geo.k, alpha('#000000', 0.32))
    g.rrect(16, y - 6, geo.w - 32, 24 * geo.k, 12 * geo.k, shade(SIDE[side].main, -0.66))
    g.rrect(26, y - 4, geo.w - 52, 6, 3, alpha(C.white, 0.08))
  }
}
