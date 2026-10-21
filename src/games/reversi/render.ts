import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { W } from '../../core/stage.ts'
import { cellCenter, type Geom } from '../../engines/board/index.ts'
import type { State } from './index.ts'
import { N } from './rules.ts'

/** Seconds a disc takes to turn over. */
export const FLIP = 0.34
/** Seconds a new disc takes to drop in. */
const POP = 0.26

const FELT = C.felt
const RIM = shade(C.ink3, 0.06)

const rival = (s: Side): Side => (s === 0 ? 1 : 0)

/**
 * A two-faced disc seen from above: `top` up, the rival colour peeking out
 * underneath as its rim. Blue's face carries a square inset, red's is plain,
 * so the sides never depend on colour alone.
 */
export function piece(g: Draw, top: Side, r: number, edge = 1): void {
  const col = SIDE[top]
  g.circle(0, r * 0.16 * edge, r, shade(SIDE[rival(top)].main, -0.25))
  g.circle(0, r * 0.08 * edge, r, shade(col.main, -0.4))
  g.circle(
    0,
    0,
    r,
    g.rad(
      0,
      0,
      r * 0.05,
      r,
      [
        [0, shade(col.main, 0.3)],
        [0.65, col.main],
        [1, shade(col.main, -0.18)],
      ],
      -r * 0.35,
      -r * 0.4,
    ),
  )
  if (top === 1) {
    const k = r * 0.4
    g.rrect(-k, -k + r * 0.05, k * 2, k * 2, r * 0.14, shade(col.dark, -0.25))
    g.rrect(-k, -k, k * 2, k * 2, r * 0.14, col.dark)
    g.rrect(-k * 0.7, -k * 0.72, k * 1.4, k * 0.46, r * 0.08, alpha('#ffffff', 0.2))
  } else {
    g.ring(0, 0, r * 0.62, alpha('#000000', 0.1), r * 0.09)
  }
  g.alpha(0.5, () => g.ellipse(-r * 0.36, -r * 0.44, r * 0.26, r * 0.13, '#fff', -0.6))
}

/** Colour a disc shows at `now`: the old colour until its turn-over reaches the middle. */
export function shown(cell: Side, i: number, s: State, now: number): Side {
  const ft = s.flipAt[i] ?? -1
  if (ft < 0 || now >= ft + FLIP / 2) return cell
  return rival(cell)
}

/** Felt board with a dark rim, grid lines and the four star points. */
function board(g: Draw, geo: Geom): void {
  const pad = 30
  const depth = 24
  const x = geo.x - pad
  const y = geo.y - pad
  const w = geo.w + pad * 2
  const h = geo.h + pad * 2
  g.shadow(W / 2, y + h + depth + 14, w * 0.56, 40, 0.45)
  g.tile(x, y, w, h + depth, 40, RIM, depth)
  g.rrect(geo.x - 8, geo.y - 8, geo.w + 16, geo.h + 16, 18, shade(FELT, -0.55))
  g.rrect(
    geo.x - 4,
    geo.y - 2,
    geo.w + 8,
    geo.h + 6,
    16,
    g.rad(W / 2, geo.y + geo.h * 0.4, geo.w * 0.1, geo.w * 0.8, [
      [0, shade(FELT, 0.14)],
      [0.7, FELT],
      [1, shade(FELT, -0.3)],
    ]),
  )
  const line = shade(FELT, -0.42)
  for (let k = 1; k < N; k++) {
    g.line(
      geo.x + k * geo.cell,
      geo.y + 4,
      geo.x + k * geo.cell,
      geo.y + geo.h - 4,
      line,
      4,
      'butt',
    )
    g.line(
      geo.x + 4,
      geo.y + k * geo.cell,
      geo.x + geo.w - 4,
      geo.y + k * geo.cell,
      line,
      4,
      'butt',
    )
  }
  for (const [c, r] of [
    [2, 2],
    [2, 6],
    [6, 2],
    [6, 6],
  ] as const) {
    g.circle(geo.x + c * geo.cell, geo.y + r * geo.cell, 9, line)
  }
}

/** Where the side to move may play: its own mark, small, breathing. */
function hintDots(g: Draw, geo: Geom, hints: readonly number[], mover: Side, now: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(now * 5)
  const r = geo.cell * (0.12 + pulse * 0.02)
  for (const i of hints) {
    const { x, y } = cellCenter(geo, i % N, Math.floor(i / N))
    g.alpha(0.35, () => g.circle(x, y, r * 2, alpha(SIDE[mover].main, 0.5)))
    g.alpha(0.7 + pulse * 0.3, () => g.sideMark(mover, x, y, r, SIDE[mover].light))
  }
}

