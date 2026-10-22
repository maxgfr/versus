import { Joystick } from '../../core/controls.ts'
import { lerp } from '../../core/fx/ease.ts'
import { BaseGame, type MatchSpec, other, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { type Rounds, roundEnd, roundsNew, roundsStep } from '../../engines/reflex/index.ts'
import { W, type Stage } from '../../core/stage.ts'
import { DungBot } from './bot.ts'
import { type Look, type Pose, type StickLook, renderDung } from './render.ts'
import {
  angleTo,
  type Drive,
  type Ev,
  FIELD,
  flattens,
  NMAX,
  newWorld,
  ROUND_T,
  roundWinner,
  SQUEEZE_T,
  stepWorld,
  type World,
} from './rules.ts'

export interface State {
  w: World
  rounds: Rounds
  /** Stick looks, so the online guest can draw them. */
  sticks: StickLook[]
}

/** Rounds to win (best of three by default). */
export const match: MatchSpec = { unit: 'wins', default: 2, min: 1, max: 5 }

/** Pause between rounds, seconds. */
const BETWEEN = 2.2
/** Finger speed (world units / s) that makes a flick of the stick a charge, and a full-power one. */
const FLICK = 2000
const FLICK_MAX = 5600
/** A flick made a moment before the charge is ready still counts. */
const FLICK_HOLD = 0.15

/**
 * A stick under each player's thumb: the whole strip at their end of the
 * table, laid out as red sees it and mirrored for blue (same as the arena's
 * sticks).
 */
function stickFor(stage: Stage, side: Side): Joystick {
  const v = stage.view
  const home = side === 0 ? { x: 250, y: 1585 } : { x: W - 250, y: 215 }
  const z = { x: v.x, y: 1500, w: v.w, h: v.y + v.h - 1500 + 40 }
  const zone = side === 0 ? z : { x: W - (z.x + z.w), y: 1800 - (z.y + z.h), w: z.w, h: z.h }
  return new Joystick(side, zone, 104, home.x, home.y)
}

function lookOf(j: Joystick): StickLook {
  return {
    side: j.side,
    bx: j.baseX,
    by: j.baseY,
    kx: j.knobX,
    ky: j.knobY,
    r: j.radius,
    on: j.active,
  }
}

const pose = (): Pose => ({ bx: 0, by: 0, ba: 0, cx: 0, cy: 0 })

class DungBattle extends BaseGame<State> {
  private sticks: Joystick[] = []
  private bots: (DungBot | null)[] = []
  private ev: Ev[] = []
  /** Which side could flatten the other last step (host only, for the "now you can" cue). */
  private threat: [boolean, boolean] = [false, false]
  private tick = -1
  /** Host input: the knob's last positions while held (x, y pairs), to read a flick's speed. */
  private hist: [number[], number[]] = [[], []]
  /** A flick waiting for the charge to be ready: its power and until when it counts. */
  private want: [{ p: number; until: number } | null, { p: number; until: number } | null] = [
    null,
    null,
  ]
  // Cosmetic only (not synced): last step's poses for interpolation, and ball trails.
  private prev: [Pose, Pose] = [pose(), pose()]
  private hasPrev = false
  private look: Look = { poses: [pose(), pose()], trails: [[], []] }

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.sticks = [stickFor(ctx.stage, 0), stickFor(ctx.stage, 1)]
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new DungBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    return {
      w: newWorld(ctx.rng),
      rounds: roundsNew(this.target),
      sticks: this.sticks.map(lookOf),
    }
  }

  private keepPrev(): void {
    for (const side of [0, 1] as Side[]) {
      const bug = this.s.w.bugs[side]
      const p = this.prev[side]
      p.bx = bug.beetle.x
      p.by = bug.beetle.y
      p.ba = bug.beetle.a
      p.cx = bug.ball.x
      p.cy = bug.ball.y
    }
    this.hasPrev = true
  }

  /** A flick: the knob's speed over the last two steps, once it beats FLICK. */
  private flick(side: Side, dt: number): void {
    const j = this.sticks[side] as Joystick
    const h = this.hist[side]
    if (!j.active) {
      h.length = 0
      return
    }
    h.push(j.knobX, j.knobY)
    if (h.length > 6) h.splice(0, 2)
    if (h.length < 6 || j.mag < 0.6) return
    const sp = Math.hypot((h[4] as number) - (h[0] as number), (h[5] as number) - (h[1] as number))
    const speed = sp / (2 * dt)
    if (speed < FLICK) return
    const p = Math.min(1, (speed - FLICK) / (FLICK_MAX - FLICK))
    const cur = this.want[side]
    if (!cur || cur.p < p) this.want[side] = { p, until: this.time + FLICK_HOLD }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    this.keepPrev()
    if (roundsStep(s.rounds, this.time, BETWEEN)) {
      s.w = newWorld(ctx.rng)
      this.threat = [false, false]
      this.want = [null, null]
      this.hasPrev = false
      for (const t of this.look.trails) t.length = 0
      ctx.audio.play('go')
      return
    }
    const playing = s.rounds.phase === 'play'
    const drives: Drive[] = ([0, 1] as Side[]).map((side) => {
      const stick = this.sticks[side] as Joystick
      const bot = this.bots[side]
      if (bot) {
        const d = bot.decide(s.w, side, dt)
        stick.set(d.jx, d.jy)
        return d
      }
      stick.update(ctx.input.player(side))
      this.flick(side, dt)
      const d: Drive = { jx: stick.x, jy: stick.y }
      const want = this.want[side]
      if (want && this.time > want.until) this.want[side] = null
      else if (want) d.dash = want.p
      return d
    })
    s.sticks = this.sticks.map(lookOf)
    if (!playing) {
      // Between rounds the flattened beetle keeps animating; nothing moves.
      s.w.t += dt
      this.want = [null, null]
      return
    }
    this.ev.length = 0
    stepWorld(s.w, drives, dt, this.ev)
    for (const e of this.ev) this.juice(e)
    this.cues()
    const w = roundWinner(s.w)
    if (w === null) return
    ctx.audio.play('score')
    if (s.w.flattened === null) this.timeUp(w)
    if (roundEnd(s.rounds, w, this.time, ctx.names) && w !== 'draw') {
      ctx.fx.confetti(w)
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2.6 })
    }
  }

  /** A ball that just got big enough to flatten the rival, and the last seconds ticking. */
  private cues(): void {
    const { fx, audio } = this.ctx
    const w = this.s.w
    const [A, B] = w.bugs
    const now: [boolean, boolean] = [
      flattens(A.ball.r, B.ball.r, w.t),
      flattens(B.ball.r, A.ball.r, w.t),
    ]
    for (const side of [0, 1] as Side[]) {
      if (now[side] && !this.threat[side]) {
        const b = w.bugs[side].ball
        audio.play('powerup', 1.1)
        audio.buzz(14)
        fx.ring(b.x, b.y, C.yellow, b.r + 90)
        fx.sparks(b.x, b.y, C.yellow, 14)
        fx.float('Big enough!', b.x, b.y - b.r - 40, C.yellow, 44, side)
      }
    }
    this.threat = now
    const left = Math.ceil(ROUND_T - w.t)
    if (left <= 5 && left > 0 && left !== this.tick) audio.play('tick', 1.1 + (5 - left) * 0.08)
    // The squeeze starts: from now on a smaller lead is enough to flatten.
    if (left === SQUEEZE_T && this.tick === SQUEEZE_T + 1) {
      audio.play('powerup', 0.7)
      audio.buzz(20)
      fx.ring(FIELD.cx, FIELD.cy, C.yellow, FIELD.b)
      fx.shake(0.15)
      for (const side of [0, 1] as Side[])
        fx.float(
          'Squeeze!',
          W / 2,
          side === 0 ? FIELD.cy + 220 : FIELD.cy - 220,
          C.yellow,
          64,
          side,
        )
    }
    this.tick = left
  }

  /** Time is up: the bigger ball takes the round with a thump. */
  private timeUp(w: Side | 'draw'): void {
    const { fx, audio } = this.ctx
    audio.play('buzz', 0.8)
    if (w === 'draw') return
    const b = this.s.w.bugs[w].ball
    audio.buzz(40)
    fx.ring(b.x, b.y, SIDE[w].light, b.r + 140)
    fx.ring(b.x, b.y, C.yellow, b.r + 60)
    fx.burst(b.x, b.y, SIDE[w].light, {
      count: 30,
      speed: 620,
      size: 13,
      life: 0.8,
      gravity: 200,
      colors: [SIDE[w].main, SIDE[w].light, C.yellow, C.white],
      kind: 'square',
    })
    fx.flash(SIDE[w].main, 0.25)
    fx.shake(0.35)
    fx.stop(5)
  }

  protected override afterEnd(dt: number): void {
    this.keepPrev()
    this.s.w.t += dt
  }

  /** Every rules event becomes feedback; strength k comes from the impact (or flick) speed. */
  private juice(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    const w = this.s.w
    switch (e.k) {
      case 'eat': {
        const k = e.n / NMAX
        audio.play('chomp', 0.9 + e.n * 0.025)
        fx.ring(e.x, e.y, SIDE[e.side].light, 60 + k * 40)
        fx.burst(e.x, e.y, '#7a4a22', {
          count: 7,
          speed: 240,
          size: 9,
          life: 0.45,
          gravity: 420,
          colors: ['#7a4a22', '#5a3316', '#a06a36'],
        })
        break
      }
      case 'dash': {
        const p = e.power
        const b = w.bugs[e.side].beetle
        const back = b.a + Math.PI
        audio.play('whoosh', 0.85 + p * 0.5)
        audio.buzz(8 + Math.round(p * 14))
        fx.burst(e.x - Math.cos(b.a) * 30, e.y - Math.sin(b.a) * 30, 'rgba(220,190,140,0.7)', {
          count: Math.round(4 + p * 8),
          speed: 220 + p * 320,
          size: 20,
          life: 0.45,
          gravity: -40,
          drag: 3.2,
          spread: 1.1,
          dir: back,
        })
        if (p > 0.55) fx.shake(0.05 + p * 0.08)
        break
      }
      case 'bump': {
        const k = Math.min(1, e.speed / 450)
        audio.play('bounce', 0.85 + k * 0.4 + rng.next() * 0.06)
        fx.puff(e.x, e.y, 'rgba(200,170,120,0.55)', Math.round(2 + k * 5))
        if (k > 0.6) {
          fx.sparks(e.x, e.y, C.white, Math.round(4 + k * 6))
          audio.buzz(8)
        }
        break
      }
      case 'clash': {
        const k = Math.min(1, e.speed / 700)
        audio.play('thud', 0.8 + k * 0.5)
        audio.buzz(Math.round(10 + k * 25))
        fx.burst(e.x, e.y, '#8c5a2b', {
          count: Math.round(8 + k * 22),
          speed: 260 + k * 420,
          size: 13,
          life: 0.55,
          gravity: 600,
          colors: ['#8c5a2b', '#c98a4b', C.white],
        })
        if (k > 0.45) fx.ring(e.x, e.y, k > 0.8 ? C.yellow : C.white, 80 + k * 120)
        fx.shake(0.08 + k * 0.3)
        if (k > 0.55) fx.stop(Math.round(2 + k * 4))
        break
      }
      case 'wall': {
        const k = Math.min(1, e.speed / 500)
        audio.play('wall', 0.95 + k * 0.4)
        fx.puff(e.x, e.y, 'rgba(210,180,130,0.5)', Math.round(2 + k * 4))
        if (k > 0.6) fx.shake(0.06 * k)
        break
      }
      case 'flatten': {
        const winner = other(e.side)
        const big = w.bugs[winner].ball
        const dir = Math.atan2(e.y - big.y, e.x - big.x)
        audio.play('explode', 0.8)
        audio.play('thud', 0.6)
        audio.buzz(90)
        fx.burst(e.x, e.y, '#7a4a22', {
          count: 40,
          speed: 620,
          size: 16,
          life: 0.8,
          gravity: 500,
          colors: ['#7a4a22', '#5a3316', C.yellow, C.white],
        })
        // A spray thrown on through the squashed beetle, in the direction of the hit.
        fx.burst(e.x, e.y, SIDE[winner].light, {
          count: 26,
          speed: 1000,
          size: 14,
          life: 0.9,
          gravity: 0,
          drag: 2.4,
          spread: 1.4,
          dir,
          colors: [SIDE[winner].main, SIDE[winner].light, C.yellow],
          kind: 'square',
        })
        fx.ring(e.x, e.y, C.yellow, 260)
        fx.ring(e.x, e.y, SIDE[winner].light, 180)
        fx.puff(e.x, e.y, 'rgba(160,110,60,0.6)', 10)
        fx.flash(SIDE[winner].light, 0.35)
        fx.shake(0.8)
        fx.stop(12)
        break
      }
    }
  }

  render(g: Draw, alpha: number): void {
    const w = this.s.w
    const look = this.look
    for (const side of [0, 1] as Side[]) {
      const bug = w.bugs[side]
      const o = look.poses[side]
      const p = this.prev[side]
      const k = this.hasPrev ? alpha : 1
      o.bx = lerp(p.bx, bug.beetle.x, k)
      o.by = lerp(p.by, bug.beetle.y, k)
      o.ba = p.ba + angleTo(p.ba, bug.beetle.a) * k
      o.cx = lerp(p.cx, bug.ball.x, k)
      o.cy = lerp(p.cy, bug.ball.y, k)
      if (!this.hasPrev) {
        o.bx = bug.beetle.x
        o.by = bug.beetle.y
        o.ba = bug.beetle.a
        o.cx = bug.ball.x
        o.cy = bug.ball.y
      }
      // A dust trail behind a ball that is really rolling.
      const t = look.trails[side]
      const sp = Math.hypot(bug.ball.vx, bug.ball.vy)
      if (sp > 300 && w.flattened === null) t.push({ x: o.cx, y: o.cy })
      else t.shift()
      while (t.length > 7) t.shift()
    }
    renderDung(g, this.s, this.time, this.ctx.names, this.over, look)
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.hasPrev = false
    for (const t of this.look.trails) t.length = 0
  }
}

export default () => new DungBattle()
