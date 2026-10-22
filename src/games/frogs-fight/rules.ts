import type { Side } from '../../core/game.ts'

/**
 * Pure frog rules: lily pads on a grid, hops of up to two pads, shoves, sinking
 * pads. No rendering, no randomness.
 *
 * A hop is resolved when the frog lands, not when it takes off: a rival on the
 * landing pad can still hop away while the attacker is in the air (a dodge).
 * The leap is the force: a two-pad leap shoves the rival two pads, a short hop
 * one. Two frogs landing on the same pad in the same step clash and both
 * bounce back to where they took off, so neither side wins a tie.
 */

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
/** Seconds a one-pad hop takes in the air. */
export const HOP_T = 0.36
/** Seconds a two-pad leap takes: more force, but a longer window to dodge it. */
export const LEAP_T = 0.44
/** Seconds a shoved (or bounced) frog flies before it lands. */
export const SHOVE_T = 0.3
/** A tap made this close to landing is kept and played on touchdown. */
export const BUFFER_T = 0.16
/** Landings on a pad before it sinks (once nobody is standing on it). */
export const SINK_AT = 3
/** A frog with no pad in reach for this long sinks. */
export const STRANDED_T = 1.2
/** Reach of a hop, in pads (Chebyshev distance). */
export const REACH = 2

