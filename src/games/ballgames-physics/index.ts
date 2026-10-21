import { BaseGame, type MatchSpec, other, type Side } from '../../core/game.ts'
import { bigScore, namePill, pips } from '../../core/hud.ts'
import { floatFor } from '../../core/fx/fx.ts'
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
  COOLDOWN,
  GOAL_PAUSE,
  goalBy,
  grounded,
  hopX,
  HOP_V,
  KICK_TIME,
  kickVelocity,
  PITCH,
  kickoffBall,
  leanFor,
  matchOver,
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
  /** Seconds the ball has been (nearly) motionless. */
  still: number
  /** Physics snapshot: the ball, and each player's torso and head. */
  bodies: BodySnap[]
  /** Ball velocity per step, for the trail and the stretch. */
  bv: [number, number]
  /** Game time of each player's last hop (the pad's press) and last connecting kick. */
  tapAt: [number, number]
  hitAt: [number, number]
  /** The match winner, once decided: they celebrate while the result waits. */
  champ: Side | null
}

/** Seconds a tap made just before the player is ready is kept, so it is never lost. */
const BUFFER = 0.22
const r1 = (v: number) => Math.round(v * 10) / 10

const sideOf = (label: string): Side | null => {
  if (label === 'body0' || label === 'head0') return 0
  if (label === 'body1' || label === 'head1') return 1
  return null
}

class BallgamesPhysics extends BaseGame<State> {
  /** Goals that take the match. */
  private get goal(): number {
    return this.ctx.target || match.default
  }

