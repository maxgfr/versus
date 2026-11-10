import { inFrame, textAngle } from '../../core/frame.ts'
import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import {
  BAR,
  BEAT,
  DONE_AFTER,
  INTRO_BARS,
  VERSE_BARS,
  WORD_BARS,
  barAt,
  canVote,
  nextRapper,
  rapper,
  type State,
  type Verdict,
  wordAt,
  wordIndex,
} from './rules.ts'
import { T, THEMES } from './words.ts'

// Layout, as red sees the bottom half (blue's is the same turned around).
export const DONE_BTN = { x: 330, y: 1664, w: 340, h: 100 } as const
export const VOTE = { y: 1350, w: 270, h: 230, xs: [55, 365, 675] } as const
/** Rows of a half, clear of the record in the middle (it reaches y 1040). */
export const Y = {
  theme: 1085,
  head: 1165,
  sub: 1232,
  mic: 1312,
  label: 1380,
  word: 1490,
  bars: 1606,
} as const
/** What each verdict button says, left to right in a player's layout. */
export const VOTES: readonly Verdict[] = [0, 'draw', 1]

const inside = (x: number, y: number, bx: number, by: number, bw: number, bh: number) =>
  x >= bx && x <= bx + bw && y >= by && y <= by + bh

/** The "Done" button, in red-frame coordinates. */
export const onDone = (x: number, y: number): boolean =>
  inside(x, y, DONE_BTN.x, DONE_BTN.y, DONE_BTN.w, DONE_BTN.h)

/** The verdict button under a red-frame point, or null. */
export function voteAt(x: number, y: number): Verdict | null {
  for (let i = 0; i < VOTE.xs.length; i++)
    if (inside(x, y, VOTE.xs[i] as number, VOTE.y, VOTE.w, VOTE.h)) return VOTES[i] as Verdict
  return null
}

export interface Look {
  names: [string, string]
  /** Solo practice: only red raps, nobody judges. */
  solo: boolean
}

const fill = (str: string, n: string) => str.replace('{n}', n)

/** 1 on a beat, falling to 0 before the next: the room thumps with it. */
const thump = (s: State, t: number) => (s.phase === 'verdict' ? 0 : (1 - (t % BEAT) / BEAT) ** 4)

export function renderFreestyle(g: Draw, s: State, t: number, look: Look): void {
  const pulse = thump(s, t)
  const mic = rapper(s)
  g.fillView(C.ink)
  // Each half glows in its colour, the rapper's brightest.
  for (const side of [0, 1] as Side[]) {
    if (look.solo && side === 1) continue
    const lit = s.phase === 'verdict' ? 0.22 : mic === side ? 0.34 + pulse * 0.12 : 0.08
    const y = side === 0 ? MID + 520 : MID - 520
    g.circle(
      W / 2,
      y,
      760,
      g.rad(W / 2, y, 0, 760, [
        [0, alpha(SIDE[side].main, lit)],
        [1, alpha(SIDE[side].main, 0)],
      ]),
    )
  }
  g.midline(alpha(C.white, 0.1))
  turntable(g, s, t, pulse)
  for (const side of [0, 1] as Side[]) {
    if (look.solo && side === 1) continue
    inFrame(g, side, () => half(g, s, t, look, side, pulse))
  }
}

