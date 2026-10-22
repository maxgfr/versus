import { BaseGame, type Difficulty, type MatchSpec, other, type Side } from '../../core/game.ts'
import { bigScore, namePill, pips } from '../../core/hud.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { W } from '../../core/stage.ts'
import { tapRipple } from '../../engines/reflex/index.ts'
import {
  type Body,
  type BodySnap,
  loadMatter,
  type M,
  PhysicsWorld,
} from '../../engines/ragdoll/index.ts'
import { botHop, type BotMind, newMind } from './bot.ts'
import { drawPad, type PadMsg, padRegion } from './pad.ts'
import { BAND_TOP, drawScene, type SceneView, scorePop } from './render.ts'
import {
  canHop,
  capped,
  CHARGE_TIME,
  closingSpeed,
  cooldownFor,
  escaped,
  GOAL_PAUSE,
  GOAL_TOP,
  goalBy,
  grounded,
  hopX,
  HOP_V,
  KICK_TIME,
  kickPower,
  kickVelocity,
  kickoffBall,
  leadX,
  leanFor,
  MAX_BALL,
  matchOver,
  PITCH,
  rampHeat,
  restCount,
  STALL_TIME,
} from './rules.ts'
import {
  addBall,
  addPitch,
  addPlayer,
  bodyId,
  BALL_ID,
  headId,
  KIND,
  placeBall,
  resetPlayer,
} from './sim.ts'

/** Match length: first to N goals. Goals belong to the side that defends them. */
export const match: MatchSpec = { unit: 'points', default: 5, min: 1, max: 7 }

export interface State {
  /** Goals scored, red first. */
  score: [number, number]
  /** `goal` plays the net and the celebration before kick-off is reset. */
  phase: 'play' | 'goal'
  phaseAt: number
  /** Who scored the last goal. */
  scorer: Side
  /** Seconds each player's kick is still out (the lean and the leg). */
  kick: [number, number]
  /** Seconds until each player may hop again. */
  cool: [number, number]
  /** Whether the current kick has already connected with the ball. */
  hit: [boolean, boolean]
  /** Wind-up of the current kick, 0..1: grows while the finger stays down after the hop. */
  charge: [number, number]
  /** Whether the wind-up is still growing (finger down, kick not yet landed). */
  winding: [boolean, boolean]
  /** Power 0..1 of each player's last connecting kick. */
  power: [number, number]
  /** Steps each player has sat still off the grass (perched on a bar, the ball, the rival). */
  rest: [number, number]
  /** Seconds the ball has been (nearly) motionless. */
  still: number
  /** Seconds into the current point (since the last kick-off). */
  pointT: number
  /** How heated the match is, 0..1 (see rules `rampHeat`): kicks fly faster, hops recharge sooner. */
  heat: number
  /** Physics snapshot: the ball, and each player's torso and head. */
  bodies: BodySnap[]
  /** Ball velocity per step, for the trail and the stretch. */
  bv: [number, number]
  /** Game time of each player's last hop (the pad's press) and last connecting kick. */
  tapAt: [number, number]
  hitAt: [number, number]
  /** Game time of each player's last landing, and how hard it was (0..1). */
  landAt: [number, number]
  landK: [number, number]
  /** Game time and strength (0..1) of the ball's last hard knock, for its squash. */
  bumpAt: number
  bumpK: number
  /** The match winner, once decided: they celebrate while the result waits. */
  champ: Side | null
}

/** Something that happened in a step, turned into sound and sparks by `juice`. */
type Ev =
  | { kind: 'kick'; side: Side; x: number; y: number; k: number; dir: number }
  | { kind: 'bar' | 'grass' | 'wall' | 'thud'; x: number; y: number; speed: number }
  | { kind: 'hop'; side: Side; x: number }
  | { kind: 'land'; side: Side; x: number; k: number }
  | { kind: 'goal'; side: Side; x: number; y: number; speed: number }
  | { kind: 'kickoff' | 'reset'; x: number; y: number }
  | { kind: 'heat'; level: number }

