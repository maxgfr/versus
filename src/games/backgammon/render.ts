import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { drawDie, inFrame, textAngle } from '../../engines/dice/index.ts'
import { absOf, BAR, CHECKERS, own, POINTS, type Pos, pips, type Step } from './rules.ts'

/**
 * Layout. The playing field lies across the middle of the table with the bar
 * down its centre; the bear-off trays are part of the frame on the right, next
 * to both home boards (red's bottom-right, blue's top-right).
 */
export const BOARD = { x: 104, y: 560, w: 756, h: 680 }
export const BAR_W = 60
/** Width of one point (triangle). */
export const PW = (BOARD.w - BAR_W) / 12
export const CHECK_R = PW * 0.46
/** Vertical spacing of checkers in a stack. */
const STEP = CHECK_R * 1.94
/** Length of a point's triangle. */
const HP = 282
/** Checkers drawn per point before the stack shows a count instead. */
const SHOWN = 5
const BAR_X = BOARD.x + 6 * PW

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Bear-off trays, built into the right-hand rail: red's below the middle, blue's above. */
const TRAY_X = BOARD.x + BOARD.w + 22
export const TRAY: Record<Side, Rect> = {
  0: { x: TRAY_X, y: MID + 12, w: 74, h: BOARD.y + BOARD.h - MID - 12 },
  1: { x: TRAY_X, y: BOARD.y, w: 74, h: MID - 12 - BOARD.y },
}
const FRAME = { x: BOARD.x - 28, y: BOARD.y - 28, w: TRAY_X + 74 + 22 - (BOARD.x - 28), h: 0 }
FRAME.h = BOARD.h + 56

/** Dice pad, pip count and borne-off count, in red's frame (below the board); blue's is turned 180°. */
export const DICE = { x: 500, y: 1500, size: 112, gap: 128, hit: { w: 470, h: 230 } }
const PIPS_AT = { x: 138, y: 1500 }
const OFF_AT = { x: 862, y: 1500 }

/** Seconds the dice tumble after a roll. */
export const ROLL_T = 0.6
/** Seconds a hit checker takes to fly to the bar once the hitter lands. */
export const HIT_FLY = 0.42

/** Column 0..11 (left to right) of an absolute point. Points 1–12 are the bottom row, 13–24 the top. */
export const column = (p: number): number => (p <= 12 ? 12 - p : p - 13)
export const isBottom = (p: number): boolean => p <= 12

export function pointX(p: number): number {
  const k = column(p)
  return BOARD.x + k * PW + PW / 2 + (k >= 6 ? BAR_W : 0)
}

/** World centre of the checker `n` (0 = nearest the edge) on absolute point `p`. */
export function checkerAt(p: number, n: number): { x: number; y: number } {
  const k = Math.min(n, SHOWN - 1)
  const y = isBottom(p)
    ? BOARD.y + BOARD.h - CHECK_R - 6 - k * STEP
    : BOARD.y + CHECK_R + 6 + k * STEP
  return { x: pointX(p), y }
}

/** World centre of the `n`th checker waiting on `s`'s bar: on its own half, from the middle out. */
export function barAt(s: Side, n: number): { x: number; y: number } {
  const x = BAR_X + BAR_W / 2
  const d = CHECK_R + 30 + Math.min(n, 4) * STEP
  return { x, y: s === 0 ? MID + d : MID - d }
}

/** Centre of slab `n` in a side's tray, filling from the outer edge in. */
function slabAt(s: Side, n: number): { x: number; y: number } {
  const t = TRAY[s]
  const x = t.x + t.w / 2
  return { x, y: s === 0 ? t.y + t.h - 18 - n * 20.5 : t.y + 18 + n * 20.5 }
}

/** Where slot `n` of relative point `rel` (for side `s`) is: a board point, the bar, or the tray. */
export function spotOf(s: Side, rel: number, n: number): { x: number; y: number } {
  if (rel === BAR) return barAt(s, n)
  if (rel === 0) return slabAt(s, n)
  return checkerAt(absOf(s, rel), n)
}

// ---------- the board ----------

