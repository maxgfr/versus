import { type BodySnap, type M, makeBody, PhysicsWorld } from '../../engines/ragdoll/index.ts'
import { ISLAND, anyFallen, hoverY, toyOf } from './rules.ts'
import { buildToy } from './toy.ts'

/** Headless physics shared by the game (host), the bot's look-ahead, and the tests. */

export function addIsland(Mx: M, w: PhysicsWorld): void {
  w.addStatic(
    makeBody(
      Mx,
      { kind: 'rect', w: ISLAND.w, h: ISLAND.h, round: 18 },
      ISLAND.x,
      ISLAND.top + ISLAND.h / 2,
      0,
      {
        isStatic: true,
        friction: 1,
        label: 'island',
      },
    ),
  )
}

/** A body for piece `k` (its compound animal silhouette), centre of mass at (x, y). */
export function pieceBody(Mx: M, k: number, x: number, y: number, a: number) {
  return buildToy(Mx, toyOf(k), x, y, a)
}

/** A fresh world holding the island and the given tower, at rest. */
export function rebuild(Mx: M, bodies: readonly BodySnap[]): PhysicsWorld {
  const w = new PhysicsWorld(Mx)
  addIsland(Mx, w)
  for (const b of bodies) w.add(b.id, pieceBody(Mx, b.k, b.x, b.y, b.a), b.k)
  return w
}

export interface Outcome {
  bodies: BodySnap[]
  fallen: boolean
  /** Total displacement of the blocks that were already there: how much the drop shook the tower. */
  moved: number
  steps: number
}

/** Drop piece `k` at (x, angle) onto a resting tower and run until it settles (or `maxSteps`). */
export function simulateDrop(
  Mx: M,
  bodies: readonly BodySnap[],
  k: number,
  x: number,
  a: number,
  maxSteps = 360,
): Outcome {
  const w = rebuild(Mx, bodies)
  const id = bodies.reduce((m, b) => Math.max(m, b.id), 0) + 1
  w.add(id, pieceBody(Mx, k, x, hoverY(bodies, k), a), k)
  let steps = 0
  while (steps < maxSteps) {
    w.step(1 / 60)
    steps++
    if (steps > 40 && w.settled(24)) break
  }
  const after = w.snap()
  let moved = 0
  for (const b of bodies) {
    const n = after.find((s) => s.id === b.id)
    if (n) moved += Math.hypot(n.x - b.x, n.y - b.y) + Math.abs(n.a - b.a) * 60
  }
  return { bodies: after, fallen: anyFallen(after), moved, steps }
}
