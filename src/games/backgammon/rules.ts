/**
 * Backgammon rules: 24 points, 15 checkers each, no doubling cube.
 *
 * The board is stored in absolute numbering, as red (side 0, at the bottom)
 * reads it: point 1 is bottom-right, point 24 top-right, and red's home is
 * points 1–6. Each side also has its own numbering: `q` runs 1–24 from that
 * side's home-board end, so red's q is the absolute point and blue's q is the
 * mirror image across the middle of the table (blue's home is top-right, and
 * the two sides travel in opposite directions, as on a real board). Counts are
 * signed: red positive, blue negative.
 *
 * Legal play follows the standard rules: enter from the bar first, hit a blot
 * by landing on it, bear off only with every checker home (a die above the
 * highest checker may bear off from it), and use as many dice as possible.
 * When only one die can be played, the higher one must be played if it can.
 */
import type { Side } from '../../core/game.ts'

export const POINTS = 24
export const CHECKERS = 15
/** Pseudo-point for "from the bar". */
export const BAR = 25

export interface Pos {
  /** Signed count per absolute point, index = point - 1. Red > 0, blue < 0. */
  pts: number[]
  /** Checkers on the bar, per side. */
  bar: [number, number]
  /** Checkers borne off, per side. */
  off: [number, number]
}

/** One checker move: `from` is a side-relative point or BAR; `to` is a side-relative point or 0 (bear off). */
export interface Step {
  from: number
  to: number
  die: number
  hit: boolean
}

export interface Seq {
  steps: Step[]
  end: Pos
}

/** Point `q` on a side's own numbering → absolute point. (The mapping is its own inverse.) */
export const mirror = (q: number): number => POINTS + 1 - q
export const absOf = (s: Side, q: number): number => (s === 0 ? q : mirror(q))
export const sgn = (s: Side): number => (s === 0 ? 1 : -1)
export const other = (s: Side): Side => (s === 0 ? 1 : 0)

export function start(): Pos {
  const pts = Array<number>(POINTS).fill(0)
  const put = (s: Side, q: number, n: number) => {
    pts[absOf(s, q) - 1] = sgn(s) * n
  }
  for (const s of [0, 1] as Side[]) {
    put(s, 24, 2)
    put(s, 13, 5)
    put(s, 8, 3)
    put(s, 6, 5)
  }
  return { pts, bar: [0, 0], off: [0, 0] }
}

export function clone(p: Pos): Pos {
  return { pts: p.pts.slice(), bar: [p.bar[0], p.bar[1]], off: [p.off[0], p.off[1]] }
}

/** Checkers of `s` on its point `q`. */
export function own(p: Pos, s: Side, q: number): number {
  return Math.max(0, sgn(s) * (p.pts[absOf(s, q) - 1] ?? 0))
}

/** Checkers of the opponent of `s` on point `q` (in `s`'s numbering). */
export function opp(p: Pos, s: Side, q: number): number {
  return Math.max(0, -sgn(s) * (p.pts[absOf(s, q) - 1] ?? 0))
}

/** Pip count: the total of dice needed to bear every checker off. */
export function pips(p: Pos, s: Side): number {
  let n = 25 * p.bar[s]
  for (let q = 1; q <= POINTS; q++) n += own(p, s, q) * q
  return n
}

/** True when every checker of `s` is in its home board (or off). */
export function allHome(p: Pos, s: Side): boolean {
  if (p.bar[s] > 0) return false
  for (let q = 7; q <= POINTS; q++) if (own(p, s, q) > 0) return false
  return true
}

const canLand = (p: Pos, s: Side, q: number): boolean => opp(p, s, q) < 2

/** Moves of one die value `d` for `s` from position `p`. */
function stepsWith(p: Pos, s: Side, d: number, out: Step[]): void {
  if (p.bar[s] > 0) {
    const q = BAR - d
    if (canLand(p, s, q)) out.push(step(p, s, BAR, q, d))
    return
  }
  for (let q = 1; q <= POINTS; q++) {
    if (own(p, s, q) === 0) continue
    const t = q - d
    if (t >= 1) {
      if (canLand(p, s, t)) out.push(step(p, s, q, t, d))
    } else if (allHome(p, s)) {
      // Exact, or a higher die when nothing sits above this point.
      let above = false
      for (let r = q + 1; r <= POINTS; r++) if (own(p, s, r) > 0) above = true
      if (t === 0 || !above) out.push(step(p, s, q, 0, d))
    }
  }
}

