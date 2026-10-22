import { floatFor } from '../../core/fx/fx.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { namePill } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C } from '../../core/render/palette.ts'
import { Bot } from './bot.ts'
import { drawClock, drawScore, drawTimeUp, render } from './render.ts'
import {
  type Aim,
  advance,
  type Event,
  leader,
  MATCH,
  newState,
  PIERCE,
  type Preview,
  type State,
} from './rules.ts'

/** Swipes shorter than this are taps, not throws. */
const MIN_SWIPE = 40

/** Seconds the match lasts; the players pick it on the ready screen. */
export const match: MatchSpec = { unit: 'seconds', default: MATCH, min: 15, max: 180, step: 15 }

type Game = State & { endAt: number }

class ShurikenBamboo extends BaseGame<Game> {
  private bots: [Bot | null, Bot | null] = [null, null]

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): Game {
    const rng = this.ctx.rng
    this.bots = [0, 1].map((side) =>
      this.isBot(side as Side) ? new Bot(this.ctx.difficulty, rng.fork()) : null,
    ) as [Bot | null, Bot | null]
    return { ...newState(rng, this.target), endAt: -1 }
  }

  protected step(dt: number): void {
    const aims: [Aim | null, Aim | null] = [null, null]
    for (const side of [0, 1] as Side[]) {
      const bot = this.bots[side]
      const pi = this.ctx.input.player(side)
      if (bot) {
        aims[side] = bot.tick(this.s, side, dt)
        this.s.aiming[side] = null
        continue
      }
      aims[side] = swipeOf(pi.ups, this.time, dt)
      this.s.aiming[side] = previewOf(pi.held.values(), dt)
    }
    for (const e of advance(this.s, dt, aims, this.ctx.rng)) this.juice(e)
    if (this.s.left <= 0) {
      const { fx, audio } = this.ctx
      const w = leader(this.s)
      this.s.endAt = this.time
      this.s.aiming = [null, null]
      audio.play('buzz', 0.7)
      audio.buzz(60)
      fx.flash(C.white, 0.3)
      fx.shake(0.3)
      if (w !== null) fx.confetti(w)
      this.finish(w ?? 'draw', {
        score: [this.s.score[0], this.s.score[1]],
        note: w === null ? 'Even' : `${w === 0 ? 'Red' : 'Blue'} cut the most bamboo`,
        delay: 2.4,
      })
    }
  }

  protected override afterEnd(dt: number): void {
    // Let the last tops finish falling.
    const s = this.s
    s.t += dt
    for (let i = s.fallen.length - 1; i >= 0; i--) {
      const f = s.fallen[i]
      if (!f) continue
      f.t += dt
      if (f.t > 0.9) s.fallen.splice(i, 1)
    }
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    switch (e.kind) {
      case 'throw': {
        // The flick's force drives the sound, the dust and the buzz.
        const k = e.power
        audio.play('swish', 0.85 + k * 0.5)
        audio.play('whoosh', 1.3 + k * 0.5)
        fx.puff(e.x, e.y - 30, 'rgba(255,255,255,0.4)', Math.round(3 + k * 5))
        if (k >= PIERCE) {
          fx.ring(e.x, e.y - 40, C.yellow, 110)
          audio.buzz(14)
        }
        return
      }
      case 'slice': {
        if (e.combo > 1) {
          // Two stalks with one star.
          audio.play('powerup', 1.2)
          fx.float('Double!', e.x, e.y - 140, C.yellow, 64, e.side)
          fx.ring(e.x, e.y - 33, C.yellow, 260)
          fx.shake(0.3)
          fx.stop(4)
        }
        if (e.gold) {
          audio.play('coin', 1.05)
          audio.play('powerup', 1)
          audio.buzz(30)
          fx.burst(e.x, e.y, C.yellow, {
            count: 26,
            speed: 560,
            size: 14,
            life: 0.7,
            gravity: 260,
            drag: 2,
            kind: 'square',
            colors: [C.yellow, C.white, C.orange],
          })
          fx.sparks(e.x, e.y, C.yellow, 14)
          fx.ring(e.x, e.y - 33, C.yellow, 220)
          fx.flash(C.yellow, 0.18)
          fx.shake(0.35)
          fx.stop(5)
          fx.float(`+${e.points}`, e.x, e.y - 60, C.yellow, 84, e.side)
          return
        }
        const k = Math.max(0, Math.min(1, e.power))
        audio.play('slap', 1 + k * 0.3)
        audio.play('chomp', 1.2 + k * 0.2)
        audio.buzz(Math.round(10 + k * 14))
        fx.burst(e.x, e.y - 33, '#7fdc78', {
          count: 5,
          speed: 300,
          size: 30,
          life: 0.8,
          gravity: 300,
          drag: 2,
          kind: 'emoji',
          glyph: '🍃',
        })
        fx.burst(e.x, e.y, C.green, {
          count: 16,
          speed: 480,
          size: 13,
          life: 0.6,
          gravity: 420,
          drag: 2,
          kind: 'square',
          colors: [C.green, '#b9f5c9', C.grassDark],
        })
        fx.sparks(e.x, e.y - 33, '#ffffff', Math.round(6 + k * 10))
        fx.shake(0.12 + k * 0.16)
        fx.stop(Math.round(2 + k * 2))
        floatFor(fx, e.side, `+${e.points}`, e.x, e.y - 60)
        return
      }
      case 'miss':
        audio.play('whoosh', 1.4)
        return
      case 'rush':
        audio.play('powerup', 0.85)
        audio.buzz(25)
        fx.flash(C.yellow, 0.12)
        for (const side of [0, 1] as Side[]) floatFor(fx, side, 'Bamboo rush!')
        return
      case 'tick':
        audio.play(e.left <= 3 ? 'count' : 'tick', e.left <= 3 ? 1.2 : 1)
        return
    }
  }

  render(g: Draw, alpha: number): void {
    const s = this.s
    render(g, s, this.time, s.endAt, [!this.isBot(0), !this.isBot(1)], (1 - alpha) / 60)
    const w = s.left <= 0 ? leader(s) : null
    for (const side of [0, 1] as Side[]) {
      namePill(g, side, this.ctx.names[side], { active: w === side })
      // The score pops when this side's latest cut lands.
      let last = -9
      for (const f of s.fallen) if (f.side === side) last = Math.max(last, s.t - f.t)
      drawScore(g, s, side, w === side, last, this.time)
    }
    if (s.left > 0) for (const side of [0, 1] as Side[]) drawClock(g, side, s.left, this.time)
    drawTimeUp(g, s.endAt >= 0 ? this.time - s.endAt : 0)
  }
}

