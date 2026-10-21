import type { Side } from '../../core/game.ts'

/** Pure Memory rules over plain arrays. Everything here is unit-tested. */

export const COLS = 4
export const ROWS = 6
export const PAIRS = (COLS * ROWS) / 2

export interface Table {
  /** Pair id at each position. */
  deck: number[]
  faceUp: boolean[]
  owner: (Side | null)[]
  /** Positions turned this turn (0, 1 or 2). */
  up: number[]
}

export function newTable(deck: number[]): Table {
  return { deck, faceUp: deck.map(() => false), owner: deck.map(() => null), up: [] }
}

export function canTurn(t: Table, i: number): boolean {
  return i >= 0 && i < t.deck.length && t.owner[i] === null && !t.faceUp[i] && t.up.length < 2
}

/**
 * Turn a card up. Returns 'match' or 'miss' once two are up, otherwise null.
 * On a match the pair belongs to `side` and the turn's picks are cleared; on a
 * miss both stay up until `hideMiss`.
 */
export function turnUp(t: Table, i: number, side: Side): 'match' | 'miss' | null {
  if (!canTurn(t, i)) throw new Error(`Card ${i} cannot be turned`)
  t.faceUp[i] = true
  t.up.push(i)
  if (t.up.length < 2) return null
  const [a, b] = t.up as [number, number]
  if (t.deck[a] === t.deck[b]) {
    t.owner[a] = side
    t.owner[b] = side
    t.up = []
    return 'match'
  }
  return 'miss'
}

export function hideMiss(t: Table): void {
  for (const i of t.up) t.faceUp[i] = false
  t.up = []
}

export function pairsOf(t: Table, side: Side): number {
  return t.owner.filter((o) => o === side).length / 2
}

export function cleared(t: Table): boolean {
  return t.owner.every((o) => o !== null)
}
