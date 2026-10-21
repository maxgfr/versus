import type { Side } from '../../core/game.ts'
import { banner } from '../../core/hud.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, shade, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { cellCenter, type Geom } from '../../engines/board/index.ts'
import type { State } from './index.ts'
import { BURST, CELLS, neighbours, SIZE } from './rules.ts'

/** Dot offsets (in cell units) for 1, 2, 3 and 4 dots. */
const SPOTS: Record<number, readonly (readonly [number, number])[]> = {
  1: [[0, 0]],
  2: [
    [-0.17, 0.12],
    [0.17, -0.12],
  ],
  3: [
    [0, -0.17],
    [-0.19, 0.14],
    [0.19, 0.14],
  ],
  4: [
    [-0.18, -0.18],
    [0.18, -0.18],
    [-0.18, 0.18],
    [0.18, 0.18],
  ],
}

/** Seconds a cell keeps its pop after it changes. */
const POP = 0.28
/** Seconds a converted cell takes to flip to its new colour. */
const FLIP = 0.26
/** Seconds the dots of a burst take to reach the neighbours. */
export const FLIGHT = 0.15

/** A dot: red plays round beads, blue plays rounded-square candies (never colour alone). */
function dot(g: Draw, side: Side, x: number, y: number, r: number): void {
  const col = mix(C.white, SIDE[side].light, 0.25)
  g.ellipse(x + 2, y + r * 0.85, r * 0.9, r * 0.32, alpha('#000000', 0.3))
  if (side === 0) {
    g.ball(x, y, r, col, 1)
    return
  }
  const k = r * 0.92
  g.rrect(x - k, y - k + 3, k * 2, k * 2, k * 0.55, shade(col, -0.35))
  g.rrect(
    x - k,
    y - k,
    k * 2,
    k * 2,
    k * 0.55,
    g.lin(0, y - k, 0, y + k, [
      [0, shade(col, 0.3)],
      [1, shade(col, -0.18)],
    ]),
  )
  g.alpha(0.7, () => g.ellipse(x - k * 0.35, y - k * 0.45, k * 0.38, k * 0.2, '#fff', -0.5))
}

