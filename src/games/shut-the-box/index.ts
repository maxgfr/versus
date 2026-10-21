import { frame } from '../../core/frame.ts'
import { other, type Side } from '../../core/game.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { tableBackdrop, TurnGame } from '../../engines/board/index.ts'
import { buttonHit, ROLL_TIME } from '../../engines/dice/index.ts'
import { decide } from './bot.ts'
import {
  ACTION,
  BOX,
  diceTray,
  FALL,
  FLIP_STEP,
  overDice,
  renderShut,
  SUM_AT,
  tileAt,
  tileX,
} from './render.ts'
import { ALL_OPEN, canShut, countOf, diceCount, sumOf, TILES, tileBit } from './rules.ts'

export interface State {
  turn: Side
  /** Open tiles per side: bit i is tile i + 1. */
  open: [number, number]
  /** Final score per side once that side has played its turn. */
  scores: [number | null, number | null]
  /** When each side's turn ended (its score stamp lands then). */
  doneAt: [number, number]
  /** Dice showing for the current roll (one or two values). */
  dice: number[]
  /** Total to shut this step (0 = nothing rolled yet). */
  roll: number
  /** Tiles picked so far for the shut (bitmask), and when each was picked (lift tween). */
  sel: number
  selAt: number[]
  rolledAt: number
  /** Tiles that are flipping down, whose side, and when the flip began. */
  flipMask: number
  flipSide: Side
  flipAt: number
  /** The roll cannot be matched: the turn ends at `holdUntil`. */
  stuck: boolean
  holdUntil: number
  /** When the current player's turn began (for the hand-over banner). */
  turnAt: number
  /** The game is decided. */
  end: { at: number; winner: Side | 'draw' } | null
}

/** Centre of a side's box, in world coordinates. */
const boxCentre = (side: Side) => frame(side, W / 2, (BOX.top + BOX.base) / 2)

class ShutTheBox extends TurnGame<State> {
  /** Host-only bookkeeping for effects that fire when an animation lands. */
  private landedAt = -10
  private flapsDone = 0

  protected setup(): State {
    return {
      turn: 0,
      open: [ALL_OPEN, ALL_OPEN],
      scores: [null, null],
      doneAt: [-10, -10],
      dice: [1, 1],
      roll: 0,
      sel: 0,
      selAt: Array<number>(TILES).fill(-10),
      rolledAt: -10,
      flipMask: 0,
      flipSide: 0,
      flipAt: -10,
      stuck: false,
      holdUntil: 0,
      turnAt: -10,
      end: null,
    }
  }

  protected override busy(): boolean {
    return this.time - this.s.rolledAt < ROLL_TIME || this.time < this.s.holdUntil
  }

  /** Lands dice and flaps with their sounds, and ends a turn whose roll had no move. */
  protected override animate(_dt: number): void {
    this.effects()
    if (this.s.stuck && this.time >= this.s.holdUntil) this.endTurn()
  }

  protected override afterEnd(_dt: number): void {
    this.effects()
  }

  private effects(): void {
    const s = this.s
    const fx = this.ctx.fx
    // Dice settle.
    if (s.rolledAt !== this.landedAt && this.time - s.rolledAt >= ROLL_TIME) {
      this.landedAt = s.rolledAt
      this.ctx.audio.play('place', 0.9)
      const p = frame(s.turn, SUM_AT.x, SUM_AT.y)
      if (s.stuck) {
        this.ctx.audio.play('buzz')
        fx.shake(0.35)
        fx.puff(p.x, p.y, 'rgba(255,255,255,0.4)', 6)
      } else {
        fx.ring(p.x, p.y, C.yellow, 110)
        this.ctx.audio.play('pop', 1.2)
      }
    }
    // Flaps slap down one after another.
    if (s.flipMask) {
      let order = 0
      for (let i = 0; i < TILES; i++) {
        const bit = tileBit(i + 1)
        if (!(s.flipMask & bit)) continue
        const at = s.flipAt + order * FLIP_STEP + FALL
        order++
        if (this.flapsDone & bit || this.time < at) continue
        this.flapsDone |= bit
        const p = frame(s.flipSide, tileX(i) + BOX.tw / 2, BOX.base - 10)
        fx.puff(p.x, p.y, 'rgba(255,240,210,0.45)', 4)
        fx.burst(p.x, p.y, C.cream, { count: 6, speed: 260, size: 7, kind: 'spark' })
        fx.shake(0.12)
        this.ctx.audio.play('slap', 0.9 + i * 0.05)
      }
    }
  }

  protected stepTurn(_dt: number, tap: Ptr | undefined): void {
    if (!tap) return
    const s = this.s
    const side = s.turn
    if (s.roll === 0) {
      if (buttonHit(ACTION, side, tap.x, tap.y) || overDice(tap.x, tap.y)) this.roll()
      return
    }
    const i = tileAt(side, tap.x, tap.y)
    if (i >= 0) {
      this.pick(i)
      return
    }
    if (buttonHit(ACTION, side, tap.x, tap.y)) this.confirm()
  }

  protected botPlay(): void {
    const s = this.s
    if (s.roll === 0) {
      this.roll()
      return
    }
    // Lift the chosen tiles first so the move reads, then shut them on the next beat.
    if (s.sel !== 0 && sumOf(s.sel) === s.roll) {
      this.shut(s.sel)
      return
    }
    const mask = decide(s.open[s.turn], s.roll, this.ctx.difficulty, this.ctx.rng)
    if (mask === undefined) return
    s.sel = mask
    for (let i = 0; i < TILES; i++) if (mask & tileBit(i + 1)) s.selAt[i] = this.time + i * 0.04
    this.ctx.audio.play('pop', 1.1)
  }

