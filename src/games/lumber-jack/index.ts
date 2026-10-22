import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { Spring } from '../../core/fx/ease.ts'
import { frame, toLocal } from '../../core/frame.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { W } from '../../core/stage.ts'
import { tapRipple } from '../../engines/reflex/index.ts'
import { ChopBot } from './bot.ts'
import { BASE_BOT, biteAt, headAt, renderYard, SEG_W, TRUNK_X, type Look } from './render.ts'
import {
  chop,
  chopperNew,
  isStunned,
  TARGET,
  trunkNew,
  winnerOf,
  type State as Rules,
} from './rules.ts'

/** Segments to chop to win: the players pick it on the ready screen. */
export const match: MatchSpec = { unit: 'points', default: TARGET, min: 20, max: 70, step: 10 }

export interface State extends Rules {
  /** Game time the race was won (-1 while racing): drives the ending. */
  endAt: number
  /** The winner's trunk has crashed down (its dust and thud played). */
  crashed: boolean
}

/** Something that happened, turned into juice in one place. */
type Ev =
  | { kind: 'chop' | 'bonk'; side: Side; from: 0 | 1 }
  | { kind: 'dud'; side: Side }
  | { kind: 'end'; winner: Side | 'draw' }

const newSprings = () => ({
  /** Trunk shove away from the axe (x offset, rest 0). */
  sway: new Spring(0, 260, 9),
  /** Lumberjack squash on each blow (rest 1). */
  squash: new Spring(1, 380, 12),
  /** Score pop (rest 0). */
  pulse: new Spring(0, 240, 11),
})

class LumberJack extends BaseGame<State> {
  private bots: [ChopBot | null, ChopBot | null] = [null, null]
  // Cosmetic only (not synced): springs kicked by what render sees change in
  // state, so the online guest animates exactly like the host.
  private springs = [newSprings(), newSprings()] as const
  private seenChop: [number, number] = [-1, -1]
  /** Last "can't chop, stunned" thunk per side, to keep a mash from spamming it. */
  private dudAt: [number, number] = [-1, -1]

