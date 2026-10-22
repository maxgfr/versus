import { other, type MatchSpec, type Side } from '../../core/game.ts'
import { approach } from '../../core/fx/ease.ts'
import { banner } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { store, submitRecord } from '../../core/store.ts'
import {
  fmtTime,
  keyAt,
  newRace,
  PuzzleRace,
  type RaceBase,
  toWorld,
} from '../../engines/puzzle/index.ts'
import { nextMove, PACE } from './bot.ts'
import { cellAt, drawHint, drawPanel, drawRoundWins, layout } from './render.ts'
import {
  completedUnits,
  digitCounts,
  entry,
  generate,
  givensFor,
  isSolved,
  matchWinner,
  progress,
  raceWinner,
  roundSeed,
} from './rules.ts'

interface Board {
  cells: number[]
  sel: number
  errCell: number
  errKey: number
  last: number
  lastAt: number
  flash: number[]
  flashAt: number
  /** Correct entries in a quick run (each within STREAK_GAP of the last). */
  streak: number
  /** Last key pressed and when (it dips under the finger). */
  key: number
  keyAt: number
}

export interface State extends RaceBase {
  boards: [Board, Board]
  /** Bot: seconds until its next action. */
  botT: [number, number]
  /** Bot: the cell and digit it has picked and is about to type, or null while it looks. */
  botPlan: [[number, number] | null, [number, number] | null]
  /** Rounds started so far, from 0. Round r is the puzzle made from `roundSeed(seed, r)`. */
  round: number
  /** Round wins, red first. */
  wins: [number, number]
  /** Game time the current round started: its clocks count from here. */
  roundAt: number
  /** Game time the round was decided, or -1 while it runs (the clocks stop). */
  endedAt: number
  /** Game time the next round starts, or -1 while this one runs. */
  nextAt: number
  /** Banner shown between two rounds. */
  roundText: string
  /** Who took the last decided round (-1 for nobody), for its celebration. */
  roundWinner: number
  /** Solo only: seconds the puzzles solved so far took, in total. */
  spent: number
}

const PENALTY = 10
/** Seconds the result of a round stays up before the next puzzle appears. */
const BETWEEN = 2.4
/** Seconds a round may last before it is called on progress (the whole match is not capped). */
const ROUND_CAP = 20 * 60
/** Two correct entries closer than this keep a streak going. */
const STREAK_GAP = 4

/** Match length: first to N round wins, each round a new puzzle (1 = one puzzle). */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

class Sudoku extends PuzzleRace<State> {
  protected recordId = 'sudoku'
  // Each round has its own clock (see step): the engine's match-wide cap stays off.
  protected override cap: number | null = null
  // Derived from the seed on both phones: never sent over the wire.
  private puzzle: number[] = []
  private solution: number[] = []
  /** The round whose puzzle is loaded in `puzzle` and `solution`. */
  private loaded = -1
  // Cosmetic only: where each side's selection box is drawn (cell units), gliding to `sel`.
  private selVis: [{ x: number; y: number } | null, { x: number; y: number } | null] = [null, null]

  /** Round wins that take the match. */
  private get goal(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    this.loadRound(0)
    return {
      race: newRace(),
      boards: this.freshBoards(),
      botT: [PACE[this.ctx.difficulty], PACE[this.ctx.difficulty]],
      botPlan: [null, null],
      round: 0,
      wins: [0, 0],
      roundAt: 0,
      endedAt: -1,
      nextAt: -1,
      roundText: '',
      roundWinner: -1,
      spent: 0,
    }
  }

  private loadRound(r: number): void {
    const p = generate(roundSeed(this.ctx.seed, r), givensFor(this.ctx.difficulty, r))
    this.puzzle = p.puzzle
    this.solution = p.solution
    this.loaded = r
  }

