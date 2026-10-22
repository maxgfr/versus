import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { ThiefBot } from './bot.ts'
import {
  AWAKE,
  bankAll,
  DRAG_RATE,
  inZone,
  LIMIT,
  napLength,
  PILE_START,
  STIR,
  STIR_MIN,
  stirLength,
  falseStir,
  FALSE_STIR_MAX,
  type Table,
  tableNew,
  tableStep,
  winnerOf,
  guardStep,
} from './rules.ts'

/** A table whose guard is asleep with a long nap left, so nothing wakes in the test. */
function quietTable(): Table {
  const t = tableNew(new Rng(1))
  t.guard = { phase: 'sleep', left: 1e9, wakes: 0 }
  return t
}

const total = (t: Table) =>
  t.pile + t.thieves[0].bag + t.thieves[0].stash + t.thieves[1].bag + t.thieves[1].stash

describe('light fingers rules', () => {
  it('drags gems from the pile while held, at the drag rate', () => {
    const t = quietTable()
    const rng = new Rng(2)
    for (let i = 0; i < 60; i++) tableStep(t, STEP, i * STEP, [true, false], rng)
    expect(t.thieves[0].stash).toBe(DRAG_RATE)
    expect(t.pile).toBe(PILE_START - DRAG_RATE)
    expect(t.thieves[1].stash).toBe(0)
  })

  it('banks the stash on release', () => {
    const t = quietTable()
    const rng = new Rng(3)
    for (let i = 0; i < 120; i++) tableStep(t, STEP, i * STEP, [true, false], rng)
    expect(t.thieves[0].stash).toBe(8)
    const evs = tableStep(t, STEP, 2, [false, false], rng)
    expect(evs).toContainEqual({ k: 'bank', side: 0, n: 8 })
    expect(t.thieves[0].bag).toBe(8)
    expect(t.thieves[0].stash).toBe(0)
    expect(t.thieves[0].bankedAt).toBe(2)
  })

  it('loses the stash of anyone still holding when the guard wakes', () => {
    const t = quietTable()
    const rng = new Rng(4)
    t.guard = { phase: 'stir', left: 0.6, wakes: 0 }
    for (let i = 0; i < 30; i++) tableStep(t, STEP, i * STEP, [true, false], rng)
    const before = t.pile
    const stash = t.thieves[0].stash
    expect(stash).toBeGreaterThan(0)
    // Keep holding until the guard wakes.
    let caught = 0
    for (let i = 0; i < 120 && t.guard.phase !== 'awake'; i++) {
      const evs = tableStep(t, STEP, 1 + i * STEP, [true, false], rng)
      for (const e of evs) if (e.k === 'caught') caught = e.n
    }
    expect(t.guard.phase).toBe('awake')
    expect(caught).toBeGreaterThan(0)
    expect(t.thieves[0].bag).toBe(0)
    expect(t.thieves[0].stash).toBe(0)
    expect(t.pile).toBeGreaterThan(before)
  })

  it('is safe if the finger lifts before the guard wakes', () => {
    const t = quietTable()
    const rng = new Rng(5)
    t.guard = { phase: 'stir', left: STIR, wakes: 0 }
    tableStep(t, STEP, 0, [true, false], rng)
    for (let i = 0; i < 40; i++) tableStep(t, STEP, i * STEP, [true, false], rng)
    tableStep(t, STEP, 1, [false, false], rng)
    expect(t.thieves[0].bag).toBeGreaterThan(0)
    expect(t.thieves[0].stash).toBe(0)
    expect(t.guard.phase).toBe('stir')
  })

  it('does not drag while the guard is awake', () => {
    const t = quietTable()
    const rng = new Rng(6)
    t.guard = { phase: 'awake', left: AWAKE, wakes: 1 }
    for (let i = 0; i < 60; i++) tableStep(t, STEP, i * STEP, [true, true], rng)
    expect(t.thieves[0].stash).toBe(0)
    expect(t.thieves[1].stash).toBe(0)
    expect(t.pile).toBe(PILE_START)
  })

  it('wakes, then goes back to sleep, on the guard timer', () => {
    const rng = new Rng(7)
    const g = { phase: 'sleep' as const, left: 0.5, wakes: 0 }
    const seen: string[] = []
    for (let i = 0; i < 60 * 12; i++) {
      const tr = guardStep(g, STEP, rng)
      if (tr) seen.push(tr)
    }
    // Every stir ends in a wake or a false alarm; every wake ends in sleep.
    seen.forEach((tr, i) => {
      if (tr === 'stir') expect(['wake', 'settle', undefined]).toContain(seen[i + 1])
      if (tr === 'wake') expect(['sleep', undefined]).toContain(seen[i + 1])
    })
    expect(seen).toContain('wake')
    expect(seen).toContain('sleep')
    expect(g.wakes).toBeGreaterThan(0)
  })

  it('the warning shrinks each wake, and false alarms get likelier (capped)', () => {
    expect(stirLength(0)).toBe(STIR)
    expect(stirLength(4)).toBeLessThan(STIR)
    expect(stirLength(50)).toBe(STIR_MIN)
    expect(falseStir(5)).toBeGreaterThan(falseStir(0))
    expect(falseStir(99)).toBe(FALSE_STIR_MAX)
  })

  it('a false alarm sends the guard back to sleep without waking or catching anyone', () => {
    let settled = 0
    for (let seed = 1; seed <= 40; seed++) {
      const rng = new Rng(seed)
      const t = tableNew(rng)
      t.guard = { phase: 'stir', left: STEP / 2, wakes: 5 }
      t.thieves[0].stash = 7
      t.thieves[0].holding = true
      const ev = tableStep(t, STEP, 1, [true, false], rng)
      if (ev.some((e) => e.k === 'settle')) {
        settled++
        expect(t.guard.phase).toBe('sleep')
        expect(t.guard.wakes).toBe(5)
        expect(ev.some((e) => e.k === 'caught')).toBe(false)
        expect(t.thieves[0].stash).toBeGreaterThanOrEqual(7)
      } else expect(t.guard.phase).toBe('awake')
    }
    expect(settled).toBeGreaterThan(0)
    expect(settled).toBeLessThan(40)
  })

  it('keeps every gem accounted for', () => {
    for (let seed = 0; seed < 20; seed++) {
      const rng = new Rng(seed)
      const t = tableNew(rng)
      const bots = [new ThiefBot(rng.fork(), 'normal'), new ThiefBot(rng.fork(), 'easy')]
      let time = 0
      for (let i = 0; i < 60 * 40; i++) {
        time += STEP
        const holds: [boolean, boolean] = [
          bots[0]!.decide(t.guard, time),
          bots[1]!.decide(t.guard, time),
        ]
        tableStep(t, STEP, time, holds, rng)
        expect(total(t)).toBe(PILE_START)
      }
    }
  })

  it('banks everything at the end and picks the bigger bag', () => {
    const t = quietTable()
    const rng = new Rng(8)
    for (let i = 0; i < 60; i++) tableStep(t, STEP, i * STEP, [false, true], rng)
    bankAll(t, 1)
    expect(t.thieves[1].stash).toBe(0)
    expect(t.thieves[1].bag).toBe(DRAG_RATE)
    expect(winnerOf(t)).toBe(1)
  })

  it('draws when the bags are level', () => {
    const t = quietTable()
    expect(winnerOf(t)).toBe('draw')
    t.thieves[0].bag = 5
    t.thieves[1].bag = 5
    expect(winnerOf(t)).toBe('draw')
    t.thieves[1].bag = 6
    expect(winnerOf(t)).toBe(1)
  })

  it('naps get shorter as the guard wakes more', () => {
    const lo = new Rng(9)
    const early = Array.from({ length: 200 }, () => napLength(0, lo))
    const late = Array.from({ length: 200 }, () => napLength(8, lo))
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(avg(late)).toBeLessThan(avg(early))
    expect(Math.min(...late)).toBeGreaterThanOrEqual(1.4)
  })

  it('the pile zone is the front of your half only', () => {
    expect(inZone(500, 1100)).toBe(true)
    expect(inZone(500, 900)).toBe(false)
    expect(inZone(20, 1100)).toBe(false)
    expect(inZone(500, 1800)).toBe(false)
  })
})