const IVORY = '#f4e4c1'
const WALNUT = '#6e3a1d'
const FELT = '#1d5e45'

function drawBoardFrame(g: Draw): void {
  const f = FRAME
  g.shadow(f.x + f.w / 2, f.y + f.h + 30, f.w * 0.52, 40, 0.5)
  g.tile(f.x, f.y, f.w, f.h + 22, 44, C.woodDark, 22)
  // Warm grain across the rail.
  g.rrect(
    f.x,
    f.y,
    f.w,
    f.h,
    44,
    g.lin(f.x, f.y, f.x + f.w, f.y + f.h, [
      [0, shade(C.wood, -0.05)],
      [0.5, shade(C.wood, -0.22)],
      [1, shade(C.wood, -0.1)],
    ]),
  )
  g.alpha(0.12, () => {
    for (let i = 0; i < 7; i++) {
      const y = f.y + 10 + i * (f.h / 7) + Math.sin(i * 2.3) * 8
      g.line(f.x + 30, y, f.x + f.w - 30, y + 6, shade(C.woodDark, -0.3), 3)
    }
  })
  g.alpha(0.5, () => g.rrect(f.x + 8, f.y + 5, f.w - 16, 30, 16, alpha('#ffffff', 0.22)))
  // Two felt fields either side of the bar.
  for (const [x0, w] of [
    [BOARD.x, 6 * PW],
    [BAR_X + BAR_W, 6 * PW],
  ] as const) {
    g.rrect(x0 - 5, BOARD.y - 5, w + 10, BOARD.h + 10, 14, shade(C.woodDark, -0.5))
    g.rrect(
      x0,
      BOARD.y,
      w,
      BOARD.h,
      10,
      g.rad(x0 + w / 2, MID, 30, BOARD.h * 0.7, [
        [0, shade(FELT, 0.12)],
        [1, shade(FELT, -0.4)],
      ]),
    )
  }
  // Home boards carry their owner's colour: red bottom-right, blue top-right.
  for (const s of [0, 1] as Side[]) {
    const top = s === 0 ? MID : BOARD.y
    g.rrect(
      BAR_X + BAR_W,
      top,
      6 * PW,
      BOARD.h / 2,
      10,
      g.lin(0, s === 0 ? BOARD.y + BOARD.h : BOARD.y, 0, MID, [
        [0, alpha(SIDE[s].main, 0.3)],
        [1, alpha(SIDE[s].main, 0)],
      ]),
    )
  }
  // Points: ivory and walnut, alternating, each with a soft gradient to the tip.
  for (let p = 1; p <= POINTS; p++) {
    const cx = pointX(p)
    const bottom = isBottom(p)
    const base = bottom ? BOARD.y + BOARD.h : BOARD.y
    const tip = bottom ? base - HP : base + HP
    const half = PW * 0.5 - 2
    const col = p % 2 === 0 ? IVORY : WALNUT
    g.poly(
      [cx - half, base, cx + half, base, cx, tip],
      g.lin(0, base, 0, tip, [
        [0, shade(col, -0.08)],
        [1, shade(col, 0.1)],
      ]),
    )
    g.poly([cx - half, base, cx - half + 5, base, cx, tip], alpha('#000000', 0.12))
  }
  // Inner shadow of the fields.
  for (const x0 of [BOARD.x, BAR_X + BAR_W]) {
    g.rrect(x0, BOARD.y, 6 * PW, BOARD.h, 10, undefined, alpha('#000000', 0.35), 6)
  }
  // The bar: a raised wooden spine with brass hinges.
  g.tile(BAR_X + 4, BOARD.y - 14, BAR_W - 8, BOARD.h + 34, 14, shade(C.wood, -0.12), 10)
  for (const hy of [BOARD.y + 110, BOARD.y + BOARD.h - 140]) {
    g.rrect(BAR_X + 16, hy, BAR_W - 32, 36, 6, mix(C.woodDark, C.yellow, 0.25))
    g.rrect(BAR_X + 16, hy, BAR_W - 32, 10, 5, mix(C.wood, C.yellow, 0.3))
  }
  // Trays: deep wells in the rail.
  for (const s of [0, 1] as Side[]) {
    const t = TRAY[s]
    g.rrect(t.x - 5, t.y - 5, t.w + 10, t.h + 10, 22, shade(C.woodDark, -0.55))
    g.rrect(
      t.x,
      t.y,
      t.w,
      t.h,
      18,
      g.lin(0, t.y, 0, t.y + t.h, [
        [0, shade(SIDE[s].main, -0.7)],
        [1, shade(SIDE[s].main, -0.6)],
      ]),
    )
    g.rrect(t.x, t.y, t.w, t.h, 18, undefined, alpha('#000000', 0.4), 5)
  }
}

