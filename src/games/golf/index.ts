import { DragAim } from '../../core/controls.ts'
import { floatFor } from '../../core/fx/fx.ts'
import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import type { ShotParams } from '../../engines/aim/index.ts'
import { TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { hud, render } from './render.ts'
import {
  advance,
  done,
  holeOf,
  holeStrokes,
  type Event,
  fire,
  type Hit,
  newState,
  previewOf,
  result,
  type State,
  surfaceAt,
  WIND_MAX,
} from './rules.ts'

const EVERYWHERE = { x: -600, y: -600, w: 2200, h: 3000 }
/** The name of a holed hole, judged against its par. */
function parWord(strokes: number, par: number): string {
  if (strokes === 1) return 'Hole in one!'
  const d = strokes - par
  if (d <= -2) return 'Eagle!'
  if (d === -1) return 'Birdie!'
  if (d === 0) return 'Par'
  return d === 1 ? 'Bogey' : 'Double bogey'
}

class Golf extends TurnGame<State> {
  private aims: [DragAim, DragAim] = [
    new DragAim(0, EVERYWHERE, 360, 0.1),
    new DragAim(1, EVERYWHERE, 360, 0.1),
  ]
  /** The computer plans its stroke when its turn starts, then swings toward it while "thinking". */
  private botShot: ShotParams | null = null

  protected setup(): State {
    // The player whose turn it is may pull anywhere on the course.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    return newState(this.ctx.rng, this.ctx.rng.chance(0.5) ? 0 : 1, this.rollWind())
  }

  private rollWind(): number {
    const rng = this.ctx.rng
    return rng.chance(0.2) ? 0 : rng.range(-WIND_MAX, WIND_MAX)
  }

  protected override busy(): boolean {
    return this.s.phase !== 'aim'
  }

  protected override step(dt: number): void {
    for (const e of advance(this.s, dt, () => this.rollWind())) this.juice(e)
    if (done(this.s)) {
      const r = result(this.s)
      this.s.endAt = this.time
      this.finish(r, {
        score: [this.s.strokes[0], this.s.strokes[1]],
        note: 'Fewest strokes wins',
        delay: 2.6,
      })
      const { fx } = this.ctx
      if (r !== 'draw') {
        fx.confetti(r)
        fx.flash(SIDE[r].light, 0.25)
      } else fx.confetti()
      return
    }
    super.step(dt)
  }

  protected stepTurn(): void {
    const side = this.s.turn
    const a = this.aims[side]
    a.update(this.ctx.input.player(side))
    const aim = a.aim
    this.s.aiming = aim ? { dx: aim.dx, dy: aim.dy, power: aim.power } : null
    if (a.shot) this.swing(a.shot)
  }

  protected botPlay(): void {
    this.swing(this.botShot ?? choose(this.s, this.ctx.difficulty, this.ctx.rng))
    this.botShot = null
  }

  private swing(shot: ShotParams): void {
    const s = this.s
    const h = holeOf(s)
    const from = s.rest[s.turn]
    const surface = surfaceAt(h, from.x, from.y)
    fire(s, shot)
    s.swingAt = this.time
    for (const a of this.aims) a.cancel()
    const { fx, audio } = this.ctx
    if (surface === 'green') {
      audio.play('tap', 0.9 + shot.power * 0.3)
      fx.ring(from.x, from.y, C.white, 60)
      return
    }
    audio.play('swish', 0.9 + shot.power * 0.2)
    audio.play('hit', 1.2)
    fx.ring(from.x, from.y, C.white, 70 + 50 * shot.power)
    if (surface === 'sand') {
      fx.burst(from.x, from.y, C.sand, {
        count: 22,
        speed: 360,
        size: 12,
        life: 0.7,
        gravity: 0,
        drag: 3,
        colors: [C.sand, '#e2b96b', C.cream],
        kind: 'square',
      })
    } else {
      // A divot of turf kicked up behind the strike.
      fx.burst(from.x, from.y, C.grass, {
        count: 10,
        speed: 300,
        size: 11,
        life: 0.6,
        gravity: 0,
        drag: 3,
        dir: Math.atan2(-shot.dy, -shot.dx),
        spread: 1.2,
        colors: [C.grass, C.grassDark, '#7a5a3a'],
        kind: 'square',
      })
    }
    fx.shake(0.08 + 0.1 * shot.power)
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const s = this.s
    if (e.kind === 'turn') {
      audio.play('tick')
      this.botShot = this.isBot(e.side) ? choose(s, this.ctx.difficulty, this.ctx.rng) : null
      return
    }
    if (e.kind === 'hole') {
      s.holeAt = this.time
      audio.play('powerup')
      fx.flash(C.ink, 0.7)
      return
    }
    if (e.kind === 'pickup') {
      audio.play('error')
      floatFor(fx, e.side, 'Picked up')
      return
    }
    const h = holeOf(s)
    const hit: Hit = e.hit
    if (hit.kind === 'land') {
      if (hit.surface === 'sand') {
        audio.play('slide')
        fx.burst(hit.x, hit.y, C.sand, {
          count: 18,
          speed: 300,
          size: 13,
          life: 0.7,
          gravity: 0,
          drag: 3,
          colors: [C.sand, '#e2b96b', C.cream],
          kind: 'square',
        })
        floatFor(fx, e.side, 'Bunker!', hit.x, hit.y - 90)
      } else {
        audio.play('thud', hit.surface === 'green' ? 1.2 : hit.surface === 'rough' ? 0.8 : 1)
        fx.puff(hit.x, hit.y, 'rgba(230,255,230,0.55)', hit.surface === 'rough' ? 9 : 6)
        fx.ring(hit.x, hit.y, 'rgba(255,255,255,0.6)', 70)
      }
      fx.shake(0.12)
      return
    }
    if (hit.kind === 'rest') {
      audio.play('click', 0.8)
      if (hit.surface === 'green') floatFor(fx, e.side, 'On the green', hit.x, hit.y - 90)
      return
    }
    if (hit.kind === 'water') {
      audio.play('splash')
      audio.buzz(30)
      fx.burst(hit.x, hit.y, '#cdeeff', {
        count: 24,
        speed: 380,
        size: 10,
        life: 0.8,
        gravity: 0,
        drag: 2.5,
        colors: ['#cdeeff', C.white, C.water],
      })
      fx.ring(hit.x, hit.y, C.white, 150)
      fx.ring(hit.x, hit.y, C.water, 220)
      fx.shake(0.2)
      floatFor(fx, e.side, 'Splash! +1')
      return
    }
    // Holed: judge the stroke count against par.
    s.sunkAt = this.time
    const strokes = holeStrokes(s, e.side)
    const word = parWord(strokes, h.par)
    audio.play('coin', 1.1)
    audio.play('score')
    audio.buzz(40)
    fx.burst(h.cup.x, h.cup.y, C.yellow, {
      count: 30,
      speed: 420,
      size: 12,
      life: 0.9,
      gravity: 0,
      drag: 2.5,
      colors: [C.yellow, C.white, SIDE[e.side].light],
      kind: 'square',
    })
    fx.ring(h.cup.x, h.cup.y, C.yellow, 220)
    fx.shake(0.3)
    fx.stop(5)
    if (strokes <= h.par) {
      fx.confetti(e.side)
      fx.flash(SIDE[e.side].light, 0.22)
    }
    floatFor(fx, e.side, word)
  }

  render(g: Draw): void {
    const s = this.s
    let aim: Parameters<typeof render>[2]['aim'] = null
    if (s.phase === 'aim' && !this.over) {
      const side = s.turn
      const h = holeOf(s)
      const a = s.aiming
      const from = s.rest[side]
      if (a) {
        aim = { dx: a.dx, dy: a.dy, power: a.power, preview: previewOf(h, from, a, s.wind) }
      } else if (this.isBot(side) && this.botShot) {
        // Swing the line toward the planned stroke while thinking.
        const k = Math.min(1, this.thinking / 0.5)
        const shot = this.botShot
        const planned = { dx: shot.dx, dy: shot.dy, power: shot.power * k }
        aim = { ...planned, preview: previewOf(h, from, planned, s.wind) }
      }
    }
    render(
      g,
      s,
      {
        aim,
        hint:
          s.phase === 'aim' &&
          !this.isBot(s.turn) &&
          s.card.length === 0 &&
          s.strokes[0] + s.strokes[1] === 0 &&
          !s.aiming,
      },
      this.time,
    )
    for (const side of [0, 1] as Side[]) this.aims[side].render(g)
    hud(g, s)
    this.drawTurns(g, undefined, s.phase === 'aim')
  }
}

export default () => new Golf()
