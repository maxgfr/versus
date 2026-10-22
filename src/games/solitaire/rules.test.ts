import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { chooseAction, clearIn, clears, dealTier, PACE, playableDeal, tierFor } from './bot.ts'
import {
  apply,
  canDrop,
  CARDS,
  type Deal,
  deal,
  destinationFor,
  draw,
  home,
  isRed,
  pickable,
  rankOf,
  reveals,
  stacks,
  stuck,
  suitOf,
} from './rules.ts'

/** Card code from suit (0 ♠ 1 ♥ 2 ♦ 3 ♣) and rank (1 = ace … 13 = king). */
const card = (suit: number, rank: number): number => suit * 13 + rank - 1

function mk(p: Partial<Deal> = {}): Deal {
  return {
    tab: Array.from({ length: 7 }, () => []),
    down: Array<number>(7).fill(0),
    stock: [],
    waste: [],
    found: [0, 0, 0, 0],
    ...p,
  }
}

/** Every card in the game is in exactly one place. */
function allCards(d: Deal): number[] {
  return [
    ...d.tab.flat(),
    ...d.stock,
    ...d.waste,
    ...d.found.flatMap((top, s) => Array.from({ length: top }, (_, i) => s * 13 + i)),
  ]
}

describe('solitaire deal', () => {
  it('deals all 52 cards once: 1 to 7 per column, 24 in the stock', () => {
    const d = deal(6)
    expect([...allCards(d)].sort((a, b) => a - b)).toEqual(
      Array.from({ length: CARDS }, (_, i) => i),
    )
    expect(d.tab.map((c) => c.length)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(d.down).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(d.stock).toHaveLength(24)
    expect(d.waste).toEqual([])
    expect(home(d)).toBe(0)
  })

  it('is the same deal for the same seed, and different for another', () => {
    expect(deal(17)).toEqual(deal(17))
    expect(deal(17)).not.toEqual(deal(18))
  })

  it('knows suits, ranks and colours', () => {
    expect(suitOf(card(2, 9))).toBe(2)
    expect(rankOf(card(2, 9))).toBe(9)
    expect(isRed(card(1, 1))).toBe(true)
    expect(isRed(card(0, 13))).toBe(false)
  })
})

describe('solitaire stacking', () => {
  it('builds down in alternating colours', () => {
    expect(stacks(card(1, 12), card(0, 13))).toBe(true) // Q♥ on K♠
    expect(stacks(card(0, 12), card(0, 13))).toBe(false) // Q♠ on K♠: same colour
    expect(stacks(card(1, 11), card(0, 13))).toBe(false) // J♥ on K♠: wrong rank
  })

  it('takes only kings into an empty column', () => {
    expect(stacks(card(3, 13), undefined)).toBe(true)
    expect(stacks(card(3, 12), undefined)).toBe(false)
  })
})

describe('solitaire moves', () => {
  it('sends a single card to its foundation before any column', () => {
    // A♥ on top of column 0 (and a black 2 could take it on the table): foundation wins.
    const d = mk({ tab: [[card(1, 1)], [card(0, 2)]], down: [0, 0] })
    expect(destinationFor(d, { from: 'tab', col: 0, idx: 0 })).toEqual({ to: 'found', suit: 1 })
  })

  it('only takes the next rank onto a foundation', () => {
    const d = mk({ waste: [card(1, 2)], found: [0, 0, 0, 0] })
    expect(destinationFor(d, { from: 'waste' })).toBeNull()
    const ready = mk({ waste: [card(1, 2)], found: [0, 1, 0, 0] })
    expect(destinationFor(ready, { from: 'waste' })).toEqual({ to: 'found', suit: 1 })
  })

  it('reveals the hidden card under a moved card and flips it', () => {
    // Column 0: a hidden 5♠ under the 9♦. The 9♦ goes onto a black 10.
    const d = mk({
      tab: [[card(0, 5), card(2, 9)], [card(0, 10)]],
      down: [1, 0],
    })
    const src = { from: 'tab' as const, col: 0, idx: 1 }
    expect(reveals(d, src)).toBe(true)
    const dst = destinationFor(d, src)
    expect(dst).toEqual({ to: 'tab', col: 1 })
    const n = apply(d, src, dst as { to: 'tab'; col: number })
    expect(n.tab[0]).toEqual([card(0, 5)])
    expect(n.down[0]).toBe(0)
    expect(n.tab[1]).toEqual([card(0, 10), card(2, 9)])
    // The original deal is untouched.
    expect(d.tab[0]).toEqual([card(0, 5), card(2, 9)])
  })

  it('moves a run of cards with the card it is on', () => {
    // Q♠ J♥ on a column; the run goes onto a red king.
    const d = mk({
      tab: [[card(0, 12), card(1, 11)], [card(2, 13)]],
    })
    const src = { from: 'tab' as const, col: 0, idx: 0 }
    expect(destinationFor(d, src)).toEqual({ to: 'tab', col: 1 })
    const n = apply(d, src, { to: 'tab', col: 1 })
    expect(n.tab[0]).toEqual([])
    expect(n.tab[1]).toEqual([card(2, 13), card(0, 12), card(1, 11)])
    expect(allCards(n).sort((a, b) => a - b)).toEqual(allCards(d).sort((a, b) => a - b))
  })

  it('does not move a run to foundations, and not a whole column onto an empty one', () => {
    const run = mk({ tab: [[card(0, 1), card(1, 2)], []], found: [0, 0, 0, 0] })
    // A♠ with a red 2 on it cannot go home as one card.
    expect(destinationFor(run, { from: 'tab', col: 0, idx: 0 })).toBeNull()
    // A lone king at the bottom of a column has nowhere useful to go.
    const kingAlone = mk({ tab: [[card(0, 13)], []] })
    expect(destinationFor(kingAlone, { from: 'tab', col: 0, idx: 0 })).toBeNull()
  })

  it('moves a king from the waste into an empty column', () => {
    const d = mk({ waste: [card(3, 13)], tab: [[card(1, 4)], []] })
    expect(destinationFor(d, { from: 'waste' })).toEqual({ to: 'tab', col: 1 })
  })

  it('prefers a column that already has cards over an empty one', () => {
    // A king only goes to an empty column; with a king on column 2 and two empty ones, the first empty one.
    const d = mk({ waste: [card(3, 13)], tab: [[], [], [card(1, 13)]] })
    expect(destinationFor(d, { from: 'waste' })).toEqual({ to: 'tab', col: 0 })
    const e = mk({ waste: [card(1, 11)], tab: [[], [card(0, 12)]] })
    expect(destinationFor(e, { from: 'waste' })).toEqual({ to: 'tab', col: 1 })
  })
})

describe('solitaire stock', () => {
  it('turns over one card, then turns the waste back when the stock runs out', () => {
    const d = mk({ stock: [card(0, 1), card(0, 2)] })
    const once = draw(d)
    expect(once?.waste).toEqual([card(0, 2)])
    expect(once?.stock).toEqual([card(0, 1)])
    const twice = draw(once as Deal)
    expect(twice?.waste).toEqual([card(0, 2), card(0, 1)])
    expect(twice?.stock).toEqual([])
    // Recycled: the first card drawn comes up first again.
    const again = draw(twice as Deal)
    expect(again?.stock).toEqual([card(0, 1), card(0, 2)])
    expect(again?.waste).toEqual([])
    expect(draw(mk())).toBeNull()
  })

  it('lists the cards a player can pick up', () => {
    const d = mk({ waste: [card(0, 3)], tab: [[card(0, 1), card(0, 2)], []], down: [1, 0] })
    expect(pickable(d)).toEqual([{ from: 'waste' }, { from: 'tab', col: 0, idx: 1 }])
  })
})

describe('solitaire bot', () => {
  it('plays a foundation move first, a reveal next, then draws', () => {
    const rng = new Rng(2)
    const home1 = mk({ tab: [[card(1, 1)], []] })
    expect(chooseAction(home1, 'hard', rng)).toEqual({
      kind: 'play',
      src: { from: 'tab', col: 0, idx: 0 },
      dst: { to: 'found', suit: 1 },
    })
    const reveal = mk({
      tab: [[card(0, 5), card(2, 9)], [card(0, 10)]],
      down: [1, 0],
      stock: [card(3, 3)],
    })
    expect(chooseAction(reveal, 'hard', rng)?.kind).toBe('play')
    expect(chooseAction(mk({ stock: [card(3, 3)] }), 'hard', rng)).toEqual({ kind: 'draw' })
    expect(chooseAction(mk(), 'hard', rng)).toBeNull()
  })

  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`plays on ${d} without losing a card, and keeps going within the 4-minute cap`, () => {
      for (const seed of [1, 2, 3]) {
        let b = deal(seed)
        const rng = new Rng(seed + 10)
        const actions = Math.floor(240 / PACE[d])
        let plays = 0
        for (let i = 0; i < actions; i++) {
          const act = chooseAction(b, d, rng)
          if (!act) break
          if (act.kind === 'draw') {
            const n = draw(b)
            if (n) b = n
          } else {
            b = apply(b, act.src, act.dst)
            plays++
          }
          expect(allCards(b)).toHaveLength(CARDS)
          expect(new Set(allCards(b)).size).toBe(CARDS)
          b.down.forEach((dn, c) => expect(dn).toBeLessThanOrEqual(b.tab[c]?.length ?? 0))
        }
        expect(plays).toBeGreaterThan(5)
      }
    })
  }
})

