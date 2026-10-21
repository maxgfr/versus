/**
 * Slot Cars, pure rules. One figure-8 track with two lanes, one lane per
 * player. A car speeds up while its throttle is held and coasts (slowing down
 * by drag) when it is let go. Taking a bend too fast throws the car off the
 * track: it flies for a moment, then respawns a little way back, at rest.
 * The first car to complete the laps wins.
 *
 * Nothing here draws or uses randomness: the track is fixed, and the state
 * holds only the cars.
 */

export interface Pt {
  x: number
  y: number
}

/** Table centre, and the figure-8's half-size (world units). */
const CX = 500
const CY = 900
const AX = 780
const AY = 650
/** Lane offset from the centre line (+ is left of travel, red is -). */
export const LANE = 34
/** Samples around the figure (the same t for both lanes). */
const N = 720

/** Throttle acceleration and drag (units / s², 1/s): top speed is ACCEL / DRAG. */
export const ACCEL = 420
export const DRAG = 0.75
export const TOP = ACCEL / DRAG
/** Lateral acceleration (units / s²) the car can take before it leaves the track. */
export const A_MAX = 1400
/** Seconds the car spends off the track before it is put back. */
export const RESPAWN = 1.5
/** Units behind the crash point the car is put back on the track. */
export const BACK = 160
/** Speed lost to the air while flying (1/s). */
const AIR = 1.8

export interface Lane {
  pts: Pt[]
  cum: number[]
  len: number
}

export interface Track {
  /** Index 0 is the red lane, 1 the blue lane. */
  lanes: [Lane, Lane]
  /** Signed curvature of the centre line per sample (1/units). Positive turns left. */
  kap: number[]
  /** Left normal per sample, for the lanes and for flying off the bend. */
  nrm: Pt[]
  /** Heading of the centre line per sample (rad). */
  hd: number[]
}

export interface Car {
  side: 0 | 1
  /** Position along the lane (units), not wrapped: laps are floor(s / len). */
  s: number
  /** Speed along the lane (units / s). */
  v: number
  /** 'run' on the track, 'fly' after a crash, 'wait' before the race starts. */
  st: 'run' | 'fly'
  /** Time the current state began (s). */
  t0: number
  /** Drawing position and heading (rad). */
  x: number
  y: number
  h: number
  /** Flying velocity (units / s). */
  fvx: number
  fvy: number
  /** Laps completed, and the time the goal was crossed (-1 until then). */
  laps: number
  finishT: number
}

export type Ev =
  | { k: 'crash'; side: 0 | 1; x: number; y: number }
  | { k: 'lap'; side: 0 | 1; x: number; y: number; lap: number }
  | { k: 'land'; side: 0 | 1; x: number; y: number }

/** Figure-8 centre line at parameter t. Lobes stacked along the table. */
function centre(t: number): {
  x: number
  y: number
  dx: number
  dy: number
  ddx: number
  ddy: number
} {
  return {
    x: CX + (AX * Math.sin(2 * t)) / 2,
    y: CY + AY * Math.sin(t),
    dx: AX * Math.cos(2 * t),
    dy: AY * Math.cos(t),
    ddx: -2 * AX * Math.sin(2 * t),
    ddy: -AY * Math.sin(t),
  }
}

let cached: Track | null = null