/** Seconds a tap made just before the player is ready is kept, so it is never lost. */
const BUFFER = 0.22
const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100

const sideOf = (label: string): Side | null => {
  if (label === 'body0' || label === 'head0') return 0
  if (label === 'body1' || label === 'head1') return 1
  return null
}

export class BallgamesPhysics extends BaseGame<State> {
  /** Goals that take the match. */
  private get goal(): number {
    return this.ctx.target || match.default
  }

  /** How well `side`'s computer player plays (tests pit two levels against each other). */
  protected level(_side: Side): Difficulty {
    return this.ctx.difficulty
  }

  private Mx: M | null = null
  private world: PhysicsWorld | null = null
  private minds: [BotMind, BotMind] = [newMind(), newMind()]
  private jitter = 0
  /** Game time of each human's latest unanswered tap (host only, not state). */
  private wantAt: [number, number] = [-9, -9]
  private wasUp: [boolean, boolean] = [false, false]
  /** Fastest fall of each player's current flight, for the landing thump. */
  private fallV: [number, number] = [0, 0]
  /** Wind-up each computer player holds for on its current hop. */
  private botCharge: [number, number] = [0, 0]
  /** Contacts and kicks collected during a physics step, applied right after it. */
  private events: Ev[] = []
  private kicks: { side: Side; closing: number }[] = []
  // Cosmetic only (not synced): previous bodies for interpolation, the ball's trail and squash.
  private prev: BodySnap[] | null = null
  private trail: { x: number; y: number }[] = []
  private ballSquash = new Spring(1, 420, 13)

  protected setup(): State {
    this.jitter = this.ctx.rng.range(-40, 40)
    void loadMatter().then((Mx) => {
      this.Mx = Mx
      const w = new PhysicsWorld(Mx)
      addPitch(Mx, w)
      addPlayer(Mx, w, 0)
      addPlayer(Mx, w, 1)
      const at = kickoffBall(this.jitter)
      addBall(Mx, w, at.x, at.y)
      Mx.Events.on(w.engine, 'collisionStart', (e) => this.onContacts(e.pairs))
      this.world = w
    })
    return {
      score: [0, 0],
      phase: 'play',
      phaseAt: 0,
      scorer: 0,
      kick: [0, 0],
      cool: [0, 0],
      hit: [false, false],
      charge: [0, 0],
      winding: [false, false],
      power: [0, 0],
      rest: [0, 0],
      still: 0,
      pointT: 0,
      heat: 0,
      bodies: [],
      bv: [0, 0],
      tapAt: [-9, -9],
      hitAt: [-9, -9],
      landAt: [-9, -9],
      landK: [0, 0],
      bumpAt: -9,
      bumpK: 0,
      champ: null,
    }
  }

  private part(id: number): Body | undefined {
    return this.world?.bodies.get(id)
  }

  private ball(): Body | undefined {
    return this.part(BALL_ID)
  }

  /**
   * Contacts that start during a physics step. A player's live kick touching
   * the ball is queued and applied once the step is over (so the solver cannot
   * eat it); everything else becomes a sound.
   */
  private onContacts(pairs: { bodyA: Body; bodyB: Body }[]): void {
    const s = this.s
    for (const p of pairs) {
      const ball = p.bodyA.label === 'ball' ? p.bodyA : p.bodyB.label === 'ball' ? p.bodyB : null
      if (!ball) continue
      const part = ball === p.bodyA ? p.bodyB : p.bodyA
      const side = sideOf(part.label)
      const { x, y } = ball.position
      const speed = ball.speed
      if (side === null) {
        if (speed < 3) continue
        const kind = part.label === 'bar' ? 'bar' : part.label === 'grass' ? 'grass' : 'wall'
        this.events.push({ kind, x, y, speed })
        continue
      }
      if (s.kick[side] > 0 && !s.hit[side]) {
        s.hit[side] = true
        // How hard the hop runs into the ball, read before the solver separates them.
        const closing = closingSpeed(part.position, part.velocity, ball.position, ball.velocity)
        this.kicks.push({ side, closing })
      } else if (speed > 2) this.events.push({ kind: 'thud', x, y, speed })
    }
  }

