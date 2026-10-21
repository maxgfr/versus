import { Joystick } from '../../core/controls.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { Spring } from '../../core/fx/ease.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { type BotMemory, decide, newMemory } from './bot.ts'
import { type Look, render, type Stick } from './render.ts'
import { type Event, newWorld, step, type Targets, winner, type World } from './rules.ts'

interface State {
  w: World
  /** Each human's floating stick, so the online guest sees it too. */
  sticks: [Stick | null, Stick | null]
  /** The decided match, stamped so the guest plays the same ending. */
  end: { at: number; winner: Side | 'draw' } | null
}

/** Crown seconds to win. */
export const match: MatchSpec = { unit: 'seconds', default: 15, min: 5, max: 45, step: 5 }

/** Stick deflection 1 asks for full speed: the blob aims this far ahead of itself. */
const REACH = 140

class KingOfTheHill extends BaseGame<State> {
  private mem: BotMemory[] = [newMemory(), newMemory()]
  private sticks: [Joystick, Joystick] | null = null
  // Cosmetic only (not synced): squash on bumps, meter pulse on each crown second.
  private squash: [Spring, Spring] = [new Spring(1, 360, 11), new Spring(1, 360, 11)]
  private lastHit = -1
  private pulse: [Spring, Spring] = [new Spring(0, 260, 12), new Spring(0, 260, 12)]

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return { w: newWorld(this.target), sticks: [null, null], end: null }
  }

  /** Floating sticks: in local 2P each in its own half, otherwise anywhere on the table. */
  private stick(side: Side): Joystick {
    if (!this.sticks) {
      const make = (s: Side) => {
        const half = this.ctx.mode === '2p'
        const zone = half
          ? { x: 0, y: s === 0 ? MID : 0, w: W, h: MID }
          : { x: 0, y: 0, w: W, h: H }
        return new Joystick(s, zone, 110)
      }
      this.sticks = [make(0), make(1)]
    }
    return this.sticks[side]
  }

  protected step(dt: number): void {
    const w = this.s.w
    const targets: Targets = [this.aim(w, 0, dt), this.aim(w, 1, dt)]
    const events = step(w, dt, targets, this.ctx.rng)
    for (const e of events) this.juice(e)
    const won = winner(w)
    if (won !== null) this.end(won)
  }

  protected override afterEnd(dt: number): void {
    // Blobs coast to a stop under the confetti.
    const w = this.s.w
    w.t += dt
    for (const b of w.blobs) {
      const k = Math.exp(-3 * dt)
      b.vx *= k
      b.vy *= k
      b.x += b.vx * dt
      b.y += b.vy * dt
    }
    this.s.sticks = [null, null]
  }

  private end(won: Side | 'draw'): void {
    const w = this.s.w
    const { fx, audio } = this.ctx
    this.s.end = { at: w.t, winner: won }
    if (won !== 'draw') {
      const b = w.blobs[won]
      fx.confetti(won)
      fx.flash(SIDE[won].main, 0.3)
      fx.shake(0.45)
      fx.stop(6)
      fx.ring(b.x, b.y, C.yellow, 320)
      fx.burst(b.x, b.y - 90, C.yellow, {
        count: 30,
        speed: 800,
        size: 14,
        life: 0.9,
        gravity: 600,
        colors: [C.yellow, C.white, SIDE[won].light],
        kind: 'square',
      })
      audio.play('powerup', 1.2)
      audio.buzz(40)
    }
    this.finish(won, { score: [Math.floor(w.crown[0]), Math.floor(w.crown[1])], delay: 2 })
  }

  /** Where a side's blob is steered: the bot's plan, or ahead of the blob along the stick. */
  private aim(w: World, side: Side, dt: number): { x: number; y: number } | null {
    if (this.isBot(side))
      return decide(w, side, this.ctx.difficulty, this.ctx.rng, this.mem[side] as BotMemory, dt)
    const st = this.stick(side)
    st.update(this.ctx.input.player(side))
    this.s.sticks[side] = st.active
      ? { bx: st.baseX, by: st.baseY, kx: st.knobX, ky: st.knobY }
      : null
    if (!st.active) return null
    const b = w.blobs[side]
    return { x: b.x + st.x * REACH, y: b.y + st.y * REACH }
  }

  /** World y direction that reads as "up" for a side's player (+1 when their text is upside down). */
  private up(side: Side): number {
    const rot = this.ctx.mode === '2p' ? (side === 1 ? Math.PI : 0) : this.ctx.stage.rot
    return Math.abs(rot) > 1 ? 1 : -1
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const w = this.s.w
    switch (e.kind) {
      case 'hit': {
        // Blobs leaning on each other touch every substep: juice the bumps, not the lean.
        if (this.time - this.lastHit < 0.12 && e.speed < 600) break
        this.lastHit = this.time
        const k = Math.min(1, e.speed / 900)
        audio.play('slap', 0.8 + k * 0.5)
        fx.sparks(e.x, e.y, C.white, Math.round(4 + k * 8))
        if (e.speed > 300) fx.puff(e.x, e.y, 'rgba(255,248,239,0.45)', 5)
        if (e.speed > 450) fx.shake(0.08 + k * 0.14)
        if (e.speed > 850) {
          fx.stop(3)
          audio.buzz(14)
        }
        for (const sp of this.squash) sp.kick(-2 - k * 5)
        break
      }
      case 'shove':
        audio.play('boing', 0.9 + Math.min(0.5, e.speed / 2000))
        fx.burst(e.x, e.y, C.yellow, {
          count: 5,
          speed: 260,
          size: 34,
          life: 0.6,
          gravity: -200,
          drag: 2,
          kind: 'emoji',
          glyph: '💫',
        })
        break
      case 'wall':
        audio.play('wall', 1)
        fx.puff(e.x, e.y, 'rgba(255,248,239,0.5)', 4)
        break
      case 'zone':
        audio.play('whoosh', 1.1)
        audio.play('powerup', 1)
        fx.ring(e.x, e.y, C.yellow, 260)
        fx.burst(e.x, e.y, C.yellow, {
          count: 22,
          speed: 520,
          size: 12,
          life: 0.6,
          gravity: 0,
          drag: 2.4,
          colors: [C.yellow, C.white, C.orange],
          kind: 'square',
        })
        break
      case 'tick': {
        const left = w.target - e.n
        audio.play(left <= 3 && left > 0 ? 'count' : 'coin', 1 + e.n * 0.02)
        floatFor(
          fx,
          e.side,
          left <= 3 && left > 0 ? `${left}!` : '+1',
          e.x,
          e.y + this.up(e.side) * 130,
        )
        fx.sparks(e.x, e.y, C.yellow, 6)
        this.pulse[e.side].kick(10)
        break
      }
    }
  }

  render(g: Draw, _alpha: number): void {
    for (const sp of this.squash) sp.update(1 / 60)
    for (const sp of this.pulse) sp.update(1 / 60)
    const look: Look = {
      names: this.ctx.names,
      target: this.target,
      sticks: this.s.sticks,
      end: this.s.end,
      squash: [this.squash[0].value, this.squash[1].value],
      pulse: [Math.max(0, this.pulse[0].value / 10), Math.max(0, this.pulse[1].value / 10)],
    }
    render(g, this.s.w, look)
  }
}

export default () => new KingOfTheHill()
