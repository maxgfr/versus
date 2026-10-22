import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { floatFor } from '../../core/fx/fx.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, shade } from '../../core/render/palette.ts'
import {
  type ControlLook,
  firePressed,
  type SideControl,
  sideControls,
  snapControl,
} from '../../engines/arena/index.ts'
import { roundEnd, roundsNew, roundsStep, type Rounds } from '../../engines/reflex/index.ts'
import { BombBot } from './bot.ts'
import { type Look, renderBoard } from './render.ts'
import {
  BOARD_BOTTOM,
  type Drive,
  type Ev,
  newWorld,
  roundWinner,
  stepWorld,
  type World,
} from './rules.ts'

export interface State {
  w: World
  rounds: Rounds
  /** Control visuals, so an online guest can draw sticks and buttons. */
  ctl: ControlLook[]
}

/** Round wins needed to take the match (best of three by default). */
export const match: MatchSpec = { unit: 'wins', default: 2, min: 1, max: 9 }

class Festival extends BaseGame<State> {
  private controls: SideControl[] = []
  private bots: (BombBot | null)[] = []
  private ev: Ev[] = []
  // Cosmetic only (never synced): last step's positions for interpolation.
  private prev: ({ x: number; y: number } | undefined)[] = []
  private look: Look = { alpha: 1, prev: this.prev }

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.controls = [
      ...sideControls(ctx.stage, 0, false, BOARD_BOTTOM),
      ...sideControls(ctx.stage, 1, false, BOARD_BOTTOM),
    ]
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new BombBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    return {
      w: newWorld(ctx.rng),
      rounds: roundsNew(this.target),
      ctl: this.controls.map((c) => snapControl(c, 1)),
    }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    this.remember()
    if (roundsStep(s.rounds, this.time, 2.4)) {
      s.w = newWorld(ctx.rng)
      this.prev.length = 0
      ctx.audio.play('go')
      return
    }
    for (const c of this.controls) {
      c.stick.update(ctx.input.player(c.side))
      c.fire.update(ctx.input.player(c.side))
    }
    const playing = s.rounds.phase === 'play'
    const drives: (Drive | undefined)[] = s.w.players.map((p) => {
      const c = this.controls.find((k) => k.side === p.side)
      const bot = this.bots[p.side]
      if (bot) {
        const d = bot.decide(s.w, p, dt)
        if (c) {
          c.stick.set(d.jx, d.jy)
          if (d.bomb) c.fire.press(4)
        }
        return playing ? d : undefined
      }
      if (!c || !playing) return undefined
      return { jx: c.stick.x, jy: c.stick.y, bomb: firePressed(c, ctx.input.player(c.side)) }
    })
    this.ev.length = 0
    stepWorld(s.w, drives, dt, this.ev)
    for (const e of this.ev) this.feedback(e)
    s.ctl = this.controls.map((c) => {
      const p = s.w.players.find((k) => k.side === c.side)
      const ready = p ? (p.bombsOut < p.bombsMax ? 1 : 0.2) : 1
      return snapControl(c, ready)
    })
    if (!playing) return
    const w = roundWinner(s.w)
    if (w === null) return
    // Decided: bombs still ticking can't knock out the survivor any more.
    s.w.frozen = true
    if (roundEnd(s.rounds, w, this.time, ctx.names) && w !== 'draw') {
      ctx.fx.confetti(w)
      ctx.fx.flash(SIDE[w].main, 0.3)
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2.4 })
    } else {
      ctx.audio.play(w === 'draw' ? 'draw' : 'score')
      if (w !== 'draw') floatFor(ctx.fx, w, 'Round!')
    }
  }

  /** Last step's positions, for interpolation (cosmetic, outside the state). */
  private remember(): void {
    for (const p of this.s.w.players) {
      const q = this.prev[p.id]
      if (q) {
        q.x = p.x
        q.y = p.y
      } else this.prev[p.id] = { x: p.x, y: p.y }
    }
  }

  protected override afterEnd(dt: number): void {
    this.remember()
    this.ev.length = 0
    stepWorld(this.s.w, [], dt, this.ev)
    for (const e of this.ev) this.feedback(e)
  }

  private feedback(e: Ev): void {
    const { fx, audio } = this.ctx
    switch (e.k) {
      case 'place':
        audio.play('place', 0.9 + Math.random() * 0.2)
        fx.puff(e.x, e.y + 20, 'rgba(255,255,255,0.45)', 4)
        fx.ring(e.x, e.y, SIDE[e.side].light, 60)
        break
      case 'boom': {
        // A bigger cross (more range, more cells) is a deeper, harder boom.
        const k = Math.min(1, (e.n - 1) / 16)
        audio.play('explode', 1.2 - k * 0.35 + Math.random() * 0.1)
        audio.buzz(20 + Math.round(k * 40))
        fx.burst(e.x, e.y, C.orange, {
          count: 14 + e.n * 3,
          speed: 460 + k * 260,
          size: 14,
          life: 0.5,
          gravity: 0,
          colors: [C.orange, C.yellow, C.red, '#ffffff'],
        })
        fx.burst(e.x, e.y, '#4a4458', {
          count: 8,
          speed: 160,
          size: 30,
          life: 0.9,
          gravity: -60,
          drag: 2.5,
        })
        fx.ring(e.x, e.y, C.yellow, 110 + k * 120)
        fx.flash(C.orange, 0.08 + k * 0.1)
        fx.shake(0.25 + k * 0.3)
        fx.stop(2 + Math.round(k * 3))
        break
      }
      case 'hurry':
        audio.play('buzz')
        fx.flash('#ff3b2f', 0.2)
        for (const side of [0, 1] as Side[]) floatFor(fx, side, 'Hurry up!')
        break
      case 'drop':
        audio.play('thud', 0.8 + Math.random() * 0.1)
        fx.puff(e.x, e.y + 20, 'rgba(200,190,210,0.6)', 5)
        fx.shake(0.12)
        break
      case 'crate':
        audio.play('thud', 1.3)
        fx.burst(e.x, e.y, C.wood, {
          count: 14,
          speed: 420,
          size: 13,
          life: 0.7,
          gravity: 900,
          kind: 'square',
          colors: [C.wood, C.woodDark, shade(C.wood, 0.2)],
        })
        fx.puff(e.x, e.y, 'rgba(240,220,190,0.5)', 4)
        break
      case 'pick':
        audio.play('powerup', 1 + e.kind * 0.1)
        fx.ring(e.x, e.y, SIDE[e.side].light, 110)
        fx.float(
          ['Blast +1', 'Bombs +1', 'Speed up'][e.kind] ?? '+1',
          e.x,
          e.y - 60,
          C.yellow,
          44,
          e.side,
        )
        break
      case 'death':
        audio.play('explode', 0.7)
        audio.buzz(80)
        fx.burst(e.x, e.y, SIDE[e.side].light, {
          count: 26,
          speed: 420,
          size: 16,
          life: 0.8,
          gravity: 0,
        })
        fx.burst(e.x, e.y, C.yellow, {
          count: 20,
          speed: 700,
          size: 8,
          life: 0.4,
          gravity: 0,
          kind: 'spark',
        })
        fx.ring(e.x, e.y, SIDE[e.side].light, 200)
        fx.float('KO!', e.x, e.y - 70, C.yellow, 64, e.side)
        fx.flash(SIDE[e.side].main, 0.35)
        fx.shake(0.7)
        fx.stop(9)
        break
    }
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    // The guest has no previous step to blend from.
    this.prev.length = 0
  }

  render(g: Draw, alpha: number): void {
    this.look.alpha = alpha
    renderBoard(g, this.s, this.time, { names: this.ctx.names, over: this.over }, this.look)
  }
}

export default () => new Festival()