function step(p: Pos, s: Side, from: number, to: number, die: number): Step {
  return { from, to, die, hit: to > 0 && opp(p, s, to) === 1 }
}

/** Every single checker move available with the dice still to play. */
export function legalSteps(p: Pos, s: Side, dice: readonly number[]): Step[] {
  const out: Step[] = []
  const seen = new Set<number>()
  for (const d of dice) {
    if (seen.has(d)) continue
    seen.add(d)
    stepsWith(p, s, d, out)
  }
  return out
}

/** Play one checker move. Returns the new position; `p` is not changed. */
export function apply(p: Pos, s: Side, st: Step): Pos {
  const n = clone(p)
  if (st.from === BAR) n.bar[s]--
  else n.pts[absOf(s, st.from) - 1] = (n.pts[absOf(s, st.from) - 1] ?? 0) - sgn(s)
  if (st.to === 0) {
    n.off[s]++
    return n
  }
  const A = absOf(s, st.to)
  if (opp(p, s, st.to) === 1) {
    n.pts[A - 1] = 0
    n.bar[other(s)]++
  }
  n.pts[A - 1] = (n.pts[A - 1] ?? 0) + sgn(s)
  return n
}

/**
 * Every complete way to play `dice` from `p` for `s`. Only sequences that use
 * the most dice count (the rule of maximum dice); if only one die can be
 * played, the higher one is required when it can be. Empty when no die can move.
 */
export function sequences(p: Pos, s: Side, dice: readonly number[]): Seq[] {
  const all: Seq[] = []
  const walk = (cur: Pos, left: number[], steps: Step[]) => {
    const moves = legalSteps(cur, s, left)
    if (moves.length === 0) {
      if (steps.length > 0) all.push({ steps, end: cur })
      return
    }
    for (const st of moves) {
      const rest = left.slice()
      rest.splice(rest.indexOf(st.die), 1)
      walk(apply(cur, s, st), rest, [...steps, st])
    }
  }
  walk(p, [...dice], [])
  if (all.length === 0) return all
  const most = Math.max(...all.map((x) => x.steps.length))
  let best = all.filter((x) => x.steps.length === most)
  if (most === 1 && dice[0] !== dice[1]) {
    const hi = Math.max(...dice)
    const higher = best.filter((x) => x.steps[0]?.die === hi)
    if (higher.length > 0) best = higher
  }
  return best
}

export const sameStep = (a: Step | undefined, b: Step | undefined): boolean =>
  !!a && !!b && a.from === b.from && a.to === b.to && a.die === b.die

/** Sequences that begin with the moves already played this turn. */
export function continuations(seqs: readonly Seq[], used: readonly Step[]): Seq[] {
  return seqs.filter(
    (q) => q.steps.length > used.length && used.every((u, i) => sameStep(u, q.steps[i])),
  )
}

/** Distinct next moves open to the player, given the turn's sequences and the moves played. */
export function nextSteps(seqs: readonly Seq[], used: readonly Step[]): Step[] {
  const out: Step[] = []
  for (const q of continuations(seqs, used)) {
    const st = q.steps[used.length]
    if (st && !out.some((o) => sameStep(o, st))) out.push(st)
  }
  return out
}

/** A stable key for a position, to merge duplicate outcomes. */
export const key = (p: Pos): string => `${p.pts.join(',')}|${p.bar.join(',')}|${p.off.join(',')}`

/** Who won and by how much: 1 single, 2 gammon, 3 backgammon. */
export function result(p: Pos): { winner: Side; points: 1 | 2 | 3 } | null {
  for (const s of [0, 1] as Side[]) {
    if (p.off[s] < CHECKERS) continue
    const lost = other(s)
    let points: 1 | 2 | 3 = 1
    if (p.off[lost] === 0) {
      points = 2
      let stuck = p.bar[lost] > 0
      for (let q = 1; q <= 6; q++) if (opp(p, s, q) > 0) stuck = true
      if (stuck) points = 3
    }
    return { winner: s, points }
  }
  return null
}
