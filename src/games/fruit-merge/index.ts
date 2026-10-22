import { BaseGame, type GameContext, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, shade } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { store, submitRecord } from '../../core/store.ts'
import { HEADER } from '../../engines/puzzle/index.ts'
import {
  type Frame,
  halfFrame,
  inFrame,
  localView,
  mirrorFx,
  toLocal,
  toWorld,
} from '../../engines/runner/frame.ts'
import { chooseX, PACE } from './bot.ts'
import { drawCard, drawHeader, drawJar, FRUIT_COLOR, GLYPH } from './render.ts'
import {
  clampX,
  drop,
  geometry,
  type Geo,
  type Jar,
  KINDS,
  kindSequence,
  type Merge,
  newJar,
  TIME_LIMIT,
  tick,
} from './rules.ts'

/** One jar and the fruit in hand. */
export interface Well {
  jar: Jar
  /** Drop x in panel-local units, following the finger. */
  aim: number
  /** Kind in hand, and its place in the shared sequence. */
  next: number
  seq: number
  /** Seconds until the next drop is allowed. */
  cool: number
  /** Game time the jar ended, or -1 while it is still playing. */
  overAt: number
  /** Game time of the last drop (the claw reloads) and of the last score. */
  dropAt: number
  scoreAt: number
}

export interface State {
  wells: [Well, Well]
  botT: [number, number]
  /** Game time the game ended (the verdict cards pop), or -1. */
  endAt: number
  /** The winner once it ended. */
  winner: Side | 'draw' | null
}

/** A timed match: the players choose its length (the clock runs for it). */
export const match: MatchSpec = {
  unit: 'seconds',
  default: TIME_LIMIT,
  min: 30,
  max: 300,
  step: 30,
}

const RECORD = 'fruit-merge'
const DROP_COOL = 0.22

class FruitMerge extends BaseGame<State> {
  private solo = false
  private frames!: [Frame, Frame]
  // Derived from the seed on both phones: never sent over the wire.
  private seq: number[] = []
  /** The finger aiming each jar (only the host steps, so this stays local). */
  private ptr: [number | null, number | null] = [null, null]
  /** Cosmetic trackers for sounds (host only). */
  private lastSec = -1
  private warnStep: [number, number] = [0, 0]

  /** Match length in seconds, as chosen before the game. */
  private get limit(): number {
    return this.ctx.target || match.default
  }

  override init(ctx: GameContext): void {
    this.solo = ctx.mode === '1p' && !ctx.bots[1]
    this.frames = [halfFrame(0, ctx.mode, this.solo), halfFrame(1, ctx.mode)]
    mirrorFx(ctx, this.frames)
    super.init(ctx)
  }

  protected setup(): State {
    this.seq = kindSequence(this.ctx.seed)
    const first = this.seq[0] ?? 0
    const well = (side: Side): Well => {
      const g = this.geo(side)
      return {
        jar: newJar(),
        aim: (g.left + g.right) / 2,
        next: first,
        seq: 0,
        cool: 0,
        overAt: -1,
        dropAt: -10,
        scoreAt: -10,
      }
    }
    return { wells: [well(0), well(1)], botT: [0, 0], endAt: -1, winner: null }
  }

  private sides(): Side[] {
    return this.solo ? [0] : [0, 1]
  }

  private geo(side: Side): Geo {
    const f = this.frames[side]
    return geometry(f.w, f.h, this.solo, HEADER)
  }

  protected step(dt: number): void {
    for (const side of this.sides()) {
      const w = this.s.wells[side]
      w.cool = Math.max(0, w.cool - dt)
      if (w.overAt < 0) {
        if (this.isBot(side)) this.botDrive(side, dt)
        else this.playerAim(side)
      }
      this.advance(side, dt)
    }
    // The last ten seconds tick down out loud.
    const left = Math.ceil(this.limit - this.time)
    if (left !== this.lastSec) {
      this.lastSec = left
      if (left <= 10 && left > 0)
        this.ctx.audio.play(left <= 3 ? 'count' : 'tick', 1 + (10 - left) * 0.04)
    }
    this.settle()
  }