  private freshBoards(): [Board, Board] {
    const board = (): Board => ({
      cells: this.puzzle.slice(),
      sel: -1,
      errCell: -1,
      errKey: -1,
      last: -1,
      lastAt: -1,
      flash: [],
      flashAt: -10,
      streak: 0,
      key: -1,
      keyAt: -10,
    })
    return [board(), board()]
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    // The guest gets the round number in the snapshot and rebuilds the same puzzle.
    if (this.s.round !== this.loaded) this.loadRound(this.s.round)
    this.selVis = [null, null]
  }

  /** Seconds on a side's clock for the current puzzle, penalties included. */
  override elapsed(side: Side): number {
    const s = this.s
    const r = s.race[side]
    return (r.done ?? (s.endedAt >= 0 ? s.endedAt : this.time)) - s.roundAt + r.penalty
  }

  protected progressOf(side: Side): number {
    return progress(this.s.boards[side].cells, this.puzzle)
  }

  protected override step(dt: number): void {
    const s = this.s
    if (s.nextAt >= 0) {
      if (this.time >= s.nextAt) this.startRound()
      return
    }
    super.step(dt)
    if (this.over || s.nextAt >= 0) return
    this.settle()
    if (this.over || s.nextAt >= 0) return
    if (this.time - s.roundAt >= ROUND_CAP) this.timeUp()
  }

  /** A solver waits until the rival can no longer beat its time (see `raceWinner`). */
  private settle(): void {
    if (this.solo) return
    const [a, b] = this.s.race
    const won = raceWinner(
      { done: a.done !== null, clock: this.elapsed(0) },
      { done: b.done !== null, clock: this.elapsed(1) },
    )
    if (won === null) return
    if (won === 'draw') {
      this.endRound('draw', `Dead heat at ${fmtTime(this.elapsed(0))}`)
      return
    }
    const loser = other(won)
    const beat = this.s.race[loser].done === null
    this.endRound(
      won,
      beat
        ? `Solved in ${fmtTime(this.elapsed(won))}`
        : `${fmtTime(this.elapsed(won))} beats ${fmtTime(this.elapsed(loser))}`,
    )
  }

  protected stepSide(side: Side, dt: number, taps: { x: number; y: number }[]): void {
    if (this.s.nextAt >= 0) return
    const b = this.s.boards[side]
    if (this.isBot(side)) {
      this.s.botT[side] -= dt
      if (this.s.botT[side] > 0) return
      const plan = this.s.botPlan[side]
      const pace = PACE[this.ctx.difficulty]
      if (plan) {
        // It looked, it picked: now it types.
        this.s.botPlan[side] = null
        this.s.botT[side] = pace * 0.15
        b.sel = plan[0]
        this.enter(side, plan[1])
        return
      }
      // It remembers its last miss and does not type the same wrong digit twice.
      const avoid = b.errCell >= 0 ? { cell: b.errCell, digit: b.errKey + 1 } : null
      const m = nextMove(b.cells, this.ctx.difficulty, this.ctx.rng, avoid)
      if (!m) return
      // Select the cell first, then think about it: it reads like a person.
      b.sel = m.cell
      this.ctx.audio.play('tick', 1.1)
      this.s.botPlan[side] = [m.cell, m.digit]
      this.s.botT[side] = pace * m.think * this.ctx.rng.range(0.6, 1.2)
      return
    }
    const f = this.frames[side]
    const l = layout(f.w, f.h)
    for (const t of taps) {
      const k = keyAt(l.keys, t.x, t.y)
      if (k >= 0) {
        b.key = k
        b.keyAt = this.time
        this.enter(side, k + 1)
        if (this.s.race[side].done !== null) return
        continue
      }
      const i = cellAt(l, t.x, t.y)
      if (i >= 0) {
        b.sel = i
        this.ctx.audio.play('tick', b.cells[i] ? 0.9 : 1.1)
      }
    }
  }

  private cellWorld(side: Side, i: number): { x: number; y: number } {
    const f = this.frames[side]
    const l = layout(f.w, f.h)
    return toWorld(f, l.x0 + (i % 9) * l.c + l.c / 2, l.y0 + Math.floor(i / 9) * l.c + l.c / 2)
  }

