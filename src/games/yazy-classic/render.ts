import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, shade, SIDE } from '../../core/render/palette.ts'
import {
  drawRollButton,
  drawTray,
  inFrame,
  ROLL_TIME,
  rolling,
  sheetLayout,
  textAngle,
  trayLayout,
} from '../../engines/dice/index.ts'
import { drawThrownDice, TAP_POW } from '../yazy/throw.ts'
import type { State } from './index.ts'
import {
  isYazy,
  jokerRules,
  legalRows,
  MAX_ROLLS,
  ROWS,
  total,
  turnsPlayed,
  UPPER_BONUS,
  UPPER_TARGET,
  upperSum,
  valueOf,
  YAZY_BONUS,
  YAZY_ROW,
} from './rules.ts'

/** Layout, written in red's frame (bottom half); blue's is the same turned 180°. */
export const TRAY = trayLayout(5, 900, 108)
/** Two columns: the upper section (with its bonus line) on the left, the lower section on the right. */
export const SHEET = sheetLayout(2, 7, 1046, 70, 900)
export const ROLL = { x: 500, y: 1612, w: 300, h: 92 }
const TOTAL = { x: 184, w: 280, h: 84 }
const PIPS_X = 832

/** Row index for each sheet cell, row-major (cell = r * 2 + c). -1 is the upper bonus line. */
export const CELL_ROW: readonly number[] = [0, 6, 1, 7, 2, 8, 3, 9, 4, 10, 5, 11, -1, 12]

export const cellOfRow = (row: number): number => CELL_ROW.indexOf(row)

/** Centre of a sheet cell in red's frame. */
export function cellCentre(cell: number): { x: number; y: number } {
  const c = cell % SHEET.cols
  const r = Math.floor(cell / SHEET.cols)
  return { x: SHEET.x + (c + 0.5) * SHEET.cellW, y: SHEET.y + (r + 0.5) * SHEET.cellH }
}

/** When the end ribbon starts after the game is decided. */
export const END_DELAY = 0.35

