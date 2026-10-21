/**
 * Dice engine: chunky toy dice that tumble across a felt tray in the middle of
 * the table, plus the frame maths for things each player owns on their half
 * (score sheets, roll buttons).
 *
 * How to build a dice game (copy src/games/yazy):
 * - State extends `DiceState` (`dice`, `held`, `rolls`, `rolledAt`) and
 *   `TurnState` (`turn`). Keep it JSON: the online host streams it.
 * - Extend `TurnGame` from engines/board. Override `busy()` to return
 *   `rolling(this.s, this.time)` so nobody taps mid-tumble; call
 *   `rollDice(this.s, rng, time)` to roll every die that is not held.
 * - Lay out each player's own controls with `frame(side)`: positions are written
 *   for red (bottom half, as red sees it) and mirrored 180° for blue. Geometry
 *   is the same on every device (so online taps land where they are drawn);
 *   only text orientation follows the viewer, via `textAngle(g, side)`.
 *   Hit-test with `toLocal(side, x, y)`.
 * - Draw the tray with `drawTray`, the dice with `drawDice`, each player's sheet
 *   with `drawSheet` (a grid of labelled cells, upright for that player), and
 *   the roll button with `drawRollButton`.
 * - Bots act one step per `botPlay()` call (roll, set holds, roll again,
 *   score): the TurnGame pacing makes the computer read as thinking.
 */
import { inFrame, textAngle, toLocal } from '../../core/frame.ts'
import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import type { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'

export interface DiceState {
  dice: number[]
  held: boolean[]
  /** Rolls used this turn (0 = not rolled yet). */
  rolls: number
  /** Game time of the last roll, for the tumble animation (-10 = never). */
  rolledAt: number
}

/** How long a roll tumbles before the faces settle (s). */
export const ROLL_TIME = 0.75

export function newDice(n = 5): DiceState {
  return {
    dice: Array.from({ length: n }, (_, i) => (i % 6) + 1),
    held: Array(n).fill(false),
    rolls: 0,
    rolledAt: -10,
  }
}

/** Roll every die that is not held. Mutates `s`. */
export function rollDice(s: DiceState, rng: Rng, now: number): void {
  s.dice = s.dice.map((v, i) => (s.held[i] ? v : rng.int(1, 6)))
  s.rolls++
  s.rolledAt = now
}

export function rolling(s: DiceState, now: number): boolean {
  return now - s.rolledAt < ROLL_TIME
}

/** Start of a new turn: nothing held, no rolls. */
export function resetTurn(s: DiceState): void {
  s.held = s.held.map(() => false)
  s.rolls = 0
}

// ---------- per-side frames (now in core, re-exported for existing imports) ----------

export { frame, frameAngle, inFrame, textAngle, toLocal, viewerFlipped } from '../../core/frame.ts'

// ---------- tray & dice ----------

export interface TrayLayout {
  x: number
  y: number
  w: number
  h: number
  size: number
  /** Centre of each die slot. */
  slots: { x: number; y: number }[]
}

export function trayLayout(n = 5, cy = MID, size = 132): TrayLayout {
  const gap = size * 0.3
  const w = n * size + (n - 1) * gap + 90
  const h = size + 110
  const x = (W - w) / 2
  const slots = Array.from({ length: n }, (_, i) => ({
    x: x + 45 + size / 2 + i * (size + gap),
    y: cy,
  }))
  return { x, y: cy - h / 2, w, h, size, slots }
}

/** Index of the die under (x, y), or -1. Generous: the whole slot column counts. */
export function dieAt(t: TrayLayout, x: number, y: number): number {
  if (y < t.y - 30 || y > t.y + t.h + 30) return -1
  let best = -1
  let bd = Infinity
  t.slots.forEach((s, i) => {
    const d = Math.abs(s.x - x)
    if (d < bd && d < t.size * 0.75) {
      bd = d
      best = i
    }
  })
  return best
}

/** Felt tray with a wooden rim, tinted toward whoever is rolling. */
export function drawTray(g: Draw, t: TrayLayout, turn: Side | null): void {
  g.shadow(W / 2, t.y + t.h + 18, t.w * 0.52, 30, 0.45)
  g.tile(t.x - 14, t.y - 14, t.w + 28, t.h + 40, 54, C.woodDark, 18)
  const felt = turn === null ? C.felt : shade(SIDE[turn].main, -0.45)
  g.rrect(
    t.x,
    t.y,
    t.w,
    t.h,
    44,
    g.rad(W / 2, t.y + t.h / 2, 20, t.w * 0.6, [
      [0, shade(felt, 0.12)],
      [1, shade(felt, -0.35)],
    ]),
  )
  g.rrect(t.x, t.y, t.w, t.h, 44, undefined, alpha('#000000', 0.25), 6)
}

const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
}

export interface DieOpts {
  angle?: number
  held?: boolean
  /** Lift above the felt (0..1): held dice float a little. */
  lift?: number
  color?: string
  pip?: string
  /** 0..1 squash when landing. */
  squash?: number
  /** Ring colour for a held die. */
  ring?: string
  dim?: boolean
}

