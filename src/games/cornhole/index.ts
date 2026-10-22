import { DragAim } from '../../core/controls.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
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
  // Cosmetic only (not synced): previous bag positions for interpolation, the board's thump.
  private prev: { x: number; y: number; z: number }[] = []
  private thump = new Spring(0, 300, 10)
  /** Quarter of the pull reached so far, for the rising tension clicks. */
  private notch = 0

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
    const bags = this.s.bags
    this.prev.length = bags.length
    for (let i = 0; i < bags.length; i++) {
      const b = bags[i] as (typeof bags)[number]
      const p = this.prev[i] ?? { x: 0, y: 0, z: 0 }
      p.x = b.x
      p.y = b.y
      p.z = b.z
      this.prev[i] = p
    }
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
    // A click that climbs in pitch at every quarter of the pull.
    const notch = a.aim ? Math.floor(a.aim.power * 4) : 0
    if (notch > this.notch) {
      this.ctx.audio.play('tick', 0.85 + notch * 0.2)
      this.ctx.audio.buzz(3 + notch * 2)
    }
    this.notch = notch
    if (a.shot) this.throwBag(a.shot)
  }

  protected botPlay(): void {
    this.throwBag(this.botShot ?? choose(this.s, this.s.turn, this.ctx.difficulty, this.ctx.rng))
    this.botShot = null
  }

  private throwBag(shot: ShotParams): void {
    if (!toss(this.s, shot)) return
    for (const a of this.aims) a.cancel()
    this.notch = 0
    const side = this.s.turn
    const o = THROW[side] as { x: number; y: number }
    const k = shot.power
    this.ctx.audio.play('whoosh', 0.8 + k * 0.5)
    this.ctx.audio.buzz(Math.round(5 + 12 * k))
    this.ctx.fx.puff(
      o.x + shot.dx * 40,
      o.y + shot.dy * 40,
      'rgba(255,255,255,0.6)',
      Math.round(4 + 8 * k),
    )
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
      case 'land': {
        // The harder the bag comes down, the deeper the thud and the more the board jumps.
        const k = Math.min(1, e.speed / 1100)
        audio.play('thud', 1.2 - k * 0.4)
        audio.play('slide', 1.2)
        audio.buzz(Math.round(6 + 16 * k))
        this.thump.kick(3 + 9 * k)
        fx.puff(e.x, e.y, 'rgba(255,236,200,0.5)', Math.round(5 + 8 * k))
        fx.burst(e.x, e.y, C.wood, {
          count: Math.round(4 + 10 * k),
          speed: 160 + 220 * k,
          size: 7,
          life: 0.4,
          gravity: 0,
          drag: 3,
          kind: 'square',
          colors: ['#d9a066', C.woodDark],
        })
        fx.shake(0.04 + 0.14 * k)
        return
      }
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
      case 'bump': {
        const k = Math.min(1, e.speed / 300)
        audio.play('hit', 0.9 + 0.5 * k)
        fx.sparks(e.x, e.y, C.white, Math.round(3 + 9 * k))
        fx.shake(0.03 + 0.12 * k)
        if (k > 0.5) audio.buzz(8)
        return
      }
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
          fx.flash(SIDE[w].main, 0.35)
          fx.shake(0.5)
          fx.stop(8)
          fx.ring(HOLE.x, HOLE.y, SIDE[w].light, 420)
        }
        return
      }
      case 'round':
        audio.play('go', 1.1)
        return
    }
  }

  render(g: Draw, frac: number): void {
    const s = this.s
    this.thump.update(1 / 60)
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
    // Bags drawn between steps while anything moves.
    const prev = this.prev
    const moving = s.phase === 'fly' && prev.length === s.bags.length && !this.over
    const view = moving
      ? {
          ...s,
          bags: s.bags.map((b, i) => {
            const p = prev[i]
            return p
              ? { ...b, x: lerp(p.x, b.x, frac), y: lerp(p.y, b.y, frac), z: lerp(p.z, b.z, frac) }
              : b
          }),
        }
      : s
    render(
      g,
      view,
      { aim, hint, readers, winner: decided ? w : null, thump: this.thump.value },
      this.time,
    )
    for (const side of [0, 1] as Side[]) {
      // Online, each phone shows only its own player's drag band.
      if (g.viewer !== null && side !== g.viewer) continue
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

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev.length = 0
    this.notch = 0
  }
}

export default () => new Cornhole()
