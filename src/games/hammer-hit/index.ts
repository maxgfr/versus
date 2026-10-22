import { BaseGame, type MatchSpec, type Side, STEP } from '../../core/game.ts'
import { Spring } from '../../core/fx/ease.ts'
import { frame } from '../../core/frame.ts'
import type { Draw } from '../../core/render/draw.ts'
import { SIDE } from '../../core/render/palette.ts'
import {
  roundEnd,
  roundsNew,
  roundsStep,
  tapPoints,
  tapRipple,
  taps,
  type Rounds,
} from '../../engines/reflex/index.ts'
import { HammerBot } from './bot.ts'
import { COL, GAUGE, PAD, STRONG, puckY, renderHammer, type Look } from './render.ts'
import {
  LEAD,
  matchPoint,
  ringsBell,
  roundSpeed,
  roundWinner,
  SETTLE,
  swingNew,
  swingStopped,
  swingUpdate,
  TARGET,
  type Swing,
  type SwingEvent,
} from './rules.ts'

/** Seconds between rounds (the banner shows meanwhile). */
const PAUSE = 1.8

export interface State {
  rounds: Rounds
  /** Game time the current round started. */
  roundAt: number
  swings: [Swing, Swing]
  /** Game time both pucks had been struck (-1 until then). */
  settleAt: number
  /** The match winner once decided (drives the ending). */
  winner: Side | 'draw' | null
}

type Event =
  SwingEvent | { kind: 'round'; winner: Side | 'draw' } | { kind: 'match'; winner: Side | 'draw' }

/** World position of a side's gauge, for effects. */
const gaugeWorld = (side: Side) => frame(side, GAUGE.x, GAUGE.y)
/** World position of a side's puck at height `h`. */
const puckWorld = (side: Side, h: number) => frame(side, COL.x, puckY(h))
/** World position of a side's bell. */
const bellWorld = (side: Side) => frame(side, COL.x, COL.bellY + 40)

/** Match length: first to N round wins (best of 5 by default). */
export const match: MatchSpec = { unit: 'wins', default: TARGET, min: 1, max: 9 }

const pair = (rest: number, k: number, damp: number): [Spring, Spring] => [
  new Spring(rest, k, damp),
  new Spring(rest, k, damp),
]