/** One toy die: rounded cube with a darker side band, glossy top face, inset pips. */
export function drawDie(
  g: Draw,
  x: number,
  y: number,
  size: number,
  value: number,
  o: DieOpts = {},
): void {
  const lift = o.lift ?? 0
  const body = o.color ?? C.white
  const pip = o.pip ?? C.ink
  const r = size * 0.22
  const depth = size * 0.13
  g.shadow(
    x,
    y + size * 0.5 + depth * 0.4,
    size * (0.5 - lift * 0.08),
    size * 0.14,
    0.4 - lift * 0.15,
  )
  const sq = o.squash ?? 0
  g.at(
    x,
    y - lift * size * 0.22,
    o.angle ?? 0,
    () => {
      const h = size / 2
      g.rrect(-h, -h + depth, size, size, r, shade(body, -0.32))
      g.rrect(
        -h,
        -h,
        size,
        size,
        r,
        g.lin(0, -h, 0, h, [
          [0, shade(body, 0.08)],
          [1, shade(body, -0.08)],
        ]),
      )
      g.alpha(0.5, () =>
        g.rrect(-h + 6, -h + 5, size - 12, size * 0.32, r * 0.7, alpha('#ffffff', 0.55)),
      )
      const k = size * 0.27
      const pr = size * 0.085
      for (const [px, py] of PIPS[value] ?? []) {
        g.circle(px * k, py * k + 2, pr, shade(pip, 0.15))
        g.circle(px * k, py * k, pr, pip)
      }
      if (o.held) {
        g.rrect(
          -h - 10,
          -h - 10,
          size + 20,
          size + depth + 20,
          r + 10,
          undefined,
          o.ring ?? C.yellow,
          9,
        )
      }
      if (o.dim) g.rrect(-h, -h, size, size + depth, r, alpha(C.ink, 0.45))
    },
    1 + sq * 0.12,
    1 - sq * 0.12,
  )
}

/**
 * The dice in the tray. Non-held dice tumble for ROLL_TIME after a roll:
 * spinning, hopping and flickering through faces before settling.
 */
export function drawDice(
  g: Draw,
  t: TrayLayout,
  s: DiceState,
  now: number,
  o: { turn?: Side; showHeld?: boolean; dim?: boolean } = {},
): void {
  const since = now - s.rolledAt
  s.dice.forEach((v, i) => {
    const slot = t.slots[i]
    if (!slot) return
    const held = !!s.held[i]
    const tumbling = since < ROLL_TIME && !held
    let x = slot.x
    let y = slot.y
    let angle = 0
    let face = v
    let squash = 0
    if (tumbling) {
      const p = since / ROLL_TIME
      // Each die has its own rhythm so the throw feels physical.
      const ph = i * 1.7
      const hops = 3
      const hop = Math.abs(Math.sin((p * hops + ph * 0.1) * Math.PI)) * (1 - p) * 70
      y -= hop
      x += Math.sin(p * 9 + ph) * (1 - p) * 26
      angle = (1 - outCubic(p)) * (i % 2 ? -1 : 1) * 7
      face = 1 + (Math.floor(now * 22 + i * 3) % 6)
      if (p > 0.85) face = v
    } else if (since < ROLL_TIME + 0.25 && !held) {
      squash = 1 - outBack(prog(since, ROLL_TIME, ROLL_TIME + 0.25))
      squash = Math.max(0, squash)
    }
    const ringCol = o.turn === undefined ? C.yellow : C.yellow
    drawDie(g, x, y, t.size, face, {
      angle,
      held: held && o.showHeld !== false,
      lift: held ? 1 : 0,
      squash,
      ring: ringCol,
      dim: o.dim ?? false,
    })
  })
}

// ---------- score sheets ----------

export interface SheetCell {
  label: string
  /** Scored value, or null if the row is open. */
  value: number | null
  /** What scoring here would give right now (shown on open rows of the active player). */
  preview?: number | null
}

export interface SheetLayout {
  /** Red-frame rect of the sheet. */
  x: number
  y: number
  w: number
  h: number
  cols: number
  rows: number
  cellW: number
  cellH: number
}

export function sheetLayout(
  cols: number,
  rows: number,
  top: number,
  cellH = 132,
  w = 900,
): SheetLayout {
  return { x: (W - w) / 2, y: top, w, h: rows * cellH, cols, rows, cellW: w / cols, cellH }
}

/** Index of the sheet cell under a world point, for `side`, or -1. */
export function sheetCellAt(l: SheetLayout, side: Side, wx: number, wy: number): number {
  const { x, y } = toLocal(side, wx, wy)
  const c = Math.floor((x - l.x) / l.cellW)
  const r = Math.floor((y - l.y) / l.cellH)
  if (c < 0 || r < 0 || c >= l.cols || r >= l.rows) return -1
  return r * l.cols + c
}

/**
 * A player's score sheet on their half. Filled rows show their score in the
 * team colour; on the active player's turn, open rows show a live preview and
 * glow so it's obvious where a tap goes.
 */