describe('solitaire drops', () => {
  it('drops a card on a column only where it stacks, and never back on its own column', () => {
    const d = mk({ tab: [[card(1, 5)], [card(0, 6)], [card(3, 6)], []], waste: [card(1, 13)] })
    const five = { from: 'tab' as const, col: 0, idx: 0 }
    expect(canDrop(d, five, { to: 'tab', col: 1 })).toBe(true)
    expect(canDrop(d, five, { to: 'tab', col: 2 })).toBe(true)
    expect(canDrop(d, five, { to: 'tab', col: 0 })).toBe(false)
    expect(canDrop(d, five, { to: 'tab', col: 3 })).toBe(false)
    // A king goes into an empty column.
    expect(canDrop(d, { from: 'waste' }, { to: 'tab', col: 3 })).toBe(true)
  })

  it('drops on a foundation only its own suit, single cards, in order', () => {
    const d = mk({ tab: [[card(1, 2), card(0, 1)]], found: [0, 1, 0, 0], down: [0] })
    expect(canDrop(d, { from: 'tab', col: 0, idx: 1 }, { to: 'found', suit: 0 })).toBe(true)
    expect(canDrop(d, { from: 'tab', col: 0, idx: 1 }, { to: 'found', suit: 1 })).toBe(false)
    // The 2♥ with the A♠ on it is a run: not to a foundation.
    expect(canDrop(d, { from: 'tab', col: 0, idx: 0 }, { to: 'found', suit: 1 })).toBe(false)
  })
})

