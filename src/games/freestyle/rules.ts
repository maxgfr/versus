import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Lang, THEME_IDS, WORDS } from './words.ts'

/**
 * Pure rules for Freestyle Battle. A boom-bap beat loops at 90 BPM; the two
 * players take turns rapping a verse of 16 bars over it, an imposed word
 * dealt every 4 bars. Nothing is scored: once every verse is done the beat
 * stops and the players (or whoever is watching) tap who won.
 *
 * Time is counted in bars from the start of the game; phases change on a bar.
 */

export const BPM = 90
/** Seconds per beat, per bar and per sixteenth note. */
export const BEAT = 60 / BPM
export const BAR = BEAT * 4
export const SIXTEENTH = BEAT / 4
/** Bars of beat before the first verse, while the theme is shown. */
export const INTRO_BARS = 2
export const VERSE_BARS = 16
/** A new imposed word this often. */
export const WORD_BARS = 4
/** The bar between two verses, where the mic changes hands. */
export const SWITCH_BARS = 1
/** "Done" only works after this many bars of a verse (no accidental skip). */
export const DONE_AFTER = 2
/** Seconds the verdict buttons stay asleep, so a late tap on "Done" is not a vote. */
export const VOTE_DELAY = 0.8

export type Phase = 'intro' | 'verse' | 'switch' | 'verdict'
export type Verdict = Side | 'draw'

export interface Settings {
  lang: Lang
  /** Deal imposed words. */
  words: boolean
  /** 'none', 'random' or a theme id. */
  theme: string
}

export interface State {
  lang: Lang
  /** The theme id for this battle, or null for a free theme. */
  theme: string | null
  /** Who raps each verse, in order. */
  order: Side[]
  /** The imposed words of each verse (empty lists when words are off). */
  words: string[][]
  phase: Phase
  /** Bar the phase started on. */
  from: number
  /** Index of the current (or next, in intro / switch) verse in `order`. */
  verse: number
  /** Bar the current verse ends on (shortened by "Done"). */
  until: number
  /** Bars rapped so far, all verses together. */
  bars: number
  /** Game time the verdict was asked (-1 before). */
  askedAt: number
}

/**
 * A fresh battle: `verses` verses each, alternating, red or blue first at
 * random. Solo practice is one player's verses back to back.
 */
export function battleNew(rng: Rng, o: Settings, verses: number, solo = false): State {
  const first: Side = solo ? 0 : rng.chance(0.5) ? 1 : 0
  const order: Side[] = []
  for (let i = 0; i < (solo ? verses : verses * 2); i++)
    order.push(solo ? 0 : i % 2 === 0 ? first : first === 0 ? 1 : 0)
  const per = VERSE_BARS / WORD_BARS
  const deck = rng.shuffle([...WORDS[o.lang]])
  const words = order.map((_, i) => (o.words ? deck.slice(i * per, i * per + per) : []))
  const theme =
    o.theme === 'none'
      ? null
      : o.theme === 'random' || !THEME_IDS.includes(o.theme)
        ? rng.pick(THEME_IDS)
        : o.theme
  return {
    lang: o.lang,
    theme,
    order,
    words,
    phase: 'intro',
    from: 0,
    verse: 0,
    until: -1,
    bars: 0,
    askedAt: -1,
  }
}

/** The bar playing at game time `t`. */
export const barAt = (t: number): number => Math.floor(t / BAR + 1e-6)

/** The sixteenth note playing at game time `t`. */
export const sixteenthAt = (t: number): number => Math.floor(t / SIXTEENTH + 1e-6)

/** Who holds the mic now (null outside a verse). */
export const rapper = (s: State): Side | null =>
  s.phase === 'verse' ? (s.order[s.verse] ?? null) : null

/** Who raps next (the current rapper during a verse). */
export const nextRapper = (s: State): Side | null => s.order[s.verse] ?? null

/** The imposed word on screen at `bar` (null when there is none). */
export function wordAt(s: State, bar: number): string | null {
  if (s.phase !== 'verse') return null
  const list = s.words[s.verse] ?? []
  return list[Math.min(list.length - 1, Math.floor((bar - s.from) / WORD_BARS))] ?? null
}

/** Index of the imposed word on screen at `bar` (-1 when none). */
export function wordIndex(s: State, bar: number): number {
  if (s.phase !== 'verse' || !(s.words[s.verse] ?? []).length) return -1
  return Math.floor((bar - s.from) / WORD_BARS)
}

/** What changed when the bar ticked over. */
export type Change = 'verse' | 'switch' | 'verdict' | 'over' | null

/**
 * Move the battle on to `bar` (called each step with the bar playing). Returns
 * the phase just entered. `solo` battles end with 'over' instead of a verdict.
 */
export function advance(s: State, bar: number, t: number, solo = false): Change {
  if (s.phase === 'intro' && bar >= s.from + INTRO_BARS) return startVerse(s, bar)
  if (s.phase === 'switch' && bar >= s.from + SWITCH_BARS) return startVerse(s, bar)
  if (s.phase === 'verse' && bar >= s.until) {
    s.bars += bar - s.from
    if (s.verse + 1 >= s.order.length) {
      s.phase = 'verdict'
      s.from = bar
      s.askedAt = t
      return solo ? 'over' : 'verdict'
    }
    s.verse++
    s.phase = 'switch'
    s.from = bar
    return 'switch'
  }
  return null
}

function startVerse(s: State, bar: number): Change {
  s.phase = 'verse'
  s.from = bar
  s.until = bar + VERSE_BARS
  return 'verse'
}

/** The rapper tapped "Done": the verse ends on the next bar. False when too early. */
export function done(s: State, side: Side, bar: number): boolean {
  if (rapper(s) !== side || bar < s.from + DONE_AFTER || s.until <= bar + 1) return false
  s.until = bar + 1
  return true
}

/** The verdict buttons are awake. */
export const canVote = (s: State, t: number): boolean =>
  s.phase === 'verdict' && t >= s.askedAt + VOTE_DELAY

// ---------- the beat ----------

/** The bass note of each bar of the 4-bar loop, as a pitch over A (A, F, C, G). */
export const BASS = [1, 0.794, 1.189, 0.891] as const

/**
 * What plays on sixteenth `n` (counted from the start of the game): sound
 * names with a pitch. In the switch bar the kick and the bass drop out, so
 * the mic change is heard. Silent once the verdict is asked.
 */
export function beatAt(n: number, phase: Phase): [string, number][] {
  if (phase === 'verdict') return []
  const step = n % 16
  const bar = Math.floor(n / 16)
  const out: [string, number][] = []
  const drop = phase === 'switch'
  const fill = bar % 4 === 3
  if (!drop && (step === 0 || step === 7 || step === 10 || (fill && step === 14)))
    out.push(['kick', 1])
  if (step === 4 || step === 12) out.push(['snare', 1])
  if (fill && step === 15) out.push(['snare', 1.15])
  if (step % 2 === 0) out.push(['hat', step % 4 === 0 ? 1 : 1.25])
  else if (fill && step > 11) out.push(['hat', 1.4])
  if (!drop && (step === 0 || step === 10)) out.push(['bass', BASS[bar % 4] as number])
  return out
}
