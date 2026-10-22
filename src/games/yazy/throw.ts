/**
 * Throwing the dice by hand, shared by the dice games: a flick across the tray
 * rolls, and how fast the finger was moving when it let go sets the throw's
 * energy. The faces stay a fair draw from the seeded rng; the energy only
 * drives how the dice fly (hop height, travel, spin) and how hard they land
 * (squash, shake, sound, haptics). A tap still works: it throws gently.
 */
import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Ptr, PlayerInput } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C } from '../../core/render/palette.ts'
import { type DiceState, drawDie, ROLL_TIME, type TrayLayout } from '../../engines/dice/index.ts'

/** Energy of a plain tap on the Roll button or the tray. */
export const TAP_POW = 0.4
/** Finger speed (world units / s) that throws at full energy. */
const FULL_SPEED = 5200
/** A press that travels less than this is a tap, not a flick. */
const FLICK_MIN = 60

export type Gesture =
  { kind: 'tap'; x: number; y: number } | { kind: 'flick'; x0: number; y0: number; pow: number }

/**
 * Follows one finger on the tray: a short press is a tap (toggle a die, or
 * throw gently), a drag released while moving is a flick whose speed is the
 * throw's energy. Cosmetic host state: reset it on restore.
 */
export class Flick {
  private id = -1
  private x0 = 0
  private y0 = 0
  private lx = 0
  private ly = 0
  private far = false
  /** Recent finger speed (units / s), decaying, so a flick that ends in a stop still counts. */
  private speed = 0
  /** 0..1 while a finger is dragging on the tray: the dice rattle in anticipation. */
  charge = 0

  reset(): void {
    this.id = -1
    this.far = false
    this.speed = 0
    this.charge = 0
  }

  /**
   * Feed one step of the player's input. `inside` says whether a press may
   * start a gesture there (the tray). Returns the finished gesture, if any.
   */
  update(
    input: PlayerInput,
    dt: number,
    inside: (x: number, y: number) => boolean,
  ): Gesture | null {
    if (this.id < 0) {
      const p = input.downs.find((d) => inside(d.x, d.y))
      if (!p) return null
      this.start(p)
    }
    const held = input.held.get(this.id)
    const up = held ? undefined : input.ups.find((u) => u.id === this.id)
    const p: Ptr | undefined = held ?? up
    if (!p) {
      this.reset()
      return null
    }
    const inst = Math.hypot(p.x - this.lx, p.y - this.ly) / dt
    this.speed = Math.max(inst, this.speed * Math.exp(-dt * 10))
    this.lx = p.x
    this.ly = p.y
    if (Math.hypot(p.x - this.x0, p.y - this.y0) > FLICK_MIN) this.far = true
    this.charge = this.far ? Math.min(1, this.speed / FULL_SPEED + 0.25) : 0
    if (held) return null
    const g: Gesture = this.far
      ? { kind: 'flick', x0: this.x0, y0: this.y0, pow: flickPow(this.speed) }
      : { kind: 'tap', x: this.x0, y: this.y0 }
    this.reset()
    return g
  }

  private start(p: Ptr): void {
    this.id = p.id
    this.x0 = this.lx = p.x
    this.y0 = this.ly = p.y
    this.far = false
    this.speed = 0
  }
}

/** Throw energy from the release speed: never below a gentle toss. */
export function flickPow(speed: number): number {
  return Math.min(1, Math.max(0.25, speed / FULL_SPEED))
}

/** A computer's throw: lively but varied, deterministic from the game time (cosmetic only). */
export function botPow(now: number): number {
  const h = Math.sin(now * 12.9898) * 43758.5453
  return 0.5 + 0.4 * (h - Math.floor(h))
}

/**
 * The dice in the tray, thrown with energy `pow` (0..1). Like the engine's
 * `drawDice`, but the hops, travel and spin scale with the throw, the landing
 * squash with the impact, and a rattle shows a flick being wound up.
 */
export function drawThrownDice(
  g: Draw,
  t: TrayLayout,
  s: DiceState,
  now: number,
  pow: number,
  o: { dim?: boolean; rattle?: number; color?: string; pip?: string } = {},
): void {
  const since = now - s.rolledAt
  const e = 0.45 + pow * 0.9
  s.dice.forEach((v, i) => {
    const slot = t.slots[i]
    if (!slot) return
    const held = !!s.held[i]
    const tumbling = since < ROLL_TIME && !held
    let x = slot.x
    let y = slot.y
    let angle = 0
    let face = v
    let squash = 0
    if (tumbling) {
      const p = since / ROLL_TIME
      const ph = i * 1.7
      // A harder throw bounces more often and higher, and skids further.
      const hops = 2 + Math.round(pow * 2)
      const hop = Math.abs(Math.sin((p * hops + ph * 0.1) * Math.PI)) * (1 - p) * 80 * e
      y -= hop
      x += Math.sin(p * 9 + ph) * (1 - p) * 34 * e
      angle = (1 - outCubic(p)) * (i % 2 ? -1 : 1) * 7 * e
      face = 1 + (Math.floor(now * (16 + pow * 14) + i * 3) % 6)
      if (p > 0.85) face = v
    } else if (since < ROLL_TIME + 0.3 && !held) {
      squash = (1 - outBack(prog(since, ROLL_TIME, ROLL_TIME + 0.3))) * (0.7 + pow * 0.8)
      squash = Math.max(0, squash)
    } else if (!held && o.rattle) {
      // Wound up: the loose dice rattle in the tray before the throw.
      const r = o.rattle
      x += Math.sin(now * 47 + i * 2.1) * 5 * r
      y += Math.cos(now * 53 + i * 1.3) * 4 * r
      angle = Math.sin(now * 31 + i) * 0.08 * r
    }
    drawDie(g, x, y, t.size, face, {
      angle,
      held,
      lift: held ? 1 : 0,
      squash,
      ring: C.yellow,
      dim: o.dim ?? false,
      ...(o.color ? { color: o.color } : {}),
      ...(o.pip ? { pip: o.pip } : {}),
    })
  })
}

/** Inputs that may act for the side to move: both halves in local 2P, else that side's own. */
export function turnInputs(
  mode: '1p' | '2p' | 'online',
  players: readonly [PlayerInput, PlayerInput],
  turn: Side,
): PlayerInput[] {
  if (mode === '2p') return [players[0], players[1]]
  if (mode === '1p') return [players[0]]
  return [players[turn]]
}
