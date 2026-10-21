import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Pure rules for Lumber Jack. Each player chops their own trunk from the left
 * or the right. Both trunks are the same seeded sequence of segments; a segment
 * may carry a branch on one side. Chopping from the branch's side drops the
 * branch on the chopper: a one-second stun. First to 50 segments wins.
 */

/** Segments to chop to win. */
export const TARGET = 50
/** Seconds a branch on the chopper keeps them stunned. */
export const STUN = 1
/** Segments in the shared trunk sequence (more than enough for TARGET). */
export const TRUNK_LEN = 80
/** No branch. Otherwise the branch side: 0 = left, 1 = right, as the player sees their own half. */
export const NONE = -1

/** Branch side for each segment, bottom first. The first two are always clear. */
export function trunkNew(rng: Rng): number[] {
  const seq: number[] = []
  for (let i = 0; i < TRUNK_LEN; i++) {
    if (i < 2 || !rng.chance(0.6)) seq.push(NONE)
    else seq.push(rng.chance(0.5) ? 0 : 1)
  }
  return seq
}

export interface Chopper {
  /** Segments cut so far (the score). */
  chops: number
  /** Side the last chop came from (0 left, 1 right, -1 none). */
  from: number
  /** Side of the chop before that (-1 none): the lumberjack hops across when they differ. */
  prev: number
  /** Game time of the last chop (-1 never). */
  chopAt: number
  /** Branch side of the segment that was cut last (-1 none). */
  branch: number
  /** The last chop dropped a branch on the chopper. */
  bonk: boolean
  /** Game time the stun ends (-1 never). */
  stunUntil: number
}

export interface State {
  seq: number[]
  p: [Chopper, Chopper]
}

export const chopperNew = (): Chopper => ({
  chops: 0,
  from: -1,
  prev: -1,
  chopAt: -1,
  branch: NONE,
  bonk: false,
  stunUntil: -1,
})

export const isStunned = (c: Chopper, now: number): boolean => now < c.stunUntil

/**
 * Chop `side`'s trunk from `from` (0 left, 1 right). The segment drops either way.
 * Returns 'bonk' when a branch came down on the chopper, 'ignored' while stunned or done.
 * `target` is the match length in segments.
 */
export function chop(
  s: State,
  side: Side,
  from: 0 | 1,
  now: number,
  target = TARGET,
): 'chop' | 'bonk' | 'ignored' {
  const p = s.p[side]
  if (p.chops >= target || isStunned(p, now)) return 'ignored'
  const b = s.seq[p.chops] ?? NONE
  p.chops++
  p.prev = p.from
  p.from = from
  p.chopAt = now
  p.branch = b
  p.bonk = b === from
  if (!p.bonk) return 'chop'
  p.stunUntil = now + STUN
  return 'bonk'
}

/**
 * The side that is safe to chop from for the segment at `chops`: opposite its
 * branch (or either side when it is bare). With `mistake` odds it picks the branch side.
 */
export function safeSide(seq: number[], chops: number, rng: Rng, mistake: number): 0 | 1 {
  const b = seq[chops] ?? NONE
  if (b === 0) return rng.chance(mistake) ? 0 : 1
  if (b === 1) return rng.chance(mistake) ? 1 : 0
  return rng.chance(0.5) ? 0 : 1
}

/** Red or blue once one trunk reaches the target; 'draw' if both do on the same step; null while racing. */
export function winnerOf(s: State, target = TARGET): Side | 'draw' | null {
  const a = s.p[0].chops >= target
  const b = s.p[1].chops >= target
  if (a && b) return 'draw'
  if (a) return 0
  if (b) return 1
  return null
}
