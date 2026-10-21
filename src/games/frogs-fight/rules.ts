import type { Side } from '../../core/game.ts'

/** Pure frog rules: lily pads on a grid, hops of up to two pads, pushes, sinking pads. No rendering, no randomness. */

export const COLS = 5
export const ROWS = 8
/**
 * Pad centres: columns PAD_DX apart from x = PAD_X0, rows PAD_DY apart from
 * y = PAD_Y0. The first column clears the pause button on the left edge.
 */
export const PAD_X0 = 180
export const PAD_Y0 = 235
export const PAD_DX = 170
export const PAD_DY = 190
export const PAD_R = 64
/** Seconds a hop takes in the air. */
export const HOP_T = 0.36
/** Landings on a pad before it sinks (once nobody is standing on it). */
export const SINK_AT = 3
/** A frog with no pad in reach for this long sinks. */
export const STRANDED_T = 1.2
/** Reach of a hop, in pads (Chebyshev distance). */
export const REACH = 2

export interface Frog {
  id: number
  side: Side
  /** Pad it is on (or landing on). */
  pad: number
  /** Pad it hopped from, for the arc. */
  from: number
  /** World time the current hop started (or -9). */
  hopT: number
  /** World time it fell into the pond, or -1. */
  fellT: number
  /** How it fell: pushed off, or stranded with no pad in reach. */
  stranded: boolean
  /** Seconds with nowhere to hop. */
  stuck: number
  /** Direction (in pads) a frog was knocked off in, or 0,0. */
  dx: number
  dy: number
}

export interface World {
  /** Landings per pad. */
  uses: number[]
  /** 1 = sunk (gone). */
  sunk: number[]
  /** World time each pad sank, or -1. */
  sunkT: number[]
  frogs: Frog[]
  /** Seconds since the round began. */
  t: number
}

export type Ev =
  | { k: 'hop'; x: number; y: number; side: Side }
  | { k: 'land'; x: number; y: number; side: Side; n: number }
  | { k: 'push'; x: number; y: number; side: Side }
  | { k: 'fall'; x: number; y: number; side: Side; stranded: boolean }
  | { k: 'sink'; x: number; y: number }

export const padIdx = (c: number, r: number): number => r * COLS + c
export const padCol = (i: number): number => i % COLS
export const padRow = (i: number): number => Math.floor(i / COLS)
export const padXY = (i: number): { x: number; y: number } => ({
  x: PAD_X0 + padCol(i) * PAD_DX,
  y: PAD_Y0 + padRow(i) * PAD_DY,
})

export function inPond(c: number, r: number): boolean {
  return c >= 0 && r >= 0 && c < COLS && r < ROWS
}

/** Spawns: red at the bottom middle, blue at the top middle (point mirror images). */
export function newWorld(): World {
  const frogs: Frog[] = ([0, 1] as Side[]).map((side) => {
    const pad = side === 0 ? padIdx(2, ROWS - 1) : padIdx(2, 0)
    return {
      id: side,
      side,
      pad,
      from: pad,
      hopT: -9,
      fellT: -1,
      stranded: false,
      stuck: 0,
      dx: 0,
      dy: 0,
    }
  })
  return {
    uses: Array.from({ length: COLS * ROWS }, () => 0),
    sunk: Array.from({ length: COLS * ROWS }, () => 0),
    sunkT: Array.from({ length: COLS * ROWS }, () => -1),
    frogs,
    t: 0,
  }
}

export function occupied(w: World, i: number): boolean {
  return w.frogs.some((f) => f.fellT < 0 && f.pad === i)
}

export function available(w: World, i: number): boolean {
  return i >= 0 && i < COLS * ROWS && w.sunk[i] !== 1
}

export function airborne(w: World, f: Frog): boolean {
  return f.hopT >= 0 && w.t - f.hopT < HOP_T
}

