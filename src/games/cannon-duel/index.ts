import { DragAim } from '../../core/controls.ts'
import { lerp, outBack, Spring } from '../../core/fx/ease.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { type MatchSpec, other, type Side } from '../../core/game.ts'
import { banner, hudY, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { type Shell, type ShotParams, trace } from '../../engines/aim/index.ts'
import { TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { render } from './render.ts'
import {
  advance,
  BALL,
  cannonOf,
  coreHp,
  CORE_HP,
  type Event,
  fire,
  IMPACT_MAX,
  newState,
  nextRound,
  type State,
  winner,
  WIND_MAX,
  windScale,
} from './rules.ts'

const EVERYWHERE = { x: -600, y: -600, w: 2200, h: 3000 }

/** Rounds (fights to the last core) to win the match. One round by default. */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

/** Seconds a decided round stays on screen before the next one is dealt. */
const ROUND_PAUSE = 1.8

class CannonDuel extends TurnGame<State> {
  private aims: [DragAim, DragAim] = [
    new DragAim(0, EVERYWHERE, 380),
    new DragAim(1, EVERYWHERE, 380),
  ]
  private recoil: [Spring, Spring] = [new Spring(0, 260, 12), new Spring(0, 260, 12)]
  /** The computer picks its shot when its turn starts, then swings the barrel to it while "thinking". */
  private botShot: ShotParams | null = null
  // Cosmetic only (not synced): previous shell for interpolation, its smoke trail, HUD pulses.
  private prevShell: Shell | null = null
  private trail: { x: number; y: number; z: number }[] = []
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]
  /** Quarter of the pull reached so far, for the rising tension clicks. */
  private notch = 0

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    // The player whose turn it is may drag anywhere on the table.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    return newState(this.ctx.rng.chance(0.5) ? 0 : 1, this.rollWind(0))
  }

  /** The wind picks up as the duel drags on (`shots` fired this round), so long fights get tense. */
  private rollWind(shots = this.s.shots[0] + this.s.shots[1]): number {
    const rng = this.ctx.rng
    const max = WIND_MAX * windScale(shots)
    return rng.chance(0.15) ? 0 : rng.range(-max, max)
  }

  protected override busy(): boolean {
    const s = this.s
    if (s.endedAt >= 0) {
      // Round decided: let it sink in, then deal the next one.
      if (this.time - s.endedAt > ROUND_PAUSE) this.startRound()
      return true
    }
    return s.phase !== 'aim'
  }

  protected override step(dt: number): void {
    const sh = this.s.shell
    this.prevShell = sh ? { ...sh } : null
    if (sh) {
      this.trail.push({ x: sh.x, y: sh.y, z: sh.z })
      if (this.trail.length > 12) this.trail.shift()
    }
    for (const e of advance(this.s, dt, () => this.rollWind())) this.juice(e)
    const w = winner(this.s)
    if (w !== null && this.s.endedAt < 0) {
      this.roundOver(w)
      return
    }
    super.step(dt)
  }

  private roundOver(w: Side): void {
    const s = this.s
    s.wins[w]++
    s.endedAt = this.time
    s.roundText = `${this.ctx.names[w]} takes the round`
    if (s.wins[w] < this.target) return
    const score: [number, number] = [s.wins[0], s.wins[1]]
    const note = `${this.ctx.names[other(w)]}'s keep is rubble`
    this.finish(
      w,
      this.target > 1 ? { score, note, delay: ROUND_PAUSE } : { note, delay: ROUND_PAUSE },
    )
  }

  /** The other side opens the next round; the computer picks its first shot straight away. */
  private startRound(): void {
    const starter = other(this.s.starter)
    nextRound(this.s, starter, this.rollWind(0))
    this.botShot = this.isBot(starter)
      ? choose(this.s, starter, this.ctx.difficulty, this.ctx.rng)
      : null
  }

  protected stepTurn(): void {
    const side = this.s.turn
    const a = this.aims[side]
    a.update(this.ctx.input.player(side))
    this.s.aiming = a.aim ? { dx: a.aim.dx, dy: a.aim.dy, power: a.aim.power } : null
    // Tension: a click that climbs in pitch at every quarter of the pull.
    const notch = a.aim ? Math.floor(a.aim.power * 4) : 0
    if (notch > this.notch) {
      this.ctx.audio.play('tick', 0.8 + notch * 0.2)
      this.ctx.audio.buzz(4 + notch * 2)
    }
    this.notch = notch
    if (a.shot) this.shoot(a.shot)
  }

  protected botPlay(): void {
    this.shoot(this.botShot ?? choose(this.s, this.s.turn, this.ctx.difficulty, this.ctx.rng))
    this.botShot = null
  }

  private shoot(shot: ShotParams): void {
    const side = this.s.turn
    fire(this.s, shot)
    this.s.firedAt = this.time
    this.notch = 0
    this.trail.length = 0
    for (const a of this.aims) a.cancel()
    // Everything about the blast scales with how far the cannon was pulled.
    const k = shot.power
    const { fx, audio } = this.ctx
    const c = cannonOf(side)
    const mx = c.x + shot.dx * 120
    const my = c.y + shot.dy * 120
    this.recoil[side].kick(8 + k * 14)
    audio.play('shoot', 1.15 - k * 0.4)
    audio.play('thud', 1.1 - k * 0.3)
    audio.buzz(Math.round(10 + k * 25))
    fx.puff(mx, my, 'rgba(255,255,255,0.8)', Math.round(5 + k * 10))
    fx.burst(mx, my, C.orange, {
      count: Math.round(6 + k * 12),
      speed: 500 + k * 500,
      size: 7,
      life: 0.3,
      gravity: 0,
      drag: 4,
      spread: 0.9,
      dir: Math.atan2(shot.dy, shot.dx),
      colors: [C.orange, C.yellow, C.white],
      kind: 'spark',
    })
    fx.shake(0.08 + k * 0.22)
    if (k > 0.85) fx.stop(2)
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    if (e.kind === 'turn') {
      audio.play('tick')
      this.botShot = this.isBot(e.side)
        ? choose(this.s, e.side, this.ctx.difficulty, this.ctx.rng)
        : null
      return
    }
    if (e.kind === 'miss') {
      audio.play('whoosh')
      const shooter = this.s.turn
      floatFor(fx, shooter, 'Missed!')
      return
    }
    const shooter = this.s.turn
    const k = Math.min(1, e.speed / IMPACT_MAX)
    for (const i of e.hit) this.s.hitAt[i] = this.time
    const coreHit = e.direct >= 0 && this.s.blocks[e.direct]?.kind === 'core'
    const big = coreHit || e.destroyed.length > 0
    const won = winner(this.s) !== null
    audio.play('explode', (big ? 0.8 : 1) + (1 - k) * 0.25)
    audio.buzz(Math.round(15 + k * 25 + (big ? 20 : 0)))
    fx.burst(e.x, e.y, C.orange, {
      count: Math.round(16 + k * 20),
      speed: 380 + k * 320,
      size: 18,
      life: 0.5,
      gravity: 0,
      drag: 3,
      colors: [C.orange, C.yellow, '#ff5a1f'],
    })
    fx.puff(e.x, e.y, 'rgba(60,50,60,0.55)', Math.round(8 + k * 8))
    fx.ring(e.x, e.y, '#ffd9a0', (coreHit ? 200 : 120) + k * 60)
    fx.shake((big ? 0.35 : 0.18) + k * 0.2)
    fx.stop(big ? 5 + Math.round(k * 3) : 2 + Math.round(k * 2))
    if (e.direct < 0)
      fx.burst(e.x, e.y, '#7a5a3a', {
        count: Math.round(8 + k * 8),
        speed: 260 + k * 220,
        size: 10,
        life: 0.6,
        gravity: 0,
        drag: 2.5,
        kind: 'square',
      })
    for (const i of e.hit) {
      const b = this.s.blocks[i]
      if (!b) continue
      const stone = b.kind === 'core' ? SIDE[b.side].main : '#8d86a8'
      // Debris flies away from the blast.
      const away = Math.atan2(b.y - e.y, b.x - e.x)
      fx.burst(b.x, b.y, stone, {
        count: e.destroyed.includes(i) ? 18 : 7,
        speed: 360 + k * 260,
        size: 16,
        life: 0.8,
        gravity: 0,
        drag: 2.2,
        spread: Math.hypot(b.x - e.x, b.y - e.y) < 10 ? Math.PI * 2 : 2.4,
        dir: away,
        kind: 'square',
        colors: [stone, '#6b6585', SIDE[b.side].dark],
      })
    }
    if (coreHit) {
      const victim = other(shooter)
      this.pulse[victim].kick(14)
      audio.play('score')
      if (won) {
        // The keep falls: the biggest moment of the round.
        const col = SIDE[shooter]
        fx.flash(col.main, 0.45)
        fx.shake(0.7)
        fx.stop(10)
        fx.ring(e.x, e.y, col.light, 380)
        fx.burst(e.x, e.y, col.main, {
          count: 50,
          speed: 1000,
          size: 16,
          life: 1.1,
          gravity: 0,
          drag: 2.2,
          colors: [col.main, col.light, C.yellow, C.white],
          kind: 'square',
        })
        fx.confetti(shooter)
        floatFor(fx, shooter, 'Keep destroyed!')
      } else {
        fx.flash(SIDE[shooter].main, 0.25)
        floatFor(fx, shooter, 'Direct hit!')
      }
    } else if (e.destroyed.length) {
      floatFor(fx, shooter, e.destroyed.length > 1 ? `Breach ×${e.destroyed.length}!` : 'Breach!')
    }
  }

  render(g: Draw, alpha: number): void {
    const s = this.s
    const dt = 1 / 60
    this.recoil[0].update(dt)
    this.recoil[1].update(dt)
    this.pulse[0].update(dt)
    this.pulse[1].update(dt)
    if (!s.shell && this.trail.length) this.trail.shift()
    let shell: Shell | null = s.shell
    const p = this.prevShell
    if (s.shell && p)
      shell = {
        ...s.shell,
        x: lerp(p.x, s.shell.x, alpha),
        y: lerp(p.y, s.shell.y, alpha),
        z: lerp(p.z, s.shell.z, alpha),
      }
    let aim: Parameters<typeof render>[2]['aim'] = null
    if (s.phase === 'aim' && !this.over) {
      const side = s.turn
      const a = s.aiming
      const c = cannonOf(side)
      if (a) {
        aim = { dx: a.dx, dy: a.dy, power: a.power, preview: trace(c.x, c.y, a, BALL, 0, 0.5) }
      } else if (this.isBot(side) && this.botShot) {
        // Swing the barrel toward the planned shot while thinking.
        const k = Math.min(1, this.thinking / 0.5)
        const from = s.aim[side]
        const dx = from.dx + (this.botShot.dx - from.dx) * k
        const dy = from.dy + (this.botShot.dy - from.dy) * k
        aim = { dx, dy, power: this.botShot.power * k, preview: [] }
      }
    }
    render(
      g,
      s,
      {
        aim,
        fired: this.time - s.firedAt,
        recoil: [Math.max(0, this.recoil[0].value / 14), Math.max(0, this.recoil[1].value / 14)],
        shell,
        trail: this.trail,
        hint: [0, 1].map(
          (side) =>
            s.phase === 'aim' &&
            s.turn === side &&
            !this.isBot(side as Side) &&
            s.shots[side as Side] === 0 &&
            !s.aiming,
        ) as [boolean, boolean],
      },
      this.time,
    )
    for (const side of [0, 1] as Side[]) {
      // Online, each phone shows only its own player's drag band.
      if (g.viewer === null || side === g.viewer) this.aims[side].render(g)
      // The keep's pips jolt when it takes a hit.
      const y = hudY(g, side, 160)
      const x = side === 0 ? W - 150 : 150
      const sc = 1 + Math.max(0, this.pulse[side].value / 14) * 0.35
      g.at(
        x,
        y,
        0,
        () => g.at(-x, -y, 0, () => pips(g, side, coreHp(s, side), CORE_HP, { inset: 160 })),
        sc,
      )
      if (this.target > 1) pips(g, side, s.wins[side], this.target, { inset: 240 })
    }
    this.drawTurns(g, undefined, s.phase === 'aim')
    if (s.roundText && !this.over) {
      const t = Math.min(1, (this.time - s.endedAt) / 0.35)
      banner(g, undefined, s.roundText, MID, { size: 58 * outBack(t), alpha: Math.min(1, t * 2) })
    }
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prevShell = null
    this.trail.length = 0
  }
}

export default () => new CannonDuel()
