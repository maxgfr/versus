import { describe, expect, it } from 'vitest'
import type { Difficulty, GameContext, Side } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import { Fx } from '../../core/fx/fx.ts'
import { Input } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import type { Stage } from '../../core/stage.ts'
import { choose } from './bot.ts'
import makeGame from './index.ts'
import { bubbleCenter, doneRect } from './render.ts'
import {
  BUBBLES,
  bubblesLeft,
  canPop,
  COLS,
  heapsOf,
  legalMoves,
  mistereWin,
  type Move,
  popBubble,
  ROWS,
  rowOf,
  winningMoves,
} from './rules.ts'

const whole = (): boolean[] => Array<boolean>(BUBBLES).fill(false)

/** Plain recursive misère Nim with no memo: the reference the solver must agree with. */
function bruteWin(heaps: number[]): boolean {
  if (heaps.every((h) => h === 0)) return true
  for (let i = 0; i < heaps.length; i++) {
    const hi = heaps[i] ?? 0
    for (let n = 0; n < hi; n++) {
      const next = heaps.slice()
      next[i] = n
      if (!bruteWin(next)) return true
    }
  }
  return false
}

/** One full game between two levels; returns the side that did NOT pop the last bubble. */
function play(a: Difficulty, b: Difficulty, seed: number): { winner: Side; turns: number } {
  const rng = new Rng(seed)
  const levels = [a, b] as const
  let popped = whole()
  let turn: Side = seed % 2 ? 1 : 0
  for (let t = 1; t <= BUBBLES; t++) {
    const m: Move = choose(heapsOf(popped), levels[turn], rng)
    let lock = -1
    for (let k = 0; k < m.count; k++) {
      const candidates = popped
        .map((p, i) => (!p && canPop(popped, i, lock) ? i : -1))
        .filter((i) => i >= 0)
      const i = candidates.find((c) => rowOf(c) === m.row)
      if (i === undefined) throw new Error('move names a row with no bubbles left')
      popped = popBubble(popped, i)
      lock = m.row
    }
    if (bubblesLeft(popped) === 0) return { winner: other(turn), turns: t }
    turn = other(turn)
  }
  throw new Error('no end within the board size')
}

describe('pop it rules', () => {
  it('starts with six rainbow rows of six whole bubbles', () => {
    expect(ROWS).toBe(6)
    expect(COLS).toBe(6)
    expect(heapsOf(whole())).toEqual([6, 6, 6, 6, 6, 6])
    expect(bubblesLeft(whole())).toBe(36)
  })

  it('locks a turn to the row of its first pop', () => {
    const board = whole()
    expect(canPop(board, 0, -1)).toBe(true)
    expect(canPop(board, 6, 0)).toBe(false)
    expect(canPop(board, 3, 0)).toBe(true)
  })

  it('never pops a bubble twice', () => {
    const once = popBubble(whole(), 7)
    expect(canPop(once, 7, -1)).toBe(false)
    expect(() => popBubble(once, 7)).toThrow()
  })

  it('counts unpopped bubbles per row as the heaps', () => {
    let board = whole()
    board = popBubble(board, 0)
    board = popBubble(board, 1)
    board = popBubble(board, 35)
    expect(heapsOf(board)).toEqual([4, 6, 6, 6, 6, 5])
  })

  it('knows the misère endgame: last bubble loses', () => {
    expect(mistereWin([])).toBe(true)
    expect(mistereWin([0, 0, 0, 0, 0, 0])).toBe(true)
    expect(mistereWin([1, 0, 0, 0, 0, 0])).toBe(false)
    expect(mistereWin([2, 0, 0, 0, 0, 0])).toBe(true)
    expect(mistereWin([1, 1, 0, 0, 0, 0])).toBe(true)
    expect(mistereWin([1, 1, 1, 0, 0, 0])).toBe(false)
  })

  it('agrees with a brute-force search on every small position', () => {
    for (let a = 0; a <= 3; a++)
      for (let b = 0; b <= 3; b++)
        for (let c = 0; c <= 2; c++)
          for (let d = 0; d <= 2; d++) {
            const h = [a, b, c, d, 0, 0]
            expect(mistereWin(h)).toBe(bruteWin(h))
          }
  })

  it('lists exactly the moves that win', () => {
    const heaps = [2, 0, 0, 0, 0, 0]
    expect(winningMoves(heaps)).toEqual([{ row: 0, count: 1 }])
    expect(winningMoves([1, 0, 0, 0, 0, 0])).toEqual([])
    expect(legalMoves([2, 1, 0, 0, 0, 0])).toHaveLength(3)
  })
})

