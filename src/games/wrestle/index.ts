import { BaseGame, type MatchSpec, type Side, other } from '../../core/game.ts'
import { namePill, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { tapRipple } from '../../engines/reflex/index.ts'
import {
  type Body,
  type BodySnap,
  loadMatter,
  type M,
  PhysicsWorld,
} from '../../engines/ragdoll/index.ts'
import { botTap, type BotMind, newMind } from './bot.ts'
import { drawPad, type PadMsg, padRegion } from './pad.ts'
import { BAND_TOP, drawScene, type SceneView } from './render.ts'
import {
  AIR_LUNGE_VX,
  COOLDOWN,
  grounded,
  HOME_X,
  JUMP_V,
  LUNGE_VX,
  lungeDir,
  matchOver,
  RING,
  ROUND_PAUSE,
  ROUND_TIME,
  roundLoser,
  timeoutLoser,
} from './rules.ts'
import {
  addRing,
  addWrestler,
  partId,
  resetWrestler,
  uprightTorques,
  type Wrestler,
} from './sim.ts'

/** Match length: first to N round wins (best of 5 by default). */
export const match: MatchSpec = { unit: 'wins', default: 3, min: 1, max: 5 }

/** Parts of a wrestler, by index in the ragdoll. */
const HEAD = 0
const TORSO = 1
const ARM_L = 2
const ARM_R = 3
const LEG_L = 4
const LEG_R = 5

export interface State {
  /** Rounds won, red first. */
  wins: [number, number]
  /** 1-based round number. */
  round: number
  /** `fight` while the round is live; `down` once someone is down (or it is replayed). */
  phase: 'fight' | 'down'
  phaseAt: number
  /** Seconds into this round. */
  roundT: number
  /** Who took the last round, `draw` for a replay, null while fighting. */
  winner: Side | 'draw' | null
  /** Seconds until each wrestler may jump or lunge again. */
  cool: [number, number]
  /** Physics snapshot: every part of both wrestlers. */
  bodies: BodySnap[]
  /** Game time of each wrestler's last jump or lunge (the pad's press). */
  tapAt: [number, number]
  /** Game time and place of the last big clash between the two. */
  clashAt: number
  clash: [number, number]
  /** The match winner, once decided: they celebrate while the result waits. */
  champ: Side | null
}

/** Seconds a tap made just before the wrestler is ready is kept, so it is never lost. */
const BUFFER = 0.2

/** Which wrestler a body belongs to, from its collision group (red -1, blue -2); null for scenery. */
const sideOfBody = (b: Body): Side | null =>
  b.collisionFilter.group === -1 ? 0 : b.collisionFilter.group === -2 ? 1 : null
/** Angular kick (radians per step) a torso takes when struck. */
const STAGGER = 0.25

class Wrestle extends BaseGame<State> {
  /** Rounds that take the match. */
  private get goal(): number {
    return this.ctx.target || match.default
  }

  private Mx: M | null = null
  private world: PhysicsWorld | null = null
  private wrestlers: [Wrestler, Wrestler] | null = null
  private minds: [BotMind, BotMind] = [newMind(), newMind()]
  /** Game time of each human's latest unanswered tap (host only, not state). */
  private wantAt: [number, number] = [-9, -9]
  private wasUp: [boolean, boolean] = [false, false]

  protected setup(): State {
    void loadMatter().then((Mx) => {
      this.Mx = Mx
      const w = new PhysicsWorld(Mx)
      addRing(Mx, w)
      this.wrestlers = [addWrestler(Mx, w, 0), addWrestler(Mx, w, 1)]
      Mx.Events.on(w.engine, 'collisionStart', (e) => this.onContacts(e.pairs))
      this.world = w
    })
    return {
      wins: [0, 0],
      round: 1,
      phase: 'fight',
      phaseAt: 0,
      roundT: 0,
      winner: null,
      cool: [0, 0],
      bodies: [],
      tapAt: [-9, -9],
      clashAt: -9,
      clash: [W / 2, MID],
      champ: null,
    }
  }

  private part(side: Side, i: number): Body | undefined {
    return this.world?.bodies.get(partId(side, i))
  }

  /** Impacts: a clap when wrestlers meet, a thud on the mat, posts or roof. */
  private onContacts(pairs: { bodyA: Body; bodyB: Body }[]): void {
    const Mx = this.Mx
    for (const p of pairs) {
      const speed = Math.max(p.bodyA.speed, p.bodyB.speed)
      if (speed < 3) continue
      const a = p.bodyA
      const b = p.bodyB
      const mid = { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 }
      const sa = sideOfBody(a)
      const sb = sideOfBody(b)
      if (sa !== null && sb !== null && sa !== sb && Mx) {
        // One wrestler hits the other: the struck torso is staggered away from the blow.
        this.ctx.audio.play('slap', 0.9 + Math.random() * 0.3)
        this.ctx.fx.sparks(mid.x, mid.y, '#fff8ef', 8)
        const s = this.s
        if (speed > 6 && this.time - s.clashAt > 0.3 && s.phase === 'fight') {
          // A real clash: freeze a beat, shake, and stamp it so everyone sees the star.
          s.clashAt = this.time
          s.clash = [Math.round(mid.x), Math.round(mid.y)]
          this.ctx.audio.play('hit', 0.9)
          this.ctx.fx.shake(0.22)
          this.ctx.fx.stop(3)
          this.ctx.fx.sparks(mid.x, mid.y, C.yellow, 14)
        }
        const hitter = a.speed >= b.speed ? a : b
        const victim = this.part(hitter === a ? sb : sa, TORSO)
        if (victim && victim.speed < hitter.speed) {
          const push = Math.sign(hitter.velocity.x) || 1
          Mx.Body.setAngularVelocity(victim, victim.angularVelocity + push * STAGGER)
        }
      } else if (sa === null && sb === null) {
        this.ctx.audio.play('slap', 0.9 + Math.random() * 0.3)
      } else {
        this.ctx.audio.play('thud', 0.9 + Math.random() * 0.2)
        this.ctx.fx.puff(mid.x, mid.y, 'rgba(255,255,255,0.5)', 4)
        if (speed > 8) this.ctx.fx.shake(0.2)
      }
    }
  }

  /** Does `side` want to jump or lunge this step? Computer wrestlers time it; humans tap their half. */
  private wantsTap(side: Side): boolean {
    const s = this.s
    if (this.isBot(side)) {
      const me = this.part(side, TORSO)
      const rival = this.part(other(side), TORSO)
      if (!me || !rival) return false
      return botTap(
        { me: me.position, rival: rival.position, cool: s.cool[side], time: this.time },
        this.ctx.difficulty,
        this.ctx.rng,
        this.minds[side],
      )
    }
    // A tap a moment too early still counts: it fires as soon as the wrestler is ready.
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

  /** Dust and a thud when a wrestler lands back on the canvas. */
  private landings(): void {
    for (const side of [0, 1] as Side[]) {
      const torso = this.part(side, TORSO)
      if (!torso) continue
      const up = !grounded(torso.position.y)
      if (this.wasUp[side] && !up) {
        this.ctx.audio.play('thud', 0.7 + side * 0.1)
        this.ctx.fx.puff(torso.position.x, RING.mat, 'rgba(255,255,255,0.5)', 5)
        this.ctx.fx.shake(0.08)
      }
      this.wasUp[side] = up
    }
  }

  /** A jump (on the mat) or a lunge (in the air) toward the rival, with the arms flung out. */
  private lunge(side: Side): void {
    const Mx = this.Mx
    const me = this.part(side, TORSO)
    const rival = this.part(other(side), TORSO)
    if (!Mx || !me || !rival) return
    const s = this.s
    const dir = lungeDir(side, me.position.x, rival.position.x)
    const onMat = grounded(me.position.y)
    // The upper body goes first and the legs lag behind, so the wrestler tips into the lunge.
    for (let i = 0; i < 6; i++) {
      const p = this.part(side, i)
      if (!p) continue
      if (onMat) {
        const lag = i === LEG_L || i === LEG_R ? 0.5 : 1
        Mx.Body.setVelocity(p, { x: dir * LUNGE_VX * lag, y: -JUMP_V })
      } else Mx.Body.setVelocity(p, { x: p.velocity.x + dir * AIR_LUNGE_VX, y: p.velocity.y })
    }
    const armL = this.part(side, ARM_L)
    const armR = this.part(side, ARM_R)
    // Both arms swing forward, hands first, into the rival.
    const swing = -dir * 0.9
    if (armL) Mx.Body.setAngularVelocity(armL, swing)
    if (armR) Mx.Body.setAngularVelocity(armR, swing)
    s.cool[side] = COOLDOWN
    s.tapAt[side] = this.time
    this.ctx.audio.play(onMat ? 'boing' : 'whoosh', 1 + side * 0.06)
    if (onMat) this.ctx.fx.puff(me.position.x, RING.mat, 'rgba(255,255,255,0.5)', 6)
    else
      this.ctx.fx.burst(me.position.x, me.position.y, SIDE[side].light, {
        count: 6,
        speed: 300,
        size: 8,
        life: 0.3,
        gravity: 0,
        spread: 1,
        dir: dir > 0 ? Math.PI : 0,
      })
  }

  /** Arms sway while a wrestler stands, so the ring is never still. */
  private sway(side: Side): void {
    const Mx = this.Mx
    const torso = this.part(side, TORSO)
    // Let a lunge's swing play out before the arms go back to swaying.
    if (!Mx || !torso || !grounded(torso.position.y) || this.s.cool[side] > COOLDOWN - 0.3) return
    const w = Math.sin(this.time * 5 + side * 2) * 0.05
    const l = this.part(side, ARM_L)
    const r = this.part(side, ARM_R)
    if (l) Mx.Body.setAngularVelocity(l, w)
    if (r) Mx.Body.setAngularVelocity(r, -w)
  }

  /** Who is down, if anyone: a head on the mat loses the round. */
  private judge(): void {
    const s = this.s
    const heads: [number, number] = [
      this.part(0, HEAD)?.position.y ?? 0,
      this.part(1, HEAD)?.position.y ?? 0,
    ]
    let loser: Side | 'both' | null = roundLoser(heads)
    if (loser === null && s.roundT >= ROUND_TIME) {
      const torsos: [number, number] = [
        this.part(0, TORSO)?.position.x ?? 0,
        this.part(1, TORSO)?.position.x ?? 0,
      ]
      loser = timeoutLoser(heads, torsos)
    }
    if (loser === null) return
    if (loser === 'both') {
      s.winner = 'draw'
      s.phase = 'down'
      s.phaseAt = this.time
      this.ctx.audio.play('buzz')
      this.ctx.fx.shake(0.3)
      return
    }
    const winner = other(loser)
    s.wins[winner]++
    s.winner = winner
    s.phase = 'down'
    s.phaseAt = this.time
    const head = this.part(loser, HEAD)
    const at = head?.position ?? { x: W / 2, y: MID }
    const fx = this.ctx.fx
    this.ctx.audio.play('explode', 1.2)
    this.ctx.audio.play('score')
    fx.stop(8)
    fx.shake(0.6)
    fx.flash(SIDE[winner].main, 0.35)
    fx.ring(at.x, RING.mat, C.yellow, 160)
    fx.ring(at.x, at.y, SIDE[winner].light, 280)
    fx.puff(at.x, RING.mat, 'rgba(255,255,255,0.7)', 10)
    fx.burst(at.x, at.y, C.yellow, {
      count: 7,
      speed: 420,
      size: 38,
      life: 0.8,
      gravity: 700,
      kind: 'emoji',
      glyph: '⭐',
    })
    fx.confetti(winner)
    const done = matchOver(s.wins, this.goal)
    if (done !== null) {
      s.champ = done
      const o: { score?: [number, number]; delay: number } = { delay: 2.8 }
      if (this.goal > 1) o.score = [s.wins[0], s.wins[1]]
      this.finish(done, o)
    }
  }

  /** Both wrestlers back to their corners, a new round. */
  private nextRound(): void {
    const s = this.s
    const Mx = this.Mx
    if (!Mx || !this.wrestlers) return
    resetWrestler(Mx, this.wrestlers[0], HOME_X[0])
    resetWrestler(Mx, this.wrestlers[1], HOME_X[1])
    s.phase = 'fight'
    s.phaseAt = this.time
    s.roundT = 0
    s.round++
    s.cool = [0, 0]
    s.winner = null
    this.minds = [newMind(), newMind()]
    this.wantAt = [-9, -9]
    this.ctx.audio.play('go')
  }

  protected step(dt: number): void {
    const w = this.world
    if (!w || !this.Mx) return
    const s = this.s
    if (s.phase === 'fight') {
      for (const side of [0, 1] as Side[]) {
        s.cool[side] = Math.max(0, s.cool[side] - dt)
        this.listen(side)
        if (s.cool[side] <= 0 && this.wantsTap(side)) {
          this.wantAt[side] = -9
          this.lunge(side)
        }
        uprightTorques(w, side)
        this.sway(side)
      }
      s.roundT += dt
    }
    w.step(dt)
    s.bodies = w.snap()
    this.landings()
    if (s.phase === 'fight') this.judge()
    else if (this.time - s.phaseAt >= ROUND_PAUSE && !this.over) this.nextRound()
  }

  protected override afterEnd(dt: number): void {
    // The fall plays out under the result while the champion jumps for joy.
    const w = this.world
    const Mx = this.Mx
    if (!w || !Mx) return
    const s = this.s
    const champ = s.champ
    if (champ !== null) {
      uprightTorques(w, champ)
      const torso = this.part(champ, TORSO)
      if (torso) {
        // The champion gets back on their feet, whatever the last fall left them in.
        const a = Math.atan2(Math.sin(torso.angle), Math.cos(torso.angle))
        Mx.Body.setAngularVelocity(torso, Math.max(-0.12, Math.min(0.12, -a * 0.12)))
      }
      const age = this.time - s.phaseAt
      if (torso && age > 0.6 && grounded(torso.position.y) && this.time - s.tapAt[champ] > 0.55) {
        s.tapAt[champ] = this.time
        for (let i = 0; i < 6; i++) {
          const p = this.part(champ, i)
          if (p) Mx.Body.setVelocity(p, { x: 0, y: -JUMP_V * 0.75 })
        }
        this.ctx.audio.play('boing', 1.2)
        this.ctx.fx.puff(torso.position.x, RING.mat, 'rgba(255,255,255,0.5)', 5)
      }
      // Fireworks over the champion's end of the hall (cosmetic, so Math.random).
      const beat = (t: number) => Math.floor((t - s.phaseAt) / 0.35)
      if (beat(this.time) !== beat(this.time - dt)) {
        const x = (champ === 0 ? 60 : 540) + Math.random() * 400
        const y = BAND_TOP + Math.random() * 100
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
    }
    w.step(dt)
    s.bodies = w.snap()
  }

  /** What each player's pad says right now (all from state, so the guest sees the same). */
  private padMsg(side: Side): PadMsg | null {
    const s = this.s
    const age = this.time - s.phaseAt
    if (s.champ !== null) {
      return s.champ === side
        ? { text: 'Champion!', glyph: '🏆', big: true, color: C.yellow, age }
        : { text: 'Pinned', sub: `${s.wins[side]} – ${s.wins[other(side)]}`, age }
    }
    if (s.phase === 'down') {
      if (s.winner === 'draw') return { text: 'Double down!', sub: 'Replay', age }
      if (s.winner === null) return null
      return s.winner === side
        ? { text: 'Round won!', glyph: '💪', big: true, color: C.yellow, age }
        : { text: 'Pinned!', sub: 'Get up for the next one', age }
    }
    if (age < 1.3) {
      // The decider gets its own call.
      if (this.goal > 1 && s.wins[0] === this.goal - 1 && s.wins[1] === this.goal - 1)
        return { text: 'Final round', sub: 'Fight!', color: C.yellow, age }
      const sub = s.round === 1 ? `First to ${this.goal} · Fight!` : 'Fight!'
      return { text: `Round ${s.round}`, sub, age }
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
      winner: s.winner,
      champ: s.champ,
      tapAge: [t - s.tapAt[0], t - s.tapAt[1]],
      clashAge: t - s.clashAt,
      clash: s.clash,
      time: t,
      loading: this.world === null && this.ctx.mode !== 'online',
    }
    for (const side of [0, 1] as Side[])
      padRegion(g, side, side === 0 ? RING.bottom : BAND_TOP - 12, t - s.tapAt[side])
    drawScene(g, view)
    const left = ROUND_TIME - s.roundT
    for (const side of [0, 1] as Side[]) {
      const live = s.phase === 'fight' && s.champ === null
      const human = !this.isBot(side)
      // The last ten seconds of a round count down on each pad.
      const urgent = live && left <= 10
      const label = urgent
        ? `0:${String(Math.max(0, Math.ceil(left))).padStart(2, '0')}`
        : human
          ? 'Tap to jump'
          : ''
      const pad = {
        side,
        glyph: '💪',
        label,
        ready: live ? 1 - s.cool[side] / COOLDOWN : 0,
        pressAge: t - s.tapAt[side],
        time: t,
        msg: this.padMsg(side),
      }
      drawPad(g, urgent ? { ...pad, labelColor: C.yellow } : pad)
      namePill(g, side, this.ctx.names[side], { active: false })
      pips(g, side, s.wins[side], this.goal, { x: side === 0 ? W - 150 : 150 })
    }
  }

  override destroy(): void {
    if (this.world && this.Mx) this.Mx.Engine.clear(this.world.engine)
    this.world = null
  }
}

export default () => new Wrestle()
