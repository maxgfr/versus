import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Pure knife throwing: each player has a spinning log in their half and throws
 * knives from their edge into its near rim. A knife sticks at the log's angle
 * at the moment it arrives, then turns with the log. Hitting a stuck knife costs
 * a life. Stick enough knives to clear a stage: the first to clear the match's
 * stages (three by default, chosen before the game) wins, or the rival runs out
 * of lives. Both players play at once. No DOM.
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
/** Default match length in stages. The chosen length is kept in `State.target`. */
export const STAGES = 3
/** Knives to stick per stage. */
export const KNIVES = [6, 8, 10]
export const CLEAR_PAUSE = 1.6

/** Knives to stick on a 1-based stage; stages past the table keep the last count. */
export const needOf = (stage: number): number => KNIVES[stage - 1] ?? KNIVES[KNIVES.length - 1] ?? 7

export type Pattern = 'steady' | 'flip' | 'wave'
/** One rotation pattern per stage. */
export const PATTERNS: readonly { kind: Pattern; w: number; period: number; amp: number }[] = [
  { kind: 'steady', w: 2.2, period: 0, amp: 0 },
  { kind: 'flip', w: 2.8, period: 2, amp: 0 },
  { kind: 'wave', w: 2.6, period: 0, amp: 1.5 },
]

/** The pattern for a 1-based stage. Stages past the last one repeat the cycle. */
export const patternOf = (stage: number) => PATTERNS[(stage - 1) % PATTERNS.length]

/** Each stage spins a little faster than the one before: the match tightens as it goes. */
export const rampOf = (stage: number): number => Math.min(1.6, 1 + 0.1 * (stage - 1))

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
  /** Stages to clear to win (the match length chosen before the game). */
  target: number
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

export function newState(rng: Rng, target = STAGES): State {
  const logs: [Log, Log] = [newLog(rng), newLog(rng)]
  for (const l of logs) setPattern(l)
  return { now: 0, logs, flying: [], cleared: [0, 0], target, ended: false, winner: null }
}

/** The rotation for the log's current stage. */
function setPattern(l: Log): void {
  const p = patternOf(l.stage)
  l.w = p ? p.w * l.sign * rampOf(l.stage) : 0
  l.flipT = 0
}

/** The spin speed the pattern asks for right now. */
export function spinAt(l: Log): number {
  const p = patternOf(l.stage)
  if (!p) return 0
  if (p.kind === 'wave') return (p.w * l.sign + p.amp * Math.sin(l.t * 1.3)) * rampOf(l.stage)
  return l.w
}

/** The spin part of a log: what `turn` reads and writes. */
type Spin = Pick<Log, 'a' | 'w' | 't' | 'flipT' | 'stage' | 'sign'>

/** Turn a log by `dt` following its stage's pattern (flips and wobbles included). */
function turn(l: Spin, dt: number): void {
  l.t += dt
  const p = patternOf(l.stage)
  if (p?.kind === 'flip') {
    l.flipT += dt
    if (l.flipT >= p.period) {
      l.w = -l.w
      l.flipT = 0
    }
  }
  if (p?.kind === 'wave') l.w = spinAt(l as Log)
  l.a += l.w * dt
}

/**
 * The log's rotation `dt` seconds from now, following the real pattern (a flip
 * due before then is included). What a player sees coming, so bots may use it.
 */
export function angleIn(l: Log, dt: number): number {
  const c: Spin = { a: l.a, w: l.w, t: l.t, flipT: l.flipT, stage: l.stage, sign: l.sign }
  const n = Math.max(1, Math.ceil(dt / (1 / 120)))
  for (let i = 0; i < n; i++) turn(c, dt / n)
  return c.a
}

/** Throw a knife from `side`'s edge. False when the log cannot take one now. */
export function throwKnife(s: State, side: Side): boolean {
  const l = s.logs[side]
  if (s.ended || l.pause > 0 || l.cool > 0) return false
  l.cool = COOLDOWN
  s.flying.push({ side, at: s.now + FLY })
  return true
}

/** Angle a knife arriving `dt` seconds from now would stick at (for bots and previews). */
export const arrivalPhi = (l: Log, dt = 0): number => frontOf(dt > 0 ? angleIn(l, dt) : l.a)

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
    l.cool = Math.max(0, l.cool - dt)
    turn(l, dt)
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
  // Knives landing in the same step land together: whatever they decide is
  // settled after all of them, so neither player wins on list order.
  const done: [boolean, boolean] = [false, false]
  const out: [boolean, boolean] = [false, false]
  for (const f of arrive) land(s, f.side, ev, done, out)
  const won = (side: Side): void => {
    ev.push({ kind: 'win', side })
  }
  if (done[0] || done[1] || out[0] || out[1]) {
    s.ended = true
    for (const side of [0, 1] as Side[]) if (out[side]) ev.push({ kind: 'out', side })
    if (done[0] && done[1]) s.winner = 'draw'
    else if (done[0] || done[1]) s.winner = done[0] ? 0 : 1
    else if (out[0] && out[1]) s.winner = 'draw'
    else s.winner = out[0] ? 1 : 0
    if (s.winner !== 'draw') won(s.winner)
  }
  return ev
}

function land(
  s: State,
  side: Side,
  ev: Event[],
  done: [boolean, boolean],
  out: [boolean, boolean],
): void {
  const l = s.logs[side]
  if (l.pause > 0 || s.ended || done[side] || out[side]) return
  const phi = frontOf(l.a)
  if (blocked(l, phi)) {
    l.lives--
    l.failAt = s.now
    ev.push({ kind: 'fail', side, lives: l.lives })
    if (l.lives <= 0) out[side] = true
    return
  }
  l.stuck.push(phi)
  l.hitAt = s.now
  const need = needOf(l.stage)
  ev.push({ kind: 'stick', side, phi, count: l.stuck.length, of: need })
  if (l.stuck.length >= need) {
    s.cleared[side]++
    l.clearAt = s.now
    l.burst = [...l.stuck]
    ev.push({ kind: 'cleared', side, stage: l.stage })
    if (l.stage >= s.target) done[side] = true
    else {
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
