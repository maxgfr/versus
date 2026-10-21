/** Pure Yazy rules: nine rows, five dice, three rolls. Everything here is unit-tested. */

export const CATS = [
  { id: 'odds', label: 'Odds', short: 'Odds' },
  { id: 'evens', label: 'Evens', short: 'Evens' },
  { id: 'chance', label: 'Chance', short: 'Chance' },
  { id: 'three', label: '3 alike', short: '3×' },
  { id: 'four', label: '4 alike', short: '4×' },
  { id: 'house', label: 'Full house', short: 'House' },
  { id: 'small', label: 'Small run', short: 'Sm run' },
  { id: 'large', label: 'Big run', short: 'Big run' },
  { id: 'yazy', label: 'Yazy!', short: 'Yazy' },
] as const

export type CatId = (typeof CATS)[number]['id']
export const NCATS = CATS.length
export const MAX_ROLLS = 3

const sum = (d: readonly number[]) => d.reduce((a, b) => a + b, 0)

function counts(d: readonly number[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0]
  for (const v of d) c[v] = (c[v] ?? 0) + 1
  return c
}

function hasRun(d: readonly number[], len: number): boolean {
  const set = new Set(d)
  let run = 0
  for (let v = 1; v <= 6; v++) {
    run = set.has(v) ? run + 1 : 0
    if (run >= len) return true
  }
  return false
}

/** Points the dice would score in a row. */
export function score(dice: readonly number[], cat: number): number {
  const c = counts(dice)
  const most = Math.max(...c)
  switch (CATS[cat]?.id) {
    case 'odds':
      return sum(dice.filter((v) => v % 2 === 1))
    case 'evens':
      return sum(dice.filter((v) => v % 2 === 0))
    case 'chance':
      return sum(dice)
    case 'three':
      return most >= 3 ? sum(dice) : 0
    case 'four':
      return most >= 4 ? sum(dice) : 0
    case 'house': {
      const n = c.filter((x) => x > 0).sort()
      return (n.length === 2 && n[0] === 2 && n[1] === 3) || most === 5 ? 25 : 0
    }
    case 'small':
      return hasRun(dice, 4) ? 30 : 0
    case 'large':
      return hasRun(dice, 5) ? 40 : 0
    case 'yazy':
      return most === 5 ? 50 : 0
    default:
      return 0
  }
}

export type Sheet = (number | null)[]

export const emptySheet = (): Sheet => Array<number | null>(NCATS).fill(null)

export const total = (s: Sheet): number => s.reduce<number>((a, v) => a + (v ?? 0), 0)

/** Turns taken so far: each turn scores exactly one row. */
export const turnsPlayed = (s: Sheet): number => s.filter((v) => v !== null).length

/** The sheet is done after `rounds` turns (a match can be shorter than the nine rows). */
export const full = (s: Sheet, rounds: number = NCATS): boolean => turnsPlayed(s) >= rounds

export const openRows = (s: Sheet): number[] => s.flatMap((v, i) => (v === null ? [i] : []))