  private botDrive(side: Side, dt: number): void {
    this.s.botT[side] += dt
    const w = this.s.wells[side]
    if (this.s.botT[side] < PACE[this.ctx.difficulty] || w.cool > 0) return
    this.s.botT[side] = 0
    w.aim = chooseX(w.jar, this.geo(side), w.next, this.ctx.difficulty, this.ctx.rng)
    this.dropFruit(side)
  }

  /** Drag anywhere over the jar to aim the fruit on the rail; let go to drop. */
  private playerAim(side: Side): void {
    const w = this.s.wells[side]
    const f = this.frames[side]
    const geo = this.geo(side)
    const inp = this.ctx.input.player(side)
    let id = this.ptr[side]
    if (id === null) {
      const p = inp.downs.find((d) => {
        const l = toLocal(f, d.x, d.y)
        // Anywhere over the jar: the finger aims, the fruit stays on the rail.
        return l.y >= geo.header && l.y <= geo.floor + 60 && l.x >= 0 && l.x <= f.w
      })
      if (p) {
        id = p.id
        this.ptr[side] = id
      }
    }
    if (id === null) return
    const cur = inp.held.get(id)
    if (cur) {
      const l = toLocal(f, cur.x, cur.y)
      w.aim = clampX(geo, w.next, l.x)
      return
    }
    const up = inp.ups.find((u) => u.id === id)
    if (up) {
      const l = toLocal(f, up.x, up.y)
      w.aim = clampX(geo, w.next, l.x)
      this.dropFruit(side)
    }
    this.ptr[side] = null
  }

  private dropFruit(side: Side): void {
    const w = this.s.wells[side]
    if (w.cool > 0 || w.overAt >= 0) return
    drop(w.jar, this.geo(side), w.aim, w.next, this.time)
    w.cool = DROP_COOL
    w.dropAt = this.time
    w.seq++
    w.next = this.seq[w.seq % this.seq.length] ?? 0
    this.ctx.audio.play('swish', 1.1 - w.next * 0.03)
  }

  /** Physics for one jar, and the juice for what it did this step. */
  private advance(side: Side, dt: number): void {
    const w = this.s.wells[side]
    if (w.overAt >= 0) return
    const res = tick(w.jar, this.geo(side), dt, this.time)
    if (res.merges.length) w.scoreAt = this.time
    for (const m of res.merges) this.juiceMerge(side, m)
    // A fruit lingering over the line: a warning beep every half second.
    let worst = 0
    for (const b of w.jar.bodies) worst = Math.max(worst, b.hi)
    const stepNo = Math.floor(worst * 2)
    if (stepNo > this.warnStep[side] && !this.isBot(side)) {
      this.ctx.audio.play('buzz', 0.9 + stepNo * 0.1)
      this.ctx.audio.buzz(15)
    }
    this.warnStep[side] = stepNo
    if (res.hits > 0) this.ctx.audio.play('bounce', 1.1 - Math.min(0.5, res.impact / 1400))
    if (res.over) {
      w.overAt = this.time
      this.juiceOver(side)
    }
  }

  private juiceMerge(side: Side, m: Merge): void {
    const at = toWorld(this.frames[side], m.x, m.y)
    if (m.k >= KINDS) {
      this.ctx.audio.play('powerup')
      this.ctx.fx.ring(at.x, at.y, C.yellow, 340)
      this.ctx.fx.burst(at.x, at.y, C.yellow, { count: 40, speed: 620, size: 14, life: 0.9 })
      this.ctx.fx.flash(C.yellow, 0.22)
      this.ctx.fx.shake(0.6)
      this.ctx.fx.stop(8)
      this.ctx.fx.float(`+${m.points}`, at.x, at.y, C.yellow, 84, side)
      return
    }
    const k = m.k
    const color = FRUIT_COLOR[k] ?? C.white
    this.ctx.audio.play('pop', 0.8 + k * 0.06)
    this.ctx.fx.ring(at.x, at.y, color, 60 + k * 12)
    this.ctx.fx.burst(at.x, at.y, color, {
      count: 6 + k,
      speed: 260,
      size: 28,
      life: 0.5,
      kind: 'emoji',
      glyph: GLYPH[k] ?? '🍒',
    })
    this.ctx.fx.float(`+${m.points}`, at.x, at.y - 40, C.yellow, 44 + k * 2, side)
    if (k >= 6) this.ctx.fx.shake(0.12 + k * 0.02)
    if (k >= 7) {
      this.ctx.fx.stop(3 + (k - 7) * 2)
      this.ctx.audio.play('score', 0.8 + (k - 7) * 0.1)
    }
  }

