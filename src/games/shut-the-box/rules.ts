/**
 * Pure Shut the Box rules. Each player has nine tiles (1..9). A roll of two
 * dice (one die once 7, 8 and 9 are all shut) must be matched exactly by
 * shutting open tiles; if no open tiles can make the roll, the turn ends and the
 * score is the sum of the open tiles. Shutting every tile wins on the spot.
 *
 * A box is a bitmask of OPEN tiles: bit i is tile i + 1.
 */

export const TILES = 9
export const ALL_OPEN = (1 << TILES) - 1
/** Tiles 7, 8 and 9: while any of them is open, the roll uses two dice. */
const HIGH_TILES = (1 << 6) | (1 << 7) | (1 << 8)

/** The bit for tile number `n` (1..9). */
export const tileBit = (n: number): number => 1 << (n - 1)

/** Sum of the tile numbers in a mask (the score of an open box, or the total of a set of tiles). */
export function sumOf(mask: number): number {
  let s = 0
  for (let i = 0; i < TILES; i++) if (mask & (1 << i)) s += i + 1
  return s
}

export const countOf = (mask: number): number => {
  let n = 0
  for (let i = 0; i < TILES; i++) if (mask & (1 << i)) n++
  return n
}

/** Dice rolled from this box: two, or one once 7, 8 and 9 are all shut. */
export const diceCount = (open: number): 1 | 2 => ((open & HIGH_TILES) === 0 ? 1 : 2)

/** Every outcome of a roll with this many dice, with its probability. */
export function rollOutcomes(n: 1 | 2): { total: number; p: number }[] {
  if (n === 1) return [1, 2, 3, 4, 5, 6].map((total) => ({ total, p: 1 / 6 }))
  const counts = new Map<number, number>()
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++) counts.set(a + b, (counts.get(a + b) ?? 0) + 1)
  return [...counts].map(([total, c]) => ({ total, p: c / 36 }))
}

/** Every non-empty set of open tiles that adds up to `total` exactly. */
export function subsetsSumming(open: number, total: number): number[] {
  const out: number[] = []
  for (let s = open; s > 0; s = (s - 1) & open) if (sumOf(s) === total) out.push(s)
  return out
}

export const canShut = (open: number, total: number): boolean =>
  subsetsSumming(open, total).length > 0

let table: Float64Array | null = null

/**
 * Expected final score from a box (open tiles) under the best play: a
 * single-player expectimax, minimising the score. Computed once for all 512
 * boxes; a box only ever loses tiles, so smaller masks are filled first.
 */
export function expectedFinal(open: number): number {
  if (!table) table = buildTable()
  return table[open] ?? 0
}

function buildTable(): Float64Array {
  const E = new Float64Array(ALL_OPEN + 1)
  for (let open = 1; open <= ALL_OPEN; open++) {
    let e = 0
    for (const { total, p } of rollOutcomes(diceCount(open))) {
      let best = Infinity
      for (const s of subsetsSumming(open, total)) best = Math.min(best, E[open ^ s] ?? 0)
      e += p * (best === Infinity ? sumOf(open) : best)
    }
    E[open] = e
  }
  return E
}

/** The shut options for a roll, each with the expected final score it leaves. */
export function options(open: number, total: number): { mask: number; value: number }[] {
  return subsetsSumming(open, total).map((mask) => ({ mask, value: expectedFinal(open ^ mask) }))
}

/**
 * Plays one whole turn with `choose` picking the tiles (or null when stuck).
 * Used by the tests and the bot-vs-bot checks; the game screen does the same
 * steps one tap at a time.
 */
export function playTurn(
  open0: number,
  roll: (n: 1 | 2) => number,
  choose: (open: number, total: number) => number | null,
): { open: number; score: number; shutAll: boolean; rolls: number } {
  let open = open0
  let rolls = 0
  for (;;) {
    const total = roll(diceCount(open))
    rolls++
    const mask = choose(open, total)
    if (mask === null) return { open, score: sumOf(open), shutAll: false, rolls }
    if (!mask || sumOf(mask) !== total || (open & mask) !== mask) throw new Error('bad shut')
    open &= ~mask
    if (open === 0) return { open, score: 0, shutAll: true, rolls }
  }
}