  protected override botDelay(): number {
    return this.s.sel !== 0 ? 0.45 : super.botDelay()
  }

  private roll(): void {
    const s = this.s
    const side = s.turn
    const open = s.open[side]
    s.dice = Array.from({ length: diceCount(open) }, () => this.ctx.rng.int(1, 6))
    s.roll = s.dice.reduce((a, b) => a + b, 0)
    s.sel = 0
    s.rolledAt = this.time
    s.flipMask = 0
    this.ctx.audio.play('roll')
    this.ctx.fx.shake(0.1)
    for (const slot of diceTray(s.dice.length).slots) {
      this.ctx.fx.puff(slot.x, slot.y + 60, 'rgba(255,255,255,0.35)', 3)
    }
    if (!canShut(open, s.roll)) {
      // Shown once the dice land (see effects / render), then the turn ends.
      s.stuck = true
      s.holdUntil = this.time + ROLL_TIME + 1.5
    }
  }

  private pick(i: number): void {
    const s = this.s
    const side = s.turn
    const bit = tileBit(i + 1)
    if (!(s.open[side] & bit)) return
    const p = frame(side, tileX(i) + BOX.tw / 2, BOX.base - 120)
    if (s.sel & bit) {
      s.sel &= ~bit
      this.ctx.audio.play('tap', 0.9)
      return
    }
    const next = sumOf(s.sel) + i + 1
    if (next > s.roll) {
      this.ctx.audio.play('error')
      this.ctx.fx.shake(0.1)
      this.ctx.fx.float(`${next} > ${s.roll}`, p.x, p.y, C.white, 44, side)
      return
    }
    s.sel |= bit
    s.selAt[i] = this.time
    if (next === s.roll) {
      this.ctx.audio.play('powerup', 1.2)
      const b = frame(side, ACTION.x, ACTION.y)
      this.ctx.fx.ring(b.x, b.y, C.yellow, 200)
    } else this.ctx.audio.play('pop', 1 + i * 0.03)
    this.ctx.fx.sparks(p.x, p.y, C.yellow, 6)
  }

  private confirm(): void {
    const s = this.s
    if (s.sel !== 0 && sumOf(s.sel) === s.roll) this.shut(s.sel)
    else {
      this.ctx.audio.play('error')
      this.ctx.fx.shake(0.12)
    }
  }

  private shut(mask: number): void {
    const s = this.s
    const side = s.turn
    const after = s.open[side] & ~mask
    const k = countOf(mask)
    s.open[side] = after
    s.sel = 0
    s.roll = 0
    s.flipMask = mask
    s.flipSide = side
    s.flipAt = this.time
    this.flapsDone = 0
    s.holdUntil = this.time + FALL + 0.15 + FLIP_STEP * k
    const c = boxCentre(side)
    this.ctx.fx.float(`-${sumOf(mask)}`, c.x, c.y, C.yellow, 80, side)
    this.ctx.audio.play('flip')
    if (after === 0) this.shutAll(side)
  }

  /** Every tile is down: an instant win. */
  private shutAll(side: Side): void {
    const s = this.s
    const o = other(side)
    s.scores[side] = 0
    s.doneAt[side] = this.time + 0.5
    const rest = s.scores[o] ?? sumOf(s.open[o])
    const score: [number, number] = side === 0 ? [0, rest] : [rest, 0]
    s.end = { at: this.time, winner: side }
    const fx = this.ctx.fx
    fx.confetti(side)
    fx.flash(C.yellow, 0.45)
    fx.shake(0.6)
    fx.stop(6)
    const c = boxCentre(side)
    fx.ring(c.x, c.y, C.yellow, 520)
    fx.burst(c.x, c.y, C.yellow, { count: 40, speed: 900, size: 14, kind: 'square' })
    fx.float('Shut the box!', W / 2, side === 0 ? MID + 150 : MID - 150, C.yellow, 76, side)
    this.ctx.audio.play('powerup')
    this.finish(side, { score, note: 'Shut the box!', delay: 3 })
  }

  /** The turn is over: score the open tiles; blue's end decides the game. */
  private endTurn(): void {
    const s = this.s
    const side = s.turn
    s.stuck = false
    s.roll = 0
    s.sel = 0
    const pts = sumOf(s.open[side])
    s.scores[side] = pts
    s.doneAt[side] = this.time
    const fx = this.ctx.fx
    const c = boxCentre(side)
    fx.puff(c.x, c.y, 'rgba(255,255,255,0.35)', 8)
    fx.shake(0.25)
    this.ctx.audio.play('thud')
    if (side === 0) {
      s.turn = 1
      s.turnAt = this.time + 0.5
      s.holdUntil = this.time + 0.9
      this.ctx.audio.play('whoosh')
      return
    }
    const a = s.scores[0] ?? 0
    const b = pts
    const winner = a === b ? 'draw' : a < b ? 0 : 1
    s.end = { at: this.time, winner }
    if (winner !== 'draw') {
      fx.confetti(winner)
      const w = boxCentre(winner)
      fx.burst(w.x, w.y, C.yellow, { count: 26, speed: 700, size: 12, kind: 'square' })
      fx.ring(w.x, w.y, SIDE[winner].light, 360)
    }
    this.finish(winner, { score: [a, b], delay: 2.8 })
  }

  render(g: Draw): void {
    tableBackdrop(g)
    renderShut(g, this.s, this.time, this.over)
    this.drawTurns(g)
  }
}

export default () => new ShutTheBox()
