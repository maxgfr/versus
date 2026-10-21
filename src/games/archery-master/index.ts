import { DragAim } from '../../core/controls.ts'
import { clamp, outCubic } from '../../core/fx/ease.ts'
import { type Side } from '../../core/game.ts'
import { banner, hudY } from '../../core/hud.ts'
import type { Draw, Mood } from '../../core/render/draw.ts'
import { alpha, C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { type ShotParams, trace } from '../../engines/aim/index.ts'
import { TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { type Look, project, render } from './render.ts'
import {
  advance,
  ARROW,
  type Event,
  GAP0,
  GAP_MAX,
  GAP_STEP,
  LIVES,
  lineY,
  loose,
  newState,
  rollWind,
  type State,
  winner,
} from './rules.ts'

const EVERYWHERE = { x: -600, y: -600, w: 2200, h: 3000 }

class ArcheryMaster extends TurnGame<State> {
  private aims: [DragAim, DragAim] = [
    new DragAim(0, EVERYWHERE, 300),
    new DragAim(1, EVERYWHERE, 300),
  ]
  /** The computer picks its shot when its turn starts, then draws the bow while it "thinks". */
  private botShot: ShotParams | null = null

  protected setup(): State {
    // In local 2P the archer on turn may pull anywhere on the table.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    const starter: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    return newState(starter, rollWind(this.ctx.rng))
  }

  protected override busy(): boolean {
    return this.s.phase !== 'aim'
  }

  /** Keep the clock running through the ending so its tweens play. */
  protected override afterEnd(dt: number): void {
    this.s.now += dt
  }

  protected override animate(dt: number): void {
    for (const e of advance(this.s, dt, this.ctx.rng)) this.juice(e)
    if (this.s.phase === 'over' && !this.over) {
      const s = this.s
      const w =
        winner(s) ?? (s.apples[0] === s.apples[1] ? 'draw' : s.apples[0] > s.apples[1] ? 0 : 1)
      const note =
        s.lives[0] <= 0 || s.lives[1] <= 0
          ? `${s.apples[0]} to ${s.apples[1]} · out of lives`
          : `${s.apples[0]} to ${s.apples[1]} apples`
      this.finish(w, { score: [...s.apples] as [number, number], note, delay: 1.8 })
    }
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
    if (!loose(this.s, shot)) return
    for (const a of this.aims) a.cancel()
    this.ctx.audio.play('swish', 0.9 + shot.power * 0.3)
    this.ctx.audio.play('shoot', 1.3)
    const y = lineY(side, this.s.gap)
    this.ctx.fx.puff(500, y + (side === 0 ? -60 : 60), 'rgba(255,255,255,0.45)', 5)
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    switch (e.kind) {
      case 'turn':
        audio.play('tick')
        this.botShot = this.isBot(e.side)
          ? choose(this.s, e.side, this.ctx.difficulty, this.ctx.rng)
          : null
        return
      case 'loose': {
        const o = lineY(e.side, this.s.gap)
        fx.puff(500, o, 'rgba(255,255,255,0.5)', 6)
        audio.play('whoosh', 1.1)
        return
      }
      case 'shot':
        this.shotJuice(e.side, e.outcome, e.x, e.z)
        return
      case 'round':
        audio.play('go', 1.1)
        audio.play('slide', 0.8)
        return
      case 'over':
        if (e.winner !== 'draw') this.ctx.fx.confetti(e.winner)
        return
    }
  }

  private shotJuice(side: Side, outcome: string, x: number, z: number): void {
    const { fx, audio } = this.ctx
    const at = project(x, MID, z)
    if (outcome === 'apple') {
      audio.play('chomp', 1.1)
      audio.play('score', 1.15)
      audio.buzz(30)
      fx.burst(at.x, at.y, C.red, {
        count: 22,
        speed: 520,
        size: 13,
        life: 0.6,
        gravity: 0,
        drag: 2.4,
        kind: 'square',
        colors: [C.red, '#ffe3b0', C.green, C.white],
      })
      fx.burst(at.x, at.y, C.yellow, {
        count: 8,
        speed: 380,
        size: 30,
        life: 0.8,
        gravity: 0,
        drag: 2,
        kind: 'emoji',
        glyph: '⭐',
      })
      fx.ring(at.x, at.y, SIDE[side].light, 200)
      fx.flash(SIDE[side].main, 0.22)
      fx.shake(0.3)
      fx.stop(6)
      return
    }
    if (outcome === 'dummy') {
      audio.play('thud', 0.8)
      audio.play('boing', 0.9)
      audio.play('error', 0.8)
      audio.buzz(60)
      fx.burst(at.x, at.y, '#e7c97f', {
        count: 18,
        speed: 440,
        size: 10,
        life: 0.7,
        gravity: 0,
        drag: 2.2,
        kind: 'spark',
        colors: ['#e7c97f', '#c9a25a', C.woodDark],
      })
      fx.flash(C.red, 0.18)
      fx.shake(0.45)
      fx.stop(6)
      return
    }
    // A miss: the arrow flies on, the banner says which way it went.
    audio.play(outcome === 'short' ? 'thud' : 'whoosh', outcome === 'short' ? 1.3 : 0.7)
  }

  /** How each archer looks: focused while drawing, beaming after an apple, glum after hitting the dummy. */
  private moods(): [Mood, Mood] {
    const s = this.s
    const out: [Mood, Mood] = ['happy', 'happy']
    for (const side of [0, 1] as Side[]) {
      if (this.over) {
        const w = winner(s)
        out[side] = w === side ? 'grin' : w === null ? 'happy' : 'sad'
      } else if (s.phase === 'aim' && s.turn === side && s.aiming && s.aiming.power > 0.3) {
        out[side] = 'angry'
      } else if (s.phase === 'fly' && s.arrow?.side === side) out[side] = 'wow'
      else if (s.phase === 'result' && s.last?.side === side) {
        out[side] =
          s.last.outcome === 'apple' ? 'grin' : s.last.outcome === 'dummy' ? 'dizzy' : 'sad'
      }
    }
    return out
  }

  render(g: Draw): void {
    const s = this.s
    let aim: Look['aim'] = null
    // The lines step back at a new round: slide them there.
    const since = s.now - s.turnAt
    let gap = s.gap
    if (s.round > 1 && s.turn === s.starter && since < 0.7) {
      const prev = Math.min(GAP_MAX, GAP0 + GAP_STEP * (s.round - 2))
      gap = prev + (s.gap - prev) * outCubic(clamp(since / 0.7, 0, 1))
    }
    if (s.phase === 'aim' && !this.over) {
      if (s.aiming) {
        aim = {
          dx: s.aiming.dx,
          dy: s.aiming.dy,
          power: s.aiming.power,
          preview: trace(500, lineY(s.turn, s.gap), s.aiming, ARROW, s.wind, 0.38, 12),
        }
      } else if (this.isBot(s.turn) && this.botShot) {
        // The computer draws its bow while it thinks.
        const k = Math.min(1, this.thinking / 0.6)
        aim = { ...this.botShot, power: this.botShot.power * k, preview: [] }
      }
    }
    const glow: [number, number] = [0, 0]
    for (const side of [0, 1] as Side[]) {
      if (s.phase === 'aim' && s.turn === side && !this.over) {
        glow[side] = 0.45 + 0.35 * Math.sin(this.time * 5)
      }
    }
    const readers: Side[] = g.flipTop ? [0, 1] : [this.ctx.local]
    const w = this.over
      ? (winner(s) ?? (s.apples[0] === s.apples[1] ? 'draw' : s.apples[0] > s.apples[1] ? 0 : 1))
      : null
    render(g, { ...s, gap }, { aim, glow, readers, winner: w }, this.time, this.moods())
    for (const side of [0, 1] as Side[]) {
      if (s.phase === 'aim' && s.turn === side) this.aims[side].render(g)
    }
    this.drawTurns(g, undefined, s.phase === 'aim')
    for (const side of [0, 1] as Side[]) {
      // Apples as a big figure that pops when it grows; lives as hearts.
      const scored = s.last?.side === side && s.last.outcome === 'apple'
      const t = s.now - s.hitAt
      const pop = scored && t >= 0 && t < 0.5 ? Math.sin((t / 0.5) * Math.PI) * 0.4 : 0
      const x = side === 0 ? 130 : W - 130
      g.forSide(side, x, hudY(g, side), () => {
        g.emoji('🍎', -40, 0, 42)
        g.text(s.apples[side], 26, 4, {
          size: 70 * (1 + pop),
          weight: 700,
          color: SIDE[side].main,
          drop: alpha('#000000', 0.35),
        })
      })
      const hx = side === 0 ? W - 150 : 150
      const hurt = s.last?.side === side && s.last.outcome === 'dummy' && t >= 0 && t < 0.8
      g.forSide(side, hx, hudY(g, side), () => {
        for (let i = 0; i < LIVES; i++) {
          const px = (i - (LIVES - 1) / 2) * 50
          if (i < s.lives[side]) g.emoji('❤️', px, 0, 40)
          else if (hurt && i === s.lives[side])
            g.emoji(
              '💔',
              px + Math.sin(t * 60) * 4 * (1 - t / 0.8),
              0,
              40 * (1 + 0.4 * (1 - t / 0.8)),
            )
          else g.alpha(0.25, () => g.emoji('🤍', px, 0, 34))
        }
      })
    }
    if (this.time < 8 && s.round === 1 && s.apples[0] + s.apples[1] === 0 && !this.over) {
      for (const side of [0, 1] as Side[]) {
        if (this.isBot(side) || s.turn !== side || s.phase !== 'aim' || s.aiming) continue
        banner(g, side, 'Pull back to aim, let go to shoot', side === 0 ? MID + 175 : MID - 175, {
          size: 36,
          alpha: 0.75 + 0.25 * Math.sin(this.time * 4),
        })
      }
    }
  }
}

export default () => new ArcheryMaster()