/** A checker: a glossy disc. Red carries a round inlay, blue a square one, so the sides read without colour. */
export function checker(g: Draw, side: Side, x: number, y: number, r: number, lift = 0): void {
  const col = SIDE[side].main
  if (lift > 0) g.shadow(x, y + r * 0.35 + lift * 0.5, r * 1.02, r * 0.5, 0.35)
  const yy = y - lift
  g.disc(x, yy, r, col, r * 0.2)
  const k = r * 0.4
  if (side === 0) {
    g.circle(x, yy + 2, k, shade(col, -0.3))
    g.circle(x, yy, k, shade(col, 0.22))
  } else {
    g.rrect(x - k, yy - k + 2, k * 2, k * 2, k * 0.35, shade(col, -0.3))
    g.rrect(x - k, yy - k, k * 2, k * 2, k * 0.35, shade(col, 0.22))
  }
  g.alpha(0.55, () => g.ellipse(x - r * 0.32, yy - r * 0.45, r * 0.3, r * 0.15, '#fff', -0.5))
}

/** A borne-off checker seen edge-on in the tray. */
function slab(g: Draw, side: Side, x: number, y: number, glow = 0): void {
  const col = SIDE[side].main
  g.rrect(x - 30, y - 7, 60, 17, 8, shade(col, -0.45))
  g.rrect(
    x - 30,
    y - 9,
    60,
    15,
    8,
    g.lin(0, y - 9, 0, y + 6, [
      [0, shade(col, 0.25 + glow * 0.4)],
      [1, shade(col, -0.1)],
    ]),
  )
}

/** A checker on its way: `from` → `to`, plus the blot it hits flying to the bar after it lands. */
export interface Flight {
  side: Side
  from: number
  to: number
  start: number
  dur: number
  /** It lands on a blot, which then flies to the bar. */
  hit: boolean
  /** Landing effects played (host bookkeeping). */
  landed: boolean
}

/** Game time the flight (and any hit checker's trip to the bar) is over. */
export const flightEnd = (f: Flight): number => f.start + f.dur + (f.hit ? HIT_FLY : 0.04)

export interface BoardView {
  turn: Side
  pos: Pos
  /** The side-relative point the player picked up (or BAR), or null. */
  sel: number | null
  /** Distinct next moves for the side to move. */
  moves: Step[]
  flight: Flight | null
  /** Human to move: show what can be picked up. */
  hints: boolean
  /** The finished game: winner and the time it was decided. */
  end: { winner: Side; at: number } | null
}

