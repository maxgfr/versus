import { describe, expect, it } from 'vitest'
import { type Difficulty, type Side, STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { KnifeBot } from './bot.ts'
import {
  advance,
  arrivalPhi,
  blocked,
  CLEAR_PAUSE,
  circDist,
  COOLDOWN,
  FLY,
  frontOf,
  KNIFE_W,
  KNIVES,
  LIVES,
  type Log,
  newState,
  PATTERNS,
  spinAt,
  STAGES,
  type State,
  throwKnife,
} from './rules.ts'

/** Run the clock for `seconds`, collecting event kinds. */
function run(s: State, rng: Rng, seconds: number): Set<string> {
  const seen = new Set<string>()
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    for (const e of advance(s, STEP, rng)) seen.add(e.kind)
    if (s.ended) break
  }
  return seen
}

/** Freeze a log so tests are exact: no spin. */
function freeze(l: Log): void {
  l.w = 0
}

/** Throw one knife now and wait for it to land. */
function throwAndLand(s: State, side: Side, rng: Rng): Set<string> {
  expect(throwKnife(s, side)).toBe(true)
  return run(s, rng, FLY + STEP * 2)
}

/** Play out a match between two computer players, bounded. */
function playMatch(
  a: Difficulty,
  b: Difficulty,
  seed: number,
): { winner: Side | 'draw' | null; steps: number; cleared: [number, number] } {
  const rng = new Rng(seed)
  const s = newState(rng)
  const bots = [new KnifeBot(0, a), new KnifeBot(1, b)]
  let steps = 0
  while (!s.ended && steps < 60 * 60 * 6) {
    for (const bot of bots) bot.step(s, STEP, rng)
    advance(s, STEP, rng)
    steps++
  }
  return { winner: s.winner, steps, cleared: s.cleared }
}

describe('knife thrower: the throw', () => {
  it('a knife is in the air for FLY seconds, then sticks in the log', () => {
    const rng = new Rng(1)
    const s = newState(rng)
    freeze(s.logs[0])
    expect(throwKnife(s, 0)).toBe(true)
    expect(s.flying).toHaveLength(1)
    const early = run(s, rng, FLY / 2)
    expect(early.has('stick')).toBe(false)
    const late = run(s, rng, FLY)
    expect(late.has('stick')).toBe(true)
    expect(s.logs[0].stuck).toHaveLength(1)
  })

  it('a knife can only be thrown once per cooldown', () => {
    const s = newState(new Rng(2))
    expect(throwKnife(s, 0)).toBe(true)
    expect(throwKnife(s, 0)).toBe(false)
    run(s, new Rng(2), COOLDOWN + STEP)
    expect(throwKnife(s, 0)).toBe(true)
  })

  it('nothing is thrown once the match is over', () => {
    const s = newState(new Rng(3))
    s.ended = true
    expect(throwKnife(s, 0)).toBe(false)
  })
})

describe('knife thrower: sticking and failing', () => {
  it('a knife in a clear gap sticks, and keeps its place as the log turns', () => {
    const rng = new Rng(4)
    const s = newState(rng)
    const l = s.logs[0]
    freeze(l)
    throwAndLand(s, 0, rng)
    const phi = l.stuck[0] as number
    expect(phi).toBeCloseTo(frontOf(l.a), 1)
    l.w = 2
    run(s, rng, 1)
    expect(l.stuck[0]).toBe(phi)
  })

  it('hitting a stuck knife costs a life and the knife does not stick', () => {
    const rng = new Rng(5)
    const s = newState(rng)
    const l = s.logs[0]
    freeze(l)
    throwAndLand(s, 0, rng)
    run(s, rng, COOLDOWN)
    const ev = throwAndLand(s, 0, rng)
    expect(ev.has('fail')).toBe(true)
    expect(l.lives).toBe(LIVES - 1)
    expect(l.stuck).toHaveLength(1)
  })

  it('knives closer than the knife width clash, further apart clear', () => {
    expect(circDist(0, KNIFE_W * 0.9)).toBeLessThan(KNIFE_W)
    expect(circDist(0, KNIFE_W * 1.5)).toBeGreaterThan(KNIFE_W)
    // Wraps around the circle: 0 and 2π-ε are neighbours.
    expect(circDist(0, Math.PI * 2 - KNIFE_W * 0.5)).toBeLessThan(KNIFE_W)
  })

  it('two lives: the second fail ends the match for that player', () => {
    const rng = new Rng(6)
    const s = newState(rng)
    freeze(s.logs[0])
    throwAndLand(s, 0, rng)
    run(s, rng, COOLDOWN)
    throwAndLand(s, 0, rng)
    run(s, rng, COOLDOWN)
    throwAndLand(s, 0, rng)
    expect(s.logs[0].lives).toBe(0)
    expect(s.ended).toBe(true)
    expect(s.winner).toBe(1)
  })

  it('the rival running out of lives gives the win to the other player', () => {
    const rng = new Rng(7)
    const s = newState(rng)
    freeze(s.logs[1])
    throwAndLand(s, 1, rng)
    run(s, rng, COOLDOWN)
    throwAndLand(s, 1, rng)
    run(s, rng, COOLDOWN)
    throwAndLand(s, 1, rng)
    expect(s.winner).toBe(0)
  })
})