describe('solitaire dead ends', () => {
  it('sees a table with no way forward', () => {
    // Two hidden cards under lone face-up cards that fit nowhere; the deck is empty.
    const d = mk({
      tab: [
        [card(0, 2), card(1, 9)],
        [card(3, 4), card(2, 7)],
      ],
      down: [1, 1],
    })
    expect(stuck(d)).toBe(true)
  })

  it('is not stuck while a deck card can still come out', () => {
    const d = mk({ tab: [[card(0, 2), card(1, 9)]], down: [1], stock: [card(3, 1)] })
    expect(stuck(d)).toBe(false)
  })

  it('finds a way out that starts with a pointless-looking move', () => {
    // 5♥ sits on 6♠ over a hidden card. Moving the 5♥ onto the 6♣ uncovers the
    // 6♠, which can go home onto the 5♠. Without the spades built to 5, shuffling
    // the 5♥ between the sixes is all that is left.
    const tab = [[card(2, 1), card(0, 6), card(1, 5)], [card(3, 6)]]
    expect(stuck(mk({ tab, down: [1, 0], found: [5, 0, 0, 0] }))).toBe(false)
    expect(stuck(mk({ tab, down: [1, 0] }))).toBe(true)
  })

  it('is never stuck once every card is home', () => {
    expect(stuck(mk({ found: [13, 13, 13, 13] }))).toBe(false)
  })
})

