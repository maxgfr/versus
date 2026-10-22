/**
 * Pure rules for the classic thirteen-row Yazy sheet: six upper rows (Aces to
 * Sixes, bonus +35 at 63), seven lower rows, and the Yazy bonus (+100 for every
 * further five-of-a-kind once the Yazy row holds 50, joker rules). Five-dice
 * combos reuse the yazy reference game's scoring.
 */
import { CATS as YAZY_CATS, score as yazyScore } from '../yazy/rules.ts'

export const MAX_ROLLS = 3
export const NROWS = 13
/** Rows 0..5 are the upper section (faces 1..6). */
export const UPPER_ROWS = 6
export const UPPER_TARGET = 63
export const UPPER_BONUS = 35
export const YAZY_BONUS = 100

export interface Row {
  id: string
  label: string
  /** Face for the upper section (1..6); 0 for lower rows. */
  face: number
}

export const ROWS: readonly Row[] = [
  { id: 'ones', label: 'Aces', face: 1 },
  { id: 'twos', label: 'Twos', face: 2 },
  { id: 'threes', label: 'Threes', face: 3 },
  { id: 'fours', label: 'Fours', face: 4 },
  { id: 'fives', label: 'Fives', face: 5 },
  { id: 'sixes', label: 'Sixes', face: 6 },
  { id: 'three', label: '3 alike', face: 0 },
  { id: 'four', label: '4 alike', face: 0 },
  { id: 'house', label: 'Full house', face: 0 },
  { id: 'small', label: 'Small straight', face: 0 },
  { id: 'large', label: 'Large straight', face: 0 },
  { id: 'yazy', label: 'Yazy!', face: 0 },
  { id: 'chance', label: 'Chance', face: 0 },
]

export const YAZY_ROW = ROWS.findIndex((r) => r.id === 'yazy')

/** Sheet = one score per row (null = open) and how many Yazy bonuses were earned. */
export interface Sheet {
  rows: (number | null)[]
  yazyBonus: number
}

export const emptySheet = (): Sheet => ({
  rows: Array<number | null>(NROWS).fill(null),
  yazyBonus: 0,
})

export const openRows = (s: Sheet): number[] => s.rows.flatMap((v, i) => (v === null ? [i] : []))

/** Turns taken so far: each turn scores exactly one row. */
export const turnsPlayed = (s: Sheet): number => s.rows.filter((v) => v !== null).length

/** The sheet is done after `rounds` turns (a match can be shorter than the thirteen rows). */
export const full = (s: Sheet, rounds: number = NROWS): boolean => turnsPlayed(s) >= rounds

/** Sum of the six upper rows. */
export function upperSum(s: Sheet): number {
  return s.rows.slice(0, UPPER_ROWS).reduce<number>((a, v) => a + (v ?? 0), 0)
}

export const upperBonus = (s: Sheet): number => (upperSum(s) >= UPPER_TARGET ? UPPER_BONUS : 0)

/** Grand total: rows, upper bonus and every Yazy bonus. */
export function total(s: Sheet): number {
  const rows = s.rows.reduce<number>((a, v) => a + (v ?? 0), 0)
  return rows + upperBonus(s) + s.yazyBonus * YAZY_BONUS
}

export const isYazy = (dice: readonly number[]): boolean =>
  dice.length > 0 && dice.every((v) => v === dice[0])

/** A five-of-a-kind after the Yazy row already holds its 50: it earns the +100 bonus. */
export const jokerOn = (dice: readonly number[], s: Sheet): boolean =>
  isYazy(dice) && s.rows[YAZY_ROW] === 50

/**
 * A five-of-a-kind once the Yazy row is filled, with 50 or with a 0: joker
 * rules apply either way (only the 50 earns the bonus).
 */
export const jokerRules = (dice: readonly number[], s: Sheet): boolean =>
  isYazy(dice) && s.rows[YAZY_ROW] !== null

const yazyId = (id: string): number => YAZY_CATS.findIndex((c) => c.id === id)

/** Three of one face and two of another. Five alike only counts with the joker. */
function isFullHouse(dice: readonly number[]): boolean {
  const counts = new Map<number, number>()
  for (const v of dice) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.values()].sort().join() === '2,3'
}

/**
 * Points a row would score for these dice. With the joker on, a five-of-a-kind
 * counts as a full house (25), small straight (30) and large straight (40).
 */
export function rowScore(dice: readonly number[], row: number, joker = false): number {
  const r = ROWS[row]
  if (!r) return 0
  if (r.face > 0) return r.face * dice.filter((v) => v === r.face).length
  if (joker && r.id === 'small') return 30
  if (joker && r.id === 'large') return 40
  if (r.id === 'house') return joker || isFullHouse(dice) ? 25 : 0
  const cat = yazyId(r.id)
  return cat < 0 ? 0 : yazyScore(dice, cat)
}

/**
 * Rows the dice may be scored in. Joker rules (forced), once the Yazy row is
 * filled: a five-of-a-kind goes in its own upper row if that is open; else in
 * any open lower row (full value); only when every lower row is filled may it
 * go in another upper row, for zero.
 */
export function legalRows(dice: readonly number[], s: Sheet): number[] {
  const open = openRows(s)
  if (!jokerRules(dice, s)) return open
  const upper = (dice[0] ?? 1) - 1
  if (s.rows[upper] === null) return [upper]
  const lower = open.filter((r) => r >= UPPER_ROWS)
  return lower.length ? lower : open
}

export const isLegal = (dice: readonly number[], s: Sheet, row: number): boolean =>
  legalRows(dice, s).includes(row)

/** What scoring `row` with these dice would add: row points and Yazy bonus. */
export function valueOf(
  dice: readonly number[],
  s: Sheet,
  row: number,
): { points: number; bonus: number } {
  return {
    points: rowScore(dice, row, jokerRules(dice, s)),
    bonus: jokerOn(dice, s) ? YAZY_BONUS : 0,
  }
}

/** Score `row` into the sheet (mutates `s`). Caller checks `isLegal`. */
export function scoreRow(
  s: Sheet,
  dice: readonly number[],
  row: number,
): { points: number; bonus: number } {
  const v = valueOf(dice, s, row)
  s.rows[row] = v.points
  s.yazyBonus += v.bonus > 0 ? 1 : 0
  return v
}
