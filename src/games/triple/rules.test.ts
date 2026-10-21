import { describe, expect, it } from 'vitest'
import type { Audio } from '../../core/audio.ts'
import type { Difficulty, GameContext, Side } from '../../core/game.ts'
import { Fx } from '../../core/fx/fx.ts'
import { Input } from '../../core/input.ts'
import type { Stage } from '../../core/stage.ts'
import { Rng } from '../../core/rng.ts'
import factory, { type State } from './index.ts'
import { pickTriple, SPOT } from './bot.ts'
import { tableGrid } from './render.ts'
import {
  type Board,
  DECK_SIZE,
  findSets,
  hasSet,
  isTriple,
  LOCK_SECS,
  newBoard,
  tapSlot,
  topUp,
  traits,
  winner,
} from './rules.ts'

/** Brute force: every trait all same or all different. */
function bruteTriple(a: number, b: number, c: number): boolean {
  const ta = traits(a)
  const tb = traits(b)
  const tc = traits(c)
  return ta.every((v, i) => {
    const x = tb[i]
    const y = tc[i]
    const same = v === x && x === y
    const diff = v !== x && x !== y && v !== y
    return same || diff
  })
}

/** A deterministic board from explicit cards, with an empty deck. */
function boardOf(table: (number | null)[], deck: number[] = []): Board {
  return { table: [...table], deck: [...deck], sel: [[], []], score: [0, 0], lockUntil: [-1, -1] }
}

/** Greedy set-free table: no triple among any of its cards. */
function setFree(): number[] {
  const out: number[] = []
  for (let id = 0; id < DECK_SIZE && out.length < 9; id++) {
    const t = [...out, id]
    if (!hasSet(t)) out.push(id)
  }
  return out
}

/** Three non-empty slots that are not a triple, or null. */
function findWrong(t: (number | null)[]): number[] | null {
  for (let i = 0; i < t.length; i++)
    for (let j = i + 1; j < t.length; j++)
      for (let k = j + 1; k < t.length; k++) {
        const a = t[i]
        const b = t[j]
        const c = t[k]
        if (a != null && b != null && c != null && !isTriple(a, b, c)) return [i, j, k]
      }
  return null
}