/**
 * How hard a swipe is (0..1), from the finger's speed in world units per
 * second: the whole swipe's average, or its last step when it snaps at the end.
 */
function powerOf(len: number, duration: number, last: number): number {
  const v = Math.max(len / Math.max(0.04, duration), last * 0.8)
  return Math.max(0, Math.min(1, (v - 500) / 2500))
}

/** The throw a player's finished swipe makes, if it was long enough. */
function swipeOf(ups: readonly Ptr[], now: number, dt: number): Aim | null {
  for (const p of ups) {
    const dx = p.x - p.x0
    const dy = p.y - p.y0
    const len = Math.hypot(dx, dy)
    if (len < MIN_SWIPE) continue
    const last = Math.hypot(p.x - p.px, p.y - p.py) / dt
    return { x: p.x0, dx: dx / len, dy: dy / len, power: powerOf(len, now - p.t0, last) }
  }
  return null
}

/** The throw a held swipe would make right now, for the dotted preview. */
function previewOf(held: Iterable<Ptr>, dt: number): Preview | null {
  for (const p of held) {
    const dx = p.x - p.x0
    const dy = p.y - p.y0
    const len = Math.hypot(dx, dy)
    if (len < MIN_SWIPE / 2) continue
    const last = Math.hypot(p.x - p.px, p.y - p.py) / dt
    return {
      x: p.x0,
      dx: dx / len,
      dy: dy / len,
      power: Math.max(0, Math.min(1, (last * 0.8 - 500) / 2500)),
    }
  }
  return null
}

export default () => new ShurikenBamboo()
