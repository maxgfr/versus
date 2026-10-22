import { DragAim } from '../../core/controls.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { type MatchSpec, other, type Side, STEP } from '../../core/game.ts'
import { banner, pips } from '../../core/hud.ts'
import type { PlayerInput } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { think, TurnGame, type TurnState } from '../../engines/board/index.ts'
import { choose, type Shot } from './bot.ts'
import { type Aim, backdrop, drawBoard, drawTray, type Sink } from './render.ts'
import {
  type Board,
  CENTRE,
  type Event,
  atRest,
  frame,
  newBoard,
  placeStriker,
  POCKETS,
  resolve,
  strike,
  STRIKER_R,
} from './rules.ts'

/** The computer's shot, shown lined up for a beat before it fires (the guest sees it too). */
interface Cue extends Aim {
  at: number
}

interface State extends TurnState {
  board: Board
  /** Boards won, red first. */
  wins: [number, number]
  /** Boards played so far, counting the current one. */
  boardNo: number
  /** Game time the current board started (for its banner). */
  boardAt: number
  /** Held back until this time (a beat after a shot, or between boards). */
  wait: number
  /** Pieces that dropped in the last moments (their sink animation). */
  sinks: Sink[]
  /** Game time each side last added a piece to its tray. */
  trayAt: [number, number]
  /** Game time the current board was won (its banner), -1 while in play. */
  wonAt: number
  /** The computer's shot being lined up, null otherwise. */
  cue: Cue | null
}

/** Boards to win the match: first to N, each board a full game of carrom. */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

/** The striker may be flicked from anywhere on the board. */
const EVERYWHERE = { x: -600, y: -600, w: 2200, h: 3000 }
/** A press this close to the striker can flick it straight off the finger. */
const GRAB = STRIKER_R + 60
/** Finger speed (world units / s) that gives a full-power flick. */
const FLICK_FULL = 4400
/** Slower than this the flick is a nudge, not a shot. */
const FLICK_MIN = 0.1
/** How long the computer shows its line before it shoots (s). */
const CUE_TIME = 0.42

/**
 * A finger flick off the striker: press on it and swipe toward the board.
 * The direction is the swipe; the power is how fast the finger was going.
 */
class Flick {
  id: number | null = null
  private x0 = 0
  private y0 = 0
  /** Smoothed finger speed (world units / s), and its peak this swipe. */
  private v = 0
  peak = 0
  /** True once the swipe heads forward (toward the rival): it is a flick, not a pull. */
  on = false
  dx = 0
  dy = -1
  shot: Aim | null = null

  update(input: PlayerInput, sx: number, sy: number, forward: number): void {
    this.shot = null
    if (this.id === null) {
      const d = input.downs.find((p) => Math.hypot(p.x - sx, p.y - sy) < GRAB)
      if (!d) return
      this.id = d.id
      this.x0 = d.x
      this.y0 = d.y
      this.v = this.peak = 0
      this.on = false
    }
    const held = input.held.get(this.id)
    const p = held ?? input.ups.find((u) => u.id === this.id)
    if (!p) {
      this.cancel()
      return
    }
    const inst = Math.hypot(p.x - p.px, p.y - p.py) / STEP
    this.v = this.v * 0.45 + inst * 0.55
    const mx = p.x - this.x0
    const my = p.y - this.y0
    const m = Math.hypot(mx, my)
    if (!this.on && m > 24 && my * forward > m * 0.25) this.on = true
    if (this.on) {
      this.peak = Math.max(this.peak, this.v)
      if (m > 1) {
        this.dx = mx / m
        this.dy = my / m
      }
    }
    if (held) return
    if (this.on) {
      const power = Math.min(1, this.peak / FLICK_FULL)
      if (power >= FLICK_MIN) this.shot = { dx: this.dx, dy: this.dy, power }
    }
    this.id = null
    this.on = false
  }

  /** The flick as it stands, for the preview (power from the current finger speed). */
  get aim(): Aim | null {
    return this.on ? { dx: this.dx, dy: this.dy, power: Math.min(1, this.v / FLICK_FULL) } : null
  }

