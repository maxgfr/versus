import type { MatchSpec, Side } from '../../core/game.ts'
import { clamp } from '../../core/fx/ease.ts'
import { banner, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { store } from '../../core/store.ts'
import { MID } from '../../core/stage.ts'
import { fmtTime, newRace, PuzzleRace, type RaceBase, toWorld } from '../../engines/puzzle/index.ts'
import { toLocal } from '../../engines/runner/frame.ts'
import { chooseAction, PACE, playableDeal } from './bot.ts'
import {
  CARD_H,
  CARD_W,
  cardY,
  chip,
  colX,
  type Drag,
  drawPanel,
  dropAt,
  type Fly,
  FOUND_KEY,
  hitAt,
  keyCentre,
  keyOf,
  keyPos,
  STOCK_KEY,
  tableView,
  type TableView,
  TOP_Y,
  toTable,
  WASTE_KEY,
} from './render.ts'
import {
  apply,
  canDrop,
  cloneDeal,
  COLUMNS,
  type Deal,
  destinationFor,
  draw,
  type Dst,
  home,
  reveals,
  type Src,
  stuck,
} from './rules.ts'

/** A player's deal, plus what the last move looked like (for its animation). */
export interface Board extends Deal {
  botT: number
  /** Key of the card that moved last (see `keyOf` and `FOUND_KEY`), and when. */
  last: number
  lastAt: number
  /** The card(s) flying to their new place. */
  fly: Fly | null
  /** The card(s) under the player's finger. */
  drag: Drag | null
  /** A tableau card that just turned face up, and when. */
  flipKey: number
  flipAt: number
  /** A card tapped for nothing (it shakes), and when. */
  nopeKey: number
  nopeAt: number
  /** Game time the waste was last turned back into the stock. */
  recycleAt: number
  /** Taps made so far (the hint goes once you play). */
  taps: number
  /** Timer for the automatic finish once every card is face up. */
  autoT: number
  /** No move can make progress any more (see `stuck`), and since when. */
  stuck: boolean
  stuckAt: number
}

export interface State extends RaceBase {
  boards: [Board, Board]
  /** Races won per side. The match is first to the target. */
  wins: [number, number]
  /** Race index, from 0. Each race is a fresh deal, derived from the seed on both phones. */
  round: number
  /** Game time this race was dealt: its clock runs from here. */
  roundAt: number
  /** Game time this race was decided (a short break follows), or -1 while it runs. */
  roundEnd: number
  /** Banner for the decided race. */
  roundText: string
}

/** Four minutes a race: then the most cards home wins it. */
const CAP = 240
/** Seconds between two races, so the one just decided can be read. */
const BREAK = 2
/** Race wins to take the match: one race is one round. Solo keeps a single time trial. */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

const CARDS = 52
/** Seconds between cards sent home by the automatic finish. */
const AUTO = 0.12
/** A finger that travels less than this (table units) is a tap, not a drag. */
const TAP_SLOP = 22
/** Release speed (table units / s) that flings a card to its best place. */
const FLICK = 1600

/** Replace a board's cards with a new deal, keeping its animation fields. */
function assign(b: Board, n: Deal): void {
  b.tab = n.tab
  b.down = n.down
  b.stock = n.stock
  b.waste = n.waste
  b.found = n.found
}

/** Every card is face up and the deck is used up: the rest can go home on its own. */
function settled(d: Deal): boolean {
  return d.stock.length === 0 && d.waste.length === 0 && d.down.every((n) => n === 0)
}

/** The lowest bottom card that can go straight to its foundation now, or null. */
function homeCandidate(d: Deal): Src | null {
  let best: Src | null = null
  let bestRank = 99
  for (let col = 0; col < COLUMNS; col++) {
    const cards = d.tab[col] ?? []
    if (!cards.length) continue
    const src: Src = { from: 'tab', col, idx: cards.length - 1 }
    const dst = destinationFor(d, src)
    const rank = ((cards[cards.length - 1] as number) % 13) + 1
    if (dst?.to === 'found' && rank < bestRank) {
      best = src
      bestRank = rank
    }
  }
  return best
}

/** Key of the card a source names. */
const srcKey = (src: Src): number => (src.from === 'waste' ? WASTE_KEY : keyOf(src.col, src.idx))

class Solitaire extends PuzzleRace<State> {
  protected recordId = 'solitaire'

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return this.dealRace(0, 0)
  }

  /** Race `round`, dealt at game time `at`: the same (clearable) deal on both phones. */
  private dealRace(round: number, at: number): State {
    const d = playableDeal(this.ctx.seed + round)
    const board = (): Board => ({
      ...cloneDeal(d),
      botT: 0,
      last: -1,
      lastAt: -10,
      fly: null,
      drag: null,
      flipKey: -1,
      flipAt: -10,
      nopeKey: -1,
      nopeAt: -10,
      recycleAt: -10,
      taps: 0,
      autoT: 0,
      stuck: false,
      stuckAt: -10,
    })
    this.cap = at + CAP
    return {
      race: newRace(),
      boards: [board(), board()],
      wins: [0, 0],
      round,
      roundAt: at,
      roundEnd: -1,
      roundText: '',
    }
  }

  private nextRace(): void {
    const wins = this.s.wins
    this.s = { ...this.dealRace(this.s.round + 1, this.time), wins }
    this.ctx.audio.play('go')
  }

  protected progressOf(side: Side): number {
    return home(this.s.boards[side]) / CARDS
  }

  /** Seconds on this race's clock for a side, penalties included. Frozen once the race is decided. */
  override elapsed(side: Side): number {
    const r = this.s.race[side]
    const end = this.s.roundEnd >= 0 ? this.s.roundEnd : this.time
    return (r.done ?? end) - this.s.roundAt + r.penalty
  }

  /**
   * The engine ends a race through `finish` (every card home, or the clock ran
   * out). In a longer match that is a round: its winner takes it, the match ends
   * at the target, and a draw takes nobody's round. Solo and first-to-one end as before.
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
    if (winner !== 'draw') {
      this.ctx.fx.flash(SIDE[winner].light, 0.2)
      this.ctx.fx.confetti(winner)
    }
  }

  override render(g: Draw): void {
    super.render(g)
    if (this.solo || this.target <= 1) return
    pips(g, 0, this.s.wins[0], this.target)
    pips(g, 1, this.s.wins[1], this.target)
    if (this.s.roundEnd >= 0 && !this.over) {
      const a = Math.min(1, (this.time - this.s.roundEnd) * 4)
      banner(g, undefined, this.s.roundText, MID, { size: 58, alpha: a })
    }
  }

  protected stepSide(side: Side, dt: number, taps: { x: number; y: number }[]): void {
    const b = this.s.boards[side]
    this.land(side)
    const next = settled(b) ? homeCandidate(b) : null
    if (next) {
      // The cascade home: one card every AUTO seconds, lowest first.
      b.drag = null
      b.autoT += dt
      if (b.autoT < AUTO) return
      b.autoT = 0
      this.play(side, next)
      return
    }
    // Nothing can go home on its own: play on as usual, a settled table can still hold moves.
    if (this.isBot(side)) {
      b.botT += dt
      if (b.botT < PACE[this.ctx.difficulty]) return
      b.botT = 0
      const act = chooseAction(b, this.ctx.difficulty, this.ctx.rng)
      if (!act) return
      if (act.kind === 'draw') this.turn(side)
      else this.play(side, act.src, act.dst)
      return
    }
    const f = this.frames[side]
    const tv = tableView(f.w, f.h)
    const input = this.ctx.input.player(side)
    taps.forEach((t, i) => {
      const p = toTable(tv, t.x, t.y)
      const hit = hitAt(tv.h, b, p.x, p.y)
      if (!hit) return
      b.taps++
      if (hit.kind === 'stock') {
        this.turn(side)
        return
      }
      if (b.drag) return
      // Pick the card up: it follows the finger; a release without travel is a tap.
      const id = input.downs[i]?.id ?? -1
      const at = keyPos(tv.h, b, srcKey(hit.src))
      b.drag = {
        id,
        src: hit.src,
        key: srcKey(hit.src),
        x: at.x,
        y: at.y,
        gx: p.x - at.x,
        gy: p.y - at.y,
        sx: p.x,
        sy: p.y,
        vx: 0,
        vy: 0,
        moved: false,
        at: this.time,
      }
      this.ctx.audio.play('tick', 1.2)
    })
    const dr = b.drag
    if (!dr) return
    const held = input.held.get(dr.id)
    const ptr = held ?? input.ups.find((u) => u.id === dr.id)
    if (ptr) {
      const l = toLocal(f, ptr.x, ptr.y)
      const p = toTable(tv, l.x, l.y)
      const nx = p.x - dr.gx
      const ny = p.y - dr.gy
      // Smoothed finger velocity: it tilts the card and powers a flick.
      dr.vx += ((nx - dr.x) / dt - dr.vx) * 0.5
      dr.vy += ((ny - dr.y) / dt - dr.vy) * 0.5
      dr.x = nx
      dr.y = ny
      if (Math.hypot(p.x - dr.sx, p.y - dr.sy) > TAP_SLOP) dr.moved = true
    }
    if (!held) this.release(side, tv)
  }

  /** The finger let go of the dragged card(s): drop, fling or snap back. */
  private release(side: Side, tv: TableView): void {
    const b = this.s.boards[side]
    const dr = b.drag
    if (!dr) return
    b.drag = null
    if (!dr.moved) {
      this.play(side, dr.src)
      return
    }
    const from = { x: dr.x, y: dr.y }
    const speed = Math.hypot(dr.vx, dr.vy)
    const throwK = clamp((speed - 400) / 2600, 0, 1)
    const target = dropAt(tv.h, b, dr.src, dr.x + CARD_W / 2, dr.y + CARD_H / 2)
    if (target && canDrop(b, dr.src, target)) {
      this.play(side, dr.src, target, from, dr.vx, throwK)
      return
    }
    // A hard flick sends the card to its best place, wherever it was let go.
    if (speed > FLICK && destinationFor(b, dr.src)) {
      this.play(side, dr.src, undefined, from, dr.vx, throwK)
      return
    }
    // Back where it came from.
    const key = dr.key
    const n = dr.src.from === 'waste' ? 1 : (b.tab[dr.src.col]?.length ?? 0) - dr.src.idx
    const home0 = keyPos(tv.h, b, key)
    const dist = Math.hypot(home0.x - from.x, home0.y - from.y)
    b.fly = {
      key,
      n,
      x: from.x,
      y: from.y,
      at: this.time,
      dur: 0.12 + Math.min(0.14, dist / 4000),
      flip: 0,
      tilt: clamp(dr.vx * 0.00022, -0.3, 0.3),
      k: 0,
      done: true,
    }
    if (target) {
      b.nopeKey = key
      b.nopeAt = this.time + b.fly.dur
      this.ctx.audio.play('click', 0.7)
    } else this.ctx.audio.play('slide', 1.2)
  }

  /** World position of a card on a side's table (for particles). */
  private at(side: Side, d: Deal, key: number): { x: number; y: number } {
    const f = this.frames[side]
    const tv = tableView(f.w, f.h)
    const p = keyCentre(tv, d, key)
    return toWorld(f, p.x, p.y)
  }

  /** Tap on the stock: turn over the next card, or recycle the waste. */
  private turn(side: Side): void {
    if (this.over || this.s.roundEnd >= 0) return
    const b = this.s.boards[side]
    const n = draw(b)
    if (!n) {
      b.nopeKey = STOCK_KEY
      b.nopeAt = this.time
      this.ctx.audio.play('click')
      return
    }
    const recycled = b.stock.length === 0
    assign(b, n)
    b.drag = null
    if (recycled) {
      b.recycleAt = this.time
      this.ctx.audio.play('roll')
      const at = this.at(side, b, STOCK_KEY)
      this.ctx.fx.puff(at.x, at.y, 'rgba(255,255,255,0.4)', 6)
      this.checkStuck(side)
      return
    }
    b.fly = {
      key: WASTE_KEY,
      n: 1,
      x: colX(0),
      y: TOP_Y,
      at: this.time,
      dur: 0.22,
      flip: 1,
      tilt: 0,
      k: 0.2,
      done: true,
    }
    b.last = WASTE_KEY
    b.lastAt = this.time
    this.ctx.audio.play('flip', 0.95 + Math.min(0.3, b.waste.length * 0.012))
  }

  /**
   * Move a card (and the cards on it) to `dst`, or to its best legal place.
   * `from` is where it leaves from (a dragged card: under the finger), `vx` the
   * finger's speed, `throwK` 0..1 how hard it was thrown.
   */
  private play(
    side: Side,
    src: Src,
    dst0?: Dst,
    from0?: { x: number; y: number },
    vx = 0,
    throwK = 0,
  ): void {
    if (this.over || this.s.roundEnd >= 0) return
    const b = this.s.boards[side]
    const f = this.frames[side]
    const tv = tableView(f.w, f.h)
    const key0 = srcKey(src)
    const dst = dst0 ?? destinationFor(b, src)
    if (!dst) {
      b.nopeKey = key0
      b.nopeAt = this.time
      this.ctx.audio.play('click', 0.8)
      return
    }
    const from = from0 ?? keyPos(tv.h, b, key0)
    const moving = src.from === 'waste' ? 1 : (b.tab[src.col]?.length ?? 0) - src.idx
    const flips = reveals(b, src)
    const n = apply(b, src, dst)
    assign(b, n)
    b.drag = null
    const key =
      dst.to === 'found'
        ? FOUND_KEY + dst.suit
        : keyOf(dst.col, (n.tab[dst.col]?.length ?? moving) - moving)
    const to = keyPos(tv.h, b, key)
    const dist = Math.hypot(to.x - from.x, to.y - from.y)
    // Longer trips take a little longer; a hard throw gets there sooner.
    const dur = (0.14 + Math.min(0.2, dist / 3600)) * (1 - 0.35 * throwK)
    const k = clamp(Math.max(dist / 1100, throwK), 0, 1)
    b.fly = {
      key,
      n: moving,
      x: from.x,
      y: from.y,
      at: this.time,
      dur,
      flip: 0,
      tilt: clamp(vx * 0.00022, -0.3, 0.3),
      k,
      done: false,
    }
    b.last = key
    b.lastAt = this.time
    if (k > 0.35) this.ctx.audio.play('swish', 0.9 + k * 0.5)
    if (flips && src.from === 'tab') {
      b.flipKey = keyOf(src.col, src.idx - 1)
      b.flipAt = this.time
      const y = cardY(tv.h, n, src.col, src.idx - 1)
      const p = toWorld(f, tv.tx + (colX(src.col) + 62) * tv.k, tv.ty + (y + 86) * tv.k)
      this.ctx.audio.play('flip', 1.15)
      this.ctx.fx.burst(p.x, p.y, C.white, { count: 6, speed: 160, size: 7, life: 0.3 })
    }
    if (home(b) === CARDS) {
      this.solved(side)
      return
    }
    this.checkStuck(side)
  }

  /** The card in flight touched down: the landing gets its thud, sparks for a card home. */
  private land(side: Side): void {
    const b = this.s.boards[side]
    const fl = b.fly
    if (!fl || fl.done || this.time < fl.at + fl.dur) return
    fl.done = true
    const { fx, audio } = this.ctx
    const at = this.at(side, b, fl.key)
    if (fl.key >= FOUND_KEY && fl.key < STOCK_KEY) {
      const suit = fl.key - FOUND_KEY
      const rank = b.found[suit] ?? 1
      const r = rank / 13
      audio.play('coin', 0.9 + home(b) * 0.012)
      fx.sparks(at.x, at.y, C.yellow, Math.round(4 + rank * 0.9 + fl.k * 6))
      if (fl.k > 0.6 || rank >= 10) fx.ring(at.x, at.y, SIDE[side].light, 90 + 70 * r)
      if (fl.k > 0.7) audio.buzz(8)
      if (rank === 13) {
        // A whole suit home: a proper cheer.
        audio.play('score', 1.1)
        audio.buzz(20)
        fx.shake(0.15)
        fx.ring(at.x, at.y, C.yellow, 220)
        fx.burst(at.x, at.y, C.yellow, {
          count: 24,
          speed: 520,
          size: 10,
          life: 0.65,
          colors: [C.yellow, C.white, SIDE[side].light],
          kind: 'square',
        })
        fx.float(['♠', '♥', '♦', '♣'][suit] ?? '', at.x, at.y, C.yellow, 64, side)
      }
      return
    }
    // A column: heavier runs land lower and dustier.
    const runK = Math.min(1, (fl.n - 1) / 6)
    audio.play('place', 1.05 - runK * 0.2 - fl.k * 0.1)
    fx.burst(at.x, at.y, SIDE[side].light, {
      count: Math.round(4 + fl.k * 6 + runK * 6),
      speed: 160 + fl.k * 220,
      size: 7,
      life: 0.35,
    })
    if (fl.k > 0.6 || fl.n >= 4) fx.shake(0.06 + 0.1 * Math.max(fl.k, runK))
    if (fl.k > 0.7) audio.buzz(6)
  }

  /**
   * After a move: has this side run out of moves? Then the race may be decided
   * already: both stuck, the most cards home wins; one stuck, the other wins
   * as soon as it has more cards home than the stuck side.
   */
  private checkStuck(side: Side): void {
    const b = this.s.boards[side]
    const was = b.stuck
    b.stuck = stuck(b)
    if (b.stuck && !was) {
      b.stuckAt = this.time
      this.ctx.audio.play('lose', 0.9)
    }
    this.decideStuck()
  }

  private decideStuck(): void {
    if (this.over || this.s.roundEnd >= 0) return
    const [a, b] = this.s.boards
    const ha = home(a)
    if (this.solo) {
      if (a.stuck) this.finish(0, { note: `No moves left · ${ha}/52 home` })
      return
    }
    const hb = home(b)
    const note = 'No moves left'
    if (a.stuck && b.stuck) this.finish(ha === hb ? 'draw' : ha > hb ? 0 : 1, { note })
    else if (a.stuck && hb > ha) this.finish(1, { note: `Most cards home: ${hb}/52` })
    else if (b.stuck && ha > hb) this.finish(0, { note: `Most cards home: ${ha}/52` })
  }

  /** Every card home: the big finish before the result screen. */
  private solved(side: Side): void {
    const f = this.frames[side]
    const c = toWorld(f, f.w / 2, f.h / 2)
    this.ctx.fx.stop(5)
    this.ctx.fx.shake(0.35)
    this.ctx.fx.flash(SIDE[side].light, 0.35)
    this.ctx.fx.ring(c.x, c.y, C.yellow, 520)
    this.ctx.audio.buzz(30)
    this.ctx.fx.confetti(this.solo ? undefined : side)
    this.complete(side)
  }

  protected override step(dt: number): void {
    if (this.s.roundEnd >= 0) {
      if (this.time - this.s.roundEnd >= BREAK) this.nextRace()
      return
    }
    const wasOver = this.over
    super.step(dt)
    if (!this.over) this.decideStuck()
    // Time up: the engine picks the winner; give it a send-off.
    if (!wasOver && this.over && this.s.race.every((r) => r.done === null)) {
      this.ctx.fx.flash(C.white, 0.25)
      const [a, b] = this.s.race
      if (!this.solo && a.progress !== b.progress)
        this.ctx.fx.confetti(a.progress > b.progress ? 0 : 1)
    }
  }

  protected renderPanel(g: Draw, side: Side, w: number, h: number): void {
    const b = this.s.boards[side]
    const tv = tableView(w, h)
    // Online, each phone shows only its own player's cues.
    const own = g.viewer === null || g.viewer === side
    g.at(
      tv.tx,
      tv.ty,
      0,
      () =>
        drawPanel(g, tv.h, {
          side,
          deal: b,
          last: b.last,
          lastAt: b.lastAt,
          fly: b.fly,
          drag: b.drag,
          flipKey: b.flipKey,
          flipAt: b.flipAt,
          nopeKey: b.nopeKey,
          nopeAt: b.nopeAt,
          recycleAt: b.recycleAt,
          hint: own && !this.isBot(side) && b.taps === 0 && this.time - this.s.roundAt < 12,
          own,
          stuckAt: b.stuck ? b.stuckAt : -1,
          now: this.time,
        }),
      tv.k,
    )
    const best = store.records[this.recordId]
    if (this.solo && best !== undefined && b.taps > 0) {
      chip(g, w / 2 + 40, h - 60, `Best ${fmtTime(best)}`, side, '🏆')
    }
  }
}

export default () => new Solitaire()
