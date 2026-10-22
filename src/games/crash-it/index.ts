import { type GameContext, type MatchSpec, other, type Side } from '../../core/game.ts'
import { clamp, lerp } from '../../core/fx/ease.ts'
import type { Ptr } from '../../core/input.ts'
import type { Rng } from '../../core/rng.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE } from '../../core/render/palette.ts'
import { mirrorFx, RunnerGame, toWorld } from '../../engines/runner/index.ts'
import { type Brain, drive, newBrain } from './bot.ts'
import { drawLane } from './render.ts'
import {
  BOOST_V,
  ROAD_Y,
  WALL_V,
  TRUCK_HALF,
  TRUCK_X,
  type Truck,
  type TruckEvent,
  newTruck,
  stepTruck,
} from './rules.ts'

type Pair = [number, number]

/** One race: a course and two trucks running it. */
interface Race {
  /** The course of this race: both lanes run the same walls. */
  seed: number
  lanes: [Truck, Truck]
  phase: 'ready' | 'run' | 'end'
  phaseAt: number
  /** Game time each truck crossed the flag, or -1. */
  finishT: Pair
  /** Animation stamps per side, so every screen plays the same moments. */
  smashAt: Pair
  /** Course x of the last wall each side smashed. */
  smashX: Pair
  bumpAt: Pair
  landAt: Pair
  /** How hard each truck last landed, 0..1 (the squash scales with it). */
  landK: Pair
  fallAt: Pair
  /** Who won this race, or 'draw'. */
  winner: Side | 'draw' | null
  endAt: number
}

export interface State extends Race {
  /** Races won so far, per side. */
  wins: [number, number]
  /** The race in play, from 1. */
  round: number
}

/** A beat after the shell's 3-2-1 to read the rules. */
const READY_T = 1.4
/** How long a race's ending plays before the match result or the next race. */
const END_T = 2.2
/** The pause button sits at the left edge near the midline: presses there are not boost. */
const inPauseZone = (p: Ptr): boolean => p.x < 120 && p.y > 700 && p.y < 1100

/** First to N race wins: the players pick N before the match. */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

function newRace(seed: number): Race {
  return {
    seed,
    lanes: [newTruck(), newTruck()],
    phase: 'ready',
    phaseAt: 0,
    finishT: [-1, -1],
    smashAt: [-9, -9],
    smashX: [0, 0],
    bumpAt: [-9, -9],
    landAt: [-9, -9],
    landK: [0, 0],
    fallAt: [-9, -9],
    winner: null,
    endAt: -1,
  }
}

