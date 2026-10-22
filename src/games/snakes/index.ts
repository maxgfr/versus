import { Button } from '../../core/controls.ts'
import { BaseGame, STEP, type MatchSpec, type Side } from '../../core/game.ts'
import { frame, toLocal } from '../../core/frame.ts'
import { Spring } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { roundEnd, roundsNew, roundsStep, type Rounds } from '../../engines/reflex/index.ts'
import { SnakeBot } from './bot.ts'
import { renderSnakes, type TurnLook } from './render.ts'
import {
  type Board,
  CELL,
  cellCentre,
  COUNT,
  DX,
  DY,
  type Ev,
  newBoard,
  free,
  queueTurn,
  tick,
  tickLen,
} from './rules.ts'

/** A drag this long (world units) on your half is a swipe: it steers the bike that way. */
const SWIPE = 56

export interface State {
  b: Board
  rounds: Rounds
  /** Turn buttons, so the online guest can draw them. */
  ctl: TurnLook[]
}

/** Round wins to take the match (first to three of five by default). */
export const match: MatchSpec = { unit: 'wins', default: 3, min: 1, max: 5 }

/** Seconds between rounds, while the banner shows. */
const PAUSE = 2.2
/** Turn button radius (world units). */
const BTN_R = 86
const BTN_R_TEAMS = 80

/**
 * Turn button spots in red's frame (red reads them upright, the bottom strip):
 * solo, one pair per side; teams, a pair per lane (lane 0 on the left).
 */
function spotsOf(
  teams: boolean,
  lane: 0 | 1,
): [{ x: number; y: number }, { x: number; y: number }] {
  if (!teams)
    return [
      { x: 230, y: 1600 },
      { x: 770, y: 1600 },
    ]
  return lane === 0
    ? [
        { x: 120, y: 1600 },
        { x: 340, y: 1600 },
      ]
    : [
        { x: 660, y: 1600 },
        { x: 880, y: 1600 },
      ]
}

