import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Body, clampX, type Geo, type Jar, KINDS, landingY, radius } from './rules.ts'

/** Seconds between the computer's drops (hard keeps a human hand's rhythm). */
export const PACE: Record<Difficulty, number> = { easy: 2.6, normal: 1.1, hard: 0.7 }
/** How far (panel-local units) the computer's aim wanders. */
const NOISE: Record<Difficulty, number> = { easy: 90, normal: 16, hard: 5 }
/** Chance the computer just drops somewhere instead of thinking. */
const CARELESS: Record<Difficulty, number> = { easy: 0.5, normal: 0.03, hard: 0 }
/** Candidate drop points along the rail. */
const SLOTS = 17

/** Fruit touching a fruit of radius r resting at (x, y). */
function touching(jar: Jar, geo: Geo, x: number, y: number, r: number, slack: number): Body[] {
  const out: Body[] = []
  for (const b of jar.bodies) {
    const rb = radius(b.k, geo)
    const dx = b.x - x
    const dy = b.y - y
    const min = r + rb + slack
    if (dx * dx + dy * dy <= min * min) out.push(b)
  }
  return out
}

/**
 * How good dropping a fruit of kind `k` at x looks: a fusion (worth more the
 * bigger the fruit; landing on its twin is sure, grazing it on the way past is
 * not), a low resting place, no small fruit buried under a big one, and above
 * all no fruit left over the danger line. `chain` looks one fusion ahead: the
 * new fruit appears between the twins and fuses again if its own kind is there.
 */
export function rate(jar: Jar, geo: Geo, x: number, k: number, chain: boolean): number {
  const r = radius(k, geo)
  const y = landingY(jar, geo, x, k)
  const near = touching(jar, geo, x, y, r, 6 * geo.sc)
  let score = 0
  let twin: Body | null = null
  let graze = false
  for (const b of near) {
    if (b.k !== k) continue
    if (Math.abs(b.x - x) <= (r + radius(b.k, geo)) * 0.8) twin = b
    else graze = true
  }
  if (twin) {
    // Fruit fuse on first touch, so the new one appears between the twins:
    // what matters is hitting the twin squarely (aim noise) and how low it is.
    score += 120 + 40 * k - Math.abs(twin.x - x) * 0.5 + (twin.y - geo.top) * 0.12
    if (chain && k + 1 < KINDS) {
      const r2 = radius(k + 1, geo)
      const mx = (x + twin.x) / 2
      const my = (y + twin.y) / 2
      if (touching(jar, geo, mx, my, r2, r2 * 0.5).some((b) => b.k === k + 1)) score += 90 + 50 * k
    }
    return score
  }
  // Grazing a twin on the way past fuses only if the aim is exact.
  if (graze) score += 40
  for (const b of near) {
    // Next to the kind one up: it will fuse with this one's next merge.
    if (b.k === k + 1) score += 14
    // A small fruit dropped on a bigger one is fine; a big one burying small ones is not.
    if (b.k < k) score -= 12 * (k - b.k)
  }
  // Lower is better: keep the pile flat.
  score += (y - geo.top) * 0.12
  // Never top the jar out.
  if (y - r < geo.danger + 30 * geo.sc) score -= 600
  return score
}

/** Drop points worth trying for a fruit of kind `k`: a row of slots and the spots above its twins. */
function candidates(jar: Jar, geo: Geo, k: number): number[] {
  const xs: number[] = []
  for (let i = 0; i < SLOTS; i++)
    xs.push(clampX(geo, k, geo.left + ((geo.right - geo.left) * i) / (SLOTS - 1)))
  for (const b of jar.bodies) if (b.k === k) xs.push(clampX(geo, k, b.x))
  return xs
}

/**
 * The jar roughly as it will settle after dropping kind `k` at x: the fruit
 * rests where it lands, or fuses with the twin it lands on (the new fruit sits
 * between them). Good enough to look one drop further.
 */
export function placed(jar: Jar, geo: Geo, x: number, k: number): Jar {
  const r = radius(k, geo)
  const y = landingY(jar, geo, x, k)
  let twin: Body | null = null
  for (const b of touching(jar, geo, x, y, r, 6 * geo.sc))
    if (b.k === k && Math.abs(b.x - x) <= (r + radius(b.k, geo)) * 0.8) twin = b
  const rest = (k2: number, bx: number, by: number): Body => ({
    k: k2,
    x: bx,
    y: by,
    vx: 0,
    vy: 0,
    hi: 0,
    sq: 0,
    born: 0,
    a: 0,
  })
  if (!twin) return { ...jar, bodies: [...jar.bodies, rest(k, x, y)] }
  const bodies = jar.bodies.filter((b) => b !== twin)
  if (k + 1 < KINDS) {
    const mx = (x + twin.x) / 2
    const others = { ...jar, bodies }
    bodies.push(rest(k + 1, mx, landingY(others, geo, mx, k + 1)))
  }
  return { ...jar, bodies }
}

/** The best rating any drop of kind `k` can get in this jar. */
function bestRate(jar: Jar, geo: Geo, k: number): number {
  let best = -Infinity
  for (const x of candidates(jar, geo, k)) best = Math.max(best, rate(jar, geo, x, k, true))
  return best
}

/** Weight of the follow-up drop in hard's two-drop look-ahead. */
const LOOKAHEAD = 0.6

/**
 * Where to drop a fruit of kind `k`: the best rated of a row of slots and of
 * the spots right above each fruit of the same kind. Easy is often careless
 * and its aim wanders; normal looks a fusion ahead; hard also plans its drop
 * around `next`, the fruit shown in the Next bubble (players see it too), and
 * aims almost exactly.
 */
export function chooseX(
  jar: Jar,
  geo: Geo,
  k: number,
  d: Difficulty,
  rng: Rng,
  next?: number,
): number {
  if (rng.chance(CARELESS[d])) {
    const x = rng.range(geo.left, geo.right)
    return clampX(geo, k, x + rng.range(-NOISE[d], NOISE[d]))
  }
  const xs = candidates(jar, geo, k)
  let best = xs[0] ?? (geo.left + geo.right) / 2
  let bestScore = -Infinity
  for (const x of xs) {
    let s = rate(jar, geo, x, k, d !== 'easy')
    if (d === 'hard' && next !== undefined)
      s += LOOKAHEAD * bestRate(placed(jar, geo, x, k), geo, next)
    if (s > bestScore) {
      bestScore = s
      best = x
    }
  }
  return clampX(geo, k, best + rng.range(-NOISE[d], NOISE[d]))
}
