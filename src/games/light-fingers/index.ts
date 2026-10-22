import { frame } from '../../core/frame.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { W } from '../../core/stage.ts'
import { floatFor } from '../../core/fx/fx.ts'
import type { PlayerInput } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE } from '../../core/render/palette.ts'
import { ThiefBot } from './bot.ts'
import { BAG, GEMS as GEM_COLORS, GRAB, GUARD, renderLight, worldOf } from './render.ts'
import {
  bankAll,
  type Ev,
  inZone,
  AWAKE,
  LIMIT,
  tableNew,
  tableStep,
  type Table,
  winnerOf,
} from './rules.ts'

/** A height `d` units toward the middle of the table from world `y`, for `side`'s reader. */
const towardMid = (side: Side, y: number, d: number): number => (side === 0 ? y - d : y + d)

export const match: MatchSpec = { unit: 'seconds', default: LIMIT, min: 20, max: 120, step: 10 }

export interface State {
  table: Table
  /** Game time the clock ran out (-1 while playing). */
  endAt: number
}

/** Cosmetic jitter: never touches the seeded game stream. */
const jitter = (r: number): number => (Math.random() * 2 - 1) * r

/** Is a finger of this side on its part of the pile? */
function heldOnPile(pi: PlayerInput, side: Side): boolean {
  for (const p of pi.held.values()) {
    const q = frame(side, p.x, p.y)
    if (inZone(q.x, q.y)) return true
  }
  return false
}

class LightFingers extends BaseGame<State> {
  private bots: [ThiefBot | null, ThiefBot | null] = [null, null]
  private lastSec = -1
  private drags: [number, number] = [0, 0]

  /** Match length chosen on the ready screen, in seconds. */
  private limit(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new ThiefBot(ctx.rng.fork(), ctx.difficulty) : null,
    ) as [ThiefBot | null, ThiefBot | null]
    return { table: tableNew(ctx.rng), endAt: -1 }
  }

  protected step(dt: number): void {
    const { s, ctx } = this
    const sec = Math.max(0, Math.ceil(this.limit() - this.time))
    if (sec !== this.lastSec) {
      this.lastSec = sec
      if (sec > 0 && sec <= 5) ctx.audio.play('tick', 1 + (5 - sec) * 0.06)
    }
    if (this.time >= this.limit()) {
      this.emit(bankAll(s.table, this.time))
      const [a, b] = s.table.thieves
      // The guard snaps awake on the final bell.
      s.table.guard.phase = 'awake'
      s.table.guard.left = AWAKE
      s.endAt = this.time
      const w = winnerOf(s.table)
      ctx.fx.shake(0.3)
      ctx.fx.ring(GUARD.x, GUARD.y, C.yellow, 420)
      if (w !== 'draw') {
        const bag = worldOf(w, BAG.x, BAG.y)
        ctx.fx.confetti(w)
        ctx.fx.burst(bag.x, bag.y, C.yellow, {
          count: 30,
          speed: 640,
          size: 14,
          life: 0.9,
          colors: GEM_COLORS,
          kind: 'square',
        })
        ctx.fx.ring(bag.x, bag.y, SIDE[w].light, 240)
      }
      this.finish(w, { score: [a.bag, b.bag], delay: 2.4 })
      return
    }
    const holds: [boolean, boolean] = [false, false]
    for (const side of [0, 1] as Side[]) {
      const bot = this.bots[side]
      holds[side] = bot
        ? bot.decide(s.table.guard, this.time)
        : heldOnPile(ctx.input.player(side), side)
    }
    this.emit(tableStep(s.table, dt, this.time, holds, ctx.rng))
  }

  private emit(evs: Ev[]): void {
    const { ctx } = this
    const fx = ctx.fx
    for (const ev of evs) {
      switch (ev.k) {
        case 'grab': {
          const p = worldOf(ev.side, GRAB.x, GRAB.y)
          ctx.audio.play('whoosh', ev.side === 0 ? 1.1 : 1.2)
          fx.puff(p.x, p.y, alpha(C.white, 0.5), 5)
          break
        }
        case 'drag': {
          const n = ++this.drags[ev.side]
          const p = worldOf(ev.side, GRAB.x + jitter(60), GRAB.y - 40 + jitter(30))
          fx.burst(p.x, p.y, GEM_COLORS[n % GEM_COLORS.length] as string, {
            count: 3,
            speed: 200,
            size: 8,
            life: 0.35,
            gravity: 260,
            kind: 'spark',
          })
          ctx.audio.play('tick', 1.1 + (n % 6) * 0.05)
          break
        }
        case 'bank': {
          const bag = worldOf(ev.side, BAG.x, BAG.y - 40)
          ctx.audio.play('coin', 1 + Math.min(ev.n, 14) * 0.03)
          ctx.audio.play('swish', 1.2)
          fx.burst(bag.x, bag.y, C.yellow, {
            count: 10 + Math.min(ev.n, 20),
            speed: 460,
            size: 12,
            life: 0.7,
            colors: GEM_COLORS,
            kind: 'square',
          })
          fx.ring(bag.x, bag.y, SIDE[ev.side].light, 170)
          floatFor(
            fx,
            ev.side,
            `+${ev.n}`,
            bag.x - (ev.side === 0 ? 40 : -40),
            towardMid(ev.side, bag.y, 190),
          )
          if (ev.n >= 12) fx.sparks(bag.x, bag.y, C.yellow, 16)
          break
        }
        case 'caught': {
          const p = worldOf(ev.side, GRAB.x, GRAB.y)
          ctx.audio.play('slap')
          ctx.audio.play('buzz', 0.8)
          fx.burst(p.x, p.y, C.red, {
            count: 16 + Math.min(ev.n, 24),
            speed: 620,
            size: 14,
            life: 0.8,
            colors: GEM_COLORS,
            kind: 'square',
          })
          fx.ring(p.x, p.y, C.red, 200)
          fx.stop(6)
          fx.shake(0.35)
          floatFor(fx, ev.side, 'Caught!', W / 2, towardMid(ev.side, p.y, -330))
          break
        }
        case 'stir':
          ctx.audio.play('boing', 0.6)
          fx.ring(GUARD.x, GUARD.y, C.yellow, 220)
          break
        case 'wake':
          fx.shake(0.4)
          fx.flash(C.red, 0.2)
          fx.ring(GUARD.x, GUARD.y, C.red, 320)
          ctx.audio.play('zap', 0.8)
          break
        case 'sleep':
          ctx.audio.play('swish', 0.7)
          fx.puff(GUARD.x + 90, GUARD.y - 90, alpha(C.white, 0.4), 4)
          break
        case 'settle':
          // False alarm: he rolls over and snores on. The ones who held on win the gamble.
          ctx.audio.play('swish', 0.6)
          ctx.audio.play('slide', 0.8)
          fx.puff(GUARD.x + 90, GUARD.y - 90, alpha(C.white, 0.5), 6)
          for (const side of [0, 1] as Side[])
            fx.float('Phew…', GUARD.x, towardMid(side, GUARD.y, -170), C.white, 52, side)
          break
      }
    }
  }

  render(g: Draw): void {
    const { s, ctx } = this
    renderLight(
      g,
      {
        table: s.table,
        names: ctx.names,
        sec: Math.max(0, Math.ceil(this.limit() - this.time)),
        over: this.over,
        endAt: s.endAt,
      },
      this.time,
    )
  }
}

export default () => new LightFingers()
