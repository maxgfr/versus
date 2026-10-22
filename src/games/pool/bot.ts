import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  BR,
  DRAG,
  groupOf,
  HEAD,
  left,
  placeCue,
  POCKETS,
  SHOT_SPEED,
  step,
  strike,
  TABLE,
  validPlace,
  type Ball,
  type World,
} from './rules.ts'

interface Tuning {
  /** Angular error on the executed stroke (radians, ±). */
  angle: number
  /** Relative error on the power (±). */
  power: number
  /** Seconds the computer "thinks" before it plays. */
  think: number
  /** Candidate strokes played out with the real rules before choosing (0 = gut feeling). */
  sims: number
  /** Weighs where the cue ball ends up (next pot open for us, none for the rival). */
  position: boolean
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { angle: 0.05, power: 0.22, think: 1.3, sims: 0, position: false },
  normal: { angle: 0.02, power: 0.09, think: 0.9, sims: 10, position: false },
  hard: { angle: 0.006, power: 0.03, think: 0.6, sims: 40, position: true },
}

export interface Pick {
  /** Where to put the cue first (ball in hand), or null. */
  place: { x: number; y: number } | null
  dx: number
  dy: number
  power: number
}

/** Balls the side may hit first now: its group, or the 8 once the group is cleared. */
export function targetsOf(w: World, side: Side): Ball[] {
  const g = w.groups[side]
  return w.balls.filter((b) => {
    if (!b.on || b.n === 0) return false
    if (g === null) return b.n !== 8
    if (groupOf(b.n) === g) return true
    return b.n === 8 && w.balls.every((o) => !o.on || o.n === 0 || o.n === 8 || groupOf(o.n) !== g)
  })
}

/** Distance from point p to segment a-b. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

/** True when no ball (other than those in `skip`) touches the segment a-b. */
export function clear(
  w: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  skip: number[],
): boolean {
  for (const b of w.balls) {
    if (!b.on || skip.includes(b.n)) continue
    if (segDist(b.x, b.y, ax, ay, bx, by) < BR * 2 - 2) return false
  }
  return true
}

/** Power (0..1) that sends the object ball `len` units after a cut of `cos`, the cue travelling `dl` first. */
export function potPower(len: number, dl: number, cos: number): number {
  // Exponential drag: a ball launched at v rolls v / DRAG. Aim to arrive with pace to spare.
  const vObj = (len + 60) * DRAG * 1.3 + 90
  const vHit = vObj / (Math.max(0.2, cos) * 0.975)
  const v0 = vHit + dl * DRAG
  return v0 / SHOT_SPEED
}

interface Cand {
  pick: Pick
  /** Geometric guess of how good it is (lower is better), for the gut-feeling bot and the shortlist. */
  cost: number
  pot: boolean
}

/** Every straight-line pot open to `side` (cue in hand: placed behind the object ball). */
function pots(w: World, side: Side): Cand[] {
  const cue = w.balls[0]
  const inHand = w.phase === 'place'
  const out: Cand[] = []
  for (const t of targetsOf(w, side)) {
    for (const p of POCKETS) {
      const ux = t.x - p.x
      const uy = t.y - p.y
      const len = Math.hypot(ux, uy) || 1
      const bx = ux / len
      const by = uy / len
      // Middle pockets swallow only balls coming in steeply.
      if (p.x > TABLE.x0 + 1 && p.x < TABLE.x1 - 1 && Math.abs(by) < 0.45) continue
      if (!clear(w, t.x, t.y, p.x, p.y, [t.n])) continue
      // Where the cue must touch to send the target straight into the pocket (ghost ball).
      const gx = t.x + bx * BR * 2
      const gy = t.y + by * BR * 2
      const backs = inHand ? [150, 320] : [0]
      for (const back of backs) {
        const c0 = inHand
          ? { x: gx + bx * back, y: gy + by * back }
          : { x: cue?.x ?? HEAD.x, y: cue?.y ?? HEAD.y }
        if (inHand && !validPlace(w, c0.x, c0.y)) continue
        if (!clear(w, c0.x, c0.y, gx, gy, [t.n, 0])) continue
        const dx = gx - c0.x
        const dy = gy - c0.y
        const dl = Math.hypot(dx, dy) || 1
        // The cut: the angle between the cue's travel and the object ball's path.
        const cos = (dx / dl) * -bx + (dy / dl) * -by
        if (cos < 0.25) continue
        const power = potPower(len, dl, cos)
        const cost = dl * 0.5 + len + (1 - cos) * 900 + (power > 1 ? 2000 : 0)
        out.push({
          pick: {
            place: inHand ? c0 : null,
            dx: dx / dl,
            dy: dy / dl,
            power: Math.min(1, Math.max(0.16, power)),
          },
          cost,
          pot: true,
        })
      }
    }
  }
  return out.sort((a, b) => a.cost - b.cost)
}

