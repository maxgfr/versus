import { other, type Side } from '../../core/game.ts'
import type { Ptr } from '../../core/input.ts'
import type { Rng } from '../../core/rng.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE } from '../../core/render/palette.ts'
import { RunnerGame, toWorld } from '../../engines/runner/index.ts'
import { type Brain, drive, newBrain } from './bot.ts'
import { drawLane } from './render.ts'
import {
  ROAD_Y,
  TRUCK_HALF,
  TRUCK_X,
  type Truck,
  type TruckEvent,
  newTruck,
  stepTruck,
} from './rules.ts'

type Pair = [number, number]

export interface State {
  lanes: [Truck, Truck]
  phase: 'ready' | 'run'
  phaseAt: number
  /** Game time each truck crossed the flag, or -1. */
  finishT: Pair
  /** Animation stamps per side, so every screen plays the same moments. */
  smashAt: Pair
  /** Course x of the last wall each side smashed. */
  smashX: Pair
  bumpAt: Pair
  landAt: Pair
  fallAt: Pair
  winner: Side | 'draw' | null
  endAt: number
}

/** A beat after the shell's 3-2-1 to read the rules. */
const READY_T = 1.4
const END_T = 2.2
/** The pause button sits at the left edge near the midline: presses there are not boost. */
const inPauseZone = (p: Ptr): boolean => p.x < 120 && p.y > 700 && p.y < 1100

class CrashIt extends RunnerGame<State> {
  private brains: [Brain, Brain] = [newBrain(), newBrain()]
  private rng: Rng | null = null
  /** Sides whose truck crossed the flag during the current step. */
  private crossed: Side[] = []

  protected setup(): State {
    return {
      lanes: [newTruck(), newTruck()],
      phase: 'ready',
      phaseAt: 0,
      finishT: [-1, -1],
      smashAt: [-9, -9],
      smashX: [0, 0],
      bumpAt: [-9, -9],
      landAt: [-9, -9],
      fallAt: [-9, -9],
      winner: null,
      endAt: -1,
    }
  }

  private pressing(side: Side): boolean {
    for (const p of this.ctx.input.player(side).held.values()) if (!inPauseZone(p)) return true
    return false
  }

  private botRng(): Rng {
    this.rng ??= this.ctx.rng.fork()
    return this.rng
  }

  protected override stepWorld(_dt: number): boolean {
    const s = this.s
    if (s.phase === 'ready') {
      if (this.time - s.phaseAt >= READY_T) {
        s.phase = 'run'
        s.phaseAt = this.time
        this.ctx.audio.play('roll', 0.8)
      }
      return false
    }
    return true
  }

  protected override step(dt: number): void {
    super.step(dt)
    if (this.crossed.length === 0) return
    const [a, b] = this.crossed
    this.crossed = []
    if (this.over) return
    const s = this.s
    const finisher = (side: Side) => {
      const fx = this.ctx.fx
      fx.confetti(side)
      fx.flash(SIDE[side].light, 0.3)
      const at = this.at(side, TRUCK_X + TRUCK_HALF, ROAD_Y - 160)
      fx.ring(at.x, at.y, C.yellow, 320)
      fx.sparks(at.x, at.y, C.yellow, 20)
      return s.finishT[side] - s.phaseAt
    }
    s.endAt = this.time
    if (a !== undefined && b !== undefined) {
      // Both crossed on the same step: whoever carried more speed past the flag wins.
      const x0 = s.lanes[0].x
      const x1 = s.lanes[1].x
      const winner = x0 === x1 ? 'draw' : x0 > x1 ? 0 : 1
      if (winner !== 'draw') finisher(winner)
      s.winner = winner
      this.finish(winner, { note: 'Same step at the flag', delay: END_T })
      return
    }
    if (a !== undefined) {
      const t = finisher(a)
      s.winner = a
      this.finish(a, { note: `${t.toFixed(1)} s to the flag`, delay: END_T })
    }
  }

  /** While the result waits: the winner rolls on past the flag and brakes. */
  protected override afterEnd(dt: number): void {
    const s = this.s
    if (s.winner === null || s.winner === 'draw') return
    const t = s.lanes[s.winner]
    t.v *= Math.exp(-1.6 * dt)
    t.x += t.v * dt
    t.boosting = false
  }

  protected stepRunner(side: Side, dt: number): void {
    const s = this.s
    if (s.phase !== 'run') return
    const t = s.lanes[side]
    if (t.finished) return
    const seed = this.ctx.seed
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
    const ev = stepTruck(t, seed, dt, press, hold)
    if (ev) this.onEvent(side, t, ev)
    if (airborne && t.state === 'run' && t.y <= 0 && t.vy <= 0 && ev !== 'jump') this.onLand(side)
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

  private onLand(side: Side): void {
    this.s.landAt[side] = this.time
    const wheels = this.at(side, TRUCK_X, ROAD_Y - 4)
    this.ctx.audio.play('thud', 1.2)
    this.ctx.fx.puff(wheels.x, wheels.y, alpha(C.white, 0.65), 8)
  }

  private onEvent(side: Side, t: Truck, ev: TruckEvent): void {
    const fx = this.ctx.fx
    const front = this.at(side, TRUCK_X + TRUCK_HALF - 20, ROAD_Y - t.y - 80)
    const wheels = this.at(side, TRUCK_X, ROAD_Y - 4)
    switch (ev) {
      case 'jump':
        this.ctx.audio.play('boing', 1.05)
        fx.puff(wheels.x, wheels.y, alpha(C.white, 0.6), 6)
        break
      case 'smash': {
        this.s.smashAt[side] = this.time
        this.s.smashX[side] = t.x + TRUCK_HALF
        this.ctx.audio.play('explode', 0.95 + Math.min(0.2, t.smashed * 0.02))
        this.ctx.audio.buzz?.(35)
        const hit = this.at(side, TRUCK_X + TRUCK_HALF, ROAD_Y - 120)
        fx.burst(hit.x, hit.y, '#c2703d', {
          count: 26,
          speed: 560,
          size: 16,
          kind: 'square',
          gravity: 1200,
        })
        fx.burst(hit.x, hit.y, C.yellow, { count: 12, speed: 420, size: 9, kind: 'spark' })
        fx.puff(hit.x, hit.y, alpha('#ffffff', 0.7), 10)
        fx.shake(0.45)
        fx.stop(4)
        const above = this.at(side, TRUCK_X + 60, ROAD_Y - 330)
        fx.float('Smash!', above.x, above.y, C.yellow, 68, side)
        break
      }
      case 'bump':
        this.s.bumpAt[side] = this.time
        this.ctx.audio.buzz?.(40)
        this.ctx.audio.play('hit')
        this.ctx.audio.play('wall', 0.9)
        fx.sparks(front.x, front.y, C.yellow, 16)
        fx.puff(front.x, front.y, alpha(C.white, 0.7), 8)
        fx.shake(0.4)
        fx.stop(5)
        break
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
    drawLane(g, side, view, {
      truck: s.lanes[side],
      rival: s.lanes[other(side)],
      seed: this.ctx.seed,
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
    })
  }
}

export default () => new CrashIt()