  /** Send the ball for each kick that connected this step, as hard as the hop and the wind-up say. */
  private strike(): void {
    const Mx = this.Mx
    const ball = this.ball()
    const s = this.s
    for (const { side, closing } of this.kicks) {
      const body = this.part(bodyId(side))
      if (!Mx || !ball || !body) continue
      const k = kickPower(s.charge[side], closing)
      const v = capped(kickVelocity(body.position, ball.position, side, k, s.heat))
      Mx.Body.setVelocity(ball, v)
      // A hard strike spins the ball over its top.
      Mx.Body.setAngularVelocity(ball, (v.x > 0 ? 1 : -1) * (0.08 + k * 0.22))
      s.winding[side] = false
      s.power[side] = r2(k)
      s.hitAt[side] = this.time
      this.events.push({
        kind: 'kick',
        side,
        x: ball.position.x,
        y: ball.position.y,
        k,
        dir: Math.atan2(v.y, v.x),
      })
    }
    this.kicks.length = 0
  }

  /** A hop for `side`: a jump toward `aimX` with the leg out for the kick. */
  private hop(side: Side, aimX: number): void {
    const Mx = this.Mx
    const body = this.part(bodyId(side))
    const head = this.part(headId(side))
    if (!Mx || !body || !head) return
    const s = this.s
    const vx = hopX(body.position.x, aimX)
    Mx.Body.setVelocity(body, { x: vx, y: -HOP_V })
    Mx.Body.setVelocity(head, { x: vx, y: -HOP_V })
    s.kick[side] = KICK_TIME
    s.cool[side] = cooldownFor(s.heat)
    s.hit[side] = false
    s.charge[side] = 0
    s.winding[side] = true
    s.rest[side] = 0
    s.tapAt[side] = this.time
    this.events.push({ kind: 'hop', side, x: body.position.x })
  }

  /** Where `side` wants to hop this step, if at all. Computer players think; humans tap their half. */
  private wantsHop(side: Side): number | null {
    const s = this.s
    const body = this.part(bodyId(side))
    const ball = this.ball()
    if (!body || !ball) return null
    const standing = canHop(body.position.y, s.rest[side])
    if (s.cool[side] > 0 || !standing) return null
    if (this.isBot(side)) {
      const plan = botHop(
        {
          side,
          ball: ball.position,
          bv: ball.velocity,
          me: body.position,
          standing,
          cool: s.cool[side],
          time: this.time,
          heat: s.heat,
        },
        this.level(side),
        this.ctx.rng,
        this.minds[side],
      )
      if (!plan) return null
      this.botCharge[side] = plan.charge
      return plan.aimX
    }
    // A tap a moment too early still counts: it fires as soon as the player is ready.
    if (this.time - this.wantAt[side] > BUFFER) return null
    // The hop leads the ball: it heads for where the ball is about to be.
    const { x, y } = ball.position
    return leadX(x, y, ball.velocity.x, ball.velocity.y)
  }

  /** Remember human taps (with a ripple where the finger landed). */
  private listen(side: Side): void {
    if (this.isBot(side)) return
    const downs = this.ctx.input.player(side).downs
    if (downs.length === 0) return
    this.wantAt[side] = this.time
    const d = downs[0]
    if (d) tapRipple(this.ctx, side, d.x, d.y)
  }

  /** The wind-up grows while the finger stays down (computer players hold for their plan). */
  private windUp(side: Side, dt: number): void {
    const s = this.s
    if (!s.winding[side]) return
    const holding = this.isBot(side)
      ? s.charge[side] < this.botCharge[side]
      : this.ctx.input.player(side).held.size > 0
    if (!holding || s.kick[side] <= 0 || s.hit[side]) {
      s.winding[side] = false
      return
    }
    s.charge[side] = r2(Math.min(1, s.charge[side] + dt / CHARGE_TIME))
  }

