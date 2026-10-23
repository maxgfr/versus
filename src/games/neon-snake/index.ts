import { Joystick } from '../../core/controls.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { roundEnd, roundsNew, roundsStep, type Rounds } from '../../engines/reflex/index.ts'
import { NeonBot } from './bot.ts'
import { renderNeon, type StickLook } from './render.ts'
import {
  type Board,
  cellCentre,
  COUNT,
  dirOf,
  type Ev,
  newBoard,
  RAMP,
  TICK,
  tempoOf,
  tick,
  tickLen,
  want,
} from './rules.ts'

export interface State {
  b: Board
  rounds: Rounds
  /** Stick visuals, so the online guest can draw them. */
  ctl: StickLook[]
  /** When each snake last ate (s), for the bulge that travels down its body. */
  eatT: [number, number]
  /** Tick-rate multiplier set by the computer's level (1 without a bot), fixed at setup. */
  tempo: number
}

/** Round wins to take the match (best of three by default). */
export const match: MatchSpec = { unit: 'wins', default: 2, min: 1, max: 5 }

/** Seconds between rounds, while the banner shows. */
const PAUSE = 2.2
/** Stick radius (world units). */
const STICK_R = 110
/** A finger that has moved this far (world units) from its anchor has swiped. */
const SWIPE = 56
/** Stick deflection needed to turn (0..1). */
const STICK_TURN = 0.4
/** Speed-up call-outs: a third, two thirds and all of the ramp. */
const LEVELS = 3

/** Keeps a floating label of half-width `half` inside the stage (x, world units). */
const keepInside = (x: number, half: number): number => Math.min(W - half, Math.max(half, x))

