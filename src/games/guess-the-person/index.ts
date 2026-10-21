import { frame, toLocal } from '../../core/frame.ts'
import { BaseGame, other, type Side } from '../../core/game.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { tableBackdrop } from '../../engines/board/index.ts'
import { choose, type Move, THINK } from './bot.ts'
import {
  cellAt,
  cellXY,
  chipAt,
  chipXY,
  GUESS,
  GUESS_X,
  hudFrameY,
  renderAnswer,
  renderBoard,
  renderChips,
  renderCount,
  renderEnding,
  renderGuessButton,
  renderHud,
  renderSecret,
  SECRET,
  SECRET_X,
  secretFrameY,
} from './render.ts'
import {
  ask as askRule,
  FACES,
  guess as guessRule,
  makeCast,
  newRound,
  type Round,
} from './rules.ts'

export interface State extends Round {
  turn: Side
  /** The turn side has pressed Guess and is choosing a face. */
  guess: boolean
  /** Game time the turn passes after an answer's flips (-1 = not pending). */
  resolveAt: number
  /** Game time each face last started to flip, per side. */
  flipAt: [number[], number[]]
  /** The last question asked, for the answer bubble (hold = seconds it stays up). */
  last: { side: Side; q: number; yes: boolean; at: number; hold: number } | null
  /** How it ended: who guessed which face, right or wrong, and when. */
  end: { side: Side; i: number; right: boolean; at: number } | null
}

/** The answer bubble shows alone for this long before the faces start to fall. */
const ANSWER_DELAY = 0.95
const FLIP_STEP = 0.075

/**
 * Guess the Person: a board of 24 faces each, a secret face for each side. On
 * your turn ask a trait question (the game answers truthfully from the rival's
 * secret and your impossible faces flip down), or press Guess and name a face.
 */
class GuessThePerson extends BaseGame<State> {
  /** Computer: seconds until its move (-1 = not thinking). */
  private botWait = -1
  private botMove: Move | null = null
  /** Local 2P: whose finger is holding their own secret card. Not state: only this device sees it. */
  private peeking: [boolean, boolean] = [false, false]
  private peekAt: [number, number] = [-10, -10]
  /** Scheduled flip sounds, in game time. */
  private flipSounds: number[] = []

  protected setup(): State {
    const rng = this.ctx.rng
    const faces = makeCast(rng)
    const secret: [number, number] = [rng.int(0, FACES - 1), rng.int(0, FACES - 1)]
    const round = newRound(faces, secret)
    const blank = () => Array.from({ length: FACES }, () => -10)
    return {
      ...round,
      turn: rng.chance(0.5) ? 0 : 1,
      guess: false,
      resolveAt: -1,
      flipAt: [blank(), blank()],
      last: null,
      end: null,
    }
  }

  protected step(dt: number): void {
    const s = this.s
    this.playFlips()
    if (this.ctx.mode === '2p') this.updatePeek()
    if (s.resolveAt >= 0) {
      if (this.time >= s.resolveAt) {
        s.resolveAt = -1
        s.turn = other(s.turn)
        s.guess = false
        this.botWait = -1
        this.botMove = null
        this.ctx.audio.play('swish', 1.1)
      }
      return
    }
    const side = s.turn
    if (this.isBot(side)) {
      this.botStep(side, dt)
      return
    }
    for (const p of this.ctx.input.player(side).downs) {
      if (this.over) return
      this.tap(side, p)
    }
  }

  protected override afterEnd(): void {
    this.playFlips()
  }

  private playFlips(): void {
    while (this.flipSounds.length && (this.flipSounds[0] ?? Infinity) <= this.time) {
      this.flipSounds.shift()
      this.ctx.audio.play('flip', 0.9 + Math.random() * 0.25)
    }
  }

  /** In local 2P a finger held on your own secret card shows it to you. */
  private updatePeek(): void {
    for (const side of [0, 1] as Side[]) {
      const y = secretFrameY(this.ctx.stage, side)
      const now = [...this.ctx.input.player(side).held.values()].some((p) => {
        const l = toLocal(side, p.x, p.y)
        return (
          Math.abs(l.x - SECRET_X) <= SECRET.w / 2 + 16 && Math.abs(l.y - y) <= SECRET.h / 2 + 16
        )
      })
      if (now !== this.peeking[side]) {
        this.peeking[side] = now
        this.peekAt[side] = this.time
        this.ctx.audio.play('flip', now ? 1.15 : 0.9)
      }
    }
  }

  private tap(side: Side, p: Ptr): void {
    const s = this.s
    const l = toLocal(side, p.x, p.y)
    const y = hudFrameY(this.ctx.stage, side)
    if (Math.abs(l.x - GUESS_X) <= GUESS.w / 2 + 6 && Math.abs(l.y - y) <= GUESS.h / 2 + 6) {
      s.guess = !s.guess
      this.ctx.audio.play(s.guess ? 'powerup' : 'tap', s.guess ? 1.2 : 0.9)
      return
    }
    const q = chipAt(l.x, l.y)
    if (q >= 0 && !s.guess) {
      if (s.answers[side][q] !== null) this.ctx.audio.play('error')
      else this.ask(side, q)
      return
    }
    const i = cellAt(l.x, l.y)
    if (i >= 0 && s.guess) {
      if (s.down[side][i]) this.ctx.audio.play('error')
      else this.guessFace(side, i)
    }
  }