  /** Landings (dust and a thump scaled by the fall) and the perch counter. */
  private landings(): void {
    const s = this.s
    for (const side of [0, 1] as Side[]) {
      const body = this.part(bodyId(side))
      if (!body) continue
      const up = !grounded(body.position.y)
      s.rest[side] = restCount(s.rest[side], body.position.y, body.velocity.y)
      if (up) this.fallV[side] = Math.max(this.fallV[side], body.velocity.y)
      if (this.wasUp[side] && !up) {
        const k = Math.min(1, this.fallV[side] / 15)
        s.landAt[side] = this.time
        s.landK[side] = r2(k)
        this.events.push({ kind: 'land', side, x: body.position.x, k })
        this.fallV[side] = 0
      }
      this.wasUp[side] = up
    }
  }

  /** Per-step bookkeeping: cooldowns, kick timers, the wind-up and the lean of each torso. */
  private tick(dt: number): void {
    const Mx = this.Mx
    const ball = this.ball()
    if (!Mx || !ball) return
    const s = this.s
    for (const side of [0, 1] as Side[]) {
      s.cool[side] = Math.max(0, s.cool[side] - dt)
      s.kick[side] = Math.max(0, s.kick[side] - dt)
      this.windUp(side, dt)
      const body = this.part(bodyId(side))
      if (!body) continue
      const head = this.part(headId(side))
      if (head) {
        // The head nods and wobbles on its neck but never flips over onto the chest.
        const d = Math.atan2(Math.sin(body.angle - head.angle), Math.cos(body.angle - head.angle))
        const w = head.angularVelocity * 0.85 + Math.max(-0.08, Math.min(0.08, d * 0.06))
        Mx.Body.setAngularVelocity(head, w)
      }
      // In the air: lean toward the ball while kicking, then spring back upright.
      // On the grass the torso stays square; spinning there would scrape it along the turf.
      if (grounded(body.position.y)) {
        if (body.angularVelocity !== 0 || body.angle !== 0) {
          Mx.Body.setAngularVelocity(body, 0)
          Mx.Body.setAngle(body, 0)
        }
        continue
      }
      const target = s.kick[side] > 0 ? leanFor(body.position.x, ball.position.x) : 0
      const w = Math.max(-0.12, Math.min(0.12, (target - body.angle) * 0.25))
      Mx.Body.setAngularVelocity(body, w)
    }
  }

  /** Advance the physics one step and apply what came out of it (kicks, speed cap, escapes). */
  private physics(dt: number): void {
    const w = this.world
    const Mx = this.Mx
    if (!w || !Mx) return
    this.prev = this.s.bodies
    w.step(dt)
    this.strike()
    const ball = this.ball()
    if (ball) {
      // Never faster than a wall is thick: nothing can tunnel out.
      if (ball.speed > MAX_BALL) Mx.Body.setVelocity(ball, capped(ball.velocity))
      if (escaped(ball.position.x, ball.position.y)) {
        const at = kickoffBall(this.ctx.rng.range(-40, 40))
        placeBall(Mx, ball, at.x, at.y)
        this.events.push({ kind: 'reset', x: at.x, y: at.y })
      }
    }
    for (const side of [0, 1] as Side[]) {
      const body = this.part(bodyId(side))
      const head = this.part(headId(side))
      if (!body || !head) continue
      if (escaped(body.position.x, body.position.y) || escaped(head.position.x, head.position.y)) {
        resetPlayer(Mx, w, side)
        this.wasUp[side] = false
      }
    }
    this.capture()
  }