export interface Frog {
  id: number
  side: Side
  /** Pad it is on, or flying to (-1 once knocked off the pads). */
  pad: number
  /** Pad it took off from, for the arc. */
  from: number
  /** World time the current (or last) flight started, -9 before any. */
  hopT: number
  /** In the air: its own hop, a shove, or a clash bounce. */
  air: boolean
  /** The current / last flight was a shove or a bounce (not its own hop). */
  shoved: boolean
  /** Force of the current / last hop in pads (1 or 2); for a shove, how far it was sent. */
  power: number
  /** A tap buffered near the end of a flight (-1 = none). */
  queue: number
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
  | { k: 'hop'; x: number; y: number; side: Side; d: number }
  | { k: 'land'; x: number; y: number; side: Side; n: number; d: number; shoved: boolean }
  | {
      k: 'push'
      x: number
      y: number
      /** The side being shoved. */
      side: Side
      /** Pads it is sent. */
      d: number
      dx: number
      dy: number
      /** Sent off the pads into the pond. */
      off: boolean
    }
  | { k: 'clash'; x: number; y: number }
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

/** Hop distance between two pads, in pads (Chebyshev). */
export function padDist(a: number, b: number): number {
  return Math.max(Math.abs(padCol(a) - padCol(b)), Math.abs(padRow(a) - padRow(b)))
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
      air: false,
      shoved: false,
      power: 1,
      queue: -1,
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

/** A frog stands on or is flying to this pad (so it cannot sink). */
export function occupied(w: World, i: number): boolean {
  return w.frogs.some((f) => f.fellT < 0 && f.pad === i)
}

export function available(w: World, i: number): boolean {
  return i >= 0 && i < COLS * ROWS && w.sunk[i] !== 1
}

/** Seconds the frog's current flight lasts. */
export function flightT(f: Frog): number {
  return f.shoved ? SHOVE_T : f.power >= 2 ? LEAP_T : HOP_T
}

export function airborne(_w: World, f: Frog): boolean {
  return f.air
}

/** World time the frog's current flight lands. */
export function landsAt(f: Frog): number {
  return f.hopT + flightT(f)
}

/** Pads this frog could hop to from the pad it is on (or landing on). */
export function hopsFor(w: World, f: Frog): number[] {
  const out: number[] = []
  if (f.pad < 0) return out
  const c0 = padCol(f.pad)
  const r0 = padRow(f.pad)
  for (let r = r0 - REACH; r <= r0 + REACH; r++)
    for (let c = c0 - REACH; c <= c0 + REACH; c++) {
      if (!inPond(c, r)) continue
      const i = padIdx(c, r)
      if (i === f.pad || !available(w, i)) continue
      out.push(i)
    }
  return out
}

/**
 * Where a frog standing on `target` ends up when a rival lands on it coming
 * from `from`: sent `padDist(from, target)` pads onward in the hop direction.
 * -1 means off the pads or onto a sunk one: into the pond.
 */
export function shoveDest(w: World, from: number, target: number, sunkToo = -1): number {
  const d = padDist(from, target)
  const dc = Math.sign(padCol(target) - padCol(from))
  const dr = Math.sign(padRow(target) - padRow(from))
  const nc = padCol(target) + dc * d
  const nr = padRow(target) + dr * d
  if (!inPond(nc, nr)) return -1
  const j = padIdx(nc, nr)
  return available(w, j) && j !== sunkToo ? j : -1
}

/** The round is decided: someone is in the pond. */
export function decided(w: World): boolean {
  return w.frogs.some((f) => f.fellT >= 0)
}

function fly(w: World, f: Frog, to: number, shoved: boolean, power: number): void {
  f.from = f.pad
  f.pad = to
  f.hopT = w.t
  f.air = true
  f.shoved = shoved
  f.power = power
  f.queue = -1
}

/** Start a hop to a pad (the caller checked it is in `hopsFor`). Resolved on landing. */
export function hop(w: World, f: Frog, target: number, ev: Ev[]): void {
  const from = padXY(f.pad)
  const d = padDist(f.pad, target)
  fly(w, f, target, false, d)
  f.stuck = 0
  ev.push({ k: 'hop', x: from.x, y: from.y, side: f.side, d })
}

function knockOff(w: World, f: Frog, dc: number, dr: number, d: number, ev: Ev[]): void {
  const at = padXY(f.pad)
  f.from = f.pad
  f.pad = -1
  f.dx = dc
  f.dy = dr
  f.power = d
  f.hopT = w.t
  f.air = false
  f.queue = -1
  f.fellT = w.t
  f.stranded = false
  ev.push({
    k: 'fall',
    x: at.x + dc * d * PAD_DX,
    y: at.y + dr * d * PAD_DY,
    side: f.side,
    stranded: false,
  })
}

/** Touchdown: count the landing, and shove a rival standing there. */
function land(w: World, f: Frog, others: readonly Frog[], ev: Ev[]): void {
  f.air = false
  w.uses[f.pad] = (w.uses[f.pad] ?? 0) + 1
  const to = padXY(f.pad)
  ev.push({
    k: 'land',
    x: to.x,
    y: to.y,
    side: f.side,
    n: w.uses[f.pad] ?? 0,
    d: f.power,
    shoved: f.shoved,
  })
  if (f.shoved) return
  const rival = others.find((k) => k !== f && k.fellT < 0 && !k.air && k.pad === f.pad)
  if (!rival) return
  const d = f.power
  const dc = Math.sign(padCol(f.pad) - padCol(f.from))
  const dr = Math.sign(padRow(f.pad) - padRow(f.from))
  const j = shoveDest(w, f.from, f.pad)
  ev.push({ k: 'push', x: to.x, y: to.y, side: rival.side, d, dx: dc, dy: dr, off: j < 0 })
  if (j >= 0) fly(w, rival, j, true, d)
  else knockOff(w, rival, dc, dr, d, ev)
}

/**
 * Advance one step. `taps[i]` is the pad frog i wants to hop to this step (or
 * undefined). A tap in the air is kept if the frog lands within BUFFER_T, and
 * played on touchdown. Once someone is in the pond nobody can act any more.
 */
export function stepWorld(
  w: World,
  taps: readonly (number | undefined)[],
  dt: number,
  ev: Ev[],
): void {
  const over = decided(w)
  // 1. Landings. Two frogs touching down on one pad together clash and bounce back.
  const landing = w.frogs.filter((f) => f.fellT < 0 && f.air && w.t >= landsAt(f) - 1e-9)
  const clash = landing.length === 2 && landing[0]?.pad === landing[1]?.pad
  if (clash) {
    const p = padXY(landing[0]?.pad ?? 0)
    ev.push({ k: 'clash', x: p.x, y: p.y })
    for (const f of landing) {
      const back = f.from
      f.air = false
      if (available(w, back)) fly(w, f, back, true, 1)
      else
        knockOff(
          w,
          f,
          Math.sign(padCol(back) - padCol(f.pad)),
          Math.sign(padRow(back) - padRow(f.pad)),
          1,
          ev,
        )
    }
  } else for (const f of landing) land(w, f, w.frogs, ev)
  // 2. Hops (and taps buffered for touchdown).
  if (!over && !decided(w))
    for (const f of w.frogs) {
      if (f.fellT >= 0) continue
      const t = taps[f.id] ?? (f.air ? undefined : f.queue >= 0 ? f.queue : undefined)
      if (!f.air) f.queue = -1
      if (t === undefined) continue
      if (f.air) {
        if (landsAt(f) - w.t <= BUFFER_T) f.queue = t
        continue
      }
      if (hopsFor(w, f).includes(t)) hop(w, f, t, ev)
    }
  // 3. A frog with nowhere to hop sinks after a short while.
  if (!decided(w))
    for (const f of w.frogs) {
      if (f.fellT >= 0) continue
      if (!f.air && hopsFor(w, f).length === 0) {
        f.stuck += dt
        if (f.stuck > STRANDED_T) {
          f.fellT = w.t
          f.stranded = true
          f.queue = -1
          const p = padXY(f.pad)
          ev.push({ k: 'fall', x: p.x, y: p.y, side: f.side, stranded: true })
        }
      } else f.stuck = 0
    }
  // 4. Pads sink once they have been landed on enough and nobody is on (or flying to) them.
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
