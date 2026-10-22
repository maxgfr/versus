import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { cellCenter, drawBoard, type Geom } from '../../engines/board/index.ts'
import type { State } from './index.ts'

/** Seconds after a round ends before the board is cleared for the next one. */
export const CLEAR_AT = 1.6
/** The marks sweep away during this last stretch of the pause. */
const SWEEP = 0.28

/** Red plays rings (circle = red everywhere), blue plays crosses. */
export function drawMark(
  g: Draw,
  side: Side,
  x: number,
  y: number,
  size: number,
  t: number,
  sx = 1,
  sy = sx,
  angle = 0,
): void {
  const p = outCubic(prog(t, 0, 0.28))
  const s = outBack(prog(t, 0, 0.32))
  const col = SIDE[side]
  const lw = size * 0.2
  g.at(
    x,
    y,
    angle,
    () => {
      if (side === 0) {
        g.arc(0, lw * 0.25, size * 0.36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p, col.dark, lw)
        g.arc(0, 0, size * 0.36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p, col.main, lw)
      } else {
        const k = size * 0.32
        const p1 = Math.min(1, p * 2)
        const p2 = Math.max(0, p * 2 - 1)
        for (const [dy, c] of [
          [lw * 0.25, col.dark],
          [0, col.main],
        ] as const) {
          g.line(-k, -k + dy, -k + 2 * k * p1, -k + 2 * k * p1 + dy, c, lw)
          if (p2 > 0) g.line(k, -k + dy, k - 2 * k * p2, -k + 2 * k * p2 + dy, c, lw)
        }
      }
    },
    s * sx,
    s * sy,
  )
}

/** Wind-up then rush: the sweep-away curve. */
const inBack = (t: number): number => 2.70158 * t * t * t - 1.70158 * t * t

/** Damped wobble after an impact at t = 0: positive = wider and flatter. */
const wobble = (t: number, amp: number, freq = 26, decay = 9): number =>
  t <= 0 ? 0 : amp * Math.exp(-t * decay) * Math.sin(t * freq)

/**
 * The board. Every motion is a pure function of `now` and times stamped in the
 * state, so the online guest sees exactly the same animation.
 * `hint` tints the empty cells for the human to move.
 */
export function renderBoard(
  g: Draw,
  s: State,
  geo: Geom,
  now: number,
  hint: Side | null = null,
): void {
  drawBoard(g, geo, C.ink3, {
    cellColor: () => shade(C.ink3, -0.35),
    pad: 30,
  })
  const since = s.endedAt < 0 ? -1 : now - s.endedAt
  // Empty cells breathe in the colour of the human to move: "your board".
  if (hint !== null) {
    const a = 0.08 + 0.05 * Math.sin(now * 3.2)
    s.cells.forEach((cell, i) => {
      if (cell !== null) return
      const c = i % 3
      const r = Math.floor(i / 3)
      g.alpha(a, () =>
        g.rrect(
          geo.x + c * geo.cell + 8,
          geo.y + r * geo.cell + 8,
          geo.cell - 16,
          geo.cell - 16,
          22,
          SIDE[hint].main,
        ),
      )
    })
  }
  const sweep = since < 0 ? 0 : prog(since, CLEAR_AT - SWEEP, CLEAR_AT)
  s.cells.forEach((cell, i) => {
    if (cell === null) return
    const c = i % 3
    const r = Math.floor(i / 3)
    const { x, y } = cellCenter(geo, c, r)
    const age = now - (s.placedAt[i] ?? 0)
    // Land with a squash once drawn in, then a slow idle breath.
    const land = wobble(age - 0.18, 0.18)
    const breath = 0.018 * Math.sin(now * 2.4 + i * 0.9)
    let sx = 1 + land + breath
    let sy = 1 - land + breath
    let angle = 0
    let a = 1
    // A refused tap on this mark: shake "no".
    if (s.bad === i) angle = wobble(now - s.badAt, 0.22, 40, 10)
    const k = s.line ? s.line.indexOf(i) : -1
    if (s.line && since >= 0) {
      if (k >= 0) {
        // Winning marks hop one after another once the line is drawn.
        const hop = wobble(since - 0.42 - k * 0.09, 0.32, 18, 5)
        sx += Math.abs(hop) * 0.3
        sy += Math.abs(hop) * 0.3
      } else a = 1 - 0.55 * prog(since, 0.2, 0.5)
    } else if (since >= 0) {
      // Draw: every mark shudders, then greys a little.
      angle += wobble(since - (i % 3) * 0.04, 0.12, 34, 6)
      a = 1 - 0.35 * prog(since, 0.3, 0.6)
    }
    const out = 1 - inBack(sweep)
    g.alpha(a * Math.min(1, out * 1.5), () =>
      drawMark(g, cell, x, y, geo.cell, age, sx * out, sy * out, angle),
    )
  })
  if (s.line && since >= 0) {
    const [a, , c] = s.line
    const A = cellCenter(geo, (a as number) % 3, Math.floor((a as number) / 3))
    const B = cellCenter(geo, (c as number) % 3, Math.floor((c as number) / 3))
    const p = outCubic(prog(since, 0.1, 0.45))
    const ext = 0.22
    const x0 = A.x - (B.x - A.x) * ext
    const y0 = A.y - (B.y - A.y) * ext
    const x1 = x0 + (B.x - A.x) * (1 + 2 * ext) * p
    const y1 = y0 + (B.y - A.y) * (1 + 2 * ext) * p
    const lw = 34 * (1 + wobble(since - 0.45, 0.25, 22, 7)) * (1 - sweep)
    if (lw > 1) {
      g.line(x0, y0 + 8, x1, y1 + 8, alpha('#000000', 0.35), lw)
      g.line(x0, y0, x1, y1, C.yellow, lw)
      // A glint running along the fresh line.
      const gt = prog(since, 0.45, 0.85)
      if (gt > 0 && gt < 1) {
        const gx = x0 + (x1 - x0) * gt
        const gy = y0 + (y1 - y0) * gt
        g.alpha(1 - gt, () => g.circle(gx, gy, lw * 0.7, C.white))
      }
    }
  }
}
