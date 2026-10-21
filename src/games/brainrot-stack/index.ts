import { BaseGame, type MatchSpec, other, type Side } from '../../core/game.ts'
import { banner, pips } from '../../core/hud.ts'
import { approach } from '../../core/fx/ease.ts'
import type { PlayerInput } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import {
  type BodySnap,
  loadMatter,
  type M,
  makeBody,
  PhysicsWorld,
} from '../../engines/ragdoll/index.ts'
import { Planner, type Plan } from './bot.ts'
import { drawScene, ROTATE_BTN, type SceneView } from './render.ts'
import {
  anyFallen,
  cameraFor,
  clampHover,
  FALL_LINE,
  hoverY,
  ISLAND,
  matchWinner,
  PIECES,
  pieceAt,
  roundSeed,
  shapeOf,
} from './rules.ts'
import { addIsland } from './sim.ts'

const SLIME = '#9dff5e'

/** Seconds the banner stays up after a tower falls, before the next tower is built. */
const BETWEEN = 2.6

/** Match length: first to N rounds won, a round being one tower until it falls. */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

export interface State {
  turn: Side
  /** Who dropped first in the current round (the other one starts the next). */
  first: Side
  /** Round wins, red first. A round ends when a tower falls. */
  wins: [number, number]
  /** Game time the next tower starts, or -1 while this one stands. */
  resetAt: number
  /** Banner shown between two rounds. */
  roundText: string
  phase: 'aim' | 'settle'
  phaseAt: number
  /** Blocks dropped so far. */
  n: number
  piece: number
  next: number
  /** Hovering block: x and angle. */
  hx: number
  ha: number
  bodies: BodySnap[]
  /** Camera: scene offset (rises with the tower) and rotation (faces the player to move). */
  cam: number
  rot: number
  lastDropper: Side | null
  aiming: boolean
  /** Game time and height of the last drop (-1 while hovering): the claw lets go and swings up. */
  dropAt: number
  dropY: number
  /** Game time the tower fell (-1 while it stands) and who toppled it. */
  fellAt: number
  loser: Side | null
}

class BrainrotStack extends BaseGame<State> {
  /** Round wins that take the match. */
  private get goal(): number {
    return this.ctx.target || match.default
  }

  private Mx: M | null = null
  private world: PhysicsWorld | null = null
  private nextId = 0
  private aimPtr: number | null = null
  private planner: Planner | null = null
  private plan: Plan | null = null
  private splashed = new Set<number>()

  protected setup(): State {
    void loadMatter().then((Mx) => {
      this.Mx = Mx
      const w = new PhysicsWorld(Mx)
      addIsland(Mx, w)
      Mx.Events.on(w.engine, 'collisionStart', (e) => this.onHit(e.pairs))
      this.world = w
    })
    const seed = this.ctx.seed
    const first: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    return {
      turn: first,
      first,
      wins: [0, 0],
      resetAt: -1,
      roundText: '',
      phase: 'aim',
      phaseAt: 0,
      n: 0,
      piece: pieceAt(seed, 0),
      next: pieceAt(seed, 1),
      hx: ISLAND.x,
      ha: 0,
      bodies: [],
      cam: 0,
      rot: 0,
      lastDropper: null,
      aiming: false,
      dropAt: -1,
      dropY: 0,
      fellAt: -1,
      loser: null,
    }
  }

  override init(ctx: Parameters<BaseGame<State>['init']>[0]): void {
    super.init(ctx)
    this.s.rot = this.rotTarget()
  }

  /** The scene faces whoever is to move (fixed upright in 1P). */
  private rotTarget(): number {
    return this.ctx.mode !== '1p' && this.s.turn === 1 ? Math.PI : 0
  }

  // ---------- scene ↔ world ----------

  private toScene(x: number, y: number): { x: number; y: number } {
    const a = -this.s.rot
    const dx = x - W / 2
    const dy = y - MID
    return {
      x: W / 2 + dx * Math.cos(a) - dy * Math.sin(a),
      y: MID + dx * Math.sin(a) + dy * Math.cos(a) - this.s.cam,
    }
  }

  private toWorld(x: number, y: number): { x: number; y: number } {
    const a = this.s.rot
    const dx = x - W / 2
    const dy = y + this.s.cam - MID
    return {
      x: W / 2 + dx * Math.cos(a) - dy * Math.sin(a),
      y: MID + dx * Math.sin(a) + dy * Math.cos(a),
    }
  }

  // ---------- simulation ----------