  cancel(): void {
    this.id = null
    this.on = false
    this.shot = null
  }
}

class Carrom extends TurnGame<State> {
  private aims: [DragAim, DragAim] = [
    new DragAim(0, EVERYWHERE, 420),
    new DragAim(1, EVERYWHERE, 420),
  ]
  private flicks: [Flick, Flick] = [new Flick(), new Flick()]
  /** Cosmetic: the flick being lined up. */
  private aiming: Aim | null = null
  /** The turn side is sliding the striker along its baseline. */
  private placing = false
  private gone = false
  // Cosmetic only (not synced): last frame's positions for interpolation, the
  // striker's trail and squash, where the striker is drawn while it slides into place.
  private prev: { x: number[]; y: number[]; sx: number; sy: number; n: number } = {
    x: [],
    y: [],
    sx: 0,
    sy: 0,
    n: -1,
  }
  private trail: { x: number; y: number }[] = []
  /** This frame's interpolated piece positions (reused, no per-frame allocation). */
  private ix: number[] = []
  private iy: number[] = []
  private squash = new Spring(1, 420, 13)
  private shownX: number | null = null

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    // In local 2P the player whose turn it is may touch anywhere on the board.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    const first: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    return {
      turn: first,
      board: newBoard(first),
      wins: [0, 0],
      boardNo: 1,
      boardAt: 0,
      wait: 0,
      sinks: [],
      trayAt: [-9, -9],
      wonAt: -1,
      cue: null,
    }
  }

  protected override busy(): boolean {
    const s = this.s
    return (
      s.board.phase === 'roll' || s.board.phase === 'done' || s.cue !== null || this.time < s.wait
    )
  }

  /** Remember where every disc was, so `render` can draw between two steps. */
  private keep(b: Board): void {
    const p = this.prev
    const n = b.pieces.length
    for (let i = 0; i < n; i++) {
      const q = b.pieces[i] as Board['pieces'][number]
      p.x[i] = q.x
      p.y[i] = q.y
    }
    p.n = n
    p.sx = b.striker.x
    p.sy = b.striker.y
  }

  protected override animate(dt: number): void {
    const s = this.s
    const b = s.board
    // The computer's lined-up shot goes when its beat is up.
    if (s.cue && this.time >= s.cue.at + CUE_TIME && b.phase !== 'roll') {
      const c = s.cue
      s.cue = null
      this.flick(c.dx, c.dy, c.power)
    }
    if (b.phase === 'roll') {
      this.keep(b)
      const ev: Event[] = []
      frame(b, ev, dt)
      // A pocketed piece shifts the list: no interpolation this step.
      if (b.pieces.length !== this.prev.n) this.prev.n = -1
      for (const e of ev) this.juice(e)
      if (atRest(b)) {
        const after: Event[] = []
        const before: [number, number] = [b.kept[0], b.kept[1]]
        const shooter = b.turn
        resolve(b, after)
        this.prev.n = -1
        for (const e of after) {
          // The striker's drop was already felt; this is the penalty being paid.
          if (e.kind === 'foul') this.penalty(e.side, before[e.side] > b.kept[e.side])
        }
        for (const side of [0, 1] as Side[])
          if (b.kept[side] > before[side]) s.trayAt[side] = this.time
        if (b.turn === shooter && b.winner === null) {
          floatFor(this.ctx.fx, shooter, 'Again!')
          this.ctx.audio.play('powerup', 1.1)
        }
        s.turn = b.turn
        // A winner is set exactly when the board is over.
        if (b.winner !== null) this.boardOver()
        else s.wait = this.time + 0.35
      }
      return
    }
    this.prev.n = -1
    if (b.phase === 'done' && !this.over && this.time >= s.wait) this.nextBoard()
  }

  /** A board is decided: count it, and finish the match when the target is reached. */
  private boardOver(): void {
    const s = this.s
    const w = s.board.winner as Side
    s.wins[w]++
    s.wonAt = this.time
    const { fx, audio } = this.ctx
    fx.confetti(w)
    fx.flash(SIDE[w].main, 0.3)
    fx.shake(0.4)
    fx.stop(6)
    fx.ring(CENTRE.x, CENTRE.y, SIDE[w].light, 420)
    fx.burst(CENTRE.x, CENTRE.y, SIDE[w].main, {
      count: 40,
      speed: 900,
      size: 16,
      life: 1,
      gravity: 0,
      drag: 2.2,
      colors: [SIDE[w].main, SIDE[w].light, C.yellow, C.white],
      kind: 'square',
    })
    audio.play('coin', 1.1)
    audio.buzz(30)
    if (s.wins[w] >= this.target) {
      this.finish(w, { score: [s.wins[0], s.wins[1]], delay: 2.4 })
      return
    }
    s.wait = this.time + 2.4
  }

  /** The next board, opened by the other side. */
  private nextBoard(): void {
    const s = this.s
    const first = other(s.board.striker.side)
    s.board = newBoard(first)
    s.turn = first
    s.boardNo++
    s.boardAt = this.time
    s.wait = this.time
    s.wonAt = -1
    s.sinks = []
    s.cue = null
    this.shownX = null
    this.ctx.audio.play('whoosh', 0.8)
  }

  protected stepTurn(): void {
    const s = this.s
    const b = s.board
    const side = b.turn
    const input = this.ctx.input.player(side)
    if (b.phase === 'place') {
      const p = input.first()
      if (p) {
        placeStriker(b, p.x)
        this.placing = true
        return
      }
      const t = input.tapped()
      if (t || this.placing) {
        if (t) placeStriker(b, t.x)
        this.placing = false
        b.phase = 'flick'
        this.ctx.audio.play('tick', 1.2)
      }
      return
    }
    if (b.phase === 'flick') {
      const a = this.aims[side]
      const f = this.flicks[side]
      f.update(input, b.striker.x, b.striker.y, side === 0 ? -1 : 1)
      if (f.shot) {
        this.flick(f.shot.dx, f.shot.dy, f.shot.power)
        return
      }
      // A swipe off the striker is a flick; anything else is the slingshot pull.
      if (f.on) {
        a.cancel()
        this.aiming = f.aim
        return
      }
      a.update(input)
      this.aiming = a.aim ? { dx: a.aim.dx, dy: a.aim.dy, power: a.aim.power } : null
      if (a.shot) this.flick(a.shot.dx, a.shot.dy, a.shot.power)
    }
  }

  protected override botPlay(): Promise<void> {
    const b = this.s.board
    const side = b.turn
    const input = { board: b }
    const seed = (this.ctx.rng.next() * 2 ** 31) >>> 0
    return think<Shot>('carrom', input, this.ctx.difficulty, seed).then((shot) => {
      const now = this.s.board
      if (this.gone || now.phase !== 'place' || now.turn !== side) return
      const k = shot ?? choose(input, this.ctx.difficulty, seed)
      // Slide into place and line the shot up; it goes after a beat (see `animate`).
      placeStriker(now, k.x)
      now.phase = 'flick'
      const m = Math.hypot(k.dx, k.dy) || 1
      this.s.cue = { dx: k.dx / m, dy: k.dy / m, power: k.power, at: this.time }
      this.ctx.audio.play('tick', 1.2)
    })
  }

  override destroy(): void {
    this.gone = true
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev.n = -1
    this.trail.length = 0
    this.shownX = null
    this.aiming = null
  }

  private flick(dx: number, dy: number, power: number): void {
    const b = this.s.board
    strike(b, dx, dy, power)
    this.placing = false
    this.aiming = null
    this.s.cue = null
    for (const a of this.aims) a.cancel()
    for (const f of this.flicks) f.cancel()
    // Old sinks are done animating; keep the state small.
    this.s.sinks = this.s.sinks.filter((k) => this.time - k.at < 0.5)
    const { fx, audio } = this.ctx
    const x = b.striker.x
    const y = b.striker.y
    audio.play('slap', 0.75 + power * 0.55)
    if (power > 0.7) audio.play('whoosh', 0.9 + power * 0.4)
    audio.buzz(Math.round(6 + power * 16))
    fx.puff(x, y, 'rgba(255,255,255,0.7)', Math.round(3 + power * 6))
    fx.ring(x, y, alpha(C.white, 0.7), 60 + power * 90)
    // Dust kicked out behind the striker, harder shots kick more.
    fx.burst(x, y, 'rgba(255,240,210,0.8)', {
      count: Math.round(4 + power * 10),
      speed: 200 + power * 500,
      size: 9,
      life: 0.35,
      gravity: 0,
      drag: 3,
      spread: 1.2,
      dir: Math.atan2(-dy, -dx),
    })
    fx.shake(0.04 + power * 0.14)
    if (power > 0.85) fx.stop(2)
    this.squash.kick(-4 - power * 6)
  }

  /** Nearest pocket to a point. */
  private pocketAt(x: number, y: number): { x: number; y: number } {
    let best = POCKETS[0] as { x: number; y: number }
    for (const k of POCKETS)
      if (Math.hypot(k.x - x, k.y - y) < Math.hypot(best.x - x, best.y - y)) best = k
    return best
  }

  /** A foul has been paid: one of the shooter's pocketed pieces goes back to the centre. */
  private penalty(side: Side, returned: boolean): void {
    const { fx, audio } = this.ctx
    audio.play('error')
    audio.buzz(12)
    fx.shake(0.2)
    floatFor(fx, side, returned ? 'Foul! −1' : 'Foul!')
    if (returned) this.s.trayAt[side] = this.time
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const s = this.s
    const turn = s.board.turn
    if (e.kind === 'hit') {
      const k = Math.min(1, e.speed / 1600)
      audio.play('click', 0.75 + k * 0.9)
      if (e.speed > 350) fx.sparks(e.x, e.y, C.white, Math.round(3 + k * 10))
      if (e.speed > 900) fx.shake(0.05 + k * 0.12)
      if (e.speed > 1400) fx.stop(2)
      if (e.speed > 700) audio.buzz(Math.round(5 + k * 10))
      // The striker gives a little on a hard knock.
      const st = s.board.striker
      if (Math.hypot(st.x - e.x, st.y - e.y) < STRIKER_R + 6) this.squash.kick(-2 - k * 5)
    } else if (e.kind === 'rail') {
      const k = Math.min(1, e.speed / 1800)
      audio.play('wall', 0.85 + k * 0.45)
      if (e.speed > 700) fx.puff(e.x, e.y, 'rgba(255,240,210,0.6)', Math.round(2 + k * 4))
      if (e.speed > 1300) fx.shake(0.06)
    } else if (e.kind === 'pot') {
      const k = this.pocketAt(e.x, e.y)
      const hard = Math.min(1, e.speed / 1400)
      s.sinks.push({ x: e.x, y: e.y, px: k.x, py: k.y, owner: e.owner, side: turn, at: this.time })
      const col = e.owner === 2 ? C.pink : SIDE[e.owner as Side].main
      if (e.owner === 2) audio.play('score', 1.2)
      else if (e.owner === turn) audio.play('coin', 0.95 + hard * 0.3)
      else audio.play('pop', 0.9)
      fx.burst(k.x, k.y, col, {
        count: Math.round(16 + hard * 14),
        speed: 420 + hard * 380,
        size: 14,
        life: 0.7,
        gravity: 200,
        drag: 2.4,
        // Out of the pocket, back over the board.
        spread: Math.PI * 0.9,
        dir: Math.atan2(CENTRE.y - k.y, CENTRE.x - k.x),
        colors: [col, C.yellow, C.white],
        kind: 'square',
      })
      fx.ring(k.x, k.y, col, 120 + hard * 60)
      if (e.owner === turn || e.owner === 2) {
        fx.stop(3 + Math.round(hard * 2))
        fx.shake(0.1 + hard * 0.12)
        audio.buzz(14)
      }
      const fy = k.y < MID ? k.y + 110 : k.y - 110
      const fxx = k.x < W / 2 ? k.x + 110 : k.x - 110
      if (e.owner === 2) floatFor(fx, turn, 'Queen!', fxx, fy)
      else if (e.owner === turn) floatFor(fx, turn, '+1', fxx, fy)
      else floatFor(fx, e.owner as Side, 'Back!', fxx, fy)
    } else if (e.kind === 'foul') {
      // The striker itself dropped.
      const k = this.pocketAt(e.x, e.y)
      s.sinks.push({ x: e.x, y: e.y, px: k.x, py: k.y, owner: -1, side: e.side, at: this.time })
      audio.play('splash', 0.8)
      fx.flash(C.red, 0.12)
    }
  }

  render(g: Draw, alpha_: number): void {
    const s = this.s
    const b = s.board
    const p = this.prev
    // Interpolate between the last two steps while the discs roll.
    const roll = b.phase === 'roll' && p.n === b.pieces.length
    const sx = roll ? lerp(p.sx, b.striker.x, alpha_) : b.striker.x
    const sy = roll ? lerp(p.sy, b.striker.y, alpha_) : b.striker.y
    // While it waits on the baseline the striker glides to where it was put.
    const resting = b.phase === 'place' || b.phase === 'flick'
    if (!resting || this.shownX === null) this.shownX = sx
    else this.shownX = lerp(this.shownX, b.striker.x, 0.35)
    const sp = Math.hypot(b.striker.vx, b.striker.vy)
    if (b.phase === 'roll' && !b.striker.gone && sp > 500) this.trail.push({ x: sx, y: sy })
    else if (this.trail.length) this.trail.shift()
    while (this.trail.length > 7) this.trail.shift()
    const sq = this.squash.update(1 / 60)
    const live = (b.phase === 'place' || b.phase === 'flick') && this.time >= s.wait
    // The computer's shot ramps up on screen like a pull being drawn.
    // Online, each phone shows only its own player's aim and coaching.
    const mine = g.viewer === null || g.viewer === b.turn
    let aim = mine ? this.aiming : null
    if (s.cue) {
      const k = Math.min(1, (this.time - s.cue.at) / CUE_TIME)
      aim = { dx: s.cue.dx, dy: s.cue.dy, power: s.cue.power * k * (2 - k) }
    }
    if (roll)
      for (let i = 0; i < b.pieces.length; i++) {
        const q = b.pieces[i] as Board['pieces'][number]
        this.ix[i] = lerp(p.x[i] ?? q.x, q.x, alpha_)
        this.iy[i] = lerp(p.y[i] ?? q.y, q.y, alpha_)
      }
    backdrop(g)
    drawBoard(g, {
      board: b,
      time: this.time,
      aim,
      hint: live && mine && !this.isBot(b.turn) && !s.cue,
      live,
      sinks: s.sinks,
      px: roll ? this.ix : null,
      py: roll ? this.iy : null,
      striker: { x: resting ? this.shownX : sx, y: sy, squash: sq, trail: this.trail },
    })
    this.drawTurns(g, undefined, live)
    for (const side of [0, 1] as Side[]) {
      drawTray(g, side, b.kept[side], this.time, s.trayAt[side])
      if (this.target > 1) pips(g, side, s.wins[side], this.target, { x: W - 130 })
    }
    if (s.wonAt >= 0 && b.winner !== null) {
      const k = Math.min(1, (this.time - s.wonAt) / 0.25)
      const name = this.ctx.names[b.winner]
      const label = s.wins[b.winner] >= this.target ? `${name} wins!` : `${name} takes the board`
      banner(g, undefined, label, MID, { size: 50 + (1 - k) * 24, color: C.yellow })
    } else if (this.time - s.boardAt < 1.8 && s.boardNo > 1) {
      banner(g, undefined, `Board ${s.boardNo}`, MID)
    }
  }
}

export default () => new Carrom()
