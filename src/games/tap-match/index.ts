import { type MatchSpec, other, type Side } from '../../core/game.ts'
import { banner, pips } from '../../core/hud.ts'
import { Rng } from '../../core/rng.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { fmtTime, newRace, PuzzleRace, type RaceBase, toWorld } from '../../engines/puzzle/index.ts'
import { PACE, pickTile } from './bot.ts'
import { celebrate, panelCard } from './ending.ts'
import {
  backdrop,
  type Clear,
  drawStack,
  drawTray,
  FLY,
  geometry,
  POP,
  type Shown,
  SQUEEZE,
  slotCenter,
  tileAt,
  tileCenter,
} from './render.ts'
import { buildLayout, isFree, type Layout, levelFor, settle, TRAY } from './rules.ts'

const EMOJI = [
  '🍎',
  '🍊',
  '🍋',
  '🍇',
  '🍓',
  '🍒',
  '🥝',
  '🍑',
  '🥕',
  '🌽',
  '🍄',
  '🐸',
  '🐶',
  '🐱',
  '🐵',
  '🐼',
  '🦊',
  '🐙',
  '⚽',
  '🏀',
  '🎈',
  '🎲',
  '🎸',
  '🚀',
  '🌈',
  '⭐',
  '🍩',
  '🧀',
]

interface Board {
  /** Per tile of the shared layout: taken off the stack, and when (for the uncover pop). */
  taken: boolean[]
  takenAt: number[]
  left: number
  tray: Shown[]
  /** The last set of three, for its squeeze and pop. */
  clear: Clear | null
  botT: number
  /** When the tray filled up (this side lost), or -1. */
  lostAt: number
  /** When the stack and tray were cleared: the win lands once the last set has popped. */
  solvedAt: number
  /** Sets cleared in quick succession, and when the last one went (the combo window). */
  combo: number
  setAt: number
  /** The last buried tile pressed (it shakes its head), and when. */
  nudge: number
  nudgeAt: number
}

/** Seconds between two sets that keep a combo going. */
const COMBO_WINDOW = 3

export interface State extends RaceBase {
  boards: [Board, Board]
  /** When the race was decided (for the cards), or -1. */
  endAt: number
  /** Races won per side. The match is first to the target. */
  wins: [number, number]
  /** Race index, from 0. Each race is a fresh layout, derived from the seed on both phones. */
  round: number
  /** Game time this race was dealt: its clock runs from here. */
  roundAt: number
  /** Game time this race was decided (a short break follows), or -1 while it runs. */
  roundEnd: number
  /** Banner for the decided race. */
  roundText: string
}

/** Seconds between two races, so the one just decided can be read. */
const BREAK = 2
/** Race wins to take the match: one race is one round. Solo keeps a single time trial. */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