  private onHit(
    pairs: {
      bodyA: { speed: number; position: { x: number; y: number } }
      bodyB: { speed: number; position: { x: number; y: number } }
      collision: { supports: { x: number; y: number }[] }
    }[],
  ): void {
    for (const p of pairs) {
      const v = Math.max(p.bodyA.speed, p.bodyB.speed)
      if (v < 2.5) continue
      const { fx, audio } = this.ctx
      audio.play('thud', 0.8 + Math.random() * 0.5)
      if (v > 5) audio.play('boing', 1.2 + Math.random() * 0.4)
      // Where the two touched (the island's centre would be far off for a block landing on its edge).
      const c = p.collision.supports[0] ?? p.bodyB.position
      const at = this.toWorld(c.x, c.y)
      fx.puff(at.x, at.y, 'rgba(255,255,255,0.6)', 6)
      if (v > 6) {
        fx.shake(0.14)
        fx.sparks(at.x, at.y, C.yellow, 8)
      }
      break
    }
  }

  protected step(dt: number): void {
    const s = this.s
    const w = this.world
    if (!w) return
    w.step(dt)
    for (const [id, b] of w.bodies) {
      if (b.position.y > FALL_LINE + 260 && !this.splashed.has(id)) {
        this.splashed.add(id)
        const at = this.toWorld(b.position.x, ISLAND.top + 330)
        this.ctx.audio.play('splash', 0.8 + Math.random() * 0.3)
        this.ctx.fx.burst(at.x, at.y, SLIME, {
          count: 22,
          speed: 620,
          size: 14,
          gravity: 1500,
          colors: [SLIME, '#5fe36a', '#eaffd6'],
        })
      }
      if (b.position.y > ISLAND.top + 1600) w.remove(id)
    }
    s.bodies = w.snap()
    s.cam = approach(s.cam, cameraFor(hoverY(s.bodies, s.piece)), 2.5, dt)
    s.rot = approach(s.rot, this.rotTarget(), 5, dt)

    // Whoever dropped last owns any collapse, even a late one.
    if (s.lastDropper !== null && anyFallen(s.bodies)) {
      const loser = s.lastDropper
      s.lastDropper = null
      const { fx, audio } = this.ctx
      audio.play('explode')
      audio.play('boing', 0.7)
      fx.shake(0.7)
      fx.stop(6)
      fx.flash(SIDE[loser].main, 0.35)
      this.collapsed(loser)
      return
    }

    // The round is over: the fallen tower plays out, then the next one is built.
    if (s.resetAt >= 0) {
      if (this.time >= s.resetAt) this.newRound()
      return
    }

    if (s.phase === 'settle') {
      const t = this.time - s.phaseAt
      if ((t > 0.8 && w.settled(20)) || t > 6) this.nextTurn()
      return
    }
    if (Math.abs(s.rot - this.rotTarget()) > 0.08) return
    if (this.isBot(s.turn)) this.stepBot(dt)
    else this.stepHuman()
  }

  /** Only the player to move aims, in local 2P too: the other side's touches must not drop a block. */
  private inputs(): PlayerInput[] {
    const i = this.ctx.input
    if (this.ctx.mode === '1p') return [i.player(0)]
    return [i.player(this.s.turn)]
  }

  private stepHuman(): void {
    const s = this.s
    const btn = ROTATE_BTN[this.ctx.mode === '1p' ? 0 : s.turn]
    for (const pi of this.inputs()) {
      for (const d of pi.downs) {
        if (Math.hypot(d.x - btn.x, d.y - btn.y) < btn.r * 1.3) {
          s.ha += Math.PI / 4
          this.ctx.audio.play('click')
          continue
        }
        if (this.aimPtr === null) this.aimPtr = d.id
      }
      if (this.aimPtr === null) continue
      const p = pi.held.get(this.aimPtr)
      if (p) {
        s.aiming = true
        s.hx = clampHover(this.toScene(p.x, p.y).x, s.piece)
      } else if (pi.ups.some((u) => u.id === this.aimPtr)) {
        this.aimPtr = null
        s.aiming = false
        this.drop()
      }
    }
  }

  private stepBot(dt: number): void {
    const s = this.s
    const Mx = this.Mx
    if (!Mx) return
    const t = this.time - s.phaseAt
    if (!this.planner && t > 0.2)
      this.planner = new Planner(Mx, s.bodies, s.piece, this.ctx.difficulty, this.ctx.rng)
    if (this.planner && !this.planner.done) {
      this.planner.tick()
      return
    }
    if (!this.planner) return
    this.plan ??= this.planner.best()
    const minThink = this.ctx.difficulty === 'hard' ? 0.5 : 0.8
    if (t < minThink) return
    s.aiming = true
    s.hx = approach(s.hx, this.plan.x, 9, dt)
    s.ha = approach(s.ha, this.plan.a, 8, dt)
    if (Math.abs(s.hx - this.plan.x) < 3 && Math.abs(s.ha - this.plan.a) < 0.02) {
      s.hx = this.plan.x
      s.ha = this.plan.a
      s.aiming = false
      this.drop()
    }
  }