const PIP_AT: Record<number, [number, number][]> = {
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

/** A small flat die face, used as the icon of the upper rows and the rolls-left counter. */
function miniDie(
  g: Draw,
  x: number,
  y: number,
  size: number,
  face: number,
  body: string,
  pip: string,
) {
  const h = size / 2
  g.rrect(x - h, y - h + size * 0.1, size, size, size * 0.24, shade(body, -0.35))
  g.rrect(x - h, y - h, size, size, size * 0.24, body)
  const k = size * 0.26
  const pr = size * 0.095
  for (const [px, py] of PIP_AT[face] ?? []) g.circle(x + px * k, y + py * k, pr, pip)
}

type Kind = 'filled' | 'preview' | 'open' | 'bonus'

interface CellView {
  kind: Kind
  label: string
  value: string
  pts: number
  /** Upper rows show their face as a die icon. */
  face: number
  chip?: string
  /** A bonus Yazy that must go in this row. */
  forced?: boolean
  /** Upper bonus progress 0..1. */
  progress?: number
  earned?: boolean
}

function cellView(
  s: State,
  side: Side,
  row: number,
  legal: readonly number[],
  canScore: boolean,
): CellView {
  const sheet = s.sheets[side]
  if (row < 0) {
    const sum = upperSum(sheet)
    const earned = sum >= UPPER_TARGET
    return {
      kind: 'bonus',
      label: 'Bonus',
      value: earned ? `+${UPPER_BONUS}` : `${sum}/${UPPER_TARGET}`,
      pts: 0,
      face: 0,
      progress: Math.min(1, sum / UPPER_TARGET),
      earned,
    }
  }
  const r = ROWS[row]
  const label = r?.label ?? ''
  const face = r?.face ?? 0
  const v = sheet.rows[row] ?? null
  const chip =
    row === YAZY_ROW && sheet.yazyBonus > 0 ? `+${YAZY_BONUS}×${sheet.yazyBonus}` : undefined
  if (v !== null) return { kind: 'filled', label, value: String(v), pts: v, face, chip }
  if (canScore && legal.includes(row)) {
    const pts = valueOf(s.dice, sheet, row).points
    const forced = legal.length === 1 && jokerRules(s.dice, sheet)
    return { kind: 'preview', label, value: String(pts), pts, face, forced, chip }
  }
  return { kind: 'open', label, value: '–', pts: 0, face, chip }
}

function drawCell(
  g: Draw,
  side: Side,
  v: CellView,
  w: number,
  h: number,
  ta: number,
  o: { best: boolean; dim: boolean; now: number },
): void {
  const col = SIDE[side]
  let face: string
  let depth = 4
  if (v.kind === 'filled') face = shade(col.main, -0.32)
  else if (v.kind === 'preview') {
    face = v.pts > 0 ? shade(C.ink4, 0.06) : C.ink3
    depth = 8
  } else if (v.kind === 'bonus') face = v.earned ? shade(C.yellow, -0.15) : shade(C.ink, 0.04)
  else face = shade(C.ink3, -0.12)
  const lift = v.kind === 'preview' ? -2 : 0
  g.tile(-w / 2, -h / 2 + lift, w, h, 18, face, depth)
  if (v.kind === 'preview' && v.pts > 0) {
    g.rrect(-w / 2, -h / 2 + lift, w, h - depth, 18, undefined, alpha(C.white, 0.35), 3)
  }
  if (v.forced || (o.best && v.kind === 'preview')) {
    const a = v.forced ? 0.75 + 0.25 * Math.sin(o.now * 8) : 1
    g.alpha(a, () =>
      g.rrect(-w / 2 - 5, -h / 2 - 5 + lift, w + 10, h + 10 - depth, 22, undefined, C.yellow, 5),
    )
  }
  if (v.kind === 'bonus' && !v.earned) {
    // Progress toward the +35, along the bottom of the line.
    const bw = w - 28
    const p = v.progress ?? 0
    g.at(0, 0, ta, () => {
      g.rrect(-bw / 2, h / 2 - 14, bw, 6, 3, alpha('#000000', 0.45))
      if (p > 0) g.rrect(-bw / 2, h / 2 - 14, bw * p, 6, 3, mix(col.main, C.yellow, 0.35))
    })
  }
  g.at(0, lift - (v.kind === 'bonus' ? 7 : 4), ta, () => {
    let lx = -w / 2 + 20
    if (v.face > 0) {
      const on = v.kind !== 'open'
      miniDie(
        g,
        lx + 19,
        -2,
        36,
        v.face,
        on ? C.white : alpha(C.white, 0.35),
        v.kind === 'filled' ? shade(col.main, -0.3) : C.ink,
      )
      lx += 50
    }
    const ink = v.kind === 'bonus' && v.earned
    const labelCol = ink
      ? C.ink
      : v.kind === 'filled'
        ? alpha(C.white, 0.85)
        : v.kind === 'preview'
          ? C.white
          : alpha(C.white, 0.5)
    g.text(v.label, lx, 0, {
      size: 34,
      weight: 600,
      align: 'left',
      color: labelCol,
      maxWidth: w - (lx + w / 2) - 92,
    })
    if (v.chip) {
      const cw = Math.min(g.measure(v.label, 34, 600), w - (lx + w / 2) - 92)
      const chipW = g.measure(v.chip, 34, 700) + 24
      const cx = lx + cw + 10 + chipW / 2
      g.rrect(cx - chipW / 2, -23, chipW, 46, 23, C.yellow)
      g.text(v.chip, cx, 1, { size: 34, weight: 700, color: C.ink })
    }
    const valueCol = ink
      ? C.ink
      : v.kind === 'filled'
        ? C.white
        : v.kind === 'preview'
          ? v.pts > 0
            ? C.yellow
            : alpha(C.white, 0.45)
          : v.kind === 'bonus'
            ? alpha(C.white, 0.65)
            : alpha(C.white, 0.25)
    g.text(v.value, w / 2 - 20, 0, {
      size: v.kind === 'bonus' ? 36 : 44,
      weight: 700,
      align: 'right',
      color: valueCol,
      drop:
        v.kind === 'filled' || (v.kind === 'preview' && v.pts > 0)
          ? alpha('#000000', 0.3)
          : undefined,
    })
  })
  if (o.dim) g.rrect(-w / 2, -h / 2, w, h, 18, alpha(C.ink, 0.35))
}

function drawSheet(
  g: Draw,
  side: Side,
  s: State,
  now: number,
  o: { canScore: boolean; mine: boolean },
): void {
  const ta = textAngle(g, side)
  const legal = o.canScore ? legalRows(s.dice, s.sheets[side]) : []
  const l = SHEET
  const col = SIDE[side]
  const views = CELL_ROW.map((row) => cellView(s, side, row, legal, o.canScore))
  // The single best preview (most points) gets the yellow ring: the obvious tap.
  let best = -1
  views.forEach((v, i) => {
    if (v.kind === 'preview' && v.pts > 0 && (best < 0 || v.pts > (views[best]?.pts ?? 0))) best = i
  })
  inFrame(g, side, () => {
    const px = l.x - 14
    const py = l.y - 14
    const pw = l.w + 28
    const ph = l.h + 28
    if (o.mine) {
      g.alpha(0.35 + 0.2 * Math.sin(now * 5), () =>
        g.rrect(px - 10, py - 10, pw + 20, ph + 20, 44, undefined, col.main, 8),
      )
    }
    g.rrect(
      px,
      py,
      pw,
      ph,
      34,
      g.lin(0, py, 0, py + ph, [
        [0, shade(col.main, -0.74)],
        [1, shade(col.main, -0.84)],
      ]),
      alpha(col.main, o.mine ? 0.55 : 0.22),
      3,
    )
    // Section divider between the two columns.
    g.line(W2, l.y + 10, W2, l.y + l.h - 10, alpha(C.white, 0.06), 3)
    CELL_ROW.forEach((row, i) => {
      const c = i % l.cols
      const r = Math.floor(i / l.cols)
      const x = l.x + c * l.cellW + 6
      const y = l.y + r * l.cellH + 5
      const w = l.cellW - 12
      const h = l.cellH - 10
      const v = views[i] as CellView
      let pop = 1
      let flash = 0
      if (s.last && s.last.side === side && s.last.row === row) {
        const t = now - s.last.at
        pop = 1 + 0.14 * (1 - outCubic(prog(t, 0, 0.4)))
        flash = 1 - prog(t, 0, 0.45)
      }
      if (row < 0 && s.upperAt && s.upperAt.side === side) {
        const t = now - s.upperAt.at
        pop = Math.max(pop, 1 + 0.18 * (1 - outCubic(prog(t, 0, 0.7))))
        flash = Math.max(flash, 1 - prog(t, 0, 0.6))
      }
      g.at(
        x + w / 2,
        y + h / 2,
        0,
        () => {
          drawCell(g, side, v, w, h, ta, {
            best: i === best && !v.forced,
            dim: o.canScore && v.kind === 'open',
            now,
          })
          if (flash > 0) g.alpha(flash * 0.7, () => g.rrect(-w / 2, -h / 2, w, h - 4, 18, C.white))
        },
        pop,
        pop,
      )
    })
  })
}

const W2 = SHEET.x + SHEET.w / 2

/** Total plaque left of the Roll button: counts up after each score, with the turn of the match under it. */
function drawTotal(g: Draw, side: Side, s: State, now: number, rounds: number): void {
  const ta = textAngle(g, side)
  const col = SIDE[side]
  const value = total(s.sheets[side])
  let shown = value
  let bump = 1
  if (s.last && s.last.side === side) {
    const t = now - s.last.at
    shown = Math.round(value - s.last.gain * (1 - outCubic(prog(t, 0.1, 0.8))))
    bump = 1 + 0.12 * Math.sin(Math.PI * prog(t, 0.1, 0.5))
  }
  inFrame(g, side, () =>
    g.at(
      TOTAL.x,
      ROLL.y,
      0,
      () => {
        g.tile(-TOTAL.w / 2, -TOTAL.h / 2, TOTAL.w, TOTAL.h, 26, shade(col.main, -0.62), 8)
        g.at(0, -4, ta, () => {
          g.text('Total', -TOTAL.w / 2 + 20, -12, {
            size: 34,
            weight: 600,
            align: 'left',
            color: alpha(C.white, 0.7),
          })
          const turns = turnsPlayed(s.sheets[side])
          g.text(
            turns >= rounds ? 'Finished' : `Turn ${turns + 1} of ${rounds}`,
            -TOTAL.w / 2 + 20,
            24,
            {
              size: 28,
              weight: 600,
              align: 'left',
              color: alpha(C.white, 0.68),
            },
          )
          g.text(shown, TOTAL.w / 2 - 18, 0, {
            size: 56,
            weight: 700,
            align: 'right',
            color: col.light,
            drop: alpha('#000000', 0.35),
          })
        })
      },
      bump,
    ),
  )
}

/** Rolls left as three little dice; the used ones go dark. */
function drawRollsLeft(g: Draw, side: Side, left: number, mine: boolean): void {
  inFrame(g, side, () => {
    for (let i = 0; i < MAX_ROLLS; i++) {
      const on = i < left
      const x = PIPS_X + (i - 1) * 54
      if (on) miniDie(g, x, ROLL.y - 4, 40, i + 1, mine ? C.white : alpha(C.white, 0.5), C.ink)
      else g.rrect(x - 20, ROLL.y - 24, 40, 40, 10, undefined, alpha(C.white, 0.18), 3)
    }
  })
}

/** Gold glow and a "Yazy!" stamp over the tray when five alike land. */
function drawYazyMoment(g: Draw, s: State, now: number): void {
  if (!isYazy(s.dice) || s.rolls === 0) return
  const t = now - s.rolledAt - ROLL_TIME
  if (t < 0) return
  const t0 = TRAY
  const pulse = 0.5 + 0.5 * Math.sin(now * 7)
  g.alpha(0.5 + 0.4 * pulse, () =>
    g.rrect(t0.x - 22, t0.y - 22, t0.w + 44, t0.h + 44, 60, undefined, C.yellow, 10),
  )
  if (t > 1.6) return
  const k = outBack(prog(t, 0, 0.35))
  const a = 1 - prog(t, 1.2, 1.6)
  g.alpha(a, () =>
    g.at(
      500,
      900,
      g.orient(s.turn) - 0.08,
      () => {
        g.text('YAZY!', 0, 0, {
          size: 120,
          weight: 700,
          color: C.yellow,
          stroke: C.ink,
          strokeWidth: 18,
          drop: alpha('#000000', 0.4),
        })
      },
      k,
    ),
  )
}

/** The final ribbon over each sheet: winner in gold, both totals big. */
function drawEnding(g: Draw, s: State, now: number): void {
  if (!s.end) return
  const t = now - s.end.at - END_DELAY
  if (t < 0) return
  for (const side of [0, 1] as Side[]) {
    const ta = textAngle(g, side)
    const won = s.end.winner === side
    const draw = s.end.winner === 'draw'
    const k = outBack(prog(t - (won ? 0 : 0.15), 0, 0.45))
    if (k <= 0) continue
    const cy = SHEET.y + SHEET.h / 2
    inFrame(g, side, () => {
      g.alpha(0.55 * prog(t, 0, 0.3), () =>
        g.rrect(SHEET.x - 14, SHEET.y - 14, SHEET.w + 28, SHEET.h + 28, 34, C.ink),
      )
      g.at(
        500,
        cy,
        0,
        () => {
          const w = 600
          const h = 230
          const face = won ? C.yellow : draw ? C.ink4 : shade(SIDE[side].main, -0.5)
          if (won) {
            g.alpha(0.35 + 0.2 * Math.sin(now * 6), () =>
              g.rrect(-w / 2 - 18, -h / 2 - 18, w + 36, h + 36, 70, C.yellow),
            )
          }
          g.tile(-w / 2, -h / 2, w, h, 56, face, 16)
          g.at(0, -8, ta, () => {
            const ink = won ? C.ink : C.white
            g.text(won ? 'Winner!' : draw ? 'Draw' : 'Final', 0, -46, {
              size: 50,
              weight: 700,
              color: won ? C.ink : alpha(C.white, 0.8),
            })
            g.text(total(s.sheets[side]), 0, 34, {
              size: 96,
              weight: 700,
              color: ink,
              drop: alpha('#000000', won ? 0.15 : 0.35),
            })
          })
          if (won) {
            for (let i = 0; i < 3; i++) {
              const a = now * 1.4 + (i * Math.PI * 2) / 3
              g.star(Math.cos(a) * (w / 2 + 10), Math.sin(a) * (h / 2 + 4), 24, C.white, 5, 0.45, a)
            }
          }
        },
        k,
      )
    })
  }
}

export function renderClassic(
  g: Draw,
  s: State,
  now: number,
  over: boolean,
  isBot: (side: Side) => boolean,
  rounds: number,
  rattle = 0,
): void {
  for (const side of [0, 1] as Side[]) {
    const mine = s.turn === side && !over
    const canScore = mine && s.rolls > 0 && !rolling(s, now)
    drawSheet(g, side, s, now, { canScore, mine })
    const left = mine ? MAX_ROLLS - s.rolls : MAX_ROLLS
    const out = mine && s.rolls >= MAX_ROLLS
    const label = out ? 'Pick a row' : 'Roll'
    // Online, each phone shows only its own Roll button.
    if (g.viewer === null || g.viewer === side)
      drawRollButton(g, side, ROLL, label, {
        enabled: mine && (s.rolls < MAX_ROLLS || isBot(side)),
        pulse: mine && !isBot(side) && s.rolls === 0,
      })
    drawRollsLeft(g, side, left, mine)
    drawTotal(g, side, s, now, rounds)
  }
  drawTray(g, TRAY, over ? null : s.turn)
  // Before the first roll the dice jiggle a little: they are waiting to be thrown.
  const idle = !over && s.rolls === 0 && !isBot(s.turn) ? 0.25 : 0
  drawThrownDice(g, TRAY, s, now, s.pow ?? TAP_POW, {
    dim: s.rolls === 0 && !over,
    rattle: Math.max(rattle, idle),
  })
  drawYazyMoment(g, s, now)
  drawEnding(g, s, now)
}
