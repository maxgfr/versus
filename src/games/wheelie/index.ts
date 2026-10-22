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
  type Bike,
  type BikeEvent,
  BASE_Y,
  BIKE_X,
  heightAt,
  matchWinner,
  metres,
  newBike,
  RUNS,
  stepBike,
  type Terrain,
  terrainFor,
  WHEELBASE,
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
  /** Cosmetic: each bike at the previous step, for interpolation. */
  private prev: [{ d: number; y: number; phi: number }, { d: number; y: number; phi: number }] = [
    { d: 0, y: 0, phi: 0 },
    { d: 0, y: 0, phi: 0 },
  ]
  private stepped = false
  private alpha = 1

  override init(ctx: GameContext): void {
    super.init(ctx)
    // Effects land where each lane is drawn, also when a half is shown turned (online).
    mirrorFx(ctx, this.frames)
  }

  protected override step(dt: number): void {
    for (const side of [0, 1] as Side[]) {
      const b = this.s.bikes[side]
      const p = this.prev[side]
      p.d = b.d
      p.y = b.y
      p.phi = b.phi
    }
    this.stepped = true
    super.step(dt)
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
    const winner = matchWinner(s.runs[0], s.runs[1])
    const tie = best0 === best1 && winner !== 'draw'
    s.phase = 'done'
    s.phaseAt = this.time
    s.winner = winner
    if (winner !== 'draw') {
      this.ctx.fx.confetti(winner)
      this.ctx.fx.flash(SIDE[winner].light, 0.25)
    }
    this.finish(winner, {
      score: [best0, best1],
      note: tie
        ? 'Equal best: the total decides'
        : this.runs === 1
          ? 'Single run'
          : `Best of ${WORDS[this.runs] ?? this.runs} runs`,
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
      ? drive(b, t, this.ctx.difficulty, this.botRng(), this.brains[side])
      : this.pressing(side)
    const before = Math.floor(b.wheelie / 1000)
    const vy = b.vy
    const om = b.om
    const ev = stepBike(b, t, dt, thr)
    if (Math.floor(b.wheelie / 1000) > before) this.milestone(side, b, t)
    if (ev) this.onEvent(side, b, t, ev, vy, om)
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

  private onEvent(side: Side, b: Bike, t: Terrain, ev: BikeEvent, vy: number, om: number): void {
    const fx = this.ctx.fx
    const contact = this.at(side, BIKE_X, BASE_Y - heightAt(t, b.d))
    const above = this.at(side, BIKE_X + 120, BASE_Y - heightAt(t, b.d) - 260)
    switch (ev) {
      case 'lift':
        this.ctx.audio.play('whoosh', 1.1)
        fx.float('Wheelie!', above.x, above.y, C.yellow, 60, side)
        fx.puff(contact.x, contact.y, alpha(C.white, 0.6), 6)
        break
      case 'land': {
        // Off a crest and back down: as hard as the drop.
        const k = clamp(-vy / 700, 0, 1)
        this.ctx.audio.play('thud', 1.1 - k * 0.3)
        fx.puff(contact.x, contact.y, alpha(C.white, 0.7), Math.round(5 + k * 8))
        fx.shake(0.06 + k * 0.16)
        if (k > 0.6) this.ctx.audio.buzz?.(12)
        break
      }
      case 'flip': {
        // Going over fast (pitch rate, speed) is the bigger wipe-out.
        const k = clamp(Math.abs(om) / 3 + b.v / 800, 0.3, 1)
        b.endT = this.time
        this.ctx.audio.play('hit', 1.1 - k * 0.25)
        this.ctx.audio.play('thud')
        this.ctx.audio.buzz?.(Math.round(30 + k * 30))
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
        fx.shake(0.3 + k * 0.3)
        fx.stop(Math.round(4 + k * 4))
        break
      }
      case 'dropped': {
        // The front slams down as fast as it was falling.
        const k = clamp(-om / 2.5, 0.3, 1)
        b.endT = this.time
        this.ctx.audio.play('thud', 0.95 - k * 0.2)
        this.ctx.audio.play('slap', 0.9)
        this.ctx.audio.buzz?.(Math.round(18 + k * 20))
        const front = this.at(side, BIKE_X + WHEELBASE, BASE_Y - heightAt(t, b.d + WHEELBASE))
        fx.puff(front.x, front.y, alpha(C.white, 0.8), 14)
        fx.burst(front.x, front.y, '#a06d43', {
          count: Math.round(8 + k * 8),
          speed: 300 + k * 160,
          size: 10,
          kind: 'square',
        })
        fx.shake(0.15 + k * 0.25)
        fx.stop(Math.round(2 + k * 3))
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
    const b = s.bikes[side]
    const p = this.prev[side]
    // Blend toward the latest step, unless a new run just started.
    const a = Math.abs(b.d - p.d) > 200 ? 1 : this.alpha
    drawLane(g, side, view, {
      bike: { ...b, d: lerp(p.d, b.d, a), y: lerp(p.y, b.y, a), phi: lerp(p.phi, b.phi, a) },
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