/** Safe strokes: a full hit on one of our balls at two paces, so at least the contact is legal. */
function safeties(w: World, side: Side): Cand[] {
  const out: Cand[] = []
  const inHand = w.phase === 'place'
  const cue = w.balls[0]
  for (const t of targetsOf(w, side)) {
    const place = inHand ? spotNear(w, t.x, t.y + (t.y < 900 ? 260 : -260)) : null
    const px = place?.x ?? cue?.x ?? HEAD.x
    const py = place?.y ?? cue?.y ?? HEAD.y
    const dl = Math.hypot(t.x - px, t.y - py) || 1
    const dx = (t.x - px) / dl
    const dy = (t.y - py) / dl
    const open = clear(w, px, py, t.x, t.y, [t.n, 0])
    for (const power of [0.32, 0.55]) {
      out.push({ pick: { place, dx, dy, power }, cost: dl + (open ? 0 : 1500) + 4000, pot: false })
    }
  }
  return out.sort((a, b) => a.cost - b.cost)
}

/** Play a stroke out on a copy of the table with the real rules; the copy as it settles. */
export function simulate(w: World, pick: Pick): World {
  const c = structuredClone(w)
  if (c.phase === 'place') {
    if (!pick.place || !placeCue(c, pick.place.x, pick.place.y)) return c
  }
  if (!strike(c, pick.dx, pick.dy, pick.power)) return c
  for (let i = 0; i < 60 * 20 && c.phase === 'roll'; i++) step(c, 1 / 60)
  return c
}

/** How good a settled table is for `side` (higher is better). */
function value(before: World, after: World, side: Side, position: boolean): number {
  const rival: Side = side === 0 ? 1 : 0
  if (after.phase === 'rack') return after.rackWinner === side ? 1e5 : -1e5
  let v = 0
  const mine = after.groups[side]
  const theirs = after.groups[rival]
  for (const n of after.potted) {
    const gp = groupOf(n)
    if (gp && gp === mine) v += 120
    else if (gp && gp === theirs) v -= 40
  }
  if (after.phase === 'place' && after.turn === rival) v -= 900
  else if (after.turn === side) v += 600
  if (position) {
    // Next stroke: an open pot for us when we keep the table, none for the rival when we hand it over.
    const next = pots(after, after.turn).length
    v += after.turn === side ? Math.min(3, next) * 90 : -Math.min(3, next) * 70
    // Clearing the group sooner is worth something too.
    v -= left(after, side) * 10 - left(before, side) * 10
  }
  return v
}

/**
 * The stroke for `side`. Easy trusts its eye (the cheapest-looking straight
 * pot); normal and hard play their shortlist out with the real rules and take
 * the best outcome (hard also reads where the cue ball ends up). The executed
 * stroke then carries the level's hand error.
 */
export function choose(w: World, side: Side, d: Difficulty, rng: Rng): Pick {
  const tune = TUNING[d]
  const potList = pots(w, side)
  const safe = safeties(w, side)
  let pick: Pick | null = null
  if (tune.sims > 0) {
    const short: Cand[] = []
    for (const c of potList.slice(0, tune.sims)) {
      short.push(c)
      // A firmer variant too: some pots need more pace than the estimate.
      if (c.pick.power < 0.85)
        short.push({ ...c, pick: { ...c.pick, power: Math.min(1, c.pick.power * 1.35) } })
    }
    short.push(...safe.slice(0, Math.max(4, tune.sims / 4)))
    let best = -Infinity
    for (const c of short) {
      const v = value(w, simulate(w, c.pick), side, tune.position) - c.cost * 0.02
      if (v > best) {
        best = v
        pick = c.pick
      }
    }
  } else {
    pick = potList[0]?.pick ?? safe[0]?.pick ?? null
  }
  if (!pick) {
    // Nothing of ours is reachable (should not happen): roll the cue up the table.
    const place = w.phase === 'place' ? spotNear(w, HEAD.x, HEAD.y) : null
    pick = { place, dx: 0, dy: -1, power: 0.4 }
  }
  const ang = Math.atan2(pick.dy, pick.dx) + (rng.next() * 2 - 1) * tune.angle
  const power = Math.min(1, Math.max(0.1, pick.power * (1 + (rng.next() * 2 - 1) * tune.power)))
  return { place: pick.place, dx: Math.cos(ang), dy: Math.sin(ang), power }
}

/** A free spot nearest (x, y) on the table, for a ball in hand that has no ideal spot. */
function spotNear(w: World, x: number, y: number): { x: number; y: number } {
  let best = { x: HEAD.x, y: HEAD.y }
  let bd = Infinity
  for (let gx = TABLE.x0 + BR; gx <= TABLE.x1 - BR; gx += 40) {
    for (let gy = TABLE.y0 + BR; gy <= TABLE.y1 - BR; gy += 40) {
      if (!validPlace(w, gx, gy)) continue
      const d = Math.hypot(gx - x, gy - y)
      if (d < bd) {
        bd = d
        best = { x: gx, y: gy }
      }
    }
  }
  return best
}
