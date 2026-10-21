import type { Side } from '../../core/game.ts'
import { frame } from '../../core/frame.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Pure rules for Disco Battle. One seeded chart of arrows at 120 BPM is shared
 * by both players. Each arrow scrolls from the middle toward its player's pad;
 * tapping the matching pad on the beat scores, combos multiply the points, and
 * arrows that pass by unhit break the combo. 40 seconds, highest score wins.
 */

export const BPM = 120
/** Seconds per beat. */
export const BEAT = 60 / BPM
/** Seconds the chart runs for. */
export const DURATION = 40
/** The first arrow's arrival (seconds). Chart times are multiples of BEAT / 2 from here. */
export const START = 2
/** Seconds an arrow is on screen before it reaches its pad. */
export const LEAD = 1.6
/** Half-windows (s): perfect and good. */
export const PERFECT = 0.05
export const GOOD = 0.12
/** Lanes, left to right in the player's layout: left, down, up, right. */
export const LANES = 4
/** Lane centres (red's layout) and the pad row. */
export const LANE_X = [210, 395, 605, 790] as const
export const PAD_Y = 1460
/** Arrows appear just above the middle line and scroll to the pads. */
export const SPAWN_Y = 880
export const ARROW_SPEED = (PAD_Y - SPAWN_Y) / LEAD

/** An arrival: a time, and a bitmask of the lanes that must be tapped then. */
export interface Note {
  t: number
  lanes: number
}

/** One lane's arrow to hit. r: 0 pending, 1 perfect, 2 good, 3 missed. */
export interface Hit {
  t: number
  lane: number
  r: 0 | 1 | 2 | 3
}

export interface Dancer {
  score: number
  combo: number
  best: number
  hits: Hit[]
  /** Index of the first hit still pending (earlier ones are resolved). */
  cursor: number
  perfects: number
  goods: number
  misses: number
  /** The last judgement and when it happened. */
  judge: 'perfect' | 'good' | 'miss' | ''
  judgeAt: number
  /** Game time of the last tap that landed in each lane (-1 never). */
  laneAt: number[]
}

export interface State {
  chart: Note[]
  p: [Dancer, Dancer]
}

/**
 * A seeded chart: mostly single arrows on the beat, some pairs, some off-beat
 * eighths. It runs for `duration` seconds (the match length).
 */
export function chartNew(rng: Rng, duration = DURATION): Note[] {
  const notes: Note[] = []
  for (let t = START; t < duration - 1; t += BEAT) {
    const roll = rng.next()
    if (roll < 0.2) {
      // A rest: the dancers catch their breath.
    } else if (roll < 0.34) {
      notes.push({ t, lanes: pair(rng) })
    } else {
      notes.push({ t, lanes: 1 << rng.int(0, LANES - 1) })
    }
    if (rng.chance(0.22)) notes.push({ t: t + BEAT / 2, lanes: 1 << rng.int(0, LANES - 1) })
  }
  return notes
}

/** Two different lanes at once. */
function pair(rng: Rng): number {
  const a = rng.int(0, LANES - 1)
  let b = rng.int(0, LANES - 2)
  if (b >= a) b++
  return (1 << a) | (1 << b)
}

/** One pending hit per lane in each note, in time order. */
export function hitsFor(chart: Note[]): Hit[] {
  const hits: Hit[] = []
  for (const n of chart) {
    for (let lane = 0; lane < LANES; lane++) {
      if (n.lanes & (1 << lane)) hits.push({ t: n.t, lane, r: 0 })
    }
  }
  return hits.sort((a, b) => a.t - b.t || a.lane - b.lane)
}

export function dancerNew(chart: Note[]): Dancer {
  return {
    score: 0,
    combo: 0,
    best: 0,
    hits: hitsFor(chart),
    cursor: 0,
    perfects: 0,
    goods: 0,
    misses: 0,
    judge: '',
    judgeAt: -1,
    laneAt: [-1, -1, -1, -1],
  }
}

export function worldNew(rng: Rng, duration = DURATION): State {
  const chart = chartNew(rng, duration)
  return { chart, p: [dancerNew(chart), dancerNew(chart)] }
}

/** Points for a judgement at a combo: the combo multiplies in steps of ten, up to x4. */
export function pointsFor(j: 'perfect' | 'good', combo: number): number {
  const base = j === 'perfect' ? 100 : 50
  return base * (1 + Math.min(3, Math.floor(combo / 10)))
}

/** Advance the cursor past resolved hits. */
function skip(d: Dancer): void {
  while (d.cursor < d.hits.length && (d.hits[d.cursor] as Hit).r !== 0) d.cursor++
}

/**
 * A tap in `lane` at `now`: resolves the closest pending arrow in that lane
 * inside the good window. Returns the judgement, or null for a stray tap.
 */
export function press(d: Dancer, lane: number, now: number): 'perfect' | 'good' | null {
  let best = -1
  let bestErr = Infinity
  for (let i = d.cursor; i < d.hits.length; i++) {
    const h = d.hits[i] as Hit
    if (h.t - now > LEAD) break
    if (h.r !== 0 || h.lane !== lane) continue
    const e = Math.abs(h.t - now)
    if (e <= GOOD && e < bestErr) {
      best = i
      bestErr = e
    }
  }
  if (best < 0) return null
  const h = d.hits[best] as Hit
  const j = bestErr <= PERFECT ? 'perfect' : 'good'
  h.r = j === 'perfect' ? 1 : 2
  d.combo++
  d.best = Math.max(d.best, d.combo)
  d.score += pointsFor(j, d.combo)
  if (j === 'perfect') d.perfects++
  else d.goods++
  d.judge = j
  d.judgeAt = now
  d.laneAt[lane] = now
  skip(d)
  return j
}

/** Arrows that have passed their good window unhit are misses and break the combo. Returns how many. */
export function expire(d: Dancer, now: number): number {
  let n = 0
  for (let i = d.cursor; i < d.hits.length; i++) {
    const h = d.hits[i] as Hit
    if (h.t + GOOD >= now) break
    if (h.r === 0) {
      h.r = 3
      n++
    }
  }
  if (n > 0) {
    d.misses += n
    d.combo = 0
    d.judge = 'miss'
    d.judgeAt = now
  }
  skip(d)
  return n
}

/** Arrow height (red's layout) for a hit at game time `now`. */
export const arrowY = (h: Hit, now: number): number => PAD_Y - ARROW_SPEED * (h.t - now)

/** Lane under a tap in a side's layout (pad row down to the edge), or null when the tap is off the pads. */
export function laneAt(side: Side, x: number, y: number): number | null {
  const l = frame(side, x, y)
  // Generous: anywhere from just above the pads down to the player's edge.
  if (l.y < PAD_Y - 170) return null
  let best = 0
  for (let i = 1; i < LANES; i++) {
    if (Math.abs(l.x - (LANE_X[i] as number)) < Math.abs(l.x - (LANE_X[best] as number))) best = i
  }
  return Math.abs(l.x - (LANE_X[best] as number)) <= 112 ? best : null
}

/** Winner by score at the end; 'draw' on a tie. */
export function winnerOf(s: State): Side | 'draw' {
  if (s.p[0].score === s.p[1].score) return 'draw'
  return s.p[0].score > s.p[1].score ? 0 : 1
}
