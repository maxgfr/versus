import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { lerp } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { type BotMemory, decide, newMemory } from './bot.ts'
import { render, type Look } from './render.ts'
import {
  type Ball,
  BUMPERS,
  type Event,
  newWorld,
  setHolds,
  step as advance,
  swing,
  winner,
  type World,
} from './rules.ts'

interface State {
  w: World
  /** Host clock of the last drain and of the last serve, for the pops (synced so the guest sees them). */
  goalAt: number
  serveAt: number
  /** Who scored the last drain (-1 before any), for the score pop and the drain flash. */
  scorer: number
  /** The match winner (-1 while playing) and when it was decided, for the ending. */
  champ: number
  endAt: number
}

/** Points needed to win (first to N drains). Players choose N on the ready screen. */
export const match: MatchSpec = {
  unit: 'wins',
  default: 5,
  min: 1,
  max: 11,
}

/** A touch keeps its flipper up at least this long, so a quick tap still swings it. */
const TAP_HOLD = 0.12
const BUMP_COL = C.yellow

/**
 * Which of a side's two flippers a set of touches lands on. Each side reads its own
 * half of the table: blue's left is the world's right, so its touches are mirrored.
 */
function touchLanes(points: Iterable<{ x: number; y: number }>, side: Side): [boolean, boolean] {
  const out: [boolean, boolean] = [false, false]
  for (const p of points) {
    const lx = side === 1 ? W - p.x : p.x
    out[lx < W / 2 ? 0 : 1] = true
  }
  return out
}

