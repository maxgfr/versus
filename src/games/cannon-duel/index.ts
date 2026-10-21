import { DragAim } from '../../core/controls.ts'
import { Spring } from '../../core/fx/ease.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { type Side } from '../../core/game.ts'
import { pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { type ShotParams, trace } from '../../engines/aim/index.ts'
import { TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { render } from './render.ts'
import {
  advance,
  BALL,
  cannonOf,
  coreHp,
  CORE_HP,
  type Event,
  fire,
  newState,
  type State,
  winner,
  WIND_MAX,
} from './rules.ts'

const EVERYWHERE = { x: -600, y: -600, w: 2200, h: 3000 }

class CannonDuel extends TurnGame<State> {
  private aims: [DragAim, DragAim] = [
    new DragAim(0, EVERYWHERE, 380),
    new DragAim(1, EVERYWHERE, 380),
  ]
  private recoil: [Spring, Spring] = [new Spring(0, 260, 12), new Spring(0, 260, 12)]
  /** The computer picks its shot when its turn starts, then swings the barrel to it while "thinking". */
  private botShot: ShotParams | null = null

  protected setup(): State {
    // The player whose turn it is may drag anywhere on the table.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    return newState(this.ctx.rng.chance(0.5) ? 0 : 1, this.rollWind())
  }

  private rollWind(): number {
    const rng = this.ctx.rng
    return rng.chance(0.15) ? 0 : rng.range(-WIND_MAX, WIND_MAX)
  }

  protected override busy(): boolean {
    return this.s.phase !== 'aim'
  }

  protected override step(dt: number): void {
    for (const e of advance(this.s, dt, () => this.rollWind())) this.juice(e)
    const w = winner(this.s)
    if (w !== null) {
      this.finish(w, { delay: 1.8 })
      return
    }
    super.step(dt)
  }

  protected stepTurn(): void {
    const side = this.s.turn
    const a = this.aims[side]
    a.update(this.ctx.input.player(side))
    this.s.aiming = a.aim ? { dx: a.aim.dx, dy: a.aim.dy, power: a.aim.power } : null
    if (a.shot) this.shoot(a.shot)
  }

  protected botPlay(): void {
    this.shoot(this.botShot ?? choose(this.s, this.s.turn, this.ctx.difficulty, this.ctx.rng))
    this.botShot = null
  }

  private shoot(shot: ShotParams): void {
    const side = this.s.turn
    fire(this.s, shot)
    for (const a of this.aims) a.cancel()
    const c = cannonOf(side)
    const mx = c.x + shot.dx * 110
    const my = c.y + shot.dy * 110
    this.recoil[side].kick(14)
    this.ctx.audio.play('shoot', 0.8)
    this.ctx.audio.play('thud')
    this.ctx.fx.puff(mx, my, 'rgba(255,255,255,0.8)', 10)
    this.ctx.fx.sparks(mx, my, C.orange, 10)
    this.ctx.fx.shake(0.15)
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    if (e.kind === 'turn') {
      audio.play('tick')
      this.botShot = this.isBot(e.side)
        ? choose(this.s, e.side, this.ctx.difficulty, this.ctx.rng)
        : null
      return
    }
    if (e.kind === 'miss') {
      audio.play('whoosh')
      const shooter = this.s.turn
      floatFor(fx, shooter, 'Missed!')
      return
    }
    const shooter = this.s.turn
    const coreHit = e.direct >= 0 && this.s.blocks[e.direct]?.kind === 'core'
    const big = coreHit || e.destroyed.length > 0
    audio.play('explode', big ? 0.85 : 1.05)
    fx.burst(e.x, e.y, C.orange, {
      count: 26,
      speed: 520,
      size: 18,
      life: 0.5,
      gravity: 0,
      drag: 3,
      colors: [C.orange, C.yellow, '#ff5a1f'],
    })
    fx.puff(e.x, e.y, 'rgba(60,50,60,0.55)', 12)
    fx.ring(e.x, e.y, '#ffd9a0', coreHit ? 220 : 150)
    fx.shake(big ? 0.5 : 0.3)
    fx.stop(big ? 6 : 3)
    if (e.direct < 0)
      fx.burst(e.x, e.y, '#7a5a3a', {
        count: 12,
        speed: 380,
        size: 10,
        life: 0.6,
        gravity: 0,
        drag: 2.5,
        kind: 'square',
      })
    for (const i of e.hit) {
      const b = this.s.blocks[i]
      if (!b) continue
      const stone = b.kind === 'core' ? SIDE[b.side].main : '#8d86a8'
      fx.burst(b.x, b.y, stone, {
        count: e.destroyed.includes(i) ? 18 : 7,
        speed: 460,
        size: 16,
        life: 0.8,
        gravity: 0,
        drag: 2.2,
        kind: 'square',
        colors: [stone, '#6b6585', SIDE[b.side].dark],
      })
    }
    if (coreHit) {
      fx.flash(SIDE[shooter].main, 0.3)
      audio.play('score')
      audio.buzz(40)
      const left = coreHp(this.s, shooter === 0 ? 1 : 0)
      floatFor(fx, shooter, left > 0 ? 'Direct hit!' : 'Keep destroyed!')
    } else if (e.destroyed.length) {
      floatFor(fx, shooter, 'Breach!')
    }
  }

  render(g: Draw): void {
    const s = this.s
    const dt = 1 / 60
    this.recoil[0].update(dt)
    this.recoil[1].update(dt)
    let aim: Parameters<typeof render>[2]['aim'] = null
    if (s.phase === 'aim' && !this.over) {
      const side = s.turn
      const a = s.aiming
      const c = cannonOf(side)
      if (a) {
        aim = { dx: a.dx, dy: a.dy, power: a.power, preview: trace(c.x, c.y, a, BALL, 0, 0.5) }
      } else if (this.isBot(side) && this.botShot) {
        // Swing the barrel toward the planned shot while thinking.
        const k = Math.min(1, this.thinking / 0.5)
        const from = s.aim[side]
        const dx = from.dx + (this.botShot.dx - from.dx) * k
        const dy = from.dy + (this.botShot.dy - from.dy) * k
        aim = { dx, dy, power: this.botShot.power * k, preview: [] }
      }
    }
    render(
      g,
      s,
      {
        aim,
        recoil: [Math.max(0, this.recoil[0].value / 14), Math.max(0, this.recoil[1].value / 14)],
        hint: [0, 1].map(
          (side) =>
            s.phase === 'aim' &&
            s.turn === side &&
            !this.isBot(side as Side) &&
            s.shots[side as Side] === 0 &&
            !s.aiming,
        ) as [boolean, boolean],
      },
      this.time,
    )
    for (const side of [0, 1] as Side[]) {
      this.aims[side].render(g)
      pips(g, side, coreHp(s, side), CORE_HP, { inset: 160 })
    }
    this.drawTurns(g, undefined, s.phase === 'aim')
  }
}

export default () => new CannonDuel()