  /** Goal and stall checks while play is live. */
  private watch(dt: number): void {
    const s = this.s
    const Mx = this.Mx
    const ball = this.ball()
    if (!Mx || !ball) return
    const scorer = goalBy(ball.position.x, ball.position.y)
    if (scorer !== null) {
      this.score(scorer, ball)
      return
    }
    // The longer the point, the hotter the match.
    s.pointT += dt
    const heat = rampHeat(s.pointT, s.score, this.goal)
    for (const level of [0.5, 0.9])
      if (s.heat < level && heat >= level) this.events.push({ kind: 'heat', level })
    s.heat = r2(heat)
    // Barely moving for a while (wedged on a crossbar, or behind everyone): put it back on the centre spot.
    s.still = ball.speed < 1.2 ? s.still + dt : 0
    if (s.still > STALL_TIME) {
      s.still = 0
      this.events.push({ kind: 'reset', x: ball.position.x, y: ball.position.y })
      const at = kickoffBall(this.ctx.rng.range(-40, 40))
      placeBall(Mx, ball, at.x, at.y)
      this.capture()
      this.prev = null
    }
  }

  private score(scorer: Side, ball: Body): void {
    const s = this.s
    s.score[scorer]++
    s.phase = 'goal'
    s.phaseAt = this.time
    s.scorer = scorer
    s.still = 0
    this.events.push({
      kind: 'goal',
      side: scorer,
      x: ball.position.x,
      y: ball.position.y,
      speed: ball.speed,
    })
    const done = matchOver(s.score, this.goal)
    if (done !== null) {
      s.champ = done
      const o: { score?: [number, number]; delay: number } = { delay: 2.8 }
      if (this.goal > 1) o.score = [s.score[0], s.score[1]]
      this.finish(done, o)
    }
  }

  /** Back to the centre spot, players at home, after a goal. */
  private kickoff(): void {
    const s = this.s
    const Mx = this.Mx
    const ball = this.ball()
    const w = this.world
    if (!Mx || !ball || !w) return
    const at = kickoffBall(this.ctx.rng.range(-40, 40))
    placeBall(Mx, ball, at.x, at.y)
    resetPlayer(Mx, w, 0)
    resetPlayer(Mx, w, 1)
    s.phase = 'play'
    s.phaseAt = this.time
    s.kick = [0, 0]
    s.cool = [0, 0]
    s.hit = [false, false]
    s.charge = [0, 0]
    s.winding = [false, false]
    s.rest = [0, 0]
    s.still = 0
    s.pointT = 0
    // The pressure of the score carries into the new point; the rally part starts cold.
    s.heat = r2(rampHeat(0, s.score, this.goal))
    this.minds = [newMind(), newMind()]
    this.wantAt = [-9, -9]
    this.wasUp = [false, false]
    this.fallV = [0, 0]
    // Everything jumped: no interpolation or trail across the reset.
    this.capture()
    this.prev = null
    this.trail.length = 0
    this.events.push({ kind: 'kickoff', x: at.x, y: at.y })
  }

  protected step(dt: number): void {
    const w = this.world
    if (!w || !this.Mx) return
    const s = this.s
    if (s.phase === 'play') {
      for (const side of [0, 1] as Side[]) {
        this.listen(side)
        const aim = this.wantsHop(side)
        if (aim !== null) {
          this.wantAt[side] = -9
          this.hop(side, aim)
        }
      }
    }
    this.tick(dt)
    this.physics(dt)
    this.landings()
    if (s.phase === 'play') this.watch(dt)
    else if (this.time - s.phaseAt >= GOAL_PAUSE) this.kickoff()
    this.flush()
  }

  private capture(): void {
    const w = this.world
    if (!w) return
    this.s.bodies = w.snap()
    const ball = this.ball()
    if (ball) this.s.bv = [r1(ball.velocity.x), r1(ball.velocity.y)]
  }

  /** Turn this step's events into juice. */
  private flush(): void {
    for (const e of this.events) this.juice(e)
    this.events.length = 0
  }