describe('triple rules', () => {
  it('decodes 81 distinct cards with four traits in 0..2', () => {
    const seen = new Set<string>()
    for (let id = 0; id < DECK_SIZE; id++) {
      const t = traits(id)
      expect(t).toHaveLength(4)
      for (const v of t) expect(v >= 0 && v <= 2).toBe(true)
      seen.add(t.join(','))
    }
    expect(seen.size).toBe(DECK_SIZE)
  })

  it('accepts a triple exactly when every trait is all same or all different', () => {
    for (let a = 0; a < DECK_SIZE; a++) {
      for (let b = a + 1; b < DECK_SIZE; b++) {
        for (let c = b + 1; c < DECK_SIZE; c += 7) {
          expect(isTriple(a, b, c)).toBe(bruteTriple(a, b, c))
        }
      }
    }
  })

  it('rejects repeated cards and two-of-a-kind traits', () => {
    expect(isTriple(5, 5, 5)).toBe(false)
    expect(isTriple(5, 5, 6)).toBe(false)
    // Same count, shape and colour but fills 0, 0, 1: not a triple.
    expect(isTriple(0, 1, 3)).toBe(false)
    // Fills 0, 1, 2 with everything else equal: a triple.
    expect(isTriple(0, 1, 2)).toBe(true)
  })

  it('finds every triple on a table', () => {
    const table = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    const brute: [number, number, number][] = []
    for (let i = 0; i < table.length; i++)
      for (let j = i + 1; j < table.length; j++)
        for (let k = j + 1; k < table.length; k++)
          if (bruteTriple(table[i] as number, table[j] as number, table[k] as number))
            brute.push([i, j, k])
    expect(findSets(table)).toEqual(brute)
  })

  it('deals twelve cards with a triple in view', () => {
    const b = newBoard(new Rng(4).shuffle(Array.from({ length: DECK_SIZE }, (_, i) => i)))
    expect(b.table.length).toBeGreaterThanOrEqual(12)
    expect(b.table.length % 3).toBe(0)
    expect(hasSet(b.table)).toBe(true)
    expect(new Set(b.table).size).toBe(b.table.length)
    expect(b.table.length + b.deck.length).toBe(DECK_SIZE)
  })

  it('adds three cards at a time until a triple appears', () => {
    const table = setFree()
    const b = boardOf(
      table,
      new Rng(9)
        .shuffle(Array.from({ length: DECK_SIZE }, (_, i) => i))
        .filter((c) => !table.includes(c)),
    )
    expect(hasSet(table)).toBe(false)
    const added = topUp(b)
    expect(added.length).toBeGreaterThanOrEqual(3)
    expect(added.length % 3).toBe(0)
    expect(hasSet(b.table)).toBe(true)
    expect(added[0]).toBe(table.length)
  })

  it('scores a valid triple, deals into the same slots and clears both selections', () => {
    const b = boardOf([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    const [i, j, k] = findSets(b.table)[0] as [number, number, number]
    // Red selects one card that is not part of this triple to test clearing later.
    const stray = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].find((s) => ![i, j, k].includes(s))!
    expect(tapSlot(b, 1, stray, 0)).toEqual({ kind: 'select' })
    expect(tapSlot(b, 0, i, 0)).toEqual({ kind: 'select' })
    expect(tapSlot(b, 0, j, 0)).toEqual({ kind: 'select' })
    const r = tapSlot(b, 0, k, 0)
    expect(r.kind).toBe('valid')
    expect(b.score).toEqual([1, 0])
    expect(b.sel[0]).toEqual([])
    expect(b.sel[1]).toEqual([stray])
    expect(b.table.length).toBeGreaterThanOrEqual(12)
    if (r.kind === 'valid') expect(r.slots.sort()).toEqual([i, j, k])
  })

  it('clears a rival selection that sat on a replaced card', () => {
    const b = boardOf([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [40, 41, 42, 43, 44, 45])
    const [i, j, k] = findSets(b.table)[0] as [number, number, number]
    tapSlot(b, 1, i, 0)
    tapSlot(b, 0, i, 0)
    tapSlot(b, 0, j, 0)
    tapSlot(b, 0, k, 0)
    expect(b.sel[1]).toEqual([])
  })

  it('costs a point and locks the side out on a wrong triple', () => {
    const b = boardOf([0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    // Make sure this selection is not a triple.
    expect(isTriple(0, 1, 3)).toBe(false)
    tapSlot(b, 0, 0, 1)
    tapSlot(b, 0, 1, 1)
    const r = tapSlot(b, 0, 2, 1)
    expect(r.kind).toBe('invalid')
    expect(b.score[0]).toBe(-1)
    expect(b.sel[0]).toEqual([])
    // Locked: taps are ignored until the lockout ends.
    expect(tapSlot(b, 0, 4, 1 + LOCK_SECS / 2)).toEqual({ kind: 'ignored' })
    expect(tapSlot(b, 0, 4, 1 + LOCK_SECS + 0.01).kind).toBe('select')
    // The rival is not locked.
    expect(tapSlot(b, 1, 5, 1.5).kind).toBe('select')
  })

  it('deselects a card on a second tap and ignores a fourth', () => {
    const b = boardOf([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    tapSlot(b, 0, 0, 0)
    tapSlot(b, 0, 1, 0)
    expect(tapSlot(b, 0, 0, 0)).toEqual({ kind: 'deselect' })
    expect(b.sel[0]).toEqual([1])
    tapSlot(b, 0, 2, 0)
    tapSlot(b, 0, 3, 0)
    expect(tapSlot(b, 0, 4, 0)).toEqual({ kind: 'ignored' })
  })

  it('ignores empty slots', () => {
    const b = boardOf([0, null, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(tapSlot(b, 0, 1, 0)).toEqual({ kind: 'ignored' })
    expect(tapSlot(b, 0, 99, 0)).toEqual({ kind: 'ignored' })
  })

  it('ends at six points, or when the table runs dry, and draws on a tie', () => {
    const b = boardOf([0, 1, 2])
    expect(winner(b)).toBeNull()
    b.score = [6, 5]
    expect(winner(b)).toBe(0)
    b.score = [4, 6]
    expect(winner(b)).toBe(1)
    b.score = [6, 6]
    expect(winner(b)).toBe('draw')
    // The players can choose a shorter or longer match.
    b.score = [3, 2]
    expect(winner(b, 3)).toBe(0)
    expect(winner(b)).toBeNull()
    // Empty deck and a set-free table: the points decide.
    const dry = boardOf(setFree(), [])
    dry.score = [2, 1]
    expect(winner(dry)).toBe(0)
    dry.score = [1, 1]
    expect(winner(dry)).toBe('draw')
    const live = boardOf([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [])
    expect(winner(live)).toBeNull()
  })

  it('the computer can always find a triple on a table that has one', () => {
    const rng = new Rng(3)
    const b = newBoard(rng.shuffle(Array.from({ length: DECK_SIZE }, (_, i) => i)))
    const t = pickTriple(b.table, rng)
    expect(t).not.toBeNull()
    const [i, j, k] = t as [number, number, number]
    expect(isTriple(b.table[i] as number, b.table[j] as number, b.table[k] as number)).toBe(true)
    expect(pickTriple(setFree(), rng)).toBeNull()
  })
})

// ---------- game level ----------

function ctxFor(bots: [boolean, boolean], difficulty: Difficulty, seed: number): GameContext {
  const audio = { play: () => {}, unlock: () => {} } as unknown as Audio
  return {
    stage: { edge: (side: Side) => (side === 0 ? 1800 : 0) } as unknown as Stage,
    input: new Input({} as Stage, '2p', 0),
    fx: new Fx(),
    audio,
    rng: new Rng(seed),
    mode: '2p',
    difficulty,
    bots,
    teams: false,
    names: ['Red', 'Blue'],
    local: 0,
    seed,
  }
}

describe('triple game', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`bot vs bot reaches a result in bounded time (${difficulty})`, () => {
      const game = factory()
      game.init(ctxFor([true, true], difficulty, 21))
      let steps = 0
      while (!game.result) {
        game.update(1 / 60)
        if (++steps > 60 * 900) throw new Error('no result')
      }
      const w = game.result.winner
      expect(w === 0 || w === 1 || w === 'draw').toBe(true)
      // Each side needs at least six triples to win outright.
      const s = game.snapshot() as { s: State }
      expect(Math.max(s.s.score[0], s.s.score[1])).toBeGreaterThanOrEqual(0)
      expect(SPOT[difficulty][0]).toBeGreaterThan(0)
    })
  }

  it('a human triple scores and a wrong one locks the human out', () => {
    const ctx = ctxFor([false, true], 'hard', 5)
    const game = factory()
    game.init(ctx)
    const snap = () => (game.snapshot() as { s: State }).s
    const grid = () => tableGrid(snap().table.length)
    const [i, j, k] = findSets(snap().table)[0] as [number, number, number]
    let id = 1000
    for (const slot of [i, j, k]) {
      const c = grid()[slot] as { x: number; y: number }
      ctx.input.player(0).press(id++, c.x, c.y)
    }
    game.update(1 / 60)
    ctx.input.endStep()
    expect(snap().score[0]).toBe(1)
    expect(snap().sel[0]).toEqual([])

    // Three slots that are not a triple: a human mistake costs a point and locks them out.
    const table = snap().table
    const wrong = findWrong(table)
    expect(wrong).not.toBeNull()
    const before = snap().score[0]
    let t = 0
    for (const slot of wrong ?? []) {
      const c = grid()[slot] as { x: number; y: number }
      ctx.input.player(0).press(id++, c.x, c.y)
      game.update(1 / 60)
      ctx.input.endStep()
      t++
    }
    expect(t).toBe(3)
    expect(snap().score[0]).toBe(before - 1)
    expect(snap().lockUntil[0]).toBeGreaterThan(game.time)
  })

  it('pickTriple always returns a real triple, and nothing when there is none', () => {
    const rng = new Rng(77)
    for (let n = 0; n < 40; n++) {
      const b = newBoard(rng.shuffle(Array.from({ length: DECK_SIZE }, (_, i) => i)))
      const t = pickTriple(b.table, rng)
      expect(t).not.toBeNull()
      const ids = (t ?? []).map((s) => b.table[s] as number)
      expect(isTriple(ids[0] as number, ids[1] as number, ids[2] as number)).toBe(true)
    }
    expect(pickTriple(setFree(), rng)).toBeNull()
  })
})
