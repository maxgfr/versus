import { floatFor } from '../../core/fx/fx.ts'
import { Spring } from '../../core/fx/ease.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { type BotMemory, decide, newMemory } from './bot.ts'
import { marbleColor, type Look, render } from './render.ts'
import { type Cmd, type Event, newWorld, step, type World, winner } from './rules.ts'

interface State {
  w: World
  /** The decided match, stamped so the guest plays the same ending. */
  end: { at: number; winner: Side | 'draw' } | null
}

/** Marbles released into the pond. The most eaten wins. */
export const match: MatchSpec = { unit: 'rounds', default: 30, min: 10, max: 60, step: 5 }

class HappyHippos extends BaseGame<State> {
  private mem: BotMemory[] = [newMemory(), newMemory()]
  // Cosmetic only (not synced): head squash on each chomp.
  private chomp: [Spring, Spring] = [new Spring(1, 420, 14), new Spring(1, 420, 14)]
  private pulse: [Spring, Spring] = [new Spring(0, 260, 12), new Spring(0, 260, 12)]
  private gulp: [number, number] = [-1, -1]
  /** Marbles in the current bite, per side. */
  private bite: [number, number] = [0, 0]

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return { w: newWorld(this.target), end: null }
  }

  protected step(dt: number): void {
    const w = this.s.w
    const cmds: [Cmd, Cmd] = [this.command(0, dt), this.command(1, dt)]
    const events = step(w, dt, cmds, this.ctx.rng)
    for (const e of events) this.juice(e)
    const won = winner(w)
    if (won !== null) {
      const { fx, audio } = this.ctx
      this.s.end = { at: w.t, winner: won }
      if (won !== 'draw') {
        fx.confetti(won)
        fx.flash(SIDE[won].main, 0.3)
        fx.shake(0.4)
        fx.stop(6)
        audio.play('chomp', 0.7)
        audio.buzz(40)
      }
      this.finish(won, { score: [w.hippos[0].eaten, w.hippos[1].eaten], delay: 2 })
    }
  }

  protected override afterEnd(dt: number): void {
    // The hippos keep their ending animation running on the game clock.
    this.s.w.t += dt
  }

  /** A side's lunge request for this step: the computer's, or the first tap it made. */
  private command(side: Side, dt: number): Cmd {
    if (this.isBot(side))
      return decide(
        this.s.w,
        side,
        this.ctx.difficulty,
        this.ctx.rng,
        this.mem[side] as BotMemory,
        dt,
      )
    const tap = this.ctx.input.player(side).downs[0]
    return { tap: tap ? { x: tap.x, y: tap.y } : null }
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    switch (e.kind) {
      case 'lunge':
        audio.play('whoosh', 1.2 + (e.side === 0 ? 0 : 0.1))
        this.chomp[e.side].kick(4)
        fx.shake(0.04)
        break
      case 'eat': {
        const col = marbleColor(e.id)
        audio.play('chomp', 0.85 + (e.id % 5) * 0.06)
        fx.burst(e.x, e.y, col, {
          count: 16,
          speed: 520,
          size: 13,
          life: 0.5,
          gravity: 500,
          drag: 2.2,
          colors: [col, C.white, SIDE[e.side].light],
        })
        fx.sparks(e.x, e.y, C.yellow, 8)
        fx.ring(e.x, e.y, col, 110)
        // Several marbles in one bite hit harder each time.
        const combo = this.time - this.gulp[e.side] < 0.25
        const n = combo ? ++this.bite[e.side] : (this.bite[e.side] = 1)
        fx.shake(0.1 + Math.min(3, n) * 0.06)
        fx.stop(1 + Math.min(3, n))
        this.chomp[e.side].kick(-6 - n * 2)
        this.pulse[e.side].kick(10)
        // Two marbles in one bite earn a shout.
        this.gulp[e.side] = this.time
        floatFor(fx, e.side, n >= 3 ? 'TRIPLE!' : combo ? 'DOUBLE!' : '+1', e.x, e.y)
        if (combo) audio.play('coin', 1.2 + n * 0.1)
        audio.buzz(8 + n * 6)
        break
      }
      case 'bump': {
        const k = Math.min(1, e.speed / 1400)
        audio.play('click', 0.8 + k * 0.7)
        if (e.speed > 500) fx.sparks(e.x, e.y, C.white, Math.round(3 + k * 5))
        break
      }
      case 'wall':
        audio.play('bounce', 0.9 + Math.min(0.4, e.speed / 1200))
        break
      case 'spawn':
        audio.play('pop', 1.1)
        fx.ring(e.x, e.y, C.yellow, 120)
        fx.burst(e.x, e.y, C.white, {
          count: 8,
          speed: 300,
          size: 9,
          life: 0.4,
          gravity: 0,
          drag: 3,
          colors: [marbleColor(e.id), C.white],
        })
        break
    }
  }

  render(g: Draw, alpha: number): void {
    for (const sp of this.chomp) sp.update(1 / 60)
    for (const sp of this.pulse) sp.update(1 / 60)
    const look: Look = {
      names: this.ctx.names,
      chomp: [Math.max(0.6, this.chomp[0].value), Math.max(0.6, this.chomp[1].value)],
      target: this.target,
      end: this.s.end,
      back: this.s.end ? 0 : (1 - alpha) / 60,
    }
    render(g, this.s.w, look, [
      Math.max(0, this.pulse[0].value / 10),
      Math.max(0, this.pulse[1].value / 10),
    ])
  }
}

export default () => new HappyHippos()
