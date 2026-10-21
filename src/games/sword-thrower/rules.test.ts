import { describe, expect, it } from 'vitest'
import { type Difficulty, type Side, STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { Bot } from './bot.ts'
import {
  advance,
  aimAngle,
  CAP,
  canThrow,
  centreAngle,
  freeShot,
  impactAngle,
  leader,
  MATCH,
  newState,
  PIVOT,
  REACH,
  RELOAD,
  RIM,
  SHIELD_Y,
  SPEED,
  SWAY,
  type State,
  targetOf,
  throwSword,
  wrap,
} from './rules.ts'
import type { Event } from './rules.ts'

/** A fresh match with the wander and sway pinned, so a test can reason about exact angles. */
function still(seed = 1): State {
  const s = newState(new Rng(seed))
  for (const sh of s.shields) {
    sh.dir = 1
    sh.ph = 0
  }
  s.sway = [Math.PI / 2, Math.PI / 2]
  return s
}

/** Throw from `side` straight at the rival shield's centre. */
function aimedThrow(s: State, side: Side): void {
  const a = centreAngle(s, side)
  // The sway is SWAY * sin(phase): solve for the phase that points at the centre.
  s.sway[side] = Math.asin(Math.max(-1, Math.min(1, a / SWAY)))
  expect(Math.abs(aimAngle(s, side) - a)).toBeLessThan(1e-9)
  throwSword(s, side)
}

/** Run until every sword in flight has resolved or the bound is hit. */
function settle(s: State, steps = 600): Event[] {
  const out: Event[] = []
  for (let i = 0; i < steps && s.swords.some((w) => !w.drop); i++) {
    out.push(...advance(s, STEP, [false, false]))
  }
  return out
}

describe('sword thrower geometry', () => {
  it('a throw at the centre angle of the rival shield hits it', () => {
    const s = still()
    for (const side of [0, 1] as Side[]) {
      const a = centreAngle(s, side)
      expect(impactAngle(s, side, a)).not.toBeNull()
      expect(freeShot(s, side, a)).toBe(true)
    }
  })

  it('a throw far to the side misses the target', () => {
    const s = still()
    expect(impactAngle(s, 0, 0.8)).toBeNull()
    expect(impactAngle(s, 1, -0.8)).toBeNull()
  })

  it('wrap keeps angles in [-π, π)', () => {
    expect(Math.abs(wrap(Math.PI * 3))).toBeCloseTo(Math.PI, 9)
    expect(Math.abs(wrap(-Math.PI * 3))).toBeCloseTo(Math.PI, 9)
    expect(wrap(0.5)).toBeCloseTo(0.5, 9)
  })

  it('shields sit in the far halves, symmetric about the midline', () => {
    expect((SHIELD_Y[0] ?? 0) + (SHIELD_Y[1] ?? 0)).toBe(1800)
    expect(SHIELD_Y[0] ?? 0).toBeLessThan(900)
    expect(SHIELD_Y[1] ?? 0).toBeGreaterThan(900)
    expect(REACH).toBeGreaterThan(RIM)
    expect(PIVOT[0]?.y).toBeGreaterThan(900)
    expect(PIVOT[1]?.y).toBeLessThan(900)
  })
})

describe('sword thrower rules', () => {
  it('a sword sticks into the rival shield and scores for the thrower', () => {
    const s = still()
    aimedThrow(s, 0)
    const events = settle(s)
    expect(events.find((e) => e.kind === 'stick')).toMatchObject({
      kind: 'stick',
      side: 0,
      shield: 1,
      count: 1,
    })
    expect(s.score).toEqual([1, 0])
    expect(targetOf(s, 0).stuck.length).toBe(1)
    expect(s.swords.length).toBe(0)
  })

  it('a sword that lands on a stuck one clangs off without scoring', () => {
    const s = still()
    const target = targetOf(s, 0)
    // Stick a sword where a sword from red's pivot meets the rim, then send one there.
    const th = impactAngle(s, 0, centreAngle(s, 0)) as number
    target.stuck.push({ a: th - target.rot, t: 0 })
    expect(freeShot(s, 0, centreAngle(s, 0))).toBe(false)
    const tx = target.x + Math.cos(th) * (REACH + 6)
    const ty = target.y + Math.sin(th) * (REACH + 6)
    s.swords.push({
      side: 0,
      x: tx,
      y: ty,
      vx: -Math.cos(th) * SPEED,
      vy: -Math.sin(th) * SPEED,
      drop: false,
      t: 0,
    })
    const events = settle(s)
    expect(events.some((e) => e.kind === 'clang' && !e.own)).toBe(true)
    expect(s.score).toEqual([0, 0])
  })

  it('stuck swords turn with the shield: the old angle is free after the spin', () => {
    const s = still()
    const target = targetOf(s, 0)
    const th = impactAngle(s, 0, centreAngle(s, 0)) as number
    target.stuck.push({ a: th - target.rot, t: 0 })
    target.rot += 1.1
    expect(freeShot(s, 0, centreAngle(s, 0))).toBe(true)
  })

  it('a full shield clears: its swords tumble off and it starts again', () => {
    const s = still()
    const target = targetOf(s, 0)
    target.stuck = Array.from({ length: CAP - 1 }, (_, i) => ({ a: 3 + i * 0.4, t: 0 }))
    aimedThrow(s, 0)
    const events = settle(s)
    expect(events.some((e) => e.kind === 'clear')).toBe(true)
    expect(target.stuck.length).toBe(0)
    expect(s.score[0]).toBe(1)
    expect(s.swords.filter((w) => w.drop).length).toBe(CAP)
  })

  it('a sword that reaches the thrower’s own shield clangs off it and scores nothing', () => {
    const s = still()
    const own = s.shields[0]
    s.swords.push({
      side: 0,
      x: own.x,
      y: own.y + REACH + 20,
      vx: 0,
      vy: -SPEED,
      drop: false,
      t: 0,
    })
    const events = settle(s)
    expect(events.some((e) => e.kind === 'clang' && e.own)).toBe(true)
    expect(s.score).toEqual([0, 0])
  })

  it('a sword that flies off the table is a miss', () => {
    const s = still()
    s.sway[1] = Math.asin(0.79 / SWAY)
    throwSword(s, 1)
    const events = settle(s, 2000)
    expect(events.some((e) => e.kind === 'miss')).toBe(true)
    expect(s.swords.length).toBe(0)
    expect(s.score).toEqual([0, 0])
  })

  it('a throw needs the reload to be done', () => {
    const s = still()
    expect(canThrow(s, 0)).toBe(true)
    throwSword(s, 0)
    expect(canThrow(s, 0)).toBe(false)
    const ev = advance(s, RELOAD / 2, [true, false])
    expect(ev.some((e) => e.kind === 'throw')).toBe(false)
    advance(s, RELOAD, [false, false])
    expect(canThrow(s, 0)).toBe(true)
  })

  it('taps while reloading do nothing', () => {
    const s = still()
    advance(s, STEP, [true, true])
    expect(s.swords.length).toBe(2)
    advance(s, STEP, [true, true])
    expect(s.swords.length).toBe(2)
  })

  it('the match ends after 45 seconds and no throw counts after that', () => {
    const s = still()
    for (let i = 0; i < MATCH * 60 + 2; i++) advance(s, STEP, [false, false])
    expect(s.left).toBe(0)
    expect(canThrow(s, 0)).toBe(false)
    expect(advance(s, STEP, [true, true])).toEqual([])
  })

  it('a match of another length ends on its own clock', () => {
    const s = newState(new Rng(1), 20)
    for (let i = 0; i < 19 * 60; i++) advance(s, STEP, [false, false])
    expect(s.left).toBeGreaterThan(0)
    for (let i = 0; i < 60 + 2; i++) advance(s, STEP, [false, false])
    expect(s.left).toBe(0)
  })

  it('the swords stuck in total decide the match; equal totals are a tie', () => {
    const s = still()
    s.score = [3, 1]
    expect(leader(s)).toBe(0)
    s.score = [2, 2]
    expect(leader(s)).toBeNull()
    s.score = [1, 4]
    expect(leader(s)).toBe(1)
  })

  it('the clock ticks in the last five seconds', () => {
    const s = still()
    s.left = 5.05
    const ev: Event[] = []
    for (let i = 0; i < 300; i++) ev.push(...advance(s, STEP, [false, false]))
    expect(ev.filter((e) => e.kind === 'tick').length).toBeGreaterThanOrEqual(4)
  })

  it('the same seed plays the same way', () => {
    const run = () => {
      const s = newState(new Rng(9))
      const log: string[] = []
      for (let i = 0; i < 1500; i++) {
        for (const e of advance(s, STEP, [i % 90 === 0, i % 70 === 0])) log.push(e.kind)
      }
      return log.join(',')
    }
    expect(run()).toBe(run())
  })
})

function duel(a: Difficulty, b: Difficulty, seed: number): { s: State; steps: number } {
  const rng = new Rng(seed)
  const s = newState(rng)
  const bots = [new Bot(a, rng.fork()), new Bot(b, rng.fork())] as const
  let steps = 0
  while (s.left > 0 && steps < 60 * 60) {
    const want: [boolean, boolean] = [bots[0].tick(s, 0, STEP), bots[1].tick(s, 1, STEP)]
    advance(s, STEP, want)
    steps++
  }
  return { s, steps }
}

describe('sword thrower bot', () => {
  it('bot vs bot reaches the end of the match', () => {
    const r = duel('normal', 'normal', 3)
    expect(r.s.left).toBe(0)
    expect(r.steps).toBeGreaterThan(MATCH * 60 - 5)
    expect(r.steps).toBeLessThan(MATCH * 60 + 5)
  })

  it('a hard bot out-sticks an easy one most of the time', () => {
    let wins = 0
    for (let seed = 1; seed <= 6; seed++) {
      if (leader(duel('hard', 'easy', seed).s) === 0) wins++
    }
    expect(wins).toBeGreaterThanOrEqual(4)
  })

  it('bots of both sides score', () => {
    const r = duel('normal', 'normal', 7)
    expect(r.s.score[0]).toBeGreaterThan(0)
    expect(r.s.score[1]).toBeGreaterThan(0)
  })
})
