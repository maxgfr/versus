import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Pure Find Match rules: the projective-plane deck (order 7), card layouts, and
 * the race. Any two cards of the deck share exactly one symbol.
 */

/** Order of the projective plane: 7 + 1 = 8 symbols per card, 57 cards, 57 symbols. */
export const ORDER = 7
/** Points awarded before the match is decided. */
export const TARGET = 10
/** Seconds a side is frozen after a wrong symbol. */
export const FREEZE = 1
/** Card radius, in world units (cards are round, as in Spot-it). */
export const CARD_R = 240

/** 57 distinct symbols: index = point of the plane. */
export const SYMBOLS: readonly string[] = [
  '🐶',
  '🐱',
  '🐭',
  '🐰',
  '🦊',
  '🐻',
  '🐼',
  '🐨',
  '🐯',
  '🦁',
  '🐮',
  '🐷',
  '🐸',
  '🐵',
  '🐔',
  '🐧',
  '🐙',
  '🦄',
  '🍎',
  '🍌',
  '🍇',
  '🍓',
  '🍒',
  '🍑',
  '🍍',
  '🥝',
  '🍉',
  '🍋',
  '🥥',
  '🫐',
  '🍕',
  '🍔',
  '🌭',
  '🍟',
  '🌮',
  '🍩',
  '🍪',
  '🧁',
  '🍦',
  '🍰',
  '🥨',
  '🍿',
  '⚽',
  '🏀',
  '🎸',
  '🚀',
  '🎈',
  '🎁',
  '⭐',
  '🌈',
  '🔑',
  '🎲',
  '🪁',
  '🧸',
  '🌵',
  '🍄',
  '🎂',
]

/** A symbol placed on a card: card-local position, radius, and rotation. */
export interface Item {
  /** Symbol index (0-56). */
  s: number
  x: number
  y: number
  /** Visible radius. */
  r: number
  /** Rotation, radians. */
  a: number
}

/** A dealt card: which deck line it is, and where its symbols sit. */
export interface Layout {
  line: number
  items: Item[]
}

/**
 * The lines of PG(2, n): one per card, holding the n + 1 symbols (points) it
 * contains. Points are the normalised non-zero triples over GF(n); a point lies
 * on a line when their dot product is 0 mod n.
 */
export function projectivePlane(n = ORDER): number[][] {
  const points: number[][] = []
  for (let x = 0; x < n; x++)
    for (let y = 0; y < n; y++)
      for (let z = 0; z < n; z++) {
        if (x === 0 && y === 0 && z === 0) continue
        // Normalised: the first non-zero coordinate is 1.
        const lead = x !== 0 ? x : y !== 0 ? y : z
        if (lead === 1) points.push([x, y, z])
      }
  return points.map((l) =>
    points.flatMap((p, i) =>
      ((l[0] ?? 0) * (p[0] ?? 0) + (l[1] ?? 0) * (p[1] ?? 0) + (l[2] ?? 0) * (p[2] ?? 0)) % n === 0
        ? [i]
        : [],
    ),
  )
}

/** The whole deck: 57 cards of 8 symbols each. */
export const DECK: readonly number[][] = projectivePlane(ORDER)

/** The symbol two cards share (exactly one, for distinct cards), or -1. */
export function shared(a: readonly number[], b: readonly number[]): number {
  return a.find((s) => b.includes(s)) ?? -1
}

const SYMBOL_RADIUS: [number, number] = [46, 60]

/**
 * Scatter the card's symbols on the disc at random sizes and rotations without
 * overlaps. Each symbol is tried at random spots; if the disc is too crowded the
 * symbols shrink a little and it tries again.
 */
