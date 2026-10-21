import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Pure knife throwing: each player has a spinning log in their half and throws
 * knives from their edge into its near rim. A knife sticks at the log's angle
 * at the moment it arrives, then turns with the log. Hitting a stuck knife costs
 * a life. Stick enough knives to clear a stage; three stages win, or the rival
 * runs out of lives. Both players play at once. No DOM.
 */

/** Knife flight time from the edge to the rim (s). */
export const FLY = 0.22
export const LOG = { x: 500, y: 1250, r: 200 }
/** Where knives start, in red's frame (below the log). */
export const ORIGIN = { x: 500, y: 1610 }
/** Angular width of a knife in the log (rad): a knife this close to another one is a fail. */
export const KNIFE_W = 0.1
export const COOLDOWN = 0.28
export const LIVES = 2
export const STAGES = 3
/** Knives to stick per stage. */
export const KNIVES = [6, 8, 10]
export const CLEAR_PAUSE = 1.6

export type Pattern = 'steady' | 'flip' | 'wave'
/** One rotation pattern per stage. */
export const PATTERNS: readonly { kind: Pattern; w: number; period: number; amp: number }[] = [
  { kind: 'steady', w: 2.2, period: 0, amp: 0 },
  { kind: 'flip', w: 2.8, period: 2, amp: 0 },
  { kind: 'wave', w: 2.6, period: 0, amp: 1.5 },
]

export interface Log {
  /** Current rotation of the log (rad). */
  a: number
  /** Current angular speed (rad/s). */
  w: number
  /** Seconds since the log was made. */
  t: number
  /** Seconds since the spin last flipped (flip pattern). */
  flipT: number
  /** Spin direction chosen for the stage. */
  sign: 1 | -1
  /** 1-based stage being played. */
  stage: number
  /** Log-relative angle of each stuck knife. */
  stuck: number[]
  lives: number
  /** Seconds until the next throw is allowed. */
  cool: number
  /** Seconds left of the stage-clear pause (the log is inert meanwhile). */
  pause: number
  /** Match clock (`State.now`) of the last knife that stuck, of the last fail, of the last
   * stage clear and of the current log's arrival: renderers tween from these. */
  hitAt: number
  failAt: number
  clearAt: number
  bornAt: number
  /** Log-relative angles of the knives that were in the log when it last burst (for the burst). */
  burst: number[]
}

export interface Flying {
  side: Side
  /** Arrival time (elapsed). */
  at: number
}

export interface State {
  now: number
  logs: [Log, Log]
  flying: Flying[]
  /** Stages cleared per side. */
  cleared: [number, number]
  ended: boolean
  winner: Side | 'draw' | null
}

export type Event =
  | { kind: 'stick'; side: Side; phi: number; count: number; of: number }
  | { kind: 'fail'; side: Side; lives: number }
  | { kind: 'cleared'; side: Side; stage: number }
  | { kind: 'win'; side: Side }
  | { kind: 'out'; side: Side }

export const circDist = (a: number, b: number): number => {
  const d = Math.abs(a - b) % (Math.PI * 2)
  return Math.min(d, Math.PI * 2 - d)
}

/** Log-relative angle that is at the front (nearest the player) at log angle `a`. */
export const frontOf = (a: number): number => -a

function newLog(rng: Rng): Log {
  return {
    a: rng.range(0, Math.PI * 2),
    w: 0,
    t: 0,
    flipT: 0,
    sign: rng.chance(0.5) ? 1 : -1,
    stage: 1,
    stuck: [],
    lives: LIVES,
    cool: 0,
    pause: 0,
    hitAt: -9,
    failAt: -9,
    clearAt: -9,
    bornAt: 0,
    burst: [],
  }
}

export function newState(rng: Rng): State {
  const logs: [Log, Log] = [newLog(rng), newLog(rng)]
  for (const l of logs) setPattern(l)
  return { now: 0, logs, flying: [], cleared: [0, 0], ended: false, winner: null }
}

