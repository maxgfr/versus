import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import {
  advance,
  BAR,
  battleNew,
  beatAt,
  canVote,
  done,
  DONE_AFTER,
  INTRO_BARS,
  rapper,
  type Settings,
  type State,
  SWITCH_BARS,
  VERSE_BARS,
  VOTE_DELAY,
  WORD_BARS,
  wordAt,
} from './rules.ts'
import { THEME_IDS, WORDS } from './words.ts'

const FR: Settings = { lang: 'fr', words: true, theme: 'none' }

/** Run the battle bar by bar until `stop` says so (or 200 bars). Returns the bar reached. */
function runTo(s: State, stop: (s: State, bar: number) => boolean, solo = false): number {
  for (let bar = 0; bar < 200; bar++) {
    advance(s, bar, bar * BAR, solo)
    if (stop(s, bar)) return bar
  }
  throw new Error('never stopped')
}

describe('battleNew', () => {
  it('alternates the verses, two each by default', () => {
    for (let seed = 1; seed < 20; seed++) {
      const s = battleNew(new Rng(seed), FR, 2)
      expect(s.order).toHaveLength(4)
      expect(s.order[1]).not.toBe(s.order[0])
      expect(s.order[2]).toBe(s.order[0])
      expect(s.order[3]).toBe(s.order[1])
    }
  })

  it('lets either side open the battle', () => {
    const firsts = new Set(
      Array.from({ length: 30 }, (_, i) => battleNew(new Rng(i), FR, 1).order[0]),
    )
    expect(firsts).toEqual(new Set([0, 1]))
  })

  it('gives solo practice to red alone', () => {
    expect(battleNew(new Rng(3), FR, 3, true).order).toEqual([0, 0, 0])
  })

  it('deals one word per four bars, never twice, in the chosen language', () => {
    const s = battleNew(new Rng(5), FR, 4)
    const all = s.words.flat()
    expect(s.words.every((w) => w.length === VERSE_BARS / WORD_BARS)).toBe(true)
    expect(new Set(all).size).toBe(all.length)
    expect(all.every((w) => WORDS.fr.includes(w))).toBe(true)
    const en = battleNew(new Rng(5), { ...FR, lang: 'en' }, 1)
    expect(en.words.flat().every((w) => WORDS.en.includes(w))).toBe(true)
  })

  it('deals no words when they are off', () => {
    const s = battleNew(new Rng(5), { ...FR, words: false }, 2)
    expect(s.words.flat()).toEqual([])
    runTo(s, (st) => st.phase === 'verse')
    expect(wordAt(s, s.from)).toBeNull()
  })

  it('has no theme, a random one or the chosen one', () => {
    expect(battleNew(new Rng(1), FR, 1).theme).toBeNull()
    expect(battleNew(new Rng(1), { ...FR, theme: 'love' }, 1).theme).toBe('love')
    const random = new Set(
      Array.from(
        { length: 40 },
        (_, i) => battleNew(new Rng(i), { ...FR, theme: 'random' }, 1).theme,
      ),
    )
    expect(random.size).toBeGreaterThan(3)
    for (const t of random) expect(THEME_IDS).toContain(t)
    // A theme from an older version falls back to a random one.
    expect(THEME_IDS).toContain(battleNew(new Rng(1), { ...FR, theme: 'gone' }, 1).theme)
  })

  it('word lists stay free of duplicates', () => {
    for (const list of Object.values(WORDS)) expect(new Set(list).size).toBe(list.length)
  })
})

describe('advance', () => {
  it('plays intro, verse, switch, verse… then asks for the verdict', () => {
    const s = battleNew(new Rng(2), FR, 2)
    const seen: string[] = []
    for (let bar = 0; bar < 200 && s.phase !== 'verdict'; bar++) {
      const c = advance(s, bar, bar * BAR)
      if (c) seen.push(`${c}@${bar}`)
    }
    const v = INTRO_BARS
    const step = VERSE_BARS + SWITCH_BARS
    expect(seen).toEqual([
      `verse@${v}`,
      `switch@${v + VERSE_BARS}`,
      `verse@${v + step}`,
      `switch@${v + step + VERSE_BARS}`,
      `verse@${v + 2 * step}`,
      `switch@${v + 2 * step + VERSE_BARS}`,
      `verse@${v + 3 * step}`,
      `verdict@${v + 3 * step + VERSE_BARS}`,
    ])
    expect(s.bars).toBe(4 * VERSE_BARS)
  })

  it('hands the mic over in the battle order', () => {
    const s = battleNew(new Rng(9), FR, 2)
    const mics: number[] = []
    runTo(s, (st) => {
      const r = rapper(st)
      if (r !== null && mics.at(-1) !== st.verse) mics.push(st.verse)
      return st.phase === 'verdict'
    })
    expect(mics).toEqual([0, 1, 2, 3])
  })

  it('changes the imposed word every four bars', () => {
    const s = battleNew(new Rng(4), FR, 1)
    const from = runTo(s, (st) => st.phase === 'verse')
    const list = s.words[0] ?? []
    for (let i = 0; i < VERSE_BARS; i++)
      expect(wordAt(s, from + i)).toBe(list[Math.floor(i / WORD_BARS)])
  })

  it('ends solo practice without a verdict', () => {
    const s = battleNew(new Rng(4), FR, 2, true)
    let last = null
    for (let bar = 0; bar < 200 && !last; bar++) {
      const c = advance(s, bar, bar * BAR, true)
      if (c === 'over') last = c
      expect(c).not.toBe('verdict')
    }
    expect(last).toBe('over')
    expect(s.bars).toBe(2 * VERSE_BARS)
  })
})

describe('done', () => {
  it('cuts the verse at the next bar, only for the rapper and not too early', () => {
    const s = battleNew(new Rng(6), FR, 1)
    const from = runTo(s, (st) => st.phase === 'verse')
    const side = rapper(s) ?? 0
    const other = side === 0 ? 1 : 0
    expect(done(s, side, from)).toBe(false)
    expect(done(s, other, from + DONE_AFTER)).toBe(false)
    expect(done(s, side, from + DONE_AFTER)).toBe(true)
    expect(s.until).toBe(from + DONE_AFTER + 1)
    expect(advance(s, from + DONE_AFTER + 1, 0)).toBe('switch')
    expect(s.bars).toBe(DONE_AFTER + 1)
  })
})

describe('verdict', () => {
  it('wakes the buttons after a short delay', () => {
    const s = battleNew(new Rng(1), FR, 1)
    runTo(s, (st) => st.phase === 'verdict')
    expect(canVote(s, s.askedAt)).toBe(false)
    expect(canVote(s, s.askedAt + VOTE_DELAY)).toBe(true)
  })
})

describe('beatAt', () => {
  const bar = (n: number, phase: State['phase'] = 'verse') =>
    Array.from({ length: 16 }, (_, i) => beatAt(n * 16 + i, phase).map(([name]) => name))

  it('puts the kick on one and the snare on two and four', () => {
    const b = bar(0)
    expect(b[0]).toContain('kick')
    expect(b[4]).toContain('snare')
    expect(b[12]).toContain('snare')
    expect(b[2]).toContain('hat')
    expect(b[0]).toContain('bass')
  })

  it('drops the kick and bass while the mic changes hands, and stops for the verdict', () => {
    const sw = bar(0, 'switch').flat()
    expect(sw).not.toContain('kick')
    expect(sw).not.toContain('bass')
    expect(sw).toContain('snare')
    expect(bar(0, 'verdict').flat()).toEqual([])
  })
})
