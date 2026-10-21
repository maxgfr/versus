import { BaseGame, type MatchSpec, other, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { MID } from '../../core/stage.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { roundEnd, roundsNew, roundsStep, type Rounds } from '../../engines/reflex/index.ts'
import { FrogBot } from './bot.ts'
import { renderPond } from './render.ts'
import {
  COLS,
  type Ev,
  hopsFor,
  newWorld,
  PAD_R,
  padXY,
  ROWS,
  roundWinner,
  SINK_AT,
  stepWorld,
  type World,
} from './rules.ts'

export interface State {
  w: World
  rounds: Rounds
}

/** Round wins needed to take the match (best of three by default). */
export const match: MatchSpec = { unit: 'wins', default: 2, min: 1, max: 9 }

/** The pad under a touch (within tap tolerance), if any. */
function padAt(x: number, y: number): number | undefined {
  let best: number | undefined
  let bd = PAD_R + 26
  for (let i = 0; i < COLS * ROWS; i++) {
    const p = padXY(i)
    const d = Math.hypot(p.x - x, p.y - y)
    if (d <= bd) {
      bd = d
      best = i
    }
  }
  return best
}

class Frogs extends BaseGame<State> {
  private bots: (FrogBot | null)[] = []
  private ev: Ev[] = []

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new FrogBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    // Local 2P: a tap belongs to the frog that can hop to the pad under it, so
    // a frog can hop across the middle; when both (or neither) can, the half decides.
    ctx.input.assign = (x, y) => {
      const half: Side = y >= MID ? 0 : 1
      const w = this.s?.w
      const i = w ? padAt(x, y) : undefined
      if (!w || i === undefined) return half
      const reach = ([0, 1] as Side[]).filter((side) => {
        const f = w.frogs.find((k) => k.side === side && k.fellT < 0)
        return f !== undefined && hopsFor(w, f).includes(i)
      })
      return reach.length === 1 ? (reach[0] as Side) : half
    }
    return { w: newWorld(), rounds: roundsNew(this.target) }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    if (roundsStep(s.rounds, this.time, 2.2)) {
      s.w = newWorld()
      ctx.audio.play('go')
      return
    }
    const playing = s.rounds.phase === 'play'
    const taps: (number | undefined)[] = [undefined, undefined]
    for (const side of [0, 1] as Side[]) {
      const frog = s.w.frogs.find((f) => f.side === side)
      if (!frog) continue
      const bot = this.bots[side]
      if (bot) {
        if (playing) taps[side] = bot.decide(s.w, frog, dt)
        continue
      }
      if (!playing) continue
      // A press counts for the nearest pad, if this side's frog can hop there.
      const hops = hopsFor(s.w, frog)
      for (const p of ctx.input.player(side).downs) {
        let best: number | undefined
        let bd = Infinity
        for (const i of hops) {
          const xy = padXY(i)
          const d = Math.hypot(xy.x - p.x, xy.y - p.y)
          if (d < bd) {
            bd = d
            best = i
          }
        }
        if (best !== undefined && bd <= PAD_R + 26) {
          taps[side] = best
          break
        }
      }
    }
    this.ev.length = 0
    stepWorld(s.w, taps, dt, this.ev)
    for (const e of this.ev) this.feedback(e)
    if (!playing) return
    const w = roundWinner(s.w)
    if (w === null) return
    if (roundEnd(s.rounds, w, this.time, ctx.names) && w !== 'draw') {
      ctx.fx.confetti(w)
      ctx.fx.flash(SIDE[w].light, 0.3)
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2.4 })
    } else if (w !== 'draw') {
      ctx.audio.play('score')
    }
  }

  protected override afterEnd(dt: number): void {
    this.ev.length = 0
    stepWorld(this.s.w, [undefined, undefined], dt, this.ev)
    for (const e of this.ev) this.feedback(e)
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    switch (e.k) {
      case 'hop':
        audio.play('boing', 0.95 + rng.next() * 0.15)
        fx.burst(e.x, e.y, '#d8fbff', {
          count: 5,
          speed: 140,
          size: 7,
          life: 0.35,
          gravity: 0,
          drag: 3,
        })
        break
      case 'land':
        audio.play('tap', 0.9 + rng.next() * 0.2)
        if (e.n >= SINK_AT) audio.play('slide', 0.7)
        fx.ring(e.x, e.y, SIDE[e.side].light, 80)
        fx.burst(e.x, e.y, '#d8fbff', {
          count: 8,
          speed: 200,
          size: 8,
          life: 0.4,
          gravity: 0,
          drag: 3,
          colors: ['#ffffff', '#d8fbff', '#8fe08f'],
        })
        break
      case 'push':
        audio.play('slap', 1.1)
        audio.play('boing', 0.7)
        audio.buzz(25)
        fx.burst(e.x, e.y, C.yellow, {
          count: 16,
          speed: 380,
          size: 10,
          life: 0.4,
          gravity: 0,
          drag: 3,
          kind: 'spark',
        })
        fx.burst(e.x, e.y, '#ffffff', {
          count: 10,
          speed: 260,
          size: 12,
          life: 0.45,
          gravity: 0,
          drag: 3,
        })
        fx.ring(e.x, e.y, C.yellow, 130)
        // A shove that sends the rival into the pond gets its "Splash!" instead.
        if (!this.ev.some((f) => f.k === 'fall'))
          fx.float('Shove!', e.x, e.y - 70, C.yellow, 48, other(e.side))
        fx.shake(0.35)
        fx.stop(4)
        break
      case 'fall':
        audio.play('splash', 0.9)
        audio.buzz(70)
        fx.burst(e.x, e.y, '#9fe6ff', {
          count: 30,
          speed: 360,
          size: 16,
          life: 0.9,
          gravity: 0,
          colors: ['#ffffff', '#9fe6ff', C.cyan],
        })
        fx.burst(e.x, e.y, '#ffffff', {
          count: 18,
          speed: 520,
          size: 10,
          life: 0.7,
          gravity: 900,
          spread: 1.2,
          dir: -Math.PI / 2,
        })
        fx.ring(e.x, e.y, '#ffffff', 170)
        fx.ring(e.x, e.y, '#9fe6ff', 260)
        fx.float(e.stranded ? 'Stranded!' : 'Splash!', e.x, e.y - 60, C.yellow, 60, e.side)
        fx.shake(0.55)
        fx.stop(8)
        break
      case 'sink':
        audio.play('splash', 1.5)
        fx.puff(e.x, e.y, 'rgba(180,240,255,0.6)', 6)
        fx.burst(e.x, e.y, '#7cc458', {
          count: 6,
          speed: 160,
          size: 9,
          life: 0.5,
          gravity: 0,
          drag: 3,
          kind: 'square',
        })
        break
    }
  }

  render(g: Draw): void {
    const { ctx } = this
    // Outline reachable pads for the humans at this device (none in a bot-only demo).
    const show = ([0, 1] as Side[]).map(
      (side) => !ctx.bots[side] && (ctx.mode !== 'online' || ctx.local === side),
    )
    renderPond(g, this.s, this.time, { names: ctx.names, over: this.over, hints: show })
  }
}

export default () => new Frogs()
