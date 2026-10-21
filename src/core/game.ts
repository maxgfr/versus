import type { Audio } from './audio.ts'
import type { Fx } from './fx/fx.ts'
import type { Input } from './input.ts'
import type { Draw } from './render/draw.ts'
import type { Rng } from './rng.ts'
import type { Stage } from './stage.ts'

/** 0 = red, sits at the bottom. 1 = blue, sits at the top (upside down in local 2P). */
export type Side = 0 | 1
export type Mode = '1p' | '2p' | 'online'
export type Difficulty = 'easy' | 'normal' | 'hard'
export type Family =
  'board' | 'dice' | 'cards' | 'puck' | 'aim' | 'reflex' | 'arena' | 'runner' | 'ragdoll' | 'puzzle'

export interface Result {
  winner: Side | 'draw'
  /** Optional final score, red first. Shown on the result screen. */
  score?: [number, number]
  /** Optional line under the title, e.g. "New record: 1:23". */
  note?: string
}

export interface GameContext {
  stage: Stage
  input: Input
  fx: Fx
  audio: Audio
  rng: Rng
  mode: Mode
  difficulty: Difficulty
  /** Which sides are driven by the computer. In 1P mode, blue is. */
  bots: [boolean, boolean]
  /** 2 vs 2: each side has two players, left lane and right lane. */
  teams: boolean
  names: [string, string]
  /** The side this device's human plays. Always 0 except for the online guest. */
  local: Side
  /** Seed shared by both devices online; puzzle races use it so both halves get the same puzzle. */
  seed: number
}

export interface Game {
  init(ctx: GameContext): void
  /** Fixed step, `dt` is always 1/60 s. */
  update(dt: number): void
  render(g: Draw, alpha: number): void
  /** Serializable state. The online host broadcasts it; the guest only restores and renders. */
  snapshot(): unknown
  restore(s: unknown): void
  readonly result: Result | null
  destroy(): void
}

export type GameFactory = () => Game

export const STEP = 1 / 60

/** Other side. */
export const other = (s: Side): Side => (s === 0 ? 1 : 0)

/**
 * Convenience base: keeps game state in `this.s` (a plain object) so snapshot and
 * restore come for free, and handles the pause between "someone won" and the
 * result screen so games get to play their ending.
 */
export abstract class BaseGame<S extends object> implements Game {
  ctx!: GameContext
  s!: S
  result: Result | null = null
  /** Seconds since start, ticks on the host and is carried in snapshots. */
  time = 0
  private pending: { result: Result; at: number } | null = null

  init(ctx: GameContext): void {
    this.ctx = ctx
    this.s = this.setup()
  }

  /** Build the initial state. `this.ctx` is available. */
  protected abstract setup(): S

  protected abstract step(dt: number): void

  abstract render(g: Draw, alpha: number): void

  update(dt: number): void {
    this.time += dt
    if (this.pending) {
      if (this.time >= this.pending.at) {
        this.result = this.pending.result
        this.pending = null
      }
      this.afterEnd(dt)
      return
    }
    this.step(dt)
  }

  /** Called every step once the game is decided, while the ending plays. */
  protected afterEnd(_dt: number): void {}

  /** True once the winner is known (the result screen may still be pending). */
  get over(): boolean {
    return this.pending !== null || this.result !== null
  }

  /**
   * Declare the outcome. The result screen appears after `delay` seconds, during
   * which `afterEnd` runs so the game can play its ending (a ball dropping in,
   * a tower falling…).
   */
  protected finish(
    winner: Side | 'draw',
    o: { score?: [number, number]; note?: string; delay?: number } = {},
  ): void {
    if (this.over) return
    const result: Result = { winner }
    if (o.score) result.score = o.score
    if (o.note) result.note = o.note
    this.pending = { result, at: this.time + (o.delay ?? 1.4) }
    this.ctx.audio.play(winner === 'draw' ? 'draw' : 'win')
  }

  isBot(side: Side): boolean {
    return this.ctx.bots[side]
  }

  snapshot(): unknown {
    return { s: this.s, t: this.time, r: this.result, p: this.pending }
  }

  restore(snap: unknown): void {
    const o = snap as {
      s: S
      t: number
      r: Result | null
      p: { result: Result; at: number } | null
    }
    this.s = o.s
    this.time = o.t
    this.result = o.r
    this.pending = o.p
  }

  destroy(): void {}
}
