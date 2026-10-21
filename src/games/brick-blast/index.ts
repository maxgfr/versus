import { frame } from '../../core/frame.ts'
import { floatFor, type Fx } from '../../core/fx/fx.ts'
import { Spring } from '../../core/fx/ease.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { type BotMemory, decide, newMemory } from './bot.ts'
import { JUNK_COLOR, ROW_COLORS, type Look, render } from './render.ts'
import {
  CELL_H,
  CELL_W,
  type Cmd,
  type Event,
  GRID_TOP,
  type Match,
  newMatch,
  PADDLE_Y,
  remaining,
  step,
  winner,
} from './rules.ts'

interface State {
  m: Match
  /** The decided match and why, stamped so the guest plays the same ending. */
  end: { at: number; winner: Side | 'draw'; why: string } | null
}

/** Seconds on the clock: the most bricks broken wins when it runs out. */
export const match: MatchSpec = { unit: 'seconds', default: 90, min: 30, max: 180, step: 30 }

class BrickBlast extends BaseGame<State> {
  private mem: BotMemory[] = [newMemory(), newMemory()]
  // Cosmetic only (not synced): ball trails and paddle squash.
  private trails: { x: number; y: number }[][] = [[], []]
  private squash: [Spring, Spring] = [new Spring(1, 380, 12), new Spring(1, 380, 12)]
  /** Bricks broken since the paddle last touched the ball, per side (for combo shouts). */
  private combo: [number, number] = [0, 0]

  private get limit(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return { m: newMatch(this.limit), end: null }
  }

  protected step(dt: number): void {
    const m = this.s.m
    const cmds: [Cmd, Cmd] = [this.command(0, dt), this.command(1, dt)]
    const events = step(m, dt, cmds, this.ctx.rng)
    for (const e of events) this.juice(e)
    const won = winner(m)
    if (won !== null) this.end(won)
  }

  protected override afterEnd(dt: number): void {
    // The clock keeps running for the ending banner; the boards stay frozen.
    this.s.m.t += dt
  }

  private end(won: Side | 'draw'): void {
    const m = this.s.m
    const { fx, audio } = this.ctx
    const [a, b] = m.boards
    const why =
      a.lives <= 0 || b.lives <= 0
        ? 'KNOCKOUT!'
        : remaining(a) === 0 || remaining(b) === 0
          ? 'WALL CLEAR!'
          : won === 'draw'
            ? 'DRAW'
            : 'MOST BRICKS!'
    this.s.end = { at: m.t, winner: won, why }
    if (won !== 'draw') {
      fx.confetti(won)
      fx.flash(SIDE[won].main, 0.3)
      fx.shake(0.45)
      fx.stop(6)
      audio.buzz(40)
    }
    this.finish(won, { score: [a.broken, b.broken], delay: 2 })
  }

  /** A side's paddle target (in its own frame) and launch tap for this step. */
  private command(side: Side, dt: number): Cmd {
    if (this.isBot(side))
      return decide(
        this.s.m.boards[side],
        this.ctx.difficulty,
        this.ctx.rng,
        this.mem[side] as BotMemory,
        dt,
      )
    const input = this.ctx.input.player(side)
    const p = input.first()
    return {
      x: p ? frame(side, p.x, p.y).x : null,
      launch: input.downs.length > 0,
    }
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    if (e.kind === 'launch') {
      audio.play('whoosh', 1.1)
      return
    }
    if (e.kind === 'junk') {
      // A junk brick lands in this side's wall.
      const cell = frame(e.side, e.c * CELL_W + CELL_W / 2, GRID_TOP + e.r * CELL_H + CELL_H / 2)
      fx.puff(cell.x, cell.y, 'rgba(214,208,236,0.6)', 8)
      fx.shake(0.16)
      audio.play('thud', 0.7)
      return
    }
    const p = frame(e.side, e.x, e.y)
    if (e.kind === 'brick') {
      const col = e.junk ? JUNK_COLOR : (ROW_COLORS[e.row % ROW_COLORS.length] ?? C.white)
      fx.burst(p.x, p.y, col, {
        count: e.junk ? 8 : 18,
        speed: 560,
        size: 12,
        life: 0.5,
        gravity: 500,
        drag: 2.2,
        colors: [col, C.white, C.yellow],
        kind: 'square',
      })
      const n = ++this.combo[e.side]
      audio.play(e.junk ? 'thud' : 'pop', 0.85 + Math.min(8, n) * 0.06)
      fx.shake(e.junk ? 0.04 : 0.06)
      if (e.sent) {
        // A grey chip flies off toward the rival's wall.
        fx.burst(p.x, p.y, JUNK_COLOR, {
          count: 5,
          speed: 900,
          size: 14,
          life: 0.45,
          gravity: 0,
          drag: 1.2,
          spread: 0.5,
          dir: p.y > MID ? -Math.PI / 2 : Math.PI / 2,
          colors: [JUNK_COLOR, '#c9c4dc'],
          kind: 'square',
        })
      }
      if (n >= 3) {
        fx.float(`x${n}`, p.x, p.y, SIDE[e.side].light, 40 + Math.min(6, n) * 4, e.side)
        if (n % 3 === 0) {
          audio.play('coin', 1 + n * 0.04)
          fx.ring(p.x, p.y, C.yellow, 110)
        }
      }
    } else if (e.kind === 'paddle') {
      this.combo[e.side] = 0
      audio.play('bounce', 1 + Math.abs(e.off) * 0.3)
      fx.sparks(p.x, p.y, C.white, 5)
      this.squash[e.side].kick(-6)
    } else if (e.kind === 'wall') {
      audio.play('wall', 1)
    } else if (e.kind === 'lost') {
      this.combo[e.side] = 0
      this.loseBall(fx, e.side, p.x, p.y, e.lives)
    }
  }

  private loseBall(fx: Fx, side: Side, x: number, y: number, lives: number): void {
    const col = SIDE[side]
    fx.burst(x, y, col.main, {
      count: 30,
      speed: 900,
      size: 14,
      life: 0.8,
      gravity: 0,
      drag: 2.5,
      colors: [col.main, col.light, C.white],
    })
    fx.shake(0.45)
    fx.flash(col.main, 0.25)
    fx.stop(4)
    this.ctx.audio.play('explode', 1)
    const hud = frame(side, W / 2, PADDLE_Y - 150)
    floatFor(fx, side, lives > 0 ? 'OUCH!' : 'OUT!', hud.x, hud.y)
  }

  render(g: Draw, _alpha: number): void {
    const m = this.s.m
    for (const side of [0, 1] as Side[]) {
      const b = m.boards[side]
      const trail = this.trails[side] as { x: number; y: number }[]
      if (b.ball.stuck) trail.length = 0
      else {
        trail.push({ x: b.ball.x, y: b.ball.y })
        while (trail.length > 6) trail.shift()
      }
      this.squash[side].update(1 / 60)
    }
    const look: Look = {
      names: this.ctx.names,
      trails: this.trails,
      squash: [this.squash[0].value, this.squash[1].value],
      hint: [!this.isBot(0), !this.isBot(1)],
      limit: this.limit,
      end: this.s.end,
    }
    render(g, m, look)
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.trails = [[], []]
  }
}

export default () => new BrickBlast()
