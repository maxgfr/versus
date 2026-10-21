import { type Body, makeBody, type M, type PhysicsWorld } from '../../engines/ragdoll/index.ts'
import type { Side } from '../../core/game.ts'
import { W } from '../../core/stage.ts'
import { BALL_R, BODY, HEAD_DROP, HEAD_R, HOME_X, PITCH, STAND_Y } from './rules.ts'

/** Physics ids and kinds, shared by the game, the renderer and the tests. */
export const BALL_ID = 1
/** Kinds in snapshots: 0 ball, then body / head per side (red 1–2, blue 3–4). */
export const KIND = { ball: 0, body: (s: Side) => 1 + s * 2, head: (s: Side) => 2 + s * 2 } as const
export const bodyId = (s: Side): number => 2 + s * 2
export const headId = (s: Side): number => 3 + s * 2

/** The ground, ceiling, back walls and crossbars of both goals. Static, never snapshotted. */
export function addPitch(Mx: M, w: PhysicsWorld): void {
  const wall = (x: number, y: number, width: number, height: number, label: string) =>
    w.addStatic(
      makeBody(Mx, { kind: 'rect', w: width, h: height }, x, y, 0, {
        isStatic: true,
        friction: 0.5,
        label,
      }),
    )
  // Grass: far below the visible band so nothing can fall under it.
  wall(W / 2, PITCH.ground + 300, W + 800, 600, 'grass')
  // Ceiling over the whole band.
  wall(W / 2, PITCH.ceil - 30, W + 800, 60, 'ceiling')
  // Back of each goal: the stage edge, so balls rebound inside the box.
  const top = PITCH.ceil - 200
  const h = PITCH.ground - top + 200
  wall(PITCH.left - 30, top + h / 2, 60, h, 'back')
  wall(PITCH.right + 30, top + h / 2, 60, h, 'back')
  // Crossbars: the ball can only score by coming in under them.
  const bar = (x: number) => wall(x, PITCH.ground - PITCH.goalH, PITCH.goalD, 20, 'bar')
  bar(PITCH.left + PITCH.goalD / 2)
  bar(PITCH.right - PITCH.goalD / 2)
}

/**
 * A floppy two-part player: a torso block with a head joined to it by a soft
 * pin. Both parts share one collision group, so they never fight each other.
 */
export function addPlayer(Mx: M, w: PhysicsWorld, side: Side, x = HOME_X[side]): void {
  const group = -(side + 1)
  const bodyY = STAND_Y
  const body = Mx.Bodies.rectangle(x, bodyY, BODY.w, BODY.h, {
    chamfer: { radius: BODY.r },
    friction: 0.5,
    density: 0.0016,
    collisionFilter: { group },
    label: `body${side}`,
  })
  // The head sits on the neck: its anchor is 30 below its centre, the body's 40 above its centre.
  const headY = bodyY - HEAD_DROP
  const head = Mx.Bodies.circle(x, headY, HEAD_R, {
    friction: 0.3,
    restitution: 0.25,
    density: 0.0016,
    collisionFilter: { group },
    label: `head${side}`,
  })
  const neck = Mx.Constraint.create({
    bodyA: body,
    pointA: { x: 0, y: -40 },
    bodyB: head,
    pointB: { x: 0, y: 30 },
    stiffness: 0.5,
    length: 0,
  })
  w.add(bodyId(side), body, KIND.body(side))
  w.add(headId(side), head, KIND.head(side))
  Mx.Composite.add(w.engine.world, neck)
}

export function addBall(Mx: M, w: PhysicsWorld, x: number, y: number): Body {
  return w.add(
    BALL_ID,
    makeBody(Mx, { kind: 'circle', r: BALL_R }, x, y, 0, {
      restitution: 0.65,
      friction: 0.04,
      frictionAir: 0.008,
      density: 0.0009,
      label: 'ball',
    }),
    KIND.ball,
  )
}

/** Put a player's parts back on the grass at home, still and upright. */
export function resetPlayer(Mx: M, w: PhysicsWorld, side: Side, x = HOME_X[side]): void {
  const body = w.bodies.get(bodyId(side))
  const head = w.bodies.get(headId(side))
  if (!body || !head) return
  Mx.Body.setPosition(body, { x, y: STAND_Y })
  Mx.Body.setAngle(body, 0)
  Mx.Body.setVelocity(body, { x: 0, y: 0 })
  Mx.Body.setAngularVelocity(body, 0)
  Mx.Body.setPosition(head, { x, y: STAND_Y - HEAD_DROP })
  Mx.Body.setAngle(head, 0)
  Mx.Body.setVelocity(head, { x: 0, y: 0 })
  Mx.Body.setAngularVelocity(head, 0)
}

export function placeBall(Mx: M, ball: Body, x: number, y: number): void {
  Mx.Body.setPosition(ball, { x, y })
  Mx.Body.setVelocity(ball, { x: 0, y: 0 })
  Mx.Body.setAngularVelocity(ball, 0)
}