describe('solitaire bot sense', () => {
  it('does not shuffle a run between two equal parents', () => {
    // 5♥ on 6♠ could hop onto 6♣ and back forever: the bot draws instead.
    const d = mk({ tab: [[card(0, 6), card(1, 5)], [card(3, 6)]], stock: [card(2, 12)] })
    expect(chooseAction(d, 'hard', new Rng(1))).toEqual({ kind: 'draw' })
  })

  it('lifts a run off its parent when the card under it can then go home', () => {
    const d = mk({
      tab: [[card(2, 1), card(0, 6), card(1, 5)], [card(3, 6)]],
      down: [1, 0],
      found: [5, 0, 0, 0],
    })
    expect(chooseAction(d, 'hard', new Rng(1))).toEqual({
      kind: 'play',
      src: { from: 'tab', col: 0, idx: 2 },
      dst: { to: 'tab', col: 1 },
    })
  })

  it('deals races the best computer can clear, the same for the same seed', () => {
    for (const seed of [3, 40, 777]) {
      const d = playableDeal(seed)
      expect(clears(d)).toBe(true)
      expect(playableDeal(seed)).toEqual(d)
    }
  })

  it('deals tougher races on harder levels, and ramps over a match', () => {
    expect(tierFor('easy', 0)).toBe(0)
    expect(tierFor('normal', 0)).toBe(1)
    expect(tierFor('hard', 0)).toBe(2)
    expect(tierFor('easy', 2)).toBe(1)
    expect(tierFor('hard', 4)).toBe(2)
    let easy = 0
    let hard = 0
    for (const seed of [5, 50, 500, 5000]) {
      const e = playableDeal(seed, 0)
      const h = playableDeal(seed, 2)
      expect(dealTier(e)).toBe(0)
      expect(dealTier(h)).toBe(2)
      easy += clearIn(e)
      hard += clearIn(h)
    }
    // Hard deals take careful play longer to clear.
    expect(hard).toBeGreaterThan(easy)
  })

  it('never peeks at the face-down stock', () => {
    // A king hides in the stock; emptying a column for it is pointless until it shows.
    const d = mk({
      tab: [[card(0, 12)], [card(1, 13)]],
      stock: [card(3, 13)],
    })
    // Q♠ onto K♥ empties column 0: worth it only for a king the bot can see.
    const act = chooseAction(d, 'hard', new Rng(1))
    expect(act).toEqual({ kind: 'draw' })
    const seen = mk({ tab: [[card(0, 12)], [card(1, 13)]], waste: [card(3, 13)] })
    expect(chooseAction(seen, 'hard', new Rng(1))?.kind).toBe('play')
  })

  it('hard beats easy in a race on the same deal most of the time', () => {
    /** Seconds to clear (or Infinity), at the level's pace, within the 4-minute cap. */
    const race = (d: Deal, lv: 'easy' | 'hard', seed: number): [number, number] => {
      const rng = new Rng(seed)
      let b = d
      let t = 0
      while (t < 240 && home(b) < CARDS) {
        t += PACE[lv]
        const a = chooseAction(b, lv, rng)
        if (!a) break
        b = a.kind === 'draw' ? (draw(b) ?? b) : apply(b, a.src, a.dst)
      }
      return [home(b) === CARDS ? t : Infinity, home(b)]
    }
    let hardWins = 0
    for (let i = 0; i < 10; i++) {
      const d = playableDeal(i * 53, 1)
      const [th, hh] = race(d, 'hard', i)
      const [te, he] = race(d, 'easy', i + 50)
      if (th < te || (th === te && hh > he)) hardWins++
    }
    expect(hardWins).toBeGreaterThanOrEqual(8)
  })

  it('plays clearly better on hard than on easy', () => {
    const score = (lv: 'easy' | 'hard'): number => {
      let total = 0
      for (let i = 0; i < 12; i++) {
        let b = playableDeal(i * 31)
        const rng = new Rng(i)
        for (let k = 0; k < Math.floor(240 / PACE[lv]); k++) {
          const a = chooseAction(b, lv, rng)
          if (!a) break
          b = a.kind === 'draw' ? (draw(b) ?? b) : apply(b, a.src, a.dst)
          if (stuck(b)) break
        }
        total += home(b)
      }
      return total
    }
    expect(score('hard')).toBeGreaterThan(score('easy') + 40)
  })
})
