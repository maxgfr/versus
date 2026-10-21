import type { Side } from '../game.ts'
import type { Draw } from '../render/draw.ts'
import { C, SIDE, alpha } from '../render/palette.ts'
import { H, MID, W } from '../stage.ts'
import { type Ease, outBack, outCubic } from './ease.ts'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
  g: number
  drag: number
  kind: 0 | 1 | 2 | 3 // dot, square (confetti), spark (streak), emoji
  rot: number
  vr: number
  glyph: string
}

interface Floater {
  text: string
  x: number
  y: number
  t: number
  dur: number
  color: string
  size: number
  side: Side | undefined
}

interface Ring {
  x: number
  y: number
  r0: number
  r1: number
  t: number
  dur: number
  color: string
  lw: number
}

export interface BurstOpts {
  count?: number
  speed?: number
  size?: number
  life?: number
  gravity?: number
  drag?: number
  spread?: number
  /** Direction (radians) of the burst centre when `spread` < 2π. */
  dir?: number
  colors?: readonly string[]
  kind?: 'dot' | 'square' | 'spark' | 'emoji'
  glyph?: string
}

/** One cosmetic effect call, replayed verbatim on the online guest. */
export type FxCmd =
  | ['b', number, number, string, BurstOpts]
  | ['s', number]
  | ['h', number]
  | ['f', string, number]
  | ['c', number]
  | ['t', string, number, number, string, number, number]
  | ['r', number, number, string, number]

const MAX = 900

/**
 * Juice: particles, screen shake, hit-stop, flashes, floating text, shock rings
 * and confetti. Purely cosmetic, so it uses Math.random and never touches game
 * state. Every call is also recorded when `outbox` is set (online host).
 */
export class Fx {
  private ps: Particle[] = []
  private pool: Particle[] = []
  private floaters: Floater[] = []
  private rings: Ring[] = []
  private trauma = 0
  private flashColor = '#fff'
  private flashA = 0
  /** Steps left to freeze the simulation for impact. */
  hitstop = 0
  shakeX = 0
  shakeY = 0
  reduced = false
  outbox: FxCmd[] | null = null

  burst(x: number, y: number, color: string, o: BurstOpts = {}): void {
    this.outbox?.push(['b', x, y, color, o])
    const n = Math.round((o.count ?? 14) * (this.reduced ? 0.4 : 1))
    const spread = o.spread ?? Math.PI * 2
    const dir = o.dir ?? 0
    const kind = o.kind === 'square' ? 1 : o.kind === 'spark' ? 2 : o.kind === 'emoji' ? 3 : 0
    for (let i = 0; i < n; i++) {
      if (this.ps.length >= MAX) break
      const p = this.pool.pop() ?? ({} as Particle)
      const a = dir + (Math.random() - 0.5) * spread
      const sp = (o.speed ?? 420) * (0.35 + Math.random() * 0.75)
      p.x = x
      p.y = y
      p.vx = Math.cos(a) * sp
      p.vy = Math.sin(a) * sp
      p.max = p.life = (o.life ?? 0.6) * (0.6 + Math.random() * 0.6)
      p.size = (o.size ?? 10) * (0.6 + Math.random() * 0.7)
      p.color = o.colors ? (o.colors[(Math.random() * o.colors.length) | 0] as string) : color
      p.g = o.gravity ?? 900
      p.drag = o.drag ?? 1.5
      p.kind = kind
      p.rot = Math.random() * Math.PI * 2
      p.vr = (Math.random() - 0.5) * 14
      p.glyph = o.glyph ?? ''
      this.ps.push(p)
    }
  }

  /** Puff of dust / smoke: slow, big, fading. */
  puff(x: number, y: number, color = 'rgba(255,255,255,0.7)', count = 8): void {
    this.burst(x, y, color, { count, speed: 140, size: 26, life: 0.55, gravity: -60, drag: 3 })
  }

  sparks(x: number, y: number, color: string = C.yellow, count = 12): void {
    this.burst(x, y, color, { count, speed: 700, size: 6, life: 0.35, gravity: 300, kind: 'spark' })
  }

  shake(amount = 0.4): void {
    this.outbox?.push(['s', amount])
    this.trauma = Math.min(1, this.trauma + amount)
  }

  /** Freeze the simulation for a few steps on a big hit. */
  stop(steps = 4): void {
    this.outbox?.push(['h', steps])
    this.hitstop = Math.max(this.hitstop, steps)
  }

  flash(color = '#ffffff', a = 0.45): void {
    this.outbox?.push(['f', color, a])
    if (this.reduced) a *= 0.4
    this.flashColor = color
    this.flashA = Math.max(this.flashA, a)
  }

  ring(x: number, y: number, color: string, r1 = 120): void {
    this.outbox?.push(['r', x, y, color, r1])
    this.rings.push({ x, y, r0: r1 * 0.2, r1, t: 0, dur: 0.4, color, lw: 10 })
  }

  /** Floating text that pops in and drifts up, upright for `side`'s player (or the viewer). */
  float(text: string, x: number, y: number, color: string = C.white, size = 56, side?: Side): void {
    this.outbox?.push(['t', text, x, y, color, size, side ?? -1])
    this.floaters.push({ text, x, y, t: 0, dur: 0.9, color, size, side })
  }

