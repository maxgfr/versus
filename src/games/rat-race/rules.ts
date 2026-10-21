import type { Side } from '../../core/game.ts'

/**
 * Pure rules for Rat Race. Each rat runs a loop in its own half. Mashing gives
 * speed. Taps on the beat (120 BPM) boost it a lot; off-beat taps add a little;
 * mashing faster than the limit trips the rat and it stumbles. First to LAPS
 * laps wins.
 */

/** Laps to win. */
export const LAPS = 3
export const TAU = Math.PI * 2
export const BPM = 120
/** Seconds per beat. */
export const BEAT = 60 / BPM
/** Half-width (s) of the on-beat window. */
export const PERFECT = 0.08
/** Speed (rad/s) added per plain tap. */
export const KICK = 0.36
/** Speed decay per second. */
export const DRAG = 1.5
/** Multipliers on KICK: on the beat, and off it. */
export const PERFECT_MUL = 2.6
export const OFF_MUL = 0.5
/** Mashing: more than MASH_MAX taps inside MASH_WINDOW seconds trips the rat. */
export const MASH_WINDOW = 0.5
export const MASH_MAX = 5
/** Seconds down after a stumble. */
export const STUMBLE = 0.9

export type Judge = 'perfect' | 'ok' | 'stumble' | 'down'

export interface Rat {
  /** Total angle run around the loop (rad). Laps = floor(angle / TAU). */
  angle: number
  /** Current speed (rad/s). */
  speed: number
  /** Times of recent taps, inside MASH_WINDOW. */
  taps: number[]
  /** Game time the stumble ends (-1 never). */
  downUntil: number
  /** Last judgement and when it happened. */
  judge: Judge | ''
  judgeAt: number
  /** Game time of the last perfect (-1 never), for the glow. */
  perfectAt: number
  /** Taps that landed on the beat. */
  perfects: number
  /** Taps made, for the record. */
  made: number
}

export interface State {
  rats: [Rat, Rat]
}

export const ratNew = (): Rat => ({
  angle: 0,
  speed: 0,
  taps: [],
  downUntil: -1,
  judge: '',
  judgeAt: -1,
  perfectAt: -1,
  perfects: 0,
  made: 0,
})

export const worldNew = (): State => ({ rats: [ratNew(), ratNew()] })

/** Laps run so far (capped at the match's `target` laps). */
export const laps = (r: Rat, target = LAPS): number => Math.min(target, Math.floor(r.angle / TAU))

export const isDown = (r: Rat, now: number): boolean => now < r.downUntil

/** Seconds from `now` to the nearest beat. */
export function beatError(now: number): number {
  return Math.abs(now - Math.round(now / BEAT) * BEAT)
}

/** Judge a tap at `now`: on the beat or not. */
export function judgeTap(now: number): 'perfect' | 'ok' {
  return beatError(now) <= PERFECT ? 'perfect' : 'ok'
}

/**
 * One tap on a rat. Returns the judgement, 'stumble' when the mash limit is
 * broken, or 'down' while the rat cannot be tapped.
 */
export function tap(r: Rat, now: number): Judge {
  if (isDown(r, now)) return 'down'
  r.made++
  r.taps = r.taps.filter((t) => now - t < MASH_WINDOW)
  r.taps.push(now)
  if (r.taps.length > MASH_MAX) {
    r.taps = []
    r.speed = 0
    r.downUntil = now + STUMBLE
    r.judge = 'stumble'
    r.judgeAt = now
    return 'stumble'
  }
  const j = judgeTap(now)
  r.speed += KICK * (j === 'perfect' ? PERFECT_MUL : OFF_MUL)
  if (j === 'perfect') {
    r.perfects++
    r.perfectAt = now
  }
  r.judge = j
  r.judgeAt = now
  return j
}

/** Move a rat for one step: drag on its speed, run its angle. */
export function stepRat(r: Rat, dt: number, now: number): void {
  if (isDown(r, now)) {
    r.speed = 0
    return
  }
  r.speed *= Math.exp(-DRAG * dt)
  r.angle += r.speed * dt
}

/** Side that finished first; 'draw' when both reached the line on the same step. */
export function winnerOf(s: State, target = LAPS): Side | 'draw' | null {
  const a = s.rats[0].angle >= target * TAU
  const b = s.rats[1].angle >= target * TAU
  if (a && b) return 'draw'
  if (a) return 0
  if (b) return 1
  return null
}

/** The loop in red's layout: centre and radii of the racing line. */
export const TRACK = { cx: 500, cy: 1300, rx: 330, ry: 230 } as const

/**
 * Where a rat is on the loop for a run angle, in red's layout. The rat starts
 * at the bottom of the loop, nearest red. `dir` is the sign of its horizontal motion.
 */
export function loopAt(angle: number): { x: number; y: number; dir: number } {
  const t = angle + Math.PI / 2
  return {
    x: TRACK.cx + TRACK.rx * Math.cos(t),
    y: TRACK.cy + TRACK.ry * Math.sin(t),
    dir: -Math.sin(t) >= 0 ? 1 : -1,
  }
}