class HammerHit extends BaseGame<State> {
  private bots: [HammerBot | null, HammerBot | null] = [null, null]
  // Cosmetic only (not synced). Springs are kicked from state edges seen in
  // render, so the online guest gets the same squash and wobble as the host.
  private pad = pair(0, 900, 22)
  private body = pair(0, 520, 13)
  private bell = pair(0, 260, 3.2)
  private sway = pair(0, 700, 16)
  private pulse = pair(0, 240, 9)
  private seen: { stopT: number; landed: boolean }[] = [
    { stopT: -1, landed: false },
    { stopT: -1, landed: false },
  ]
  private seenWins: [number, number] = [0, 0]
  private lastT = -1

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.bots = [0, 1].map((side) =>
      ctx.bots[side as Side] ? new HammerBot(ctx.rng.fork(), ctx.difficulty) : null,
    ) as [HammerBot | null, HammerBot | null]
    const speed = roundSpeed(1, ctx.rng)
    return {
      rounds: roundsNew(this.target),
      roundAt: 0,
      swings: [swingNew(speed), swingNew(speed)],
      settleAt: -1,
      winner: null,
    }
  }

  /** A fresh round: both gauges reset to the same speed, so the start is fair. */
  private startRound(): void {
    const s = this.s
    const r = s.rounds
    const hot = matchPoint(r.wins, r.target)
    const speed = roundSpeed(r.round, this.ctx.rng, hot)
    if (hot) this.ctx.audio.play('powerup')
    s.roundAt = this.time
    s.swings = [swingNew(speed), swingNew(speed)]
    s.settleAt = -1
    for (const bot of this.bots) bot?.newRound()
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    if (roundsStep(s.rounds, this.time, PAUSE)) this.startRound()
    if (s.rounds.phase !== 'play') return

    const rt = this.time - s.roundAt
    for (const side of [0, 1] as Side[]) {
      const sw = s.swings[side]
      for (const p of tapPoints(ctx, side)) tapRipple(ctx, side, p.x, p.y)
      const bot = this.bots[side]
      const pressed = bot ? rt >= LEAD && bot.wantsStop(sw) : taps(ctx, side) > 0
      for (const e of swingUpdate(sw, side, dt, rt, pressed)) this.juice(e)
    }

    if (s.settleAt < 0 && s.swings.every((sw) => swingStopped(sw))) s.settleAt = this.time
    if (s.settleAt < 0 || this.time - s.settleAt < SETTLE) return

    const w = roundWinner(s.swings[0].height, s.swings[1].height)
    this.juice({ kind: 'round', winner: w })
    if (roundEnd(s.rounds, w, this.time, ctx.names)) {
      s.winner = w
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2.2 })
      this.juice({ kind: 'match', winner: w })
    }
  }

  /** Every rule event becomes feedback here, scaled by how hard the strike was. */
  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    if (e.kind === 'stop') {
      // Force: the height the strike earned; a faster gauge adds a little bite.
      const k = e.height
      const bite = Math.min(1, e.speed / 1.5)
      const p = gaugeWorld(e.side)
      const pad = frame(e.side, PAD.x, PAD.y - 20)
      audio.play('click', e.side === 0 ? 0.95 : 1.05)
      audio.play('hit', 0.65 + k * 0.6 + bite * 0.1)
      if (k > 0.3) audio.play('shoot', 0.75 + k * 0.55)
      audio.buzz(Math.round(8 + k * k * 32))
      fx.ring(p.x, p.y, '#ffffff', 70 + k * 50)
      fx.ring(pad.x, pad.y, SIDE[e.side].light, 90 + k * 160)
      fx.puff(pad.x, pad.y, 'rgba(240,220,170,0.8)', 4 + Math.round(k * 8))
      if (k > 0.25)
        fx.burst(pad.x, pad.y, '#ffe27a', {
          count: Math.round(4 + k * k * 20),
          speed: 300 + k * 600,
          size: 8,
          life: 0.35 + k * 0.15,
          gravity: 900,
          spread: Math.PI * 0.9,
          dir: e.side === 0 ? -Math.PI / 2 : Math.PI / 2,
          kind: 'spark',
        })
      fx.shake(0.04 + k * k * (0.26 + bite * 0.06))
      if (k > 0.9) fx.stop(4)
      else if (k > 0.7) fx.stop(2)
    } else if (e.kind === 'miss') {
      const p = frame(e.side, STRONG.x, STRONG.y - 130)
      audio.play('buzz')
      audio.buzz(20)
      fx.float('Too slow', p.x, p.y, 'rgba(255,255,255,0.9)', 52, e.side)
    } else if (e.kind === 'tick') {
      audio.play('tick', 1 + (3 - e.left) * 0.18)
    } else if (e.kind === 'land') {
      const h = e.height
      const top = puckWorld(e.side, h)
      if (!ringsBell(h)) {
        audio.play('thud', 0.7 + h * 0.5)
        if (!e.missed)
          fx.burst(top.x, top.y, SIDE[e.side].light, {
            count: Math.round(5 + h * 8),
            speed: 160 + h * 220,
            size: 8,
            life: 0.35,
            gravity: 400,
          })
        const tag = frame(e.side, COL.x + 160, puckY(h) - 90)
        if (e.missed) return
        if (h < 0.5) fx.float(h < 0.05 ? 'Whiff' : 'Weak!', tag.x, tag.y, '#ffffff', 48, e.side)
        else if (h >= 0.88) fx.float('So close!', tag.x, tag.y, '#ffe27a', 48, e.side)
        return
      }
      const b = bellWorld(e.side)
      audio.play('coin', 1.15)
      audio.play('hit', 1.25)
      audio.buzz(45)
      fx.burst(b.x, b.y, '#ffe27a', {
        count: 30,
        speed: 680,
        size: 12,
        life: 0.75,
        gravity: 500,
        colors: ['#ffe27a', '#ffffff', SIDE[e.side].light],
      })
      fx.ring(b.x, b.y, '#ffe27a', 260)
      const d = frame(e.side, COL.x - 230, COL.bellY + 120)
      fx.float('DING!', d.x, d.y, '#ffe27a', 92, e.side)
      fx.shake(0.45)
      fx.flash('#ffe27a', 0.22)
      fx.stop(5)
    } else if (e.kind === 'round') {
      const w = e.winner
      if (w === 'draw') {
        audio.play('draw')
        for (const side of [0, 1] as Side[]) {
          const p = frame(side, COL.x + 170, 1180)
          fx.float('Tie!', p.x, p.y, '#ffffff', 60, side)
        }
        return
      }
      const h = this.s.swings[w].height
      const p = puckWorld(w, h)
      const lose = w === 0 ? 1 : 0
      const lp = puckWorld(lose, this.s.swings[lose].height)
      audio.play('score')
      audio.buzz(25)
      fx.burst(p.x, p.y, SIDE[w].main, {
        count: 30,
        speed: 760,
        size: 13,
        life: 0.85,
        gravity: 300,
        colors: [SIDE[w].main, SIDE[w].light, '#ffffff', '#ffe27a'],
        kind: 'square',
      })
      fx.ring(p.x, p.y, SIDE[w].light, 240)
      fx.puff(lp.x, lp.y, 'rgba(200,200,220,0.5)', 5)
      fx.flash(SIDE[w].main, 0.16)
      fx.shake(0.2)
      fx.stop(3)
    } else if (e.kind === 'match') {
      if (e.winner === 'draw') return
      const b = bellWorld(e.winner)
      fx.confetti(e.winner)
      fx.ring(b.x, b.y, SIDE[e.winner].light, 440)
      fx.flash(SIDE[e.winner].main, 0.32)
      fx.shake(0.5)
      fx.stop(6)
      audio.buzz(60)
    }
  }

  /** Kick springs on what changed since the last frame (works for host and guest alike). */
  private watch(): void {
    const s = this.s
    for (const side of [0, 1] as Side[]) {
      const sw = s.swings[side]
      const seen = this.seen[side] as { stopT: number; landed: boolean }
      if (sw.stopT !== seen.stopT) {
        if (sw.stopT >= 0 && !sw.missed) {
          const k = sw.height
          this.pad[side].kick(10 + k * 26)
          this.body[side].kick(8 + k * 18)
          this.sway[side].kick((side === 0 ? 1 : -1) * (4 + k * 14))
        }
        seen.stopT = sw.stopT
      }
      if (sw.landed !== seen.landed) {
        if (sw.landed && ringsBell(sw.height)) {
          this.bell[side].kick(9)
          this.sway[side].kick(side === 0 ? -10 : 10)
        } else if (sw.landed && !sw.missed) this.bell[side].kick(0.6 + sw.height * 1.2)
        seen.landed = sw.landed
      }
      if (s.rounds.wins[side] !== this.seenWins[side]) {
        if (s.rounds.wins[side] > this.seenWins[side]) this.pulse[side].kick(16)
        this.seenWins[side] = s.rounds.wins[side]
      }
    }
  }

  render(g: Draw, alpha: number): void {
    this.watch()
    // Real frame time for the springs (clamped: a hidden tab must not explode them).
    const fdt = this.lastT < 0 ? 0 : Math.min(0.05, Math.max(0, g.t - this.lastT))
    this.lastT = g.t
    const springs = [this.pad, this.body, this.bell, this.sway, this.pulse]
    for (const pr of springs) for (const sp of pr) sp.update(fdt)
    // Smooth motion between fixed steps, frozen during hit-stop.
    const ahead = this.ctx.fx.hitstop > 0 || this.result ? 0 : Math.min(1, alpha) * STEP
    const look: Look = {
      now: this.time + ahead,
      ahead,
      pad: [this.pad[0].value, this.pad[1].value],
      body: [this.body[0].value, this.body[1].value],
      bell: [this.bell[0].value, this.bell[1].value],
      sway: [this.sway[0].value, this.sway[1].value],
      pulse: [Math.max(0, this.pulse[0].value / 16), Math.max(0, this.pulse[1].value / 16)],
    }
    renderHammer(g, this.s, look, {
      names: this.ctx.names,
      over: this.over,
      winner: this.s.winner,
      bots: this.ctx.bots,
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    // A different round arrived: drop stale edges so no spring fires twice.
    if (this.seenWins[0] > this.s.rounds.wins[0] || this.seenWins[1] > this.s.rounds.wins[1]) {
      this.seenWins = [this.s.rounds.wins[0], this.s.rounds.wins[1]]
      for (const pr of [this.pad, this.body, this.bell, this.sway, this.pulse])
        for (const sp of pr) sp.set(sp.rest)
    }
  }
}

export default () => new HammerHit()