describe('pop it bot', () => {
  it('always pops from a row that still has bubbles', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      for (let seed = 0; seed < 40; seed++) {
        const rng = new Rng(seed)
        const heaps = [3, 0, 6, 1, 0, 2]
        const m = choose(heaps, d, rng)
        expect(heaps[m.row]).toBeGreaterThanOrEqual(m.count)
        expect(m.count).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('hard always takes a winning move from a winning position', () => {
    for (let seed = 0; seed < 60; seed++) {
      const rng = new Rng(seed)
      const heaps = [seed % 5, (seed * 3) % 4, 2, 1, 0, (seed * 7) % 3]
      if (!mistereWin(heaps)) continue
      const m = choose(heaps, 'hard', rng)
      const next = heaps.slice()
      next[m.row] = (next[m.row] ?? 0) - m.count
      expect(mistereWin(next)).toBe(false)
    }
  })

  it('normal plays the ending perfectly once few bubbles are left', () => {
    for (let seed = 0; seed < 40; seed++) {
      const heaps = [2, 0, 3, 1, 0, 2]
      expect(mistereWin(heaps)).toBe(true)
      const m = choose(heaps, 'normal', new Rng(seed))
      const next = heaps.slice()
      next[m.row] = (next[m.row] ?? 0) - m.count
      expect(mistereWin(next)).toBe(false)
    }
  })

  it('hard, when lost, pops one bubble from the fullest row to keep it complicated', () => {
    // Two equal rows of four: the rival mirrors every move, so the player to move has lost.
    const lost = [4, 4, 0, 0, 0, 0]
    expect(mistereWin(lost)).toBe(false)
    expect(choose(lost, 'hard', new Rng(1))).toEqual({ row: 0, count: 1 })
  })

  it('normal beats easy more often than not, and hard beats normal', () => {
    let normal = 0
    let hard = 0
    for (let seed = 1; seed <= 40; seed++) {
      if (play('normal', 'easy', seed).winner === 0) normal++
      if (play('hard', 'normal', seed).winner === 0) hard++
    }
    expect(normal / 40).toBeGreaterThan(0.6)
    expect(hard / 40).toBeGreaterThan(0.7)
  })

  it('finishes whole games bot vs bot for every pairing, and hard wins more than easy', () => {
    const levels: Difficulty[] = ['easy', 'normal', 'hard']
    for (const a of levels) for (const b of levels) play(a, b, 5)

    let hardWins = 0
    let easyWins = 0
    const games = 40
    for (let seed = 1; seed <= games; seed++) {
      const r = play('hard', 'easy', seed)
      if (r.winner === 0) hardWins++
      const e = play('easy', 'hard', seed)
      if (e.winner === 1) hardWins++
      if (play('easy', 'easy', seed).winner === 0) easyWins++
    }
    expect(hardWins / (games * 2)).toBeGreaterThan(0.8)
    expect(easyWins / games).toBeGreaterThan(0.2)
    expect(easyWins / games).toBeLessThan(0.8)
  })
})

// ---------- the game itself, driven headlessly through its own update loop ----------

/** A throwaway game context: real input routing, real fx, silent audio. */
function ctxFor(seed: number, mode: GameContext['mode'], bots: [boolean, boolean]): GameContext {
  return {
    stage: {} as Stage,
    input: new Input({} as Stage, mode, 0),
    fx: new Fx(),
    audio: { play: () => {}, buzz: () => {} } as unknown as GameContext['audio'],
    rng: new Rng(seed),
    mode,
    difficulty: 'normal',
    bots,
    teams: false,
    names: ['Red', 'Blue'],
    local: 0,
    seed,
  }
}

describe('pop it game', () => {
  it('a human against the computer reaches a result on every seed', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const c = ctxFor(seed, '1p', [false, true])
      const game = makeGame()
      game.init(c)
      let id = 1
      for (let f = 0; f < 60 * 60 * 300 && !game.result; f++) {
        const s = game.s
        if (s.turn === 0 && f % 20 === 0) {
          if (s.pops >= 2 || (s.pops === 1 && f % 3 === 0)) {
            const d = doneRect(0)
            c.input.player(0).press(id++, d.x + d.w / 2, d.y + d.h / 2)
          } else {
            const open = s.popped.flatMap((_p, i) => (canPop(s.popped, i, s.lock) ? [i] : []))
            const i = open[(seed * 5 + f) % open.length]
            if (i !== undefined) {
              const p = bubbleCenter(i)
              c.input.player(0).press(id++, p.x, p.y)
            }
          }
        }
        game.update(1 / 60)
        c.input.endStep()
        c.input.player(0).releaseAll()
      }
      expect(game.result).not.toBeNull()
    }
  })

  it('locks the turn to one row and ignores Done before the first pop', () => {
    const c = ctxFor(2, '2p', [false, false])
    const game = makeGame()
    game.init(c)
    const turn = game.s.turn
    const press = (x: number, y: number) => {
      c.input.player(turn).press(90, x, y)
      game.update(1 / 60)
      c.input.endStep()
      c.input.player(turn).releaseAll()
    }
    const done = doneRect(turn)
    press(done.x + done.w / 2, done.y + done.h / 2)
    expect(game.s.turn).toBe(turn)
    const first = bubbleCenter(0)
    press(first.x, first.y)
    expect(game.s.lock).toBe(0)
    const other = bubbleCenter(COLS)
    press(other.x, other.y)
    expect(game.s.popped[COLS]).toBe(false)
    press(done.x + done.w / 2, done.y + done.h / 2)
    expect(game.s.turn).not.toBe(turn)
    expect(game.s.lock).toBe(-1)
  })

  it('the computer finishes a game with no errors, both sides driven by the bot', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const c = ctxFor(seed, '2p', [true, true])
      const game = makeGame()
      game.init(c)
      for (let f = 0; f < 60 * 60 * 300 && !game.result; f++) {
        game.update(1 / 60)
        c.input.endStep()
      }
      expect(game.result).not.toBeNull()
    }
  })
})