  /** Segments to chop to win. */
  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.bots = [0, 1].map((side) =>
      ctx.bots[side as Side]
        ? new ChopBot(ctx.rng.fork(), ctx.difficulty, side as Side, this.target)
        : null,
    ) as [ChopBot | null, ChopBot | null]
    return { seq: trunkNew(ctx.rng), p: [chopperNew(), chopperNew()], endAt: -1, crashed: false }
  }

  protected step(_dt: number): void {
    const s = this.s
    const { ctx } = this
    for (const side of [0, 1] as Side[]) {
      const bot = this.bots[side]
      if (bot) {
        const from = bot.step(this.time, s)
        if (from !== null) this.doChop(side, from)
        continue
      }
      for (const p of ctx.input.player(side).downs) {
        // Left or right of the trunk, as the player sees their own half.
        const from = toLocal(side, p.x, p.y).x < W / 2 ? 0 : 1
        tapRipple(ctx, side, p.x, p.y)
        this.doChop(side, from)
      }
    }
    const w = winnerOf(s, this.target)
    if (w === null) return
    s.endAt = this.time
    this.juice({ kind: 'end', winner: w })
    this.finish(w, { score: [s.p[0].chops, s.p[1].chops], delay: 2.4 })
  }

  private doChop(side: Side, from: 0 | 1): void {
    const r = chop(this.s, side, from, this.time, this.target)
    if (r === 'ignored') {
      if (isStunned(this.s.p[side], this.time)) this.juice({ kind: 'dud', side })
      return
    }
    this.juice({ kind: r, side, from })
  }

  /**
   * All the feedback. A chop's intensity `k` is its pace (quick follow-ups hit
   * harder): it scales chips, sparks, pitch, shake and buzz; the combo raises
   * the pitch further. A repeat bonk hits harder than a lone one.
   */
  private juice(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    const s = this.s
    if (e.kind === 'dud') {
      if (this.time - this.dudAt[e.side] < 0.25) return
      this.dudAt[e.side] = this.time
      audio.play('tick', 0.55)
      return
    }
    if (e.kind === 'end') {
      const w = e.winner
      if (w !== 'draw') {
        const p = frame(w, TRUNK_X, BASE_BOT - 300)
        fx.burst(p.x, p.y, C.yellow, {
          count: 28,
          speed: 720,
          size: 12,
          kind: 'spark',
          colors: [C.yellow, C.white, SIDE[w].light],
        })
        fx.ring(p.x, p.y, SIDE[w].light, 360)
        fx.flash(SIDE[w].main, 0.25)
        audio.buzz(40)
      } else {
        fx.flash(C.white, 0.25)
        for (const side of [0, 1] as Side[]) {
          const p = frame(side, TRUNK_X, 1180)
          fx.float('Dead heat!', p.x, p.y, C.yellow, 72, side)
        }
      }
      fx.shake(0.3)
      // The race is over: freezing the clock is fair now.
      fx.stop(8)
      return
    }
    const { side, from } = e
    const c = s.p[side]
    const k = c.pace
    const b = biteAt(from)
    const at = frame(side, b.x, b.y)
    // Chips fly back toward the chopper, harder on a quick chop.
    const out = frame(side, b.x + (from === 0 ? -1 : 1), b.y)
    const dir = Math.atan2(out.y - at.y, out.x - at.x)
    fx.burst(at.x, at.y, C.wood, {
      count: Math.round(8 + k * 12),
      speed: 420 + k * 320,
      size: 10,
      kind: 'square',
      gravity: 1100,
      spread: 1.6,
      dir,
      colors: [C.wood, '#f3d29a', C.woodDark],
    })
    if (k > 0.35) fx.sparks(at.x, at.y, '#f3d29a', Math.round(3 + k * 7))
    fx.shake(0.04 + k * 0.08)
    audio.play('thud', 1.0 + (from === 0 ? -0.06 : 0.06) + k * 0.2 + rng.next() * 0.05)
    audio.play('tap', 0.7 + Math.min(20, c.combo) * 0.025)
    if (k > 0.6) audio.buzz(8)
    const n = c.chops
    const left = this.target - n
    const mid = frame(side, TRUNK_X, 1180)
    if (n === this.target / 2) {
      fx.float('Halfway!', mid.x, mid.y, SIDE[side].light, 64, side)
      audio.play('powerup', 1)
    } else if (left === 5) {
      fx.float('5 to go!', mid.x, mid.y, C.yellow, 64, side)
      audio.play('powerup', 1.2)
    } else if (e.kind === 'chop' && c.combo >= 10 && c.combo % 10 === 0) {
      const hp = headAt(from)
      const head = frame(side, hp.x, hp.y - 150)
      fx.float(`${c.combo} in a row!`, head.x, head.y, C.yellow, 56, side)
      fx.ring(head.x, head.y, C.yellow, 160)
      audio.play('coin', 1 + Math.min(4, c.combo / 10) * 0.08)
    }
    if (e.kind === 'bonk') {
      const d = c.dizzy
      const hp = headAt(from)
      const head = frame(side, hp.x, hp.y)
      fx.burst(head.x, head.y, C.yellow, {
        count: 18 + d * 6,
        speed: 480 + d * 80,
        size: 12,
        kind: 'spark',
      })
      fx.burst(head.x, head.y, '#3fb760', { count: 10, speed: 360, size: 12, gravity: 700 })
      // No hit-stop mid-race: it would freeze the rival too.
      fx.shake(0.35 + Math.min(2, d) * 0.12)
      fx.flash(SIDE[side].main, 0.2 + Math.min(2, d) * 0.06)
      const up = side === 0 ? -1 : 1
      fx.float(d > 0 ? 'Dizzy!' : 'Bonk!', head.x, head.y + up * 150, C.yellow, 84, side)
      audio.play('slap', 1.1 - Math.min(2, d) * 0.1)
      audio.play('boing', 0.9)
      audio.buzz(25 + Math.min(2, d) * 10)
    }
  }

  protected override afterEnd(_dt: number): void {
    const s = this.s
    const w = winnerOf(s, this.target)
    if (s.crashed || w === null || w === 'draw' || this.time - s.endAt < 0.95) return
    // The winner's trunk hits the ground.
    s.crashed = true
    const { fx, audio } = this.ctx
    const c = s.p[w]
    const fallDir = c.from === 0 ? 1 : -1
    const p = frame(w, TRUNK_X + fallDir * (SEG_W / 2 + 280), BASE_BOT - 40)
    fx.puff(p.x, p.y, 'rgba(240,220,170,0.8)', 14)
    fx.burst(p.x, p.y, C.wood, {
      count: 22,
      speed: 600,
      size: 12,
      kind: 'square',
      colors: [C.wood, '#f3d29a', C.woodDark, '#3fb760'],
    })
    fx.shake(0.6)
    fx.confetti(w)
    audio.play('explode', 0.7)
    audio.buzz(30)
  }

  /** Kick the springs for every chop render has not seen yet (host and guest alike). */
  private animate(): void {
    for (const side of [0, 1] as Side[]) {
      const c = this.s.p[side]
      if (c.chopAt === this.seenChop[side]) continue
      this.seenChop[side] = c.chopAt
      if (c.chopAt < 0) continue
      const sp = this.springs[side]
      const away = c.from === 0 ? 1 : -1
      sp.sway.kick(away * (260 + c.pace * 520))
      sp.squash.kick(c.bonk ? -8 : -2.5 - c.pace * 3)
      sp.pulse.kick(10 + c.pace * 6)
    }
  }

  render(g: Draw): void {
    this.animate()
    const dt = 1 / 60
    const look: Look = { sway: [0, 0], squash: [1, 1], pulse: [0, 0] }
    for (const side of [0, 1] as Side[]) {
      const sp = this.springs[side]
      look.sway[side] = sp.sway.update(dt)
      look.squash[side] = sp.squash.update(dt)
      look.pulse[side] = Math.max(0, sp.pulse.update(dt) / 14)
    }
    renderYard(g, this.s, this.time, {
      names: this.ctx.names,
      target: this.target,
      endAt: this.s.endAt,
      winner: this.s.endAt >= 0 ? winnerOf(this.s, this.target) : null,
      bots: this.ctx.bots,
      look,
    })
  }
}

export default () => new LumberJack()
