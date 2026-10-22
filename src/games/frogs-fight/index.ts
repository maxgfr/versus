import { BaseGame, type MatchSpec, other, type Side, STEP } from '../../core/game.ts'
import { Spring } from '../../core/fx/ease.ts'
import { floatFor } from '../../core/fx/fx.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
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

/** How far from a pad's centre a touch still counts for it. */
const TOUCH = PAD_R + 26

/** The pause button sits on the left edge around mid-height: touches there are not for the pond. */
const underPause = (x: number, y: number): boolean => x < 110 && y > 800 && y < 1000

/** The pad under a touch (within tap tolerance), if any. */
function padAt(x: number, y: number): number | undefined {
  if (underPause(x, y)) return undefined
  let best: number | undefined
  let bd = TOUCH
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
  // Cosmetic only (not synced): HUD pip pulse per side.
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]

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
    if (roundsStep(s.rounds, this.time, 1.8)) {
      s.w = newWorld()
      ctx.audio.play('go')
      return
    }
    const playing = s.rounds.phase === 'play'
    const taps: (number | undefined)[] = [undefined, undefined]
    for (const side of [0, 1] as Side[]) {
      const frog = s.w.frogs.find((f) => f.side === side)
      if (!frog || !playing) continue
      const bot = this.bots[side]
      if (bot) {
        taps[side] = bot.decide(s.w, frog, dt)
        continue
      }
      // A press counts for the nearest pad this side's frog can reach (from the
      // pad it is on, or landing on: a tap just before touchdown is buffered).
      const hops = hopsFor(s.w, frog)
      for (const p of ctx.input.player(side).downs) {
        if (underPause(p.x, p.y)) continue
        let best: number | undefined
        let bd = TOUCH
        for (const i of hops) {
          const xy = padXY(i)
          const d = Math.hypot(xy.x - p.x, xy.y - p.y)
          if (d < bd) {
            bd = d
            best = i
          }
        }
        if (best !== undefined) {
          taps[side] = best
          break
        }
      }
    }
    this.ev.length = 0
    stepWorld(s.w, taps, dt, this.ev)
    for (const e of this.ev) this.juice(e)
    if (!playing) return
    const won = roundWinner(s.w)
    if (won === null) return
    const done = roundEnd(s.rounds, won, this.time, ctx.names)
    if (won === 'draw') {
      ctx.audio.play('draw')
      return
    }
    this.roundJuice(won, done)
    if (done) this.finish(won, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2.4 })
  }

  protected override afterEnd(dt: number): void {
    this.ev.length = 0
    stepWorld(this.s.w, [undefined, undefined], dt, this.ev)
    for (const e of this.ev) this.juice(e)
  }

  /** The survivor's moment: flash, a shock ring under it, a pulse on its pips. */
  private roundJuice(side: Side, match: boolean): void {
    const { fx, audio } = this.ctx
    const col = SIDE[side]
    const f = this.s.w.frogs.find((k) => k.side === side)
    const p = f && f.pad >= 0 ? padXY(f.pad) : { x: 500, y: MID }
    this.pulse[side].kick(14)
    fx.ring(p.x, p.y, col.light, match ? 320 : 220)
    fx.burst(p.x, p.y, col.main, {
      count: match ? 40 : 22,
      speed: match ? 900 : 600,
      size: 14,
      life: 0.9,
      gravity: 0,
      drag: 2.4,
      colors: [col.main, col.light, C.yellow, '#ffffff'],
      kind: 'square',
    })
    if (match) {
      fx.confetti(side)
      fx.flash(col.light, 0.32)
    } else {
      audio.play('score')
      fx.flash(col.main, 0.18)
      floatFor(fx, side, 'Round!')
    }
  }

  private juice(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    switch (e.k) {
      case 'hop': {
        // A two-pad leap is the big one: deeper boing, more spray off the pad.
        const k = e.d >= 2 ? 1 : 0.45
        audio.play('boing', 1.15 - k * 0.3 + rng.next() * 0.08)
        if (k === 1) audio.play('whoosh', 1.2)
        fx.burst(e.x, e.y, '#d8fbff', {
          count: Math.round(4 + k * 8),
          speed: 140 + k * 140,
          size: 7,
          life: 0.35,
          gravity: 0,
          drag: 3,
        })
        break
      }
      case 'land': {
        const k = e.shoved ? 0.6 : e.d >= 2 ? 1 : 0.45
        audio.play('tap', 1.05 - k * 0.3 + rng.next() * 0.1)
        if (e.n >= SINK_AT) audio.play('slide', 0.7)
        fx.ring(e.x, e.y, SIDE[e.side].light, 70 + k * 60)
        fx.burst(e.x, e.y, '#d8fbff', {
          count: Math.round(6 + k * 10),
          speed: 160 + k * 160,
          size: 8,
          life: 0.4,
          gravity: 0,
          drag: 3,
          colors: ['#ffffff', '#d8fbff', '#8fe08f'],
        })
        if (k === 1) {
          fx.shake(0.08)
          audio.buzz(8)
        }
        break
      }
      case 'push': {
        // Force = pads sent: a long leap hits twice as hard.
        const k = e.d >= 2 ? 1 : 0.5
        const dir = Math.atan2(e.dy, e.dx)
        audio.play('slap', 1.25 - k * 0.35)
        audio.play('hit', 0.8 + k * 0.4)
        audio.buzz(Math.round(15 + k * 25))
        fx.sparks(e.x, e.y, C.yellow, Math.round(8 + k * 16))
        fx.burst(e.x, e.y, '#ffffff', {
          count: Math.round(8 + k * 12),
          speed: 300 + k * 400,
          size: 12,
          life: 0.45,
          gravity: 0,
          drag: 3,
          spread: 1.4,
          dir,
        })
        fx.ring(e.x, e.y, C.yellow, 100 + k * 70)
        // A shove that sends the rival into the pond gets its "Splash!" instead.
        if (!e.off)
          fx.float(k === 1 ? 'Big shove!' : 'Shove!', e.x, e.y - 70, C.yellow, 48, other(e.side))
        fx.shake(0.2 + k * 0.25)
        fx.stop(Math.round(2 + k * 4))
        break
      }
      case 'clash':
        audio.play('boing', 1.4)
        audio.play('hit', 1.2)
        audio.buzz(20)
        fx.sparks(e.x, e.y, '#ffffff', 16)
        fx.ring(e.x, e.y, C.yellow, 140)
        fx.float('Clash!', e.x, e.y - 70, C.yellow, 48)
        fx.shake(0.25)
        fx.stop(3)
        break
      case 'fall':
        audio.play('splash', 0.9)
        audio.buzz(70)
        fx.burst(e.x, e.y, '#9fe6ff', {
          count: 30,
          speed: 380,
          size: 16,
          life: 0.9,
          gravity: 0,
          colors: ['#ffffff', '#9fe6ff', C.cyan],
        })
        fx.burst(e.x, e.y, '#ffffff', {
          count: 18,
          speed: 560,
          size: 10,
          life: 0.7,
          gravity: 900,
          spread: 1.2,
          dir: -Math.PI / 2,
        })
        fx.ring(e.x, e.y, '#ffffff', 170)
        fx.ring(e.x, e.y, '#9fe6ff', 280)
        fx.float(e.stranded ? 'Stranded!' : 'Splash!', e.x, e.y - 60, C.yellow, 60, e.side)
        fx.flash('#bff6ff', 0.2)
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

  render(g: Draw, alpha = 1): void {
    const { ctx } = this
    for (const p of this.pulse) p.update(STEP)
    // Outline reachable pads for the humans at this device (none in a bot-only demo).
    const show = ([0, 1] as Side[]).map(
      (side) => !ctx.bots[side] && (ctx.mode !== 'online' || ctx.local === side),
    )
    renderPond(g, this.s, this.time, {
      names: ctx.names,
      over: this.over,
      hints: show,
      // Draw between the last two steps: hops are functions of time.
      now: Math.max(0, this.s.w.t - (1 - alpha) * STEP),
      pulse: [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)],
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    for (const p of this.pulse) p.set(0)
  }
}

export default () => new Frogs()
