import type { Side } from '../../core/game.ts'
import { outBack, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { LANE_W } from '../../engines/runner/index.ts'

/**
 * Lane HUD pieces, drawn in lane-local coordinates (upright for the lane's
 * owner: the frame turns them). Same language as the shared HUD kit: chunky
 * ink pills with a team-coloured lip, big Fredoka figures.
 */

/** The lane's main figure: a glossy pill with the team mark, a big value and a small unit. */
export function scorePill(
  g: Draw,
  side: Side,
  value: string,
  unit: string,
  x = LANE_W / 2,
  y = 74,
  pop = 0,
): void {
  const vs = 70
  const vw = g.measure(value, vs, 700)
  const uw = unit ? g.measure(unit, 38, 600) : 0
  const w = vw + uw + (unit ? 136 : 118)
  const h = 100
  const col = SIDE[side].main
  g.at(
    x,
    y,
    0,
    () => {
      g.rrect(-w / 2, -h / 2 + 8, w, h, h / 2, shade(col, -0.55))
      g.rrect(-w / 2, -h / 2, w, h, h / 2, alpha(C.ink, 0.9))
      g.rrect(-w / 2 + 6, -h / 2 + 5, w - 12, h * 0.42, h * 0.3, alpha(C.white, 0.07))
      g.sideMark(side, -w / 2 + 46, 0, 15, col)
      const x0 = -w / 2 + 76
      g.text(value, x0, 4, {
        size: vs,
        weight: 700,
        align: 'left',
        color: C.white,
        drop: alpha('#000000', 0.4),
      })
      if (unit)
        g.text(unit, x0 + vw + 12, 10, {
          size: 38,
          weight: 600,
          align: 'left',
          color: SIDE[side].light,
        })
    },
    1 + 0.18 * pop,
  )
}

/** A small secondary chip (timer, rival…). */
export function chip(
  g: Draw,
  text: string,
  x: number,
  y: number,
  o: { color?: string; size?: number; bg?: string } = {},
): void {
  const size = o.size ?? 44
  const w = g.measure(text, size, 700) + size * 1.2
  const h = size * 1.6
  g.rrect(x - w / 2, y - h / 2, w, h, h / 2, o.bg ?? alpha(C.ink, 0.82))
  g.text(text, x, y + 2, { size, weight: 700, color: o.color ?? C.white })
}

/** A centred card that pops in with an overshoot: titles, results, round banners. */
export function card(
  g: Draw,
  side: Side,
  title: string,
  sub: string,
  y: number,
  t: number,
  o: { color?: string; accent?: string; x?: number; size?: number } = {},
): void {
  const s = outBack(prog(t, 0, 0.38))
  if (s <= 0.01) return
  const size = o.size ?? 88
  const accent = o.accent ?? SIDE[side].main
  g.at(
    o.x ?? LANE_W / 2,
    y,
    0,
    () => {
      const w = Math.max(
        440,
        g.measure(title, size, 700) + 130,
        sub ? g.measure(sub, 42, 600) + 110 : 0,
      )
      const h = sub ? 214 : 160
      const top = -h / 2
      g.rrect(-w / 2, top + 12, w, h, 48, shade(accent, -0.5))
      g.rrect(-w / 2, top, w, h, 48, alpha(C.ink, 0.94))
      g.rrect(-w / 2, top, w, 14, 7, alpha(accent, 0.95))
      g.rrect(-w / 2 + 10, top + 18, w - 20, h * 0.36, 34, alpha(C.white, 0.05))
      g.text(title, 0, sub ? top + 88 : 6, {
        size,
        weight: 700,
        color: o.color ?? C.white,
        drop: alpha('#000000', 0.45),
      })
      if (sub) g.text(sub, 0, top + 166, { size: 42, weight: 600, color: alpha(C.white, 0.82) })
    },
    s,
  )
}

/** Seconds the "GO!" stays up at the end of a countdown. */
const GO_T = 0.6

/** The figure on show `left` seconds before the start of a `total`-second countdown: 3, 2, 1, then 0 for GO. */
export function countFigure(left: number, total: number): number {
  if (left <= GO_T) return 0
  return Math.min(3, Math.ceil((left - GO_T) / ((total - GO_T) / 3)))
}

/** "3, 2, 1, GO!" with each figure punching in on its beat. */
export function countdown(
  g: Draw,
  side: Side,
  left: number,
  total: number,
  sub: string,
  y: number,
  x = LANE_W / 2,
): void {
  const n = countFigure(left, total)
  const go = n === 0
  const beat = (total - GO_T) / 3
  // 0..1 through the current figure's beat.
  const k = go ? prog(GO_T - left, 0, GO_T) : 1 - ((left - GO_T) / beat - (n - 1))
  const pop = outBack(prog(k, 0, go ? 0.5 : 0.4))
  const fade = go ? 1 - prog(GO_T - left, GO_T * 0.6, GO_T) : 1
  if (fade <= 0) return
  g.alpha(fade, () => {
    g.at(
      x,
      y,
      0,
      () => {
        const r = 108
        g.circle(0, 12, r, shade(SIDE[side].main, -0.5))
        g.circle(0, 0, r, alpha(C.ink, 0.94))
        g.ring(0, 0, r - 9, go ? C.yellow : SIDE[side].main, 10)
        g.text(go ? 'GO!' : String(n), 0, 6, {
          size: go ? 84 : 124,
          weight: 700,
          color: go ? C.yellow : C.white,
          drop: alpha('#000000', 0.45),
        })
      },
      0.35 + 0.65 * pop,
    )
    if (sub) chip(g, sub, x, y + 172, { size: 40, color: C.white })
  })
}