  private juiceOver(side: Side): void {
    const geo = this.geo(side)
    const at = toWorld(this.frames[side], (geo.left + geo.right) / 2, geo.danger)
    this.ctx.audio.play('thud')
    this.ctx.audio.buzz(30)
    this.ctx.fx.shake(0.5)
    this.ctx.fx.flash(C.red, 0.25)
    this.ctx.fx.burst(at.x, at.y, C.red, { count: 24, speed: 520, size: 12, life: 0.6 })
  }

  /** The game ends when every jar is full (solo: its jar), or at the time limit. */
  private settle(): void {
    if (this.over) return
    const [a, b] = this.s.wells
    const allOut = this.solo ? a.overAt >= 0 : a.overAt >= 0 && b.overAt >= 0
    if (allOut || this.time >= this.limit) this.end()
  }

  private end(): void {
    const [a, b] = this.s.wells
    this.s.endAt = this.time
    this.ctx.audio.play('whoosh')
    if (this.solo) {
      this.s.winner = 0
      if (a.overAt < 0) this.ctx.fx.confetti()
      const score = a.jar.score
      const prev = store.records[RECORD]
      const best = submitRecord(RECORD, score, false)
      const note = best ? `New record: ${score}` : `Score ${score} · best ${prev ?? score}`
      this.finish(0, { note, delay: 2 })
      return
    }
    const winner = a.jar.score === b.jar.score ? 'draw' : a.jar.score > b.jar.score ? 0 : 1
    this.s.winner = winner
    if (winner !== 'draw') {
      this.ctx.fx.confetti(winner)
      this.ctx.fx.shake(0.3)
    }
    this.finish(winner, { score: [a.jar.score, b.jar.score], delay: 2 })
  }

  render(g: Draw): void {
    g.fillView(C.ink)
    for (const side of this.sides()) {
      const f = this.frames[side]
      inFrame(g, f, () => {
        const v = localView(g, f)
        g.rect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0, shade(SIDE[side].main, -0.78))
        this.renderWell(g, side, f.w, f.h)
      })
    }
    if (!this.solo) g.rect(g.stage.view.x - 2, MID - 7, g.stage.view.w + 4, 14, C.ink)
  }

  private renderWell(g: Draw, side: Side, w: number, h: number): void {
    const well = this.s.wells[side]
    const geo = geometry(w, h, this.solo, HEADER)
    drawHeader(g, w, side, {
      name: this.ctx.names[side],
      score: well.jar.score,
      scoreAt: well.scoreAt,
      remaining: this.limit - this.time,
      now: this.time,
    })
    drawJar(
      g,
      geo,
      side,
      w,
      {
        jar: well.jar,
        aim: well.aim,
        next: well.next,
        after: this.seq[(well.seq + 1) % this.seq.length] ?? 0,
        dropAt: well.dropAt,
        live: well.overAt < 0 && this.s.endAt < 0,
        hint: !this.isBot(side) && well.seq === 0 && this.time < 8,
      },
      this.time,
    )
    const { endAt, winner } = this.s
    const score = `${well.jar.score} pts`
    if (endAt >= 0) {
      // The verdict, on each jar.
      const won = winner === side
      const title = this.solo
        ? well.overAt >= 0
          ? 'Jar full!'
          : 'Time!'
        : winner === 'draw'
          ? 'Draw!'
          : won
            ? 'Winner!'
            : 'So close!'
      drawCard(g, geo, side, title, score, {
        at: endAt,
        now: this.time,
        color: this.solo || won ? SIDE[side].main : shade(SIDE[side].main, -0.5),
        crown: !this.solo && won,
      })
    } else if (well.overAt >= 0) {
      drawCard(g, geo, side, 'Jar full!', score, { at: well.overAt, now: this.time })
    }
  }
}

export default () => new FruitMerge()