class CrashIt extends RunnerGame<State> {
  private brains: [Brain, Brain] = [newBrain(), newBrain()]
  private rng: Rng | null = null
  /** Sides whose truck crossed the flag during the current step. */
  private crossed: Side[] = []
  /** Cosmetic: each truck's position at the previous step, for interpolation. */
  private prev: [{ x: number; y: number }, { x: number; y: number }] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ]
  private stepped = false
  private alpha = 1

  override init(ctx: GameContext): void {
    super.init(ctx)
    // Effects land where each lane is drawn, also when a half is shown turned (online).
    mirrorFx(ctx, this.frames)
  }

  override render(g: Draw, alpha = 1): void {
    // Hit-stop freezes the world: no blending between two steps that are not moving.
    this.alpha = this.stepped && this.ctx.fx.hitstop === 0 ? alpha : 1
    super.render(g)
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.stepped = false
  }

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return { ...newRace(this.ctx.seed), wins: [0, 0], round: 1 }
  }

  private pressing(side: Side): boolean {
    for (const p of this.ctx.input.player(side).held.values()) if (!inPauseZone(p)) return true
    return false
  }

  private botRng(): Rng {
    this.rng ??= this.ctx.rng.fork()
    return this.rng
  }

  protected override stepWorld(dt: number): boolean {
    const s = this.s
    if (s.phase === 'ready') {
      if (this.time - s.phaseAt >= READY_T) {
        s.phase = 'run'
        s.phaseAt = this.time
        this.ctx.audio.play('roll', 0.8)
      }
      return false
    }
    if (s.phase === 'end') {
      // The race is decided: its winner rolls on while the next one waits.
      this.rollWinner(dt)
      if (this.time - s.endAt >= END_T) this.nextRace()
      return false
    }
    return true
  }

  protected override step(dt: number): void {
    for (const side of [0, 1] as Side[]) {
      const t = this.s.lanes[side]
      this.prev[side].x = t.x
      this.prev[side].y = t.y
    }
    this.stepped = true
    super.step(dt)
    if (this.crossed.length === 0) return
    const [a, b] = this.crossed
    this.crossed = []
    if (this.over) return
    if (a !== undefined && b !== undefined) {
      // Both crossed on the same step: whoever carried more speed past the flag wins.
      const x0 = this.s.lanes[0].x
      const x1 = this.s.lanes[1].x
      const winner = x0 === x1 ? 'draw' : x0 > x1 ? 0 : 1
      if (winner !== 'draw') this.celebrate(winner)
      this.endRace(winner, 'Same step at the flag')
      return
    }
    if (a !== undefined) {
      const t = this.celebrate(a)
      this.endRace(a, `${t.toFixed(1)} s to the flag`)
    }
  }

  /** The race's winner rolls on past the flag and brakes while its ending plays. */
  private rollWinner(dt: number): void {
    const s = this.s
    if (s.winner === null || s.winner === 'draw') return
    const t = s.lanes[s.winner]
    t.v *= Math.exp(-1.6 * dt)
    t.x += t.v * dt
    t.boosting = false
  }

  protected override afterEnd(dt: number): void {
    this.rollWinner(dt)
  }

  /** Confetti and light at the flag for a race's winner. Returns the race time. */
  private celebrate(side: Side): number {
    const fx = this.ctx.fx
    fx.confetti(side)
    fx.flash(SIDE[side].light, 0.3)
    const at = this.at(side, TRUCK_X + TRUCK_HALF, ROAD_Y - 160)
    fx.ring(at.x, at.y, C.yellow, 320)
    fx.sparks(at.x, at.y, C.yellow, 20)
    return this.s.finishT[side] - this.s.phaseAt
  }

  /** A race is decided: the match ends once a side has the target, otherwise the next race follows. */
  private endRace(winner: Side | 'draw', note: string): void {
    const s = this.s
    s.phase = 'end'
    s.endAt = this.time
    s.winner = winner
    // A dead heat counts for nobody: the race is run again.
    if (winner === 'draw') {
      this.ctx.audio.play('draw')
      return
    }
    s.wins[winner]++
    if (s.wins[winner] >= this.target) {
      const score: [number, number] | undefined =
        this.target > 1 ? [s.wins[0], s.wins[1]] : undefined
      this.finish(winner, { score, note, delay: END_T })
      return
    }
    this.ctx.audio.play('score')
  }

  /** The next race of the match: fresh trucks on a course of its own. */
  private nextRace(): void {
    if (this.over) return
    const s = this.s
    Object.assign(s, newRace(this.ctx.rng.int(1, 0x7ffffff0)), {
      phaseAt: this.time,
      round: s.round + 1,
    })
    this.brains = [newBrain(), newBrain()]
    this.ctx.audio.play('count')
  }

  protected stepRunner(side: Side, dt: number): void {
    const s = this.s
    if (s.phase !== 'run') return
    const t = s.lanes[side]
    if (t.finished) return
    const seed = s.seed
    let press = this.taps(side) > 0
    let hold = this.pressing(side)
    if (this.isBot(side)) {
      const intent = drive(t, seed, this.ctx.difficulty, this.botRng(), this.brains[side])
      if (intent.jump) {
        this.botTap(side)
        press = true
      }
      hold = intent.boost
    }
    const airborne = t.y > 0 || t.vy > 0
    const wasBoosting = t.boosting
    const v = t.v
    const vy = t.vy
    const ev = stepTruck(t, seed, dt, press, hold)
    if (ev) this.onEvent(side, t, ev, v)
    if (airborne && t.state === 'run' && t.y <= 0 && t.vy <= 0 && ev !== 'jump')
      this.onLand(side, vy)
    if (t.boosting && !wasBoosting) this.ctx.audio.play('powerup', 1.3)
    // Wheel dust while the truck drives on the road.
    if (t.v > 120 && t.y <= 0 && Math.round(this.time * 60) % 6 === side) {
      const at = this.at(side, TRUCK_X - 90, ROAD_Y - 4)
      this.ctx.fx.puff(at.x, at.y, alpha(C.white, 0.5), 3)
    }
  }

  /** Lane-local point → world, for fx. */
  private at(side: Side, x: number, y: number): { x: number; y: number } {
    return toWorld(this.frames[side], x, y)
  }

  /** A touch-down as heavy as the drop: squash, dust, thud and a jolt for the big ones. */
  private onLand(side: Side, vy: number): void {
    const k = clamp(-vy / 900, 0, 1)
    this.s.landAt[side] = this.time
    this.s.landK[side] = k
    const wheels = this.at(side, TRUCK_X, ROAD_Y - 4)
    this.ctx.audio.play('thud', 1.4 - k * 0.5)
    this.ctx.fx.puff(wheels.x, wheels.y, alpha(C.white, 0.65), Math.round(4 + k * 8))
    if (k > 0.6) {
      this.ctx.fx.shake(0.08 + k * 0.12)
      this.ctx.audio.buzz?.(10)
    }
  }

  private onEvent(side: Side, t: Truck, ev: TruckEvent, v: number): void {
    const fx = this.ctx.fx
    const front = this.at(side, TRUCK_X + TRUCK_HALF - 20, ROAD_Y - t.y - 80)
    const wheels = this.at(side, TRUCK_X, ROAD_Y - 4)
    switch (ev) {
      case 'jump':
        // Faster trucks launch with a deeper boing.
        this.ctx.audio.play('boing', 1.2 - Math.min(0.3, v / 2500))
        fx.puff(wheels.x, wheels.y, alpha(C.white, 0.6), Math.round(4 + v / 150))
        break
      case 'smash': {
        // The harder it hits, the bigger the bang: speed past smashing point drives it all.
        const k = clamp((v - WALL_V) / (BOOST_V - WALL_V), 0, 1)
        this.s.smashAt[side] = this.time
        this.s.smashX[side] = t.x + TRUCK_HALF
        this.ctx.audio.play('explode', 1.05 - k * 0.2 + Math.min(0.2, t.smashed * 0.02))
        this.ctx.audio.buzz?.(Math.round(25 + k * 25))
        const hit = this.at(side, TRUCK_X + TRUCK_HALF, ROAD_Y - 120)
        fx.burst(hit.x, hit.y, '#c2703d', {
          count: Math.round(18 + k * 16),
          speed: 460 + k * 260,
          size: 16,
          kind: 'square',
          gravity: 1200,
        })
        fx.burst(hit.x, hit.y, C.yellow, { count: 12, speed: 420, size: 9, kind: 'spark' })
        fx.puff(hit.x, hit.y, alpha('#ffffff', 0.7), 10)
        fx.ring(hit.x, hit.y, C.yellow, 160 + k * 100)
        fx.shake(0.3 + k * 0.3)
        fx.stop(Math.round(3 + k * 3))
        const above = this.at(side, TRUCK_X + 60, ROAD_Y - 330)
        fx.float(k > 0.8 ? 'SMASH!' : 'Smash!', above.x, above.y, C.yellow, 60 + k * 16, side)
        break
      }
      case 'bump': {
        const k = clamp(v / WALL_V, 0.3, 1)
        this.s.bumpAt[side] = this.time
        this.ctx.audio.buzz?.(Math.round(20 + k * 25))
        this.ctx.audio.play('hit', 1.1 - k * 0.2)
        this.ctx.audio.play('wall', 0.9)
        fx.sparks(front.x, front.y, C.yellow, Math.round(8 + k * 12))
        fx.puff(front.x, front.y, alpha(C.white, 0.7), 8)
        fx.shake(0.2 + k * 0.25)
        fx.stop(Math.round(2 + k * 3))
        break
      }
      case 'fall': {
        this.s.fallAt[side] = this.time
        this.ctx.audio.play('thud')
        this.ctx.audio.play('slide', 0.9)
        const pit = this.at(side, TRUCK_X, ROAD_Y + 60)
        fx.puff(pit.x, pit.y, alpha('#ff9a5c', 0.7), 12)
        fx.shake(0.3)
        break
      }
      case 'finish':
        this.s.finishT[side] = this.time
        this.ctx.audio.play('whoosh', 0.9)
        this.crossed.push(side)
        break
    }
  }

  protected renderLane(
    g: Draw,
    side: Side,
    view: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const s = this.s
    const t = s.lanes[side]
    const p = this.prev[side]
    // Blend toward the latest step, unless the truck jumped back (a new race, a crane).
    const a = Math.abs(t.x - p.x) > 200 ? 1 : this.alpha
    drawLane(g, side, view, {
      truck: { ...t, x: lerp(p.x, t.x, a), y: lerp(p.y, t.y, a) },
      landK: s.landK[side],
      rival: s.lanes[other(side)],
      seed: s.seed,
      time: this.time,
      phase: s.phase,
      since: this.time - s.phaseAt,
      name: this.ctx.names[side],
      bot: this.isBot(side),
      finishT: s.finishT[side] >= 0 ? s.finishT[side] - s.phaseAt : -1,
      smashAt: s.smashAt[side],
      smashX: s.smashX[side],
      bumpAt: s.bumpAt[side],
      landAt: s.landAt[side],
      fallAt: s.fallAt[side],
      winner: s.winner,
      endAt: s.endAt,
      round: s.round,
      wins: s.wins[side],
      rivalWins: s.wins[other(side)],
      target: this.target,
      matchOver: this.over,
    })
  }
}

export default () => new CrashIt()
