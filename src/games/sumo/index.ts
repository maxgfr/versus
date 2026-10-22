import { floatFor } from '../../core/fx/fx.ts'
import { lerp } from '../../core/fx/ease.ts'
import { BaseGame, type MatchSpec, other, type Side } from '../../core/game.ts'
import { banner, namePill, pips } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw, Mood } from '../../core/render/draw.ts'
import { C, SIDE, alpha } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { type BotMem, newMem, steer } from './bot.ts'
import { backdrop, drawDashMeter, drawRing, drawStick, drawWrestler } from './render.ts'
import {
  type Event,
  RING,
  ringAt,
  SHRINK_AT,
  spawn,
  step,
  type Target,
  VMAX,
  type Wrestler,
} from './rules.ts'

interface State {
  w: Wrestler[]
  /** Rounds won, red first. */
  wins: [number, number]
  /** Round being fought, counting from 1 (a replayed round keeps its number). */
  round: number
  /** intro: the wrestlers stomp. fight: the bout. over: a round just ended (bodies still slide). */
  phase: 'intro' | 'fight' | 'over'
  /** Game time the fight started (the ring closes in from here). */
  roundAt: number
  /** End of the intro or of the pause after a round (game time). */
  until: number
  /** Winner of the last round (for the banner), or null for a replay. */
  last: Side | null
  /** Per wrestler: game time of its last hard contact and how hard (squash tween). */
  hitAt: number[]
  hitAmp: number[]
  /** Per wrestler: game time it left the ring (-1 while in). */
  outAt: number[]
  /** The closing ring has been announced this round. */
  warned: boolean
  /** Live ring radius when the round ended (drawn while the bodies slide). */
  edge: number
}

/** Rounds to win the match: first to N (3 is a best of five). */
export const match: MatchSpec = { unit: 'wins', default: 3, min: 1, max: 9 }

const INTRO = 1.6
const BETWEEN = 2
/** A second tap this soon after the first is a double tap: a dash. */
const DOUBLE_TAP = 0.32
/** Drag this far from where the finger went down for full speed. */
const REACH = 110
/** Below this, a held finger is a brake, not a direction. */
const DEAD = 12
/** A finger lifted while moving at least this fast (units/s) flicks a dash that way. */
const FLICK = 2400