  /** Every event's feedback, scaled by how hard it was. */
  private juice(e: Ev): void {
    const { fx, audio } = this.ctx
    const s = this.s
    switch (e.kind) {
      case 'kick': {
        const k = e.k
        const col = SIDE[e.side]
        audio.play('hit', 0.8 + k * 0.6)
        if (k > 0.45) audio.play('whoosh', 0.8 + k * 0.5)
        fx.sparks(e.x, e.y, col.light, Math.round(6 + k * 16))
        fx.burst(e.x, e.y, C.white, {
          count: Math.round(4 + k * 10),
          speed: 300 + k * 600,
          size: 8 + k * 4,
          life: 0.3,
          gravity: 0,
          spread: 0.9,
          dir: e.dir,
          kind: 'spark',
        })
        if (k > 0.7) fx.ring(e.x, e.y, C.yellow, 80 + k * 110)
        if (k > 0.35) fx.shake(0.06 + k * 0.26)
        if (k > 0.55) fx.stop(k > 0.85 ? 5 : 3)
        if (k > 0.5) audio.buzz(Math.round(8 + k * 22))
        this.ballSquash.kick(-4 - k * 7)
        s.bumpAt = this.time
        s.bumpK = r2(k)
        break
      }
      case 'bar': {
        const k = Math.min(1, e.speed / 26)
        audio.play('wall', 0.75 + k * 0.4)
        fx.sparks(e.x, e.y, C.yellow, Math.round(6 + k * 12))
        fx.shake(0.08 + k * 0.2)
        if (k > 0.45) fx.float('Ooh!', e.x, GOAL_TOP - 110, C.yellow, 48)
        this.ballSquash.kick(-3 - k * 5)
        break
      }
      case 'grass': {
        const k = Math.min(1, e.speed / 22)
        audio.play('bounce', 0.85 + k * 0.35)
        if (e.speed > 7) fx.puff(e.x, PITCH.ground, 'rgba(190,255,190,0.5)', Math.round(3 + k * 5))
        this.ballSquash.kick(-2 - k * 6)
        s.bumpAt = this.time
        s.bumpK = r2(k * 0.7)
        break
      }
      case 'wall': {
        const k = Math.min(1, e.speed / 26)
        audio.play('wall', 0.9 + k * 0.3)
        if (k > 0.5) fx.sparks(e.x, e.y, C.white, Math.round(4 + k * 6))
        this.ballSquash.kick(-2 - k * 5)
        break
      }
      case 'thud':
        audio.play('thud', 0.9 + Math.min(0.3, e.speed / 60))
        this.ballSquash.kick(-2)
        break
      case 'hop':
        audio.play('boing', 1 + e.side * 0.08)
        fx.puff(e.x, PITCH.ground, 'rgba(220,255,220,0.6)', 6)
        break
      case 'land':
        audio.play('thud', 0.75 + e.side * 0.1 + (1 - e.k) * 0.2)
        fx.puff(e.x, PITCH.ground, 'rgba(220,255,220,0.55)', Math.round(3 + e.k * 5))
        break
      case 'goal': {
        const side = e.side
        const col = SIDE[side]
        const k = Math.min(1, e.speed / 24)
        audio.play('score')
        audio.play('explode', 1.4 - k * 0.3)
        audio.buzz(30)
        fx.flash(col.main, 0.35 + k * 0.15)
        fx.shake(0.45 + k * 0.3)
        fx.stop(Math.round(5 + k * 4))
        fx.confetti(side)
        fx.ring(e.x, e.y, C.yellow, 200)
        fx.ring(e.x, e.y, col.light, 320 + k * 120)
        // The net swallows the ball: the spray bursts back out of the mouth.
        const intoLeft = e.x < W / 2
        fx.burst(e.x, e.y, col.light, {
          count: Math.round(26 + k * 20),
          speed: 560 + k * 500,
          size: 13,
          gravity: 500,
          spread: Math.PI * 0.9,
          dir: intoLeft ? -0.4 : Math.PI + 0.4,
          kind: 'square',
          colors: [col.main, '#fff8ef', '#ffcd3c'],
        })
        // +1 rises off the scorer's tally.
        floatFor(fx, side, '+1', 120, side === 0 ? 1620 : 180)
        break
      }
      case 'kickoff':
        audio.play('go')
        fx.ring(e.x, e.y, C.yellow, 110)
        break
      case 'heat':
        // The crowd feels it: the ball catches fire, everyone is told.
        audio.play('powerup', e.level > 0.7 ? 1.25 : 1)
        fx.float(e.level > 0.7 ? 'On fire!' : 'Heating up!', W / 2, PITCH.ceil + 90, C.orange, 52)
        fx.flash(C.orange, 0.12)
        break
      case 'reset':
        fx.puff(e.x, e.y, 'rgba(255,255,255,0.6)', 8)
        audio.play('pop')
        fx.ring(e.x, e.y, C.yellow, 90)
        break
    }
  }