export function layoutCard(rng: Rng, line: number): Layout {
  const syms = DECK[line] ?? []
  let base = SYMBOL_RADIUS[1]
  for (let attempt = 0; attempt < 40; attempt++) {
    const items: Item[] = []
    let ok = true
    for (const s of syms) {
      const r = rng.range(SYMBOL_RADIUS[0], base)
      let placed: Item | null = null
      for (let t = 0; t < 400 && !placed; t++) {
        const reach = CARD_R - r - 12
        const ang = rng.range(0, Math.PI * 2)
        const dist = reach * Math.sqrt(rng.next())
        const x = Math.cos(ang) * dist
        const y = Math.sin(ang) * dist
        const clear = items.every((o) => Math.hypot(o.x - x, o.y - y) >= o.r + r + 12)
        if (clear) placed = { s, x, y, r, a: rng.range(0, Math.PI * 2) }
      }
      if (!placed) {
        ok = false
        break
      }
      items.push(placed)
    }
    if (ok) return { line, items }
    base = Math.max(SYMBOL_RADIUS[0], base - 3)
  }
  throw new Error('card layout failed')
}

/** The symbol under card-local point (x, y), or -1. Generous: fingers are not precise. */
export function symbolAt(l: Layout, x: number, y: number): number {
  let best = -1
  let bestD = Infinity
  for (const it of l.items) {
    const d = Math.hypot(it.x - x, it.y - y)
    if (d <= it.r + 14 && d < bestD) {
      best = it.s
      bestD = d
    }
  }
  return best
}

export interface FindState {
  /** Deck lines not yet dealt, in order. */
  queue: number[]
  /** The shared card in the middle. */
  centre: Layout
  /** Each side's own card. */
  own: [Layout, Layout]
  score: [number, number]
  /** Side locked out until this time (-1 none). */
  frozen: [number, number]
  /** Game time each side's card last came up (for the pop-in). */
  dealAt: [number, number]
  /** Game time the centre card last changed, and whose card it was (-1 / null before any). */
  flyAt: number
  flySide: Side | null
  /** Last tap per side: when, the symbol it hit, and whether it was right (1 hit, 0 miss, -1 none). */
  tapAt: [number, number]
  tapSym: [number, number]
  tapKind: [number, number]
}

export function newFind(rng: Rng, now: number): FindState {
  const order = rng.shuffle([...DECK.keys()])
  const queue = order.slice(3)
  return {
    queue,
    centre: layoutCard(rng, order[0] ?? 0),
    own: [layoutCard(rng, order[1] ?? 1), layoutCard(rng, order[2] ?? 2)],
    score: [0, 0],
    frozen: [-1, -1],
    dealAt: [now, now],
    flyAt: -1,
    flySide: null,
    tapAt: [-10, -10],
    tapSym: [-1, -1],
    tapKind: [-1, -1],
  }
}

/** The symbol `side` has to find right now. */
export function target(s: FindState, side: Side): number {
  return shared(DECK[s.own[side].line] ?? [], DECK[s.centre.line] ?? [])
}

export type Tap = 'hit' | 'miss' | 'ignored'

/**
 * A side taps symbol `sym` on its card. The right one: +1, its card becomes the
 * centre and a new card is dealt to it. Any other: a second of lock-out.
 */
export function tap(s: FindState, side: Side, sym: number, now: number, rng: Rng): Tap {
  if (sym < 0) return 'ignored'
  if (s.frozen[side] >= 0 && now < s.frozen[side]) return 'ignored'
  s.tapAt[side] = now
  s.tapSym[side] = sym
  if (sym !== target(s, side)) {
    s.frozen[side] = now + FREEZE
    s.tapKind[side] = 0
    return 'miss'
  }
  s.score[side]++
  s.tapKind[side] = 1
  s.centre = s.own[side]
  s.flyAt = now
  s.flySide = side
  s.own[side] = nextCard(s, rng, side, now)
  return 'hit'
}

/** Deal `side` the next card from the queue (distinct from both visible cards by construction). */
function nextCard(s: FindState, rng: Rng, side: Side, now: number): Layout {
  s.dealAt[side] = now
  const line = s.queue.shift()
  if (line !== undefined) return layoutCard(rng, line)
  // Only reached if a match runs past the whole deck: pick any other card.
  let pick = 0
  const other = s.own[side === 0 ? 1 : 0].line
  while (pick === s.centre.line || pick === other) pick++
  return layoutCard(rng, pick)
}

export function champion(s: FindState, target = TARGET): Side | null {
  if (s.score[0] >= target) return 0
  if (s.score[1] >= target) return 1
  return null
}
