import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { banner, bigScore, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, shade, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { aimPoint, bestTarget, pickTarget, reaction } from './bot.ts'
import { render } from './render.ts'
import { advance, BOW, type Event, fire, leader, newState, type State, TIME } from './rules.ts'

const BALLOONS = [C.pink, C.cyan, C.purple, C.orange, C.green]

/** Match length: seconds on the clock, chosen on the ready screen. */
export const match: MatchSpec = { unit: 'seconds', default: TIME, min: 15, max: 180, step: 15 }

/** m:ss for the clock, so a 3-minute match reads 3:00. */
const clockText = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

class TargetPractice extends BaseGame<State> {
  /** Seconds until each computer player notices a target and taps it. */
  private botWait: [number, number] = [0, 0]
  private lastTick = -1

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    this.botWait = [this.reactionFor(0), this.reactionFor(1)]
    return newState(this.target)
  }

  private reactionFor(side: Side): number {
    return this.isBot(side) ? reaction(this.ctx.difficulty, this.ctx.rng) : 0
  }

  protected step(dt: number): void {
    const s = this.s
    // Humans: every tap on a target loads a bolt from their crossbow.
    for (const side of [0, 1] as Side[]) {
      if (this.isBot(side)) continue
      for (const p of this.ctx.input.player(side).downs) {
        if (fire(s, side, p.x, p.y)) this.onFire(side, p.x, p.y)
      }
    }
    for (const side of [0, 1] as Side[]) if (this.isBot(side)) this.botThink(side, dt)
    for (const e of advance(s, dt, this.ctx.rng)) this.juice(e)
    const sec = Math.ceil(s.left)
    if (sec !== this.lastTick && sec <= 5 && sec > 0) {
      this.lastTick = sec
      this.ctx.audio.play('tick', 1.2)
    }
    if (s.ended && !this.over) {
      this.finish(leader(s), {
        score: [...s.score] as [number, number],
        note: `${s.hits[0]} hits to ${s.hits[1]}`,
        delay: 1.6,
      })
    }
  }

  /** The computer: after its reaction time, tap the nearest target it is not already shooting. */
  private botThink(side: Side, dt: number): void {
    if (this.s.reload[side] > 0 || this.s.left <= 0) return
    this.botWait[side] -= dt
    if (this.botWait[side] > 0) return
    // Easy shoots whatever is nearest; normal and hard pick the most valuable open target.
    const t = this.ctx.difficulty === 'easy' ? pickTarget(this.s, side) : bestTarget(this.s, side)
    if (!t) {
      this.botWait[side] = 0.1
      return
    }
    const p = aimPoint(t, this.ctx.difficulty, this.ctx.rng)
    if (fire(this.s, side, p.x, p.y)) this.onFire(side, p.x, p.y)
    this.botWait[side] = reaction(this.ctx.difficulty, this.ctx.rng)
  }

  private onFire(side: Side, _x: number, _y: number): void {
    const bow = BOW[side] as { x: number; y: number }
    const a = this.s.aim[side]
    this.ctx.audio.play('shoot', 1.05 + this.ctx.rng.range(0, 0.1))
    this.ctx.fx.puff(
      bow.x + Math.cos(a) * 150,
      bow.y + Math.sin(a) * 150,
      'rgba(255,255,255,0.5)',
      4,
    )
  }

  /** The clock has stopped: keep the marks fading while the ending plays. */
  protected override afterEnd(dt: number): void {
    advance(this.s, dt, this.ctx.rng)
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    switch (e.kind) {
      case 'spawn':
        fx.puff(e.target.x, e.target.y, 'rgba(255,255,255,0.35)', 5)
        return
      case 'expire':
        fx.puff(e.target.x, e.target.y, 'rgba(180,190,210,0.35)', 6)
        return
      case 'hit': {
        const { target: t } = e
        const col =
          t.kind === 'bull' ? C.red : t.kind === 'can' ? C.green : (BALLOONS[t.id % 5] ?? C.pink)
        const up = e.side === 0 ? -1 : 1
        if (t.kind === 'balloon') {
          audio.play('pop', 1.1)
          if (e.bonus) audio.play('powerup', 1.1)
          fx.burst(t.x, t.y, col, {
            count: 22,
            speed: 520,
            size: 12,
            life: 0.5,
            gravity: 0,
            drag: 3,
            kind: 'square',
            colors: [col, shade(col, -0.3), C.white],
          })
        } else if (t.kind === 'can') {
          audio.play('hit', 1.3)
          audio.play('coin', 1.2)
          fx.sparks(t.x, t.y, C.white, 14)
        } else {
          audio.play('thud', 1.1)
          audio.play('score', 1.1)
          fx.burst(t.x, t.y, '#e9c47e', {
            count: 18,
            speed: 420,
            size: 9,
            life: 0.6,
            gravity: 0,
            drag: 2.5,
            kind: 'spark',
            colors: ['#e9c47e', C.yellow, C.white],
          })
        }
        // Accuracy and a run of hits both turn the feedback up.
        const k = Math.min(1, e.acc * 0.6 + Math.min(1, (e.streak - 1) / 6) * 0.4)
        fx.ring(t.x, t.y, SIDE[e.side].light, t.r * (2.2 + k))
        fx.shake((t.kind === 'bull' ? 0.18 : 0.1) + k * 0.15)
        fx.stop(Math.round((t.kind === 'bull' ? 3 : 2) + k * 3))
        audio.buzz(Math.round(10 + k * 20))
        if (t.kind === 'bull' && e.acc > 0.75) {
          audio.play('powerup', 1.3)
          fx.sparks(t.x, t.y, C.yellow, 16)
          fx.float('Bullseye!', t.x, t.y - up * (t.r + 40), C.yellow, 56, e.side)
        }
        if (e.streak >= 3 && e.streak % 3 === 0)
          fx.float(`${e.streak} in a row!`, t.x, t.y + up * (t.r + 170), C.white, 44, e.side)
        fx.float(
          `+${e.pts}`,
          t.x,
          t.y + up * (t.r + 40),
          SIDE[e.side].light,
          e.pts >= 3 ? 76 : 62,
          e.side,
        )
        if (e.bonus) fx.float('Bonus!', t.x, t.y + up * (t.r + 110), C.yellow, 50, e.side)
        return
      }
      case 'late':
        audio.play('thud', 1.4)
        fx.puff(e.x, e.y, 'rgba(255,255,255,0.4)', 5)
        fx.float('Too late', e.x, e.y + (e.side === 0 ? -60 : 60), alpha(C.white, 0.8), 42, e.side)
        return
      case 'end': {
        audio.play('buzz', 1)
        const w = leader(this.s)
        if (w !== 'draw') fx.confetti(w)
        fx.flash(C.white, 0.25)
        fx.shake(0.3)
        return
      }
    }
  }

  render(g: Draw): void {
    const s = this.s
    render(g, s)
    for (const side of [0, 1] as Side[]) {
      namePill(g, side, this.ctx.names[side], { active: this.over && leader(s) === side })
      // The score pops on every hit.
      const last = s.pops.filter((p) => p.side === side).reduce((m, p) => Math.max(m, p.at), -9)
      const since = s.now - last
      const pop = since >= 0 && since < 0.4 ? Math.sin((since / 0.4) * Math.PI) * 0.35 : 0
      bigScore(g, side, s.score[side], { x: side === 0 ? 130 : W - 130, size: 76 * (1 + pop) })
    }
    const readers: Side[] = g.flipTop ? [0, 1] : [this.ctx.local]
    // The clock sits in each reader's HUD row, clear of the targets.
    for (const side of readers) {
      const sec = Math.max(0, Math.ceil(s.left))
      const urgent = sec <= 10 && !s.ended
      const beat = urgent ? 1 + 0.12 * Math.max(0, Math.sin((s.left % 1) * Math.PI)) : 1
      g.forSide(side, side === 0 ? W - 140 : 140, hudY(g, side), () =>
        g.at(
          0,
          0,
          0,
          () => {
            g.rrect(-92, -38, 184, 76, 26, urgent ? alpha(C.yellow, 0.95) : alpha(C.ink, 0.75))
            g.text(clockText(sec), 0, 3, {
              size: 46,
              weight: 700,
              color: urgent ? C.ink : C.white,
            })
          },
          beat,
        ),
      )
    }
    if (s.ended) {
      const w = leader(s)
      for (const side of readers) {
        const text = w === 'draw' ? 'Time! Draw' : w === side ? 'Time! You win' : 'Time!'
        banner(g, side, text, side === 0 ? MID + 120 : MID - 120, {
          size: 64,
          color: w === side ? C.yellow : C.white,
        })
      }
    } else if (this.time < 6) {
      for (const side of [0, 1] as Side[]) {
        if (this.isBot(side) || (g.viewer !== null && side !== g.viewer)) continue
        banner(g, side, 'Tap a target to shoot it', side === 0 ? MID + 150 : MID - 150, {
          size: 38,
          alpha: Math.min(1, (6 - this.time) * 2),
        })
      }
    }
  }
}

export default () => new TargetPractice()
