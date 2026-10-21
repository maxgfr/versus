import { BaseGame, other, type Side } from '../../core/game.ts'
import { approach } from '../../core/fx/ease.ts'
import type { PlayerInput } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { SIDE } from '../../core/render/palette.ts'
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
  PIECES,
  pieceAt,
  shapeOf,
} from './rules.ts'
import { addIsland } from './sim.ts'

export interface State {
  turn: Side
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
}

class AnimalStack extends BaseGame<State> {
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
    return {
      turn: this.ctx.rng.chance(0.5) ? 0 : 1,
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
      bodyB: { speed: number }
    }[],
  ): void {
    for (const p of pairs) {
      const v = Math.max(p.bodyA.speed, p.bodyB.speed)
      if (v < 2.5) continue
      this.ctx.audio.play('thud', 0.8 + Math.random() * 0.5)
      const at = this.toWorld(p.bodyA.position.x, p.bodyA.position.y)
      this.ctx.fx.puff(at.x, at.y, 'rgba(255,255,255,0.6)', 5)
      if (v > 6) this.ctx.fx.shake(0.12)
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
        this.ctx.audio.play('splash')
        this.ctx.fx.burst(at.x, at.y, '#bfe8ff', { count: 16, speed: 520, size: 12, gravity: 1400 })
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
      this.ctx.audio.play('explode')
      this.ctx.fx.shake(0.6)
      this.ctx.fx.flash(SIDE[loser].main, 0.3)
      this.finish(other(loser), { note: `${s.n} block${s.n === 1 ? '' : 's'} stacked`, delay: 2.2 })
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

  private inputs(): PlayerInput[] {
    const i = this.ctx.input
    if (this.ctx.mode === 'online') return [i.player(this.s.turn)]
    if (this.ctx.mode === '1p') return [i.player(0)]
    return [i.player(0), i.player(1)]
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
    s.phase = 'settle'
    s.phaseAt = this.time
    this.planner = null
    this.plan = null
    this.ctx.audio.play('whoosh')
  }

  private nextTurn(): void {
    const s = this.s
    s.n++
    s.turn = other(s.turn)
    s.piece = s.next
    s.next = pieceAt(this.ctx.seed, s.n + 1)
    s.ha = 0
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
    }
    drawScene(g, view)
  }

  override destroy(): void {
    if (this.world && this.Mx) this.Mx.Engine.clear(this.world.engine)
    this.world = null
  }
}

export default () => new AnimalStack()
