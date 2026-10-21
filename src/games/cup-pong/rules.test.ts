import { describe, expect, it } from 'vitest'
import { type Difficulty, other, type Side, STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { H, W } from '../../core/stage.ts'
import { choose } from './bot.ts'
import {
  advance,
  BALL,
  cupAt,
  cupsOf,
  fire,
  FULL_FLICK,
  IN_R,
  landingOf,
  MIN_FLICK,
  newState,
  originOf,
  type State,
  shotFromFlick,
  standing,
  standingWinner,
  sunkBy,
} from './rules.ts'
import type { Event } from './rules.ts'
import { launch, type ShotParams, stepShell } from '../../engines/aim/index.ts'

/** A shot from `side` aimed straight at a world point, with the power that lands it there. */
function shotAt(side: Side, x: number, y: number): ShotParams {
  const o = originOf(side)
  const dx = x - o.x
  const dy = y - o.y
  const len = Math.hypot(dx, dy)
  // Find the power that lands the first ground contact on (x, y), by bisection.
  let lo = 0.2
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const p = (lo + hi) / 2
    const land = landingOf(side, { dx: dx / len, dy: dy / len, power: p })
    if (Math.hypot(land.x - x, land.y - y) < 1) return { dx: dx / len, dy: dy / len, power: p }
    const reach = Math.hypot(land.x - o.x, land.y - o.y)
    if (reach < len) lo = p
    else hi = p
  }
  return { dx: dx / len, dy: dy / len, power: (lo + hi) / 2 }
}

/** Put a ball in flight at a point with a given height and velocity. */
function setBall(
  s: State,
  side: Side,
  p: { x: number; y: number; z: number; vx?: number; vy?: number; vz?: number },
): void {
  s.ball = {
    side,
    shell: { x: p.x, y: p.y, z: p.z, vx: p.vx ?? 0, vy: p.vy ?? 0, vz: p.vz ?? 0, t: 0 },
    bounces: 0,
  }
  s.phase = 'fly'
}

/** Advance until the shot is over (the beat has started) or the bound is hit. */
function play(s: State, steps = 60 * 12): Event[] {
  const out: Event[] = []
  for (let i = 0; i < steps && s.phase === 'fly'; i++) out.push(...advance(s, STEP).events)
  return out
}

describe('cup pong geometry', () => {
  it('each side has a triangle of six cups at its own end', () => {
    for (const side of [0, 1] as Side[]) {
      const cups = cupsOf(side)
      expect(cups.length).toBe(6)
      expect(cups.every((c) => c.side === side && c.alive)).toBe(true)
      const ys = cups.map((c) => c.y)
      if (side === 0) expect(Math.min(...ys)).toBeGreaterThan(H * 0.7)
      else expect(Math.max(...ys)).toBeLessThan(H * 0.3)
    }
  })

  it('blue’s cups are red’s turned half a turn about the middle', () => {
    const red = cupsOf(0)
    const blue = cupsOf(1)
    for (let i = 0; i < 6; i++) {
      expect(blue[i]?.x).toBeCloseTo(W - (red[i]?.x ?? 0), 6)
      expect(blue[i]?.y).toBeCloseTo(H - (red[i]?.y ?? 0), 6)
    }
  })

  it('a ball counts for a cup only when it is inside the rim', () => {
    const s = newState(0)
    const c = s.cups.find((k) => k.side === 1)
    if (!c) throw new Error('no cup')
    const i = s.cups.indexOf(c)
    expect(cupAt(s, 0, c.x, c.y)).toBe(i)
    expect(cupAt(s, 0, c.x + IN_R - 2, c.y)).toBe(i)
    expect(cupAt(s, 0, c.x + IN_R + 4, c.y)).toBe(-1)
  })

  it('a ball never counts for its own side’s cups', () => {
    const s = newState(0)
    const own = s.cups.find((k) => k.side === 0)
    if (!own) throw new Error('no cup')
    expect(cupAt(s, 0, own.x, own.y)).toBe(-1)
  })
})

