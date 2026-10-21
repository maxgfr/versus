import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { store } from '../../core/store.ts'
import { fmtTime, newRace, PuzzleRace, type RaceBase, toWorld } from '../../engines/puzzle/index.ts'
import { chooseAction, PACE } from './bot.ts'
import {
  cardY,
  chip,
  colX,
  drawPanel,
  type Fly,
  FOUND_KEY,
  hitAt,
  keyCentre,
  keyOf,
  keyPos,
  STOCK_KEY,
  tableView,
  TOP_Y,
  toTable,
  WASTE_KEY,
} from './render.ts'
import {
  apply,
  cloneDeal,
  COLUMNS,
  type Deal,
  deal,
  destinationFor,
  draw,
  home,
  reveals,
  type Src,
} from './rules.ts'

/** A player's deal, plus what the last move looked like (for its animation). */
export interface Board extends Deal {
  botT: number
  /** Key of the card that moved last (see `keyOf` and `FOUND_KEY`), and when. */
  last: number
  lastAt: number
  /** The card(s) flying to their new place. */
  fly: Fly | null
  /** A tableau card that just turned face up, and when. */
  flipKey: number
  flipAt: number
  /** A card tapped for nothing (it shakes), and when. */
  nopeKey: number
  nopeAt: number
  /** Taps made so far (the hint goes once you play). */
  taps: number
  /** Timer for the automatic finish once every card is face up. */
  autoT: number
}

export interface State extends RaceBase {
  boards: [Board, Board]
}

/** Four minutes: then the most cards home wins. */
const CAP = 240
const CARDS = 52
/** Seconds between cards sent home by the automatic finish. */
const AUTO = 0.12

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

class Solitaire extends PuzzleRace<State> {
  protected recordId = 'solitaire'
  protected override cap = CAP

  protected setup(): State {
    const d = deal(this.ctx.seed)
    const board = (): Board => ({
      ...cloneDeal(d),
      botT: 0,
      last: -1,
      lastAt: -10,
      fly: null,
      flipKey: -1,
      flipAt: -10,
      nopeKey: -1,
      nopeAt: -10,
      taps: 0,
      autoT: 0,
    })
    return { race: newRace(), boards: [board(), board()] }
  }

  protected progressOf(side: Side): number {
    return home(this.s.boards[side]) / CARDS
  }

  protected stepSide(side: Side, dt: number, taps: { x: number; y: number }[]): void {
    const b = this.s.boards[side]
    const next = settled(b) ? homeCandidate(b) : null
    if (next) {
      // The cascade home: one card every AUTO seconds, lowest first.
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
      else this.play(side, act.src)
      return
    }
    const f = this.frames[side]
    const tv = tableView(f.w, f.h)
    for (const t of taps) {
      const p = toTable(tv, t.x, t.y)
      const hit = hitAt(tv.h, b, p.x, p.y)
      if (!hit) continue
      b.taps++
      if (hit.kind === 'stock') this.turn(side)
      else this.play(side, hit.src)
    }
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
    if (this.over) return
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
    if (recycled) {
      this.ctx.audio.play('roll')
      const at = this.at(side, b, STOCK_KEY)
      this.ctx.fx.puff(at.x, at.y, 'rgba(255,255,255,0.4)', 6)
      return
    }
    b.fly = { key: WASTE_KEY, n: 1, x: colX(0), y: TOP_Y, at: this.time, flip: 1 }
    b.last = WASTE_KEY
    b.lastAt = this.time
    this.ctx.audio.play('flip')
  }

  /** Tap on a card: move it (and the cards on it) to the best legal place. */
  private play(side: Side, src: Src): void {
    if (this.over) return
    const b = this.s.boards[side]
    const f = this.frames[side]
    const tv = tableView(f.w, f.h)
    const srcKey = src.from === 'waste' ? WASTE_KEY : keyOf(src.col, src.idx)
    const dst = destinationFor(b, src)
    if (!dst) {
      b.nopeKey = srcKey
      b.nopeAt = this.time
      this.ctx.audio.play('click', 0.8)
      return
    }
    const from = keyPos(tv.h, b, srcKey)
    const moving = src.from === 'waste' ? 1 : (b.tab[src.col]?.length ?? 0) - src.idx
    const flips = reveals(b, src)
    const n = apply(b, src, dst)
    assign(b, n)
    let key: number
    if (dst.to === 'found') {
      key = FOUND_KEY + dst.suit
      this.ctx.audio.play('coin', 1 + home(b) * 0.015)
    } else {
      const idx = (n.tab[dst.col]?.length ?? moving) - moving
      key = keyOf(dst.col, idx)
      this.ctx.audio.play('place', 1 + moving * 0.04)
    }
    b.fly = { key, n: moving, x: from.x, y: from.y, at: this.time, flip: 0 }
    b.last = key
    b.lastAt = this.time
    const at = this.at(side, n, key)
    if (dst.to === 'found') {
      this.ctx.fx.sparks(at.x, at.y, C.yellow, 8)
      if ((n.found[dst.suit] ?? 0) === 13) {
        // A whole suit home: a proper cheer.
        this.ctx.audio.play('score', 1.1)
        this.ctx.fx.ring(at.x, at.y, C.yellow, 200)
        this.ctx.fx.burst(at.x, at.y, C.yellow, {
          count: 22,
          speed: 460,
          size: 10,
          life: 0.6,
          colors: [C.yellow, C.white, SIDE[side].light],
        })
      }
    } else {
      this.ctx.fx.burst(at.x, at.y, SIDE[side].light, { count: 6, speed: 200, size: 7, life: 0.35 })
    }
    if (flips && src.from === 'tab') {
      b.flipKey = keyOf(src.col, src.idx - 1)
      b.flipAt = this.time
      const y = cardY(tv.h, n, src.col, src.idx - 1)
      const p = toWorld(f, tv.tx + (colX(src.col) + 62) * tv.k, tv.ty + (y + 86) * tv.k)
      this.ctx.audio.play('flip', 1.15)
      this.ctx.fx.burst(p.x, p.y, C.white, { count: 6, speed: 160, size: 7, life: 0.3 })
    }
    if (home(b) === CARDS) this.solved(side)
  }

  /** Every card home: the big finish before the result screen. */
  private solved(side: Side): void {
    const f = this.frames[side]
    const c = toWorld(f, f.w / 2, f.h / 2)
    this.ctx.fx.stop(5)
    this.ctx.fx.shake(0.35)
    this.ctx.fx.flash(SIDE[side].light, 0.35)
    this.ctx.fx.ring(c.x, c.y, C.yellow, 520)
    this.ctx.fx.confetti(this.solo ? undefined : side)
    this.complete(side)
  }

  protected override step(dt: number): void {
    const wasOver = this.over
    super.step(dt)
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
          flipKey: b.flipKey,
          flipAt: b.flipAt,
          nopeKey: b.nopeKey,
          nopeAt: b.nopeAt,
          hint: !this.isBot(side) && b.taps === 0 && this.time < 12,
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
