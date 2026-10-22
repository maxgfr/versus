import { DragAim } from '../../core/controls.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import { floatFor } from '../../core/fx/fx.ts'
import type { MatchSpec, Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import type { ShotParams } from '../../engines/aim/index.ts'
import { TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { hud, render } from './render.ts'
import {
  advance,
  done,
  HOLES,
  holeOf,
  holeStrokes,
  type Event,
  fire,
  type Hit,
  newState,
  previewOf,
  result,
  resultNote,
  type State,
  surfaceAt,
  WIND_MAX,
  windScale,
} from './rules.ts'

/** Holes in the course: the match length, in holes. */
export const match: MatchSpec = { unit: 'rounds', default: HOLES, min: 1, max: 6 }

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
  private get target(): number {
    return this.ctx.target || match.default
  }

  private aims: [DragAim, DragAim] = [
    new DragAim(0, EVERYWHERE, 360, 0.1),
    new DragAim(1, EVERYWHERE, 360, 0.1),
  ]
  /** The computer plans its stroke when its turn starts, then swings toward it while "thinking". */
  private botShot: ShotParams | null = null
  // Cosmetic only (not synced): the moving ball's previous step, score pulses, the last landing.
  private prev: { x: number; y: number; z: number } | null = null
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]
  private landAt = -10
  /** Quarter of the pull reached so far, for the rising tension clicks. */
  private notch = 0

  protected setup(): State {
    // The player whose turn it is may pull anywhere on the course.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    return newState(this.ctx.rng, this.ctx.rng.chance(0.5) ? 0 : 1, this.rollWind(0), this.target)
  }

  /** The wind builds over the course: gentle on the first hole, full strength on the last. */
  private rollWind(hole = this.s.hole): number {
    const rng = this.ctx.rng
    const max = WIND_MAX * windScale(hole, this.target)
    return rng.chance(0.2) ? 0 : rng.range(-max, max)
  }

  protected override busy(): boolean {
    return this.s.phase !== 'aim'
  }

  protected override step(dt: number): void {
    const b = this.s.phase === 'fly' ? this.s.balls[this.s.turn] : null
    this.prev = b ? { x: b.x, y: b.y, z: b.z } : null
    for (const e of advance(this.s, dt, () => this.rollWind())) this.juice(e)
    if (done(this.s)) {
      const r = result(this.s)
      this.s.endAt = this.time
      this.finish(r, {
        score: [this.s.strokes[0], this.s.strokes[1]],
        note: resultNote(this.s),
        delay: 2.6,
      })
      const { fx } = this.ctx
      if (r !== 'draw') {
        fx.confetti(r)
        fx.flash(SIDE[r].light, 0.3)
        fx.shake(0.3)
        this.pulse[r].kick(16)
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
    // The backswing ticks a little higher at every quarter of the pull.
    const notch = aim ? Math.floor(aim.power * 4) : 0
    if (notch > this.notch) {
      this.ctx.audio.play('tick', 0.85 + notch * 0.2)
      this.ctx.audio.buzz(3 + notch * 2)
    }
    this.notch = notch
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
    this.notch = 0
    for (const a of this.aims) a.cancel()
    const { fx, audio } = this.ctx
    const k = shot.power
    if (surface === 'green') {
      audio.play('tap', 0.9 + k * 0.3)
      audio.buzz(Math.round(4 + 6 * k))
      fx.ring(from.x, from.y, C.white, 40 + 40 * k)
      return
    }
    // A full swing cracks: higher swish, harder click, a buzz in the hand.
    audio.play('swish', 0.85 + k * 0.35)
    audio.play('hit', 1 + k * 0.4)
    audio.buzz(Math.round(8 + 18 * k))
    fx.ring(from.x, from.y, C.white, 50 + 80 * k)
    if (k > 0.85) fx.stop(2)
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
        count: Math.round(5 + 10 * k),
        speed: 200 + 200 * k,
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
      this.landAt = this.time
      // How hard it comes down: deeper thud, more turf, more shake.
      const k = Math.min(1, (hit.speed ?? 500) / 800)
      audio.buzz(Math.round(4 + 12 * k))
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
        const base = hit.surface === 'green' ? 1.2 : hit.surface === 'rough' ? 0.8 : 1
        audio.play('thud', base + 0.25 - k * 0.3)
        fx.puff(
          hit.x,
          hit.y,
          'rgba(230,255,230,0.55)',
          Math.round((hit.surface === 'rough' ? 6 : 3) + 5 * k),
        )
        fx.ring(hit.x, hit.y, 'rgba(255,255,255,0.6)', 40 + 50 * k)
      }
      fx.shake(0.04 + 0.12 * k)
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
    this.pulse[e.side].kick(10)
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

  render(g: Draw, frac: number): void {
    const s = this.s
    for (const p of this.pulse) p.update(1 / 60)
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
    // The moving ball drawn between steps.
    const p = this.prev
    const side = s.turn
    const cur = s.balls[side]
    const view =
      p && s.phase === 'fly' && !this.over
        ? {
            ...s,
            balls: (side === 0
              ? [
                  {
                    ...cur,
                    x: lerp(p.x, cur.x, frac),
                    y: lerp(p.y, cur.y, frac),
                    z: lerp(p.z, cur.z, frac),
                  },
                  s.balls[1],
                ]
              : [
                  s.balls[0],
                  {
                    ...cur,
                    x: lerp(p.x, cur.x, frac),
                    y: lerp(p.y, cur.y, frac),
                    z: lerp(p.z, cur.z, frac),
                  },
                ]) as State['balls'],
          }
        : s
    render(
      g,
      view,
      {
        aim,
        // Each human gets the hint before their own first stroke, not only whoever tees off first.
        hint:
          s.phase === 'aim' &&
          !this.isBot(s.turn) &&
          s.card.length === 0 &&
          s.strokes[s.turn] === 0 &&
          !s.aiming,
        land: this.time - this.landAt,
      },
      this.time,
    )
    for (const sd of [0, 1] as Side[]) {
      // Online, each phone shows only its own player's drag band.
      if (g.viewer === null || sd === g.viewer) this.aims[sd].render(g)
    }
    hud(g, s, [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)])
    this.drawTurns(g, undefined, s.phase === 'aim')
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
    this.notch = 0
  }
}

export default () => new Golf()