  /** The computer thinks for a moment, then asks or guesses. */
  private botStep(side: Side, dt: number): void {
    if (this.botWait < 0) {
      const [lo, hi] = THINK[this.ctx.difficulty]
      this.botWait = this.ctx.rng.range(lo, hi)
      this.botMove = choose(this.s, side, this.ctx.difficulty, this.ctx.rng)
    }
    this.botWait -= dt
    const m = this.botMove
    if (!m) return
    // Arm the Guess button a beat before naming the face, like a player would.
    if (m.kind === 'guess' && !this.s.guess && this.botWait < 0.6) {
      this.s.guess = true
      this.ctx.audio.play('powerup', 1.2)
    }
    if (this.botWait > 0) return
    this.botWait = -1
    this.botMove = null
    if (m.kind === 'ask') this.ask(side, m.q)
    else this.guessFace(side, m.i)
  }

  /** Ask question `q`: the truthful answer, then the impossible faces flip down. */
  private ask(side: Side, q: number): void {
    const s = this.s
    const fx = this.ctx.fx
    const r = askRule(s, side, q)
    const at = frame(side, chipXY(q).x, chipXY(q).y)
    fx.burst(at.x, at.y, r.yes ? C.green : C.redLight, { count: 12, speed: 320, size: 9 })
    this.ctx.audio.play('click', 1.1)
    this.ctx.audio.play(r.yes ? 'coin' : 'thud', r.yes ? 1 : 0.9)
    const last = Math.max(0, r.flipped.length - 1) * FLIP_STEP
    s.last = { side, q, yes: r.yes, at: this.time, hold: ANSWER_DELAY + 0.05 }
    r.flipped.forEach((i, k) => {
      const t = this.time + ANSWER_DELAY + k * FLIP_STEP
      s.flipAt[side][i] = t
      this.flipSounds.push(t)
    })
    if (r.flipped.length === 0) fx.float('No faces fall', at.x, at.y - 90, C.white, 40, side)
    s.resolveAt = this.time + ANSWER_DELAY + last + 0.7
    s.guess = false
  }

  /** Name face `i` on your own board. Right wins; wrong loses. */
  private guessFace(side: Side, i: number): void {
    const s = this.s
    const fx = this.ctx.fx
    const right = guessRule(s, side, i)
    const at = frame(side, cellXY(i).x, cellXY(i).y)
    s.guess = false
    s.end = { side, i, right, at: this.time }
    fx.stop(8)
    fx.ring(at.x, at.y, right ? C.yellow : C.red, 180)
    if (right) {
      fx.burst(at.x, at.y, SIDE[side].main, { count: 36, speed: 620, size: 13 })
      fx.sparks(at.x, at.y, C.yellow, 18)
      fx.flash(SIDE[side].light, 0.3)
      fx.shake(0.4)
      fx.confetti(side)
      this.ctx.audio.play('score')
      this.finish(side, { delay: 2.4 })
      return
    }
    s.down[side][i] = true
    s.flipAt[side][i] = this.time
    fx.burst(at.x, at.y, C.redLight, { count: 22, speed: 420, size: 10 })
    fx.flash(C.red, 0.25)
    fx.shake(0.5)
    this.ctx.audio.play('buzz')
    fx.confetti(other(side))
    this.finish(other(side), { delay: 2.4 })
  }

  /** Whether `side`'s secret is shown to this device. */
  private revealed(side: Side): boolean {
    if (this.over) return true
    if (this.ctx.mode === 'online') return side === this.ctx.local
    if (this.ctx.mode === '2p') return this.peeking[side]
    return !this.isBot(side)
  }

  private pill(side: Side): { text?: string; active: boolean } {
    const s = this.s
    if (s.end) {
      const won = s.end.right ? s.end.side === side : s.end.side !== side
      return {
        text: won ? 'Winner!' : s.end.side === side ? 'Wrong face!' : 'Found you!',
        active: won,
      }
    }
    if (!this.over && s.turn === side && s.resolveAt < 0) {
      if (s.guess) return { text: 'Pick a face', active: true }
      return { text: this.isBot(side) ? 'Thinking…' : 'Ask or guess', active: true }
    }
    return { active: false }
  }

  render(g: Draw): void {
    const s = this.s
    const now = this.time
    tableBackdrop(g)
    // A soft divider between the two boards.
    g.alpha(0.5, () => g.midline())
    const live = !this.over && s.resolveAt < 0
    for (const side of [0, 1] as Side[]) {
      const active = live && s.turn === side
      renderBoard(g, s, now, side, { active, guessing: active && s.guess })
    }
    for (const side of [0, 1] as Side[]) {
      const active = live && s.turn === side
      renderChips(g, s, now, side, active && !s.guess, active && s.guess)
    }
    renderAnswer(g, s, now)
    renderHud(g, this.ctx.names, (side) => this.pill(side))
    for (const side of [0, 1] as Side[]) {
      const turn = live && s.turn === side
      const endFlip = s.end ? s.end.at + 0.2 : -1
      renderSecret(g, this.ctx.stage, s, side, {
        revealed: this.revealed(side),
        peeking: this.peeking[side] && !this.over,
        holdHint: this.ctx.mode === '2p',
        flippedAt: s.end ? endFlip : this.ctx.mode === '2p' ? this.peekAt[side] : -1,
        now,
      })
      renderCount(g, this.ctx.stage, s, side, now)
      renderGuessButton(g, this.ctx.stage, side, turn, turn && s.guess)
    }
    renderEnding(g, s, now)
  }
}

export default () => new GuessThePerson()
