import { frame, toLocal } from '../../core/frame.ts'
import { BaseGame, other, type MatchSpec, type Side } from '../../core/game.ts'
import { banner, pips } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import type { Rng } from '../../core/rng.ts'
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
  /** Who started the current round; the other side starts the next one. */
  starter: Side
  /** Round wins so far. */
  wins: [number, number]
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
const ANSWER_DELAY = 0.75
const FLIP_STEP = 0.065
/** Seconds the ending of a round shows before the next round (or the result) comes. */
const END_DELAY = 2.4

/** Match length: first to N round wins, each round one secret face per side. Default: a single round. */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

const blankFlips = (): number[] => Array.from({ length: FACES }, () => -10)

/** A new cast with a secret face for each side. */
function dealRound(rng: Rng): Round {
  const faces = makeCast(rng)
  const secret: [number, number] = [rng.int(0, FACES - 1), rng.int(0, FACES - 1)]
  return newRound(faces, secret)
}

/** The per-round state, for a round that `starter` opens. */
function roundStart(starter: Side): Omit<State, keyof Round | 'wins'> {
  return {
    starter,
    turn: starter,
    guess: false,
    resolveAt: -1,
    flipAt: [blankFlips(), blankFlips()],
    last: null,
    end: null,
  }
}

/**
 * Guess the Person: a board of 24 faces each, a secret face for each side. On
 * your turn ask a trait question (the game answers truthfully from the rival's
 * secret and your impossible faces flip down), or press Guess and name a face.
 * A right guess wins the round, a wrong one hands it to the rival.
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
  /** Effects timed to land later (host side; the guest gets them as fx). */
  private queue: { at: number; run: () => void }[] = []

  private later(at: number, run: () => void): void {
    this.queue.push({ at, run })
    this.queue.sort((a, b) => a.at - b.at)
  }

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const rng = this.ctx.rng
    const round = dealRound(rng)
    const starter: Side = rng.chance(0.5) ? 0 : 1
    return { ...round, ...roundStart(starter), wins: [0, 0] }
  }

  protected step(dt: number): void {
    const s = this.s
    this.playFlips()
    if (this.ctx.mode === '2p') this.updatePeek()
    if (s.end) {
      // The round is decided but the match is not: deal the next round after the ending.
      if (!this.over && this.time >= s.end.at + END_DELAY) this.nextRound()
      return
    }
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

  private nextRound(): void {
    const s = this.s
    const starter = other(s.starter)
    Object.assign(s, dealRound(this.ctx.rng), roundStart(starter))
    this.botWait = -1
    this.botMove = null
    this.ctx.audio.play('swish', 1.1)
  }

  /** `winner` takes the round: the match ends at the target, otherwise the ending plays and the next round follows. */
  private settle(winner: Side): void {
    const s = this.s
    s.wins[winner]++
    if (s.wins[winner] >= this.target) this.finish(winner, { delay: END_DELAY })
  }

  private playFlips(): void {
    while (this.queue.length && (this.queue[0]?.at ?? Infinity) <= this.time)
      this.queue.shift()?.run()
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
    this.ctx.audio.buzz(r.yes ? 12 : 8)
    const last = Math.max(0, r.flipped.length - 1) * FLIP_STEP
    s.last = { side, q, yes: r.yes, at: this.time, hold: ANSWER_DELAY + 0.05 }
    r.flipped.forEach((i, k) => {
      const t = this.time + ANSWER_DELAY + k * FLIP_STEP
      s.flipAt[side][i] = t
      this.flipSounds.push(t)
    })
    if (r.flipped.length === 0) fx.float('No faces fall', at.x, at.y - 90, C.white, 40, side)
    // A big cascade earns a cheer as it lands.
    if (r.flipped.length >= 8) {
      const t = this.time + ANSWER_DELAY + last
      this.later(t, () => {
        fx.float(`−${r.flipped.length}`, at.x, at.y - 90, SIDE[side].light, 56, side)
        this.ctx.audio.play('powerup', 1.1)
      })
    }
    s.resolveAt = this.time + ANSWER_DELAY + last + 0.5
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
      this.ctx.audio.buzz(40)
      this.settle(side)
      return
    }
    s.down[side][i] = true
    s.flipAt[side][i] = this.time
    fx.burst(at.x, at.y, C.redLight, { count: 22, speed: 420, size: 10 })
    fx.flash(C.red, 0.25)
    fx.shake(0.5)
    this.ctx.audio.play('buzz')
    this.ctx.audio.buzz(30)
    fx.confetti(other(side))
    this.settle(other(side))
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
      const text = won
        ? this.over
          ? 'Winner!'
          : 'Round won!'
        : s.end.side === side
          ? 'Wrong face!'
          : 'Found you!'
      return { text, active: won }
    }
    if (!this.over && s.turn === side && s.resolveAt < 0) {
      if (s.guess) return { text: 'Pick a face', active: true }
      return { text: this.isBot(side) ? 'Thinking…' : 'Ask or guess', active: true }
    }
    return { active: false }
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.queue = []
    this.flipSounds = []
  }

  render(g: Draw): void {
    const s = this.s
    const now = this.time
    tableBackdrop(g)
    // A soft divider between the two boards.
    g.alpha(0.5, () => g.midline())
    const live = !this.over && s.resolveAt < 0 && !s.end
    for (const side of [0, 1] as Side[]) {
      const active = live && s.turn === side
      renderBoard(g, s, now, side, { active, guessing: active && s.guess })
    }
    // Online, each phone draws only its own player's question chips and Guess button.
    const mine = (side: Side) => g.viewer === null || g.viewer === side
    for (const side of [0, 1] as Side[]) {
      if (!mine(side)) continue
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
      if (mine(side)) renderGuessButton(g, this.ctx.stage, side, turn, turn && s.guess)
    }
    renderEnding(g, s, now)
    if (this.target > 1) {
      for (const side of [0, 1] as Side[]) {
        pips(g, side, s.wins[side], this.target, { x: frame(side, 560, 0).x, inset: 128 })
      }
    }
    if (s.end && !this.over) {
      const winner = s.end.right ? s.end.side : other(s.end.side)
      banner(g, undefined, `${this.ctx.names[winner]} takes the round`, MID, { size: 52 })
    }
  }
}

export default () => new GuessThePerson()