export function drawSheet(
  g: Draw,
  side: Side,
  l: SheetLayout,
  cells: SheetCell[],
  o: { active: boolean; flashAt?: number; flashCell?: number; now?: number } = { active: false },
): void {
  const col = SIDE[side]
  const ta = textAngle(g, side)
  inFrame(g, side, () => {
    g.rrect(l.x - 14, l.y - 14, l.w + 28, l.h + 28, 34, alpha(C.ink, 0.55))
    cells.forEach((cell, i) => {
      const c = i % l.cols
      const r = Math.floor(i / l.cols)
      const x = l.x + c * l.cellW + 6
      const y = l.y + r * l.cellH + 6
      const w = l.cellW - 12
      const h = l.cellH - 12
      const filled = cell.value !== null
      const open = !filled && o.active && cell.preview !== undefined && cell.preview !== null
      let face: string = shade(C.ink3, -0.1)
      if (filled) face = shade(col.main, -0.45)
      if (open) face = cell.preview ? shade(col.main, -0.15) : shade(C.ink4, -0.05)
      const pop =
        o.flashCell === i && o.now !== undefined && o.flashAt !== undefined
          ? 1 + 0.12 * (1 - prog(o.now - o.flashAt, 0, 0.35))
          : 1
      g.at(
        x + w / 2,
        y + h / 2,
        0,
        () => {
          g.tile(-w / 2, -h / 2, w, h, 20, face, open ? 8 : 4)
          g.at(0, -4, ta, () => {
            g.text(cell.label, 0, -h * 0.2, {
              size: 30,
              weight: 600,
              color: filled ? alpha(C.white, 0.7) : alpha(C.white, open ? 0.95 : 0.55),
              maxWidth: w - 16,
            })
            const v = filled ? String(cell.value) : open ? String(cell.preview) : '–'
            g.text(v, 0, h * 0.17, {
              size: 46,
              weight: 700,
              color: filled
                ? C.white
                : open
                  ? cell.preview
                    ? C.yellow
                    : alpha(C.white, 0.6)
                  : alpha(C.white, 0.3),
            })
          })
        },
        pop,
      )
    })
  })
}

/** Big pill button in a side's frame (Roll, Score…). Returns nothing; hit-test with `buttonHit`. */
export interface ButtonLayout {
  x: number
  y: number
  w: number
  h: number
}

export function buttonHit(b: ButtonLayout, side: Side, wx: number, wy: number): boolean {
  const { x, y } = toLocal(side, wx, wy)
  return (
    x >= b.x - b.w / 2 - 20 &&
    x <= b.x + b.w / 2 + 20 &&
    y >= b.y - b.h / 2 - 20 &&
    y <= b.y + b.h / 2 + 20
  )
}

export function drawRollButton(
  g: Draw,
  side: Side,
  b: ButtonLayout,
  label: string,
  o: { enabled: boolean; pulse?: boolean; sub?: string } = { enabled: true },
): void {
  const col = SIDE[side]
  const ta = textAngle(g, side)
  inFrame(g, side, () => {
    const pulse = o.pulse ? 1 + 0.04 * Math.sin(g.t * 7) : 1
    g.at(
      b.x,
      b.y,
      0,
      () => {
        g.alpha(o.enabled ? 1 : 0.35, () => {
          g.tile(-b.w / 2, -b.h / 2, b.w, b.h, b.h / 2, o.enabled ? col.main : C.ink4, 14)
          g.at(0, -6, ta, () => {
            g.text(label, 0, o.sub ? -10 : 0, {
              size: 52,
              weight: 700,
              color: C.white,
              drop: alpha('#000000', 0.25),
            })
            if (o.sub) g.text(o.sub, 0, 36, { size: 30, weight: 600, color: alpha(C.white, 0.85) })
          })
        })
      },
      pulse,
    )
  })
}

/** Little dice-shaped pips showing rolls left (3 per turn). */
export function drawRollsLeft(
  g: Draw,
  side: Side,
  x: number,
  y: number,
  left: number,
  max = 3,
): void {
  inFrame(g, side, () => {
    for (let i = 0; i < max; i++) {
      const on = i < left
      g.rrect(
        x + (i - (max - 1) / 2) * 44 - 15,
        y - 15,
        30,
        30,
        8,
        on ? C.white : alpha(C.white, 0.15),
      )
      if (on) g.circle(x + (i - (max - 1) / 2) * 44, y, 5, C.ink)
    }
  })
}

/** Total figure for a side, in their frame. */
export function drawTotal(
  g: Draw,
  side: Side,
  x: number,
  y: number,
  total: number,
  label = 'Total',
): void {
  const ta = textAngle(g, side)
  inFrame(g, side, () =>
    g.at(x, y, ta, () => {
      g.text(label, 0, -36, { size: 30, weight: 600, color: alpha(C.white, 0.7) })
      g.text(total, 0, 14, {
        size: 64,
        weight: 700,
        color: SIDE[side].main,
        drop: alpha('#000000', 0.35),
      })
    }),
  )
}
