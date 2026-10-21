import type { Mode, Side } from './game.ts'
import { H, MID, W, type Stage } from './stage.ts'

/** A finger (or a bot's virtual finger), always in world coordinates. */
export interface Ptr {
  id: number
  x: number
  y: number
  /** Where it went down. */
  x0: number
  y0: number
  /** Position at the previous step, for velocity. */
  px: number
  py: number
  /** Game time (s) at press. */
  t0: number
  side: Side
  /** 0 = left half of the world, 1 = right half (2 vs 2 teammates). Fixed at press. */
  lane: 0 | 1
}

/** Everything one side did since the last fixed step. Bots and the network feed the same object. */
export class PlayerInput {
  readonly held = new Map<number, Ptr>()
  downs: Ptr[] = []
  ups: Ptr[] = []
  /** Set by the stepping code; used to stamp presses. */
  now = 0

  constructor(readonly side: Side) {}

  press(id: number, x: number, y: number): Ptr {
    const p: Ptr = {
      id,
      x,
      y,
      x0: x,
      y0: y,
      px: x,
      py: y,
      t0: this.now,
      side: this.side,
      lane: x < W / 2 ? 0 : 1,
    }
    this.held.set(id, p)
    this.downs.push(p)
    return p
  }

  move(id: number, x: number, y: number): void {
    const p = this.held.get(id)
    if (!p) return
    p.x = x
    p.y = y
  }

  release(id: number): void {
    const p = this.held.get(id)
    if (!p) return
    this.held.delete(id)
    this.ups.push(p)
  }

  releaseAll(): void {
    // Deleting the current entry while iterating a Map is safe.
    for (const id of this.held.keys()) this.release(id)
  }

  /** First held pointer (optionally restricted to a lane), or undefined. */
  first(lane?: 0 | 1): Ptr | undefined {
    for (const p of this.held.values()) if (lane === undefined || p.lane === lane) return p
    return undefined
  }

  get down(): boolean {
    return this.held.size > 0
  }

  /** Taps this step: presses that went down this step. */
  tapped(lane?: 0 | 1): Ptr | undefined {
    return this.downs.find((p) => lane === undefined || p.lane === lane)
  }

  /** Was any press this step inside the rect / circle? */
  pressedIn(x: number, y: number, w: number, h: number): Ptr | undefined {
    return this.downs.find((p) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h)
  }

  pressedNear(x: number, y: number, r: number): Ptr | undefined {
    return this.downs.find((p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= r * r)
  }

  /** Called after each fixed step. */
  endStep(): void {
    this.downs = []
    this.ups = []
    for (const p of this.held.values()) {
      p.px = p.x
      p.py = p.y
    }
  }
}

/**
 * Routes Pointer Events to sides. Local 2P: by half of the world (games may
 * override with `assign`, e.g. board games give the shared board to whoever's
 * turn it is). 1P: every human touch is red's. Online: every local touch belongs
 * to this device's side.
 */
export class Input {
  readonly players: [PlayerInput, PlayerInput] = [new PlayerInput(0), new PlayerInput(1)]
  /** Override routing for local 2P. Return null to ignore the touch. */
  assign: ((x: number, y: number) => Side | null) | null = null
  /** Called for every local pointer event (the online guest forwards these). */
  tap: ((kind: 'd' | 'm' | 'u', id: number, x: number, y: number) => void) | null = null
  /** When false, local events are only forwarded through `tap` (online guest). */
  applyLocal = true
  private owners = new Map<number, Side>()
  private el: HTMLElement | null = null

  constructor(
    private stage: Stage,
    private mode: Mode,
    private local: Side,
  ) {}

  player(side: Side): PlayerInput {
    return this.players[side]
  }

  attach(el: HTMLElement): void {
    this.el = el
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerup', this.onUp)
    el.addEventListener('pointercancel', this.onUp)
    el.addEventListener('lostpointercapture', this.onUp)
  }

  detach(): void {
    const el = this.el
    if (!el) return
    el.removeEventListener('pointerdown', this.onDown)
    el.removeEventListener('pointermove', this.onMove)
    el.removeEventListener('pointerup', this.onUp)
    el.removeEventListener('pointercancel', this.onUp)
    el.removeEventListener('lostpointercapture', this.onUp)
    this.el = null
  }

  setNow(t: number): void {
    this.players[0].now = t
    this.players[1].now = t
  }

  endStep(): void {
    this.players[0].endStep()
    this.players[1].endStep()
  }

  /** Inject a remote event (online host receiving the guest's touches). */
  remote(side: Side, kind: 'd' | 'm' | 'u', id: number, x: number, y: number): void {
    const pi = this.players[side]
    // Remote ids live in their own range so they never collide with local ones.
    const rid = 1_000_000 + id
    if (kind === 'd') pi.press(rid, x, y)
    else if (kind === 'm') pi.move(rid, x, y)
    else pi.release(rid)
  }

  private route(x: number, y: number): Side | null {
    if (this.mode === 'online') return this.local
    if (this.mode === '1p') return 0
    if (this.assign) return this.assign(x, y)
    return y >= MID ? 0 : 1
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault()
    const { x, y } = this.stage.toWorld(e.clientX, e.clientY)
    try {
      ;(e.target as Element).setPointerCapture(e.pointerId)
    } catch {
      // Synthetic events (tests) have no capturable pointer.
    }
    this.tap?.('d', e.pointerId, x, y)
    if (!this.applyLocal) return
    const side = this.route(clamp(x, 0, W), clamp(y, 0, H))
    if (side === null) return
    this.owners.set(e.pointerId, side)
    this.players[side].press(e.pointerId, x, y)
  }

  private onMove = (e: PointerEvent): void => {
    const side = this.owners.get(e.pointerId)
    const forwarding = this.tap !== null && !this.applyLocal
    if (side === undefined && !forwarding) return
    // Coalesced events would be nicer for drawing, but the last position is all a fixed step needs.
    const { x, y } = this.stage.toWorld(e.clientX, e.clientY)
    this.tap?.('m', e.pointerId, x, y)
    if (side !== undefined) this.players[side].move(e.pointerId, x, y)
  }

  private onUp = (e: PointerEvent): void => {
    const side = this.owners.get(e.pointerId)
    const { x, y } = this.stage.toWorld(e.clientX, e.clientY)
    this.tap?.('u', e.pointerId, x, y)
    if (side === undefined) return
    this.owners.delete(e.pointerId)
    this.players[side].release(e.pointerId)
  }
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