  private Mx: M | null = null
  private world: PhysicsWorld | null = null
  private minds: [BotMind, BotMind] = [newMind(), newMind()]
  private jitter = 0
  /** Game time of each human's latest unanswered tap (host only, not state). */
  private wantAt: [number, number] = [-9, -9]
  private wasUp: [boolean, boolean] = [false, false]

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
      still: 0,
      bodies: [],
      bv: [0, 0],
      tapAt: [-9, -9],
      hitAt: [-9, -9],
      champ: null,
    }
  }

  private part(id: number): Body | undefined {
    return this.world?.bodies.get(id)
  }

  private ball(): Body | undefined {
    return this.part(BALL_ID)
  }

  /** Contacts that start this step: a player's connecting kick sends the ball; the rest is thud and bounce. */
  private onContacts(pairs: { bodyA: Body; bodyB: Body }[]): void {
    const Mx = this.Mx
    if (!Mx) return
    const s = this.s
    for (const p of pairs) {
      const ball = p.bodyA.label === 'ball' ? p.bodyA : p.bodyB.label === 'ball' ? p.bodyB : null
      if (!ball) continue
      const other = ball === p.bodyA ? p.bodyB : p.bodyA
      const side = sideOf(other.label)
      const fx = this.ctx.fx
      if (side === null) {
        if (ball.speed < 3) continue
        if (other.label === 'bar') {
          // Off the woodwork: a clang and sparks.
          this.ctx.audio.play('wall', 0.8)
          fx.sparks(ball.position.x, ball.position.y, C.yellow, 12)
          fx.shake(0.18)
        } else if (other.label === 'grass') {
          this.ctx.audio.play('bounce', 0.9 + Math.min(0.3, ball.speed / 60))
          if (ball.speed > 7) fx.puff(ball.position.x, PITCH.ground, 'rgba(190,255,190,0.5)', 4)
        } else this.ctx.audio.play('wall')
        continue
      }
      if (s.kick[side] > 0 && !s.hit[side]) {
        s.hit[side] = true
        s.hitAt[side] = this.time
        const v = kickVelocity(other.position, ball.position, side)
        Mx.Body.setVelocity(ball, v)
        this.ctx.audio.play('hit', 1 + side * 0.05)
        this.ctx.audio.play('whoosh')
        const at = ball.position
        fx.sparks(at.x, at.y, SIDE[side].light, 16)
        fx.burst(at.x, at.y, C.white, {
          count: 6,
          speed: 360,
          size: 9,
          life: 0.3,
          gravity: 0,
          spread: 1.2,
          dir: Math.atan2(v.y, v.x),
        })
        fx.shake(0.18)
        fx.stop(3)
      } else if (ball.speed > 2) {
        this.ctx.audio.play('thud', 0.9 + Math.random() * 0.2)
      }
    }
  }

  /** A hop for `side`: a jump toward the ball with the leg out for the kick. */
  private hop(side: Side): void {
    const Mx = this.Mx
    const body = this.part(bodyId(side))
    const head = this.part(headId(side))
    const ball = this.ball()
    if (!Mx || !body || !head || !ball) return
    const s = this.s
    const vx = hopX(body.position.x, ball.position.x)
    Mx.Body.setVelocity(body, { x: vx, y: -HOP_V })
    Mx.Body.setVelocity(head, { x: vx, y: -HOP_V })
    s.kick[side] = KICK_TIME
    s.cool[side] = COOLDOWN
    s.hit[side] = false
    s.tapAt[side] = this.time
    this.ctx.audio.play('boing', 1 + side * 0.08)
    this.ctx.fx.puff(body.position.x, PITCH.ground, 'rgba(220,255,220,0.6)', 6)
  }

  /** Does `side` want to hop this step? Computer players think; humans tap their half. */
  private wantsHop(side: Side): boolean {
    const s = this.s
    const body = this.part(bodyId(side))
    const ball = this.ball()
    if (!body || !ball) return false
    if (s.cool[side] > 0 || !grounded(body.position.y)) return false
    if (this.isBot(side)) {
      return botHop(
        {
          side,
          ball: ball.position,
          me: body.position,
          cool: s.cool[side],
          time: this.time,
        },
        this.ctx.difficulty,
        this.ctx.rng,
        this.minds[side],
      )
    }
    // A tap a moment too early still counts: it fires as soon as the player is ready.
    return this.time - this.wantAt[side] <= BUFFER
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

  /** Dust and a thud when a player comes back down on the grass. */
  private landings(): void {
    for (const side of [0, 1] as Side[]) {
      const body = this.part(bodyId(side))
      if (!body) continue
      const up = !grounded(body.position.y)
      if (this.wasUp[side] && !up) {
        this.ctx.audio.play('thud', 0.8 + side * 0.1)
        this.ctx.fx.puff(body.position.x, PITCH.ground, 'rgba(220,255,220,0.55)', 5)
      }
      this.wasUp[side] = up
    }
  }

  /** Per-step bookkeeping: cooldowns, kick timers and the lean of each torso. */
  private tick(dt: number): void {
    const Mx = this.Mx
    const ball = this.ball()
    if (!Mx || !ball) return
    const s = this.s
    for (const side of [0, 1] as Side[]) {
      s.cool[side] = Math.max(0, s.cool[side] - dt)
      s.kick[side] = Math.max(0, s.kick[side] - dt)
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

  /** Goal and stall checks while play is live. */
  private watch(dt: number): void {
    const s = this.s
    const Mx = this.Mx
    const ball = this.ball()
    if (!Mx || !ball) return
    const scorer = goalBy(ball.position.x, ball.position.y)
    if (scorer !== null) {
      this.score(scorer)
      return
    }
    // Barely moving for a while (wedged on a crossbar, or behind everyone): put it back on the centre spot.
    s.still = ball.speed < 1.2 ? s.still + dt : 0
    if (s.still > STALL_TIME) {
      s.still = 0
      this.ctx.fx.puff(ball.position.x, ball.position.y, 'rgba(255,255,255,0.6)', 8)
      const at = kickoffBall(this.ctx.rng.range(-40, 40))
      placeBall(Mx, ball, at.x, at.y)
      this.ctx.audio.play('pop')
      this.ctx.fx.ring(at.x, at.y, C.yellow, 90)
    }
  }

  private score(scorer: Side): void {
    const s = this.s
    const ball = this.ball()
    s.score[scorer]++
    s.phase = 'goal'
    s.phaseAt = this.time
    s.scorer = scorer
    s.still = 0
    const fx = this.ctx.fx
    const at = ball?.position ?? { x: W / 2, y: 900 }
    this.ctx.audio.play('score')
    this.ctx.audio.play('explode', 1.3)
    fx.flash(SIDE[scorer].main, 0.4)
    fx.shake(0.6)
    fx.stop(8)
    fx.confetti(scorer)
    fx.ring(at.x, at.y, C.yellow, 200)
    fx.ring(at.x, at.y, SIDE[scorer].light, 320)
    fx.burst(at.x, at.y, SIDE[scorer].light, {
      count: 26,
      speed: 560,
      size: 12,
      gravity: 500,
      kind: 'square',
      colors: [SIDE[scorer].main, '#fff8ef', '#ffcd3c'],
    })
    // +1 rises off the scorer's tally.
    floatFor(fx, scorer, '+1', 120, scorer === 0 ? 1620 : 180)
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
    s.still = 0
    this.minds = [newMind(), newMind()]
    this.wantAt = [-9, -9]
    this.ctx.audio.play('go')
    this.ctx.fx.ring(at.x, at.y, C.yellow, 110)
  }

  protected step(dt: number): void {
    const w = this.world
    if (!w || !this.Mx) return
    const s = this.s
    if (s.phase === 'play') {
      for (const side of [0, 1] as Side[]) {
        this.listen(side)
        if (this.wantsHop(side)) {
          this.wantAt[side] = -9
          this.hop(side)
        }
      }
    }
    this.tick(dt)
    w.step(dt)
    this.capture()
    this.landings()
    if (s.phase === 'play') this.watch(dt)
    else if (this.time - s.phaseAt >= GOAL_PAUSE) this.kickoff()
  }

  private capture(): void {
    const w = this.world
    if (!w) return
    this.s.bodies = w.snap()
    const ball = this.ball()
    if (ball) this.s.bv = [r1(ball.velocity.x), r1(ball.velocity.y)]
  }

  protected override afterEnd(dt: number): void {
    // The winning goal rolls into the net while the winner hops for joy.
    const w = this.world
    const Mx = this.Mx
    if (!w || !Mx) return
    const s = this.s
    const champ = s.champ
    if (champ !== null) {
      const body = this.part(bodyId(champ))
      const head = this.part(headId(champ))
      s.kick[champ] = Math.max(0, s.kick[champ] - dt)
      if (body && head && grounded(body.position.y) && this.time - s.tapAt[champ] > 0.5) {
        s.tapAt[champ] = this.time
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
    w.step(dt)
    this.capture()
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

  render(g: Draw): void {
    const s = this.s
    const t = this.time
    const view: SceneView = {
      bodies: s.bodies,
      phase: s.phase,
      phaseAge: t - s.phaseAt,
      scorer: s.scorer,
      kick: s.kick,
      hitAge: [t - s.hitAt[0], t - s.hitAt[1]],
      bv: s.bv,
      time: t,
      loading: this.world === null && this.ctx.mode !== 'online',
      winner: s.champ,
    }
    for (const side of [0, 1] as Side[])
      padRegion(g, side, side === 0 ? PITCH.bottom : BAND_TOP - 12, t - s.tapAt[side])
    drawScene(g, view)
    for (const side of [0, 1] as Side[]) {
      const body = s.bodies.find((b) => b.k === KIND.body(side))
      const onGrass = body ? grounded(body.y) : true
      const ready =
        s.phase !== 'play' || s.champ !== null
          ? 0
          : onGrass && s.cool[side] <= 0
            ? 1
            : 1 - Math.max(s.cool[side] / COOLDOWN, s.kick[side] / KICK_TIME)
      drawPad(g, {
        side,
        glyph: '⚽',
        label: this.isBot(side) ? '' : 'Tap to kick',
        ready,
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

  override destroy(): void {
    if (this.world && this.Mx) this.Mx.Engine.clear(this.world.engine)
    this.world = null
  }
}

export default () => new BallgamesPhysics()
