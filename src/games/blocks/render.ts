import type { Side } from '../../core/game.ts'
import { lerp, outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import {
  anyFit,
  type Cell,
  clearLines,
  colorOf,
  covered,
  N,
  type Shape,
  SHAPES,
  shapeOf,
  snap,
} from './rules.ts'

/**
 * Block colours: toy colours, kept away from the two side colours and from
 * yellow (yellow marks the one active thing: the lines a drop would clear).
 */
export const TOYS = [C.orange, C.green, C.cyan, C.pink, C.purple, C.cream] as const

/** How long a dragged piece takes to grow from tray size to grid size (s). */
const PICKUP = 0.12
/** How long a refused piece takes to fly back to its tray slot (s). */
export const BACK = 0.2
/** How long cleared blocks take to flash and burst (s). */
const CLEAR = 0.45

export interface Layout {
  /** Block size and grid origin (panel-local). */
  cs: number
  gx0: number
  gy0: number
  /** Top of the tray strip, its height, and the centre line of its pieces. */
  trayTop: number
  trayH: number
  trayY: number
  /** Largest block size of the pieces in the tray. */
  ts: number
  /** How far a dragged piece floats above the finger (toward the far edge). */
  lift: number
  headerY: number
  solo: boolean
}

/** Layout for a panel of w × h: a half (1000 × 900) or the whole stage in solo (1000 × 1800). */
export function layout(w: number, h: number): Layout {
  if (h > 1000) {
    // Off-centre to the right: the pause button sits over the left edge at mid-height.
    const cs = 108
    const gy0 = 250
    return {
      cs,
      gx0: 112,
      gy0,
      trayTop: gy0 + cs * N + 120,
      trayH: 340,
      trayY: gy0 + cs * N + 290,
      ts: 60,
      lift: cs * 1.9,
      headerY: 80,
      solo: true,
    }
  }
  const cs = 74
  return {
    cs,
    gx0: (w - cs * N) / 2,
    gy0: 108,
    trayTop: 742,
    trayH: 156,
    trayY: 820,
    ts: 42,
    lift: 150,
    headerY: 50,
    solo: false,
  }
}

/** Which tray slot (0..2) is at panel-local (x, y), or -1 above the tray strip. */
export function traySlotAt(w: number, l: Layout, x: number, y: number): number {
  if (y < l.trayTop) return -1
  return Math.min(2, Math.max(0, Math.floor((x / w) * 3)))
}

/** Block size for a piece resting in a tray slot: as big as fits the slot, up to `l.ts`. */
export function traySize(w: number, l: Layout, shape: Shape): number {
  return Math.min(l.ts, (l.trayH - 36) / shape.h, (w / 3 - 60) / shape.w)
}

export interface PanelView {
  side: Side
  name: string
  score: number
  scoreAt: number
  grid: readonly number[]
  tray: readonly (number | null)[]
  placed: readonly number[]
  placedAt: number
  /** How hard the last piece was slammed down, 0..1. */
  slam: number
  fade: readonly { cell: number; value: number }[]
  fadeAt: number
  /** Lines cleared by the last drop (for the combo banner). */
  lines: number
  drag: { slot: number; x: number; y: number; at: number } | null
  back: { slot: number; x: number; y: number; at: number } | null
  dead: boolean
  deadAt: number
  /** Seconds left, shown in each board's header row. */
  clock: number | null
  hint: boolean
  /** The solo record (null when there is none or not solo). */
  best: number | null
  now: number
}

/** One block: a raised toy tile, inset so neighbours read as separate pieces. */
export function block(g: Draw, x: number, y: number, s: number, color: string, a = 1): void {
  const draw = () => {
    const inset = s * 0.04
    const b = s * 0.92
    g.tile(x + inset, y + inset, b, b, s * 0.2, color, Math.max(3, s * 0.13))
    // A little glint in the corner: a glossy toy, not a flat square.
    g.circle(
      x + inset + b * 0.24,
      y + inset + b * 0.22,
      Math.max(2, s * 0.06),
      alpha('#ffffff', 0.55),
    )
  }
  if (a >= 1) draw()
  else g.alpha(a, draw)
}

/** A piece drawn with its top-left block at (x, y), blocks `s` wide. */
function piece(
  g: Draw,
  x: number,
  y: number,
  s: number,
  cells: readonly Cell[],
  color: string,
  a = 1,
): void {
  for (const [cx, cy] of cells) block(g, x + cx * s, y + cy * s, s, color, a)
}

/** A piece's flat shadow (the dragged piece floats above the board). */
function pieceShadow(g: Draw, x: number, y: number, s: number, cells: readonly Cell[]): void {
  for (const [cx, cy] of cells) {
    g.rrect(
      x + cx * s + s * 0.06,
      y + cy * s + s * 0.06,
      s * 0.88,
      s * 0.88,
      s * 0.2,
      alpha('#000000', 0.3),
    )
  }
}

function timerPill(g: Draw, x: number, y: number, sec: number, now: number): void {
  const s = Math.max(0, Math.ceil(sec))
  const label = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const urgent = s <= 10
  const col = urgent ? C.yellow : C.white
  const beat = urgent ? 1 + 0.08 * Math.max(0, 1 - (now % 1) * 4) : 1
  g.at(
    x,
    y,
    0,
    () => {
      g.rrect(-110, -40, 220, 80, 30, alpha(C.ink, 0.75))
      g.text(label, 0, 3, { size: 56, weight: 700, color: col })
    },
    beat,
  )
}

const COMBO = ['', '', 'Double!', 'Triple!', 'Quad!', 'Mega!', 'Mega!']

/** A soft pool of team-coloured light under the play area: the floodlit table. */
function floodlight(g: Draw, side: Side, x: number, y: number, r: number): void {
  g.circle(
    x,
    y,
    r,
    g.rad(x, y, 0, r, [
      [0, alpha(SIDE[side].main, 0.2)],
      [0.55, alpha(SIDE[side].main, 0.07)],
      [1, alpha(SIDE[side].main, 0)],
    ]),
  )
}

export function drawPanel(g: Draw, w: number, h: number, v: PanelView): void {
  const l = layout(w, h)
  const col = SIDE[v.side]
  const { cs, gx0: x0, gy0: y0 } = l
  const size = cs * N
  const dim = v.dead ? prog(v.now - v.deadAt, 0, 0.5) : 0
  floodlight(g, v.side, x0 + size / 2, y0 + size / 2, size * 1.0)

  // Header: name, clock, score.
  g.sideMark(v.side, 170, l.headerY, 14, col.light)
  g.text(v.name, 200, l.headerY + 2, {
    size: 40,
    weight: 600,
    align: 'left',
    color: alpha(C.white, 0.85),
    maxWidth: 240,
  })
  const pop = prog(v.now - v.scoreAt, 0, 0.3)
  const sScale = pop < 1 ? 1 + 0.25 * Math.sin(pop * Math.PI) : 1
  g.at(
    w - 160,
    l.headerY + 4,
    0,
    () =>
      g.text(String(v.score), 0, 0, {
        size: l.solo ? 84 : 70,
        weight: 700,
        align: 'right',
        color: pop < 1 ? mix(C.yellow, C.white, pop) : C.white,
        drop: alpha('#000000', 0.35),
      }),
    sScale,
  )
  if (v.clock !== null) timerPill(g, w / 2 + 20, l.headerY, v.clock, v.now)

  // The well the grid sits in: a lipped frame in the side's colour.
  g.rrect(x0 - 22, y0 - 8, size + 44, size + 44, 40, alpha('#000000', 0.4))
  g.rrect(
    x0 - 22,
    y0 - 22,
    size + 44,
    size + 44,
    40,
    g.lin(0, y0 - 22, 0, y0 + size + 22, [
      [0, shade(col.main, -0.05)],
      [1, shade(col.dark, -0.35)],
    ]),
  )
  g.rrect(x0 - 12, y0 - 12, size + 24, size + 24, 30, shade(col.dark, -0.72))
  g.rrect(
    x0 - 12,
    y0 - 12,
    size + 24,
    36,
    18,
    g.lin(0, y0 - 12, 0, y0 + 24, [
      [0, alpha('#000000', 0.4)],
      [1, alpha('#000000', 0)],
    ]),
  )
  for (let i = 0; i < N * N; i++) {
    g.rrect(
      x0 + (i % N) * cs + 4,
      y0 + Math.floor(i / N) * cs + 4,
      cs - 8,
      cs - 8,
      cs * 0.18,
      alpha('#000000', 0.3),
    )
  }

  // Placed blocks: the last piece pops in, cleared blocks flash and burst.
  const popK = prog(v.now - v.placedAt, 0, 0.3)
  for (let i = 0; i < N * N; i++) {
    const val = v.grid[i] as number
    if (!val) continue
    const bx = x0 + (i % N) * cs
    const by = y0 + Math.floor(i / N) * cs
    const color =
      dim > 0 ? mix(TOYS[val - 1] as string, C.ink3, dim * 0.75) : (TOYS[val - 1] as string)
    if (popK < 1 && v.placed.includes(i)) {
      // A slammed piece lands flatter and bounces back harder.
      const from = 0.55 - 0.2 * v.slam
      const sc = from + (1 - from) * outBack(popK) + 0.1 * v.slam * Math.sin(popK * Math.PI)
      g.at(bx + cs / 2, by + cs / 2, 0, () => block(g, -cs / 2, -cs / 2, cs, color), sc)
    } else block(g, bx, by, cs, color)
  }
  const ft = prog(v.now - v.fadeAt, 0, CLEAR)
  if (ft < 1 && v.fade.length) {
    // Beams along each line that went.
    const gone = new Set(v.fade.map((f) => f.cell))
    const beam = 1 - outCubic(ft)
    for (let r = 0; r < N; r++) {
      let full = true
      for (let c = 0; c < N; c++) if (!gone.has(r * N + c)) full = false
      if (full) {
        const th = cs * (0.6 + 0.6 * ft)
        g.alpha(beam, () =>
          g.rrect(
            x0 - 10,
            y0 + (r + 0.5) * cs - th / 2,
            size + 20,
            th,
            th / 2,
            alpha(C.yellow, 0.55),
          ),
        )
      }
    }
    for (let c = 0; c < N; c++) {
      let full = true
      for (let r = 0; r < N; r++) if (!gone.has(r * N + c)) full = false
      if (full) {
        const th = cs * (0.6 + 0.6 * ft)
        g.alpha(beam, () =>
          g.rrect(
            x0 + (c + 0.5) * cs - th / 2,
            y0 - 10,
            th,
            size + 20,
            th / 2,
            alpha(C.yellow, 0.55),
          ),
        )
      }
    }
    for (const f of v.fade) {
      const bx = x0 + (f.cell % N) * cs + cs / 2
      const by = y0 + Math.floor(f.cell / N) * cs + cs / 2
      // A white flash first, then the block swells and fades.
      const flash = ft < 0.3
      const k = prog(ft, 0.25, 1)
      g.at(
        bx,
        by,
        0,
        () => {
          block(g, -cs / 2, -cs / 2, cs, flash ? C.white : (TOYS[f.value - 1] as string), 1 - k)
        },
        1 + 0.3 * k,
      )
    }
  }

  // Drag: the ghost of where the piece lands, the lines it would clear, and the piece itself.
  const d = v.drag
  const dragged = d ? v.tray[d.slot] : null
  if (d && dragged !== null && dragged !== undefined) {
    const shape = SHAPES[shapeOf(dragged)] as Shape
    const color = TOYS[colorOf(dragged)] as string
    const grow = outCubic(prog(v.now - d.at, 0, PICKUP))
    const cx = d.x
    const cy = d.y - l.lift * grow
    const s = snap(v.grid, shape, (cx - x0) / cs, (cy - y0) / cs)
    if (s.ok) {
      const ghost = covered(shape.cells, s.x, s.y)
      const filled = v.grid.slice()
      for (const i of ghost) filled[i] = 1
      const { cleared } = clearLines(filled)
      const pulse = 0.4 + 0.2 * Math.sin(v.now * 10)
      for (const i of cleared) {
        g.rrect(
          x0 + (i % N) * cs + 2,
          y0 + Math.floor(i / N) * cs + 2,
          cs - 4,
          cs - 4,
          cs * 0.18,
          alpha(C.yellow, pulse),
        )
      }
      piece(g, x0 + s.x * cs, y0 + s.y * cs, cs, shape.cells, color, 0.35)
      for (const i of ghost) {
        g.rrect(
          x0 + (i % N) * cs + 5,
          y0 + Math.floor(i / N) * cs + 5,
          cs - 10,
          cs - 10,
          cs * 0.18,
          undefined,
          alpha(C.white, 0.5),
          3,
        )
      }
    }
    const ts = traySize(w, l, shape)
    // Held pieces read a touch larger than the grid, so the ghost peeks out underneath.
    const bs = lerp(ts, cs * 1.06, grow)
    const px = cx - (shape.w * bs) / 2
    const py = cy - (shape.h * bs) / 2
    pieceShadow(g, px + bs * 0.12, py + bs * 0.3 * grow, bs, shape.cells)
    piece(g, px, py, bs, shape.cells, color, 1)
  }

  // Tray.
  const third = w / 3
  const pulse = 0.5 + 0.5 * Math.sin(v.now * 5)
  for (let slot = 0; slot < 3; slot++) {
    const sx = third * (slot + 0.5)
    const sy = l.trayTop + l.trayH / 2
    const held = d !== null && d.slot === slot
    g.rrect(
      sx - third / 2 + 16,
      l.trayTop + 10,
      third - 32,
      l.trayH - 20,
      40,
      alpha('#000000', held ? 0.12 : 0.24),
      held ? alpha(C.yellow, 0.4 + 0.3 * pulse) : alpha(col.light, 0.08),
      held ? 5 : 3,
    )
    const code = v.tray[slot]
    if (code === null || code === undefined || held) continue
    const shape = SHAPES[shapeOf(code)] as Shape
    const fits = v.dead || anyFit(v.grid, shape)
    const color = fits
      ? (TOYS[colorOf(code)] as string)
      : mix(TOYS[colorOf(code)] as string, C.ink3, 0.7)
    const ts = traySize(w, l, shape)
    let px = sx
    let py = sy
    let bs = ts
    const b = v.back
    if (b && b.slot === slot) {
      const k = outCubic(prog(v.now - b.at, 0, BACK))
      px = lerp(b.x, sx, k)
      py = lerp(b.y, sy, k)
      bs = lerp(l.cs, ts, k)
    }
    piece(
      g,
      px - (shape.w * bs) / 2,
      py - (shape.h * bs) / 2,
      bs,
      shape.cells,
      color,
      fits ? 1 : 0.7,
    )
  }

  if (v.best !== null) chip(g, w / 2, l.trayTop + l.trayH + 70, `Best ${v.best}`, v.side, '🏆')

  if (v.hint && !d) {
    const a = 0.6 + 0.4 * pulse
    g.alpha(a, () => {
      g.rrect(w / 2 - 290, y0 + size / 2 - 40, 580, 80, 40, alpha(C.ink, 0.75))
      g.text('Drag a piece onto the grid', w / 2, y0 + size / 2 + 2, {
        size: 36,
        weight: 600,
        color: C.white,
      })
    })
  }

  // Combo banner on a multi-line clear.
  const ct = v.now - v.fadeAt
  if (v.lines >= 2 && ct < 0.9) {
    const k = outBack(prog(ct, 0, 0.25))
    const out = prog(ct, 0.65, 0.9)
    g.alpha(1 - out, () =>
      g.at(
        w / 2,
        y0 + size / 2,
        -0.06,
        () =>
          g.text(COMBO[Math.min(v.lines, 6)] as string, 0, 0, {
            size: l.solo ? 110 : 88,
            weight: 700,
            color: C.yellow,
            stroke: shade(col.dark, -0.5),
            strokeWidth: 14,
          }),
        k,
      ),
    )
  }

  if (v.dead) {
    const k = outBack(prog(v.now - v.deadAt, 0.15, 0.5))
    g.alpha(0.6 * dim, () => g.rrect(x0 - 22, y0 - 22, size + 44, size + 44, 40, C.ink))
    const cy = y0 + size / 2
    g.at(
      w / 2,
      cy,
      0,
      () => {
        g.rrect(-320, -96, 640, 192, 60, shade(col.dark, -0.4))
        g.rrect(-320, -104, 640, 192, 60, col.main)
        g.text('No moves left', 0, -30, { size: 60, weight: 700 })
        g.text(`Score ${v.score}`, 0, 42, { size: 44, weight: 600, color: alpha(C.white, 0.9) })
      },
      k,
    )
  }
}

/** A small chip with an emoji, e.g. the solo record under the table. */
export function chip(g: Draw, x: number, y: number, label: string, side: Side, icon: string): void {
  const w = g.measure(label, 34, 600) + 104
  g.rrect(x - w / 2, y - 26, w, 52, 26, alpha(shade(SIDE[side].main, -0.6), 0.9))
  g.emoji(icon, x - w / 2 + 44, y, 32)
  g.text(label, x + 22, y + 2, { size: 34, weight: 600, color: alpha(C.white, 0.8) })
}