describe('knife thrower: stages', () => {
  it('sticking the stage count clears it, pauses the log, then moves to the next pattern', () => {
    const rng = new Rng(8)
    const s = newState(rng)
    const l = s.logs[0]
    // Spin steadily so each knife lands in a fresh gap (about 1.2 rad apart).
    l.w = 2.2
    const need = KNIVES[0] ?? 5
    let cleared = false
    for (let i = 0; i < need; i++) {
      const ev = throwAndLand(s, 0, rng)
      if (ev.has('cleared')) cleared = true
      run(s, rng, 0.6)
    }
    expect(cleared).toBe(true)
    expect(s.cleared[0]).toBe(1)
    expect(l.pause).toBeGreaterThan(0)
    expect(l.stuck.length).toBe(need)
    run(s, rng, CLEAR_PAUSE + STEP * 2)
    expect(l.stage).toBe(2)
    expect(l.stuck).toEqual([])
    expect(PATTERNS[1]?.kind).toBe('flip')
  })

  it('a log is inert during its pause: no throws', () => {
    const s = newState(new Rng(9))
    s.logs[0].pause = CLEAR_PAUSE
    expect(throwKnife(s, 0)).toBe(false)
  })

  it('the last stage cleared wins the match', () => {
    const rng = new Rng(10)
    const s = newState(rng)
    const l = s.logs[0]
    l.stage = STAGES
    const need = KNIVES[STAGES - 1] ?? 7
    // All but one knife already in, packed on one side of the log.
    l.stuck = Array.from({ length: need - 1 }, (_, i) => i * KNIFE_W * 2.2)
    // Wait for the open side to come round, then throw the last one.
    for (let i = 0; i < 600 && blocked(l, arrivalPhi(l, FLY), 0.15); i++) run(s, rng, STEP)
    throwAndLand(s, 0, rng)
    expect(s.ended).toBe(true)
    expect(s.winner).toBe(0)
    expect(s.cleared[0]).toBe(1)
  })

  it('the flip pattern reverses the spin on its period', () => {
    const rng = new Rng(11)
    const s = newState(rng)
    const l = s.logs[0]
    l.stage = 2
    l.sign = 1
    l.w = PATTERNS[1]?.w ?? 2.8
    const before = l.w
    run(s, rng, (PATTERNS[1]?.period ?? 2) + STEP * 2)
    expect(Math.sign(l.w)).toBe(-Math.sign(before))
  })

  it('the wave pattern changes speed over time', () => {
    const l = { stage: 3, sign: 1, t: 0, w: 0 } as Log
    const a = spinAt(l)
    l.t = 1.2
    expect(spinAt(l)).not.toBeCloseTo(a)
  })
})

describe('knife thrower: computer players', () => {
  it('the bot throws only into a clear gap, and loses no life on an easy start', () => {
    const rng = new Rng(12)
    const s = newState(rng)
    const bot = new KnifeBot(0, 'hard')
    let throws = 0
    for (let i = 0; i < 60 * 3; i++) {
      if (bot.step(s, STEP, rng)) throws++
      advance(s, STEP, rng)
    }
    expect(throws).toBeGreaterThan(0)
    expect(s.logs[0].lives).toBe(LIVES)
  })

  it('a hard bot clears more knives than an easy one', () => {
    let hard = 0
    let easy = 0
    for (let seed = 1; seed <= 4; seed++) {
      const h = playMatch('hard', 'easy', seed)
      hard += h.cleared[0]
      easy += h.cleared[1]
    }
    expect(hard).toBeGreaterThan(easy)
  })

  it('a bot match ends in bounded steps', () => {
    for (let seed = 1; seed <= 3; seed++) {
      const r = playMatch('normal', 'normal', seed)
      expect(r.winner).not.toBeNull()
      expect(r.steps).toBeLessThan(60 * 60 * 6)
    }
  })
})
