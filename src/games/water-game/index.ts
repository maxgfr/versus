import { Button } from '../../core/controls.ts'
import { frame } from '../../core/frame.ts'
import { BaseGame, type GameContext, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import type { Rng } from '../../core/rng.ts'
import { choosePumps, type Pumps, thinkEvery } from './bot.ts'
import { halfFrame, mirrorFx } from '../../engines/runner/frame.ts'
import { drawBoard, ringColor } from './render.ts'
import {
  BUTTON,
  LIMIT,
  landedOf,
  NOZZLES,
  newTank,
  RINGS,
  ringWinner,
  SAND_Y,
  stepTank,
  TANK,
  type Tank,
  type TankEv,
} from './rules.ts'

/** Match length: seconds on the clock. Landing all six rings ends the match early. */
export const match: MatchSpec = { unit: 'seconds', default: LIMIT, min: 30, max: 180, step: 15 }

export interface State {
  tanks: [Tank, Tank]
  /** Pumps held, per side: [left, right]. */
  pumps: [[boolean, boolean], [boolean, boolean]]
  /** Game time the match was decided (-1 while it runs), why, and who won: drives the ending. */
  endAt: number
  endWhy: '' | 'all' | 'time'
  winner: Side | 'draw' | null
}

class WaterGame extends BaseGame<State> {
  /** Seconds on the clock: the players' choice, else the default. */
  private get limit(): number {
    return this.ctx.target || match.default
  }

  private buttons: [Button[], Button[]] = [[], []]
  /** Random streams for the dispensers and the computers (host only; never in the state). */
  private tankRng!: [Rng, Rng]
  private botRng!: [Rng, Rng]
  private plans: [Pumps, Pumps] = [
    [false, false],
    [false, false],
  ]
  private nextThink: [number, number] = [0, 0]
  private nextBubbleSound: [number, number] = [0, 0]
  private lastSec = -1

  private turned: [boolean, boolean] = [false, false]

  override init(ctx: GameContext): void {
    super.init(ctx)
    const frames = [halfFrame(0, ctx.mode), halfFrame(1, ctx.mode)]
    mirrorFx(ctx, frames)
    this.turned =
      ctx.mode === 'online' ? [ctx.stage.rot !== 0, ctx.stage.rot === 0] : [false, false]
  }

  protected setup(): State {
    const { ctx } = this
    this.tankRng = [ctx.rng.fork(), ctx.rng.fork()]
    this.botRng = [ctx.rng.fork(), ctx.rng.fork()]
    // Buttons live in each player's frame: their own left and right, at their edge.
    this.buttons = ([0, 1] as Side[]).map((side) =>
      BUTTON.x.map((x) => {
        const at = frame(side, x, BUTTON.y)
        return new Button(side, at.x, at.y, BUTTON.r, '', SIDE[side].main)
      }),
    ) as [Button[], Button[]]
    return {
      tanks: [newTank(this.tankRng[0]), newTank(this.tankRng[1])],
      pumps: [
        [false, false],
        [false, false],
      ],
      endAt: -1,
      endWhy: '',
      winner: null,
    }
  }

  protected step(dt: number): void {
    const { s, ctx } = this
    const sec = Math.max(0, Math.ceil(this.limit - this.time))
    if (sec !== this.lastSec) {
      this.lastSec = sec
      if (sec > 0 && sec <= 5) ctx.audio.play('tick', 1 + (5 - sec) * 0.06)
    }

    // Pumps: a human holds the buttons on their side; the computer picks from the rings.
    for (const side of [0, 1] as Side[]) {
      const bot = this.isBot(side)
      if (bot) this.think(side)
      const input = ctx.input.player(side)
      for (const p of [0, 1] as const) {
        const b = this.buttons[side][p]
        if (!b) continue
        if (bot && this.plans[side][p]) b.press(1)
        b.update(input)
        if (b.hit) this.puff(side, p)
        s.pumps[side][p] = b.pressed
      }
      if (this.time >= this.nextBubbleSound[side] && (s.pumps[side][0] || s.pumps[side][1])) {
        this.nextBubbleSound[side] = this.time + 0.22
        ctx.audio.play('pop', 0.8 + Math.random() * 0.7)
      }
    }

    for (const side of [0, 1] as Side[]) {
      const evs = stepTank(s.tanks[side], dt, this.time, s.pumps[side], this.tankRng[side])
      this.juice(side, evs)
    }

    const done = ([0, 1] as Side[]).filter((side) => landedOf(s.tanks[side]) >= RINGS)
    if (done.length > 0) {
      const winner = done.length === 2 ? 'draw' : (done[0] as Side)
      this.end(winner, 'all', `All ${RINGS} rings landed`)
      return
    }
    if (this.time >= this.limit) {
      ctx.audio.play('buzz')
      const winner = ringWinner(landedOf(s.tanks[0]), landedOf(s.tanks[1]))
      this.end(winner, 'time', "Time's up")
    }
  }

  protected override afterEnd(dt: number): void {
    // The pumps let go and the last bubbles rise; the rings stay as the score left them.
    const s = this.s
    s.pumps = [
      [false, false],
      [false, false],
    ]
    for (const t of s.tanks) {
      for (const b of t.bubbles) b.y -= b.v * dt
      t.bubbles = t.bubbles.filter((b) => b.y > TANK.surface - 10)
    }
  }

  /** The computer re-reads its tank every so often and keeps the pumps it chose. */
  private think(side: Side): void {
    if (this.time < this.nextThink[side]) return
    const t = this.s.tanks[side]
    this.plans[side] = choosePumps(t, this.ctx.difficulty, this.botRng[side], this.time)
    this.nextThink[side] = this.time + thinkEvery(this.ctx.difficulty)
  }

  private end(winner: Side | 'draw', why: 'all' | 'time', note: string): void {
    const { s, ctx } = this
    const { fx } = ctx
    const score: [number, number] = [landedOf(s.tanks[0]), landedOf(s.tanks[1])]
    s.endAt = this.time
    s.endWhy = why
    s.winner = winner
    fx.stop(8)
    fx.shake(0.5)
    if (winner !== 'draw') {
      fx.flash(SIDE[winner].light, 0.35)
      fx.confetti(winner)
    } else fx.flash(C.white, 0.25)
    this.finish(winner, { score, note, delay: 2.4 })
  }

  /** A click and a puff of bubbles when a pump goes down. */
  private puff(side: Side, p: 0 | 1): void {
    const { fx, audio } = this.ctx
    const at = frame(side, NOZZLES[p], SAND_Y)
    const btn = frame(side, BUTTON.x[p], BUTTON.y)
    audio.play('click', p === 0 ? 1.1 : 1.25)
    fx.burst(at.x, at.y, C.white, {
      count: 9,
      speed: 280,
      size: 8,
      life: 0.5,
      gravity: side === 0 ? -260 : 260,
      spread: Math.PI * 0.6,
      dir: side === 0 ? -Math.PI / 2 : Math.PI / 2,
    })
    fx.ring(btn.x, btn.y, SIDE[side].light, BUTTON.r * 1.5)
  }

  /** Every ring that splashed in, landed or sank plays its own feedback. */
  private juice(side: Side, evs: TankEv[]): void {
    const { fx, audio } = this.ctx
    const up = side === 0 ? -1 : 1
    for (const e of evs) {
      const at = frame(side, e.x, e.y)
      if (e.k === 'drop') {
        audio.play('splash', 1.2 + Math.random() * 0.2)
        fx.burst(at.x, at.y, '#bfefff', {
          count: 14,
          speed: 320,
          size: 9,
          life: 0.6,
          gravity: -up * 900,
          spread: Math.PI * 0.8,
          dir: up > 0 ? Math.PI / 2 : -Math.PI / 2,
        })
      } else if (e.k === 'land') {
        const t = this.s.tanks[side]
        const col = ringColor(t.stacks[e.peg][t.stacks[e.peg].length - 1] ?? 1)
        audio.play('coin', 0.95 + e.n * 0.08)
        if (e.n >= RINGS - 1) audio.play('score')
        fx.burst(at.x, at.y, col, {
          count: 20,
          speed: 480,
          size: 8,
          life: 0.6,
          kind: 'spark',
          colors: [col, C.yellow, C.white],
        })
        fx.ring(at.x, at.y, C.yellow, 150)
        fx.shake(0.14)
        fx.stop(3)
        fx.float(`${e.n}/${RINGS}`, at.x, at.y + up * 120, C.white, 64, side)
      } else {
        audio.play('thud', 1.4 + Math.random() * 0.2)
        fx.burst(at.x, at.y, '#f1d394', {
          count: 8,
          speed: 160,
          size: 10,
          life: 0.5,
          gravity: -up * 500,
          spread: Math.PI * 0.7,
          dir: up > 0 ? Math.PI / 2 : -Math.PI / 2,
        })
      }
    }
  }

  render(g: Draw): void {
    const s = this.s
    drawBoard(g, {
      tanks: s.tanks,
      pumps: s.pumps,
      time: this.time,
      remaining: s.endAt >= 0 ? this.limit - s.endAt : this.limit - this.time,
      names: this.ctx.names,
      bots: this.ctx.bots,
      over: this.over,
      endAt: s.endAt,
      endWhy: s.endWhy,
      winner: s.winner,
      turned: this.turned,
    })
  }
}

export default () => new WaterGame()