class Pinball extends BaseGame<State> {
  private bots: BotMemory[] = [newMemory(), newMemory()]
  /** Seconds each flipper stays up after a tap (index = side * 2 + lane). */
  private tapLeft = [0, 0, 0, 0]
  // Cosmetic only (not synced): previous positions for interpolation, and the trail.
  private prev: { ball: Ball; angles: number[] } | null = null
  private trail: { x: number; y: number }[] = []

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return {
      w: newWorld(this.ctx.rng),
      goalAt: -10,
      serveAt: -10,
      scorer: -1,
      champ: -1,
      endAt: -10,
    }
  }

  protected step(dt: number): void {
    const w = this.s.w
    this.prev = { ball: { ...w.ball }, angles: w.flips.map((f) => f.a) }
    const was = w.flips.map((f) => f.up)
    const events = advance(w, dt, this.holds(dt), this.ctx.rng)
    w.flips.forEach((f, i) => {
      if (f.up && !was[i]) this.ctx.audio.play('flip', 0.9 + (i & 1) * 0.12)
    })
    for (const e of events) this.juice(e)
    const won = winner(w, this.target)
    if (won !== null) this.end(won)
  }

  /** The final drain: confetti from the winner's end, a held beat, then the result screen. */
  private end(won: Side): void {
    const w = this.s.w
    this.s.champ = won
    this.s.endAt = this.time
    this.ctx.fx.confetti(won)
    this.ctx.fx.stop(10)
    this.finish(won, { score: [w.score[0], w.score[1]], delay: 2.2 })
  }

  protected override afterEnd(dt: number): void {
    // The ball is out of play, but the flippers keep answering the fingers.
    const w = this.s.w
    setHolds(w, this.holds(dt))
    swing(w, dt)
    for (let i = 0; i < w.bumpLit.length; i++)
      w.bumpLit[i] = Math.max(0, (w.bumpLit[i] ?? 0) - dt * 3)
    for (let i = 0; i < w.slingLit.length; i++)
      w.slingLit[i] = Math.max(0, (w.slingLit[i] ?? 0) - dt * 4)
  }

  /** Which flippers are held up this step (index = side * 2 + lane), from fingers or the bot. */
  private holds(dt: number): boolean[] {
    const out = [false, false, false, false]
    for (let i = 0; i < 4; i++) this.tapLeft[i] = Math.max(0, (this.tapLeft[i] ?? 0) - dt)
    for (const side of [0, 1] as Side[]) {
      if (this.isBot(side)) {
        const [l, r] = decide(
          this.s.w,
          side,
          this.ctx.difficulty,
          this.ctx.rng,
          this.bots[side] as BotMemory,
          dt,
        )
        out[side * 2] = l
        out[side * 2 + 1] = r
        continue
      }
      const input = this.ctx.input.player(side)
      const held = touchLanes(input.held.values(), side)
      const pressed = touchLanes(input.downs, side)
      for (let lane = 0; lane < 2; lane++) {
        const i = side * 2 + lane
        if (pressed[lane]) this.tapLeft[i] = TAP_HOLD
        out[i] = held[lane] === true || (this.tapLeft[i] ?? 0) > 0
      }
    }
    return out
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const s = this.s
    switch (e.kind) {
      case 'flip': {
        const k = Math.min(1, e.speed / 2200)
        audio.play('hit', 0.85 + k * 0.6)
        if (e.speed > 500) fx.sparks(e.x, e.y, SIDE[e.side].light, Math.round(3 + k * 9))
        if (e.speed > 900) fx.shake(0.06 + k * 0.14)
        if (e.speed > 1500) {
          fx.stop(2)
          audio.buzz(8)
        }
        break
      }
      case 'bump': {
        const [bx, by] = BUMPERS[e.i] ?? [e.x, e.y]
        audio.play('pop', 0.9 + e.i * 0.08)
        fx.burst(e.x, e.y, C.white, {
          count: 10,
          speed: 480,
          size: 8,
          life: 0.35,
          gravity: 0,
          drag: 3,
          kind: 'spark',
          colors: [C.white, BUMP_COL],
        })
        fx.ring(bx, by, BUMP_COL, 120)
        fx.shake(0.07)
        // Score pop: cosmetic, for the player whose half the bumper is in.
        fx.float('+100', bx, by - 80, BUMP_COL, 46, e.y > MID ? 0 : 1)
        break
      }
      case 'kick': {
        audio.play('boing', 0.9 + Math.min(0.5, e.speed / 3000))
        fx.sparks(e.x, e.y, SIDE[e.side].light, 8)
        fx.shake(0.1)
        break
      }
      case 'wall': {
        if (e.speed > 300) audio.play('wall', 0.9 + Math.min(0.4, e.speed / 3000))
        if (e.speed > 900) fx.sparks(e.x, e.y, C.white, 5)
        break
      }
      case 'goal': {
        const col = SIDE[e.side]
        audio.play('score')
        audio.buzz(30)
        fx.flash(col.main, 0.3)
        fx.shake(0.5)
        fx.stop(6)
        fx.burst(e.x, e.y, col.main, {
          count: 46,
          speed: 1000,
          size: 16,
          life: 1.1,
          gravity: 0,
          drag: 2.2,
          spread: Math.PI,
          dir: e.y > MID ? -Math.PI / 2 : Math.PI / 2,
          colors: [col.main, col.light, C.yellow, C.white],
          kind: 'square',
        })
        fx.ring(e.x, e.y, col.light, 360)
        floatFor(fx, e.side, 'POINT!', W / 2, e.side === 0 ? 1520 : 280)
        s.goalAt = this.time
        s.scorer = e.side
        break
      }
      case 'serve': {
        s.serveAt = this.time
        audio.play('go', 0.9)
        break
      }
    }
  }

  render(g: Draw, alpha: number): void {
    const w = this.s.w
    const prev = this.prev
    const ball: Ball =
      prev && w.phase === 'play'
        ? {
            ...w.ball,
            x: lerp(prev.ball.x, w.ball.x, alpha),
            y: lerp(prev.ball.y, w.ball.y, alpha),
          }
        : w.ball
    const angles = w.flips.map((f, i) => (prev ? lerp(prev.angles[i] ?? f.a, f.a, alpha) : f.a))
    const speed = Math.hypot(w.ball.vx, w.ball.vy)
    if (w.phase === 'play' && speed > 700) this.trail.push({ x: ball.x, y: ball.y })
    else this.trail.length = 0
    while (this.trail.length > 7) this.trail.shift()
    const look: Look = {
      ball,
      angles,
      trail: this.trail,
      now: this.time,
      goalAt: this.s.goalAt,
      serveAt: this.s.serveAt,
      scorer: this.s.scorer,
      endAt: this.s.endAt,
      champ: this.s.champ,
      target: this.target,
      humans: [!this.isBot(0), !this.isBot(1)],
    }
    render(g, w, look)
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
    this.trail = []
  }
}

export default () => new Pinball()
