import { Rng } from '../../core/rng.ts'
import { freshRace, type Answer, type QuizState } from '../math-quiz/rules.ts'
import { COUNTRIES } from './countries.ts'

/** Pure Flag Quiz rules: which flag comes next and which names it is offered with. */

export interface FlagRace extends QuizState<Answer> {
  /** Seed of this match's order of flags. */
  deck: number
}

/**
 * The n-th flag of the match. A full pass over the world before any flag comes
 * back, derived from the seed so the state stays a single number.
 */
export function flagAt(deck: number, n: number): number {
  const order = new Rng(deck).shuffle(COUNTRIES.map((_, i) => i))
  return order[n % order.length] ?? 0
}

/** The right name, its most tempting trap, and two of the others. */
export function makeOptions(rng: Rng, country: number): number[] {
  const [first = 0, ...rest] = COUNTRIES[country]?.traps ?? []
  return [country, first, ...rng.shuffle(rest).slice(0, 2)]
}

export function dealFlag(rng: Rng, deck: number, now: number, sums: number): FlagRace {
  const answer = flagAt(deck, sums)
  return { ...freshRace(rng, { answer }, makeOptions(rng, answer), now, sums), deck }
}

/** Replace the current flag with the next one (scores carry over). */
export function nextFlag(s: FlagRace, rng: Rng, now: number): void {
  Object.assign(s, dealFlag(rng, s.deck, now, s.sums), { score: s.score })
}