/** The rotation for the log's current stage. */
function setPattern(l: Log): void {
  const p = PATTERNS[l.stage - 1] ?? PATTERNS[0]
  l.w = p ? p.w * l.sign : 0
  l.flipT = 0
}

/** The spin speed the pattern asks for right now. */
export function spinAt(l: Log): number {
  const p = PATTERNS[l.stage - 1] ?? PATTERNS[0]
  if (!p) return 0
  if (p.kind === 'wave') return p.w * l.sign + p.amp * Math.sin(l.t * 1.3)
  return l.w
}

/** Throw a knife from `side`'s edge. False when the log cannot take one now. */
export function throwKnife(s: State, side: Side): boolean {
  const l = s.logs[side]
  if (s.ended || l.pause > 0 || l.cool > 0) return false
  l.cool = COOLDOWN
  s.flying.push({ side, at: s.now + FLY })
  return true
}

/** Angle the knife would stick at, if it arrived now (for bots and previews). */
export const arrivalPhi = (l: Log, dt = 0): number => frontOf(l.a + spinAt(l) * dt)

/** Whether a knife arriving at log-relative `phi` would hit one already stuck. */
export function blocked(l: Log, phi: number, margin = 0): boolean {
  return l.stuck.some((p) => circDist(p, phi) < KNIFE_W + margin)
}

/** Advance time: spins, cooldowns, pauses and knives arriving. */
export function advance(s: State, dt: number, rng: Rng): Event[] {
  const ev: Event[] = []
  // The clock keeps running after the end so the closing animations can play.
  s.now += dt
  if (s.ended) return ev
  for (const side of [0, 1] as Side[]) {
    const l = s.logs[side]
    l.t += dt
    l.cool = Math.max(0, l.cool - dt)
    const p = PATTERNS[l.stage - 1]
    if (p?.kind === 'flip') {
      l.flipT += dt
      if (l.flipT >= p.period) {
        l.w = -l.w
        l.flipT = 0
      }
    }
    if (p?.kind === 'wave') l.w = spinAt(l)
    l.a += l.w * dt
    if (l.pause > 0) {
      l.pause = Math.max(0, l.pause - dt)
      if (l.pause === 0) {
        nextStage(l, rng)
        l.bornAt = s.now
      }
    }
  }
  const arrive = s.flying.filter((f) => f.at <= s.now)
  s.flying = s.flying.filter((f) => f.at > s.now)
  for (const f of arrive) land(s, f.side, ev)
  return ev
}

function land(s: State, side: Side, ev: Event[]): void {
  const l = s.logs[side]
  if (l.pause > 0 || s.ended) return
  const phi = frontOf(l.a)
  if (blocked(l, phi)) {
    l.lives--
    l.failAt = s.now
    ev.push({ kind: 'fail', side, lives: l.lives })
    if (l.lives <= 0) {
      s.ended = true
      s.winner = side === 0 ? 1 : 0
      ev.push({ kind: 'out', side })
      ev.push({ kind: 'win', side: s.winner })
    }
    return
  }
  l.stuck.push(phi)
  l.hitAt = s.now
  const need = KNIVES[l.stage - 1] ?? KNIVES[KNIVES.length - 1] ?? 7
  ev.push({ kind: 'stick', side, phi, count: l.stuck.length, of: need })
  if (l.stuck.length >= need) {
    s.cleared[side]++
    l.clearAt = s.now
    l.burst = [...l.stuck]
    ev.push({ kind: 'cleared', side, stage: l.stage })
    if (l.stage >= STAGES) {
      s.ended = true
      s.winner = side
      ev.push({ kind: 'win', side })
    } else {
      // The stuck knives stay up while the stage-clear banner plays.
      l.pause = CLEAR_PAUSE
    }
  }
}

function nextStage(l: Log, rng: Rng): void {
  l.stage++
  l.stuck = []
  l.burst = []
  l.sign = rng.chance(0.5) ? 1 : -1
  l.cool = 0.5
  setPattern(l)
}
