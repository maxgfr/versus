import { type MatchSpec, other, type Side } from '../../core/game.ts'
import type { Ptr } from '../../core/input.ts'
import type { Rng } from '../../core/rng.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE } from '../../core/render/palette.ts'
import { RunnerGame, toWorld } from '../../engines/runner/index.ts'
import { type Brain, drive, newBrain } from './bot.ts'
import { drawLane } from './render.ts'
import {
  type Bike,
  type BikeEvent,
  BASE_Y,
  BIKE_X,
  heightAt,
  metres,
  newBike,
  RUNS,
  stepBike,
  type Terrain,
  terrainFor,
  WHEELBASE,
  wheelieAngle,
} from './rules.ts'
import { countFigure } from './ui.ts'

export interface State {
  bikes: [Bike, Bike]
  /** Metres of every finished run, per side. */
  runs: [number[], number[]]
  run: number
  phase: 'ready' | 'run' | 'over' | 'done'
  phaseAt: number
  /** Length of this ready beat: short after the shell's own 3-2-1, a full countdown before run 2. */
  readyT: number
  winner: Side | 'draw' | null
}

const FIRST_READY = 1.3
const COUNT_READY = 2.4
const OVER_T = 2.6
const DONE_T = 2.4
/** Run counts from one to five, spelled out in the result note. */
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five']
/** The pause button sits at the left edge near the midline: presses there are not throttle. */
const inPauseZone = (p: Ptr): boolean => p.x < 120 && p.y > 700 && p.y < 1100

/** A match is a fixed number of runs each: the players pick it before the game. */
export const match: MatchSpec = { unit: 'rounds', default: RUNS, min: 1, max: 5 }

class Wheelie extends RunnerGame<State> {
  private get runs(): number {
    return this.ctx.target || match.default
  }

  private brains: [Brain, Brain] = [newBrain(), newBrain()]
  private rng: Rng | null = null

  protected setup(): State {
    return {
      bikes: [newBike(), newBike()],
      runs: [[], []],
      run: 0,
      phase: 'ready',
      phaseAt: 0,
      readyT: FIRST_READY,
      winner: null,
    }
  }

  private terrain(): Terrain {
    return terrainFor(this.ctx.seed, this.s.run)
  }

  /** Human holding a finger on this side's half (outside the pause button). */
  private pressing(side: Side): boolean {
    for (const p of this.ctx.input.player(side).held.values()) if (!inPauseZone(p)) return true
    return false
  }

  protected override stepWorld(_dt: number): boolean {
    const s = this.s
    const since = this.time - s.phaseAt
    if (s.phase === 'ready') {
      if (s.run > 0) {
        const left = s.readyT - since
        const n = countFigure(left, s.readyT)
        if (n !== countFigure(left + 1 / 60, s.readyT))
          this.ctx.audio.play(n === 0 ? 'go' : 'count')
      }
      if (since >= s.readyT) {
        s.phase = 'run'
        s.phaseAt = this.time
        this.ctx.audio.play('roll', 0.9)
      }
      return false
    }
    if (s.phase === 'done') return false
    if (s.phase === 'run') {
      if (s.bikes.every((b) => b.end)) this.closeRun()
      return true
    }
    if (since >= OVER_T) {
      if (s.run + 1 < this.runs) this.nextRun()
      else this.conclude()
    }
    return false
  }

  /** Both bikes are down: bank the metres of this run. */
  private closeRun(): void {
    const s = this.s
    for (const side of [0, 1] as Side[]) {
      const runs = s.runs[side]
      const m = metres(s.bikes[side].wheelie)
      // A new personal best gets its own little fanfare.
      if (runs.length > 0 && m > Math.max(...runs)) {
        const at = this.at(side, 610, 150)
        this.ctx.fx.float('New best!', at.x, at.y, C.yellow, 60, side)
      }
      runs.push(m)
    }
    s.phase = 'over'
    s.phaseAt = this.time
    this.ctx.audio.play('score')
  }

  private nextRun(): void {
    const s = this.s
    s.run++
    s.bikes = [newBike(), newBike()]
    this.brains = [newBrain(), newBrain()]
    s.phase = 'ready'
    s.phaseAt = this.time
    s.readyT = COUNT_READY
  }

  private conclude(): void {
    const s = this.s
    const best0 = Math.max(0, ...s.runs[0])
    const best1 = Math.max(0, ...s.runs[1])
    const winner = best0 === best1 ? 'draw' : best0 > best1 ? 0 : 1
    s.phase = 'done'
    s.phaseAt = this.time
    s.winner = winner
    if (winner !== 'draw') {
      this.ctx.fx.confetti(winner)
      this.ctx.fx.flash(SIDE[winner].light, 0.25)
    }
    this.finish(winner, {
      score: [best0, best1],
      note: this.runs === 1 ? 'Single run' : `Best of ${WORDS[this.runs] ?? this.runs} runs`,
      delay: DONE_T,
    })
  }

