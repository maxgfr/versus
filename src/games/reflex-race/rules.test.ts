import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { BLIND, planReaction, REACT } from './bot.ts'
import {
  advance,
  ANIMALS,
  champion,
  FREEZE,
  INTRO_TIME,
  makePicture,
  makeRule,
  matches,
  newRace,
  PICTURE_TIME,
  POINT_TIME,
  type Rule,
  type RaceState,
  RULE_KINDS,
  TARGET,
  tap,
  tapAll,
} from './rules.ts'

/** Run the clock forward in fixed steps until `done` or the limit, returning the time. */
function runUntil(s: RaceState, rng: Rng, from: number, done: (s: RaceState) => boolean): number {
  let now = from
  for (let i = 0; i < 60 * 120 && !done(s); i++) {
    now += 1 / 60
    advance(s, rng, now)
  }
  return now
}

describe('reflex race rules', () => {
  it('matches every rule kind on the pictures it should', () => {
    const glyph: Rule = { kind: 'glyph', glyph: '🐱' }
    expect(matches(glyph, { kind: 'glyph', glyph: '🐱' })).toBe(true)
    expect(matches(glyph, { kind: 'glyph', glyph: '🐶' })).toBe(false)
    expect(matches({ kind: 'colours' }, { kind: 'colours', a: 2, b: 2 })).toBe(true)
    expect(matches({ kind: 'colours' }, { kind: 'colours', a: 2, b: 3 })).toBe(false)
    expect(matches({ kind: 'parity', even: true }, { kind: 'number', n: 4 })).toBe(true)
    expect(matches({ kind: 'parity', even: true }, { kind: 'number', n: 5 })).toBe(false)
    expect(matches({ kind: 'parity', even: false }, { kind: 'number', n: 5 })).toBe(true)
    expect(matches({ kind: 'big' }, { kind: 'number', n: 6 })).toBe(true)
    expect(matches({ kind: 'big' }, { kind: 'number', n: 5 })).toBe(false)
  })

  it('never shows a picture that does not fit its rule kind', () => {
    const rng = new Rng(12)
    for (const kind of RULE_KINDS) {
      const rule = makeRule(rng, null)
      if (rule.kind !== kind) continue
      for (let i = 0; i < 300; i++) {
        const pic = makePicture(rng, rule)
        expect(pic.kind).toBe(
          rule.kind === 'glyph' ? 'glyph' : rule.kind === 'colours' ? 'colours' : 'number',
        )
      }
    }
  })

  it('makes pictures that match about a third of the time', () => {
    const rng = new Rng(5)
    for (const rule of [
      { kind: 'glyph', glyph: ANIMALS[0] },
      { kind: 'colours' },
      { kind: 'parity', even: true },
      { kind: 'big' },
    ] as Rule[]) {
      let hits = 0
      for (let i = 0; i < 3000; i++) if (matches(rule, makePicture(rng, rule))) hits++
      expect(hits / 3000).toBeGreaterThan(0.28)
      expect(hits / 3000).toBeLessThan(0.42)
    }
  })

  it('changes the rule every round', () => {
    const rng = new Rng(3)
    let prev = makeRule(rng, null).kind
    for (let i = 0; i < 200; i++) {
      const next = makeRule(rng, prev).kind
      expect(next).not.toBe(prev)
      prev = next
    }
  })

  it('shows the card, then flips pictures every PICTURE_TIME', () => {
    const rng = new Rng(4)
    const s = newRace(rng, 0)
    expect(s.pic).toBeNull()
    expect(advance(s, rng, INTRO_TIME - 0.1)).toBeNull()
    expect(advance(s, rng, INTRO_TIME)).toBe('flip')
    expect(s.phase).toBe('play')
    const first = s.picAt
    expect(advance(s, rng, first + PICTURE_TIME - 0.01)).toBeNull()
    expect(advance(s, rng, first + PICTURE_TIME)).toBe('flip')
    expect(s.picAt).toBeCloseTo(first + PICTURE_TIME)
  })

  it('scores a matching tap +1 and ends the round', () => {
    const rng = new Rng(8)
    const s = newRace(rng, 0)
    runUntil(s, rng, 0, (x) => x.phase === 'play')
    s.picMatch = true
    expect(tap(s, 0, s.picAt + 0.3)).toBe('hit')
    expect(s.score).toEqual([1, 0])
    expect(s.phase).toBe('point')
    expect(s.winner).toBe(0)
    expect(tap(s, 1, s.picAt + 0.4)).toBe('ignored')
    expect(s.score).toEqual([1, 0])
  })

  it('costs a tap on a non-match and locks that side briefly', () => {
    const rng = new Rng(9)
    const s = newRace(rng, 0)
    runUntil(s, rng, 0, (x) => x.phase === 'play')
    s.picMatch = false
    const t = s.picAt + 0.2
    expect(tap(s, 1, t)).toBe('miss')
    expect(s.score).toEqual([0, -1])
    expect(tap(s, 1, t + FREEZE / 2)).toBe('ignored')
    expect(s.score).toEqual([0, -1])
    expect(s.phase).toBe('play')
    s.picMatch = true
    expect(tap(s, 0, t + 0.3)).toBe('hit')
  })

  it('treats a tap before the picture as early and penalises it', () => {
    const rng = new Rng(10)
    const s = newRace(rng, 0)
    expect(tap(s, 0, 0.5)).toBe('early')
    expect(s.score).toEqual([-1, 0])
    expect(s.phase).toBe('intro')
  })

  it('starts the next round with a new rule after the point pause', () => {
    const rng = new Rng(14)
    const s = newRace(rng, 0)
    runUntil(s, rng, 0, (x) => x.phase === 'play')
    s.picMatch = true
    const won = s.picAt + 0.3
    tap(s, 0, won)
    const before = s.rule.kind
    expect(advance(s, rng, won + POINT_TIME - 0.05)).toBeNull()
    expect(advance(s, rng, won + POINT_TIME)).toBe('card-down')
    expect(s.round).toBe(2)
    expect(s.phase).toBe('intro')
    expect(s.pic).toBeNull()
    expect(s.rule.kind).not.toBe(before)
  })

  it('declares a champion at the target', () => {
    const rng = new Rng(2)
    const s = newRace(rng, 0)
    s.score = [TARGET - 1, 3]
    expect(champion(s)).toBeNull()
    runUntil(s, rng, 0, (x) => x.phase === 'play')
    s.picMatch = true
    tap(s, 0, s.picAt + 0.2)
    expect(champion(s)).toBe(0)
  })

  it('takes the match at the target passed in', () => {
    const rng = new Rng(4)
    const s = newRace(rng, 0)
    s.score = [2, 0]
    expect(champion(s, 3)).toBeNull()
    s.score = [3, 0]
    expect(champion(s, 3)).toBe(0)
    expect(champion(s)).toBeNull()
  })
})

