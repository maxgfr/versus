import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/** Pure Reflex Race rules: rules, pictures, and the round state machine. */

/** First to this many points takes the match. */
export const TARGET = 7
/** Seconds each picture stays up before the next one flips in. */
export const PICTURE_TIME = 0.9
/** Seconds the rule card shows before the first picture. */
export const INTRO_TIME = 2
/** Seconds of celebration between rounds. */
export const POINT_TIME = 1.6
/** Seconds a side is locked out after a wrong or early tap. */
export const FREEZE = 0.6
/** Float slack for timers that are summed from fixed steps. */
const EPS = 1e-6
/** Chance a picture is a match. */
const MATCH_CHANCE = 0.35

export const ANIMALS = ['🐱', '🐶', '🐸', '🐵', '🦊', '🐰', '🐼', '🐯'] as const
/** Colour indices into the render palette; the colour rule compares two of them. */
export const COLOURS = 6
/** Numbers shown on pictures. */
export const MAX_NUMBER = 9
/** The "over" rule: match numbers strictly above this. */
export const OVER = 5

export type RuleKind = 'glyph' | 'colours' | 'parity' | 'big'
export const RULE_KINDS: readonly RuleKind[] = ['glyph', 'colours', 'parity', 'big']

export type Rule =
  | { kind: 'glyph'; glyph: string }
  | { kind: 'colours' }
  | { kind: 'parity'; even: boolean }
  | { kind: 'big' }

export type Picture =
  | { kind: 'glyph'; glyph: string }
  | { kind: 'colours'; a: number; b: number }
  | { kind: 'number'; n: number }

export function makeRule(rng: Rng, prev: RuleKind | null): Rule {
  const kinds = RULE_KINDS.filter((k) => k !== prev)
  const kind = rng.pick(kinds)
  if (kind === 'glyph') return { kind, glyph: rng.pick(ANIMALS) }
  if (kind === 'parity') return { kind, even: rng.chance(0.5) }
  return { kind }
}

/** Does this picture satisfy the rule? */
export function matches(rule: Rule, pic: Picture): boolean {
  switch (rule.kind) {
    case 'glyph':
      return pic.kind === 'glyph' && pic.glyph === rule.glyph
    case 'colours':
      return pic.kind === 'colours' && pic.a === pic.b
    case 'parity':
      return pic.kind === 'number' && (pic.n % 2 === 0) === rule.even
    case 'big':
      return pic.kind === 'number' && pic.n > OVER
  }
}

/** A picture for `rule`, matching it with probability `MATCH_CHANCE`. */
export function makePicture(rng: Rng, rule: Rule): Picture {
  const want = rng.chance(MATCH_CHANCE)
  if (rule.kind === 'glyph') {
    if (want) return { kind: 'glyph', glyph: rule.glyph }
    return { kind: 'glyph', glyph: rng.pick(ANIMALS.filter((g) => g !== rule.glyph)) }
  }
  if (rule.kind === 'colours') {
    const a = rng.int(0, COLOURS - 1)
    const b = want ? a : rng.pick([...Array(COLOURS).keys()].filter((c) => c !== a))
    return { kind: 'colours', a, b }
  }
  const numbers = [...Array(MAX_NUMBER).keys()].map((i) => i + 1)
  const pool = numbers.filter((n) => matches(rule, { kind: 'number', n }) === want)
  return { kind: 'number', n: rng.pick(pool) }
}

export type Phase = 'intro' | 'play' | 'point'

export interface RaceState {
  score: [number, number]
  rule: Rule
  phase: Phase
  /** Game time the current phase began. */
  phaseAt: number
  /** The picture on show (null while the card is face down). */
  pic: Picture | null
  /** Game time the picture flipped in (-1 none). */
  picAt: number
  /** Whether the picture on show matches the rule (decided when it appears). */
  picMatch: boolean
  /** Game time the card last turned over, for its flip animation. */
  flipAt: number
  /** Round winner, while the point is being celebrated. */
  winner: Side | null
  /** Rounds started, from 1. */
  round: number
  /** Side locked out until this time (-1 none). */
  frozen: [number, number]
  /** Last tap per side: when, and what it was (1 hit, 0 miss, -1 none). */
  tapAt: [number, number]
  tapKind: [number, number]
}

