import { Joystick } from '../../core/controls.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { Spring } from '../../core/fx/ease.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { type BotMemory, decide, newMemory } from './bot.ts'
import { render, type Look, type Stick } from './render.ts'
import {
  BOWL,
  matchWinner,
  type Event,
  newWorld,
  step,
  STEER_REACH,
  type Targets,
  type World,
} from './rules.ts'

interface State {
  w: World
  /** Each human top's floating stick (by top index), so the online guest sees it too. */
  sticks: (Stick | null)[]
  /** The decided match, stamped so the guest plays the same ending. */
  end: { at: number; winner: Side } | null
}

/** Rounds to win the match (best of three is first to two). */
export const match: MatchSpec = { unit: 'wins', default: 2, min: 1, max: 5 }

/** Sticks steer toward a point kept inside the bowl: you get knocked out, you never drive out. */
function inBowl(x: number, y: number): { x: number; y: number } {
  const dx = x - BOWL.x
  const dy = y - BOWL.y
  const d = Math.hypot(dx, dy)
  const max = BOWL.r * 0.9
  return d <= max ? { x, y } : { x: BOWL.x + (dx / d) * max, y: BOWL.y + (dy / d) * max }
}

class SpinWar extends BaseGame<State> {
  private mem: BotMemory[] = [newMemory(), newMemory()]
  private sticks: Joystick[] = []
  // Cosmetic only (not synced): a flash per top when it takes a hit.
  private flash: Spring[] = []
  private lastHit = -1

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const w = newWorld(this.ctx.teams, this.target, this.ctx.rng)
    return { w, sticks: w.tops.map(() => null), end: null }
  }

  /** A floating stick per top: in local 2P inside its side's half (and lane), else anywhere. */
  private stick(i: number, side: Side, lane: 0 | 1): Joystick {
    let st = this.sticks[i]
    if (!st) {
      const half = this.ctx.mode === '2p'
      const zone = half
        ? { x: 0, y: side === 0 ? MID : 0, w: W, h: MID }
        : { x: 0, y: 0, w: W, h: H }
      st = new Joystick(
        side,
        zone,
        110,
        zone.x + zone.w / 2,
        zone.y + zone.h / 2,
        this.s.w.teams ? lane : undefined,
      )
      this.sticks[i] = st
    }
    return st
  }

  protected step(dt: number): void {
    const w = this.s.w
    const targets = this.aims(w, dt)
    const round = w.round
    const events = step(w, dt, targets, this.ctx.rng)
    if (w.round !== round) this.ctx.audio.play('go', 1)
    for (const e of events) this.juice(e)
    const won = matchWinner(w)
    if (won !== null && !this.s.end) {
      this.s.end = { at: this.time, winner: won }
      this.ctx.fx.confetti(won)
      this.ctx.fx.stop(6)
      this.ctx.audio.buzz(40)
      this.finish(won, { score: [w.wins[0], w.wins[1]], delay: 2.2 })
    }
  }

  protected override afterEnd(dt: number): void {
    // The winner keeps spinning while the ending plays.
    step(
      this.s.w,
      dt,
      this.s.w.tops.map(() => null),
      this.ctx.rng,
    )
    this.s.sticks = this.s.w.tops.map(() => null)
  }

  /** Where each top is steered this step: the bot's plan, or ahead of the top along its stick. */
  private aims(w: World, dt: number): Targets {
    const out: Targets = w.tops.map(() => null)
    if (this.s.sticks.length !== w.tops.length) this.s.sticks = w.tops.map(() => null)
    for (const side of [0, 1] as Side[]) {
      if (this.isBot(side)) {
        const bot = decide(
          w,
          side,
          this.ctx.difficulty,
          this.ctx.rng,
          this.mem[side] as BotMemory,
          dt,
        )
        w.tops.forEach((t, i) => {
          if (t.side === side) out[i] = bot[i] ?? null
        })
        continue
      }
      const input = this.ctx.input.player(side)
      w.tops.forEach((t, i) => {
        if (t.side !== side) return
        const st = this.stick(i, side, t.lane)
        st.update(input)
        this.s.sticks[i] =
          st.active && !t.out ? { bx: st.baseX, by: st.baseY, kx: st.knobX, ky: st.knobY } : null
        out[i] = st.active ? inBowl(t.x + st.x * STEER_REACH, t.y + st.y * STEER_REACH) : null
      })
    }
    return out
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const w = this.s.w
    switch (e.kind) {
      case 'hit': {
        // Tops grinding together report a contact every substep: juice the clash, not the grind.
        if (this.time - this.lastHit < 0.08) break
        this.lastHit = this.time
        const k = Math.min(1, e.speed / 1400)
        audio.play('hit', 0.75 + k * 0.6)
        audio.play('zap', 1.2 + k * 0.4)
        fx.sparks(e.x, e.y, C.yellow, Math.round(8 + k * 16))
        fx.burst(e.x, e.y, C.white, {
          count: Math.round(4 + k * 8),
          speed: 900,
          size: 5,
          life: 0.3,
          gravity: 0,
          kind: 'spark',
        })
        if (e.speed > 500) fx.ring(e.x, e.y, C.yellow, 90 + k * 90)
        if (e.speed > 800) fx.shake(0.1 + k * 0.2)
        if (e.speed > 1100) {
          fx.stop(3)
          audio.buzz(16)
        }
        // Flash the tops in the clash.
        w.tops.forEach((t, i) => {
          if (Math.hypot(t.x - e.x, t.y - e.y) < t.r * 1.6) this.flashFor(i).kick(8 + k * 8)
        })
        break
      }
      case 'out': {
        const col = SIDE[e.side]
        if (e.reason === 'bowl') {
          audio.play('whoosh', 0.9)
          audio.play('thud', 0.7)
          fx.burst(e.x, e.y, col.main, {
            count: 22,
            speed: 600,
            size: 12,
            life: 0.6,
            gravity: 0,
            drag: 2.4,
            colors: [col.main, col.light, C.white],
            kind: 'square',
          })
          fx.shake(0.3)
        } else {
          audio.play('lose', 1.2)
          fx.puff(e.x, e.y, 'rgba(255,248,239,0.6)', 10)
        }
        floatFor(fx, e.side, e.reason === 'bowl' ? 'RING OUT!' : 'STOPPED', e.x, e.y)
        break
      }
      case 'round': {
        if (e.winner === 'draw') {
          audio.play('draw')
          break
        }
        audio.play('score')
        audio.buzz(18)
        fx.flash(SIDE[e.winner].main, 0.3)
        fx.shake(0.4)
        if (matchWinner(w) === null) fx.confetti(e.winner)
        break
      }
    }
  }

  private flashFor(i: number): Spring {
    let s = this.flash[i]
    if (!s) {
      s = new Spring(0, 300, 18)
      this.flash[i] = s
    }
    return s
  }

  render(g: Draw, _alpha: number): void {
    const w = this.s.w
    for (let i = 0; i < w.tops.length; i++) this.flashFor(i).update(1 / 60)
    const look: Look = {
      names: this.ctx.names,
      target: this.target,
      sticks: this.s.sticks,
      end: this.s.end,
      time: this.time,
      flash: w.tops.map((_, i) => Math.max(0, Math.min(1, this.flashFor(i).value / 8))),
      human: [!this.isBot(0), !this.isBot(1)],
    }
    render(g, w, look)
  }
}

export default () => new SpinWar()