/** Board, checkers, bar and trays. Checkers in flight are drawn by the flight, not in their stacks. */
export function renderBoard(g: Draw, v: BoardView, now: number): void {
  drawBoardFrame(g)
  const fl = v.flight && now < flightEnd(v.flight) ? v.flight : null
  const p0 = v.pos
  const flying = fl !== null && now < fl.start + fl.dur
  const victim: Side | null = fl && fl.hit ? (fl.side === 0 ? 1 : 0) : null
  const turn = v.turn
  const live = v.end === null && fl === null
  const count = (s: Side, rel: number) => (rel === BAR ? p0.bar[s] : own(p0, s, rel))
  // Destinations of the picked-up checker glow on the felt, under the stacks.
  const dests = live && v.sel !== null ? v.moves.filter((m) => m.from === v.sel) : []
  const pulse = 0.5 + 0.5 * Math.sin(now * 7)
  for (const m of dests) {
    if (m.to === 0) continue
    const p = absOf(turn, m.to)
    const cx = pointX(p)
    const base = isBottom(p) ? BOARD.y + BOARD.h : BOARD.y
    const tip = isBottom(p) ? base - HP : base + HP
    g.alpha(0.35 + pulse * 0.3, () =>
      g.poly([cx - PW / 2 + 2, base, cx + PW / 2 - 2, base, cx, tip], C.yellow),
    )
  }
  // Points.
  for (let p = 1; p <= POINTS; p++) {
    const n0 = p0.pts[p - 1] ?? 0
    if (n0 === 0) continue
    const owner: Side = n0 > 0 ? 0 : 1
    let n = Math.abs(n0)
    if (flying && fl && fl.to > 0 && absOf(fl.side, fl.to) === p && owner === fl.side) n--
    for (let k = 0; k < Math.min(n, SHOWN); k++) {
      const c = checkerAt(p, k)
      checker(g, owner, c.x, c.y, CHECK_R)
    }
    if (n > SHOWN) {
      const top = checkerAt(p, SHOWN - 1)
      g.at(top.x, top.y, g.orient(isBottom(p) ? 0 : 1), () => {
        g.circle(0, 0, CHECK_R * 0.62, shade(SIDE[owner].main, -0.5))
        g.text(n, 0, 2, { size: 36, weight: 700, color: C.white })
      })
    }
  }
  // The bar.
  for (const s of [0, 1] as Side[]) {
    let n = p0.bar[s]
    if (flying && fl && fl.from === BAR && fl.side === s) n--
    if (fl && victim === s) n--
    for (let k = 0; k < Math.min(n, 5); k++) {
      const c = barAt(s, k)
      checker(g, s, c.x, c.y, CHECK_R)
    }
    if (n > 5) {
      const c = barAt(s, 4)
      g.at(c.x, c.y, g.orient(s), () => g.text(n, 0, 2, { size: 34, weight: 700, color: C.white }))
    }
  }
  // Trays: borne-off checkers stand edge-on; the winner's tray glows at the end.
  for (const s of [0, 1] as Side[]) {
    let off = p0.off[s]
    if (flying && fl && fl.to === 0 && fl.side === s) off--
    const won = v.end?.winner === s
    for (let k = 0; k < off; k++) {
      const c = slabAt(s, k)
      const glow = won ? Math.max(0, Math.sin((now - (v.end?.at ?? 0)) * 6 - k * 0.5)) : 0
      slab(g, s, c.x, c.y, glow)
    }
  }
  // Flights: the mover arcs over the board; a hit blot waits, then flies to the bar.
  if (fl) {
    const t = prog(now, fl.start, fl.start + fl.dur)
    const landIdx = fl.to === 0 ? p0.off[fl.side] - 1 : Math.max(0, own(p0, fl.side, fl.to) - 1)
    const b = spotOf(fl.side, fl.to, landIdx)
    if (victim !== null) {
      const u = prog(now, fl.start + fl.dur, fl.start + fl.dur + HIT_FLY)
      const bar = barAt(victim, p0.bar[victim] - 1)
      const blot = checkerAt(absOf(fl.side, fl.to), 0)
      const e = outCubic(u)
      const x = blot.x + (bar.x - blot.x) * e
      const y = blot.y + (bar.y - blot.y) * e
      checker(g, victim, x, y, CHECK_R, Math.sin(u * Math.PI) * 90)
    }
    if (t < 1) {
      const e = t * t * (3 - 2 * t)
      const fromIdx = fl.from === BAR ? p0.bar[fl.side] : own(p0, fl.side, fl.from)
      const a = spotOf(fl.side, fl.from, fromIdx)
      const lift = Math.sin(e * Math.PI) * 120
      const x = a.x + (b.x - a.x) * e
      const y = a.y + (b.y - a.y) * e
      if (fl.to === 0 && t > 0.75) slab(g, fl.side, x, y)
      else checker(g, fl.side, x, y, CHECK_R * (1 + Math.sin(e * Math.PI) * 0.12), lift)
    }
  }
  if (!live) return
  // Picked-up checker: lifted off its stack with a ring; ghost rings where it can land.
  if (v.sel !== null) {
    const top = spotOf(turn, v.sel, Math.max(0, count(turn, v.sel) - 1))
    checker(g, turn, top.x, top.y, CHECK_R * 1.06, 12)
    g.ring(top.x, top.y - 12, CHECK_R * 1.28, C.yellow, 7)
    for (const m of dests) {
      if (m.to === 0) {
        const t = TRAY[turn]
        g.alpha(0.5 + pulse * 0.5, () =>
          g.rrect(t.x - 9, t.y - 9, t.w + 18, t.h + 18, 26, undefined, C.yellow, 8),
        )
        continue
      }
      const at = spotOf(turn, m.to, own(p0, turn, m.to))
      g.alpha(0.55 + pulse * 0.4, () => {
        g.circle(at.x, at.y, CHECK_R * 0.92, alpha(C.yellow, 0.25))
        g.ring(at.x, at.y, CHECK_R * 0.92, C.yellow, 6)
      })
      if (m.hit) {
        g.alpha(0.7 + pulse * 0.3, () => g.text('✕', at.x, at.y + 2, { size: 30, color: C.yellow }))
      }
    }
    return
  }
  if (!v.hints) return
  // Nothing picked up: every checker that can move wears a pulsing ring.
  const froms = new Set(v.moves.map((m) => m.from))
  for (const from of froms) {
    const top = spotOf(turn, from, Math.max(0, count(turn, from) - 1))
    g.alpha(0.45 + pulse * 0.45, () => g.ring(top.x, top.y, CHECK_R * 1.12, C.yellow, 5))
  }
}