class TapMatch extends PuzzleRace<State> {
  protected recordId = 'tap-match'
  // Derived from the seed on both phones: never sent over the wire.
  private lay!: Layout
  private emoji: string[] = []
  /** The race whose layout `lay` and `emoji` hold. */
  private laid = -1
  /** Cosmetic effects timed to land with an animation (host side; the guest gets them replayed). */
  private later: { at: number; fn: () => void }[] = []

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return this.dealRace(0, 0)
  }

  /** The layout and kinds of race `round`, from the seed. */
  private derive(round: number): void {
    // Later races of a longer match stack a little higher, with more kinds.
    const level = levelFor(this.ctx.difficulty, round)
    const seed = this.ctx.seed + round
    this.lay = buildLayout(seed, level)
    this.emoji = new Rng(seed ^ 0x51ed).shuffle(EMOJI.slice()).slice(0, level.kinds)
    this.laid = round
  }

  /** Race `round`, dealt at game time `at`. */
  private dealRace(round: number, at: number): State {
    this.derive(round)
    const n = this.lay.tiles.length
    const board = (): Board => ({
      taken: Array.from({ length: n }, () => false),
      takenAt: Array.from({ length: n }, () => -10),
      left: n,
      tray: [],
      clear: null,
      botT: 0,
      lostAt: -1,
      solvedAt: -1,
      combo: 0,
      setAt: -10,
      nudge: -1,
      nudgeAt: -10,
    })
    return {
      race: newRace(),
      boards: [board(), board()],
      endAt: -1,
      wins: [0, 0],
      round,
      roundAt: at,
      roundEnd: -1,
      roundText: '',
    }
  }

  private nextRace(): void {
    this.later = []
    const wins = this.s.wins
    this.s = { ...this.dealRace(this.s.round + 1, this.time), wins }
  }

  /** A guest takes the race from the host's state, so it also takes that race's layout. */
  override restore(snap: unknown): void {
    super.restore(snap)
    if (this.laid !== this.s.round) this.derive(this.s.round)
  }

  protected progressOf(side: Side): number {
    const n = this.lay.tiles.length
    return (n - this.s.boards[side].left) / n
  }

  /** Seconds on this race's clock for a side, penalties included. Frozen once the race is decided. */
  override elapsed(side: Side): number {
    const r = this.s.race[side]
    const end = this.s.roundEnd >= 0 ? this.s.roundEnd : this.time
    return (r.done ?? end) - this.s.roundAt + r.penalty
  }

  protected override step(dt: number): void {
    this.flush()
    if (this.s.roundEnd >= 0) {
      if (this.time - this.s.roundEnd >= BREAK) this.nextRace()
      return
    }
    super.step(dt)
  }

  protected override afterEnd(_dt: number): void {
    this.flush()
  }

  private flush(): void {
    if (!this.later.length) return
    const due = this.later.filter((l) => l.at <= this.time)
    this.later = this.later.filter((l) => l.at > this.time)
    for (const l of due) l.fn()
  }

  protected override complete(side: Side): void {
    if (this.over || this.s.roundEnd >= 0) return
    this.s.endAt = this.time
    celebrate(this.ctx.fx, this.frames[side], side)
    super.complete(side)
  }

  /**
   * The engine ends a race through `finish` (cleared, or a tray filled up). In a
   * longer match that is a round: its winner takes it, the match ends at the
   * target, and a draw takes nobody's round. Solo and first-to-one end as before.
   */
  protected override finish(
    winner: Side | 'draw',
    o: { score?: [number, number]; note?: string; delay?: number } = {},
  ): void {
    if (this.solo || this.target <= 1) {
      super.finish(winner, o)
      return
    }
    const s = this.s
    if (this.over || s.roundEnd >= 0) return
    if (winner !== 'draw') s.wins[winner]++
    if (winner !== 'draw' && s.wins[winner] >= this.target) {
      super.finish(winner, { ...o, score: [s.wins[0], s.wins[1]] })
      return
    }
    s.roundEnd = this.time
    s.roundText = winner === 'draw' ? 'Draw round' : `${this.ctx.names[winner]} takes the round`
    this.ctx.audio.play(winner === 'draw' ? 'draw' : 'score')
  }

  override render(g: Draw): void {
    super.render(g)
    if (this.solo || this.target <= 1) return
    // Above the tray, which fills the bottom of each half.
    pips(g, 0, this.s.wins[0], this.target, { inset: 170 })
    pips(g, 1, this.s.wins[1], this.target, { inset: 170 })
    if (this.s.roundEnd >= 0 && !this.over) {
      const a = Math.min(1, (this.time - this.s.roundEnd) * 4)
      banner(g, undefined, this.s.roundText, MID, { size: 58, alpha: a })
    }
  }

  protected stepSide(side: Side, dt: number, taps: { x: number; y: number }[]): void {
    const b = this.s.boards[side]
    if (b.solvedAt >= 0) {
      if (this.time >= b.solvedAt + FLY + SQUEEZE + POP * 0.5) this.complete(side)
      return
    }
    if (this.isBot(side)) {
      b.botT += dt
      if (b.botT < PACE[this.ctx.difficulty]) return
      b.botT = 0
      const i = pickTile(this.lay, b.taken, b.tray, this.ctx.difficulty, this.ctx.rng)
      if (i >= 0) this.take(side, i)
      return
    }
    const f = this.frames[side]
    const geo = geometry(f.w, f.h)
    for (const t of taps) {
      const i = tileAt(this.lay, b.taken, geo, t.x, t.y)
      if (i >= 0) this.take(side, i)
      else this.nudge(side, tileAt(this.lay, b.taken, geo, t.x, t.y, true))
      if (this.over || b.solvedAt >= 0) return
    }
  }

  /** A press on a buried tile: it shakes its head (no penalty, the stack is the timer). */
  private nudge(side: Side, i: number): void {
    if (i < 0) return
    const b = this.s.boards[side]
    b.nudge = i
    b.nudgeAt = this.time
    this.ctx.audio.play('click', 0.6)
    this.ctx.audio.buzz(6)
  }

  /** Move a free tile into the side's tray. */
  private take(side: Side, i: number): void {
    if (this.over || this.s.roundEnd >= 0) return
    const b = this.s.boards[side]
    const tile = this.lay.tiles[i]
    if (!tile || b.taken[i] || !isFree(this.lay, b.taken, i)) return
    const f = this.frames[side]
    const geo = geometry(f.w, f.h)
    const c = tileCenter(geo, tile)
    const now = this.time
    b.taken[i] = true
    b.takenAt[i] = now
    b.left--
    const before = b.tray
    const item: Shown = { k: tile.k, at: now, fx: c.x, fy: c.y, ps: -1, mv: -10 }
    const r = settle(before, item)
    // Tiles that changed slot slide over; after a set they wait for its pop.
    r.tray.forEach((it, n) => {
      if (it === item) {
        it.ps = n
        return
      }
      const was = before.indexOf(it)
      if (r.cleared && n >= r.at) {
        // Still in the slot it was drawn in until the set pops (the set took three slots before it).
        it.ps = was
        it.mv = now + FLY + SQUEEZE
      } else if (was !== n) {
        it.ps = was
        it.mv = now
      }
    })
    b.tray = r.tray
    const { fx, audio } = this.ctx
    const at = toWorld(f, c.x, c.y)
    audio.play('tap', 0.85 + tile.k * 0.04)
    fx.burst(at.x, at.y, SIDE[side].light, { count: 6, speed: 240, size: 8, life: 0.3 })
    if (r.lost) {
      this.lose(side)
      return
    }
    if (r.cleared) {
      // Sets in quick succession build a combo: pitch, particles, shake and haptics climb.
      b.combo = now - b.setAt < COMBO_WINDOW ? b.combo + 1 : 1
      b.setAt = now
      const combo = b.combo
      const k = Math.min(1, (combo - 1) / 4)
      b.clear = { k: tile.k, slot: r.at, at: now, fx: c.x, fy: c.y, heat: k }
      const mid = slotCenter(geo, r.at + 1)
      const w = toWorld(f, mid.x, mid.y)
      const sets = this.lay.tiles.length / 3 - (b.left + b.tray.length) / 3
      const up = f.angle ? 110 : -110
      this.later.push({
        at: now + FLY + SQUEEZE,
        fn: () => {
          audio.play('pop', 1.1 + k * 0.3)
          audio.play('score', 1 + Math.min(0.4, sets * 0.03) + k * 0.35)
          audio.buzz(12 + Math.round(k * 24))
          fx.burst(w.x, w.y, C.yellow, {
            count: Math.round(18 + k * 22),
            speed: 520 + k * 380,
            size: 11,
            life: 0.55,
          })
          fx.burst(w.x, w.y, C.white, {
            count: 3 + Math.round(k * 3),
            speed: 260 + k * 200,
            size: 46,
            life: 0.6,
            kind: 'emoji',
            glyph: this.emoji[tile.k] ?? '⭐',
            gravity: 600,
          })
          fx.ring(w.x, w.y, C.yellow, 150 + k * 140)
          if (combo >= 2) {
            fx.shake(0.06 + k * 0.22)
            fx.sparks(w.x, w.y, C.white, Math.round(6 + k * 10))
          }
          if (combo >= 3) fx.stop(2 + Math.round(k * 3))
          const label = combo >= 2 ? `Combo ×${combo}` : 'Set!'
          fx.float(label, w.x, w.y + up, C.yellow, 56 + k * 14, side)
        },
      })
    } else {
      // Six in the tray: one more that pairs nothing loses. Warn on landing.
      const brink = b.tray.length === TRAY - 1
      this.later.push({
        at: now + FLY,
        fn: () => {
          audio.play('place', 1.2)
          if (brink) {
            audio.play('tick', 0.6)
            audio.buzz(25)
          }
        },
      })
    }
    if (b.left === 0 && b.tray.length === 0) b.solvedAt = now
  }

  private lose(side: Side): void {
    const b = this.s.boards[side]
    const f = this.frames[side]
    const geo = geometry(f.w, f.h)
    const mid = slotCenter(geo, 3)
    const at = toWorld(f, mid.x, mid.y)
    b.lostAt = this.time
    this.s.endAt = this.time
    this.later.push({
      at: this.time + FLY,
      fn: () => {
        this.ctx.audio.play('lose')
        this.ctx.audio.buzz(80)
        this.ctx.fx.shake(0.6)
        this.ctx.fx.stop(6)
        this.ctx.fx.flash(C.red, 0.3)
        this.ctx.fx.burst(at.x, at.y, C.red, { count: 22, speed: 520, size: 12, life: 0.6 })
        if (!this.solo) this.ctx.fx.confetti(other(side))
      },
    })
    this.finish(this.solo ? 0 : other(side), { note: 'Tray full', delay: 2 })
  }

  protected renderPanel(g: Draw, side: Side, w: number, h: number): void {
    const b = this.s.boards[side]
    const geo = geometry(w, h)
    backdrop(g, side, geo)
    drawStack(g, this.lay, b.taken, b.takenAt, geo, this.emoji, this.time, b.nudge, b.nudgeAt)
    drawTray(g, geo, side, b.tray, b.clear, this.emoji, this.time, b.lostAt)
    // Online, the how-to hint is only for the player on this phone.
    const mine = g.viewer === null || side === g.viewer
    if (
      mine &&
      b.tray.length === 0 &&
      this.time - this.s.roundAt < 7 &&
      !this.isBot(side) &&
      this.s.endAt < 0
    ) {
      g.text('Tap a bright tile · three alike vanish', w / 2, geo.trayY - 36, {
        size: 34,
        weight: 600,
        color: alpha(C.white, 0.9),
        stroke: alpha(C.ink, 0.7),
        strokeWidth: 8,
      })
    }
    this.cards(g, side, w, h)
  }

  /** Result cards: a full tray, or the rival finishing first. */
  private cards(g: Draw, side: Side, w: number, h: number): void {
    const s = this.s
    if (s.endAt < 0) return
    const b = s.boards[side]
    const o = other(side)
    const at = s.endAt + FLY + 0.25
    if (b.lostAt >= 0) {
      panelCard(g, side, w, h, this.time, at, {
        title: 'Tray full!',
        sub: `${b.left} tile${b.left === 1 ? '' : 's'} left on the stack`,
        win: false,
      })
      return
    }
    if (this.solo || s.race[side].done !== null) return
    if (s.boards[o].lostAt >= 0) {
      panelCard(g, side, w, h, this.time, at, {
        title: 'You win!',
        sub: `${this.ctx.names[o]}’s tray is full`,
        win: true,
      })
      return
    }
    panelCard(g, side, w, h, this.time, s.endAt, {
      title: `${this.ctx.names[o]} wins`,
      sub: `Cleared in ${fmtTime(this.elapsed(o))}`,
      win: false,
    })
  }
}

export default () => new TapMatch()
