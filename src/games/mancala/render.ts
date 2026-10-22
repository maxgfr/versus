import type { Side } from '../../core/game.ts'
import { banner } from '../../core/hud.ts'
import { inOutQuad, outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, shade, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import type { State } from './index.ts'
import { ownerOf, STORE } from './rules.ts'

/** Seconds between two seeds leaving the same hand (a short sowing). */
export const HOP = 0.19
/** A big handful is sown quicker, down to this. */
export const HOP_MIN = 0.1

/** Hop time for a hand holding `seeds`: the more seeds, the brisker the sowing. */
export function hopFor(seeds: number): number {
  return Math.max(HOP_MIN, HOP - Math.max(0, seeds - 4) * 0.008)
}
/** Seconds a captured or swept seed takes to fly home. */
export const FLY = 0.55

/**
 * The long wood board lies between the players. Red's six pits run left to right
 * along the bottom row, blue's along the top row (right to left as seen by red).
 * Each store sits at the end of its owner's row, on the owner's right and in the
 * owner's half: red's bottom right, blue's top left. That keeps the left edge at
 * mid-height (the pause button) free.
 */
export const BOARD = { x: 22, y: MID - 400, w: 956, h: 800 }
const ROW = 172
const PIT_RX = 43
const PIT_RY = 74
const STORE_RX = 62
const STORE_RY = 132
const STORE_DY = 232
const STORE_X: readonly [number, number] = [BOARD.x + BOARD.w - 86, BOARD.x + 86]
const PIT_X0 = 176
const PIT_X1 = W - 176
const PIT_W = (PIT_X1 - PIT_X0) / 6
const BEAD_R = 13

const CANDY = [C.red, C.blue, C.yellow, C.green, C.pink, C.purple, C.cyan, C.orange] as const

/** Mixed candy colours, stable per pit and seed so the beads never shuffle colour. */
export function candy(pit: number, k: number): string {
  return CANDY[(pit * 5 + k * 3) % CANDY.length] ?? C.white
}

/** Centre of a position: a pit (0-5 red, 7-12 blue) or a store (6 red, 13 blue). */
export function pitCentre(i: number): { x: number; y: number } {
  if (i === STORE[0]) return { x: STORE_X[0], y: MID + STORE_DY }
  if (i === STORE[1]) return { x: STORE_X[1], y: MID - STORE_DY }
  if (i <= 5) return { x: PIT_X0 + (i + 0.5) * PIT_W, y: MID + ROW }
  return { x: PIT_X1 - (i - 7 + 0.5) * PIT_W, y: MID - ROW }
}

const PITS = [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12] as const

/** The pit under a world point (generous ovals), or null when the touch is nowhere near a pit. */
export function pitAt(x: number, y: number): number | null {
  for (const i of PITS) {
    const c = pitCentre(i)
    const dx = (x - c.x) / (PIT_W / 2)
    const dy = (y - c.y) / (PIT_RY + 34)
    if (dx * dx + dy * dy <= 1) return i
  }
  return null
}

/** Bead slots packed inside an ellipse, nearest the centre first, with a little jitter. */
function slots(rx: number, ry: number): [number, number][] {
  const out: [number, number][] = []
  const step = BEAD_R * 1.8
  for (let row = -12; row <= 12; row++) {
    const y = row * step * 0.87
    for (let col = -12; col <= 12; col++) {
      const x = (col + (row % 2 === 0 ? 0 : 0.5)) * step
      if ((x / rx) ** 2 + (y / ry) ** 2 > 1) continue
      const j = (row * 7 + col * 13) % 5
      out.push([x + j * 0.8 - 1.6, y + ((j * 3) % 5) * 0.8 - 1.6])
    }
  }
  return out.sort(
    (a, b) => (a[0] / rx) ** 2 + (a[1] / ry) ** 2 - (b[0] / rx) ** 2 - (b[1] / ry) ** 2,
  )
}

const PIT_SLOTS = slots(PIT_RX - BEAD_R - 2, PIT_RY - BEAD_R - 4)
const STORE_SLOTS = slots(STORE_RX - BEAD_R - 2, STORE_RY - BEAD_R - 4)

/** Offset of the k-th bead in a bowl: a packed layer, then heaped layers on top. */
function spot(k: number, store: boolean): [number, number] {
  const list = store ? STORE_SLOTS : PIT_SLOTS
  const layer = Math.floor(k / list.length)
  const [x, y] = list[k % list.length] ?? [0, 0]
  // Heaped seeds sit a little higher and shifted, so a full bowl reads as a pile.
  return [x * (1 - layer * 0.2) + layer * 5, y * (1 - layer * 0.2) - layer * 8]
}

/** A carved bowl: lit lower lip, a hollow in shade at the top, a soft inner floor. */
function bowl(g: Draw, x: number, y: number, rx: number, ry: number, rim?: string): void {
  g.ellipse(x, y + 6, rx + 10, ry + 10, alpha(C.white, 0.18))
  g.ellipse(x, y - 3, rx + 9, ry + 9, shade(C.woodDark, -0.2))
  if (rim) g.path((c) => c.ellipse(x, y, rx + 6, ry + 6, 0, 0, Math.PI * 2), undefined, rim, 6)
  g.ellipse(
    x,
    y,
    rx,
    ry,
    g.rad(x, y + ry * 0.35, 0, Math.max(rx, ry) * 1.1, [
      [0, shade(C.woodDark, -0.05)],
      [0.7, shade(C.woodDark, -0.45)],
      [1, shade(C.woodDark, -0.65)],
    ]),
  )
  g.ellipse(x, y - ry * 0.55, rx * 0.75, ry * 0.3, alpha('#000000', 0.16))
}

function bead(g: Draw, x: number, y: number, color: string, lift = 0): void {
  g.circle(x + 2 + lift * 0.2, y + 4 + lift, BEAD_R * (1 - lift * 0.004), alpha('#000000', 0.3))
  g.ball(x, y, BEAD_R, color, 1)
}

/** The plank: a long wood slab with grain, an inlaid border and a centre groove. */
function plank(g: Draw): void {
  const { x, y, w, h } = BOARD
  g.shadow(W / 2, y + h + 34, w * 0.5, 36, 0.45)
  g.tile(x, y, w, h + 28, 70, C.wood, 28)
  g.rrect(
    x,
    y,
    w,
    h,
    70,
    g.lin(0, y, 0, y + h, [
      [0, shade(C.wood, 0.1)],
      [0.5, C.wood],
      [1, shade(C.wood, -0.08)],
    ]),
  )
  // Grain: long soft waves.
  for (let k = 0; k < 9; k++) {
    const gy = y + 40 + k * ((h - 80) / 8)
    g.path(
      (c) => {
        c.moveTo(x + 50, gy)
        c.bezierCurveTo(x + w * 0.3, gy - 14, x + w * 0.6, gy + 16, x + w - 50, gy - 4)
      },
      undefined,
      alpha(C.woodDark, k % 3 === 0 ? 0.22 : 0.12),
      k % 3 === 0 ? 5 : 3,
    )
  }
  g.rrect(x + 16, y + 16, w - 32, h - 32, 56, undefined, alpha(C.woodDark, 0.45), 5)
  g.rrect(x + 22, y + 22, w - 44, h - 44, 50, undefined, alpha(C.white, 0.12), 3)
  // Carved rosettes in the two free corners, mirrored like the stores.
  for (const [cx, cy] of [
    [STORE_X[1], MID + STORE_DY],
    [STORE_X[0], MID - STORE_DY],
  ] as const) {
    g.ring(cx, cy + 3, 40, alpha(C.white, 0.14), 5)
    g.ring(cx, cy, 40, alpha(C.woodDark, 0.5), 5)
    g.star(cx, cy + 3, 26, alpha(C.white, 0.12), 8, 0.45)
    g.star(cx, cy, 26, alpha(C.woodDark, 0.45), 8, 0.45)
  }
  // Centre groove between the two rows.
  g.rrect(PIT_X0 - 10, MID - 7, PIT_X1 - PIT_X0 + 20, 14, 7, alpha(C.woodDark, 0.5))
  g.rrect(PIT_X0 - 10, MID + 3, PIT_X1 - PIT_X0 + 20, 4, 2, alpha(C.white, 0.15))
}

/** Seeds flying home (captures, the final sweep) that have not landed yet, per position. */
function inbound(s: State, now: number, to: number): number {
  let n = 0
  for (const f of s.flights) if (f.to === to && now < f.at + FLY) n += f.n
  return n
}

/** Seeds still waiting to leave a position (flights not started yet). */
function outbound(s: State, now: number, from: number): number {
  let n = 0
  for (const f of s.flights) if (f.from === from && now < f.at) n += f.n
  return n
}

/** Seeds shown in `side`'s store: what has landed so far. */
export function storeCount(s: State, now: number, side: Side): number {
  const i = STORE[side]
  const flying = s.lastTo === i && now - s.dropAt < s.hop ? 1 : 0
  return Math.max(0, (s.pits[i] ?? 0) - flying - inbound(s, now, i))
}

/** The board: carved pits and stores, candy seeds, counts upright for each owner, seeds in hand and in flight. */
export function renderMancala(g: Draw, s: State, now: number, live: boolean): void {
  plank(g)

  const pulse = 0.5 + 0.5 * Math.sin(now * 6)
  const dropP = prog(now - s.dropAt, 0, s.hop)
  const flying = s.lastTo >= 0 && dropP < 1 ? s.lastTo : -1
  const countOf = (i: number) =>
    Math.max(
      0,
      (s.pits[i] ?? 0) - (i === flying ? 1 : 0) - inbound(s, now, i) + outbound(s, now, i),
    )

  // Stores: rimmed in the owner's colour, the count upright for the owner at its near end.
  for (const side of [0, 1] as const) {
    const i = STORE[side]
    const c = pitCentre(i)
    const win = s.endedAt >= 0 && s.winner === side
    if (win) {
      g.alpha(0.35 + 0.35 * pulse, () =>
        g.path(
          (p) => p.ellipse(c.x, c.y, STORE_RX + 22, STORE_RY + 22, 0, 0, Math.PI * 2),
          undefined,
          C.yellow,
          12,
        ),
      )
    }
    bowl(g, c.x, c.y, STORE_RX, STORE_RY, SIDE[side].main)
    const n = countOf(i)
    for (let k = 0; k < Math.min(n, 60); k++) {
      const [dx, dy] = spot(k, true)
      // Blue's pile grows from blue's side: mirror it.
      const m = side === 0 ? 1 : -1
      bead(g, c.x + dx * m, c.y + dy * m, candy(i, k))
    }
    // Score badge at the store's end nearest its owner.
    const by = c.y + (side === 0 ? 1 : -1) * (STORE_RY + 2)
    const bump = 1 + 0.3 * (1 - outCubic(prog(now - (s.storeAt[side] ?? -10), 0, 0.35)))
    g.forSide(side, c.x, by, () =>
      g.at(
        0,
        0,
        0,
        () => {
          g.rrect(-50, -34, 100, 68, 34, shade(SIDE[side].main, -0.25))
          g.rrect(-50, -34, 100, 68, 34, undefined, SIDE[side].light, 4)
          g.text(n, 0, 3, { size: 50, weight: 700, color: C.white, drop: alpha('#000000', 0.35) })
        },
        bump,
      ),
    )
  }

  for (const i of PITS) {
    const c = pitCentre(i)
    const owner = ownerOf(i)
    const n = countOf(i)
    const playable = live && owner === s.turn && (s.pits[i] ?? 0) > 0
    if (playable) {
      g.alpha(0.3 + 0.4 * pulse, () =>
        g.path(
          (p) => p.ellipse(c.x, c.y, PIT_RX + 18, PIT_RY + 18, 0, 0, Math.PI * 2),
          undefined,
          C.yellow,
          8,
        ),
      )
    }
    bowl(g, c.x, c.y, PIT_RX, PIT_RY)
    // The pit just emptied glows briefly in the mover's colour.
    if (i === s.from) {
      g.path(
        (p) => p.ellipse(c.x, c.y, PIT_RX + 6, PIT_RY + 6, 0, 0, Math.PI * 2),
        undefined,
        SIDE[s.mover].light,
        6,
      )
    }
    // A pit that just received a seed bounces its pile.
    const hit = i === s.lastTo && dropP >= 1 ? 1 - prog(now - s.dropAt - s.hop, 0, 0.3) : 0
    // The pile squashes as the seed lands, then springs back.
    const squash = 1 + 0.12 * hit * Math.cos((1 - hit) * Math.PI * 1.5)
    for (let k = 0; k < Math.min(n, 40); k++) {
      const [dx, dy] = spot(k, false)
      const m = owner === 0 ? 1 : -1
      bead(g, c.x + dx * m * squash, c.y + dy * m * squash, candy(i, k))
    }
    const dir = owner === 0 ? 1 : -1
    g.sideText(owner, n, c.x, c.y + dir * (PIT_RY + 44), {
      size: 44,
      weight: 700,
      color: n > 0 ? C.white : alpha(C.white, 0.35),
      drop: alpha('#000000', 0.45),
    })
  }

  // Seeds in hand: they hover over the pit that was just sown and move along with each hop.
  if (s.queue.length > 0 && s.from >= 0) {
    const a = pitCentre(s.lastTo >= 0 ? s.lastFrom : s.from)
    const b = pitCentre(s.lastTo >= 0 ? s.lastTo : s.from)
    const p = s.lastTo >= 0 ? inOutQuad(dropP) : 1
    const lift = outBack(prog(now - s.liftAt, 0, 0.18))
    const hx = a.x + (b.x - a.x) * p
    const hy = a.y + (b.y - a.y) * p - 34 * lift
    const shown = Math.min(s.queue.length, 12)
    g.shadow(hx + 6, hy + 46, 40, 14, 0.18 * lift)
    for (let k = shown - 1; k >= 0; k--) {
      const [dx, dy] = spot(k, false)
      g.ball(hx + dx * 0.8, hy + dy * 0.55, BEAD_R, candy(s.from, k + 7), 1)
    }
    g.forSide(s.mover, hx + 64, hy - 30, () => {
      g.circle(0, 0, 30, C.yellow)
      g.text(s.queue.length, 0, 2, { size: 36, weight: 700, color: C.ink })
    })
  }

  // The seed in flight: it drops from the hand into its next bowl.
  if (flying >= 0) {
    const a = pitCentre(s.lastFrom)
    const b = pitCentre(flying)
    const [dx, dy] = spot(Math.max(0, countOf(flying)), flying === STORE[0] || flying === STORE[1])
    const m = ownerOf(flying) === 0 ? 1 : -1
    const p = inOutQuad(dropP)
    const x = a.x + (b.x + dx * m - a.x) * p
    const y = a.y + (b.y + dy * m - a.y) * p - Math.sin(Math.PI * p) * 70 - 34 * (1 - p)
    bead(g, x, y, candy(flying, Math.max(0, countOf(flying))), 30 * (1 - p))
  }

  // Captures and the final sweep: seeds stream home.
  for (const f of s.flights) {
    const p = prog(now - f.at, 0, FLY)
    if (p <= 0 || p >= 1) continue
    const a = pitCentre(f.from)
    const b = pitCentre(f.to)
    for (let k = 0; k < Math.min(f.n, 12); k++) {
      const q = outCubic(prog(p, k * 0.03, 0.7 + k * 0.03))
      const x = a.x + (b.x - a.x) * q + Math.sin(k * 2.4) * 10
      const y = a.y + (b.y - a.y) * q - Math.sin(Math.PI * q) * 120 + Math.cos(k * 2.4) * 10
      bead(g, x, y, candy(f.from, k + 3), 24 * Math.sin(Math.PI * q))
    }
  }
}

/** A notice both players can read, clear of the board. */
export function notice(g: Draw, text: string, a: number, side?: Side): void {
  const o = {
    size: 56,
    alpha: a,
    color: side === undefined ? C.white : mix(SIDE[side].light, C.white, 0.4),
  }
  if (g.flipTop) banner(g, undefined, text, MID, { ...o, gap: 620 })
  else banner(g, 0, text, MID + 620, o)
}
