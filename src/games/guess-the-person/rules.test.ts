import { describe, expect, it } from 'vitest'
import type { Audio } from '../../core/audio.ts'
import { Fx } from '../../core/fx/fx.ts'
import type { Difficulty, GameContext, Side } from '../../core/game.ts'
import { Input } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import type { Stage } from '../../core/stage.ts'
import { choose } from './bot.ts'
import factory, { type State } from './index.ts'
import { cellXY, chipXY, GUESS_X, hudFrameY } from './render.ts'
import {
  ask,
  candidates,
  FACES,
  type Face,
  guess,
  makeCast,
  newRound,
  open,
  QUESTIONS,
  type Round,
  signature,
} from './rules.ts'

function roundFor(seed: number): Round {
  const rng = new Rng(seed)
  const faces = makeCast(rng)
  return newRound(faces, [rng.int(0, FACES - 1), rng.int(0, FACES - 1)])
}

/** Ask every question the rival would answer, without ever touching the flips' meaning. */
function answersMatch(r: Round, side: Side, q: number): boolean {
  const rival = r.faces[r.secret[side === 0 ? 1 : 0]] as Face
  return r.answers[side][q] === QUESTIONS[q]?.test(rival)
}

describe('guess the person rules', () => {
  it('makes 24 faces that all answer the twelve questions differently', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const faces = makeCast(new Rng(seed))
      expect(faces).toHaveLength(FACES)
      const sigs = faces.map(signature)
      expect(new Set(sigs).size).toBe(FACES)
      for (const s of sigs) expect(s).toHaveLength(QUESTIONS.length)
    }
  })

  it('answers truthfully about the rival, and rules out only the impossible faces', () => {
    const r = roundFor(4)
    const rival = r.faces[r.secret[1]] as Face
    for (let q = 0; q < QUESTIONS.length; q++) {
      const before = candidates(r, 0)
      const a = ask(r, 0, q)
      expect(a.yes).toBe(QUESTIONS[q]?.test(rival))
      for (const i of before) {
        const keep = QUESTIONS[q]?.test(r.faces[i] as Face) === a.yes
        expect(r.down[0][i]).toBe(!keep)
      }
      expect(a.flipped.every((i) => r.down[0][i])).toBe(true)
      expect(answersMatch(r, 0, q)).toBe(true)
      // Only the candidates that disagreed were flipped now.
      expect(a.flipped.every((i) => before.includes(i))).toBe(true)
    }
  })

  it('never rules out the rival secret, however the questions go', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = roundFor(seed)
      const rng = new Rng(seed * 7)
      for (let step = 0; step < 20; step++) {
        const qs = open(r, 0)
        if (!qs.length) break
        ask(r, 0, rng.pick(qs))
        expect(candidates(r, 0)).toContain(r.secret[1])
      }
    }
  })

  it('refuses to ask the same question twice', () => {
    const r = roundFor(9)
    ask(r, 1, 3)
    expect(() => ask(r, 1, 3)).toThrow()
    expect(open(r, 1)).not.toContain(3)
  })

  it('a guess is right exactly for the rival secret', () => {
    const r = roundFor(11)
    expect(guess(r, 0, r.secret[1])).toBe(true)
    for (let i = 0; i < FACES; i++) {
      if (i !== r.secret[1]) expect(guess(r, 0, i)).toBe(false)
    }
  })

  it('the computer names the face once one candidate is left', () => {
    const r = roundFor(12)
    for (let i = 0; i < FACES; i++) if (i !== r.secret[1]) r.down[0][i] = true
    const m = choose(r, 0, 'easy', new Rng(1))
    expect(m).toEqual({ kind: 'guess', i: r.secret[1] })
  })

  it('hard asks one of the most even splits (it looks a question further to break ties)', () => {
    const r = roundFor(21)
    const rng = new Rng(2)
    const cands = candidates(r, 0)
    const balance = (q: number) => {
      const test = QUESTIONS[q]?.test ?? (() => false)
      const yes = cands.filter((i) => test(r.faces[i] as Face)).length
      return Math.abs(yes - (cands.length - yes))
    }
    const best = Math.min(...open(r, 0).map(balance))
    for (let k = 0; k < 10; k++) {
      const m = choose(r, 0, 'hard', rng)
      expect(m.kind).toBe('ask')
      if (m.kind === 'ask') expect(balance(m.q)).toBeLessThanOrEqual(best + 2)
    }
  })

  it('normal and hard name a face at once when the rival is down to one; easy does not see it', () => {
    const r = roundFor(33)
    for (let i = 0; i < FACES; i++) if (i !== r.secret[0]) r.down[1][i] = true
    expect(choose(r, 0, 'hard', new Rng(1)).kind).toBe('guess')
    expect(choose(r, 0, 'normal', new Rng(1)).kind).toBe('guess')
    expect(choose(r, 0, 'easy', new Rng(1)).kind).toBe('ask')
  })

  /** A whole round by the rules, two computers taking turns; returns who wins it. */
  const duel = (a: Difficulty, b: Difficulty, seed: number): Side => {
    const r = roundFor(seed)
    const rng = new Rng(seed * 7)
    let turn: Side = seed % 2 === 0 ? 0 : 1
    for (let n = 0; n < 60; n++) {
      const m = choose(r, turn, turn === 0 ? a : b, rng)
      if (m.kind === 'guess') return guess(r, turn, m.i) ? turn : turn === 0 ? 1 : 0
      ask(r, turn, m.q)
      turn = turn === 0 ? 1 : 0
    }
    throw new Error('no guess')
  }

  it('hard beats easy and normal beats easy most of the time, either side opening', () => {
    let hard = 0
    let normal = 0
    for (let seed = 1; seed <= 60; seed++) {
      if (duel('hard', 'easy', seed) === 0) hard++
      if (duel('normal', 'easy', seed) === 0) normal++
    }
    expect(hard).toBeGreaterThanOrEqual(40)
    expect(normal).toBeGreaterThanOrEqual(36)
  })
})

