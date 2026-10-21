import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import { frame } from '../../core/frame.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { H, W } from '../../core/stage.ts'
import { tableBackdrop } from '../../engines/board/index.ts'
import { CELLS, colOf, FLEET, MISS, N, rowOf, type Sea } from './rules.ts'
import type { State } from './index.ts'

/** Layout in world units: each player's sea sits in their own half, mirrored about the midline. */
export const CELL = 80
export const GRID = CELL * N
export const GX = (W - GRID) / 2
const PAD = 26
const DEPTH = 22
export const SEA_TOP: [number, number] = [960, H - 960 - GRID]

const BASIN = '#0a2547'
const WAVE_TOP = '#2c74b8'
const WAVE_BOT = '#1a4d87'
const HULL = '#9aa8c2'
const HULL_SUNK = '#3d4659'
const PEG = '#eef4ff'

export const seaTop = (owner: Side): number => SEA_TOP[owner]

export function cellPos(owner: Side, cell: number): { x: number; y: number } {
  return {
    x: GX + (colOf(cell) + 0.5) * CELL,
    y: seaTop(owner) + (rowOf(cell) + 0.5) * CELL,
  }
}

/** The cell of `owner`'s sea under world point (x, y), or null. */
export function cellAtWorld(owner: Side, x: number, y: number): number | null {
  const c = Math.floor((x - GX) / CELL)
  const r = Math.floor((y - seaTop(owner)) / CELL)
  if (c < 0 || r < 0 || c >= N || r >= N) return null
  return r * N + c
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Red-frame rect → world rect for `side` (blue's mirrors red's through the stage centre). */
function sideRect(side: Side, cx: number, cy: number, w: number, h: number): Rect {
  const p = frame(side, cx, cy)
  return { x: p.x - w / 2, y: p.y - h / 2, w, h }
}

/** Each player's buttons sit at their own left (Peek) and right (Shuffle). */
export function peekRect(side: Side): Rect {
  return sideRect(side, 175, 1730, 230, 88)
}

export function shuffleRect(side: Side): Rect {
  return sideRect(side, 825, 1730, 250, 88)
}

export function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

/** The sea's slab, generously: touches here count as aimed at that sea. */
export function seaRect(owner: Side): Rect {
  return { x: GX - PAD, y: seaTop(owner) - PAD, w: GRID + PAD * 2, h: GRID + PAD * 2 }
}

export function backdrop(g: Draw): void {
  tableBackdrop(g)
}

// ---------- the sea ----------

/** A sea slab in its owner's colour: a lipped frame around a basin of rippling water cells. */
export function drawSlab(g: Draw, owner: Side, now: number, target: boolean): void {
  const top = seaTop(owner)
  const team = SIDE[owner]
  g.shadow(W / 2, top + GRID + PAD + DEPTH + 12, GRID * 0.56, 34, 0.45)
  if (target) {
    const p = 0.5 + 0.5 * Math.sin(now * 6)
    g.alpha(0.18 + 0.2 * p, () =>
      g.rrect(
        GX - PAD - 22,
        top - PAD - 22,
        GRID + PAD * 2 + 44,
        GRID + PAD * 2 + 44 + DEPTH,
        62,
        C.yellow,
      ),
    )
  }
  g.tile(
    GX - PAD,
    top - PAD,
    GRID + PAD * 2,
    GRID + PAD * 2 + DEPTH,
    44,
    shade(team.main, -0.3),
    DEPTH,
  )
  g.rrect(GX - 9, top - 9, GRID + 18, GRID + 18, 30, BASIN)
  const water = g.lin(0, top, 0, top + GRID, [
    [0, WAVE_TOP],
    [1, WAVE_BOT],
  ])
  for (let i = 0; i < CELLS; i++) {
    const x = GX + colOf(i) * CELL
    const y = top + rowOf(i) * CELL
    g.rrect(x + 4, y + 4, CELL - 8, CELL - 8, 17, water)
    // A little ripple drifting across each cell: the water is alive.
    const ph = now * 1.6 + colOf(i) * 0.9 + rowOf(i) * 0.55
    const k = 0.5 + 0.5 * Math.sin(ph)
    const wx = x + CELL / 2 + Math.sin(ph * 0.5) * 7
    const wy = y + CELL / 2 + 6
    g.path(
      (c) => {
        c.moveTo(wx - 15, wy)
        c.quadraticCurveTo(wx - 7.5, wy - 8, wx, wy)
        c.quadraticCurveTo(wx + 7.5, wy + 8, wx + 15, wy)
      },
      undefined,
      alpha('#bfe4ff', 0.08 + 0.14 * k),
      4,
    )
  }
  if (target) {
    const p = 0.5 + 0.5 * Math.sin(now * 6)
    g.rrect(
      GX - PAD - 10,
      top - PAD - 10,
      GRID + PAD * 2 + 20,
      GRID + PAD * 2 + 20,
      52,
      undefined,
      alpha(C.yellow, 0.55 + p * 0.45),
      9,
    )
  }
}

/** Outline of a hull lying along +x (bow at +x), centred on the origin. */
function hullPts(L: number, w: number): number[] {
  const b = w * 0.8
  const r = 12
  return [
    -L / 2 + r,
    -w / 2,
    L / 2 - b,
    -w / 2,
    L / 2,
    0,
    L / 2 - b,
    w / 2,
    -L / 2 + r,
    w / 2,
    -L / 2,
    w / 2 - r,
    -L / 2,
    -w / 2 + r,
  ]
}

/**
 * A chunky toy warship spanning `len` cells centred on (cx, cy): grey hull,
 * pointed bow, a deck, turrets and a bridge in its owner's colour. `angle` turns it.
 */
export function drawHull(
  g: Draw,
  cx: number,
  cy: number,
  len: number,
  angle: number,
  team: string,
  o: { cell?: number; sunk?: boolean; scale?: number; wide?: number } = {},
): void {
  const cell = o.cell ?? CELL
  const L = len * cell - cell * 0.2
  const w = cell * 0.62 * (o.wide ?? 1)
  const body = o.sunk ? HULL_SUNK : HULL
  const pts = hullPts(L, w)
  const s = o.scale ?? 1
  // The lip sits below as the viewer looks (the online guest sees the table turned).
  const lip = (g.stage.rot ? -1 : 1) * cell * 0.1 * s
  g.at(cx, cy + lip, angle, () => g.poly(pts, shade(body, -0.5)), s)
  g.at(
    cx,
    cy,
    angle,
    () => {
      g.poly(pts, body, shade(body, -0.45), cell * 0.05)
      // Deck
      g.rrect(-L / 2 + cell * 0.14, -w * 0.26, L - w * 0.95, w * 0.52, w * 0.2, shade(body, 0.18))
      // The bridge, painted in its owner's colour, sits at the stern; turrets line the rest.
      const x0 = -L / 2 + cell * 0.45
      const flag = o.sunk ? shade(team, -0.55) : team
      g.rrect(x0 - cell * 0.2, -w * 0.34, cell * 0.4, w * 0.68, cell * 0.1, shade(flag, -0.35))
      g.rrect(x0 - cell * 0.2, -w * 0.38, cell * 0.4, w * 0.62, cell * 0.1, flag)
      g.rrect(x0 + cell * 0.04, -w * 0.22, cell * 0.08, w * 0.4, cell * 0.04, alpha('#0b1830', 0.7))
      for (let k = 1; k < len; k++) {
        const tx = x0 + k * cell - cell * 0.12
        if (tx > L / 2 - w * 0.6) break
        g.line(tx, 0, tx + cell * 0.36, 0, shade(body, -0.4), cell * 0.07)
        g.circle(tx, 0, cell * 0.15, shade(body, 0.3), shade(body, -0.35), cell * 0.03)
      }
      // Gloss along the top edge.
      if (!o.sunk)
        g.line(
          -L / 2 + cell * 0.2,
          -w * 0.38,
          L / 2 - w * 1.1,
          -w * 0.38,
          alpha('#ffffff', 0.45),
          cell * 0.05,
        )
    },
    s,
  )
}

/** A ship drawn over its cells. Ships are straight; a lone or horizontal ship points right, a vertical one up. */
export function drawShip(
  g: Draw,
  cells: readonly number[],
  owner: Side,
  o: { sunk?: boolean; scale?: number; alpha?: number; bob?: number } = {},
): void {
  if (cells.length === 0) return
  const top = seaTop(owner)
  const rows = cells.map(rowOf)
  const cols = cells.map(colOf)
  const r0 = Math.min(...rows)
  const r1 = Math.max(...rows)
  const c0 = Math.min(...cols)
  const c1 = Math.max(...cols)
  const vertical = r1 > r0
  const cx = GX + ((c0 + c1 + 1) / 2) * CELL
  const cy = top + ((r0 + r1 + 1) / 2) * CELL + (o.bob ?? 0)
  const tilt = o.sunk ? 0.07 : 0
  g.alpha(o.alpha ?? 1, () =>
    drawHull(g, cx, cy, cells.length, (vertical ? -Math.PI / 2 : 0) + tilt, SIDE[owner].main, {
      sunk: o.sunk,
      scale: o.scale,
    }),
  )
  if (o.sunk) {
    // Half under water.
    const pad = 10
    g.rrect(
      GX + c0 * CELL + pad,
      top + r0 * CELL + pad,
      (c1 - c0 + 1) * CELL - pad * 2,
      (r1 - r0 + 1) * CELL - pad * 2,
      24,
      alpha(WAVE_BOT, 0.38),
    )
  }
}

/**
 * Each sea: its ships when they may be seen (sunk, peeked at, or always for
 * the local player outside local 2P), plus every shot that landed.
 */
export function drawSea(
  g: Draw,
  owner: Side,
  s: State,
  now: number,
  o: { target: boolean; show: boolean; reveal: boolean },
): void {
  drawSlab(g, owner, now, o.target)
  const sea: Sea = s.seas[owner]
  const shuffled = s.shuffledAt[owner] ?? -10
  sea.ships.forEach((cells, i) => {
    const sunkAt = s.revealAt[owner]?.[i] ?? -1
    const bob = Math.sin(now * 2 + i * 1.7) * 2.5
    if (sunkAt >= 0) {
      const k = outBack(prog(now, sunkAt, sunkAt + 0.45))
      drawShip(g, cells, owner, { sunk: true, scale: 1.25 - 0.25 * k, alpha: Math.min(1, k * 1.5) })
    } else if (o.show) {
      // A re-rolled fleet pops in, ship by ship.
      const k = outBack(prog(now, shuffled + i * 0.06, shuffled + i * 0.06 + 0.35))
      drawShip(g, cells, owner, { scale: 0.4 + 0.6 * k, alpha: Math.min(1, k * 2), bob })
    } else if (o.reveal) {
      // The game is over: the winner's surviving fleet surfaces.
      const k = outBack(prog(now, s.endAt + 0.5 + i * 0.12, s.endAt + 0.9 + i * 0.12))
      if (k > 0) drawShip(g, cells, owner, { scale: 0.5 + 0.5 * k, alpha: Math.min(1, k * 2), bob })
    }
  })
  let last = -1
  let lastAt = -1
  for (let c = 0; c < CELLS; c++) {
    const v = sea.shots[c]
    if (v === undefined || v === 0) continue
    const { x, y } = cellPos(owner, c)
    const at = s.landedAt[owner]?.[c] ?? -10
    if (at > lastAt) {
      lastAt = at
      last = c
    }
    if (v === MISS) drawMiss(g, x, y, now - at)
    else drawHit(g, x, y, now - at, c)
  }
  // The latest shot on this sea keeps a fading ring, so a glance tells what just happened.
  if (last >= 0 && now - lastAt < 2.2) {
    const { x, y } = cellPos(owner, last)
    const a = 1 - prog(now - lastAt, 1.2, 2.2)
    g.rrect(
      x - CELL / 2 + 2,
      y - CELL / 2 + 2,
      CELL - 4,
      CELL - 4,
      20,
      undefined,
      alpha(C.yellow, 0.8 * a),
      6,
    )
  }
}

function drawMiss(g: Draw, x: number, y: number, age: number): void {
  const ring = prog(age, 0, 0.8)
  if (ring < 1) {
    const e = outCubic(ring)
    g.ring(x, y, CELL * (0.15 + 0.5 * e), alpha('#e8f6ff', 0.9 * (1 - ring)), 8 * (1 - ring) + 2)
    g.ring(x, y, CELL * (0.08 + 0.3 * e), alpha('#e8f6ff', 0.6 * (1 - ring)), 5)
  }
  // A white peg marks the miss for the rest of the game.
  const k = outBack(prog(age, 0.12, 0.42))
  if (k <= 0) return
  g.ring(x, y, CELL * 0.27, alpha('#bfe4ff', 0.22), 4)
  g.circle(x + 3, y + 6, 13 * k, alpha('#000000', 0.3))
  g.ball(x, y, 13 * k, PEG, 0.9)
}

function drawHit(g: Draw, x: number, y: number, age: number, seed: number): void {
  const pop = outBack(prog(age, 0, 0.35))
  g.circle(x, y + 4, CELL * 0.34 * pop, alpha('#1a0a06', 0.55))
  g.circle(x, y + 4, CELL * 0.2 * pop, alpha('#ff5a2a', 0.35))
  // Smoke curls up from every burning hit.
  for (let k = 0; k < 2; k++) {
    const ph = (age * 0.7 + k * 0.5 + seed * 0.13) % 1
    g.circle(
      x + Math.sin(ph * 6 + seed) * 8 - 6 + k * 12,
      y - 22 - ph * 46,
      7 + ph * 15,
      alpha('#4a4f5c', 0.4 * (1 - ph) * pop),
    )
  }
  const flicker = 1 + 0.08 * Math.sin((age + seed) * 21)
  g.emoji('🔥', x, y - 8, CELL * 0.86 * pop, 0, flicker, flicker + 0.05)
}

/** The shell in flight: it arcs over the table (bigger at the top of its climb) toward a yellow reticle. */
export function drawShell(
  g: Draw,
  s: State,
  now: number,
  from: (o: Side) => { x: number; y: number },
): void {
  const sh = s.shell
  if (!sh) return
  const A = from(sh.by)
  const B = cellPos(sh.owner, sh.cell)
  const t = prog(now, sh.t0, sh.landAt)
  reticle(g, B.x, B.y, 1.4 - 0.4 * outCubic(t), now * 3, 1)
  const side = B.x >= A.x ? 1 : -1
  const at = (u: number) => {
    const lift = Math.sin(Math.PI * u)
    return {
      x: A.x + (B.x - A.x) * u + side * lift * 110,
      y: A.y + (B.y - A.y) * u,
      lift,
    }
  }
  for (let k = 7; k >= 1; k--) {
    const p = at(Math.max(0, t - k * 0.03))
    g.circle(
      p.x,
      p.y,
      8 + (7 - k) * 2.2,
      alpha(k < 3 ? C.yellow : '#ffffff', 0.08 + (7 - k) * 0.05),
    )
  }
  const p = at(t)
  const ground = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t }
  g.shadow(ground.x + 8, ground.y + 14, 20 - 6 * p.lift, 10 - 3 * p.lift, 0.3)
  g.ball(p.x, p.y, 20 + 18 * p.lift, shade(SIDE[sh.by].main, 0.15), 1)
}

