import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { cellCenter, drawBoard, type Geom } from '../../engines/board/index.ts'
import type { State } from './index.ts'

/** Red plays rings (circle = red everywhere), blue plays crosses. */
export function drawMark(g: Draw, side: Side, x: number, y: number, size: number, t: number): void {
  const p = outCubic(prog(t, 0, 0.28))
  const s = outBack(prog(t, 0, 0.32))
  const col = SIDE[side]
  const lw = size * 0.2
  g.at(
    x,
    y,
    0,
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
    s,
  )
}

export function renderBoard(g: Draw, s: State, geo: Geom, now: number): void {
  drawBoard(g, geo, C.ink3, {
    cellColor: () => shade(C.ink3, -0.35),
    pad: 30,
  })
  s.cells.forEach((cell, i) => {
    if (cell === null) return
    const { x, y } = cellCenter(geo, i % 3, Math.floor(i / 3))
    drawMark(g, cell, x, y, geo.cell, now - (s.placedAt[i] ?? 0))
  })
  if (s.line) {
    const [a, , c] = s.line
    const A = cellCenter(geo, (a as number) % 3, Math.floor((a as number) / 3))
    const B = cellCenter(geo, (c as number) % 3, Math.floor((c as number) / 3))
    const p = outCubic(prog(now - s.endedAt, 0.1, 0.45))
    const ext = 0.22
    const x0 = A.x - (B.x - A.x) * ext
    const y0 = A.y - (B.y - A.y) * ext
    const x1 = x0 + (B.x - A.x) * (1 + 2 * ext) * p
    const y1 = y0 + (B.y - A.y) * (1 + 2 * ext) * p
    g.line(x0, y0 + 8, x1, y1 + 8, alpha('#000000', 0.35), 34)
    g.line(x0, y0, x1, y1, C.yellow, 34)
  }
}
