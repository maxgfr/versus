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
  TICK,
  tick,
  want,
} from './rules.ts'

export interface State {
  b: Board
  rounds: Rounds
  /** Stick visuals, so the online guest can draw them. */
  ctl: StickLook[]
  /** When each snake last ate (s), for the bulge that travels down its body. */
  eatT: [number, number]
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

/** Keeps a floating label of half-width `half` inside the stage (x, world units). */
const keepInside = (x: number, half: number): number => Math.min(W - half, Math.max(half, x))

class NeonSnake extends BaseGame<State> {
  private sticks: Joystick[] = []
  private anchor: ({ x: number; y: number } | null)[] = [null, null]
  private bots: (NeonBot | null)[] = []
  private ev: Ev[] = []
  private beat = -1
  private went = false

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
    return { b, rounds: roundsNew(this.target), ctl: this.looks(), eatT: [-9, -9] }
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
      s.eatT = [-9, -9]
      this.went = false
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
      s.b.acc += dt
      let winner: Side | 'draw' | null = null
      while (s.b.acc >= TICK && winner === null) {
        s.b.acc -= TICK
        for (const side of [0, 1] as const) {
          const bot = this.bots[side]
          if (!bot) continue
          const d = bot.choose(s.b, side)
          const snake = s.b.snakes[side]
          if (d !== null) want(snake, d)
        }
        winner = tick(s.b, this.time, this.ev, ctx.rng)
      }
      for (const e of this.ev) this.feedback(e)
      if (winner !== null) this.roundOver(winner)
    }
    s.ctl = this.looks()
  }

  private roundOver(w: Side | 'draw'): void {
    const { ctx } = this
    const s = this.s
    ctx.audio.play(w === 'draw' ? 'draw' : 'score')
    if (w !== 'draw') {
      const h = s.b.snakes[w].body[0]
      if (h) {
        const c = cellCentre(h)
        ctx.fx.ring(c.x, c.y, C.yellow, 150)
        // In the winner's own half, clear of the crash it walked away from.
        floatFor(ctx.fx, w, 'Survivor!')
      }
    } else ctx.fx.flash(C.white, 0.25)
    if (roundEnd(s.rounds, w, this.time, ctx.names) && w !== 'draw') {
      ctx.fx.confetti(w)
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2.2 })
    }
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    const col = SIDE[e.side]
    switch (e.k) {
      case 'eat':
        this.s.eatT[e.side] = this.time
        audio.play('chomp', 1 + rng.next() * 0.2)
        audio.play('coin', 1.1 + Math.min(0.6, this.s.b.snakes[e.side].eaten * 0.04))
        fx.ring(e.x, e.y, C.yellow, 80)
        fx.burst(e.x, e.y, C.yellow, {
          count: 14,
          speed: 300,
          size: 9,
          life: 0.45,
          gravity: 200,
          colors: [C.yellow, C.white, col.light],
        })
        fx.float('+1', e.x, e.y + (e.side === 0 ? -60 : 60), C.yellow, 42, e.side)
        break
      case 'crash':
        audio.play('explode', 0.9 + rng.next() * 0.2)
        audio.buzz(60)
        fx.burst(e.x, e.y, col.main, {
          count: 30,
          speed: 520,
          size: 16,
          life: 0.7,
          gravity: 0,
          colors: [col.main, col.light, C.white, C.cyan],
        })
        fx.ring(e.x, e.y, col.light, 170)
        fx.flash(col.main, 0.2)
        fx.float(
          'Crash!',
          keepInside(e.x, 120),
          e.y + (e.side === 0 ? -80 : 80),
          col.light,
          60,
          e.side,
        )
        fx.shake(0.55)
        fx.stop(6)
        break
    }
  }

  render(g: Draw): void {
    const humans: [boolean, boolean] = [!this.ctx.bots[0], !this.ctx.bots[1]]
    renderNeon(g, this.s, this.time, this.ctx.names, this.over, humans)
  }
}

export default () => new NeonSnake()