// ---------- dice, pip count, borne off ----------

export interface DiceView {
  turn: Side
  pos: Pos
  roll: number[]
  used: Step[]
  shown: [number[], number[]]
  rolledAt: [number, number]
}

/** Pad behind a side's dice, in its frame. */
function pad(g: Draw, side: Side, on: boolean, ready: boolean, now: number): void {
  const w = DICE.hit.w
  const h = DICE.hit.h - 20
  const x = DICE.x - w / 2
  const y = DICE.y - h / 2 + 4
  const col = SIDE[side].main
  const glow = ready ? 0.5 + 0.5 * Math.sin(now * 6) : 0
  if (ready)
    g.alpha(0.25 + glow * 0.35, () => g.rrect(x - 12, y - 12, w + 24, h + 24, 60, C.yellow))
  g.rrect(x - 6, y - 6, w + 12, h + 16, 56, shade(C.woodDark, -0.35))
  const face = on ? shade(col, -0.5) : shade(C.ink3, -0.15)
  g.rrect(
    x,
    y,
    w,
    h,
    50,
    g.rad(DICE.x, DICE.y, 20, w * 0.6, [
      [0, shade(face, on ? 0.12 : 0.05)],
      [1, shade(face, -0.4)],
    ]),
  )
  g.rrect(x, y, w, h, 50, undefined, alpha('#000000', 0.3), 5)
}