  protected override afterEnd(dt: number): void {
    // The winning goal rolls into the net while the winner hops for joy.
    const w = this.world
    const Mx = this.Mx
    if (!w || !Mx) return
    const s = this.s
    const champ = s.champ
    // Every timer runs down, so no leg stays frozen out mid-kick.
    for (const side of [0, 1] as Side[]) {
      s.kick[side] = Math.max(0, s.kick[side] - dt)
      s.cool[side] = Math.max(0, s.cool[side] - dt)
      s.winding[side] = false
    }
    if (champ !== null) {
      const body = this.part(bodyId(champ))
      const head = this.part(headId(champ))
      if (
        body &&
        head &&
        canHop(body.position.y, s.rest[champ]) &&
        this.time - s.tapAt[champ] > 0.5
      ) {
        s.tapAt[champ] = this.time
        s.rest[champ] = 0
        Mx.Body.setVelocity(body, { x: 0, y: -HOP_V * 0.8 })
        Mx.Body.setVelocity(head, { x: 0, y: -HOP_V * 0.8 })
        Mx.Body.setAngle(body, 0)
        this.ctx.audio.play('boing', 1.2)
        this.ctx.fx.puff(body.position.x, PITCH.ground, 'rgba(220,255,220,0.6)', 5)
      }
    }
    // Fireworks over the winner's end of the stands.
    // Cosmetic only, so plain Math.random (the seeded rng is for play).
    const beat = (t: number) => Math.floor((t - s.phaseAt) / 0.35)
    if (champ !== null && beat(this.time) !== beat(this.time - dt)) {
      const x = (champ === 0 ? 80 : 540) + Math.random() * 380
      const y = BAND_TOP - 40 + Math.random() * (PITCH.ceil - BAND_TOP)
      this.ctx.audio.play('pop', 0.8 + Math.random() * 0.6)
      this.ctx.fx.burst(x, y, SIDE[champ].light, {
        count: 22,
        speed: 520,
        size: 8,
        life: 0.7,
        gravity: 400,
        kind: 'spark',
        colors: [SIDE[champ].main, SIDE[champ].light, C.yellow, C.white],
      })
    }
    this.physics(dt)
    this.landings()
    this.flush()
  }

  /** What each player's pad says right now (all from state, so the guest sees the same). */
  private padMsg(side: Side): PadMsg | null {
    const s = this.s
    const age = this.time - s.phaseAt
    if (s.champ !== null) {
      return s.champ === side
        ? { text: 'Winner!', glyph: '🏆', big: true, color: C.yellow, age }
        : { text: 'Full time', sub: `${s.score[side]} – ${s.score[other(side)]}`, age }
    }
    if (s.phase === 'goal') {
      return s.scorer === side
        ? { text: 'GOAL!', glyph: '⚽', big: true, color: C.yellow, age }
        : { text: `${this.ctx.names[s.scorer]} scores`, sub: 'Get it back!', age }
    }
    const first = s.score[0] + s.score[1] === 0
    if (age < (first ? 1.8 : 1.2)) {
      if (first) return { text: 'Kick off!', sub: `First to ${this.goal}`, age }
      // One goal from the match: say so on both pads.
      const point = this.goal > 1 && Math.max(s.score[0], s.score[1]) === this.goal - 1
      if (!point) return { text: 'Kick off!', age }
      const mine = s.score[side] === this.goal - 1
      return { text: 'Match point', sub: mine ? 'One more!' : 'Hold them!', color: C.yellow, age }
    }
    return null
  }