/** Pads this frog could hop to right now. */
export function hopsFor(w: World, f: Frog): number[] {
  const c0 = padCol(f.pad)
  const r0 = padRow(f.pad)
  const out: number[] = []
  for (let r = r0 - REACH; r <= r0 + REACH; r++)
    for (let c = c0 - REACH; c <= c0 + REACH; c++) {
      if (!inPond(c, r)) continue
      const i = padIdx(c, r)
      if (i === f.pad || !available(w, i)) continue
      out.push(i)
    }
  return out
}

/** Hop a frog to a pad. A rival standing there is pushed one pad onward, or into the pond. */
export function hop(w: World, f: Frog, target: number, ev: Ev[]): void {
  const from = padXY(f.pad)
  const to = padXY(target)
  f.from = f.pad
  f.pad = target
  f.hopT = w.t
  w.uses[target] = (w.uses[target] ?? 0) + 1
  ev.push({ k: 'hop', x: from.x, y: from.y, side: f.side })
  const rival = w.frogs.find((k) => k.side !== f.side && k.fellT < 0 && k.pad === target)
  if (!rival) {
    ev.push({ k: 'land', x: to.x, y: to.y, side: f.side, n: w.uses[target] ?? 0 })
    return
  }
  const dc = Math.sign(padCol(target) - padCol(f.from))
  const dr = Math.sign(padRow(target) - padRow(f.from))
  const nc = padCol(target) + dc
  const nr = padRow(target) + dr
  ev.push({ k: 'push', x: to.x, y: to.y, side: rival.side })
  if (inPond(nc, nr) && available(w, padIdx(nc, nr))) {
    const j = padIdx(nc, nr)
    rival.from = rival.pad
    rival.pad = j
    rival.hopT = w.t
    w.uses[j] = (w.uses[j] ?? 0) + 1
    return
  }
  // No pad behind it: the rival is knocked off the lily pads into the pond.
  rival.from = target
  rival.pad = -1
  rival.dx = dc
  rival.dy = dr
  rival.hopT = w.t
  rival.fellT = w.t
  rival.stranded = false
  ev.push({
    k: 'fall',
    x: to.x + dc * PAD_DX,
    y: to.y + dr * PAD_DY,
    side: rival.side,
    stranded: false,
  })
}

/**
 * Advance one step. `taps[i]` is the pad frog i hops to this step (or undefined).
 * Hops are ignored while a frog is still in the air.
 */
export function stepWorld(
  w: World,
  taps: readonly (number | undefined)[],
  dt: number,
  ev: Ev[],
): void {
  for (const f of w.frogs) {
    if (f.fellT >= 0) continue
    const t = taps[f.id]
    if (t !== undefined && !airborne(w, f) && hopsFor(w, f).includes(t)) {
      hop(w, f, t, ev)
    }
    if (!airborne(w, f) && hopsFor(w, f).length === 0) {
      f.stuck += dt
      if (f.stuck > STRANDED_T && f.fellT < 0) {
        f.fellT = w.t
        f.stranded = true
        const p = padXY(f.pad)
        ev.push({ k: 'fall', x: p.x, y: p.y, side: f.side, stranded: true })
      }
    } else f.stuck = 0
  }
  // Pads sink once they have been landed on enough and nobody is standing on them.
  for (let i = 0; i < COLS * ROWS; i++) {
    if (w.sunk[i] === 1) continue
    if ((w.uses[i] ?? 0) >= SINK_AT && !occupied(w, i)) {
      w.sunk[i] = 1
      w.sunkT[i] = w.t
      const p = padXY(i)
      ev.push({ k: 'sink', x: p.x, y: p.y })
    }
  }
  w.t += dt
}

/** The side that stays on the pond, 'draw' if both are gone together, null while both are on it. */
export function roundWinner(w: World): Side | 'draw' | null {
  const red = w.frogs.find((f) => f.side === 0)
  const blue = w.frogs.find((f) => f.side === 1)
  const redOut = red ? red.fellT >= 0 : false
  const blueOut = blue ? blue.fellT >= 0 : false
  if (redOut && blueOut) return 'draw'
  if (redOut) return 1
  if (blueOut) return 0
  return null
}
