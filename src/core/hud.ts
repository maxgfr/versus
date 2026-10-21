import type { Side } from './game.ts'
import type { Draw } from './render/draw.ts'
import { C, SIDE, alpha, shade } from './render/palette.ts'
import { W } from './stage.ts'

/**
 * Shared in-game HUD pieces, so every game speaks the same language at the
 * players' edges: a name pill (glowing on your turn), round pips, a timer.
 * Everything is drawn upright for the player it belongs to.
 */

/** Y of the HUD row for a side: just inside that player's edge, safe-area aware. */
export function hudY(g: Draw, side: Side, inset = 70): number {
  return side === 0 ? g.stage.edge(0) - inset : g.stage.edge(1) + inset
}

/**
 * The player's name pill. `active` makes it pulse in the team colour (your
 * turn / your serve); `text` replaces the name (e.g. "Your turn", "Thinking…").
 */
export function namePill(
  g: Draw,
  side: Side,
  name: string,
  o: { active?: boolean; text?: string; x?: number; inset?: number } = {},
): void {
  const y = hudY(g, side, o.inset)
  const x = o.x ?? W / 2
  const label = o.text ?? name
  g.forSide(side, x, y, () => {
    const w = Math.max(220, g.measure(label, 40, 600) + 80)
    const pulse = o.active ? 0.5 + 0.5 * Math.sin(g.t * 6) : 0
    if (o.active) {
      g.alpha(0.25 + pulse * 0.25, () => g.rrect(-w / 2 - 10, -46, w + 20, 92, 46, SIDE[side].main))
    }
    // Idle pills keep a team-coloured rim so they hold up on team-tinted tables.
    if (o.active) g.rrect(-w / 2, -36, w, 72, 36, SIDE[side].main)
    else
      g.rrect(-w / 2, -36, w, 72, 36, shade(SIDE[side].main, -0.62), alpha(SIDE[side].main, 0.7), 3)
    g.sideMark(side, -w / 2 + 38, 0, 12, o.active ? C.white : SIDE[side].main)
    g.text(label, 14, 2, {
      size: 38,
      weight: 600,
      color: o.active ? C.white : alpha(C.white, 0.75),
    })
  })
}

/** Round wins as filled pips (first to `target`). Drawn beside the name pill. */
export function pips(
  g: Draw,
  side: Side,
  wins: number,
  target: number,
  o: { x?: number; inset?: number } = {},
): void {
  const y = hudY(g, side, o.inset)
  // To each player's right.
  const x = o.x ?? (side === 0 ? W - 150 : 150)
  g.forSide(side, x, y, () => {
    // Long matches would run a row of pips off the screen: show one pip and a tally.
    if (target > 5) {
      g.rrect(-74, -30, 148, 60, 30, alpha(C.ink, 0.55))
      g.circle(-40, 0, 15, wins > 0 ? SIDE[side].main : alpha(C.white, 0.14))
      g.text(`${wins}/${target}`, 18, 2, { size: 36, weight: 700, color: C.white })
      return
    }
    const gap = 46
    const x0 = -((target - 1) * gap) / 2
    for (let i = 0; i < target; i++) {
      const on = i < wins
      g.circle(x0 + i * gap, 0, 15, on ? SIDE[side].main : alpha(C.white, 0.14))
      if (on) g.circle(x0 + i * gap - 4, -4, 5, alpha(C.white, 0.6))
    }
  })
}

/** Big score figure for a side, at its HUD row (left of the pill for that player). */
export function bigScore(
  g: Draw,
  side: Side,
  value: number | string,
  o: { x?: number; inset?: number; size?: number } = {},
): void {
  const y = hudY(g, side, o.inset)
  const x = o.x ?? 130
  g.forSide(side, x, y, () =>
    g.text(value, 0, 4, {
      size: o.size ?? 76,
      weight: 700,
      color: SIDE[side].main,
      drop: alpha('#000000', 0.35),
    }),
  )
}

/** A countdown clock in the middle of the screen, readable from both edges (two copies in local 2P). */
export function clock(g: Draw, seconds: number, y: number, urgent = seconds <= 5): void {
  const s = Math.max(0, Math.ceil(seconds))
  const label = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const col = urgent ? C.yellow : C.white
  const draw = (angle: number, cy: number) =>
    g.at(W / 2, cy, angle, () => {
      g.rrect(-90, -38, 180, 76, 22, alpha(C.ink, 0.7))
      g.text(label, 0, 3, { size: 46, weight: 700, color: col })
    })
  if (g.flipTop) {
    draw(0, y + 46)
    draw(g.orient(1), y - 46)
  } else draw(g.orient(), y)
}

/** Small "Round 2" style label centred on a half, upright for its player. */
export function banner(
  g: Draw,
  side: Side | undefined,
  text: string,
  y: number,
  o: { size?: number; color?: string; alpha?: number; gap?: number } = {},
): void {
  const size = o.size ?? 64
  if (size <= 0) return
  const one = (angle: number, cy: number) =>
    g.at(W / 2, cy, angle, () => {
      const w = g.measure(text, size, 700) + size * 1.1
      g.rrect(-w / 2, -size * 0.85, w, size * 1.7, size * 0.85, alpha(C.ink, 0.86))
      g.text(text, 0, size * 0.04, { size, weight: 700, color: o.color ?? C.white })
    })
  g.alpha(o.alpha ?? 1, () => {
    if (side !== undefined) one(g.orient(side), y)
    else if (g.flipTop) {
      const gap = o.gap ?? size * 1.15
      one(g.orient(0), y + gap)
      one(g.orient(1), y - gap)
    } else one(g.orient(), y)
  })
}