/** The yellow aiming reticle: the one active thing on the table while a shot is coming. */
export function reticle(
  g: Draw,
  x: number,
  y: number,
  scale: number,
  spin: number,
  a: number,
): void {
  g.alpha(a, () =>
    g.at(
      x,
      y,
      spin * 0.3,
      () => {
        g.ring(0, 0, CELL * 0.42, alpha('#000000', 0.35), 12)
        g.ring(0, 0, CELL * 0.42, C.yellow, 7)
        for (let k = 0; k < 4; k++) {
          const a0 = (k * Math.PI) / 2
          g.line(
            Math.cos(a0) * CELL * 0.26,
            Math.sin(a0) * CELL * 0.26,
            Math.cos(a0) * CELL * 0.6,
            Math.sin(a0) * CELL * 0.6,
            C.yellow,
            7,
          )
        }
      },
      scale,
    ),
  )
}

/** The ships still afloat in a sea, as little hulls in its owner's right margin; sunk ones burn. */
export function drawFleetTracker(g: Draw, owner: Side, s: State, now: number): void {
  const unit = 34
  const gap = 16
  const total = FLEET.reduce((a, b) => a + b * unit, 0) + gap * (FLEET.length - 1)
  let y = 1290 - total / 2
  FLEET.forEach((len, i) => {
    const h = len * unit
    const sunkAt = s.revealAt[owner]?.[i] ?? -1
    const p = frame(owner, 922, y + h / 2)
    const sunk = sunkAt >= 0
    const k = sunk ? outBack(prog(now, sunkAt + 0.3, sunkAt + 0.7)) : 0
    // Hulls point "up" toward the rival: the owner's own forward direction.
    const angle = owner === 0 ? -Math.PI / 2 : Math.PI / 2
    g.alpha(sunk ? 0.75 : 1, () =>
      drawHull(g, p.x, p.y, len, angle, SIDE[owner].main, {
        cell: unit,
        wide: 1.35,
        sunk,
        scale: 1 + 0.25 * k * (1 - k) * 4,
      }),
    )
    if (sunk && k > 0) g.emoji('🔥', p.x, p.y, 30 * k)
    y += h + gap
  })
}

// ---------- buttons ----------

/** A chunky pill button in a player's half, upright for them, with an emoji icon. */
export function button(
  g: Draw,
  side: Side,
  r: Rect,
  label: string,
  icon: string,
  o: { on?: boolean; pressed?: boolean; progress?: number } = {},
): void {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  g.forSide(side, cx, cy, () => {
    const team = SIDE[side]
    const fill = o.on ? team.main : shade(team.main, -0.5)
    const depth = 12
    const h = r.h - depth
    g.tile(-r.w / 2, -h / 2 - depth / 2, r.w, r.h, h / 2, fill, depth, o.pressed ? 1 : 0)
    const dy = o.pressed ? depth / 2 : -depth / 2
    if (o.progress !== undefined) {
      // Time left to use it, as a bar draining along the bottom of the face.
      const w = (r.w - h) * Math.max(0, o.progress)
      g.rrect(-r.w / 2 + h / 2, dy + h / 2 - 14, w, 8, 4, alpha(C.yellow, 0.9))
    }
    g.emoji(icon, -r.w / 2 + 46, dy, 40)
    g.text(label, 22, dy + 2, {
      size: 38,
      weight: 700,
      color: C.white,
      drop: alpha('#000000', 0.3),
    })
  })
}