/** Soft tiles on a raised slab, glossy dots on each tile, pops, flips and flying dots. */
export function renderBoard(g: Draw, s: State, geo: Geom, now: number, live: boolean): void {
  const pad = 30
  const depth = 22
  g.shadow(geo.x + geo.w / 2, geo.y + geo.h + pad + depth + 10, geo.w * 0.55, 36, 0.42)
  g.tile(geo.x - pad, geo.y - pad, geo.w + pad * 2, geo.h + pad * 2 + depth, 46, C.ink4, depth)

  const pulse = 0.5 + 0.5 * Math.sin(now * 6)
  const inset = geo.cell * 0.065
  const size = geo.cell - inset * 2
  const r = geo.cell * 0.15
  const legal = live ? new Set(legalFor(s)) : null
  const ended = s.endedAt >= 0
  const flightP = prog(now - s.burstAt, 0, FLIGHT)
  const inFlight = s.burstCells.length > 0 && flightP < 1

  for (let i = 0; i < CELLS; i++) {
    const c = cellCenter(geo, i % SIZE, Math.floor(i / SIZE))
    const owner = s.owner[i] ?? null
    let dots = s.dots[i] ?? 0
    // Dots still on their way here are not in the cell yet.
    if (inFlight) for (const b of s.burstCells) if (neighbours(b).includes(i)) dots--
    const age = now - (s.stampAt[i] ?? -10)
    let k = age >= 0 && age < POP ? 1 + 0.16 * Math.sin((age / POP) * Math.PI) : 1
    // The winner's tiles jump in a wave from the centre of the board.
    if (ended && owner !== null && owner === s.winner) {
      const d = Math.hypot((i % SIZE) - 2, Math.floor(i / SIZE) - 2)
      const t = now - s.endedAt - 0.15 - d * 0.08
      if (t > 0 && t < 0.4) k *= 1 + 0.14 * Math.sin((t / 0.4) * Math.PI)
    }
    // A converted tile flips over: the old colour first, then the new one.
    const fa = now - (s.flipAt[i] ?? -10)
    let face: Side | null = owner
    let sx = k
    if (fa > -FLIGHT && fa < FLIP) {
      const p = Math.max(0, fa) / FLIP
      sx = k * Math.max(0.08, Math.abs(Math.cos(Math.PI * p)))
      if (p < 0.5) face = (s.flipFrom[i] ?? -1) < 0 ? null : (s.flipFrom[i] as Side)
    }
    const col = face === null ? C.ink3 : SIDE[face].main

    if (legal?.has(i)) {
      g.alpha(0.25 + 0.4 * pulse, () =>
        g.rrect(
          c.x - size / 2 - 8,
          c.y - size / 2 - 8,
          size + 16,
          size + 16 + 6,
          42,
          undefined,
          alpha(C.white, 0.9),
          6,
        ),
      )
    }

    g.at(
      c.x,
      c.y,
      0,
      () => {
        if (face === null) {
          // An empty well, sunk into the slab.
          g.rrect(-size / 2, -size / 2 + 4, size, size, 34, shade(C.ink3, -0.5))
          g.rrect(-size / 2, -size / 2, size, size - 4, 34, shade(C.ink3, -0.12))
          g.rrect(-size / 2 + 6, -size / 2 + 4, size - 12, size * 0.3, 26, alpha(C.white, 0.04))
        } else {
          g.tile(-size / 2, -size / 2, size, size, 36, col, 16)
          g.rrect(
            -size / 2 + 10,
            -size / 2 + 10,
            size - 20,
            size - 36,
            28,
            undefined,
            alpha(SIDE[face].light, 0.35),
            3,
          )
        }
        if (face === null || dots <= 0 || owner === null) return
        const n = Math.min(dots, BURST)
        // Three dots: one more and it bursts, so the dots shiver.
        const hot = n >= BURST - 1 && !ended
        for (const [dx, dy] of SPOTS[n] ?? []) {
          const jx = hot ? Math.sin(now * 38 + dx * 40) * 2.5 : 0
          const jy = hot ? Math.cos(now * 33 + dy * 40) * 2.5 : 0
          dot(g, face, dx * geo.cell + jx, dy * geo.cell - 6 + jy, r * (hot ? 1.06 : 1))
        }
      },
      sx,
      k,
    )
  }

  // A burst throws one dot to each neighbour.
  if (inFlight) {
    const p = outCubic(flightP)
    for (let j = 0; j < s.burstCells.length; j++) {
      const b = s.burstCells[j] ?? 0
      const side = (s.burstSides[j] ?? 0) as Side
      const a = cellCenter(geo, b % SIZE, Math.floor(b / SIZE))
      for (const n of neighbours(b)) {
        const t = cellCenter(geo, n % SIZE, Math.floor(n / SIZE))
        const x = a.x + (t.x - a.x) * p
        const y = a.y + (t.y - a.y) * p - Math.sin(Math.PI * p) * 40
        dot(g, side, x, y, r * (1 + 0.3 * Math.sin(Math.PI * p)))
      }
      // The emptied tile flashes white as it pops.
      g.alpha(1 - flightP, () => {
        const sz = size * (1 + 0.25 * outBack(flightP))
        g.rrect(a.x - sz / 2, a.y - sz / 2, sz, sz, 40, undefined, C.white, 10)
      })
    }
  }
}

/** Cells the side to move may tap: every empty cell on a first move, else its own cells. */
function legalFor(s: State): number[] {
  const side = s.turn
  const out: number[] = []
  for (let i = 0; i < CELLS; i++) {
    const o = s.owner[i] ?? null
    if (!s.moved[side] ? o === null : o === side) out.push(i)
  }
  return out
}

/** A notice both players can read, clear of the board. */
export function notice(g: Draw, text: string, a: number): void {
  const o = { size: 58, alpha: a }
  if (g.flipTop) banner(g, undefined, text, MID, { ...o, gap: 580 })
  else banner(g, 0, text, MID + 580, o)
}

/** "Tap an empty cell" style hint for the first move, upright for that player on their half. */
export function hint(g: Draw, side: Side, text: string, a: number): void {
  const y = side === 0 ? MID + 520 : MID - 520
  g.alpha(a, () =>
    g.sideText(side, text, 500, y, { size: 40, weight: 600, color: alpha(C.white, 0.7) }),
  )
}