  private drop(): void {
    const s = this.s
    const Mx = this.Mx
    const w = this.world
    if (!Mx || !w || s.phase !== 'aim') return
    const id = ++this.nextId
    w.add(id, makeBody(Mx, shapeOf(s.piece), s.hx, hoverY(s.bodies, s.piece), s.ha), s.piece)
    s.lastDropper = s.turn
    s.dropAt = this.time
    s.dropY = hoverY(s.bodies, s.piece)
    s.phase = 'settle'
    s.phaseAt = this.time
    this.planner = null
    this.plan = null
    this.ctx.audio.play('whoosh')
  }

  /** Whoever dropped last toppled the tower: the other player takes the round. */
  private collapsed(loser: Side): void {
    const s = this.s
    const winner = other(loser)
    const note = `${s.n} block${s.n === 1 ? '' : 's'} stacked`
    s.wins[winner]++
    s.fellAt = this.time
    s.loser = loser
    s.phase = 'settle'
    s.phaseAt = this.time
    if (matchWinner(s.wins, this.goal) !== null) {
      const o: { note: string; delay: number; score?: [number, number] } = { note, delay: 2.8 }
      if (this.goal > 1) o.score = [s.wins[0], s.wins[1]]
      this.ctx.fx.confetti(winner)
      this.finish(winner, o)
      return
    }
    s.resetAt = this.time + BETWEEN
    s.roundText = `${this.ctx.names[winner]} takes the round`
    this.ctx.audio.play('score')
  }

  /** A fresh tower for the next round, the other player dropping first. */
  private newRound(): void {
    const s = this.s
    const seed = roundSeed(this.ctx.seed, s.wins[0] + s.wins[1])
    if (this.world) {
      // Deleting entries while iterating a Map is safe in JS.
      for (const id of this.world.bodies.keys()) this.world.remove(id)
    }
    this.splashed.clear()
    this.planner = null
    this.plan = null
    this.aimPtr = null
    s.first = other(s.first)
    s.turn = s.first
    s.n = 0
    s.piece = pieceAt(seed, 0)
    s.next = pieceAt(seed, 1)
    s.bodies = []
    s.hx = ISLAND.x
    s.ha = 0
    s.aiming = false
    s.lastDropper = null
    s.phase = 'aim'
    s.phaseAt = this.time
    s.resetAt = -1
    s.roundText = ''
    s.dropAt = -1
    s.fellAt = -1
    s.loser = null
    this.ctx.audio.play('go')
  }

  private nextTurn(): void {
    const s = this.s
    s.n++
    s.turn = other(s.turn)
    s.piece = s.next
    s.next = pieceAt(roundSeed(this.ctx.seed, s.wins[0] + s.wins[1]), s.n + 1)
    s.ha = 0
    s.dropAt = -1
    s.phase = 'aim'
    s.phaseAt = this.time
    this.ctx.audio.play('pop', 1 + Math.min(0.6, s.n * 0.03))
    const top = this.toWorld(s.hx, hoverY(s.bodies, s.piece) + 200)
    this.ctx.fx.float(`${s.n}`, top.x, top.y, SIDE[other(s.turn)].light, 64, other(s.turn))
  }

  protected override afterEnd(dt: number): void {
    // Let the collapse play out under the result.
    const w = this.world
    if (!w) return
    w.step(dt)
    this.s.bodies = w.snap()
  }

  render(g: Draw): void {
    const s = this.s
    const view: SceneView = {
      bodies: s.bodies,
      piece: s.piece,
      next: s.next,
      hx: s.hx,
      ha: s.ha,
      hoverY: hoverY(s.bodies, s.piece),
      showHover: s.phase === 'aim' && !this.over,
      cam: s.cam,
      rot: s.rot,
      turn: s.turn,
      n: s.n,
      time: this.time,
      names: this.ctx.names,
      bots: this.ctx.bots,
      mode: this.ctx.mode,
      over: this.over,
      loading: this.world === null && s.bodies.length === 0 && this.ctx.mode !== 'online',
      aiming: s.aiming,
      glyph: PIECES[s.piece]?.glyph ?? '',
      dropAt: s.dropAt,
      dropY: s.dropY,
      fellAt: s.fellAt,
      loser: s.loser,
    }
    drawScene(g, view)
    if (this.goal > 1) {
      // Clear of the name pill (a long turn prompt) and the corner buttons.
      pips(g, 0, s.wins[0], this.goal, { x: 800 })
      pips(g, 1, s.wins[1], this.goal, { x: 200 })
    }
    if (s.resetAt >= 0 && !this.over) {
      const a = Math.min(1, (this.time - s.phaseAt) * 4)
      banner(g, undefined, s.roundText, MID, { size: 58, alpha: a })
    }
  }

  override destroy(): void {
    if (this.world && this.Mx) this.Mx.Engine.clear(this.world.engine)
    this.world = null
  }
}

export default () => new BrainrotStack()
