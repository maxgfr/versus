import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import {
  type ControlLook,
  firePressed,
  type SideControl,
  sideControls,
  snapControl,
} from '../../engines/arena/index.ts'
import { CatBot } from './bot.ts'
import { renderGuard } from './render.ts'
import {
  type Drive,
  type Ev,
  levelOf,
  type Level,
  MAPS,
  matchWinner,
  newWorld,
  ROUND_T,
  roundWinner,
  type Score,
  scoreAdd,
  scoreNew,
  stepWorld,
  thiefOf,
  type World,
} from './rules.ts'

export interface State {
  /** Index into MAPS (the grid is rebuilt from it, never snapshotted). */
  map: number
  w: World
  score: Score
  /** A round is being played, or the pause between two rounds. */
  phase: 'play' | 'between'
  /** Game time the phase began. */
  at: number
  /** Banner shown between rounds. */
  text: string
  /** Button and stick looks, so the online guest can draw them. */
  ctl: ControlLook[]
}

/** Rounds in a match (each side plays the thief equally often; even by default). */
export const match: MatchSpec = { unit: 'rounds', default: 2, min: 2, max: 8, step: 2 }

/** Pause between rounds, seconds. */
const BETWEEN = 2.4

class GuardAndThief extends BaseGame<State> {
  private controls: SideControl[] = []
  private bots: (CatBot | null)[] = []
  private ev: Ev[] = []
  private lv: Level | null = null
  private lvIndex = -1

  private get target(): number {
    return this.ctx.target || match.default
  }

  private level(): Level {
    if (!this.lv || this.lvIndex !== this.s.map) {
      this.lv = levelOf(this.s.map)
      this.lvIndex = this.s.map
    }
    return this.lv
  }

  protected setup(): State {
    const { ctx } = this
    this.controls = [...sideControls(ctx.stage, 0, false), ...sideControls(ctx.stage, 1, false)]
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new CatBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    const map = ctx.rng.int(0, MAPS.length - 1)
    const score = scoreNew(this.target)
    return {
      map,
      w: newWorld(levelOf(map), thiefOf(0)),
      score,
      phase: 'play',
      at: 0,
      text: '',
      ctl: this.controls.map((c) => snapControl(c, 1)),
    }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    if (s.phase === 'between') {
      if (this.time - s.at >= BETWEEN) {
        s.map = ctx.rng.int(0, MAPS.length - 1)
        s.w = newWorld(this.level(), thiefOf(s.score.played))
        s.phase = 'play'
        s.at = this.time
        s.text = ''
        ctx.audio.play('go')
      }
      return
    }
    const level = this.level()
    const drives: Drive[] = ([0, 1] as Side[]).map((side) => {
      const c = this.controls[side] as SideControl
      const bot = this.bots[side]
      if (bot) {
        const d = bot.decide(s.w, level, side, dt)
        c.stick.set(d.jx, d.jy)
        if (d.press) c.fire.press(1)
        return d
      }
      const input = ctx.input.player(side)
      c.stick.update(input)
      c.fire.update(input)
      return { jx: c.stick.x, jy: c.stick.y, press: firePressed(c, input) }
    })
    this.ev.length = 0
    const before = Math.ceil(ROUND_T - s.w.t)
    stepWorld(s.w, level, drives, dt, this.ev)
    const left = Math.ceil(ROUND_T - s.w.t)
    if (left !== before && left <= 5 && left > 0) ctx.audio.play('tick', 1.2)
    for (const e of this.ev) this.feedback(e)
    s.ctl = this.controls.map((c) => {
      const p = s.w.pawns[c.side]
      const cd = c.side === s.w.thief ? 3.6 : 4
      const ready = Math.min(1, Math.max(0, 1 - (p.ready - s.w.t) / cd))
      return snapControl(c, ready)
    })
    const won = roundWinner(s.w)
    if (won === null) return
    const thief = s.w.thief
    scoreAdd(s.score, won, s.w.winT)
    const names = ctx.names
    s.text =
      won === thief
        ? `${names[won]} grabs all the loot`
        : s.w.winT >= ROUND_T
          ? `Time is up, ${names[won]} holds`
          : `${names[won]} catches the thief`
    s.phase = 'between'
    s.at = this.time
    ctx.audio.play('score')
    const m = matchWinner(s.score)
    if (m !== null) {
      if (m !== 'draw') ctx.fx.confetti(m)
      this.finish(m, { score: [s.score.wins[0], s.score.wins[1]], delay: 2.6 })
    }
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    const guard: Side = this.s.w.thief === 0 ? 1 : 0
    const n = this.s.w.loot.length
    switch (e.k) {
      case 'loot': {
        audio.play('coin', 0.9 + e.n * 0.08)
        fx.sparks(e.x, e.y, C.yellow, 16)
        fx.ring(e.x, e.y, C.yellow, 120)
        fx.float(`${e.n}/${n}`, e.x, e.y - 70, C.yellow, 52, this.s.w.thief)
        if (e.n === n) {
          audio.play('powerup')
          fx.confetti(this.s.w.thief)
          fx.flash(C.yellow, 0.3)
        }
        fx.shake(0.12)
        break
      }
      case 'spot':
        audio.play('zap', 0.9)
        fx.ring(e.x, e.y, C.yellow, 150)
        fx.float('Spotted!', e.x, e.y - 90, C.yellow, 44, guard)
        fx.shake(0.18)
        break
      case 'hide':
        audio.play('whoosh', 0.8 + rng.next() * 0.1)
        fx.puff(e.x, e.y, 'rgba(20,14,34,0.7)', 12)
        break
      case 'nohide':
        audio.play('error', 1)
        fx.float('No shadow!', e.x, e.y - 80, C.white, 40, this.s.w.thief)
        break
      case 'sprint':
        audio.play('whoosh', 1.25 + rng.next() * 0.1)
        fx.puff(e.x, e.y, 'rgba(255,255,255,0.45)', 6)
        break
      case 'catch':
        audio.play('hit')
        audio.play('explode', 1.1)
        audio.buzz(80)
        fx.burst(e.x, e.y, SIDE[guard].light, {
          count: 26,
          speed: 520,
          size: 14,
          life: 0.6,
          gravity: 300,
          colors: [SIDE[guard].main, C.yellow, C.white],
        })
        fx.ring(e.x, e.y, SIDE[guard].light, 240)
        fx.flash(SIDE[guard].light, 0.32)
        fx.shake(0.7)
        fx.stop(7)
        break
      case 'timeout':
        audio.play('buzz', 0.8)
        audio.buzz(40)
        fx.shake(0.25)
        break
    }
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.lv = null
  }

  render(g: Draw): void {
    renderGuard(g, this.s, this.level(), this.ctx.names, this.time, this.over)
  }
}

export default () => new GuardAndThief()
