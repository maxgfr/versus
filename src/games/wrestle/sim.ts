import {
  type Body,
  type M,
  makeBody,
  type PhysicsWorld,
  type Ragdoll,
  ragdoll,
} from '../../engines/ragdoll/index.ts'
import type { Side } from '../../core/game.ts'
import { W } from '../../core/stage.ts'
import { HOME_X, RING, SCALE, STAND_Y } from './rules.ts'

/** Snapshot kinds: wrestler parts are 1 + side × 6 + part (scenery is never snapshotted). */
export const PART = { head: 0, torso: 1, armL: 2, armR: 3, legL: 4, legR: 5 } as const
export const partKind = (side: Side, part: number): number => 1 + side * 6 + part
/** Physics ids: red 1–6, blue 11–16 (the same numbers as the kinds, offset per side). */
export const partId = (side: Side, part: number): number => 1 + side * 10 + part

/** A wrestler as the game keeps it: its parts, joints and the pose each part takes at rest. */
export interface Wrestler {
  rag: Ragdoll
  /** Offset of each part from the torso centre at rest, so a reset restores the pose. */
  offsets: { dx: number; dy: number }[]
}

/** Mat, posts and ceiling. Static, never snapshotted. */
export function addRing(Mx: M, w: PhysicsWorld): void {
  const block = (x: number, y: number, width: number, height: number, label: string) =>
    w.addStatic(
      makeBody(Mx, { kind: 'rect', w: width, h: height }, x, y, 0, {
        isStatic: true,
        friction: 0.9,
        label,
      }),
    )
  // The mat runs off both sides of the picture and well below the apron.
  block(W / 2, RING.mat + 300, W + 800, 600, 'mat')
  // Posts: the ropes are drawn between them; the ring is closed on both sides.
  const postTop = RING.top - 300
  const postH = RING.mat + 200 - postTop
  block(RING.left - 30, postTop + postH / 2, 60, postH, 'post')
  block(RING.right + 30, postTop + postH / 2, 60, postH, 'post')
  // A high roof, so a jump can never leave the picture.
  block(W / 2, RING.top - 30, W + 800, 60, 'roof')
}

/** Hip springs: stiff enough that the legs hold the torso up, soft enough to bounce on landing. */
const HIP_STIFFNESS = 0.6

/**
 * Upright reflex: angular acceleration per radian of lean, per step². Enough to
 * keep a standing wrestler on its legs. It fades out past a lean of 0.4 rad, so a
 * real shove can still topple it. Torques reset after each physics step, so this
 * must run before every `world.step`.
 */
export const UPRIGHT = { torso: 0.02, head: 0.012, leg: 0.08 } as const
/** Matter's delta-time squared for one 60 Hz step, in ms². */
const STEP2 = (1000 / 60) ** 2

function righting(b: Body, kp: number): number {
  const k = Math.max(0, Math.min(1, (0.4 - Math.abs(b.angle)) / 0.2))
  return (b.inertia * (-kp * k * b.angle - 0.1 * b.angularVelocity)) / STEP2
}

/**
 * Apply the upright reflex to one wrestler's torso, head and both legs.
 * `strength` (0..1) scales it: a tired wrestler late in a round topples sooner.
 */
export function uprightTorques(w: PhysicsWorld, side: Side, strength = 1): void {
  const parts: [number, number][] = [
    [PART.torso, UPRIGHT.torso],
    [PART.head, UPRIGHT.head],
    [PART.legL, UPRIGHT.leg],
    [PART.legR, UPRIGHT.leg],
  ]
  for (const [i, kp] of parts) {
    const b = w.bodies.get(partId(side, i))
    if (b) b.torque += righting(b, kp * strength)
  }
}

/** A floppy ragdoll wrestler standing on springy legs, at home for `side`. */
export function addWrestler(Mx: M, w: PhysicsWorld, side: Side, x = HOME_X[side]): Wrestler {
  const rag = ragdoll(Mx, x, STAND_Y, SCALE, -(side + 1))
  // Floppy head and arms, springy legs: soft hips that bounce the torso on landing.
  rag.joints.forEach((j, i) => {
    j.stiffness = i >= 3 ? HIP_STIFFNESS : 0.5
    j.damping = i >= 3 ? 0.06 : 0
  })
  rag.parts.forEach((p, i) => {
    p.label = i === 0 ? 'head' : i === 1 ? 'torso' : i < 4 ? 'arm' : 'leg'
    w.add(partId(side, i), p, partKind(side, i))
  })
  for (const j of rag.joints) Mx.Composite.add(w.engine.world, j)
  const offsets = rag.parts.map((p) => ({ dx: p.position.x - x, dy: p.position.y - STAND_Y }))
  return { rag, offsets }
}

/** Put a wrestler's parts back at home, upright and still. */
export function resetWrestler(Mx: M, wr: Wrestler, x: number): void {
  wr.rag.parts.forEach((p: Body, i) => {
    const o = wr.offsets[i]!
    Mx.Body.setPosition(p, { x: x + o.dx, y: STAND_Y + o.dy })
    Mx.Body.setAngle(p, 0)
    Mx.Body.setVelocity(p, { x: 0, y: 0 })
    Mx.Body.setAngularVelocity(p, 0)
  })
}