  private enter(side: Side, d: number): void {
    const b = this.s.boards[side]
    const { fx, audio } = this.ctx
    const i = b.sel
    const what = entry(b.cells, this.solution, i, d)
    if (what === 'none') {
      audio.play('click', 0.8)
      return
    }
    if (what === 'wrong') {
      b.errCell = i
      b.errKey = d - 1
      b.streak = 0
      this.penalize(side, PENALTY)
      return
    }
    // A quick run of correct entries builds a streak: the feedback grows with it.
    b.streak = this.time - b.lastAt < STREAK_GAP ? b.streak + 1 : 1
    const k = Math.min(1, (b.streak - 1) / 5)
    b.cells[i] = d
    b.last = i
    b.lastAt = this.time
    audio.play('place', 0.88 + d * 0.025 + k * 0.35)
    const col = SIDE[side]
    const at = this.cellWorld(side, i)
    fx.burst(at.x, at.y, col.main, {
      count: Math.round(6 + k * 10),
      speed: 220 + k * 260,
      size: 8 + k * 3,
      life: 0.35,
      colors: k > 0.5 ? [col.main, col.light, C.yellow] : [col.main, col.light],
    })
    if (b.streak >= 3) {
      fx.float(`${b.streak} in a row`, at.x, at.y + (side === 0 ? -70 : 70), C.yellow, 40, side)
      if (b.streak % 3 === 0) audio.buzz(8)
    }
    const units = completedUnits(b.cells, i)
    if (units.length) {
      b.flash = units.flat()
      b.flashAt = this.time
      audio.play('score', 1 + units.length * 0.12 + k * 0.2)
      audio.buzz(12 + units.length * 6)
      fx.sparks(at.x, at.y, C.yellow, 8 + units.length * 6)
    }
    if (digitCounts(b.cells)[d] === 9) audio.play('powerup', 0.9 + d * 0.03)
    if (isSolved(b.cells, this.solution)) this.complete(side)
  }

  /** A side solved the puzzle: its clock stops, and `settle` decides the round. */
  protected override complete(side: Side): void {
    const r = this.s.race[side]
    if (r.done !== null || this.over || this.s.nextAt >= 0) return
    r.done = this.time
    r.progress = 1
    this.ctx.audio.play('coin')
    const { fx } = this.ctx
    const f = this.frames[side]
    const c = toWorld(f, f.w / 2, f.h / 2)
    fx.ring(c.x, c.y, SIDE[side].light, 460)
    fx.burst(c.x, c.y, C.yellow, {
      count: 30,
      speed: 700,
      size: 12,
      life: 0.8,
      colors: [C.yellow, C.white, SIDE[side].light],
    })
    if (this.solo) this.endRound(side, `Solved in ${fmtTime(this.elapsed(side))}`)
  }

  /** Round clock ran out: the side further along takes the round (a tie is replayed). */
  private timeUp(): void {
    const s = this.s
    if (this.solo) {
      s.endedAt = this.time
      this.finish(0, { note: 'Out of time' })
      return
    }
    const [a, b] = s.race
    this.endRound(a.progress === b.progress ? 'draw' : a.progress > b.progress ? 0 : 1, 'Time up')
  }

  /**
   * The round is decided: `winner` takes it (a draw takes nobody). The match ends
   * once someone has `goal` round wins; otherwise the next puzzle follows.
   */
  private endRound(winner: Side | 'draw', note: string): void {
    const s = this.s
    s.endedAt = this.time
    s.roundWinner = winner === 'draw' ? -1 : winner
    if (winner !== 'draw') {
      s.wins[winner]++
      if (this.solo) s.spent += this.elapsed(winner)
      this.cheer(winner)
    }
    const won = matchWinner(s.wins, this.goal)
    if (won !== null) {
      this.conclude(won, note)
      return
    }
    s.nextAt = this.time + BETWEEN
    s.roundText =
      winner === 'draw'
        ? 'Draw round'
        : this.solo
          ? note
          : `${this.ctx.names[winner]} takes the round`
    this.ctx.audio.play(winner === 'draw' ? 'draw' : 'score')
  }