class Sumo extends BaseGame<State> {
  private lanes: 1 | 2 = 1
  private mems: BotMem[] = []
  /** Last press time per side and lane, for double taps. */
  private lastTap: number[][] = [
    [-9, -9],
    [-9, -9],
  ]
  // Cosmetic only (not synced): last step's positions, for interpolation.
  private prev: { x: number; y: number }[] | null = null

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    this.lanes = this.ctx.teams ? 2 : 1
    const w = spawn(this.lanes)
    this.mems = w.map(() => newMem())
    return {
      w,
      wins: [0, 0],
      round: 1,
      phase: 'intro',
      roundAt: 0,
      until: INTRO,
      last: null,
      hitAt: w.map(() => -9),
      hitAmp: w.map(() => 0),
      outAt: w.map(() => -1),
      warned: false,
      edge: RING.r,
    }
  }

  /** The finger steering a wrestler, if a human holds one in its lane. */
  private finger(a: Wrestler): Ptr | undefined {
    return this.ctx.input.player(a.side).first(this.lanes === 2 ? a.lane : undefined)
  }

  /**
   * A human steers like a floating stick: wherever the finger goes down is the
   * centre, the drag from there is the direction. It works from anywhere in
   * the player's half, so a wrestler can be driven all the way to the far bales.
   */
  private stickTarget(a: Wrestler): Target {
    const p = this.finger(a)
    if (!p) return null
    const dx = p.x - p.x0
    const dy = p.y - p.y0
    const d = Math.hypot(dx, dy)
    if (d < DEAD) return null
    const k = (Math.min(REACH, d) / REACH) * (VMAX / 2.6)
    return { x: a.x + (dx / d) * k, y: a.y + (dy / d) * k }
  }

  protected step(dt: number): void {
    const s = this.s
    if (s.phase === 'intro') {
      if (this.time >= s.until) {
        s.phase = 'fight'
        s.roundAt = this.time
        this.ctx.audio.play('go')
        this.ctx.fx.shake(0.15)
        for (const a of s.w) this.ctx.fx.puff(a.x, a.y + a.r * 0.8, 'rgba(241,211,148,0.8)', 6)
      }
      return
    }
    if (s.phase === 'over') {
      // The bout is decided, but bodies keep their momentum: the loser tumbles off.
      step(
        s.w,
        dt,
        this.time,
        1e9,
        s.w.map(() => null),
        s.w.map(() => false),
      )
      if (this.time >= s.until && !this.over) this.newRound()
      return
    }
    const fight = this.time - s.roundAt
    const ring = ringAt(fight)
    if (!s.warned && fight >= SHRINK_AT) {
      s.warned = true
      this.ctx.audio.play('buzz')
      this.ctx.fx.flash(C.yellow, 0.12)
      this.ctx.fx.ring(RING.x, RING.y, C.yellow, RING.r)
    }
    const targets: Target[] = []
    const dashes: (boolean | number)[] = []
    const taps = this.doubleTaps()
    const flicks = this.flicks()
    s.w.forEach((a, k) => {
      if (this.isBot(a.side)) {
        const r = steer(
          s.w,
          k,
          a.side,
          this.time,
          ring,
          this.ctx.difficulty,
          this.ctx.rng,
          this.mems[k] as BotMem,
        )
        targets.push(r.target)
        dashes.push(r.dash)
      } else {
        const lane = this.lanes === 2 ? a.lane : 0
        const flick = flicks[a.side]?.[lane]
        if (flick) {
          // A flick: dash the way the finger was flying, as hard as it flew.
          targets.push({ x: a.x + flick.dx * 200, y: a.y + flick.dy * 200 })
          dashes.push(flick.power)
        } else {
          targets.push(this.stickTarget(a))
          dashes.push(taps[a.side][lane] === true)
        }
      }
    })
    this.prev = s.w.map((a) => ({ x: a.x, y: a.y }))
    const ev: Event[] = []
    const outs = step(s.w, dt, this.time, ring, targets, dashes, ev)
    for (const e of ev) this.juice(e)
    if (outs.length) this.roundOver(outs)
  }

  protected override afterEnd(dt: number): void {
    // Let the last shove play out under the final banner.
    const s = this.s
    step(
      s.w,
      dt,
      this.time,
      1e9,
      s.w.map(() => null),
      s.w.map(() => false),
    )
  }

  /** Fingers lifted mid-flick this step, per side and lane: direction and power 0..1. */
  private flicks(): ({ dx: number; dy: number; power: number } | null)[][] {
    const out: ({ dx: number; dy: number; power: number } | null)[][] = [
      [null, null],
      [null, null],
    ]
    for (const side of [0, 1] as Side[]) {
      for (const p of this.ctx.input.player(side).ups) {
        const dx = p.x - p.px
        const dy = p.y - p.py
        const v = Math.hypot(dx, dy) * 60
        if (v < FLICK) continue
        const power = Math.min(1, 0.35 + (v - FLICK) / 3600)
        const row = out[side] as ({ dx: number; dy: number; power: number } | null)[]
        row[this.lanes === 2 ? p.lane : 0] = { dx: (dx * 60) / v, dy: (dy * 60) / v, power }
      }
    }
    return out
  }

  /** Which wrestlers were double-tapped this step (a dash request). */
  private doubleTaps(): [boolean[], boolean[]] {
    const out: [boolean[], boolean[]] = [
      [false, false],
      [false, false],
    ]
    for (const side of [0, 1] as Side[]) {
      for (const p of this.ctx.input.player(side).downs) {
        const lane = this.lanes === 2 ? p.lane : 0
        const row = this.lastTap[side] as number[]
        const dbl = this.time - (row[lane] ?? -9) < DOUBLE_TAP
        const flags = out[side]
        if (dbl && flags) flags[lane] = true
        row[lane] = this.time
      }
    }
    return out
  }

  /** One or more wrestlers left the ring: a side loses the round (both at once: it is replayed). */
  private roundOver(outs: Side[]): void {
    const s = this.s
    const sides = [...new Set(outs)]
    const { fx, audio } = this.ctx
    s.edge = ringAt(this.time - s.roundAt)
    if (sides.length > 1) {
      s.phase = 'over'
      s.last = null
      s.until = this.time + 1.4
      audio.play('error')
      return
    }
    const loser = sides[0] as Side
    const winner = other(loser)
    s.wins[winner]++
    s.last = winner
    s.phase = 'over'
    s.until = this.time + BETWEEN
    fx.confetti(winner)
    if (s.wins[winner] >= this.target) {
      fx.flash(SIDE[winner].main, 0.3)
      fx.stop(8)
      this.finish(winner, { score: [s.wins[0], s.wins[1]], delay: 2.2 })
      return
    }
    audio.play('score', 0.9)
  }

  /** A fresh round: wrestlers back on their marks, the stomp again. */
  private newRound(): void {
    const s = this.s
    if (s.last !== null) s.round++
    s.w = spawn(this.lanes)
    this.mems = s.w.map(() => newMem())
    s.phase = 'intro'
    s.until = this.time + INTRO
    s.last = null
    s.hitAt = s.w.map(() => -9)
    s.hitAmp = s.w.map(() => 0)
    s.outAt = s.w.map(() => -1)
    s.warned = false
    s.edge = RING.r
    this.ctx.audio.play('count')
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const s = this.s
    if (e.kind === 'hit') {
      const k = Math.min(1, e.speed / 1100)
      audio.play('thud', 0.7 + k * 0.8)
      if (e.speed > 250) audio.play('slap', 0.8 + k * 0.4)
      fx.shake(Math.min(0.4, e.speed / 2600))
      fx.puff(e.x, e.y, 'rgba(255,240,210,0.75)', 4 + Math.round(k * 6))
      if (e.speed > 300) fx.sparks(e.x, e.y, C.yellow, Math.min(14, Math.round(e.speed / 90)))
      if (e.speed > 700) fx.ring(e.x, e.y, alpha(C.white, 0.8), 90 + k * 80)
      if (e.speed > 900) {
        fx.stop(4)
        audio.buzz(16)
      }
      for (const i of this.nearest(e.x, e.y)) {
        s.hitAt[i] = this.time
        s.hitAmp[i] = Math.min(0.32, 0.08 + e.speed / 2500)
      }
    } else if (e.kind === 'dash') {
      // The flick's force: pitch, dust, shake and buzz all follow it.
      const k = e.power
      audio.play('whoosh', 0.85 + k * 0.4)
      audio.buzz(Math.round(8 + k * 14))
      if (k > 0.8) fx.shake(0.12)
      fx.burst(e.x, e.y, C.sand, {
        count: Math.round(10 + k * 14),
        speed: 280 + k * 260,
        size: 18,
        life: 0.5,
        gravity: 0,
        drag: 3,
        colors: [C.sand, '#fff1d0', SIDE[e.side].light],
        kind: 'square',
      })
    } else if (e.kind === 'out') {
      audio.play('explode', 0.8)
      audio.play('boing', 0.8)
      audio.buzz(24)
      fx.shake(0.55)
      fx.flash(SIDE[other(e.side)].main, 0.22)
      fx.stop(6)
      fx.burst(e.x, e.y, SIDE[e.side].main, {
        count: 34,
        speed: 720,
        size: 16,
        life: 0.9,
        gravity: 500,
        drag: 1.6,
        colors: [SIDE[e.side].main, SIDE[e.side].light, C.sand, '#e2c879'],
        kind: 'square',
      })
      fx.ring(e.x, e.y, C.white, 200)
      floatFor(fx, e.side, 'Out!', e.x, e.y - 130)
      s.w.forEach((a, i) => {
        if (a.side === e.side && Math.hypot(a.x - e.x, a.y - e.y) < a.r) s.outAt[i] = this.time
      })
    }
  }

  /** Indices of the wrestlers closest to a point (up to two). */
  private nearest(x: number, y: number): number[] {
    const d = this.s.w.map((a, k) => ({ k, d: Math.hypot(a.x - x, a.y - y) }))
    d.sort((p, q) => p.d - q.d)
    return d.slice(0, 2).map((p) => p.k)
  }

  private moodOf(a: Wrestler, i: number): Mood {
    const s = this.s
    if ((s.outAt[i] ?? -1) >= 0) return 'dizzy'
    if (s.phase === 'over' && s.last !== null) return a.side === s.last ? 'grin' : 'sad'
    if (this.time - (s.hitAt[i] ?? -9) < 0.3 && (s.hitAmp[i] ?? 0) > 0.18) return 'wow'
    return 'angry'
  }

  render(g: Draw, alpha: number): void {
    const s = this.s
    const t = this.time
    const prev = this.prev
    const at = (a: Wrestler, i: number): Wrestler => {
      const p = prev?.[i]
      return p && s.phase === 'fight'
        ? { ...a, x: lerp(p.x, a.x, alpha), y: lerp(p.y, a.y, alpha) }
        : a
    }
    // Online, each phone shows only its own player's stick and dash meter.
    const mine = (side: Side) => g.viewer === null || g.viewer === side
    const ring = s.phase === 'fight' ? ringAt(t - s.roundAt) : s.phase === 'intro' ? RING.r : s.edge
    backdrop(g)
    drawRing(g, ring, g.t)
    // Bodies sorted by depth so the lower one overlaps the higher one.
    const order = s.w.map((_, i) => i).sort((p, q) => (s.w[p]?.y ?? 0) - (s.w[q]?.y ?? 0))
    for (const i of order) {
      const a = at(s.w[i] as Wrestler, i)
      if (s.phase === 'fight' && !this.isBot(a.side) && mine(a.side)) drawDashMeter(g, a, t)
      const since = t - (s.hitAt[i] ?? -9)
      const squash =
        since < 0.6 ? -(s.hitAmp[i] ?? 0) * Math.cos(since * 24) * Math.exp(-since * 7) : 0
      const off = Math.hypot(a.x - RING.x, a.y - RING.y) - RING.r - 40
      const fall = (s.outAt[i] ?? -1) >= 0 ? Math.min(1, Math.max(0, off / 260)) : 0
      // The pre-bout stomp: each wrestler lifts and slams twice, the sides out of step.
      const intro = s.phase === 'intro' ? INTRO - (s.until - t) : -1
      const stomp =
        intro >= 0 && intro < INTRO - 0.2
          ? Math.max(0, Math.sin((intro + a.side * 0.35) * Math.PI * 2.6))
          : 0
      drawWrestler(g, a, { squash, mood: this.moodOf(a, i), time: t, fall, stomp })
    }
    // Floating sticks under human fingers.
    if (s.phase !== 'over')
      for (const a of s.w) {
        if (this.isBot(a.side) || !mine(a.side)) continue
        const p = this.finger(a)
        if (p) drawStick(g, a.side, p.x0, p.y0, p.x, p.y, REACH)
      }
    for (const side of [0, 1] as Side[]) {
      namePill(g, side, this.ctx.names[side], {
        active: s.phase === 'fight' && !this.isBot(side),
      })
      pips(g, side, s.wins[side], this.target)
    }
    this.banners(g)
  }

  private banners(g: Draw): void {
    const s = this.s
    const t = this.time
    // Banners sit in the gap between the two starting wrestlers, at the centre line.
    const at = { size: 46, gap: 54 }
    if (s.phase === 'intro') {
      banner(g, undefined, `Round ${s.round}`, MID, at)
      if (s.round === 1 && s.wins[0] + s.wins[1] === 0) this.hints(g)
    } else if (s.phase === 'fight') {
      const f = t - s.roundAt
      if (f < 0.8) {
        const k = Math.min(1, f / 0.12)
        banner(g, undefined, 'Fight!', MID, {
          size: 46 + (1 - k) * 30,
          gap: 54,
          color: C.yellow,
          alpha: f > 0.6 ? (0.8 - f) / 0.2 : 1,
        })
      } else if (f >= SHRINK_AT && f < SHRINK_AT + 1.6) {
        banner(g, undefined, 'Ring closing!', MID, { ...at, color: C.yellow })
      }
    } else if (s.last !== null) {
      const won = s.wins[s.last] >= this.target
      const label = won ? `${this.ctx.names[s.last]} wins!` : `${this.ctx.names[s.last]} takes it`
      banner(g, undefined, label, MID, { ...at, color: SIDE[s.last].light })
    } else banner(g, undefined, 'Both out · replay', MID, at)
  }

  /** First-round coaching for each human: how the stick and the dash work. */
  private hints(g: Draw): void {
    for (const side of [0, 1] as Side[]) {
      if (this.isBot(side) || (g.viewer !== null && side !== g.viewer)) continue
      const y = side === 0 ? 1530 : 270
      g.forSide(side, W / 2, y, () => {
        g.text('Drag anywhere to push', 0, -26, {
          size: 40,
          weight: 700,
          color: C.white,
          drop: alpha('#000000', 0.45),
        })
        g.text('Flick or double tap to dash', 0, 30, {
          size: 34,
          weight: 600,
          color: alpha(C.white, 0.75),
        })
      })
    }
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
  }
}

export default () => new Sumo()