  protected stepRunner(side: Side, dt: number): void {
    const s = this.s
    if (s.phase !== 'run') return
    const b = s.bikes[side]
    if (b.end) return
    const t = this.terrain()
    const thr = this.isBot(side)
      ? drive(b, wheelieAngle(t, b), this.ctx.difficulty, this.botRng(), this.brains[side])
      : this.pressing(side)
    const before = Math.floor(b.wheelie / 1000)
    const ev = stepBike(b, t, dt, thr)
    if (Math.floor(b.wheelie / 1000) > before) this.milestone(side, b, t)
    if (ev) this.onEvent(side, b, t, ev)
    // Dust kicks off the back wheel while it is driving on the ground.
    if (b.thr && b.y <= 0.5 && Math.round(this.time * 60) % 5 === side) {
      const at = this.at(side, BIKE_X - 40, BASE_Y - heightAt(t, b.d) + 4)
      this.ctx.fx.puff(at.x, at.y, alpha(C.white, 0.55), 3)
    }
  }

  private botRng(): Rng {
    this.rng ??= this.ctx.rng.fork()
    return this.rng
  }

  /** Lane-local point → world, for fx. */
  private at(side: Side, x: number, y: number): { x: number; y: number } {
    return toWorld(this.frames[side], x, y)
  }

  private milestone(side: Side, b: Bike, t: Terrain): void {
    // Behind the rider's head, left of the balance gauge (x ≥ 280) and clear of
    // the cards on the right; floored so its 90-unit drift stays under the run pips.
    const at = this.at(side, 150, Math.max(230, BASE_Y - heightAt(t, b.d) - 400))
    this.ctx.audio.play('coin', 1 + Math.min(0.6, b.wheelie / 40000))
    this.ctx.fx.float(`${metres(b.wheelie)} m`, at.x, at.y, SIDE[side].light, 52, side)
  }

  private onEvent(side: Side, b: Bike, t: Terrain, ev: BikeEvent): void {
    const fx = this.ctx.fx
    const contact = this.at(side, BIKE_X, BASE_Y - heightAt(t, b.d))
    const above = this.at(side, BIKE_X + 120, BASE_Y - heightAt(t, b.d) - 260)
    switch (ev) {
      case 'lift':
        this.ctx.audio.play('whoosh', 1.1)
        fx.float('Wheelie!', above.x, above.y, C.yellow, 60, side)
        fx.puff(contact.x, contact.y, alpha(C.white, 0.6), 6)
        break
      case 'land':
        this.ctx.audio.play('thud', 0.9)
        fx.puff(contact.x, contact.y, alpha(C.white, 0.7), 8)
        fx.shake(0.12)
        break
      case 'flip': {
        b.endT = this.time
        this.ctx.audio.play('hit')
        this.ctx.audio.play('thud')
        this.ctx.audio.buzz?.(50)
        const back = this.at(side, BIKE_X - 30, BASE_Y - heightAt(t, b.d) - 60)
        fx.burst(back.x, back.y, SIDE[side].main, { count: 22, speed: 520, size: 14 })
        fx.sparks(back.x, back.y, C.yellow, 16)
        fx.burst(back.x, back.y, C.white, {
          count: 5,
          kind: 'emoji',
          glyph: '💫',
          size: 46,
          speed: 300,
          gravity: 500,
          life: 1,
        })
        fx.puff(contact.x, contact.y, alpha(C.white, 0.75), 12)
        fx.shake(0.55)
        fx.stop(7)
        break
      }
      case 'dropped': {
        b.endT = this.time
        this.ctx.audio.play('thud', 0.8)
        this.ctx.audio.play('slap', 0.9)
        this.ctx.audio.buzz?.(30)
        const front = this.at(side, BIKE_X + WHEELBASE, BASE_Y - heightAt(t, b.d + WHEELBASE))
        fx.puff(front.x, front.y, alpha(C.white, 0.8), 14)
        fx.burst(front.x, front.y, '#a06d43', { count: 12, speed: 380, size: 10, kind: 'square' })
        fx.shake(0.3)
        fx.stop(4)
        break
      }
      case 'capped':
        b.endT = this.time
        this.ctx.audio.play('coin', 1.25)
        fx.ring(above.x, above.y, C.yellow, 200)
        fx.sparks(above.x, above.y, C.yellow, 14)
        break
    }
  }

  protected renderLane(
    g: Draw,
    side: Side,
    view: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const s = this.s
    const best = (k: Side) => Math.max(0, ...s.runs[k])
    drawLane(g, side, view, {
      bike: s.bikes[side],
      terrain: this.terrain(),
      time: this.time,
      phase: s.phase,
      since: this.time - s.phaseAt,
      readyLeft: s.readyT - (this.time - s.phaseAt),
      readyT: s.readyT,
      run: s.run,
      history: s.runs[side],
      rival: metres(s.bikes[other(side)].wheelie),
      name: this.ctx.names[side],
      bot: this.isBot(side),
      winner: s.winner,
      best: [best(side), best(other(side))],
      runs: this.runs,
    })
  }
}

export default () => new Wheelie()