class NeonSnake extends BaseGame<State> {
  private sticks: Joystick[] = []
  private anchor: ({ x: number; y: number } | null)[] = [null, null]
  private bots: (NeonBot | null)[] = []
  private ev: Ev[] = []
  private beat = -1
  private went = false
  private level = 0

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    // Human touches: each half in local 2P; the whole table otherwise (1P, online).
    this.sticks = ([0, 1] as const).map((side) => {
      const zone =
        ctx.mode === '2p'
          ? { x: 0, y: side === 0 ? MID : 0, w: W, h: MID }
          : { x: 0, y: 0, w: W, h: H }
      return new Joystick(side, zone, STICK_R, W / 2, side === 0 ? MID + 420 : MID - 420)
    })
    this.bots = ([0, 1] as const).map((side) =>
      ctx.bots[side] ? NeonBot.of(ctx.rng.fork(), ctx.difficulty) : null,
    )
    // The shell has just counted down: the first round starts at once.
    const b = newBoard(this.time - COUNT, ctx.rng)
    return {
      b,
      rounds: roundsNew(this.target),
      ctl: this.looks(),
      eatT: [-9, -9],
      tempo: tempoOf(ctx.difficulty, ctx.bots),
    }
  }

  private looks(): StickLook[] {
    return this.sticks.map((k, i) => ({
      side: i === 0 ? 0 : 1,
      on: k.active && !this.bots[i],
      bx: k.baseX,
      by: k.baseY,
      kx: k.knobX,
      ky: k.knobY,
      r: k.radius,
    }))
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    if (roundsStep(s.rounds, this.time, PAUSE)) {
      s.b = newBoard(this.time, ctx.rng)
      // At match point the snakes start a third of the way up the speed ramp.
      if (Math.max(...s.rounds.wins) >= this.target - 1) s.b.boost = RAMP / LEVELS
      s.eatT = [-9, -9]
      this.went = false
      this.level = 0
      ctx.audio.play('whoosh')
      return
    }
    // A tick on each 3-2-1 of the in-round countdown (rounds after the first).
    const e = this.time - s.rounds.at
    if (s.rounds.phase === 'play' && s.rounds.round > 1 && e >= 0.8 && e < COUNT - 0.4) {
      const n = Math.floor((e - 0.8) / 0.4)
      if (n !== this.beat) {
        this.beat = n
        ctx.audio.play('count')
      }
    } else this.beat = -1
    const playing = s.rounds.phase === 'play'
    for (const side of [0, 1] as const) {
      const snake = s.b.snakes[side]
      const stick = this.sticks[side]
      if (!stick) continue
      if (this.bots[side]) {
        stick.set(0, 0)
        continue
      }
      const inp = ctx.input.player(side)
      stick.update(inp)
      if (playing && stick.mag >= STICK_TURN) want(snake, dirOf(stick.x, stick.y))
      // A swipe: the first held finger that has travelled far enough from its anchor.
      for (const p of inp.downs) this.anchor[side] = { x: p.x, y: p.y }
      const held = inp.first()
      const a = this.anchor[side]
      if (playing && held && a) {
        const dx = held.x - a.x
        const dy = held.y - a.y
        if (dx * dx + dy * dy >= SWIPE * SWIPE) {
          want(snake, dirOf(dx, dy))
          this.anchor[side] = { x: held.x, y: held.y }
        }
      }
    }
    const started = playing && this.time >= s.b.go
    if (started && !this.went) {
      this.went = true
      if (s.rounds.round > 1) ctx.audio.play('go')
    }
    this.ev.length = 0
    if (started) {
      // The longer the round, the faster the snakes: no round drags on.
      const into = this.time - s.b.go + (s.b.boost ?? 0)
      s.b.len = tickLen(into, s.tempo)
      const level = Math.min(LEVELS, Math.floor((into / RAMP) * LEVELS + 1e-9))
      if (level > this.level) {
        this.level = level
        this.speedUp(level)
      }
      s.b.acc += dt
      let winner: Side | 'draw' | null = null
      while (s.b.acc >= s.b.len && winner === null) {
        s.b.acc -= s.b.len
        for (const side of [0, 1] as const) {
          const bot = this.bots[side]
          if (!bot) continue
          const d = bot.choose(s.b, side)
          const snake = s.b.snakes[side]
          if (d !== null) want(snake, d)
        }
        winner = tick(s.b, this.time, this.ev, ctx.rng)
      }
      for (const e of this.ev) this.juice(e)
      if (winner !== null) this.roundOver(winner)
    }
    s.ctl = this.looks()
  }

  /** The round just got faster: say so in each player's half. */
  private speedUp(level: number): void {
    const { fx, audio } = this.ctx
    audio.play('powerup', 1 + level * 0.12)
    const text =
      level >= LEVELS
        ? 'Top speed! Growing!'
        : this.s.b.boost > 0 && level === 1
          ? 'Match point!'
          : 'Faster!'
    for (const side of [0, 1] as Side[]) floatFor(fx, side, text)
  }

  private roundOver(w: Side | 'draw'): void {
    const { ctx } = this
    const s = this.s
    ctx.audio.play(w === 'draw' ? 'draw' : 'score')
    if (w !== 'draw') {
      const h = s.b.snakes[w].body[0]
      const col = SIDE[w]
      if (h) {
        const c = cellCentre(h)
        ctx.fx.ring(c.x, c.y, C.yellow, 220)
        ctx.fx.ring(c.x, c.y, col.light, 140)
        ctx.fx.burst(c.x, c.y, col.main, {
          count: 26,
          speed: 700,
          size: 12,
          life: 0.8,
          gravity: 0,
          drag: 2.4,
          colors: [col.main, col.light, C.yellow, C.white],
          kind: 'square',
        })
        // In the winner's own half, clear of the crash it walked away from.
        floatFor(ctx.fx, w, 'Survivor!')
      }
    } else {
      ctx.fx.flash(C.white, 0.25)
      for (const side of [0, 1] as Side[]) floatFor(ctx.fx, side, 'Draw!')
    }
    if (roundEnd(s.rounds, w, this.time, ctx.names) && w !== 'draw') {
      ctx.fx.confetti(w)
      ctx.fx.flash(SIDE[w].main, 0.3)
      ctx.audio.buzz(40)
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2.2 })
    }
  }

  /**
   * Feedback for one rules event. Intensity grows with the snake's length and
   * the round's speed: pitch, particles, shake, hit-stop and haptics.
   */
  private juice(e: Ev): void {
    const { fx, audio } = this.ctx
    const col = SIDE[e.side]
    const speed = TICK / this.s.b.len
    switch (e.k) {
      case 'eat': {
        const k = Math.min(1, (e.n - 3) / 20)
        this.s.eatT[e.side] = this.time
        audio.play('chomp', 1 + Math.random() * 0.2)
        audio.play('coin', 1.05 + k * 0.6)
        if (k > 0.4) audio.buzz(8)
        fx.ring(e.x, e.y, C.yellow, 70 + k * 60)
        fx.burst(e.x, e.y, C.yellow, {
          count: Math.round(10 + k * 12 + (speed - 1) * 8),
          speed: 260 + k * 200,
          size: 9,
          life: 0.45,
          gravity: 200,
          colors: [C.yellow, C.white, col.light],
        })
        fx.float('+1', e.x, e.y + (e.side === 0 ? -60 : 60), C.yellow, 42 + k * 16, e.side)
        break
      }
      case 'crash': {
        // A long snake at full speed makes a bigger wreck.
        const k = Math.min(1, ((e.n - 3) / 20) * 0.5 + (e.speed - 1) * 0.8)
        audio.play('explode', 1.05 - k * 0.25 + Math.random() * 0.1)
        audio.buzz(Math.round(40 + k * 40))
        fx.burst(e.x, e.y, col.main, {
          count: Math.round(24 + k * 24),
          speed: 460 + k * 360,
          size: 16,
          life: 0.7,
          gravity: 0,
          colors: [col.main, col.light, C.white, C.cyan],
        })
        fx.sparks(e.x, e.y, C.white, Math.round(8 + k * 12))
        fx.ring(e.x, e.y, col.light, 150 + k * 90)
        fx.flash(col.main, 0.18 + k * 0.12)
        fx.float(
          'Crash!',
          keepInside(e.x, 120),
          e.y + (e.side === 0 ? -80 : 80),
          col.light,
          60,
          e.side,
        )
        fx.shake(0.45 + k * 0.3)
        // The round is over, so freezing the clock costs nobody anything.
        fx.stop(Math.round(5 + k * 4))
        break
      }
    }
  }

  render(g: Draw, alpha: number): void {
    const humans: [boolean, boolean] = [!this.ctx.bots[0], !this.ctx.bots[1]]
    renderNeon(g, this.s, this.time, this.ctx.names, this.over, humans, alpha)
  }
}

export default () => new NeonSnake()
