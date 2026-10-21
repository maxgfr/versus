import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { canTurn, type Table } from './rules.ts'

/** Chance the computer remembers a card it has just seen. */
export const RECALL: Record<Difficulty, number> = { easy: 0.3, normal: 0.65, hard: 1 }

/**
 * The computer's memory: pair id it believes sits at each position (null =
 * never noticed). It only ever learns from cards that were face up.
 */
export type Memory = (number | null)[]

export function remember(
  mem: Memory,
  i: number,
  pairId: number,
  difficulty: Difficulty,
  rng: Rng,
): void {
  if (rng.chance(RECALL[difficulty])) mem[i] = pairId
}

/** Next card to turn: complete a known pair, else explore an unseen card. */
export function choose(t: Table, mem: Memory, rng: Rng): number {
  const open = t.deck.flatMap((_, i) => (canTurn(t, i) ? [i] : []))
  const known = (i: number) => mem[i] !== null && mem[i] !== undefined
  const first = t.up[0]
  if (first !== undefined) {
    const id = t.deck[first]
    const partner = open.find((i) => known(i) && mem[i] === id)
    if (partner !== undefined) return partner
  } else {
    // A pair it remembers both halves of.
    for (const i of open) {
      if (!known(i)) continue
      const j = open.find((k) => k !== i && known(k) && mem[k] === mem[i])
      if (j !== undefined) return i
    }
  }
  const unseen = open.filter((i) => !known(i))
  return rng.pick(unseen.length ? unseen : open)
}
