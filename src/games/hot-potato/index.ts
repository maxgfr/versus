import { BaseGame, other, type MatchSpec, type Side } from '../../core/game.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import type { Draw } from '../../core/render/draw.ts'
import { frame } from '../../core/frame.ts'
import { MID, W } from '../../core/stage.ts'
import {
  roundEnd,
  roundsNew,
  roundsStep,
  tapPoints,
  tapRipple,
  taps,
  type Rounds,
} from '../../engines/reflex/index.ts'
import { PotatoBot } from './bot.ts'
import { renderPotato } from './render.ts'
import {
  boomDelay,
  FOLLOW,
  FUMBLE,
  followThrough,
  heatOf,
  loserAt,
  potatoNew,
  LIMIT_B,
  LIMIT_R,
  potatoStep,
  tapResult,
  throwPotato,
  TARGET,
  type Potato,
} from './rules.ts'

/** Seconds between rounds. */
const PAUSE = 2
/** Seconds between the last round and the result screen. */
const END_DELAY = 2
/** Finger speed toward the rival (world units / s) where a flick starts to count, and the span up to full force. */
const FLICK_V0 = 1500
const FLICK_SPAN = 6000

export interface State {
  rounds: Rounds
  pot: Potato
  /** Game time the hidden timer blows the potato. */
  boomAt: number
  /** Game time it blew, -1 until it does. */
  boomed: number
  /** Who serves this round (the loser of the last one). */
  server: Side
  /** Game time of the last throw, -1 for none. */
  throwAt: number
  /** Who threw it last. */
  thrower: Side
  /** Game time the potato last landed at a catch point. */
  landAt: number
  /** Game time each side's fingers are burnt until (a fumbled grab). */
  lock: [number, number]
  /** Game time of each side's last fumble, for the ouch pose. */
  fumbleAt: [number, number]
  /** The match winner once decided. */
  winner: Side | null
}

/** Something that happened this step, turned into feedback by `juice`. */
type Event =
  | { kind: 'throw'; side: Side }
  | { kind: 'boost'; side: Side; power: number; was: number }
  | { kind: 'catch' }
  | { kind: 'cross' }
  | { kind: 'fumble'; side: Side }
  | { kind: 'boom'; loser: Side }

/** Match length: first to N round wins (best of 5 by default). */
export const match: MatchSpec = { unit: 'wins', default: TARGET, min: 1, max: 9 }