export function renderDice(
  g: Draw,
  v: DiceView,
  now: number,
  over: boolean,
  isBot: (side: Side) => boolean,
): void {
  for (const s of [0, 1] as Side[]) {
    const on = !over && v.turn === s
    const mine = on && v.roll.length > 0
    const faces = mine ? v.roll : v.shown[s].length > 0 ? v.shown[s] : [5, 2]
    const since = now - v.rolledAt[s]
    const tumbling = since < ROLL_T
    // Which dice are still to play: the roll minus the dice of the moves made.
    const left = mine ? v.roll.slice() : []
    for (const st of mine ? v.used : []) {
      const i = left.indexOf(st.die)
      if (i >= 0) left.splice(i, 1)
    }
    const ready = on && v.roll.length === 0 && !isBot(s)
    inFrame(g, s, () => {
      const ta = textAngle(g, s)
      pad(g, s, on, ready, now)
      const n = faces.length
      const size = n > 2 ? 86 : DICE.size
      const gap = n > 2 ? 100 : DICE.gap
      faces.forEach((face, i) => {
        let x = DICE.x + (i - (n - 1) / 2) * gap
        let y = DICE.y
        const idx = left.indexOf(face)
        const spent = mine && idx < 0
        if (idx >= 0) left.splice(idx, 1)
        let shown = face
        let angle = 0
        let squash = 0
        if (tumbling) {
          const p = since / ROLL_T
          y -= Math.abs(Math.sin((p * 3 + i * 0.27) * Math.PI)) * (1 - p) * 60
          x += Math.sin(p * 9 + i * 1.7) * (1 - p) * 22
          angle = (1 - outCubic(p)) * (i % 2 ? -1 : 1) * 6
          shown = p > 0.85 ? face : 1 + (Math.floor(now * 22 + i * 3 + s) % 6)
        } else if (since < ROLL_T + 0.25) {
          squash = Math.max(0, 1 - outBack(prog(since, ROLL_T, ROLL_T + 0.25)))
        }
        const breathe = ready ? Math.sin(now * 5 + i) * 5 : 0
        g.alpha(spent ? 0.3 : on ? 1 : 0.6, () =>
          drawDie(g, x, y - breathe, spent ? size * 0.82 : size, shown, {
            angle: angle + (ready ? Math.sin(now * 3 + i * 2) * 0.06 : 0),
            squash,
            color: on ? C.white : shade(C.white, -0.25),
            dim: spent,
          }),
        )
      })
      const label = !on
        ? ''
        : v.roll.length === 0
          ? isBot(s)
            ? 'Rolling…'
            : 'Tap to roll'
          : v.roll.length === 4 && !tumbling
            ? 'Doubles!'
            : ''
      if (label)
        g.at(DICE.x, DICE.y - DICE.hit.h / 2 - 22, ta, () =>
          g.text(label, 0, 0, {
            size: 40,
            weight: 700,
            color: C.yellow,
            drop: alpha('#000000', 0.4),
          }),
        )
      // Pip count on the left, borne-off count on the right.
      g.at(PIPS_AT.x, PIPS_AT.y, ta, () => {
        g.text('PIPS', 0, -48, { size: 34, weight: 700, color: alpha(C.white, 0.55) })
        g.text(pips(v.pos, s), 0, 14, {
          size: 64,
          weight: 700,
          color: SIDE[s].main,
          drop: alpha('#000000', 0.4),
        })
      })
      g.at(OFF_AT.x, OFF_AT.y, ta, () => {
        g.text('OFF', 0, -48, { size: 34, weight: 700, color: alpha(C.white, 0.55) })
        g.text(v.pos.off[s], -8, 14, {
          size: 64,
          weight: 700,
          color: SIDE[s].main,
          drop: alpha('#000000', 0.4),
          align: 'right',
        })
        g.text(`/${CHECKERS}`, -4, 24, {
          size: 34,
          weight: 600,
          color: alpha(C.white, 0.55),
          align: 'left',
        })
      })
    })
  }
}

/** The closing call over the board, readable from both edges, popping in. */
export function endBanner(g: Draw, text: string, side: Side, at: number, now: number): void {
  const k = prog(now, at, at + 0.45)
  if (k <= 0) return
  const scale = 0.4 + 0.6 * outBack(k)
  const one = (angle: number, cy: number) =>
    g.at(
      W / 2,
      cy,
      angle,
      () => {
        const w = g.measure(text, 76, 700) + 110
        g.rrect(-w / 2 - 8, -62, w + 16, 132, 66, alpha(C.ink, 0.6))
        g.tile(-w / 2, -58, w, 124, 58, SIDE[side].main, 12)
        g.text(text, 0, -2, {
          size: 76,
          weight: 700,
          color: C.white,
          drop: alpha('#000000', 0.35),
        })
      },
      scale,
    )
  g.alpha(k, () => {
    if (g.flipTop) {
      one(g.orient(0), MID + 150)
      one(g.orient(1), MID - 150)
    } else one(g.orient(), MID)
  })
}
