import { frame } from './frame.ts'
import type { GameContext, Side } from './game.ts'
import { C } from './render/palette.ts'
import { MID, W } from './stage.ts'

/**
 * Matches that get harder the longer they run. A speed multiplier that starts
 * at 1 and climbs steadily to `max` after `over` seconds of play, then holds.
 * Games multiply their ball / puck / scroll speed by it and keep the seconds
 * played in their state, so the online guest sees the same pace.
 */
export interface Ramp {
  /** Top multiplier, reached after `over` seconds. */
  max: number
  over: number
}

export function paceAt(t: number, ramp: Ramp): number {
  return 1 + (ramp.max - 1) * Math.min(1, Math.max(0, t / ramp.over))
}

/** Which tenth of extra speed a pace is on (0 at the start): the cue for a "Faster!" call. */
export function paceStep(pace: number): number {
  return Math.floor((pace - 1) * 10 + 1e-9)
}

/** The "Faster!" call when the pace climbs a step: once per player, facing them. */
export function paceCue(ctx: GameContext): void {
  ctx.audio.play('powerup', 1.1)
  const sides: Side[] = ctx.mode === '1p' ? [0] : [0, 1]
  for (const side of sides) {
    const at = frame(side, W / 2, MID + 150)
    ctx.fx.float('Faster!', at.x, at.y, C.yellow, 60, side)
  }
}