describe('reflex race bot', () => {
  it('reacts inside its difficulty window; hard always catches a match, easy misses some', () => {
    const rng = new Rng(6)
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const [lo, hi] = REACT[d]
      let blind = 0
      for (let i = 0; i < 1000; i++) {
        const at = planReaction(d, rng, true)
        if (at === null) {
          blind++
          continue
        }
        expect(at).toBeGreaterThanOrEqual(lo)
        expect(at).toBeLessThanOrEqual(hi)
      }
      if (d === 'hard') expect(blind).toBe(0)
      else expect(Math.abs(blind / 1000 - BLIND[d])).toBeLessThan(0.04)
    }
  })

  it('false-taps most on easy, rarely on normal, never on hard', () => {
    const rng = new Rng(7)
    let easyFalse = 0
    let normalFalse = 0
    for (let i = 0; i < 2000; i++) {
      if (planReaction('easy', rng, false) !== null) easyFalse++
      if (planReaction('normal', rng, false) !== null) normalFalse++
      expect(planReaction('hard', rng, false)).toBeNull()
    }
    expect(easyFalse / 2000).toBeGreaterThan(0.03)
    expect(easyFalse / 2000).toBeLessThan(0.12)
    expect(normalFalse).toBeLessThan(easyFalse)
  })

  it('a dead heat on a match is a coin flip, not always red', () => {
    const wins: [number, number] = [0, 0]
    for (let seed = 1; seed <= 200; seed++) {
      const rng = new Rng(seed)
      const s = newRace(rng, 0)
      runUntil(s, rng, 0, (x) => x.phase === 'play' && x.picMatch)
      const out = tapAll(s, [0, 1], 10, rng)
      const hit = out.find((o) => o.r === 'hit')
      expect(hit).toBeDefined()
      expect(out.filter((o) => o.r === 'hit')).toHaveLength(1)
      wins[hit?.side ?? 0]++
    }
    expect(wins[0]).toBeGreaterThan(60)
    expect(wins[1]).toBeGreaterThan(60)
  })

  /** Two bots race until one reaches `target` points; returns the final state. */
  function botsRaceTo(d: 'easy' | 'normal' | 'hard', seed: number, target: number): RaceState {
    const rng = new Rng(seed)
    const s = newRace(rng, 0)
    let now = 0
    let botAt: [number | null, number | null] = [null, null]
    let picAt = -1
    let steps = 0
    while (champion(s, target) === null) {
      if (++steps > 60 * 60 * 5) throw new Error(`no champion (${d}, ${target})`)
      now += 1 / 60
      const ev = advance(s, rng, now)
      if (ev === 'flip') {
        picAt = s.picAt
        botAt = [planReaction(d, rng, s.picMatch), planReaction(d, rng, s.picMatch)]
      }
      if (ev === 'card-down') botAt = [null, null]
      if (s.phase !== 'play') continue
      for (const side of [0, 1] as const) {
        const at = botAt[side]
        if (at === null) continue
        if (now >= picAt + at) {
          botAt[side] = null
          tap(s, side, now)
        }
      }
    }
    return s
  }

  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`computer vs computer reaches a champion in bounded steps (${d})`, () => {
      const s = botsRaceTo(d, 31, TARGET)
      expect(Math.max(...s.score)).toBeGreaterThanOrEqual(TARGET)
    })
  }

  it('ends a short match at the chosen target, not the default', () => {
    const s = botsRaceTo('hard', 17, 3)
    expect(Math.max(...s.score)).toBeGreaterThanOrEqual(3)
    expect(Math.max(...s.score)).toBeLessThan(TARGET)
  })
})
