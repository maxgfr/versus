import { Rng } from '../../core/rng.ts'

/**
 * Pure Klondike (draw one, unlimited recycling of the stock). A card is a code
 * 0..51: suit = floor(code / 13) (0 ♠, 1 ♥, 2 ♦, 3 ♣), rank = code % 13 + 1
 * (1 = ace … 13 = king). Each tableau column lists its cards bottom first; the
 * first `down[col]` of them are face down.
 */

export const COLUMNS = 7
export const CARDS = 52
export const SUITS = ['♠', '♥', '♦', '♣'] as const

export const suitOf = (card: number): number => Math.floor(card / 13)
export const rankOf = (card: number): number => (card % 13) + 1
export const isRed = (card: number): boolean => suitOf(card) === 1 || suitOf(card) === 2

export interface Deal {
  tab: number[][]
  down: number[]
  /** Face-down pile; the next card to draw is the last element. */
  stock: number[]
  waste: number[]
  /** Per suit, the rank built up to on its foundation (0 = empty, 13 = done). */
  found: number[]
}

/** The same deal on both halves: the shuffle comes from the seed. */
export function deal(seed: number): Deal {
  const deck = new Rng(seed).shuffle(Array.from({ length: CARDS }, (_, i) => i))
  const tab: number[][] = []
  const down: number[] = []
  let p = 0
  for (let c = 0; c < COLUMNS; c++) {
    tab.push(deck.slice(p, p + c + 1))
    down.push(c)
    p += c + 1
  }
  return { tab, down, stock: deck.slice(p).reverse(), waste: [], found: [0, 0, 0, 0] }
}

export function cloneDeal(d: Deal): Deal {
  return {
    tab: d.tab.map((col) => col.slice()),
    down: d.down.slice(),
    stock: d.stock.slice(),
    waste: d.waste.slice(),
    found: d.found.slice(),
  }
}

/** Cards on foundations. */
export const home = (d: Deal): number => d.found.reduce((a, b) => a + b, 0)

/** Something picked on the table: the top of the waste, or a card (and those above it) in a column. */
export type Src = { from: 'waste' } | { from: 'tab'; col: number; idx: number }
export type Dst = { to: 'found'; suit: number } | { to: 'tab'; col: number }

/** Can `card` sit on `top` in a column? Empty columns take kings only. */
export function stacks(card: number, top: number | undefined): boolean {
  if (top === undefined) return rankOf(card) === 13
  return rankOf(top) === rankOf(card) + 1 && isRed(top) !== isRed(card)
}

/** The cards a source moves: one for the waste, the run from `idx` to the top of a column. */
export function run(d: Deal, src: Src): number[] {
  if (src.from === 'waste') return d.waste.length ? [d.waste[d.waste.length - 1] as number] : []
  if (src.idx < (d.down[src.col] ?? 0) || src.idx >= (d.tab[src.col]?.length ?? 0)) return []
  return (d.tab[src.col] ?? []).slice(src.idx)
}

/** Is the card under `src` face up, and does it reveal a hidden card when it leaves? */
export function reveals(d: Deal, src: Src): boolean {
  return src.from === 'tab' && src.idx === d.down[src.col] && src.idx > 0
}

/**
 * Where a tap on `src` sends its card(s): the foundation first (single cards
 * only), then a column that takes it. Columns that already hold cards come
 * before empty ones. Null when nothing is legal.
 */
export function destinationFor(d: Deal, src: Src): Dst | null {
  const cards = run(d, src)
  if (!cards.length) return null
  const first = cards[0] as number
  if (cards.length === 1) {
    const suit = suitOf(first)
    if ((d.found[suit] ?? 0) === rankOf(first) - 1) return { to: 'found', suit }
  }
  let empty: number | null = null
  for (let c = 0; c < COLUMNS; c++) {
    if (src.from === 'tab' && c === src.col) continue
    const col = d.tab[c] ?? []
    if (col.length === 0) {
      // Moving a whole column onto an empty one changes nothing.
      if (empty === null && stacks(first, undefined) && !(src.from === 'tab' && src.idx === 0))
        empty = c
      continue
    }
    if (stacks(first, col[col.length - 1])) return { to: 'tab', col: c }
  }
  return empty === null ? null : { to: 'tab', col: empty }
}

/**
 * Is dropping `src` on `dst` legal? A foundation takes a single card of its
 * suit and next rank; a column takes a run whose first card stacks on its top
 * (kings only on an empty one). A card never drops back onto its own column.
 */
