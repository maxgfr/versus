import type { Side } from '../../core/game.ts'
import { banner } from '../../core/hud.ts'
import { lerp, outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, shade, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import type { Geom } from '../../engines/board/index.ts'
import { drawMark } from '../tic-tac-toe/render.ts'
import type { State } from './index.ts'
import { boardFull } from './rules.ts'

interface Box {
  x: number
  y: number
  size: number
}

/** Top-left corner and side of small board `b`, in world units. */
function boxOf(geo: Geom, b: number): Box {
  const size = geo.cell * 3
  return { x: geo.x + (b % 3) * size, y: geo.y + Math.floor(b / 3) * size, size }
}

/** Centre of small board `b`. */
export function boardCentre(geo: Geom, b: number): { x: number; y: number } {
  const o = boxOf(geo, b)
  return { x: o.x + o.size / 2, y: o.y + o.size / 2 }
}

/** Centre of cell `i` of small board `b`. */
export function cellCentre(geo: Geom, b: number, i: number): { x: number; y: number } {
  const o = boxOf(geo, b)
  return { x: o.x + ((i % 3) + 0.5) * geo.cell, y: o.y + (Math.floor(i / 3) + 0.5) * geo.cell }
}

/** Damped wobble after an impact at t = 0: positive = wider and flatter. */
const wobble = (t: number, amp: number, freq = 26, decay = 9): number =>
  t <= 0 ? 0 : amp * Math.exp(-t * decay) * Math.sin(t * freq)

/** Gap between a small board's panel and its neighbours. */
const MARGIN = 0.06

/**
 * A notice both players can read, clear of the board: in local 2P one copy sits
 * near each edge, upright for its player; on one screen it sits below the board.
 */
export function notice(g: Draw, text: string, a: number, color?: string): void {
  const o = { size: 58, alpha: a, color }
  if (g.flipTop) banner(g, undefined, text, MID, { ...o, gap: 560 })
  else banner(g, 0, text, MID + 560, o)
}

/** The yellow glow around the board the next move must go to. */
function glow(g: Draw, x: number, y: number, size: number, pulse: number, a = 1): void {
  g.alpha(a, () => {
    g.alpha(0.22 + 0.18 * pulse, () =>
      g.rrect(x - 16, y - 16, size + 32, size + 32, 40, undefined, C.yellow, 22),
    )
    g.rrect(x - 6, y - 6, size + 12, size + 12, 30, undefined, C.yellow, 8)
    g.rrect(x, y, size, size, 24, alpha(C.yellow, 0.04 + 0.04 * pulse))
  })
}

/** The whole big board: a raised slab, nine panels with lit wells, marks, and the glow on the active board. */
export function renderUltimate(g: Draw, s: State, geo: Geom, now: number, live: boolean): void {
  const pad = 30
  const depth = 22
  g.shadow(geo.x + geo.w / 2, geo.y + geo.h + pad + depth + 8, geo.w * 0.55, 34, 0.42)
  g.tile(geo.x - pad, geo.y - pad, geo.w + pad * 2, geo.h + pad * 2 + depth, 46, C.ink4, depth)

  const pulse = 0.5 + 0.5 * Math.sin(now * 6)
  const margin = geo.cell * MARGIN
  const inset = geo.cell * 0.09
  const ended = s.endedAt >= 0
  const inLine = (b: number) => ended && s.line !== null && s.line.includes(b)

  for (let b = 0; b < 9; b++) {
    const o = boxOf(geo, b)
    const px = o.x + margin
    const py = o.y + margin
    const ps = o.size - margin * 2
    const won = s.won[b] ?? null
    const full = won === null && boardFull(s.cells, b)
    const open = won === null && !full
    // While a board is forced, the others step back so the target reads at a glance.
    const dim = live && s.active >= 0 && s.active !== b && open

    // Panel: a dark well for open boards, the owner's colour once won.
    if (won !== null) {
      const col = SIDE[won]
      g.rrect(
        px,
        py,
        ps,
        ps,
        24,
        g.lin(0, py, 0, py + ps, [
          [0, shade(col.main, -0.38)],
          [1, shade(col.main, -0.66)],
        ]),
      )
      g.rrect(px + 3, py + 3, ps - 6, ps - 6, 22, undefined, alpha(col.light, 0.35), 4)
    } else {
      g.rrect(px, py, ps, ps, 24, shade(C.ink3, full ? -0.7 : -0.55))
    }

    // Wells: lit on the board to play, sunk on the others.
    const lit = live && open && (s.active === b || s.active === -1)
    const well = lit ? shade(C.ink4, 0.06) : shade(C.ink3, dim ? -0.4 : -0.18)
    for (let i = 0; i < 9; i++) {
      const m = b * 9 + i
      const c = cellCentre(geo, b, i)
      const ws = geo.cell - inset * 2
      if (won === null) {
        g.rrect(c.x - ws / 2, c.y - ws / 2 + 4, ws, ws, 16, shade(C.ink3, -0.65))
        g.rrect(c.x - ws / 2, c.y - ws / 2, ws, ws, 16, well)
      }
      const v = s.cells[m]
      if (v === null || v === undefined) continue
      const age = now - (s.placedAt[m] ?? 0)
      const land = wobble(age - 0.18, 0.2)
      g.alpha(won !== null ? 0.28 : full ? 0.6 : 1, () =>
        drawMark(g, v, c.x, c.y, geo.cell * 0.9, age, 1 + land, 1 - land),
      )
    }

    if (won !== null) {
      const t = now - (s.wonAt[b] ?? 0)
      const cx = o.x + o.size / 2
      const cy = o.y + o.size / 2
      // White flash on the panel, then the big mark slams in.
      const f = 1 - prog(t, 0, 0.35)
      if (f > 0) g.alpha(0.6 * f, () => g.rrect(px, py, ps, ps, 24, C.white))
      const k = inLine(b) ? 1 + 0.06 * Math.sin(now * 9) : 1
      // The big mark slams down: squash on impact, then settles.
      const slam = wobble(t - 0.2, 0.26, 22, 7)
      g.at(
        cx,
        cy,
        0,
        () => drawMark(g, won, 0, 0, o.size * 0.78, t),
        k * (1 + slam),
        k * (1 - slam),
      )
    } else if (full) {
      // A drawn board: a grey bar across it, nobody's.
      const cx = o.x + o.size / 2
      const cy = o.y + o.size / 2
      let filledAt = 0
      for (let i = 0; i < 9; i++) filledAt = Math.max(filledAt, s.placedAt[b * 9 + i] ?? 0)
      const w = o.size * 0.6 * outCubic(prog(now - filledAt, 0.05, 0.35))
      g.rrect(cx - w / 2, cy - 10 + 5, w, 20, 10, alpha('#000000', 0.35))
      g.rrect(cx - w / 2, cy - 10, w, 20, 10, C.mute)
    }

    if (live && s.active === -1 && open) {
      g.alpha(0.35 + 0.35 * pulse, () =>
        g.rrect(px - 4, py - 4, ps + 8, ps + 8, 28, undefined, C.yellow, 6),
      )
    }
  }

  // Last move: a soft white ring around the cell.
  if (s.last >= 0 && !ended) {
    const b = Math.floor(s.last / 9)
    if (s.won[b] === null) {
      const c = cellCentre(geo, b, s.last % 9)
      const ws = geo.cell - inset * 2 + 10
      g.rrect(c.x - ws / 2, c.y - ws / 2, ws, ws, 20, undefined, alpha(C.white, 0.7), 5)
    }
  }

  // The glow travels from the cell just played to the board it sends the rival to.
  if (live && s.active >= 0) {
    const to = boxOf(geo, s.active)
    let x = to.x + margin
    let y = to.y + margin
    let size = to.size - margin * 2
    if (s.last >= 0) {
      const p = outBack(prog(now - (s.placedAt[s.last] ?? 0), 0.08, 0.42))
      const c = cellCentre(geo, Math.floor(s.last / 9), s.last % 9)
      const ws = geo.cell - inset * 2
      x = lerp(c.x - ws / 2, x, p)
      y = lerp(c.y - ws / 2, y, p)
      size = lerp(ws, size, p)
    }
    glow(g, x, y, size, pulse)
  }

  // The deciding line across the big board.
  if (s.line && ended) {
    const A = boardCentre(geo, s.line[0] ?? 0)
    const B = boardCentre(geo, s.line[2] ?? 0)
    const p = outCubic(prog(now - s.endedAt, 0.15, 0.55))
    const ext = 0.14
    const x0 = A.x - (B.x - A.x) * ext
    const y0 = A.y - (B.y - A.y) * ext
    const x1 = x0 + (B.x - A.x) * (1 + 2 * ext) * p
    const y1 = y0 + (B.y - A.y) * (1 + 2 * ext) * p
    g.line(x0, y0 + 10, x1, y1 + 10, alpha('#000000', 0.4), 44)
    g.line(x0, y0, x1, y1, C.yellow, 40)
    g.line(x0, y0 - 6, x1, y1 - 6, alpha(C.white, 0.45), 10)
  }
}

/** Small boards won so far: the side's mark and a count, upright for its player, bumping when it grows. */
export function boardTally(
  g: Draw,
  side: Side,
  n: number,
  x: number,
  y: number,
  since: number,
): void {
  const k = 1 + 0.35 * (1 - outCubic(prog(since, 0, 0.45)))
  g.forSide(side, x, y, () => {
    g.at(
      0,
      0,
      0,
      () => {
        drawMark(g, side, -40, 2, 78, 9)
        g.text(n, 34, 4, {
          size: 76,
          weight: 700,
          color: SIDE[side].main,
          drop: alpha('#000000', 0.35),
        })
      },
      k,
    )
  })
}