export function renderBoard(
  g: Draw,
  s: State,
  geo: Geom,
  now: number,
  hints: readonly number[],
  mover: Side,
): void {
  board(g, geo)
  hintDots(g, geo, hints, mover, now)
  const r = geo.cell * 0.4
  const winner = s.doneAt >= 0 ? s.winner : -1
  s.cells.forEach((cell, i) => {
    if (cell === null) return
    const { x, y } = cellCenter(geo, i % N, Math.floor(i / N))
    let sx = 1
    let sy = 1
    let lift = 0
    const pt = s.placedAt[i] ?? -1
    if (pt >= 0 && now - pt < POP) {
      // Dropped in: from a little above, landing with a squash.
      const u = prog(now - pt, 0, POP)
      lift = (1 - outCubic(Math.min(1, u * 1.6))) * geo.cell * 0.5
      const k = outBack(u)
      sx = 0.6 + 0.4 * k
      sy = sx
    }
    const ft = s.flipAt[i] ?? -1
    let edge = 1
    if (ft >= 0 && now >= ft && now < ft + FLIP) {
      // Lifted and turned over: squeezes through zero at the middle, where the colour swaps.
      const u = (now - ft) / FLIP
      sx *= Math.max(0.04, Math.abs(Math.cos(Math.PI * u)))
      lift = Math.sin(Math.PI * u) * geo.cell * 0.32
      edge = 1 + Math.sin(Math.PI * u) * 1.2
    }
    let dim = 1
    if (winner === 0 || winner === 1) {
      const t = now - s.doneAt
      const d = Math.hypot(x - W / 2, y - (geo.y + geo.h / 2)) / geo.cell
      if (cell === winner) {
        const k = prog(t, 0.1 + d * 0.06, 0.4 + d * 0.06)
        const pop = Math.sin(Math.PI * k) * 0.22
        sx *= 1 + pop
        sy *= 1 + pop
        lift += Math.sin(Math.PI * k) * geo.cell * 0.12
      } else dim = 1 - 0.4 * prog(t, 0.1, 0.6)
    }
    if (lift > 0) g.shadow(x, y + r * 0.5, r * 0.9 * sx, r * 0.36, 0.3)
    const col = shown(cell, i, s, now)
    g.alpha(dim, () => g.at(x, y - lift, 0, () => piece(g, col, r, edge), sx, sy))
  })
  if (s.last >= 0 && s.doneAt < 0) {
    const pt = s.placedAt[s.last] ?? -1
    if (pt >= 0 && now >= pt + POP) {
      const { x, y } = cellCenter(geo, s.last % N, Math.floor(s.last / N))
      g.ring(x, y, r * 1.14, C.yellow, 6)
    }
  }
}

/**
 * A side's live disc count at its edge: a big number beside one of its discs,
 * bumping each time the count changes.
 */
export function discCount(
  g: Draw,
  side: Side,
  n: number,
  bump: number,
  x: number,
  y: number,
  lead: boolean,
): void {
  g.forSide(side, x, y, () => {
    const k = 1 + 0.25 * Math.sin(Math.PI * Math.min(1, bump))
    g.at(-46, 0, 0, () => piece(g, side, 28), k)
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

/**
 * A side's share of the discs as a bar at its edge: its own colour fills from
 * its left, the halfway mark is a notch.
 */
export function shareBar(g: Draw, side: Side, mine: number, theirs: number, y: number): void {
  const w = 560
  const h = 22
  const total = Math.max(1, mine + theirs)
  const k = mine / total
  g.forSide(side, W / 2, y, () => {
    g.rrect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12, h, alpha('#000000', 0.35))
    g.rrect(-w / 2, -h / 2, w, h, h / 2, SIDE[rival(side)].dark)
    if (k > 0) g.rrect(-w / 2, -h / 2, Math.max(h, w * k), h, h / 2, SIDE[side].main)
    g.rrect(-w / 2 + 6, -h / 2 + 3, w - 12, h * 0.3, h * 0.15, alpha('#ffffff', 0.18))
    g.rrect(-3, -h / 2 - 8, 6, h + 16, 3, alpha(C.white, 0.7))
  })
}
