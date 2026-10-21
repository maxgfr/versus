import {
  type BodySnap,
  cloneWorld,
  type M,
  makeBody,
  type PhysicsWorld,
} from '../../engines/ragdoll/index.ts'
import { ISLAND, anyFallen, hoverY, shapeOf } from './rules.ts'

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
  maxSteps = 420,
): Outcome {
  const w = cloneWorld(Mx, bodies, shapeOf, (ww) => addIsland(Mx, ww))
  const id = bodies.reduce((m, b) => Math.max(m, b.id), 0) + 1
  w.add(id, makeBody(Mx, shapeOf(k), x, hoverY(bodies, k), a), k)
  let steps = 0
  while (steps < maxSteps) {
    w.step(1 / 60)
    steps++
    if (steps > 40 && w.settled(30)) break
  }
  const after = w.snap()
  let moved = 0
  for (const b of bodies) {
    const n = after.find((s) => s.id === b.id)
    if (n) moved += Math.hypot(n.x - b.x, n.y - b.y) + Math.abs(n.a - b.a) * 60
  }
  return { bodies: after, fallen: anyFallen(after), moved, steps }
}
