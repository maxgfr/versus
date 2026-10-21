import { DragAim } from '../../core/controls.ts'
import { other, type MatchSpec, type Side } from '../../core/game.ts'
import { bigScore } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE } from '../../core/render/palette.ts'
import { W } from '../../core/stage.ts'
import { type ShotParams, trace } from '../../engines/aim/index.ts'
import { TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { render } from './render.ts'
import {
  advance,
  type Event,
  HOLE,
  newState,
  type State,
  THROW,
  TO_WIN,
  TOSS,
  toss,
  winner,
} from './rules.ts'

const EVERYWHERE = { x: -600, y: -600, w: 2200, h: 3000 }

/** Match length: points to win, chosen on the ready screen. */
export const match: MatchSpec = { unit: 'points', default: TO_WIN, min: 3, max: 21 }

class Cornhole extends TurnGame<State> {
  private get target(): number {
    return this.ctx.target || match.default
  }

  private aims: [DragAim, DragAim] = [
    new DragAim(0, EVERYWHERE, 300),
    new DragAim(1, EVERYWHERE, 300),
  ]
  /** The computer picks its throw when its turn starts, then "thinks" for a beat. */
  private botShot: ShotParams | null = null

  protected setup(): State {
    // In local 2P the player whose turn it is may pull anywhere on the table.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    return newState(this.ctx.rng.chance(0.5) ? 0 : 1, this.target)
  }

  protected override busy(): boolean {
    return this.s.phase !== 'aim'
  }

  /** Keep the clock running through the ending so the banners and tweens play. */
  protected override afterEnd(dt: number): void {
    this.s.now += dt
  }

  protected override animate(dt: number): void {
    for (const e of advance(this.s, dt)) this.juice(e)
    if (this.s.phase === 'over' && !this.over) {
      const w = winner(this.s)
      if (w !== null) this.finish(w, { score: [...this.s.score] as [number, number], delay: 1.6 })
    }
  }

  protected stepTurn(): void {
    const side = this.s.turn
    const a = this.aims[side]
    a.update(this.ctx.input.player(side))
    this.s.aiming = a.aim ? { dx: a.aim.dx, dy: a.aim.dy, power: a.aim.power } : null
    if (a.shot) this.throwBag(a.shot)
  }

  protected botPlay(): void {
    this.throwBag(this.botShot ?? choose(this.s, this.s.turn, this.ctx.difficulty, this.ctx.rng))
    this.botShot = null
  }

  private throwBag(shot: ShotParams): void {
    if (!toss(this.s, shot)) return
    for (const a of this.aims) a.cancel()
    const side = this.s.turn
    const o = THROW[side] as { x: number; y: number }
    this.ctx.audio.play('whoosh', 0.9 + shot.power * 0.3)
    this.ctx.fx.puff(o.x + shot.dx * 40, o.y + shot.dy * 40, 'rgba(255,255,255,0.6)', 8)
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    switch (e.kind) {
      case 'turn': {
        audio.play('tick')
        this.botShot = this.isBot(e.side)
          ? choose(this.s, e.side, this.ctx.difficulty, this.ctx.rng)
          : null
        return
      }
      case 'land':
        audio.play('thud', 1)
        audio.play('slide', 1.2)
        fx.puff(e.x, e.y, 'rgba(255,236,200,0.5)', 9)
        fx.burst(e.x, e.y, C.wood, {
          count: 8,
          speed: 260,
          size: 7,
          life: 0.4,
          gravity: 0,
          drag: 3,
          kind: 'square',
          colors: ['#d9a066', C.woodDark],
        })
        fx.shake(0.1)
        return
      case 'table':
        audio.play('thud', 0.7)
        fx.puff(e.x, e.y, 'rgba(120,200,140,0.45)', 8)
        fx.float('Miss', e.x, e.y - 60, alpha(C.white, 0.8), 46, e.side)
        return
      case 'hole':
        audio.play('score', 1.1)
        audio.buzz(30)
        fx.burst(HOLE.x, HOLE.y, C.yellow, {
          count: 28,
          speed: 380,
          size: 14,
          life: 0.7,
          gravity: 420,
          drag: 1.2,
          colors: [C.yellow, C.orange, SIDE[e.side].light],
        })
        fx.burst(HOLE.x, HOLE.y, C.yellow, {
          count: 10,
          speed: 420,
          size: 30,
          life: 0.8,
          gravity: 0,
          drag: 2.2,
          kind: 'emoji',
          glyph: '🌽',
        })
        fx.ring(HOLE.x, HOLE.y, SIDE[e.side].light, 190)
        fx.ring(HOLE.x, HOLE.y, C.yellow, 120)
        fx.flash(SIDE[e.side].main, 0.22)
        fx.shake(0.35)
        fx.stop(5)
        audio.play('swish', 0.8)
        fx.float('Cornhole! +3', HOLE.x, HOLE.y + (e.side === 0 ? 150 : -150), C.yellow, 64, e.side)
        return
      case 'rest':
        audio.play('click', 1.1)
        fx.sparks(e.x, e.y, SIDE[e.side].light, 6)
        fx.float('+1', e.x, e.y + (e.side === 0 ? -80 : 80), SIDE[e.side].light, 52, e.side)
        return
      case 'off':
        audio.play('slide', 0.8)
        fx.puff(e.x, e.y, 'rgba(255,255,255,0.45)', 8)
        fx.float('Off', e.x, e.y - 60, alpha(C.white, 0.8), 46, e.side)
        return
      case 'bump':
        audio.play('hit', 1.2)
        fx.sparks(e.x, e.y, C.white, 8)
        fx.shake(0.1)
        return
      case 'scored': {
        const w = winner(this.s)
        if (e.gain !== null) {
          audio.play('coin')
          audio.play('score', 1 + Math.min(e.amount, 6) * 0.05)
          const edge = this.ctx.stage.edge(e.gain)
          const hud = e.gain === 0 ? edge - 70 : edge + 70
          fx.burst(e.gain === 0 ? 130 : W - 130, hud, C.yellow, {
            count: 18,
            speed: 420,
            size: 12,
            life: 0.6,
            gravity: 0,
            drag: 2.5,
            colors: [C.yellow, SIDE[e.gain].light, C.white],
          })
          fx.flash(SIDE[e.gain].main, 0.15)
        } else audio.play('draw')
        if (w !== null) {
          fx.confetti(w)
          fx.flash(SIDE[w].main, 0.3)
          fx.shake(0.4)
        }
        return
      }
      case 'round':
        audio.play('go', 1.1)
        return
    }
  }

  render(g: Draw): void {
    const s = this.s
    const w = winner(s)
    const decided = w !== null && (s.phase === 'over' || this.over)
    let aim: Parameters<typeof render>[2]['aim'] = null
    if (s.phase === 'aim' && !this.over && s.aiming) {
      const o = THROW[s.turn] as { x: number; y: number }
      aim = {
        dx: s.aiming.dx,
        dy: s.aiming.dy,
        power: s.aiming.power,
        preview: trace(o.x, o.y, s.aiming, TOSS, 0, 0.45),
      }
    }
    const hint: [boolean, boolean] = [false, false]
    for (const side of [0, 1] as Side[]) {
      hint[side] =
        s.phase === 'aim' &&
        s.turn === side &&
        !this.isBot(side) &&
        s.tosses[side] === 0 &&
        !s.aiming &&
        s.round === 1
    }
    const readers: Side[] = g.flipTop ? [0, 1] : [this.ctx.local]
    render(g, s, { aim, hint, readers, winner: decided ? w : null }, this.time)
    for (const side of [0, 1] as Side[]) {
      if (s.phase === 'aim' && s.turn === side) this.aims[side].render(g)
    }
    this.drawTurns(g, undefined, s.phase === 'aim')
    // The match score pops when a round pays out.
    const since = s.now - s.scoredAt
    for (const side of [0, 1] as Side[]) {
      const gained = s.roundPts !== null && s.roundPts[side] > s.roundPts[other(side)]
      const pop = gained && since >= 0 && since < 0.6 ? Math.sin((since / 0.6) * Math.PI) * 0.45 : 0
      bigScore(g, side, s.score[side], { x: side === 0 ? 130 : W - 130, size: 76 * (1 + pop) })
    }
  }
}

export default () => new Cornhole()
