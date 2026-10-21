import { frame as toWorld, inFrame, toLocal } from '../../core/frame.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { banner, bigScore, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { choose } from './bot.ts'
import { backdrop, type Call, drawHood, drawLane, type LaneLook, type Trail } from './render.ts'
import {
  type Event,
  laneDone,
  LANE,
  laneTotal,
  newLane,
  prepare,
  resolve,
  rollOver,
  SETTLE,
  stepRoll,
  swipeThrow,
  type Lane,
  throwBall,
  trajectory,
  type Swipe,
  winnerOf,
} from './rules.ts'

interface State {
  lanes: [Lane, Lane]
  /** The last callout on each lane (strike, spare, gutter…), stamped with its time. */
  calls: [Call | null, Call | null]
  /** Game time the match was decided (the closing banner). */
  endAt: number
}

/** Frames to bowl, chosen by the players before the match. */
export const match: MatchSpec = { unit: 'rounds', default: 5, min: 1, max: 10 }

/** Where a callout for `side` floats: the middle of its pin deck, in world units. */
const deck = (side: Side): [number, number] => {
  const p = toWorld(side, LANE.cx, 1220)
  return [p.x, p.y]
}

class Bowling extends BaseGame<State> {
  /** Cosmetic: the swipe under each player's finger (lane coordinates). */
  private swipes: [{ id: number; pts: Swipe[] } | null, { id: number; pts: Swipe[] } | null] = [
    null,
    null,
  ]
  private trails: [Trail | null, Trail | null] = [null, null]
  /** Cosmetic: recent ball positions per lane (lane coordinates). */
  private ballTrails: [{ x: number; y: number }[], { x: number; y: number }[]] = [[], []]

  private get frames(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const n = this.frames
    return {
      lanes: [this.fresh(n), this.fresh(n)],
      calls: [null, null],
      endAt: -1,
    }
  }

  /** A lane ready for its next roll; a bot's throw is due after a short think. */
  private fresh(total: number): Lane {
    return newLane(total, this.time + this.thinkTime())
  }

  private thinkTime(): number {
    const d = this.ctx.difficulty
    return (d === 'easy' ? 1.6 : d === 'normal' ? 1.1 : 0.8) + this.ctx.rng.range(0, 0.5)
  }

  protected step(dt: number): void {
    const s = this.s
    for (const side of [0, 1] as Side[]) {
      const lane = s.lanes[side]
      if (lane.phase === 'ready') {
        if (this.isBot(side)) {
          if (this.time >= lane.botAt) this.throwBot(side)
        } else this.swipeStep(side)
      } else if (lane.phase === 'roll') {
        const ev: Event[] = []
        stepRoll(lane, dt, ev)
        for (const e of ev) this.juice(side, e)
        if (rollOver(lane, this.time)) this.endRoll(side)
      } else if (lane.phase === 'settle') {
        if (this.time >= lane.until) {
          prepare(lane)
          lane.phase = 'ready'
          lane.botAt = this.time + this.thinkTime()
        }
      }
    }
    if (s.lanes.every(laneDone) && s.lanes.every((l) => this.time >= l.until)) {
      const a = laneTotal(s.lanes[0].frames)
      const b = laneTotal(s.lanes[1].frames)
      const won = winnerOf(a, b)
      s.endAt = this.time
      const { fx } = this.ctx
      if (won === 'draw') fx.confetti()
      else {
        fx.confetti(won)
        fx.flash(SIDE[won].main, 0.25)
        fx.shake(0.3)
      }
      this.finish(won, { score: [a, b], delay: 2.4 })
    }
  }

  private throwBot(side: Side): void {
    const lane = this.s.lanes[side]
    const t = choose(this.ctx.difficulty, this.ctx.rng, lane.pins)
    throwBall(lane, t.dx, t.dy, t.speed, t.curve, this.time)
    this.thrown(side, t.speed)
  }

  /** A human's swipe, read in the lane's frame so blue's swipes work too. */
  private swipeStep(side: Side): void {
    const lane = this.s.lanes[side]
    const input = this.ctx.input.player(side)
    const sw = this.swipes[side]
    if (!sw) {
      const p = input.downs[0]
      if (!p) return
      const q = toLocal(side, p.x, p.y)
      this.swipes[side] = { id: p.id, pts: [{ x: q.x, y: q.y, t: this.time }] }
      return
    }
    const p = input.held.get(sw.id)
    if (p) {
      const q = toLocal(side, p.x, p.y)
      const last = sw.pts[sw.pts.length - 1]
      if (!last || Math.hypot(q.x - last.x, q.y - last.y) > 2)
        sw.pts.push({ x: q.x, y: q.y, t: this.time })
      const t = swipeThrow(sw.pts)
      this.trails[side] = {
        pts: sw.pts.slice(-40).map((k) => ({ x: k.x, y: k.y })),
        path: t ? trajectory(t.dx, t.dy, t.speed, t.curve) : [],
      }
      return
    }
    // Released: the swipe is the throw (or nothing, for a tap).
    this.swipes[side] = null
    this.trails[side] = null
    const t = swipeThrow(sw.pts)
    if (!t) return
    throwBall(lane, t.dx, t.dy, t.speed, t.curve, this.time)
    this.thrown(side, t.speed)
  }