export function canDrop(d: Deal, src: Src, dst: Dst): boolean {
  const cards = run(d, src)
  if (!cards.length) return false
  const first = cards[0] as number
  if (dst.to === 'found') {
    return (
      cards.length === 1 &&
      suitOf(first) === dst.suit &&
      (d.found[dst.suit] ?? 0) === rankOf(first) - 1
    )
  }
  if (dst.col < 0 || dst.col >= COLUMNS) return false
  if (src.from === 'tab' && src.col === dst.col) return false
  const col = d.tab[dst.col] ?? []
  // A whole column onto an empty one changes nothing.
  if (!col.length && src.from === 'tab' && src.idx === 0) return false
  return stacks(first, col[col.length - 1])
}

/** Every legal column a source can go to (foundations aside). */
function tabDests(d: Deal, src: Src): number[] {
  const out: number[] = []
  for (let c = 0; c < COLUMNS; c++) if (canDrop(d, src, { to: 'tab', col: c })) out.push(c)
  return out
}

/** Can `card` go to its foundation, or onto some column, on this table? */
function placeable(d: Deal, card: number): boolean {
  if ((d.found[suitOf(card)] ?? 0) === rankOf(card) - 1) return true
  for (let c = 0; c < COLUMNS; c++) {
    const col = d.tab[c] ?? []
    if (stacks(card, col[col.length - 1])) return true
  }
  return false
}

/**
 * A move that makes lasting progress: a card home, a hidden card turned up, or
 * a card out of the deck (draw one with unlimited recycling: every stock and
 * waste card comes up again sooner or later).
 */
function productive(d: Deal): boolean {
  for (const card of d.stock) if (placeable(d, card)) return true
  for (const card of d.waste) if (placeable(d, card)) return true
  for (let c = 0; c < COLUMNS; c++) {
    const col = d.tab[c] ?? []
    const top = col[col.length - 1]
    if (top !== undefined && (d.found[suitOf(top)] ?? 0) === rankOf(top) - 1) return true
    const down = d.down[c] ?? 0
    if (down > 0 && down < col.length && tabDests(d, { from: 'tab', col: c, idx: down }).length)
      return true
  }
  return false
}

/**
 * No move can ever make progress again: whatever runs the player shuffles
 * between columns, no card can go home, no hidden card can turn up and no deck
 * card can come out. Exact: it searches every arrangement of the face-up runs
 * (the only moves that are left), up to `limit` positions (beyond that it
 * assumes there is a way out).
 */
export function stuck(d: Deal, limit = 3000): boolean {
  if (home(d) === CARDS) return false
  const seen = new Set<string>()
  const queue: Deal[] = [d]
  seen.add(d.tab.join('|'))
  while (queue.length) {
    const cur = queue.shift() as Deal
    if (productive(cur)) return false
    for (let c = 0; c < COLUMNS; c++) {
      const col = cur.tab[c] ?? []
      for (let idx = cur.down[c] ?? 0; idx < col.length; idx++) {
        const src: Src = { from: 'tab', col: c, idx }
        for (const to of tabDests(cur, src)) {
          const n = apply(cur, src, { to: 'tab', col: to })
          const key = n.tab.join('|')
          if (seen.has(key)) continue
          if (seen.size >= limit) return false
          seen.add(key)
          queue.push(n)
        }
      }
    }
  }
  return true
}

/** Move the card(s) from `src` to `dst`. The source is not changed. */
export function apply(d: Deal, src: Src, dst: Dst): Deal {
  const n = cloneDeal(d)
  let moved: number[]
  if (src.from === 'waste') {
    moved = [n.waste.pop() as number]
  } else {
    moved = (n.tab[src.col] ?? []).splice(src.idx)
    if ((n.down[src.col] ?? 0) > 0 && n.down[src.col] === (n.tab[src.col] ?? []).length) {
      n.down[src.col] = (n.down[src.col] ?? 1) - 1
    }
  }
  if (dst.to === 'found') n.found[dst.suit] = rankOf(moved[0] as number)
  else (n.tab[dst.col] ?? []).push(...moved)
  return n
}

/** Turn over the next card, or turn the waste back into the stock. Null when both are empty. */
export function draw(d: Deal): Deal | null {
  const n = cloneDeal(d)
  if (n.stock.length) {
    n.waste.push(n.stock.pop() as number)
    return n
  }
  if (n.waste.length) {
    n.stock = n.waste.slice().reverse()
    n.waste = []
    return n
  }
  return null
}

/** Every card that can be picked up right now (face-up cards, and the waste top). */
export function pickable(d: Deal): Src[] {
  const out: Src[] = []
  if (d.waste.length) out.push({ from: 'waste' })
  for (let c = 0; c < COLUMNS; c++) {
    const col = d.tab[c] ?? []
    for (let i = d.down[c] ?? 0; i < col.length; i++) out.push({ from: 'tab', col: c, idx: i })
  }
  return out
}