describe('cup pong flick', () => {
  it('a short flick, or one toward the thrower, is no shot', () => {
    expect(shotFromFlick(0, 0, -MIN_FLICK + 5)).toBeNull()
    expect(shotFromFlick(0, 0, 200)).toBeNull()
    expect(shotFromFlick(1, 0, -200)).toBeNull()
    expect(shotFromFlick(1, 0, 200)).not.toBeNull()
  })

  it('a flick toward the rival is a shot; its length is the power', () => {
    const half = shotFromFlick(0, 0, -FULL_FLICK / 2)
    expect(half?.power).toBeCloseTo(0.5, 6)
    expect(half?.dy).toBeCloseTo(-1, 6)
    expect(shotFromFlick(0, 0, -FULL_FLICK * 3)?.power).toBe(1)
    expect(shotFromFlick(1, 0, FULL_FLICK / 2)?.dy).toBeCloseTo(1, 6)
  })

  it('a flick that lands on a rival cup scores', () => {
    const s = newState(0)
    const target = s.cups.find((c) => c.side === 1)
    if (!target) throw new Error('no cup')
    fire(s, 0, shotAt(0, target.x, target.y))
    const ev = play(s)
    expect(ev.some((e) => e.kind === 'cup')).toBe(true)
    expect(target.alive).toBe(false)
    expect(sunkBy(s, 0)).toBe(1)
    expect(s.phase).toBe('beat')
  })

  it('a ball that drops in at its first touch scores without a bounce', () => {
    const s = newState(0)
    const target = s.cups.find((c) => c.side === 1)
    if (!target) throw new Error('no cup')
    setBall(s, 0, { x: target.x, y: target.y, z: 0.5, vz: -20 })
    const ev = play(s)
    expect(ev.some((e) => e.kind === 'cup')).toBe(true)
    expect(ev.some((e) => e.kind === 'bounce')).toBe(false)
  })

  it('a ball that bounces on the table can still drop in on its second touch', () => {
    const s = newState(0)
    const target = s.cups.find((c) => c.side === 1)
    if (!target) throw new Error('no cup')
    // First touch just outside the rim; the bounce carries it back into the cup.
    setBall(s, 0, { x: target.x - 60, y: target.y, z: 0.5, vx: 200, vz: -300 })
    const ev = play(s)
    expect(ev.some((e) => e.kind === 'bounce')).toBe(true)
    expect(ev.some((e) => e.kind === 'cup')).toBe(true)
  })

  it('one bounce is allowed, a second landing outside the cups is a miss', () => {
    const s = newState(0)
    // Land well away from any cup, in the middle of the table.
    setBall(s, 0, { x: 500, y: 900, z: 0.5, vz: -10 })
    const ev = play(s)
    expect(ev.some((e) => e.kind === 'bounce')).toBe(true)
    expect(ev.some((e) => e.kind === 'miss' && !e.out)).toBe(true)
    expect(s.cups.every((c) => c.alive)).toBe(true)
  })

  it('a ball that leaves the table is out', () => {
    const s = newState(0)
    setBall(s, 0, { x: 500, y: -20, z: 200, vy: -900 })
    const ev = play(s, 600)
    expect(ev.some((e) => e.kind === 'miss' && e.out)).toBe(true)
  })

  it('a shot in the air is above the table: it only lands when its height reaches zero', () => {
    const shot = shotAt(0, 500, 500)
    const o = originOf(0)
    const sh = launch(o.x, o.y, shot, BALL)
    stepShell(sh, STEP, 0, BALL)
    expect(sh.z).toBeGreaterThan(0)
  })
})

describe('cup pong rules', () => {
  it('a turn passes after the beat, and the first side with no cups left wins', () => {
    const s = newState(0)
    const target = s.cups.find((c) => c.side === 1)
    if (!target) throw new Error('no cup')
    for (const c of s.cups) if (c.side === 1 && c !== target) c.alive = false
    fire(s, 0, shotAt(0, target.x, target.y))
    let winner: Side | null = null
    for (let i = 0; i < 60 * 6 && winner === null; i++) {
      winner = advance(s, STEP).winner
    }
    expect(winner).toBe(0)
    expect(standingWinner(s)).toBe(0)
    expect(standing(s, 1)).toBe(0)
  })

  it('a missed shot passes the turn to the rival', () => {
    const s = newState(0)
    fire(s, 0, { dx: 0, dy: -1, power: 0.3 })
    let flip = false
    for (let i = 0; i < 60 * 6 && s.phase !== 'aim'; i++) {
      const r = advance(s, STEP)
      if (r.events.some((e) => e.kind === 'turn')) flip = true
    }
    expect(flip).toBe(true)
    expect(s.turn).toBe(1)
  })

  it('the bot’s flick lands near a cup it chose (hard, direct)', () => {
    const s = newState(0)
    const rng = new Rng(11)
    let close = 0
    for (let i = 0; i < 8; i++) {
      const shot = choose(s, 0, 'hard', rng)
      const land = landingOf(0, shot)
      const best = Math.min(
        ...s.cups
          .filter((c) => c.side === 1 && c.alive)
          .map((c) => Math.hypot(land.x - c.x, land.y - c.y)),
      )
      if (best < IN_R + 10) close++
    }
    expect(close).toBeGreaterThanOrEqual(6)
  })

  it('the same seed plays the same way', () => {
    const run = () => {
      const s = newState(1)
      const rng = new Rng(4)
      const log: string[] = []
      for (let i = 0; i < 60 * 60; i++) {
        if (s.phase === 'aim') {
          const shot = choose(s, s.turn, 'normal', rng)
          fire(s, s.turn, shot)
          log.push(`${s.turn}:${shot.power.toFixed(3)}`)
        }
        for (const e of advance(s, STEP).events) log.push(e.kind)
      }
      return log.join(',')
    }
    expect(run()).toBe(run())
  })
})

function duel(a: Difficulty, b: Difficulty, seed: number): { s: State; steps: number } {
  const rng = new Rng(seed)
  const s = newState(rng.chance(0.5) ? 0 : 1)
  let steps = 0
  while (standingWinner(s) === null && steps < 60 * 60 * 15) {
    if (s.phase === 'aim') {
      const d = s.turn === 0 ? a : b
      fire(s, s.turn, choose(s, s.turn, d, rng))
    }
    advance(s, STEP)
    steps++
  }
  return { s, steps }
}

describe('cup pong bot', () => {
  it('bot vs bot clears a side’s cups within bounded steps', () => {
    const r = duel('normal', 'normal', 2)
    expect(standingWinner(r.s)).not.toBeNull()
    expect(r.steps).toBeLessThan(60 * 60 * 15)
  })

  it('a bot plays either side', () => {
    const r = duel('hard', 'hard', 9)
    expect(standingWinner(r.s)).not.toBeNull()
    expect(sunkBy(r.s, 0) + sunkBy(r.s, 1)).toBeGreaterThanOrEqual(6)
    expect(other(0)).toBe(1)
  })

  it('a hard bot beats an easy one most of the time', () => {
    let wins = 0
    for (let seed = 1; seed <= 6; seed++) {
      const r = duel('hard', 'easy', seed)
      if (standingWinner(r.s) === 0) wins++
    }
    expect(wins).toBeGreaterThanOrEqual(4)
  })
})