/** The track, built once (the same on every device). */
export function track(): Track {
  if (cached) return cached
  const cen: Pt[] = []
  const kap: number[] = []
  const nrm: Pt[] = []
  const hd: number[] = []
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2
    const c = centre(t)
    const sp = Math.hypot(c.dx, c.dy) || 1
    cen.push({ x: c.x, y: c.y })
    const tx = c.dx / sp
    const ty = c.dy / sp
    nrm.push({ x: -ty, y: tx })
    hd.push(Math.atan2(ty, tx))
    kap.push((c.dx * c.ddy - c.dy * c.ddx) / sp ** 3)
  }
  const lane = (off: number): Lane => {
    const pts = cen.map((p, i) => {
      const n = nrm[i] ?? { x: 0, y: 0 }
      return { x: p.x + n.x * off, y: p.y + n.y * off }
    })
    const cum: number[] = [0]
    for (let i = 1; i < N; i++) {
      const a = pts[i - 1] ?? { x: 0, y: 0 }
      const b = pts[i] ?? { x: 0, y: 0 }
      cum.push((cum[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y))
    }
    const a = pts[N - 1] ?? { x: 0, y: 0 }
    const b = pts[0] ?? { x: 0, y: 0 }
    const len = (cum[N - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y)
    return { pts, cum, len }
  }
  cached = {
    lanes: [lane(-LANE), lane(LANE)],
    kap,
    nrm,
    hd,
  }
  return cached
}

/** Index of the last sample at or before arc `s` on a lane (s wraps around the lap). */
export function indexAt(lane: Lane, s: number): number {
  const a = ((s % lane.len) + lane.len) % lane.len
  let lo = 0
  let hi = N - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((lane.cum[mid] ?? 0) <= a) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Where a car on `side` at arc `s` is drawn, and which way it points. */
export function pose(tr: Track, side: 0 | 1, s: number): { x: number; y: number; h: number } {
  const lane = tr.lanes[side]
  const i = indexAt(lane, s)
  const p = lane.pts[i] ?? { x: CX, y: CY }
  return { x: p.x, y: p.y, h: tr.hd[i] ?? 0 }
}

/** A car at the start, `back` units behind the line on its lane. */
export function newCar(side: 0 | 1, back = 0): Car {
  const tr = track()
  const at = pose(tr, side, -back)
  return {
    side,
    s: -back,
    v: 0,
    st: 'run',
    t0: 0,
    x: at.x,
    y: at.y,
    h: at.h,
    fvx: 0,
    fvy: 0,
    laps: 0,
    finishT: -1,
  }
}

/** Curvature of the centre line where a `side` car is at arc `s` (1/units; positive turns left). */
export function curvatureAt(tr: Track, side: 0 | 1, s: number): number {
  return tr.kap[indexAt(tr.lanes[side], s)] ?? 0
}

/** The fastest a `side` car can take the bend at arc `s` without leaving the track. */
export function limitAt(tr: Track, side: 0 | 1, s: number): number {
  const k = Math.abs(curvatureAt(tr, side, s))
  if (k < 1e-6) return TOP
  return Math.min(TOP, Math.sqrt(A_MAX / k))
}

/**
 * Advance the cars one step. `throttle[side]` is whether that car's throttle
 * is held. The race is on from `go` (s); before that cars sit still.
 */
export function stepCars(
  cars: Car[],
  throttle: readonly boolean[],
  dt: number,
  now: number,
  go: number,
  goal: number,
  ev: Ev[],
): void {
  const tr = track()
  for (const c of cars) {
    if (c.st === 'fly') {
      c.x += c.fvx * dt
      c.y += c.fvy * dt
      const k = Math.exp(-AIR * dt)
      c.fvx *= k
      c.fvy *= k
      c.h += dt * 9
      if (now - c.t0 >= RESPAWN) {
        // Back on the lane a little way behind the crash, at rest.
        c.s = Math.max(0, c.s - BACK)
        const at = pose(tr, c.side, c.s)
        c.x = at.x
        c.y = at.y
        c.h = at.h
        c.v = 0
        c.st = 'run'
        c.t0 = now
        ev.push({ k: 'land', side: c.side, x: at.x, y: at.y })
      }
      continue
    }
    if (now < go) continue
    if (c.finishT >= 0) {
      // Past the line: roll on round the lane and brake to a stop.
      c.v = Math.max(0, c.v - (DRAG * c.v + 160) * dt)
      c.s += c.v * dt
      const at = pose(tr, c.side, c.s)
      c.x = at.x
      c.y = at.y
      c.h = at.h
      continue
    }
    const lane = tr.lanes[c.side]
    const on = throttle[c.side] ?? false
    c.v = Math.max(0, c.v + ((on ? ACCEL : 0) - DRAG * c.v) * dt)
    c.s += c.v * dt
    const lat = c.v * c.v * curvatureAt(tr, c.side, c.s)
    const at = pose(tr, c.side, c.s)
    c.x = at.x
    c.y = at.y
    c.h = at.h
    if (Math.abs(lat) > A_MAX) {
      // Thrown off the bend: keep the forward speed, and go out the outside of the turn.
      const k = curvatureAt(tr, c.side, c.s)
      const n = tr.nrm[indexAt(lane, c.s)] ?? { x: 0, y: 0 }
      const out = k > 0 ? -1 : 1
      c.st = 'fly'
      c.t0 = now
      c.fvx = Math.cos(at.h) * c.v * 0.9 + n.x * out * c.v * 0.55
      c.fvy = Math.sin(at.h) * c.v * 0.9 + n.y * out * c.v * 0.55
      c.v = 0
      ev.push({ k: 'crash', side: c.side, x: at.x, y: at.y })
      continue
    }
    const laps = Math.max(0, Math.floor(c.s / lane.len))
    if (laps > c.laps) {
      c.laps = laps
      ev.push({ k: 'lap', side: c.side, x: at.x, y: at.y, lap: laps })
    }
    if (c.laps >= goal && c.finishT < 0) c.finishT = now
  }
}

/** The car that finished first, or null while the race goes on. */
export function winnerOf(cars: Car[]): 0 | 1 | null {
  const done = cars.filter((c) => c.finishT >= 0)
  if (!done.length) return null
  return done.reduce((a, b) => (b.finishT < a.finishT ? b : a)).side
}
