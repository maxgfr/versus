import { floatFor } from '../../core/fx/fx.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
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
  gapAt,
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
  // Cosmetic only (not synced): last step's puck positions, squash springs, count pulses.
  private prev: { x: number; y: number }[] | null = null
  private squash: Spring[] = []
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return { t: newTable(this.target, this.ctx.rng), end: null }
  }

  protected step(dt: number): void {
    const t = this.s.t
    this.prev = t.pucks.map((p) => ({ x: p.x, y: p.y }))
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
    this.prev = t.pucks.map((p) => ({ x: p.x, y: p.y }))
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
    this.finish(won, {
      score: [owned(t, 0), owned(t, 1)],
      note: 'Pucks left on each side',
      delay: 2,
    })
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

  /** Kick the squash spring of the puck nearest a point. */
  private squish(x: number, y: number, amount: number): void {
    const ps = this.s.t.pucks
    if (this.squash.length !== ps.length) this.squash = ps.map(() => new Spring(1, 420, 12))
    let best = -1
    let bd = Infinity
    ps.forEach((p, i) => {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2
      if (d < bd) {
        bd = d
        best = i
      }
    })
    this.squash[best]?.kick(amount)
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    switch (e.kind) {
      case 'grab':
        audio.play('click', 1.1)
        fx.ring(e.x, e.y, SIDE[e.side].light, 110)
        this.squish(e.x, e.y, 3)
        break
      case 'shot': {
        // The stretch is the force: pitch, spark count, shake, hit-stop and buzz all follow it.
        const k = e.power
        audio.play('shoot', 0.8 + k * 0.6)
        audio.play('boing', 0.7 + k * 0.5)
        fx.burst(e.x, e.y, SIDE[e.side].light, {
          count: Math.round(6 + k * 14),
          speed: 350 + k * 450,
          size: 9,
          life: 0.4,
          gravity: 0,
          drag: 3,
          colors: [SIDE[e.side].light, C.white],
          kind: 'spark',
        })
        fx.shake(0.06 + k * 0.16)
        if (k > 0.85) fx.stop(2)
        audio.buzz(Math.round(6 + k * 16))
        this.squish(e.x, e.y, 4 + k * 6)
        break
      }
      case 'hit': {
        const k = Math.min(1, e.speed / 1800)
        audio.play('hit', 0.8 + k * 0.6)
        fx.sparks(e.x, e.y, C.yellow, Math.round(4 + k * 10))
        if (e.speed > 1200) fx.shake(0.1 + k * 0.12)
        if (e.speed > 2000) fx.stop(2)
        if (e.speed > 900) audio.buzz(Math.round(6 + k * 12))
        this.squish(e.x, e.y, -2 - k * 5)
        break
      }
      case 'wall': {
        const k = Math.min(1, e.speed / 2400)
        audio.play('wall', 0.9 + k * 0.4)
        if (e.speed > 800) fx.sparks(e.x, e.y, C.white, Math.round(3 + k * 6))
        this.squish(e.x, e.y, -1 - k * 4)
        break
      }
      case 'post':
        audio.play('bounce', 1.3 + Math.min(0.3, e.speed / 4000))
        fx.sparks(e.x, e.y, C.yellow, Math.round(5 + Math.min(1, e.speed / 2000) * 8))
        fx.shake(0.06 + Math.min(0.1, e.speed / 20000))
        this.squish(e.x, e.y, -3)
        break
      case 'band':
        audio.play('boing', 1.2 + Math.min(0.4, e.speed / 3000))
        this.squish(e.x, e.y, -2 - Math.min(1, e.speed / 2000) * 3)
        break
      case 'cross': {
        // A puck came through the gap: it now belongs to the side it reached.
        const from: Side = e.to === 0 ? 1 : 0
        audio.play('whoosh', 1)
        audio.play('coin', 1.1)
        fx.ring(W / 2, MID, C.yellow, gapAt(this.s.t) * 0.8)
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
        audio.buzz(12)
        this.pulse[from].kick(14)
        // The sender is one puck closer to winning.
        const left = owned(this.s.t, from)
        const y = from === 0 ? MID + 260 : MID - 260
        if (left > 0) floatFor(fx, from, left === 1 ? 'LAST ONE!' : `${left} LEFT`, W / 2, y)
        break
      }
    }
  }

  render(g: Draw, alpha: number): void {
    const t = this.s.t
    const hint: [boolean, boolean] = [!this.isBot(0), !this.isBot(1)]
    if (this.squash.length !== t.pucks.length)
      this.squash = t.pucks.map(() => new Spring(1, 420, 12))
    for (const s of this.squash) s.update(1 / 60)
    for (const s of this.pulse) s.update(1 / 60)
    const prev = this.prev
    const at = t.pucks.map((p, i) => {
      const q = prev?.[i]
      return q && !p.held
        ? { x: lerp(q.x, p.x, alpha), y: lerp(q.y, p.y, alpha) }
        : { x: p.x, y: p.y }
    })
    const look: Look = {
      names: this.ctx.names,
      target: this.target,
      hint,
      end: this.s.end,
      at,
      squash: this.squash.map((s) => s.value),
      pulse: [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)],
    }
    render(g, t, look)
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
  }
}

export default () => new SlingPuck()
