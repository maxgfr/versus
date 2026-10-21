import { floatFor } from '../../core/fx/fx.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { type BotMemory, decide, newMemory } from './bot.ts'
import { type Look, render } from './render.ts'
import {
  applyCmd,
  type Cmd,
  type Event,
  GAP,
  grabIndex,
  newTable,
  owned,
  step,
  type Table,
  winner,
} from './rules.ts'

interface State {
  t: Table
  /** The decided match, stamped so the guest plays the same ending. */
  end: { at: number; winner: Side | 'draw' } | null
}

/** Pucks each side starts with. A side with none left wins. */
export const match: MatchSpec = { unit: 'rounds', default: 5, min: 3, max: 10 }

class SlingPuck extends BaseGame<State> {
  private mem: BotMemory[] = [newMemory(), newMemory()]

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return { t: newTable(this.target, this.ctx.rng), end: null }
  }

  protected step(dt: number): void {
    const t = this.s.t
    const events: Event[] = []
    for (const side of [0, 1] as Side[]) applyCmd(t, side, this.command(side, dt), events, dt)
    step(t, dt, events)
    for (const e of events) this.juice(e)
    const won = winner(t)
    if (won !== null) this.end(won)
  }

  protected override afterEnd(dt: number): void {
    // Pucks keep sliding to a stop while the ending plays.
    const t = this.s.t
    for (const side of [0, 1] as Side[]) if (t.aims[side]) applyCmd(t, side, { release: true }, [])
    step(t, dt, [])
  }

  private end(won: Side | 'draw'): void {
    const t = this.s.t
    const { fx, audio } = this.ctx
    this.s.end = { at: t.t, winner: won }
    if (won !== 'draw') {
      fx.confetti(won)
      fx.flash(SIDE[won].main, 0.3)
      fx.shake(0.4)
      fx.stop(6)
      audio.buzz(40)
    }
    this.finish(won, { score: [owned(t, 0), owned(t, 1)], delay: 2 })
  }

  /** What a side's hand (or the computer) asks for this step. */
  private command(side: Side, dt: number): Cmd {
    const t = this.s.t
    if (this.isBot(side))
      return decide(t, side, this.ctx.difficulty, this.ctx.rng, this.mem[side] as BotMemory, dt)
    const input = this.ctx.input.player(side)
    const aim = t.aims[side]
    if (aim) {
      const p = input.held.get(aim.ptr)
      return p ? { finger: { x: p.x, y: p.y } } : { release: true }
    }
    for (const d of input.downs) {
      const idx = grabIndex(t, side, d.x, d.y)
      if (idx >= 0) return { grab: { idx, ptr: d.id, x: d.x, y: d.y }, finger: { x: d.x, y: d.y } }
    }
    return {}
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    switch (e.kind) {
      case 'grab':
        audio.play('click', 1.1)
        fx.ring(e.x, e.y, SIDE[e.side].light, 110)
        break
      case 'shot':
        audio.play('shoot', 0.8 + e.power * 0.6)
        audio.play('boing', 0.7 + e.power * 0.5)
        fx.burst(e.x, e.y, SIDE[e.side].light, {
          count: 10,
          speed: 500,
          size: 9,
          life: 0.4,
          gravity: 0,
          drag: 3,
          colors: [SIDE[e.side].light, C.white],
          kind: 'spark',
        })
        fx.shake(0.06 + e.power * 0.12)
        if (e.power > 0.8) audio.buzz(12)
        break
      case 'hit': {
        const k = Math.min(1, e.speed / 1800)
        audio.play('hit', 0.8 + k * 0.6)
        fx.sparks(e.x, e.y, C.yellow, Math.round(4 + k * 10))
        if (e.speed > 1200) fx.shake(0.1 + k * 0.12)
        if (e.speed > 2000) fx.stop(2)
        break
      }
      case 'wall':
        audio.play('wall', 0.9 + Math.min(0.4, e.speed / 3000))
        if (e.speed > 800) fx.sparks(e.x, e.y, C.white, 5)
        break
      case 'post':
        audio.play('bounce', 1.4)
        fx.sparks(e.x, e.y, C.yellow, 8)
        fx.shake(0.06)
        break
      case 'band':
        audio.play('boing', 1.2 + Math.min(0.4, e.speed / 3000))
        break
      case 'cross': {
        // A puck came through the gap: it now belongs to the side it reached.
        const from: Side = e.to === 0 ? 1 : 0
        audio.play('whoosh', 1)
        audio.play('coin', 1.1)
        fx.ring(W / 2, MID, C.yellow, GAP * 0.8)
        fx.burst(W / 2, MID, SIDE[from].main, {
          count: 22,
          speed: 650,
          size: 11,
          life: 0.55,
          gravity: 0,
          drag: 2.5,
          spread: Math.PI * 0.9,
          dir: e.to === 0 ? Math.PI / 2 : -Math.PI / 2,
          colors: [SIDE[from].main, SIDE[from].light, C.yellow, C.white],
          kind: 'square',
        })
        fx.shake(0.12)
        // The sender is one puck closer to winning.
        const left = owned(this.s.t, from)
        const y = from === 0 ? MID + 260 : MID - 260
        if (left > 0) floatFor(fx, from, left === 1 ? 'LAST ONE!' : `${left} LEFT`, W / 2, y)
        break
      }
    }
  }

  render(g: Draw, _alpha: number): void {
    const hint: [boolean, boolean] = [!this.isBot(0), !this.isBot(1)]
    const look: Look = { names: this.ctx.names, target: this.target, hint, end: this.s.end }
    render(g, this.s.t, look)
  }
}

export default () => new SlingPuck()