// ---------- game level ----------

function ctxFor(bots: [boolean, boolean], difficulty: Difficulty, seed: number): GameContext {
  const audio = { play: () => {}, unlock: () => {}, buzz: () => {} } as unknown as Audio
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

describe('guess the person game', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`bot vs bot names a face in bounded time (${difficulty})`, () => {
      const game = factory()
      game.init(ctxFor([true, true], difficulty, 31))
      let steps = 0
      while (!game.result) {
        game.update(1 / 60)
        if (++steps > 60 * 900) throw new Error('no result')
      }
      const w = game.result.winner
      expect(w === 0 || w === 1).toBe(true)
    })
  }

  it('a human asks a question, then guesses the rival face and wins', () => {
    const ctx = ctxFor([false, true], 'normal', 17)
    const game = factory()
    game.init(ctx)
    const snap = () => (game.snapshot() as { s: State }).s
    let id = 500
    const tapAt = (x: number, y: number) => {
      ctx.input.player(0).press(id++, x, y)
      game.update(1 / 60)
      ctx.input.endStep()
    }
    const waitForRedTurn = () => {
      let n = 0
      while (!(snap().turn === 0 && snap().resolveAt < 0) && !game.over) {
        game.update(1 / 60)
        ctx.input.endStep()
        if (++n > 60 * 60) throw new Error('red never got a turn')
      }
    }
    waitForRedTurn()
    const s0 = snap()
    const rivalSecret = s0.secret[1]
    const q = 0
    const c = chipXY(q)
    tapAt(c.x, c.y)
    expect(snap().answers[0][q]).toBe(QUESTIONS[q]?.test(s0.faces[rivalSecret] as Face))
    expect(snap().down[0].some(Boolean)).toBe(true)
    // Blue plays its own turn; red gets the board back.
    waitForRedTurn()
    // Guess: arm the Guess button, then name the rival's face on red's board.
    tapAt(GUESS_X, hudFrameY(ctx.stage, 0))
    expect(snap().guess).toBe(true)
    const cell = cellXY(rivalSecret)
    tapAt(cell.x, cell.y)
    expect(game.over).toBe(true)
    game.update(3)
    expect(game.result?.winner).toBe(0)
  })
})