export function newRace(rng: Rng, now: number): RaceState {
  return {
    score: [0, 0],
    rule: makeRule(rng, null),
    phase: 'intro',
    phaseAt: now,
    pic: null,
    picAt: -1,
    picMatch: false,
    flipAt: -10,
    winner: null,
    round: 1,
    frozen: [-1, -1],
    tapAt: [-10, -10],
    tapKind: [-1, -1],
  }
}

export type Event = 'flip' | 'card-down' | null

function showPicture(s: RaceState, rng: Rng, now: number): void {
  const pic = makePicture(rng, s.rule)
  s.picMatch = matches(s.rule, pic)
  s.pic = pic
  s.picAt = now
}

/**
 * Advance the clock. Returns 'flip' when a picture appears (the card turns face
 * up on the first one), 'card-down' when a new round's card turns back, or null.
 */
export function advance(s: RaceState, rng: Rng, now: number): Event {
  if (s.phase === 'intro' && now - s.phaseAt >= INTRO_TIME - EPS) {
    s.phase = 'play'
    s.phaseAt = now
    showPicture(s, rng, now)
    s.flipAt = now
    return 'flip'
  }
  if (s.phase === 'play' && now - s.picAt >= PICTURE_TIME - EPS) {
    showPicture(s, rng, now)
    return 'flip'
  }
  if (s.phase === 'point' && now - s.phaseAt >= POINT_TIME - EPS) {
    s.rule = makeRule(rng, s.rule.kind)
    s.round++
    s.phase = 'intro'
    s.phaseAt = now
    s.pic = null
    s.picAt = -1
    s.picMatch = false
    s.winner = null
    s.flipAt = now
    return 'card-down'
  }
  return null
}

export type Tap = 'hit' | 'miss' | 'early' | 'ignored'

/**
 * A side taps. On a matching picture: +1 and the round is over. On a
 * non-matching one: -1 and a short lock-out. Before the first picture the tap
 * is early: -1 and the same lock-out. Taps during a point or a lock-out do nothing.
 */
export function tap(s: RaceState, side: Side, now: number): Tap {
  if (s.phase === 'point') return 'ignored'
  if (s.frozen[side] >= 0 && now < s.frozen[side]) return 'ignored'
  s.tapAt[side] = now
  if (s.phase === 'intro' || s.pic === null) {
    penalise(s, side, now)
    s.tapKind[side] = 0
    return 'early'
  }
  if (s.picMatch) {
    s.score[side]++
    s.tapKind[side] = 1
    s.phase = 'point'
    s.phaseAt = now
    s.winner = side
    return 'hit'
  }
  penalise(s, side, now)
  s.tapKind[side] = 0
  return 'miss'
}

/**
 * Every side that pressed during one step. Who pressed first inside the step is
 * unknowable, so a dead heat is settled by a coin flip from the seeded rng
 * rather than always favouring red.
 */
export function tapAll(
  s: RaceState,
  sides: readonly Side[],
  now: number,
  rng: Rng,
): { side: Side; r: Tap }[] {
  const order = sides.length === 2 && rng.chance(0.5) ? [...sides].reverse() : sides
  return order.map((side) => ({ side, r: tap(s, side, now) }))
}

function penalise(s: RaceState, side: Side, now: number): void {
  s.score[side]--
  s.frozen[side] = now + FREEZE
}

/** The side that has reached the target, if any. */
export function champion(s: RaceState, target = TARGET): Side | null {
  if (s.score[0] >= target) return 0
  if (s.score[1] >= target) return 1
  return null
}