describe('light fingers bot vs bot', () => {
  /** A whole match between two bots, returning the winner. */
  function play(seed: number, a: 'easy' | 'normal' | 'hard', b: 'easy' | 'normal' | 'hard') {
    const rng = new Rng(seed)
    const t = tableNew(rng)
    const bots = [new ThiefBot(rng.fork(), a), new ThiefBot(rng.fork(), b)]
    let time = 0
    let steps = 0
    while (time < LIMIT) {
      time += STEP
      steps++
      const holds: [boolean, boolean] = [
        bots[0]!.decide(t.guard, time),
        bots[1]!.decide(t.guard, time),
      ]
      tableStep(t, STEP, time, holds, rng)
    }
    bankAll(t, time)
    return { winner: winnerOf(t), steps, bags: [t.thieves[0].bag, t.thieves[1].bag] as const }
  }

  it('reaches a result within the match length, for either side', () => {
    for (let seed = 0; seed < 10; seed++) {
      const r = play(seed, 'normal', 'normal')
      expect(r.steps).toBeLessThanOrEqual(LIMIT * 60 + 1)
      expect(['draw', 0, 1]).toContain(r.winner)
    }
  })

  it('hard thieves beat easy ones most of the time', () => {
    let hard = 0
    for (let seed = 0; seed < 30; seed++) {
      if (play(100 + seed, 'hard', 'easy').winner === 0) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(18)
  })

  it('hard out-thieves normal, and normal out-thieves easy, over a night', () => {
    let hard = 0
    let normal = 0
    let hb = 0
    let nb = 0
    for (let seed = 0; seed < 20; seed++) {
      const a = play(300 + seed, 'hard', 'normal')
      const b = play(300 + seed, 'normal', 'easy')
      if (a.winner === 0) hard++
      if (b.winner === 0) normal++
      hb += a.bags[0] - a.bags[1]
      nb += b.bags[0] - b.bags[1]
    }
    expect(hb).toBeGreaterThan(0)
    expect(nb).toBeGreaterThan(0)
    expect(hard).toBeGreaterThanOrEqual(11)
    expect(normal).toBeGreaterThanOrEqual(11)
  })

  it('both sides earn gems in a match', () => {
    const r = play(42, 'normal', 'normal')
    expect(r.bags[0]).toBeGreaterThan(0)
    expect(r.bags[1]).toBeGreaterThan(0)
  })
})