  render(g: Draw, alpha = 1): void {
    const s = this.s
    const t = this.time
    // Interpolate every body between the last two steps (cosmetic, never written back).
    const prev = this.prev
    const bodies =
      prev && prev.length === s.bodies.length
        ? s.bodies.map((b, i) => {
            const p = prev[i]
            if (!p || p.id !== b.id) return b
            const da = Math.atan2(Math.sin(b.a - p.a), Math.cos(b.a - p.a))
            return { ...b, x: lerp(p.x, b.x, alpha), y: lerp(p.y, b.y, alpha), a: p.a + da * alpha }
          })
        : s.bodies
    // The ball's trail: only when it flies fast enough to deserve one.
    const ball = bodies.find((b) => b.k === KIND.ball)
    const speed = Math.hypot(s.bv[0], s.bv[1])
    if (ball && speed > 9 && s.phase === 'play') this.trail.push({ x: ball.x, y: ball.y })
    else this.trail.shift()
    while (this.trail.length > 7) this.trail.shift()
    this.ballSquash.update(1 / 60)
    const view: SceneView = {
      bodies,
      phase: s.phase,
      phaseAge: t - s.phaseAt,
      scorer: s.scorer,
      kick: s.kick,
      hitAge: [t - s.hitAt[0], t - s.hitAt[1]],
      power: s.power,
      charge: s.charge,
      winding: s.winding,
      hopAge: [t - s.tapAt[0], t - s.tapAt[1]],
      landAge: [t - s.landAt[0], t - s.landAt[1]],
      landK: s.landK,
      bumpAge: t - s.bumpAt,
      bumpK: s.bumpK,
      squash: this.ballSquash.value,
      trail: this.trail,
      bv: s.bv,
      heat: s.heat,
      time: t,
      loading: this.world === null && this.ctx.mode !== 'online',
      winner: s.champ,
    }
    for (const side of [0, 1] as Side[])
      padRegion(g, side, side === 0 ? PITCH.bottom : BAND_TOP - 12, t - s.tapAt[side])
    drawScene(g, view)
    for (const side of [0, 1] as Side[]) {
      const body = s.bodies.find((b) => b.k === KIND.body(side))
      const standing = body ? canHop(body.y, s.rest[side]) : true
      const ready =
        s.phase !== 'play' || s.champ !== null
          ? 0
          : standing && s.cool[side] <= 0
            ? 1
            : Math.max(
                0,
                1 - Math.max(s.cool[side] / cooldownFor(s.heat), s.kick[side] / KICK_TIME),
              )
      // Online, each phone shows only its own player's pad, never the rival's button.
      if (g.viewer === null || side === g.viewer)
        drawPad(g, {
          side,
          glyph: '⚽',
          label: this.isBot(side) ? '' : 'Tap to kick · hold for power',
          ready,
          charge: s.kick[side] > 0 && (s.winding[side] || !s.hit[side]) ? s.charge[side] : 0,
          pressAge: t - s.tapAt[side],
          time: t,
          msg: this.padMsg(side),
        })
      namePill(g, side, this.ctx.names[side], { active: false })
      // The tally pops when it goes up.
      const pop = s.scorer === side && s.score[side] > 0 ? scorePop(t - s.phaseAt) : 1
      const y = side === 0 ? g.stage.edge(0) - 70 : g.stage.edge(1) + 70
      g.at(
        120,
        y,
        0,
        () => g.at(-120, -y, 0, () => bigScore(g, side, s.score[side], { x: 120 })),
        pop,
      )
      // Pips run leftwards from the right edge, so a longer match still fits beside the name.
      pips(g, side, s.score[side], this.goal, { x: W - 40 - 23 * (this.goal - 1) - 15 })
    }
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
    this.trail.length = 0
  }

  override destroy(): void {
    if (this.world && this.Mx) this.Mx.Engine.clear(this.world.engine)
    this.world = null
  }
}

export default () => new BallgamesPhysics()