/** The record spinning in the middle, with an equaliser on each side. */
function turntable(g: Draw, s: State, t: number, pulse: number): void {
  const mic = rapper(s)
  const spin = s.phase === 'verdict' ? s.askedAt * 2.2 : t * 2.2
  const r = 118 * (1 + pulse * 0.05)
  g.circle(W / 2, MID, r + 14, alpha(C.white, 0.08))
  g.circle(W / 2, MID, r, '#0b0812', C.ink4, 6)
  for (let i = 1; i <= 4; i++) g.ring(W / 2, MID, r * (0.42 + i * 0.13), alpha(C.white, 0.06), 3)
  const label = mic === null ? C.yellow : SIDE[mic].main
  g.circle(W / 2, MID, r * 0.36, label)
  g.at(W / 2, MID, spin, () => {
    g.rect(-r * 0.3, -4, r * 0.6, 8, alpha(C.white, 0.55))
    g.arc(0, 0, r * 0.78, -0.5, 0.3, alpha(C.white, 0.18), 6)
  })
  g.circle(W / 2, MID, 8, C.ink)
  // Equaliser: ten bars that dance with the beat.
  const n = Math.floor(t / (BEAT / 4))
  for (let i = 0; i < 5; i++) {
    const wobble = Math.abs(Math.sin(n * 1.7 + i * 2.3))
    const h = s.phase === 'verdict' ? 6 : 14 + wobble * 50 + pulse * (60 - i * 8)
    const col = [C.pink, C.purple, C.cyan, C.green, C.yellow][i] as string
    for (const x of [W / 2 - 190 - i * 44, W / 2 + 190 + i * 44]) {
      g.rrect(x - 14, MID - h, 28, h * 2, 10, alpha(col, 0.75))
    }
  }
}