  /** The ball leaves the hand: a whoosh and a scuff at the foul line. */
  private thrown(side: Side, speed: number): void {
    const { fx, audio } = this.ctx
    audio.play('whoosh', 0.8 + Math.min(0.6, speed / 3000))
    audio.play('roll', 0.9)
    const p = toWorld(side, LANE.cx, LANE.ballY)
    fx.puff(p.x, p.y, 'rgba(255,255,255,0.6)', 5)
    this.ballTrails[side] = []
  }

  /** The ball has stopped: record the pins, call strikes and spares, and wait a beat. */
  private endRoll(side: Side): void {
    const lane = this.s.lanes[side]
    const cur = lane.frames[lane.frames.length - 1] ?? []
    const rollNo = cur.length
    const first = cur[0] ?? 0
    const knocked = resolve(lane)
    const { fx, audio } = this.ctx
    let text: string | null = null
    let big = false
    if (rollNo === 0 && knocked === 10) {
      text = 'STRIKE!'
      big = true
      audio.play('explode', 0.9)
      audio.play('coin', 1.2)
      audio.buzz(30)
      fx.flash(SIDE[side].main, 0.3)
      fx.shake(0.45)
      fx.stop(5)
      fx.confetti(side)
      fx.burst(deck(side)[0], deck(side)[1], SIDE[side].main, {
        count: 40,
        speed: 900,
        size: 16,
        life: 1,
        gravity: 0,
        drag: 2.4,
        colors: [SIDE[side].main, SIDE[side].light, C.yellow, C.white],
        kind: 'square',
      })
    } else if (rollNo === 1 && first + knocked === 10) {
      text = 'SPARE!'
      big = true
      fx.stop(3)
      audio.play('score')
      audio.buzz(14)
      fx.shake(0.25)
      fx.burst(deck(side)[0], deck(side)[1], C.yellow, {
        count: 24,
        speed: 620,
        size: 14,
        life: 0.8,
        gravity: 300,
      })
    } else if (knocked === 0) {
      text = lane.ball.x < LANE.x0 || lane.ball.x > LANE.x1 ? 'Gutter' : 'Miss'
      audio.play('error')
    } else {
      text = String(knocked)
      audio.play('pop', 0.9 + knocked * 0.03)
      floatFor(fx, side, `+${knocked}`, ...deck(side))
      text = null
    }
    if (text) this.s.calls[side] = { text, at: this.time, big }
    if (lane.phase === 'settle' || lane.phase === 'done') lane.until = this.time + SETTLE
  }

  private juice(side: Side, e: Event): void {
    const { fx, audio } = this.ctx
    const p = toWorld(side, e.x, e.y)
    if (e.kind === 'hit') {
      audio.play('hit', 0.8 + Math.min(0.6, e.speed / 2200))
      if (e.speed > 500) fx.sparks(p.x, p.y, C.yellow, 8)
      if (e.speed > 1100) {
        fx.shake(0.14)
        fx.stop(2)
      }
    } else if (e.kind === 'knock') {
      audio.play('click', 0.9 + Math.min(0.5, e.speed / 1200))
      audio.play('slap', 1.15 + (e.speed % 97) / 320)
      fx.puff(p.x, p.y, 'rgba(255,255,255,0.7)', 4)
      fx.sparks(p.x, p.y, C.white, 4)
    } else if (e.kind === 'wall') {
      audio.play('swish', 0.8 + Math.min(0.5, e.speed / 2000))
    } else if (e.kind === 'pit') {
      audio.play('whoosh', 1.2)
    }
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.swipes = [null, null]
    this.trails = [null, null]
    this.ballTrails = [[], []]
  }

  render(g: Draw): void {
    const s = this.s
    backdrop(g)
    for (const side of [0, 1] as Side[]) {
      const lane = s.lanes[side]
      const bt = this.ballTrails[side]
      if (lane.ball.live && Math.hypot(lane.ball.vx, lane.ball.vy) > 400)
        bt.push({ x: lane.ball.x, y: lane.ball.y })
      else bt.shift()
      while (bt.length > 6) bt.shift()
      const look: LaneLook = {
        lane,
        side,
        time: this.time,
        trail: this.trails[side],
        hint: !this.isBot(side) && lane.frames.length === 1 && lane.frames[0]?.length === 0,
        call: s.calls[side],
        ballTrail: bt,
      }
      inFrame(g, side, () => drawLane(g, look))
    }
    drawHood(g)
    for (const side of [0, 1] as Side[]) {
      const lane = s.lanes[side]
      const ready = lane.phase === 'ready'
      const text = ready
        ? this.isBot(side)
          ? 'Thinking…'
          : 'Swipe to bowl'
        : lane.phase === 'done'
          ? 'Finished'
          : undefined
      namePill(g, side, this.ctx.names[side], { active: ready, text })
      bigScore(g, side, laneTotal(lane.frames), { x: 120 })
    }
    if (s.endAt >= 0) {
      const a = laneTotal(s.lanes[0].frames)
      const b = laneTotal(s.lanes[1].frames)
      const label =
        a === b
          ? `Tied at ${a}!`
          : `${this.ctx.names[a > b ? 0 : 1]} wins ${Math.max(a, b)}–${Math.min(a, b)}`
      const k = Math.min(1, (this.time - s.endAt) / 0.25)
      banner(g, undefined, label, MID, { size: 46 + (1 - k) * 24, gap: 64, color: C.yellow })
    }
  }
}

export default () => new Bowling()
