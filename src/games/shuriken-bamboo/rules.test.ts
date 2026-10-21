import { describe, expect, it } from 'vitest'
import { type Difficulty, type Side, STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { Bot } from './bot.ts'
import {
  advance,
  type Aim,
  COOL,
  FULL,
  GOLD,
  GROW_TIME,
  HIT_H,
  HIT_R,
  leader,
  MATCH,
  newState,
  REGROW,
  SHURI_SPEED,
  SHURI_Z,
  type Stalk,
  type State,
  STUMP,
  THROW_Y,
} from './rules.ts'
import type { Event } from './rules.ts'

const rng = () => new Rng(5)

/** A match where the stalks stand still and tall, so a test can aim at a known one. */
function still(): State {
  const s = newState(rng())
  for (const st of s.stalks) {
    st.state = 'up'
    st.h = FULL
    st.gold = false
  }
  return s
}

/** A straight throw from `side`'s line at the stalk `st`. */
function aimAt(side: Side, st: Stalk): Aim {
  const y0 = THROW_Y[side] ?? 0
  const x = st.x
  const len = Math.hypot(st.x - x, st.y - y0)
  return { x, dx: (st.x - x) / len, dy: (st.y - y0) / len }
}

/** Advance until nothing is in flight or the bound is hit; returns the events. */
function settle(s: State, steps = 600): Event[] {
  const out: Event[] = []
  for (let i = 0; i < steps && s.shuris.length > 0; i++) {
    out.push(...advance(s, STEP, [null, null], rng()))
  }
  return out
}

describe('shuriken bamboo rules', () => {
  it('a stalk grows from nothing to full height in GROW_TIME', () => {
    const s = newState(rng())
    const st = s.stalks[0] as Stalk
    st.state = 'grow'
    st.h = 0
    for (let i = 0; i < Math.round(GROW_TIME * 60) + 2; i++) advance(s, STEP, [null, null], rng())
    expect(st.state).toBe('up')
    expect(st.h).toBe(FULL)
  })

  it('a shuriken flying into a standing stalk slices the top off and scores one point', () => {
    const s = still()
    const st = s.stalks[1] as Stalk
    advance(s, STEP, [aimAt(0, st), null], rng())
    const events = settle(s)
    expect(events.find((e) => e.kind === 'slice')).toMatchObject({
      kind: 'slice',
      side: 0,
      gold: false,
      points: 1,
    })
    expect(s.score).toEqual([1, 0])
    expect(st.state).toBe('stump')
    expect(st.h).toBe(STUMP)
    expect(s.fallen.length).toBe(1)
    expect(s.shuris.length).toBe(0)
  })

  it('golden bamboo is worth three', () => {
    const s = still()
    const st = s.stalks[2] as Stalk
    st.gold = true
    advance(s, STEP, [null, aimAt(1, st)], rng())
    settle(s)
    expect(s.score).toEqual([0, 3])
  })

  it('a stalk too short for a shuriken to reach is not sliced', () => {
    const s = still()
    const st = s.stalks[3] as Stalk
    st.h = 60
    st.state = 'grow'
    // The shuriken is already at the stalk's ground position; it passes over the young shoot.
    s.shuris.push({ side: 0, x: st.x, y: st.y + 4, dx: 0, dy: -1, spin: 0, t: 0 })
    const events = settle(s)
    expect(events.some((e) => e.kind === 'slice')).toBe(false)
    expect(s.score).toEqual([0, 0])
  })

  it('a stump cannot be sliced again, and regrows after REGROW seconds', () => {
    const s = still()
    const st = s.stalks[1] as Stalk
    st.state = 'stump'
    st.h = STUMP
    st.wait = REGROW
    s.shuris.push({ side: 0, x: st.x, y: st.y + 4, dx: 0, dy: -1, spin: 0, t: 0 })
    const t0 = s.t
    expect(settle(s).some((e) => e.kind === 'slice')).toBe(false)
    while (st.state === 'stump' && s.t - t0 < 5) advance(s, STEP, [null, null], rng())
    expect(st.state).toBe('grow')
    expect(s.t - t0).toBeCloseTo(REGROW, 0)
    expect(st.h).toBeLessThan(HIT_H)
  })

  it('a stalk regrows golden only by chance', () => {
    let gold = 0
    for (let seed = 1; seed <= 300; seed++) {
      const s = newState(new Rng(seed))
      const st = s.stalks[0] as Stalk
      st.state = 'stump'
      st.h = STUMP
      st.wait = 0.001
      advance(s, STEP, [null, null], new Rng(seed * 7))
      if (st.gold) gold++
    }
    expect(gold / 300).toBeGreaterThan(GOLD - 0.12)
    expect(gold / 300).toBeLessThan(GOLD + 0.12)
  })

  it('a throw waits out its cooldown', () => {
    const s = still()
    const a = aimAt(0, s.stalks[1] as Stalk)
    const throws = (ev: Event[]) => ev.filter((e) => e.kind === 'throw').length
    expect(throws(advance(s, STEP, [a, null], rng()))).toBe(1)
    expect(throws(advance(s, STEP, [a, null], rng()))).toBe(0)
    let n = 0
    for (let i = 0; i < Math.ceil(COOL * 60) + 2; i++)
      n += throws(advance(s, STEP, [null, null], rng()))
    expect(n).toBe(0)
    expect(throws(advance(s, STEP, [a, null], rng()))).toBe(1)
  })

  it('a shuriken that flies off the table is a miss', () => {
    const s = still()
    advance(s, STEP, [{ x: 500, dx: 1, dy: 0 }, null], rng())
    const events = settle(s, 600)
    expect(events.some((e) => e.kind === 'miss')).toBe(true)
    expect(s.shuris.length).toBe(0)
  })

  it('a fast shuriken does not skip a thin stalk between steps', () => {
    const s = still()
    const st = s.stalks[1] as Stalk
    // Put a shuriken just above the stalk, moving through it at full speed.
    s.shuris.push({
      side: 0,
      x: st.x - SHURI_SPEED * STEP * 0.5 + 0.1,
      y: st.y + 2 * HIT_R,
      dx: 0,
      dy: -1,
      spin: 0,
      t: 0,
    })
    const events = advance(s, STEP, [null, null], rng())
    expect(events.some((e) => e.kind === 'slice')).toBe(false)
    expect(SHURI_Z).toBeLessThan(HIT_H)
  })

  it('a match lasts 45 seconds and then nothing more is thrown', () => {
    const s = still()
    for (let i = 0; i < MATCH * 60 + 2; i++) advance(s, STEP, [null, null], rng())
    expect(s.left).toBe(0)
    expect(advance(s, STEP, [aimAt(0, s.stalks[1] as Stalk), null], rng())).toEqual([])
    expect(s.shuris.length).toBe(0)
  })

  it('the most points wins, equal points is a tie', () => {
    const s = still()
    s.score = [4, 2]
    expect(leader(s)).toBe(0)
    s.score = [5, 5]
    expect(leader(s)).toBeNull()
    s.score = [0, 6]
    expect(leader(s)).toBe(1)
  })

  it('the clock ticks in the last five seconds', () => {
    const s = still()
    s.left = 5.05
    const ev: Event[] = []
    for (let i = 0; i < 300; i++) ev.push(...advance(s, STEP, [null, null], rng()))
    expect(ev.filter((e) => e.kind === 'tick').length).toBeGreaterThanOrEqual(4)
  })
})

function duel(a: Difficulty, b: Difficulty, seed: number): { s: State; steps: number } {
  const r = new Rng(seed)
  const s = newState(r)
  const bots = [new Bot(a, r.fork()), new Bot(b, r.fork())] as const
  let steps = 0
  while (s.left > 0 && steps < 60 * 60) {
    const aims = [bots[0].tick(s, 0, STEP), bots[1].tick(s, 1, STEP)] as const
    advance(s, STEP, aims, r)
    steps++
  }
  return { s, steps }
}

describe('shuriken bamboo bot', () => {
  it('bot vs bot reaches the end of the match', () => {
    const r = duel('normal', 'normal', 3)
    expect(r.s.left).toBe(0)
    expect(r.steps).toBeGreaterThan(MATCH * 60 - 5)
    expect(r.steps).toBeLessThan(MATCH * 60 + 5)
  })

  it('bots of both sides cut bamboo', () => {
    const r = duel('normal', 'normal', 7)
    expect(r.s.score[0]).toBeGreaterThan(0)
    expect(r.s.score[1]).toBeGreaterThan(0)
  })

  it('a hard bot out-cuts an easy one most of the time', () => {
    let wins = 0
    for (let seed = 1; seed <= 6; seed++) {
      if (leader(duel('hard', 'easy', seed).s) === 0) wins++
    }
    expect(wins).toBeGreaterThanOrEqual(4)
  })
})