  /** Confetti rain from the winner's edge (or both if undefined). */
  confetti(side?: Side): void {
    this.outbox?.push(['c', side ?? -1])
    const cols = [C.red, C.blue, C.yellow, C.green, C.pink, C.purple, C.cyan]
    const from = side === undefined ? [0, 1] : [side]
    for (const s of from) {
      const y = s === 0 ? H : 0
      for (let i = 0; i < 6; i++) {
        this.burst(W * (0.1 + i * 0.16), y, C.white, {
          count: 14,
          speed: 1300,
          size: 18,
          life: 2.2,
          gravity: s === 0 ? 900 : -900,
          drag: 1.2,
          spread: 0.9,
          dir: s === 0 ? -Math.PI / 2 : Math.PI / 2,
          colors: cols,
          kind: 'square',
        })
      }
    }
  }

  /** Replay a command recorded on the host. */
  apply(c: FxCmd): void {
    const out = this.outbox
    this.outbox = null
    switch (c[0]) {
      case 'b':
        this.burst(c[1], c[2], c[3], c[4])
        break
      case 's':
        this.shake(c[1])
        break
      case 'h':
        break // the guest does not simulate
      case 'f':
        this.flash(c[1], c[2])
        break
      case 'c':
        this.confetti(c[1] < 0 ? undefined : (c[1] as Side))
        break
      case 't':
        this.float(c[1], c[2], c[3], c[4], c[5], c[6] < 0 ? undefined : (c[6] as Side))
        break
      case 'r':
        this.ring(c[1], c[2], c[3], c[4])
        break
    }
    this.outbox = out
  }

  /** Advance with real frame time: effects keep animating through hit-stop and pauses. */
  update(dt: number): void {
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i] as Particle
      p.life -= dt
      if (p.life <= 0) {
        this.ps[i] = this.ps[this.ps.length - 1] as Particle
        this.ps.pop()
        this.pool.push(p)
        continue
      }
      const k = Math.exp(-p.drag * dt)
      p.vx *= k
      p.vy = p.vy * k + p.g * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.vr * dt
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i] as Floater
      f.t += dt
      if (f.t >= f.dur) this.floaters.splice(i, 1)
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i] as Ring
      r.t += dt
      if (r.t >= r.dur) this.rings.splice(i, 1)
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.6)
    const s = this.reduced ? 0 : this.trauma * this.trauma * 28
    this.shakeX = (Math.random() * 2 - 1) * s
    this.shakeY = (Math.random() * 2 - 1) * s
    this.flashA = Math.max(0, this.flashA - dt * 2.6)
  }

  render(g: Draw): void {
    const c = g.ctx
    for (const r of this.rings) {
      const t = r.t / r.dur
      const e: Ease = outCubic
      g.alpha(1 - t, () =>
        g.ring(r.x, r.y, r.r0 + (r.r1 - r.r0) * e(t), r.color, r.lw * (1 - t) + 1),
      )
    }
    for (const p of this.ps) {
      const a = Math.min(1, (p.life / p.max) * 2)
      c.globalAlpha = a
      if (p.kind === 0) {
        g.circle(p.x, p.y, p.size * (0.5 + 0.5 * (p.life / p.max)), p.color)
      } else if (p.kind === 1) {
        c.save()
        c.translate(p.x, p.y)
        c.rotate(p.rot)
        c.scale(1, Math.cos(p.rot * 1.7))
        c.fillStyle = p.color
        c.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66)
        c.restore()
      } else if (p.kind === 2) {
        g.line(p.x, p.y, p.x - p.vx * 0.03, p.y - p.vy * 0.03, p.color, p.size)
      } else {
        g.emoji(p.glyph, p.x, p.y, p.size, p.rot)
      }
    }
    c.globalAlpha = 1
    for (const f of this.floaters) {
      const t = f.t / f.dur
      const s = t < 0.25 ? outBack(t / 0.25) : 1
      const up = outCubic(t) * 90
      const angle = g.orient(f.side)
      // Drift "up" for the reader: upside-down text's up is +y.
      const dy = Math.abs(angle) > 1 ? up : -up
      g.alpha(t > 0.7 ? (1 - t) / 0.3 : 1, () =>
        g.text(f.text, f.x, f.y + dy, {
          size: f.size * s,
          color: f.color,
          weight: 700,
          angle,
          stroke: alpha(C.ink, 0.85),
        }),
      )
    }
  }

  /** Full-screen flash, drawn after the world (still under the stage transform). */
  renderOverlay(g: Draw): void {
    if (this.flashA > 0.01) g.alpha(this.flashA, () => g.fillView(this.flashColor))
  }

  clear(): void {
    this.pool.push(...this.ps)
    this.ps = []
    this.floaters = []
    this.rings = []
    this.trauma = 0
    this.flashA = 0
    this.hitstop = 0
  }
}

/** A float on the scorer's half, upright for them. */
export function floatFor(fx: Fx, side: Side, text: string, x = W / 2, y?: number): void {
  fx.float(text, x, y ?? (side === 0 ? MID + 260 : MID - 260), SIDE[side].light, 64, side)
}
