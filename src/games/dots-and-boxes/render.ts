import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { W } from '../../core/stage.ts'
import type { Geom } from '../../engines/board/index.ts'
import type { State } from './index.ts'
import { BOX_COUNT, BOXES, DOTS, lineEnds } from './rules.ts'

/** Seconds a drawn line takes to run out from its middle to both dots. */
export const LINE_GROW = 0.14
/** Seconds a completed box takes to fill. */
const FILL = 0.34
/** Thickness of a drawn line. */
const STICK = 30
const SLAB = C.ink3

/** World position of dot (r, c). */
export function dot(geo: Geom, r: number, c: number): { x: number; y: number } {
  return { x: geo.x + c * geo.cell, y: geo.y + r * geo.cell }
}

/** Midpoint of line `e`. */
export function midpoint(geo: Geom, e: number): { x: number; y: number } {
  const [[r0, c0], [r1, c1]] = lineEnds(e)
  const a = dot(geo, r0, c0)
  const b = dot(geo, r1, c1)
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** Centre of box `box`. */
export function boxCentre(geo: Geom, box: number): { x: number; y: number } {
  const r = Math.floor(box / BOXES)
  const c = box % BOXES
  return { x: geo.x + (c + 0.5) * geo.cell, y: geo.y + (r + 0.5) * geo.cell }
}

/** The slab under the dots, with a faint well in every box. */
function slab(g: Draw, geo: Geom): void {
  const pad = 52
  const depth = 26
  const x = geo.x - pad
  const y = geo.y - pad
  const w = geo.w + pad * 2
  const h = geo.h + pad * 2
  g.shadow(W / 2, y + h + depth + 14, w * 0.56, 40, 0.45)
  g.tile(x, y, w, h + depth, 48, SLAB, depth)
  for (let box = 0; box < BOX_COUNT; box++) {
    const { x: cx, y: cy } = boxCentre(geo, box)
    const k = geo.cell / 2 - 16
    g.rrect(cx - k, cy - k, k * 2, k * 2, 18, shade(SLAB, -0.32))
  }
}

/** A box won: a glossy tile in the owner's colour with their mark, stamped in. */
function filled(g: Draw, geo: Geom, owner: Side, box: number, t: number, extra: number): void {
  const { x, y } = boxCentre(geo, box)
  const k = Math.max(0.02, outBack(prog(t, 0, FILL)))
  const half = geo.cell / 2 - 18
  const col = SIDE[owner]
  g.at(
    x,
    y,
    0,
    () => {
      g.rrect(-half, -half + 8, half * 2, half * 2, 20, shade(col.main, -0.45))
      g.rrect(-half, -half, half * 2, half * 2, 20, col.main)
      g.rrect(-half + 6, -half + 5, half * 2 - 12, half * 0.8, 14, alpha('#ffffff', 0.2))
      g.sideMark(owner, 0, 4, half * 0.42, shade(col.dark, -0.2))
      g.sideMark(owner, 0, 0, half * 0.42, col.light)
    },
    k * extra,
    k * extra,
  )
}

/** A drawn line: a chunky stick in the drawer's colour, running out from its middle. */
function stick(g: Draw, geo: Geom, e: number, owner: Side, t: number, last: boolean): void {
  const [[r0, c0], [r1, c1]] = lineEnds(e)
  const a = dot(geo, r0, c0)
  const b = dot(geo, r1, c1)
  const p = outCubic(prog(t, 0, LINE_GROW))
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const x0 = mx + (a.x - mx) * p
  const y0 = my + (a.y - my) * p
  const x1 = mx + (b.x - mx) * p
  const y1 = my + (b.y - my) * p
  // Fat for a beat as it lands.
  const lw = STICK * (1 + 0.35 * Math.sin(Math.PI * prog(t, 0, LINE_GROW * 2)))
  const col = SIDE[owner]
  if (last) {
    const pulse = 0.6 + 0.4 * Math.sin(t * 6)
    g.alpha(pulse, () => g.line(x0, y0, x1, y1, alpha(C.yellow, 0.55), lw + 22))
  }
  g.line(x0, y0 + 7, x1, y1 + 7, shade(col.main, -0.5), lw)
  g.line(x0, y0, x1, y1, col.main, lw)
  const hl = lw * 0.22
  g.line(x0, y0 - lw * 0.18, x1, y1 - lw * 0.18, alpha('#ffffff', 0.32), hl)
}

export function renderBoard(
  g: Draw,
  s: State,
  geo: Geom,
  now: number,
  targets: readonly number[],
  offered: readonly number[],
  mover: Side,
  pull: { r: number; c: number; x: number; y: number } | null = null,
): void {
  slab(g, geo)
  // Boxes one line from done glow softly for whoever can take them.
  const pulse = 0.5 + 0.5 * Math.sin(now * 5)
  for (const box of offered) {
    const { x, y } = boxCentre(geo, box)
    const k = geo.cell / 2 - 16
    g.alpha(0.25 + pulse * 0.25, () => g.rrect(x - k, y - k, k * 2, k * 2, 18, SIDE[mover].dark))
  }
  // Completed boxes, and on the final wave the winner's pop once more.
  const winner = s.doneAt >= 0 ? s.winner : -1
  s.boxes.forEach((owner, box) => {
    if (owner === null) return
    let extra = 1
    let dim = 1
    if (winner === 0 || winner === 1) {
      const t = now - s.doneAt
      const { x, y } = boxCentre(geo, box)
      const d = Math.hypot(x - W / 2, y - (geo.y + geo.h / 2)) / geo.cell
      if (owner === winner)
        extra = 1 + 0.16 * Math.sin(Math.PI * prog(t, 0.1 + d * 0.08, 0.4 + d * 0.08))
      else dim = 1 - 0.4 * prog(t, 0.1, 0.6)
    }
    g.alpha(dim, () => filled(g, geo, owner, box, now - (s.boxAt[box] ?? 0), extra))
  })
  // Gaps still open: a faint groove.
  for (let e = 0; e < s.lines.length; e++) {
    if (s.lines[e] !== null) continue
    const [[r0, c0], [r1, c1]] = lineEnds(e)
    const a = dot(geo, r0, c0)
    const b = dot(geo, r1, c1)
    g.line(a.x, a.y, b.x, b.y, shade(SLAB, -0.3), 14)
  }
  // Drawn lines, in the colour of whoever drew them.
  s.lines.forEach((owner, e) => {
    if (owner === null) return
    stick(g, geo, e, owner, now - (s.lineAt[e] ?? 0), e === s.last && s.doneAt < 0)
  })
  // On a human's turn, a target at each open gap.
  for (const e of targets) {
    const { x, y } = midpoint(geo, e)
    const p = 0.55 + 0.35 * Math.sin(now * 5 + e * 0.7)
    g.alpha(p, () => g.circle(x, y, geo.cell * 0.07, SIDE[mover].light))
  }
  // A line being pulled out of a dot: a stretchy band to the finger, thinner the further it goes.
  if (pull) {
    const a = dot(geo, pull.r, pull.c)
    const len = Math.hypot(pull.x - a.x, pull.y - a.y)
    const lw = Math.max(8, STICK * (1 - Math.min(0.7, len / (geo.cell * 3))))
    const col = SIDE[mover]
    g.line(a.x, a.y + 6, pull.x, pull.y + 6, shade(col.main, -0.5), lw)
    g.line(a.x, a.y, pull.x, pull.y, col.main, lw)
    g.circle(pull.x, pull.y, lw * 0.9, col.light)
  }
  // Dots on top: glossy pegs.
  for (let r = 0; r < DOTS; r++) {
    for (let c = 0; c < DOTS; c++) {
      const { x, y } = dot(geo, r, c)
      g.circle(x, y + 7, 22, shade(SLAB, -0.6))
      g.ball(x, y, 22, C.cream)
    }
  }
}

/** A side's box count at its edge, with its mark, bumping when it changes. */
export function boxCount(
  g: Draw,
  side: Side,
  n: number,
  bump: number,
  x: number,
  y: number,
  lead: boolean,
): void {
  g.forSide(side, x, y, () => {
    const k = 1 + 0.3 * Math.sin(Math.PI * Math.min(1, Math.max(0, bump)))
    g.at(
      -46,
      0,
      0,
      () => {
        g.rrect(-26, -22, 52, 52, 12, shade(SIDE[side].main, -0.45))
        g.rrect(-26, -26, 52, 52, 12, SIDE[side].main)
        g.sideMark(side, 0, 0, 11, SIDE[side].light)
      },
      k,
    )
    g.at(
      30,
      4,
      0,
      () =>
        g.text(n, 0, 0, {
          size: 76,
          weight: 700,
          color: lead ? SIDE[side].light : SIDE[side].main,
          align: 'left',
          drop: alpha('#000000', 0.35),
        }),
      k,
    )
  })
}