class HotPotato extends BaseGame<State> {
  private bots: [PotatoBot | null, PotatoBot | null] = [null, null]
  // Cosmetic only (not synced): previous potato y for interpolation, springs,
  // and what render last saw, so the springs kick on the online guest too.
  private prevY: number | null = null
  private potSq = new Spring(1, 360, 11)
  private mittSq: [Spring, Spring] = [new Spring(1, 380, 12), new Spring(1, 380, 12)]
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]
  private seen = {
    throws: 0,
    held: true,
    holder: 0 as Side,
    fumble: [-10, -10] as [number, number],
    wins: [0, 0] as [number, number],
    power: 0,
  }

  protected setup(): State {
    const { ctx } = this
    this.bots = [0, 1].map((side) =>
      ctx.bots[side as Side] ? new PotatoBot(ctx.rng.fork(), ctx.difficulty) : null,
    ) as [PotatoBot | null, PotatoBot | null]
    const server: Side = ctx.rng.chance(0.5) ? 1 : 0
    return {
      rounds: roundsNew(ctx.target || match.default),
      pot: potatoNew(server, 0),
      boomAt: boomDelay(ctx.rng),
      boomed: -1,
      server,
      throwAt: -1,
      thrower: server,
      landAt: -10,
      lock: [-1, -1],
      fumbleAt: [-10, -10],
      winner: null,
    }
  }

  /** A fresh round: the server holds the potato at their catch point, on the hidden timer. */
  private startRound(): void {
    const s = this.s
    s.pot = potatoNew(s.server, this.time)
    s.boomAt = this.time + boomDelay(this.ctx.rng)
    s.boomed = -1
    s.throwAt = -1
    s.thrower = s.server
    s.landAt = this.time
    s.lock = [-1, -1]
    this.prevY = null
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    this.prevY = s.pot.y
    if (roundsStep(s.rounds, this.time, PAUSE)) this.startRound()
    if (s.rounds.phase !== 'play') return

    if (this.time >= s.boomAt) {
      this.boom()
      return
    }

    const events: Event[] = []
    for (const side of [0, 1] as Side[]) {
      for (const p of tapPoints(ctx, side)) tapRipple(ctx, side, p.x, p.y)
      const bot = this.bots[side]
      const touch = bot
        ? bot.drive(this.time, s.pot, side, s.lock[side])
        : { tap: taps(ctx, side) > 0, force: 0 }
      if (touch.tap) {
        const r = tapResult(s.pot, side, this.time, s.lock[side])
        if (r === 'throw') {
          throwPotato(s.pot, side, this.time)
          s.throwAt = this.time
          s.thrower = side
          events.push({ kind: 'throw', side })
        } else if (r === 'fumble') {
          s.lock[side] = this.time + FUMBLE
          s.fumbleAt[side] = this.time
          events.push({ kind: 'fumble', side })
        }
      }
      // Follow-through: the thrower's flick right after the tap adds speed.
      const pot = s.pot
      if (pot.by === side && !pot.held && this.time - pot.thrownAt <= FOLLOW) {
        const force = bot ? touch.force : this.flick(side, dt)
        const was = pot.power
        if (followThrough(pot, side, force, this.time))
          events.push({ kind: 'boost', side, power: pot.power, was })
      }
    }

    const before = s.pot.holder
    const flying = !s.pot.held
    potatoStep(s.pot, dt, this.time)
    if (flying && s.pot.held) {
      s.landAt = this.time
      events.push({ kind: 'catch' })
    }
    if (s.pot.holder !== before) events.push({ kind: 'cross' })
    for (const e of events) this.juice(e)
  }

  /** 0..1 how hard the side's finger is flicked toward the rival this step. */
  private flick(side: Side, dt: number): number {
    const inp = this.ctx.input.player(side)
    let v = 0
    for (const p of inp.held.values()) v = Math.max(v, (side === 0 ? p.py - p.y : p.y - p.py) / dt)
    for (const p of inp.ups) v = Math.max(v, (side === 0 ? p.py - p.y : p.y - p.py) / dt)
    return v <= FLICK_V0 ? 0 : Math.min(1, (v - FLICK_V0) / FLICK_SPAN)
  }

  /** The hidden timer goes off: whoever holds it loses the round. */
  private boom(): void {
    const s = this.s
    const loser = loserAt(s.pot)
    const winner = other(loser)
    s.boomed = this.time
    // The loser serves the next potato.
    s.server = loser
    this.juice({ kind: 'boom', loser })
    if (roundEnd(s.rounds, winner, this.time, this.ctx.names)) {
      s.winner = winner
      this.finish(winner, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: END_DELAY })
      const col = SIDE[winner]
      const fx = this.ctx.fx
      fx.confetti(winner)
      const p = frame(winner, W / 2, LIMIT_R)
      fx.ring(p.x, p.y, col.light, 420)
      fx.burst(p.x, p.y, col.main, {
        count: 40,
        speed: 1000,
        size: 15,
        life: 1,
        gravity: 0,
        drag: 2.2,
        colors: [col.main, col.light, C.yellow, C.white],
        kind: 'square',
      })
    }
  }

  /**
   * Feedback for one event. Intensity `k` comes from the potato's heat and the
   * flick force behind the throw, and scales pitch, particles, shake, hit-stop
   * and the haptic buzz.
   */
  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const s = this.s
    const pot = s.pot
    const heat = heatOf(pot.throws)
    const y = pot.y
    switch (e.kind) {
      case 'throw': {
        const k = Math.min(1, 0.3 + heat * 0.7)
        audio.play('boing', 0.85 + heat * 0.7)
        audio.play('whoosh', 0.9 + heat * 0.4)
        fx.shake(0.04 + heat * 0.1)
        fx.burst(W / 2, y, SIDE[e.side].light, {
          count: Math.round(5 + k * 10),
          speed: 300 + k * 260,
          size: 8 + heat * 8,
          life: 0.45,
          gravity: 200,
          colors: ['#ffcd3c', '#ff8b3d', '#ff4b5c'],
        })
        audio.buzz(8)
        break
      }
      case 'boost': {
        // Only the moments the flick crosses a level: a smooth swipe rises over several steps.
        const k = e.power
        const dir = e.side === 0 ? -Math.PI / 2 : Math.PI / 2
        if (e.was < 0.3 && k >= 0.3) {
          audio.play('swish', 0.9 + k * 0.6)
          fx.burst(W / 2, y, C.white, {
            count: Math.round(4 + k * 10),
            speed: 600 + k * 900,
            size: 6,
            life: 0.3,
            gravity: 0,
            spread: 0.5,
            dir,
            kind: 'spark',
          })
          fx.shake(0.06 + k * 0.12)
          audio.buzz(Math.round(8 + k * 14))
        }
        if (e.was < 0.75 && k >= 0.75) {
          const f = frame(e.side, W / 2 + 250, MID + 200)
          fx.float('ZOOM!', f.x, f.y, SIDE[e.side].light, 72, e.side)
          fx.stop(2)
        }
        break
      }
      case 'catch':
        audio.play('thud', 1 + heat * 0.4)
        fx.puff(W / 2, y, 'rgba(255,220,180,0.5)', 4 + Math.round(heat * 4))
        if (heat > 0.5) audio.play('zap', 0.7 + heat * 0.5)
        break
      case 'cross':
        // A tick that climbs with the heat, and a puff of steam.
        audio.play('tick', 0.8 + heat * 0.6)
        fx.puff(W / 2, y, 'rgba(255,220,180,0.5)', 3)
        break
      case 'fumble': {
        const f = frame(e.side, W / 2 - 230, LIMIT_R - 60)
        const m = frame(e.side, W / 2 + 30, LIMIT_R + 90)
        audio.play('error', 1)
        audio.buzz(14)
        fx.puff(m.x, m.y, 'rgba(60,50,45,0.75)', 6)
        fx.float('Too soon!', f.x, f.y, '#ff8b3d', 52, e.side)
        break
      }
      case 'boom': {
        // A hotter potato blows bigger.
        const k = 0.6 + heat * 0.4
        const toward = e.loser === 0 ? Math.PI / 2 : -Math.PI / 2
        audio.play('explode', 1.1 - heat * 0.25)
        audio.buzz(Math.round(40 + k * 40))
        fx.burst(W / 2, y, '#ffb13b', {
          count: Math.round(28 + k * 20),
          speed: 600 + k * 300,
          size: 16,
          life: 0.9,
          gravity: 300,
        })
        // Debris blown at the loser.
        fx.burst(W / 2, y, '#ff8b3d', {
          count: Math.round(12 + k * 14),
          speed: 900 + k * 500,
          size: 10,
          life: 0.6,
          gravity: 0,
          spread: 1.2,
          dir: toward,
          kind: 'spark',
        })
        fx.burst(W / 2, y, '#3a2a20', {
          count: 18,
          speed: 380,
          size: 26,
          life: 0.9,
          gravity: -40,
          drag: 2,
        })
        fx.ring(W / 2, y, '#ffcd3c', 220 + k * 120)
        fx.ring(W / 2, y, '#ff4b5c', 120 + k * 80)
        fx.flash('#ffb13b', 0.3 + k * 0.2)
        fx.shake(0.55 + k * 0.35)
        fx.stop(Math.round(4 + k * 4))
        const f = frame(e.loser, W / 2 + 260, LIMIT_R - 160)
        fx.float('BOOM!', f.x, f.y, '#ffcd3c', 110, e.loser)
        fx.burst(W / 2, y, '#000000', {
          count: 8,
          speed: 600,
          size: 40,
          life: 0.9,
          gravity: 700,
          kind: 'emoji',
          glyph: '🥔',
        })
        break
      }
    }
  }

  /** Kick the springs from state changes since the last frame (the online guest animates too). */
  private animate(): void {
    const s = this.s
    const pot = s.pot
    const seen = this.seen
    if (pot.throws !== seen.throws) {
      if (pot.throws > seen.throws) {
        // Thrown: the potato stretches out of the mitt, the mitt springs.
        this.potSq.kick(4 + heatOf(pot.throws) * 3)
        this.mittSq[pot.by].kick(-4)
      }
      seen.throws = pot.throws
      seen.power = 0
    }
    if (pot.power > seen.power + 0.2) {
      this.potSq.kick(3 * (pot.power - seen.power))
      seen.power = pot.power
    }
    if (pot.held && !seen.held) {
      // Caught: squash into the mitt.
      this.potSq.kick(-4 - heatOf(pot.throws) * 3)
      this.mittSq[pot.holder].kick(-3 - heatOf(pot.throws) * 3)
    }
    seen.held = pot.held
    if (pot.holder !== seen.holder) {
      this.potSq.kick(-1.5)
      seen.holder = pot.holder
    }
    for (const side of [0, 1] as Side[]) {
      if (s.fumbleAt[side] !== seen.fumble[side]) {
        this.mittSq[side].kick(3)
        seen.fumble[side] = s.fumbleAt[side]
      }
      if (s.rounds.wins[side] > seen.wins[side]) this.pulse[side].kick(14)
      seen.wins[side] = s.rounds.wins[side]
    }
  }

  render(g: Draw, alpha: number): void {
    const s = this.s
    this.animate()
    const dt = 1 / 60
    this.potSq.update(dt)
    for (const sp of this.mittSq) sp.update(dt)
    for (const sp of this.pulse) sp.update(dt)
    const prev = this.prevY
    // Interpolate only within a flight (never across a new round's serve).
    const y =
      prev !== null && Math.abs(prev - s.pot.y) < LIMIT_R - LIMIT_B
        ? lerp(prev, s.pot.y, alpha)
        : s.pot.y
    renderPotato(g, s, this.time, {
      names: this.ctx.names,
      over: this.over,
      bots: this.ctx.bots,
      y,
      potSq: this.potSq.value,
      mittSq: [this.mittSq[0].value, this.mittSq[1].value],
      pulse: [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)],
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prevY = null
  }
}

export default () => new HotPotato()