/** One player's half, drawn in red's layout. */
function half(g: Draw, s: State, t: number, look: Look, side: Side, pulse: number): void {
  const tr = T[s.lang]
  const a = textAngle(g, side)
  const text = (str: string, x: number, y: number, size: number, color: string, weight = 700) =>
    g.text(str, x, y, { size, color, weight, angle: a, maxWidth: 880 })
  // Everything below is drawn around points; a text angle of π turns it about that point.
  const theme = s.theme ? (THEMES[s.theme]?.[s.lang] ?? '') : tr.noTheme
  const bar = barAt(t)

  if (s.phase === 'intro') {
    text(tr.theme ?? '', W / 2, 1130, 40, C.mute, 600)
    text(theme ?? '', W / 2, 1220, 92, C.yellow)
    const first = nextRapper(s) ?? 0
    text(fill(tr.starts ?? '', look.names[first]), W / 2, 1390, 60, SIDE[first].light)
    const into = t - (s.from + INTRO_BARS - 1) * BAR
    if (into >= 0) {
      const n = 4 - Math.floor(into / BEAT)
      g.at(W / 2, 1580, a, () =>
        g.text(Math.max(1, n), 0, 0, { size: 140 + pulse * 30, color: C.white }),
      )
    } else text(tr.ready ?? '', W / 2, 1580, 52, C.white, 600)
    return
  }

  // A small reminder of the theme, against the midline.
  if (s.theme) text(`${tr.theme} · ${theme}`, W / 2, Y.theme, 34, alpha(C.yellow, 0.8), 600)

  if (s.phase === 'switch') {
    const next = nextRapper(s) ?? 0
    text(fill(tr.turnOf ?? '', look.names[next]), W / 2, 1250, 80, SIDE[next].light)
    if (next === side) g.emoji('🎤', W / 2, 1460 - pulse * 20, 150, a)
    return
  }

  if (s.phase === 'verdict') {
    if (look.solo) {
      text(String(s.bars), W / 2, 1260, 140, C.yellow)
      text(tr.bars ?? '', W / 2, 1390, 52, C.white, 600)
      return
    }
    text(tr.whoWon ?? '', W / 2, 1210, 88, C.white)
    const live = canVote(s, t)
    VOTE.xs.forEach((x, i) => {
      const v = VOTES[i] as Verdict
      const col = v === 'draw' ? C.ink4 : SIDE[v].main
      const label = v === 'draw' ? (tr.draw ?? '') : look.names[v]
      g.alpha(live ? 1 : 0.4, () => {
        g.rrect(x, VOTE.y + 10, VOTE.w, VOTE.h, 36, shade(col, -0.4))
        g.rrect(x, VOTE.y, VOTE.w, VOTE.h, 36, col, alpha(C.white, 0.25), 4)
        g.emoji(v === 'draw' ? '🤝' : '🏆', x + VOTE.w / 2, VOTE.y + 80, 76, a)
        g.text(label, x + VOTE.w / 2, VOTE.y + 170, {
          size: 44,
          color: C.white,
          weight: 700,
          angle: a,
          maxWidth: VOTE.w - 24,
        })
      })
    })
    return
  }

  // A verse.
  const mine = rapper(s) === side
  const verses = s.order.filter((o) => o === side).length
  const nth = s.order.slice(0, s.verse + 1).filter((o) => o === side).length
  const word = wordAt(s, bar)
  if (mine) {
    text(tr.yourTurn ?? '', W / 2, Y.head, 84, SIDE[side].light)
    const verse = (tr.verse ?? '').replace('{a}', String(nth)).replace('{b}', String(verses))
    text(verse, W / 2, Y.sub, 36, C.mute, 600)
    g.emoji('🎤', W / 2, Y.mic - pulse * 14, 96, a)
  } else {
    const who = rapper(s) ?? 0
    text(tr.listen ?? '', W / 2, Y.head, 64, C.mute)
    text(fill(tr.turnOf ?? '', look.names[who]), W / 2, Y.sub, 40, SIDE[who].light, 600)
    g.emoji('👂', W / 2, Y.mic, 84, a)
  }
  if (word) {
    const idx = wordIndex(s, bar)
    const since = t - (s.from + idx * WORD_BARS) * BAR
    const pop = 1 + 0.25 * Math.max(0, 1 - since / 0.3)
    const size = mine ? 96 : 64
    text(tr.word ?? '', W / 2, Y.label, 30, C.mute, 600)
    const w = Math.min(900, g.measure(word, size, 700) + 90)
    g.at(
      W / 2,
      Y.word,
      0,
      () => {
        g.rrect(-w / 2, -size * 0.85, w, size * 1.7, 30, alpha(C.yellow, mine ? 0.16 : 0.08))
        g.rrect(-w / 2, -size * 0.85, w, size * 1.7, 30, undefined, alpha(C.yellow, 0.7), 4)
        g.text(word, 0, 0, { size, color: C.yellow, weight: 700, angle: a, maxWidth: 860 })
      },
      pop,
    )
  }
  progress(g, s, t, rapper(s) ?? side, mine)
  if (mine) {
    const live = bar >= s.from + DONE_AFTER && s.until > bar + 1
    const b = DONE_BTN
    g.alpha(live ? 1 : 0.35, () => {
      g.rrect(b.x, b.y + 8, b.w, b.h, 52, SIDE[side].dark)
      g.rrect(b.x, b.y, b.w, b.h, 52, SIDE[side].main)
      g.text(tr.done ?? '', b.x + b.w / 2, b.y + b.h / 2, {
        size: 48,
        color: C.white,
        weight: 700,
        angle: a,
      })
    })
  }
}

/** Sixteen cells for the bars of the verse; a gap between each imposed word's four. */
function progress(g: Draw, s: State, t: number, side: Side, mine: boolean): void {
  const y = Y.bars
  const hgt = mine ? 26 : 16
  const gap = 8
  const group = 14
  const cell = (800 - gap * (VERSE_BARS - 1) - group * (VERSE_BARS / WORD_BARS - 1)) / VERSE_BARS
  const played = (t - s.from * BAR) / BAR
  for (let i = 0; i < VERSE_BARS; i++) {
    const x = 100 + i * (cell + gap) + Math.floor(i / WORD_BARS) * group
    const cut = s.from + i >= s.until
    g.rrect(x, y, cell, hgt, 8, alpha(C.white, cut ? 0.04 : 0.12))
    const k = cut ? 0 : Math.max(0, Math.min(1, played - i))
    if (k > 0) g.rrect(x, y, cell * k, hgt, 8, SIDE[side].main)
  }
}
