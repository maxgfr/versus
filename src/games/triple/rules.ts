import type { Side } from '../../core/game.ts'

/**
 * Pure Triple rules over plain numbers. A card is an id 0..80 whose four traits
 * (count, shape, colour, fill) are each 0, 1 or 2. Three distinct cards form a
 * triple when every trait is all the same or all different, which is exactly
 * "the three values add up to a multiple of 3". Everything here is unit-tested.
 */

export const DECK_SIZE = 81
export const START_CARDS = 12
/** Table width in cards. Rows grow as cards are added. */
export const COLS = 4
export const TARGET = 6
/** Seconds a player is locked out after a wrong selection. */
export const LOCK_SECS = 2

/** The table: card id per slot, `null` for a slot the deck could not refill. */
export type Table = (number | null)[]

export interface Board {
  table: Table
  /** Undealt cards; the last one is dealt next. */
  deck: number[]
  /** Slots each side has selected, at most three. */
  sel: [number[], number[]]
  score: [number, number]
  /** Game time until which each side is locked out (-1 = free). */
  lockUntil: [number, number]
}

export type Tap =
  | { kind: 'ignored' }
  | { kind: 'select' }
  | { kind: 'deselect' }
  | {
      kind: 'valid'
      slots: number[]
      added: number[]
      /**
       * Set when the table closed up instead of being refilled: the old slot of
       * each card now on the table (new index → old index).
       */
      moved: number[] | null
    }
  | { kind: 'invalid'; slots: number[] }

/** The four trait values of card `id`: count, shape, colour, fill (each 0..2). */
export function traits(id: number): [number, number, number, number] {
  return [Math.floor(id / 27) % 3, Math.floor(id / 9) % 3, Math.floor(id / 3) % 3, id % 3]
}

/** True when three distinct cards form a triple: every trait all same or all different. */
export function isTriple(a: number, b: number, c: number): boolean {
  if (a === b || b === c || a === c) return false
  const ta = traits(a)
  const tb = traits(b)
  const tc = traits(c)
  return ta.every((v, i) => (v + (tb[i] ?? 0) + (tc[i] ?? 0)) % 3 === 0)
}

const idAt = (t: Table, slot: number): number | null => t[slot] ?? null

/** Every triple on the table, as slot indices in ascending order. */
export function findSets(t: Table): [number, number, number][] {
  const out: [number, number, number][] = []
  for (let i = 0; i < t.length; i++) {
    for (let j = i + 1; j < t.length; j++) {
      for (let k = j + 1; k < t.length; k++) {
        const a = idAt(t, i)
        const b = idAt(t, j)
        const c = idAt(t, k)
        if (a !== null && b !== null && c !== null && isTriple(a, b, c)) out.push([i, j, k])
      }
    }
  }
  return out
}

export function hasSet(t: Table): boolean {
  return findSets(t).length > 0
}

function draw(deck: number[]): number | null {
  return deck.pop() ?? null
}

/** Deal the opening table from a shuffled deck, then add cards until a triple is in view. */
export function newBoard(deck: number[]): Board {
  const b: Board = { table: [], deck, sel: [[], []], score: [0, 0], lockUntil: [-1, -1] }
  for (let i = 0; i < START_CARDS; i++) b.table.push(draw(b.deck))
  topUp(b)
  return b
}

/**
 * Add three cards at a time while the table holds no triple and the deck has
 * cards left. Returns the slots that were appended.
 */
export function topUp(b: Board): number[] {
  const added: number[] = []
  while (!hasSet(b.table) && b.deck.length > 0) {
    for (let i = 0; i < 3; i++) {
      const c = draw(b.deck)
      if (c === null) break
      b.table.push(c)
      added.push(b.table.length - 1)
    }
  }
  return added
}

/**
 * One side taps a slot. Selecting the third card checks the triple: a valid one
 * scores a point and deals new cards into the same slots; an invalid one costs
 * a point and locks that side out for `LOCK_SECS`.
 */
export function tapSlot(b: Board, side: Side, slot: number, now: number): Tap {
  if (idAt(b.table, slot) === null) return { kind: 'ignored' }
  if (now < b.lockUntil[side]) return { kind: 'ignored' }
  const mine = b.sel[side]
  if (mine.includes(slot)) {
    b.sel[side] = mine.filter((s) => s !== slot)
    return { kind: 'deselect' }
  }
  if (mine.length >= 3) return { kind: 'ignored' }
  b.sel[side] = [...mine, slot]
  if (b.sel[side].length < 3) return { kind: 'select' }

  const slots = [...b.sel[side]]
  const ids = slots.map((s) => idAt(b.table, s) ?? -1)
  const [x, y, z] = ids as [number, number, number]
  if (!isTriple(x, y, z)) {
    b.score[side]--
    b.lockUntil[side] = now + LOCK_SECS
    b.sel[side] = []
    return { kind: 'invalid', slots }
  }
  b.score[side]++
  b.sel[side] = []
  for (const other of [0, 1] as Side[]) {
    // Replaced cards take their selections with them.
    b.sel[other] = b.sel[other].filter((s) => !slots.includes(s))
  }
  // A table grown past twelve (or a deck run dry) closes up instead of being
  // refilled, so it shrinks back to twelve cards rather than growing forever.
  const cards = b.table.filter((c) => c !== null).length
  if (b.deck.length === 0 || cards - 3 >= START_CARDS) {
    const moved = b.table.map((_, i) => i).filter((i) => !slots.includes(i) && b.table[i] !== null)
    const at = new Map(moved.map((old, i) => [old, i]))
    b.table = moved.map((i) => b.table[i] ?? null)
    for (const other of [0, 1] as Side[]) b.sel[other] = b.sel[other].map((s) => at.get(s) ?? s)
    return { kind: 'valid', slots, added: topUp(b), moved }
  }
  for (const s of slots) b.table[s] = draw(b.deck)
  return { kind: 'valid', slots, added: topUp(b), moved: null }
}

/**
 * The game's result once decided: a side at `target` points (the match length
 * the players chose), or the table dried up.
 */
export function winner(b: Board, target = TARGET): Side | 'draw' | null {
  const [r, bl] = b.score
  const done = r >= target || bl >= target || (b.deck.length === 0 && !hasSet(b.table))
  if (!done) return null
  return r === bl ? 'draw' : r > bl ? 0 : 1
}