  /** The winner's moment: flash, a thump, confetti on their side. */
  private cheer(side: Side): void {
    const { fx, audio } = this.ctx
    fx.flash(SIDE[side].light, 0.3)
    fx.shake(0.3)
    fx.stop(4)
    fx.confetti(this.solo ? undefined : side)
    audio.buzz(30)
  }

  /** The match is decided. Solo records the total time of its puzzles. */
  private conclude(winner: Side, note: string): void {
    const s = this.s
    if (this.solo) {
      this.finish(winner, { note: this.soloRecord(s.spent), delay: 1.4 })
      return
    }
    const o: { note: string; delay: number; score?: [number, number] } = { note, delay: 1.4 }
    if (this.goal > 1) o.score = [s.wins[0], s.wins[1]]
    this.finish(winner, o)
  }

  private soloRecord(total: number): string {
    const prev = store.records[this.recordId]
    const best = submitRecord(this.recordId, Math.round(total * 10) / 10, true)
    return best
      ? `New record: ${fmtTime(total)}`
      : `Time ${fmtTime(total)} · best ${fmtTime(prev ?? total)}`
  }

  private startRound(): void {
    const s = this.s
    s.round++
    this.loadRound(s.round)
    s.boards = this.freshBoards()
    s.botT = [PACE[this.ctx.difficulty], PACE[this.ctx.difficulty]]
    s.botPlan = [null, null]
    s.race = newRace()
    s.roundAt = this.time
    s.endedAt = -1
    s.nextAt = -1
    s.roundText = ''
    this.ctx.audio.play('go')
  }

  protected renderPanel(g: Draw, side: Side, w: number, h: number): void {
    const b = this.s.boards[side]
    const l = layout(w, h)
    // The selection box glides to the new cell instead of jumping.
    let sv = this.selVis[side]
    if (b.sel >= 0) {
      const tx = b.sel % 9
      const ty = Math.floor(b.sel / 9)
      if (!sv) sv = this.selVis[side] = { x: tx, y: ty }
      sv.x = approach(sv.x, tx, 26, 1 / 60)
      sv.y = approach(sv.y, ty, 26, 1 / 60)
    } else this.selVis[side] = sv = null
    const race = this.s.race[side]
    // Online, the rival's half shows its board but not its keypad or prompts.
    const own = g.viewer === null || g.viewer === side
    drawPanel(g, l, {
      side,
      puzzle: this.puzzle,
      cells: b.cells,
      sel: b.sel,
      selVis: sv,
      errCell: b.errCell,
      errKey: b.errKey,
      errAt: race.errAt,
      last: b.last,
      lastAt: b.lastAt,
      flash: b.flash,
      flashAt: b.flashAt,
      key: b.key,
      keyAt: b.keyAt,
      counts: digitCounts(b.cells),
      doneAt: race.done,
      beat: this.beatTime(side),
      dealtAt: this.s.round > 0 ? this.s.roundAt : -10,
      now: this.time,
      pad: own,
    })
    if (this.goal > 1) drawRoundWins(g, side, w, h, this.s.wins[side], this.goal, this.wonAt(side))
    if (b.sel < 0 && this.time - this.s.roundAt < 6 && !this.isBot(side) && own) drawHint(g, l)
  }

  /** The rival's finished time this side must beat, while it still can. */
  private beatTime(side: Side): number | null {
    const s = this.s
    const rival = s.race[other(side)]
    if (this.solo || s.nextAt >= 0 || this.over || rival.done === null) return null
    return s.race[side].done === null ? this.elapsed(other(side)) : null
  }

  /** When `side` last took a round (its newest pip pops), or -10. */
  private wonAt(side: Side): number {
    return this.s.roundWinner === side && this.s.endedAt >= 0 ? this.s.endedAt : -10
  }

  override render(g: Draw): void {
    super.render(g)
    const s = this.s
    if (s.nextAt >= 0 && !this.over) {
      const a = Math.min(1, (this.time - s.endedAt) * 4)
      banner(g, undefined, s.roundText, MID, { size: 58, alpha: a })
    }
  }
}

export default () => new Sudoku()
