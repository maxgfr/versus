import { lerp } from '../../core/fx/ease.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { type MatchSpec, type Side, other } from '../../core/game.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import type { Shell } from '../../engines/aim/index.ts'
import { TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { drawTray, hint, render } from './render.ts'
import {
  advance,
  CUPS,
  ARC_DRIVE,
  ARC_LOB,
  type Event,
  fire,
  type Flick,
  newState,
  originOf,
  type State,
  shotFromFlick,
  standingWinner,
  sunkBy,
} from './rules.ts'

/** Rival cups to sink before the match is won; the players pick it on the ready screen. */
export const match: MatchSpec = { unit: 'points', default: CUPS, min: 1, max: CUPS }

type Game = State & { endAt: number }

class CupPong extends TurnGame<Game> {
  /** The computer's flick for its turn, chosen as its turn starts and shown while it thinks. */
  private botShot: Flick | null = null
  /** Recent speed of the flicking finger (world units/s), a peak that decays: the flick's snap. */
  private snap = 0
  // Cosmetic only (not synced): the ball's previous step, for interpolation.
  private prevShell: Shell | null = null
  /** Match time each cup's rim was last clipped (index-aligned with the cups): it wobbles. */
  private wobble: number[] = []

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): Game {
    // In local 2P the player whose turn it is may flick from anywhere.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    return { ...newState(this.ctx.rng.chance(0.5) ? 0 : 1, this.target), endAt: -1 }
  }

  protected override busy(): boolean {
    return this.s.phase !== 'aim'
  }

  protected override animate(dt: number): void {
    const sh = this.s.ball?.shell
    this.prevShell = sh ? { ...sh } : null
    const { events, winner } = advance(this.s, dt)
    for (const e of events) this.juice(e)
    if (winner !== null) {
      const score: [number, number] = [sunkBy(this.s, 0), sunkBy(this.s, 1)]
      this.s.endAt = this.s.t
      this.ctx.fx.confetti(winner)
      this.ctx.fx.flash(SIDE[winner].light, 0.35)
      this.ctx.fx.shake(0.4)
      this.ctx.audio.play('powerup', 1.2)
      const note =
        this.target === CUPS
          ? 'Cleared every cup'
          : `Sank ${this.target} ${this.target === 1 ? 'cup' : 'cups'}`
      this.finish(winner, { score, note, delay: 2.2 })
      return
    }
    if (this.s.phase === 'aim' && this.isBot(this.s.turn) && !this.botShot) {
      this.botShot = choose(this.s, this.s.turn, this.ctx.difficulty, this.ctx.rng)
    }
  }

  protected override afterEnd(dt: number): void {
    // Keep the clock going for the last cup's lift-off and the winner's wave.
    this.s.t += dt
    for (const c of this.s.cups) if (!c.alive) c.fall += dt
  }

  protected stepTurn(dt: number): void {
    const side = this.s.turn
    const pi = this.ctx.input.player(side)
    // The finger's speed this step; the snap keeps its recent peak so a flick
    // that stops a beat before letting go still counts as snappy.
    const p = pi.held.values().next().value ?? pi.ups[0]
    const inst = p ? Math.hypot(p.x - p.px, p.y - p.py) / dt : 0
    this.snap = Math.max(inst, this.snap * Math.exp(-dt / 0.09))
    let held: Flick | null = null
    for (const q of pi.held.values()) {
      held = flickOf(side, q, this.snap)
      break
    }
    this.s.aiming = held
    for (const q of pi.ups) {
      const shot = flickOf(side, q, this.snap)
      if (shot) {
        this.shoot(shot)
        return
      }
    }
    if (!p) this.snap = 0
  }

  protected botPlay(): void {
    const shot = this.botShot ?? choose(this.s, this.s.turn, this.ctx.difficulty, this.ctx.rng)
    this.botShot = null
    this.shoot(shot)
  }

  private shoot(shot: Flick): void {
    const side = this.s.turn
    fire(this.s, side, shot)
    this.snap = 0
    const o = originOf(side)
    // A snappy drive cracks off the tee; a lob pops gently.
    const drive = Math.min(1, Math.max(0, ((shot.arc ?? 1) - ARC_LOB) / (ARC_DRIVE - ARC_LOB)))
    const { fx, audio } = this.ctx
    audio.play('flip', 1 + shot.power * 0.2 + drive * 0.4)
    audio.play('tap', 1.2 + drive * 0.5)
    audio.buzz(Math.round(5 + 15 * drive))
    fx.puff(o.x, o.y, 'rgba(255,255,255,0.6)', Math.round(4 + 6 * drive))
    fx.ring(o.x, o.y, SIDE[side].light, 70 + 70 * drive)
    if (drive > 0.4)
      fx.burst(o.x, o.y, C.white, {
        count: Math.round(4 + 8 * drive),
        speed: 400 + 400 * drive,
        size: 5,
        life: 0.25,
        gravity: 0,
        drag: 4,
        spread: 0.7,
        dir: Math.atan2(shot.dy, shot.dx) + Math.PI,
        kind: 'spark',
      })
    fx.shake(0.04 + 0.12 * drive)
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    switch (e.kind) {
      case 'bounce': {
        const k = Math.min(1, e.speed / 1100)
        audio.play('bounce', 1.1 + 0.4 * k)
        audio.play('tap', 1.6)
        fx.puff(e.x, e.y, 'rgba(255,255,255,0.5)', Math.round(3 + 6 * k))
        fx.ring(e.x, e.y, C.white, 50 + 60 * k)
        fx.shake(0.03 + 0.08 * k)
        return
      }
      case 'rim': {
        const k = Math.min(1, e.speed / 1400)
        audio.play('hit', 1.5 + 0.3 * k)
        audio.play('wall', 1.3)
        audio.buzz(Math.round(6 + 10 * k))
        fx.sparks(e.x, e.y - 16, C.white, Math.round(4 + 8 * k))
        fx.shake(0.05 + 0.1 * k)
        this.wobble[e.cup] = this.s.t
        return
      }
      case 'cup': {
        const thrower = e.side
        const col = SIDE[other(thrower)].main
        const k = Math.min(1, e.speed / 1600)
        audio.play('splash', 1.15 - 0.3 * k)
        audio.play('score', 1)
        audio.buzz(Math.round(20 + 25 * k))
        // Water jumps out of the cup, then bits of the cup's colour.
        fx.burst(e.x - 8, e.y - 14, '#7fd8ff', {
          count: Math.round(18 + 18 * k),
          speed: 380 + 300 * k,
          size: 11,
          life: 0.6,
          gravity: 0,
          drag: 2.8,
          colors: ['#7fd8ff', '#c9f1ff', C.white],
        })
        fx.burst(e.x, e.y, col, {
          count: 12,
          speed: 380,
          size: 12,
          life: 0.6,
          gravity: 0,
          drag: 2.4,
          kind: 'square',
          colors: [col, C.white, SIDE[thrower].light],
        })
        fx.ring(e.x, e.y, SIDE[thrower].light, 200)
        fx.flash(SIDE[thrower].main, e.left === 0 ? 0.35 : 0.2)
        fx.shake((e.left === 0 ? 0.45 : 0.22) + 0.15 * k)
        fx.stop((e.left === 0 ? 7 : 3) + Math.round(3 * k))
        const label =
          e.left === 0
            ? 'Clear!'
            : e.rims > 0
              ? 'Rolled in!'
              : e.bounced
                ? 'Bounce cup!'
                : e.left === 1
                  ? 'One left!'
                  : 'Cup!'
        floatFor(fx, thrower, label, e.x, e.y)
        return
      }
      case 'miss':
        if (e.out) {
          audio.play('whoosh', 1.2)
          fx.float('Out!', e.x, e.y, SIDE[e.side].light, 56, e.side)
        } else {
          audio.play('error', 1)
          fx.float('Missed!', e.x, e.y, SIDE[e.side].light, 56, e.side)
        }
        return
      case 'turn':
        audio.play('tick', 1)
        return
    }
  }

  render(g: Draw, frac: number): void {
    const s = this.s
    // Online, the flick preview is the thrower's own control: the rival's phone does not show it.
    const own = g.viewer === null || g.viewer === s.turn
    const preview = s.phase === 'aim' && !this.over && own ? this.previewOf() : null
    const end = s.endAt >= 0 ? s.t - s.endAt : -1
    const p = this.prevShell
    const sh = s.ball?.shell
    const ball =
      s.ball && sh && p && !this.over
        ? {
            ...s.ball,
            shell: {
              ...sh,
              x: lerp(p.x, sh.x, frac),
              y: lerp(p.y, sh.y, frac),
              z: lerp(p.z, sh.z, frac),
            },
          }
        : s.ball
    render(
      g,
      { ...s, ball },
      {
        preview,
        end,
        // The side that sank its goal: on a short match both still have cups standing.
        winner: end >= 0 ? standingWinner(s) : null,
        wobble: this.wobble,
      },
      this.time,
    )
    if (
      (this.time < 10 || s.t - s.turnAt > 4) &&
      s.phase === 'aim' &&
      !this.isBot(s.turn) &&
      !this.over &&
      own
    )
      hint(g, s, this.time)
    this.drawTurns(g, undefined, s.phase === 'aim')
    for (const side of [0, 1] as Side[]) drawTray(g, s, side, sunkBy(s, side), this.time)
  }

  /** What the flick preview shows: the human's live flick, or the bot's planned one while it thinks. */
  private previewOf(): Flick | null {
    if (this.isBot(this.s.turn)) return this.botShot
    return this.s.aiming
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prevShell = null
    this.snap = 0
  }
}

/** A held or released pointer as a flick for `side`, its arc set by the finger's snap. */
function flickOf(side: Side, p: Ptr, snap: number): Flick | null {
  return shotFromFlick(side, p.x - p.x0, p.y - p.y0, snap)
}

export default () => new CupPong()