class Snakes extends BaseGame<State> {
  /** Per bike: [turn left, turn right]. */
  private btns: [Button, Button][] = []
  private bots: (SnakeBot | null)[] = []
  private ev: Ev[] = []
  private beat = -1
  private went = false
  /** Swipe anchors per pointer id (host-side input reading only). */
  private anchors = new Map<number, { x: number; y: number }>()
  // Cosmetic only (not synced): a lean on each turn, seen through the heading.
  private lean: Spring[] = []
  private dirs: number[] = []
  private grazeAt: number[] = []

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    // The shell has just counted down: the first round starts at once.
    const b = newBoard(ctx.teams, this.time - COUNT)
    const r = ctx.teams ? BTN_R_TEAMS : BTN_R
    this.btns = b.bikes.map((k) => {
      const [l, rt] = spotsOf(ctx.teams, k.lane)
      const L = frame(k.side, l.x, l.y)
      const R = frame(k.side, rt.x, rt.y)
      return [new Button(k.side, L.x, L.y, r), new Button(k.side, R.x, R.y, r)]
    })
    this.bots = b.bikes.map((k) =>
      ctx.bots[k.side] ? SnakeBot.of(ctx.rng.fork(), ctx.difficulty) : null,
    )
    return { b, rounds: roundsNew(this.target), ctl: this.looks(b) }
  }

  private looks(b: Board): TurnLook[] {
    const out: TurnLook[] = []
    this.btns.forEach((pair, id) => {
      const k = b.bikes[id]
      if (!k) return
      pair.forEach((btn, i) =>
        out.push({
          side: k.side,
          lane: k.lane,
          turn: i === 0 ? -1 : 1,
          x: btn.x,
          y: btn.y,
          r: btn.r,
          on: btn.pressed,
        }),
      )
    })
    return out
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    if (roundsStep(s.rounds, this.time, PAUSE)) {
      s.b = newBoard(ctx.teams, this.time)
      this.went = false
      this.anchors.clear()
      ctx.audio.play('whoosh')
      return
    }
    // A tick on each 3-2-1 of the in-round countdown (rounds after the first).
    const e = this.time - s.rounds.at
    if (s.rounds.phase === 'play' && s.rounds.round > 1 && e >= 0.8 && e < COUNT - 0.4) {
      const n = Math.floor((e - 0.8) / 0.4)
      if (n !== this.beat) {
        this.beat = n
        ctx.audio.play('count')
      }
    } else this.beat = -1
    const playing = s.rounds.phase === 'play'
    // Human turns: a press on a turn button queues one turn for that bike.
    s.b.bikes.forEach((k, id) => {
      const pair = this.btns[id]
      if (!pair) return
      if (!this.bots[id]) {
        pair.forEach((btn, i) => {
          btn.update(ctx.input.player(k.side))
          if (btn.hit && playing) queueTurn(k, i === 0 ? -1 : 1)
        })
      } else for (const btn of pair) btn.update(ctx.input.player(k.side))
    })
    if (playing) this.swipes()
    const started = playing && this.time >= s.b.go
    if (started && !this.went) {
      this.went = true
      if (s.rounds.round > 1) ctx.audio.play('go')
    }
    // Wrecks smoulder.
    if (Math.floor(this.time * 8) !== Math.floor((this.time - dt) * 8))
      for (const k of s.b.bikes) {
        if (k.alive || this.time - k.diedT > 3) continue
        const c = cellCentre(k.x, k.y)
        ctx.fx.puff(
          c.x + (DX[k.dir] ?? 0) * CELL * 0.5,
          c.y + (DY[k.dir] ?? 0) * CELL * 0.5,
          'rgba(60,56,80,0.5)',
          1,
        )
      }
    this.ev.length = 0
    if (started) {
      s.b.acc += dt
      let winner: Side | 'draw' | null = null
      while (s.b.acc >= tickLen(s.b.ticks) && winner === null) {
        s.b.acc -= tickLen(s.b.ticks)
        for (const k of s.b.bikes) {
          const bot = this.bots[k.id]
          if (!bot || !k.alive) continue
          const t = bot.choose(s.b, k.id)
          if (t !== 0) queueTurn(k, t as 1 | -1)
        }
        winner = tick(s.b, this.time, this.ev)
      }
      for (const e of this.ev) this.feedback(e)
      if (winner === null) this.graze()
      if (winner !== null) this.roundOver(winner)
    }
    s.ctl = this.looks(s.b)
  }

  /**
   * Swipes: a drag across your half steers your bike in that direction (as you
   * see it), turning left or right of its heading. A drag starting on a turn
   * button is a button press, not a swipe; reversing is impossible and ignored.
   */
  private swipes(): void {
    const { ctx } = this
    const s = this.s
    for (const side of [0, 1] as Side[]) {
      if (this.isBot(side)) continue
      const inp = ctx.input.player(side)
      for (const p of inp.ups) this.anchors.delete(p.id)
      for (const p of inp.held.values()) {
        let a = this.anchors.get(p.id)
        if (!a) {
          const onBtn = s.ctl.some(
            (t) => t.side === side && (p.x0 - t.x) ** 2 + (p.y0 - t.y) ** 2 <= (t.r * 1.25) ** 2,
          )
          a = onBtn ? { x: NaN, y: NaN } : { x: p.x0, y: p.y0 }
          this.anchors.set(p.id, a)
        }
        if (Number.isNaN(a.x)) continue
        const dx = p.x - a.x
        const dy = p.y - a.y
        if (dx * dx + dy * dy < SWIPE * SWIPE) continue
        a.x = p.x
        a.y = p.y
        // Direction in the board's frame (blue's half is read turned around).
        const l0 = toLocal(side, 0, 0)
        const l1 = toLocal(side, dx, dy)
        const lx = l1.x - l0.x
        const ly = l1.y - l0.y
        const want = Math.abs(lx) > Math.abs(ly) ? (lx > 0 ? 1 : 3) : ly > 0 ? 2 : 0
        const world = side === 0 ? want : (want + 2) % 4
        // 2 vs 2: the swipe steers the bike of the lane it started in.
        const k = s.b.bikes.find(
          (b) => b.side === side && b.alive && (!ctx.teams || b.lane === laneOf(side, p.x0)),
        )
        if (!k) continue
        // Relative to where the bike will be heading once its queue has run.
        let dir = k.dir
        for (const t of k.q) dir = (dir + t + 4) % 4
        const turn = (world - dir + 4) % 4
        if (turn === 1) queueTurn(k, 1)
        else if (turn === 3) queueTurn(k, -1)
      }
    }
  }

  /** Riding right alongside a wall or trail throws sparks off that side. */
  private graze(): void {
    const { ctx } = this
    for (const k of this.s.b.bikes) {
      if (!k.alive || this.time - (this.grazeAt[k.id] ?? -9) < 0.12) continue
      for (const t of [-1, 1]) {
        const d = (k.dir + t + 4) % 4
        if (free(this.s.b, k.x + (DX[d] ?? 0), k.y + (DY[d] ?? 0))) continue
        this.grazeAt[k.id] = this.time
        const c = cellCentre(k.x, k.y)
        ctx.fx.burst(c.x + (DX[d] ?? 0) * CELL * 0.45, c.y + (DY[d] ?? 0) * CELL * 0.45, C.yellow, {
          count: 3,
          speed: 240,
          size: 5,
          life: 0.22,
          gravity: 0,
          kind: 'spark',
          spread: 1.2,
          dir: Math.atan2(-(DY[k.dir] ?? 0), -(DX[k.dir] ?? 0)),
        })
        break
      }
    }
  }

  private roundOver(w: Side | 'draw'): void {
    const { ctx } = this
    const s = this.s
    ctx.audio.play(w === 'draw' ? 'draw' : 'score')
    if (w !== 'draw') {
      const k = s.b.bikes.find((b) => b.side === w && b.alive)
      const c = k ? cellCentre(k.x, k.y) : undefined
      if (c) {
        ctx.fx.ring(c.x, c.y, C.yellow, 160)
        // In the winner's own half, clear of the crash it walked away from.
        floatFor(ctx.fx, w, 'Survivor!')
      }
    }
    if (roundEnd(s.rounds, w, this.time, ctx.names) && w !== 'draw') {
      ctx.fx.confetti(w)
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2.2 })
    }
  }

  private feedback(e: Ev): void {
    const { fx, audio } = this.ctx
    switch (e.k) {
      case 'turn':
        audio.play('tap', 1.1 + Math.random() * 0.2)
        fx.burst(e.x, e.y, SIDE[e.side].light, {
          count: 5,
          speed: 160,
          size: 8,
          life: 0.3,
          gravity: 0,
        })
        break
      case 'crash':
        audio.play('explode', 0.9 + Math.random() * 0.2)
        fx.flash(SIDE[e.side].main, 0.2)
        audio.buzz(60)
        fx.burst(e.x, e.y, C.orange, {
          count: 30,
          speed: 560,
          size: 16,
          life: 0.7,
          gravity: 0,
          colors: [C.orange, C.yellow, SIDE[e.side].light, '#ffffff'],
        })
        fx.burst(e.x, e.y, '#3a3458', {
          count: 12,
          speed: 200,
          size: 26,
          life: 0.9,
          gravity: -60,
          drag: 2.5,
        })
        fx.ring(e.x, e.y, SIDE[e.side].light, 180)
        fx.shake(0.55)
        fx.stop(6)
        break
    }
  }

  render(g: Draw, alpha: number): void {
    const s = this.s
    // Each turn (seen through the synced heading) leans the bike into it.
    s.b.bikes.forEach((k, i) => {
      const sp = (this.lean[i] ??= new Spring(0, 260, 13))
      const was = this.dirs[i]
      // Start from (most of) the old heading and swing into the new one.
      if (was !== undefined && was !== k.dir) sp.set(((k.dir - was + 4) % 4 === 1 ? 1 : -1) * 1.1)
      this.dirs[i] = k.dir
      sp.update(1 / 60)
    })
    // Between fixed steps the bikes keep rolling: draw them where they are.
    const running = s.rounds.phase === 'play' && this.time >= s.b.go && !this.over
    const p = (s.b.acc + (running ? alpha * STEP : 0)) / tickLen(s.b.ticks)
    renderSnakes(g, s, this.time, this.ctx.names, this.over, {
      p: Math.min(1, p),
      lean: this.lean.map((l) => l.value),
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.dirs = []
  }
}

/** The lane (2 vs 2 teammate) a touch at world x belongs to, as `side` sees it. */
function laneOf(side: Side, x: number): 0 | 1 {
  const lx = side === 0 ? x : 1000 - x
  return lx < 500 ? 0 : 1
}

export default () => new Snakes()
