import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Body, clampX, type Geo, type Jar, KINDS, landingY, radius } from './rules.ts'

/** Seconds between the computer's drops. */
export const PACE: Record<Difficulty, number> = { easy: 2.2, normal: 1.4, hard: 0.85 }
/** How far (panel-local units) the computer's aim wanders. */
const NOISE: Record<Difficulty, number> = { easy: 70, normal: 30, hard: 8 }
/** Chance the computer just drops somewhere instead of thinking. */
const CARELESS: Record<Difficulty, number> = { easy: 0.45, normal: 0.12, hard: 0 }
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

/**
 * Where to drop a fruit of kind `k`: the best rated of a row of slots and of
 * the spots right above each fruit of the same kind. Easy is often careless,
 * hard looks a fusion ahead; aim noise depends on the difficulty.
 */
export function chooseX(jar: Jar, geo: Geo, k: number, d: Difficulty, rng: Rng): number {
  if (rng.chance(CARELESS[d])) {
    const x = rng.range(geo.left, geo.right)
    return clampX(geo, k, x + rng.range(-NOISE[d], NOISE[d]))
  }
  const xs: number[] = []
  for (let i = 0; i < SLOTS; i++)
    xs.push(clampX(geo, k, geo.left + ((geo.right - geo.left) * i) / (SLOTS - 1)))
  for (const b of jar.bodies) if (b.k === k) xs.push(clampX(geo, k, b.x))
  let best = xs[0] ?? (geo.left + geo.right) / 2
  let bestScore = -Infinity
  for (const x of xs) {
    const s = rate(jar, geo, x, k, d === 'hard')
    if (s > bestScore) {
      bestScore = s
      best = x
    }
  }
  return clampX(geo, k, best + rng.range(-NOISE[d], NOISE[d]))
}
