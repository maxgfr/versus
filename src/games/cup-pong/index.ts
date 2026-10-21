import { floatFor } from '../../core/fx/fx.ts'
import { type Side, other } from '../../core/game.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { type ShotParams } from '../../engines/aim/index.ts'
import { TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { drawTray, hint, render } from './render.ts'
import {
  advance,
  type Event,
  fire,
  newState,
  originOf,
  type State,
  shotFromFlick,
  sunkBy,
} from './rules.ts'

type Game = State & { endAt: number }

class CupPong extends TurnGame<Game> {
  /** The computer's flick for its turn, chosen as its turn starts and shown while it thinks. */
  private botShot: ShotParams | null = null

  protected setup(): Game {
    // In local 2P the player whose turn it is may flick from anywhere.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    return { ...newState(this.ctx.rng.chance(0.5) ? 0 : 1), endAt: -1 }
  }

  protected override busy(): boolean {
    return this.s.phase !== 'aim'
  }

  protected override animate(dt: number): void {
    const { events, winner } = advance(this.s, dt)
    for (const e of events) this.juice(e)
    if (winner !== null) {
      const score: [number, number] = [sunkBy(this.s, 0), sunkBy(this.s, 1)]
      this.s.endAt = this.s.t
      this.ctx.fx.confetti(winner)
      this.ctx.audio.play('powerup', 1.2)
      this.finish(winner, { score, note: 'Cleared every cup', delay: 2.2 })
      return
    }
    if (this.s.phase === 'aim' && this.isBot(this.s.turn) && !this.botShot) {
      this.botShot = choose(this.s, this.s.turn, this.ctx.difficulty, this.ctx.rng)
    }
  }

  protected override afterEnd(dt: number): void {
    // Keep the clock going for the last cup's lift-off and the winner's wave.
    this.s.t += dt
    for (const c of this.s.cups) if (!c.alive) c.fall += dt
  }

  protected stepTurn(): void {
    const side = this.s.turn
    const pi = this.ctx.input.player(side)
    let held: ShotParams | null = null
    for (const p of pi.held.values()) {
      held = flickOf(side, p)
      break
    }
    this.s.aiming = held
    for (const p of pi.ups) {
      const shot = flickOf(side, p)
      if (shot) {
        this.shoot(shot)
        return
      }
    }
  }

  protected botPlay(): void {
    const shot = this.botShot ?? choose(this.s, this.s.turn, this.ctx.difficulty, this.ctx.rng)
    this.botShot = null
    this.shoot(shot)
  }

  private shoot(shot: ShotParams): void {
    const side = this.s.turn
    fire(this.s, side, shot)
    const o = originOf(side)
    this.ctx.audio.play('flip', 1.1 + shot.power * 0.3)
    this.ctx.audio.play('tap', 1.4)
    this.ctx.fx.puff(o.x, o.y, 'rgba(255,255,255,0.6)', 6)
    this.ctx.fx.ring(o.x, o.y, SIDE[side].light, 90)
    this.ctx.fx.shake(0.08)
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    switch (e.kind) {
      case 'bounce':
        audio.play('bounce', 1.3)
        audio.play('tap', 1.6)
        fx.puff(e.x, e.y, 'rgba(255,255,255,0.5)', 6)
        fx.ring(e.x, e.y, C.white, 80)
        fx.shake(0.06)
        return
      case 'cup': {
        const thrower = e.side
        const col = SIDE[other(thrower)].main
        audio.play('splash', 1)
        audio.play('score', 1)
        audio.buzz(30)
        // Water jumps out of the cup, then bits of the cup's colour.
        fx.burst(e.x - 8, e.y - 14, '#7fd8ff', {
          count: 26,
          speed: 520,
          size: 11,
          life: 0.6,
          gravity: 0,
          drag: 2.8,
          colors: ['#7fd8ff', '#c9f1ff', C.white],
        })
        fx.burst(e.x, e.y, col, {
          count: 12,
          speed: 380,
          size: 12,
          life: 0.6,
          gravity: 0,
          drag: 2.4,
          kind: 'square',
          colors: [col, C.white, SIDE[thrower].light],
        })
        fx.ring(e.x, e.y, SIDE[thrower].light, 200)
        fx.flash(SIDE[thrower].main, e.left === 0 ? 0.35 : 0.2)
        fx.shake(e.left === 0 ? 0.55 : 0.35)
        fx.stop(e.left === 0 ? 8 : 5)
        floatFor(
          fx,
          thrower,
          e.left === 0 ? 'Clear!' : e.left === 1 ? 'One left!' : 'Cup!',
          e.x,
          e.y,
        )
        return
      }
      case 'miss':
        if (e.out) {
          audio.play('whoosh', 1.2)
          fx.float('Out!', e.x, e.y, SIDE[e.side].light, 56, e.side)
        } else {
          audio.play('error', 1)
          fx.float('Missed!', e.x, e.y, SIDE[e.side].light, 56, e.side)
        }
        return
      case 'turn':
        audio.play('tick', 1)
        return
    }
  }

  render(g: Draw): void {
    const s = this.s
    const preview = s.phase === 'aim' && !this.over ? this.previewOf() : null
    const end = s.endAt >= 0 ? s.t - s.endAt : -1
    render(
      g,
      s,
      {
        preview,
        end,
        winner: end >= 0 ? (s.cups.some((c) => c.side === 0 && c.alive) ? 0 : 1) : null,
      },
      this.time,
    )
    if (
      (this.time < 10 || s.t - s.turnAt > 4) &&
      s.phase === 'aim' &&
      !this.isBot(s.turn) &&
      !this.over
    )
      hint(g, s, this.time)
    this.drawTurns(g, undefined, s.phase === 'aim')
    for (const side of [0, 1] as Side[]) drawTray(g, s, side, sunkBy(s, side), this.time)
  }

  /** What the flick preview shows: the human's live flick, or the bot's planned one while it thinks. */
  private previewOf(): ShotParams | null {
    if (this.isBot(this.s.turn)) return this.botShot
    return this.s.aiming
  }
}

/** A held or released pointer as a flick for `side`. */
function flickOf(side: Side, p: Ptr): ShotParams | null {
  return shotFromFlick(side, p.x - p.x0, p.y - p.y0)
}

export default () => new CupPong()
