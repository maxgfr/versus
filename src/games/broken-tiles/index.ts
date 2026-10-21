import { Joystick } from '../../core/controls.ts'
import { BaseGame, type MatchSpec } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { roundEnd, roundsNew, roundsStep, type Rounds } from '../../engines/reflex/index.ts'
import { TileBot } from './bot.ts'
import { renderBroken, type StickLook } from './render.ts'
import { type Board, type Ev, newBoard, stepBoard, tileCentre } from './rules.ts'

export interface State {
  b: Board
  rounds: Rounds
  /** Stick visuals, so the online guest can draw them. */
  ctl: StickLook[]
}

/** Round wins to take the match (best of three by default). */
export const match: MatchSpec = { unit: 'wins', default: 2, min: 1, max: 5 }

/** Seconds between rounds, while the loser falls and the banner shows. */
const PAUSE = 2
/** Joystick radius (world units). */
const STICK_R = 120
/** Extra seconds before standing still starts to crack a tile at a round's start. */
const GRACE = 1

/** Keeps a floating label of half-width `half` inside the stage (x, world units). */
const keepInside = (x: number, half: number): number => Math.min(W - half, Math.max(half, x))

class BrokenTiles extends BaseGame<State> {
  private sticks: Joystick[] = []
  private bots: (TileBot | null)[] = []
  private ev: Ev[] = []

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
      ctx.bots[side] ? TileBot.of(ctx.rng.fork(), ctx.difficulty) : null,
    )
    return { b: newBoard(this.time + GRACE), rounds: roundsNew(this.target), ctl: this.looks() }
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
      s.b = newBoard(this.time + GRACE)
      ctx.audio.play('go')
      return
    }
    const playing = s.rounds.phase === 'play'
    const dirs: [number, number][] = [
      [0, 0],
      [0, 0],
    ]
    for (const side of [0, 1] as const) {
      const stick = this.sticks[side]
      if (!stick) continue
      const bot = this.bots[side]
      if (bot) {
        const d = playing ? bot.drive(s.b, side, dt) : { x: 0, y: 0 }
        stick.set(d.x, d.y)
      } else stick.update(ctx.input.player(side))
      if (playing) dirs[side] = [stick.x, stick.y]
    }
    this.ev.length = 0
    const winner = stepBoard(s.b, dirs, dt, this.time, this.ev)
    for (const e of this.ev) this.feedback(e)
    s.ctl = this.looks()
    if (!playing || winner === null) return
    ctx.audio.play(winner === 'draw' ? 'draw' : 'score')
    if (winner !== 'draw') {
      const p = s.b.p[winner]
      floatFor(ctx.fx, winner, 'Still standing!', keepInside(p.x, 230), p.y - 120)
    }
    if (roundEnd(s.rounds, winner, this.time, ctx.names) && winner !== 'draw') {
      ctx.fx.confetti(winner)
      ctx.fx.ring(s.b.p[winner].x, s.b.p[winner].y, C.yellow, 260)
      this.finish(winner, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2.2 })
    }
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    switch (e.k) {
      case 'enter': {
        const c = tileCentre(e.i)
        audio.play('tap', 0.9 + rng.next() * 0.3)
        fx.burst(c.x, c.y + 30, SIDE[e.side].light, {
          count: 5,
          speed: 170,
          size: 8,
          life: 0.35,
          gravity: 0,
          drag: 4,
        })
        break
      }
      case 'crack': {
        const c = tileCentre(e.i)
        audio.play(e.stand ? 'tick' : 'click', 0.8 + rng.next() * 0.4)
        fx.burst(c.x, c.y, '#f6e6da', {
          count: e.stand ? 8 : 4,
          speed: 200,
          size: 7,
          life: 0.4,
          gravity: 0,
          drag: 3,
          kind: 'square',
          colors: ['#f6e6da', '#e7b48f', C.white],
        })
        if (e.stand) fx.ring(c.x, c.y, C.yellow, 90)
        break
      }
      case 'drop': {
        const c = tileCentre(e.i)
        audio.play('thud', 0.7 + rng.next() * 0.2)
        // Chips falling with the tile: no gravity on a top-down void, they just scatter and fade.
        fx.burst(c.x, c.y, '#e7b48f', {
          count: 10,
          speed: 220,
          size: 12,
          life: 0.55,
          gravity: 0,
          drag: 3.5,
          kind: 'square',
          colors: ['#f2d2bb', '#c98a6a', '#8c6a7a'],
        })
        fx.shake(0.08)
        break
      }
      case 'fall': {
        const col = SIDE[e.side]
        audio.play('whoosh', 0.8)
        audio.buzz(70)
        fx.burst(e.x, e.y, col.main, {
          count: 24,
          speed: 420,
          size: 14,
          life: 0.7,
          gravity: 0,
          drag: 2.5,
          colors: [col.main, col.light, C.white],
        })
        fx.ring(e.x, e.y, col.light, 200)
        fx.flash(col.main, 0.22)
        fx.float('Fell!', keepInside(e.x, 110), e.y - 100, col.light, 68, e.side)
        fx.shake(0.5)
        fx.stop(8)
        break
      }
    }
  }

  render(g: Draw): void {
    const humans: [boolean, boolean] = [!this.ctx.bots[0], !this.ctx.bots[1]]
    renderBroken(g, this.s, this.time, this.ctx.names, this.over, humans)
  }
}

export default () => new BrokenTiles()
