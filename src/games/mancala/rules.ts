import { other, type Side } from '../../core/game.ts'

/**
 * Pure rules for Kalah, the mancala game. Positions 0-5 are red's pits, left to
 * right along the bottom row; position 6 is red's store, on red's right. Positions
 * 7-12 are blue's pits (7 is the top-right pit), and 13 is blue's store on blue's
 * right. Seeds always move to the next position, skipping the rival's store.
 */

export const STORE: readonly [number, number] = [6, 13]
export const START_SEEDS = 4

export interface Position {
  turn: Side
  /** 14 positions: 6 pits, store, 6 pits, store. */
  pits: number[]
}

export interface Settled {
  pits: number[]
  /** The last seed landed in the mover's store: the mover plays again. */
  again: boolean
  /** Seeds moved into the mover's store by a capture. */
  captured: number
  /** A side ran out of seeds: the rest of the seeds went home and the game is over. */
  over: boolean
}

export function startPosition(turn: Side): Position {
  const pits = Array<number>(14).fill(START_SEEDS)
  pits[6] = 0
  pits[13] = 0
  return { turn, pits }
}

export function isStore(i: number): boolean {
  return i === 6 || i === 13
}

/** The side a position belongs to: 0 for 0-6, 1 for 7-13. */
export function ownerOf(i: number): Side {
  return i <= 6 ? 0 : 1
}

/** The pit facing pit `i` across the board (pits only). */
export function opposite(i: number): number {
  return 12 - i
}

/** The position a seed sown from `pos` by `side` lands in next. */
export function nextPos(pos: number, side: Side): number {
  let p = (pos + 1) % 14
  if (p === STORE[other(side)]) p = (p + 1) % 14
  return p
}

/** Where each of `seeds` seeds lands, one by one, when sown from `pit` by `side`. */
export function sowPath(side: Side, pit: number, seeds: number): number[] {
  const path: number[] = []
  let p = pit
  for (let k = 0; k < seeds; k++) {
    p = nextPos(p, side)
    path.push(p)
  }
  return path
}

export function sideEmpty(pits: readonly number[], side: Side): boolean {
  const from = side === 0 ? 0 : 7
  for (let i = from; i < from + 6; i++) if ((pits[i] ?? 0) > 0) return false
  return true
}

/** One side has no seeds left: the game ends once the move is settled. */
export function isOver(pits: readonly number[]): boolean {
  return sideEmpty(pits, 0) || sideEmpty(pits, 1)
}

/** Pits of `side` that hold seeds. */
export function legalPits(p: Position): number[] {
  const from = p.turn === 0 ? 0 : 7
  const out: number[] = []
  for (let i = from; i < from + 6; i++) if ((p.pits[i] ?? 0) > 0) out.push(i)
  return out
}

/**
 * What happens once the last seed of a move lands at `last`: an extra turn if
 * it reached the mover's store, a capture if it landed alone in an empty pit on
 * the mover's side, and the end of the game (rest of the seeds home) if a side
 * is empty.
 */
export function settle(pits: readonly number[], mover: Side, last: number): Settled {
  const p = pits.slice()
  const store = STORE[mover]
  let again = false
  let captured = 0
  if (last === store) again = true
  else if (ownerOf(last) === mover && !isStore(last) && p[last] === 1) {
    const opp = opposite(last)
    if ((p[opp] ?? 0) > 0) {
      captured = 1 + (p[opp] ?? 0)
      p[store] = (p[store] ?? 0) + captured
      p[last] = 0
      p[opp] = 0
    }
  }
  const over = isOver(p)
  if (over) {
    for (const side of [0, 1] as const) {
      const from = side === 0 ? 0 : 7
      let sum = 0
      for (let i = from; i < from + 6; i++) {
        sum += p[i] ?? 0
        p[i] = 0
      }
      p[STORE[side]] = (p[STORE[side]] ?? 0) + sum
    }
    again = false
  }
  return { pits: p, again, captured, over }
}

/** Play pit `pit` for the side to move. Throws on an empty or rival pit. */
export function apply(pos: Position, pit: number): Position {
  if (!legalPits(pos).includes(pit)) throw new Error(`Pit ${pit} cannot be played`)
  const pits = pos.pits.slice()
  const seeds = pits[pit] ?? 0
  pits[pit] = 0
  const path = sowPath(pos.turn, pit, seeds)
  for (const p of path) pits[p] = (pits[p] ?? 0) + 1
  const r = settle(pits, pos.turn, path[path.length - 1] ?? pit)
  return { turn: r.again ? pos.turn : other(pos.turn), pits: r.pits }
}

/** The result once the game is over: the bigger store wins. */
export function verdict(pos: Position): { winner: Side | 'draw'; score: [number, number] } | null {
  if (!isOver(pos.pits)) return null
  const a = pos.pits[6] ?? 0
  const b = pos.pits[13] ?? 0
  return { winner: a === b ? 'draw' : a > b ? 0 : 1, score: [a, b] }
}
