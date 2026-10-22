import { describe, expect, it } from 'vitest'
import { type Difficulty, type Side, STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { type Plan, plan } from './bot.ts'
import {
  advance,
  ATHLETE,
  canSpin,
  HANDLE,
  idealAngle,
  inSector,
  leader,
  metres,
  METRE,
  newState,
  over,
  passed,
  predict,
  release,
  SECTOR,
  shotOf,
  SPIN0,
  SPIN1,
  spinSpeed,
  startSpin,
  stepSpin,
  THROWS,
  WIND,
  MAX_HOLD,
  mustRelease,
  PUMP_BONUS,
  swirl,
  SWIRL_FULL,
} from './rules.ts'
import type { Event, State } from './rules.ts'

/** Hold `side`'s spin until the handle passes its ideal angle, then let go. */
function throwAt(s: State, side: Side, holdSeconds: number, offset = 0): void {
  startSpin(s, side)
  const sp = s.spin
  if (!sp) throw new Error('no spin')
  const target = idealAngle(side) + offset
  // Wind for the hold, then wait for the handle to reach the target.
  for (let i = 0; i < Math.round(holdSeconds * 60); i++) stepSpin(s, STEP)
  for (let i = 0; i < 60 * 3 && !passed(sp.theta - sp.omega * STEP, sp.theta, target); i++) {
    stepSpin(s, STEP)
  }
  release(s)
}

/** Run the flight and beat until the turn passes (or the match is over). */
function settle(s: State): Event[] {
  const out: Event[] = []
  for (let i = 0; i < 60 * 12 && (s.phase !== 'aim' || s.flight); i++) {
    out.push(...advance(s, STEP))
    if (s.phase === 'aim' && !s.flight) break
  }
  return out
}

describe('hammer throw geometry', () => {
  it('the ideal release for red points up the table, for blue down', () => {
    expect(inSector(0, idealAngle(0))).toBe(true)
    expect(inSector(1, idealAngle(1))).toBe(true)
    const up = shotOf(idealAngle(0), 8)
    expect(up.dy).toBeLessThan(-0.99)
    const down = shotOf(idealAngle(1), 8)
    expect(down.dy).toBeGreaterThan(0.99)
  })

  it('the sector is a window of SECTOR either side of the ideal', () => {
    expect(inSector(0, idealAngle(0) + SECTOR * 0.95)).toBe(true)
    expect(inSector(0, idealAngle(0) + SECTOR * 1.05)).toBe(false)
    expect(inSector(1, idealAngle(1) - SECTOR * 0.95)).toBe(true)
    expect(inSector(1, idealAngle(1) + SECTOR * 1.05)).toBe(false)
  })

  it('the hand moves on the handle’s circle', () => {
    for (const side of [0, 1] as Side[]) {
      const a = ATHLETE[side] as { x: number; y: number }
      const hx = a.x + Math.cos(0.7) * HANDLE
      const hy = a.y + Math.sin(0.7) * HANDLE
      expect(Math.hypot(hx - a.x, hy - a.y)).toBeCloseTo(HANDLE, 6)
    }
  })
})

describe('hammer throw spin', () => {
  it('the spin speeds up from SPIN0 to SPIN1 over WIND seconds and no further', () => {
    expect(spinSpeed(0)).toBe(SPIN0)
    expect(spinSpeed(WIND)).toBe(SPIN1)
    expect(spinSpeed(WIND * 3)).toBe(SPIN1)
    expect(spinSpeed(WIND / 2)).toBeGreaterThan(SPIN0)
    expect(spinSpeed(WIND / 2)).toBeLessThan(SPIN1)
  })

  it('holding longer spins faster, and the handle turns while held', () => {
    const s = newState(0)
    startSpin(s, 0)
    const sp = s.spin
    if (!sp) throw new Error('no spin')
    const t0 = sp.theta
    stepSpin(s, STEP)
    expect(sp.theta).toBeGreaterThan(t0)
    for (let i = 0; i < 180; i++) stepSpin(s, STEP)
    expect(sp.omega).toBeCloseTo(SPIN1, 6)
  })

  it('a whirl is reported each half turn of the handle', () => {
    const s = newState(0)
    startSpin(s, 0)
    let whirls = 0
    for (let i = 0; i < 240; i++)
      whirls += stepSpin(s, STEP).filter((e) => e.kind === 'whirl').length
    expect(whirls).toBeGreaterThan(5)
  })

  it('a throw is only made on your own turn, while you are not in the air', () => {
    const s = newState(0)
    expect(canSpin(s, 0)).toBe(true)
    expect(canSpin(s, 1)).toBe(false)
    startSpin(s, 0)
    expect(canSpin(s, 0)).toBe(false)
  })

  it('passed() catches a handle crossing a target exactly once per turn', () => {
    expect(passed(0.2, 0.4, 0.3)).toBe(true)
    expect(passed(0.2, 0.4, 0.5)).toBe(false)
    expect(passed(3.0, 3.2, 3.1)).toBe(true)
    expect(passed(Math.PI - 0.05, Math.PI + 0.05, Math.PI)).toBe(true)
  })
})

describe('hammer throw landing', () => {
  it('a release at the ideal angle lands ahead, in the sector, and counts', () => {
    const s = newState(0)
    throwAt(s, 0, WIND)
    const ev = settle(s)
    const land = ev.find((e) => e.kind === 'land')
    expect(land).toMatchObject({ kind: 'land', side: 0, foul: false })
    expect(s.marks[0]?.range).toBeGreaterThan(0)
    expect(s.best[0]).toBeGreaterThan(0)
  })

  it('a release outside the sector is a foul and counts for nothing', () => {
    const s = newState(0)
    throwAt(s, 0, WIND, SECTOR * 2)
    settle(s)
    expect(s.marks[0]).toMatchObject({ foul: true, range: 0 })
    expect(s.best[0]).toBe(0)
  })

  it('a release off the ideal line keeps less speed and lands shorter', () => {
    const ideal = predict(0, idealAngle(0), SPIN1)
    const off = predict(0, idealAngle(0) + SECTOR * 0.9, SPIN1)
    expect(off.foul).toBe(false)
    expect(off.range).toBeLessThan(ideal.range * 0.85)
  })

  it('a full wind goes further than a short one', () => {
    const near = predict(0, idealAngle(0), spinSpeed(0.2))
    const far = predict(0, idealAngle(0), spinSpeed(WIND))
    expect(far.range).toBeGreaterThan(near.range)
  })

  it('a full wind throw is roughly 35 to 50 metres, a short wind is much less', () => {
    const full = predict(0, idealAngle(0), SPIN1)
    expect(full.range / METRE).toBeGreaterThan(30)
    expect(full.range / METRE).toBeLessThan(50)
    expect(predict(0, idealAngle(0), SPIN0).range / METRE).toBeLessThan(15)
  })

  it('the live readout agrees with the throw that is then made', () => {
    const s = newState(0)
    startSpin(s, 0)
    for (let i = 0; i < 60; i++) stepSpin(s, STEP)
    const sp = s.spin
    if (!sp) throw new Error('no spin')
    // Wait for the handle to come round to the ideal, then read out and let go.
    for (let i = 0; i < 60 * 3 && !inSector(0, sp.theta); i++) {
      const from = sp.theta
      stepSpin(s, STEP)
      if (passed(from, sp.theta, idealAngle(0))) break
    }
    const want = predict(0, sp.theta, sp.omega)
    expect(want.foul).toBe(false)
    release(s)
    expect(settle(s).some((e) => e.kind === 'land')).toBe(true)
    const m = s.marks[0]
    expect(Math.hypot((m?.x ?? 0) - want.x, (m?.y ?? 0) - want.y)).toBeLessThan(40)
    expect(Math.abs((m?.range ?? 0) - want.range)).toBeLessThan(10)
  })

  it('the best throw is the longest valid one; a foul never sets it', () => {
    const s = newState(0)
    throwAt(s, 0, WIND * 0.5)
    settle(s)
    const first = s.best[0]
    throwAt(s, 0, WIND, SECTOR * 2)
    settle(s)
    expect(s.best[0]).toBe(first)
    expect(s.best[0]).toBeGreaterThan(0)
  })

  it('metres are shown to one decimal from the field units', () => {
    expect(metres(METRE * 41.27)).toBe(41.3)
    expect(metres(0)).toBe(0)
  })
})

describe('hammer throw match', () => {
  it('turns alternate and the match is over after three throws each', () => {
    const s = newState(0)
    for (let round = 0; round < THROWS; round++) {
      for (const side of [0, 1] as Side[]) {
        expect(s.turn).toBe(side)
        throwAt(s, side, WIND)
        settle(s)
      }
    }
    expect(s.thrown).toEqual([THROWS, THROWS])
    expect(over(s)).toBe(true)
    expect(canSpin(s, 0)).toBe(false)
    expect(canSpin(s, 1)).toBe(false)
  })

  it('a match of another length gives each athlete that many throws', () => {
    const s = newState(0, 5)
    for (let round = 0; round < 5; round++) {
      for (const side of [0, 1] as Side[]) {
        expect(s.turn).toBe(side)
        throwAt(s, side, WIND)
        settle(s)
      }
      expect(over(s)).toBe(round === 4)
    }
    expect(s.thrown).toEqual([5, 5])
    expect(canSpin(s, 0)).toBe(false)
  })

  it('the longest valid throw wins; equal bests are level', () => {
    const s = newState(0)
    s.best = [30 * METRE, 20 * METRE]
    expect(leader(s)).toBe(0)
    s.best = [30 * METRE, 30 * METRE]
    expect(leader(s)).toBeNull()
    s.best = [10, 20 * METRE]
    expect(leader(s)).toBe(1)
  })
})

function duel(a: Difficulty, b: Difficulty, seed: number): { s: State; steps: number } {
  const rng = new Rng(seed)
  const s = newState(rng.chance(0.5) ? 0 : 1)
  let steps = 0
  const plans: (Plan | null)[] = [null, null]
  while (!over(s) && steps < 60 * 60 * 5) {
    if (s.phase === 'aim' && s.spin === null && plans[s.turn] === null) {
      plans[s.turn] = plan(s.turn, s.turn === 0 ? a : b, rng)
      startSpin(s, s.turn)
    }
    const side = s.turn
    const p = plans[side]
    const sp = s.spin
    if (p && sp && s.phase === 'aim') {
      const from = sp.theta
      stepSpin(s, STEP, p.pump)
      if (passed(from, sp.theta, p.theta) && ++p.seen >= p.passes) {
        release(s)
        plans[side] = null
      }
    }
    advance(s, STEP)
    steps++
  }
  return { s, steps }
}

describe('hammer throw swirl', () => {
  it('swirling the finger spins the hammer past the full wind, up to the bonus', () => {
    const calm = newState(0)
    const hard = newState(0)
    startSpin(calm, 0)
    startSpin(hard, 0)
    for (let i = 0; i < 240; i++) {
      stepSpin(calm, STEP, 0)
      stepSpin(hard, STEP, 1)
    }
    expect(calm.spin?.omega).toBeCloseTo(SPIN1, 6)
    expect(hard.spin?.omega).toBeGreaterThan(SPIN1 + PUMP_BONUS * 0.95)
    expect(hard.spin?.omega).toBeLessThanOrEqual(SPIN1 + PUMP_BONUS + 1e-9)
  })

  it('a hard-swirled throw goes further than a calm one at the same angle', () => {
    const calm = predict(0, idealAngle(0), SPIN1)
    const hard = predict(0, idealAngle(0), SPIN1 + PUMP_BONUS)
    expect(hard.range).toBeGreaterThan(calm.range * 1.15)
  })

  it('finger speed maps to a 0..1 drive', () => {
    expect(swirl(0)).toBe(0)
    expect(swirl(SWIRL_FULL / 2)).toBeCloseTo(0.5, 9)
    expect(swirl(1e9)).toBe(1)
  })

  it('a spin held too long has to be let go', () => {
    const s = newState(0)
    startSpin(s, 0)
    for (let i = 0; i < Math.round(MAX_HOLD / STEP) - 2; i++) stepSpin(s, STEP)
    expect(mustRelease(s)).toBe(false)
    for (let i = 0; i < 4; i++) stepSpin(s, STEP)
    expect(mustRelease(s)).toBe(true)
  })
})

describe('hammer throw bot', () => {
  it('bot vs bot finishes its six throws within bounded steps', () => {
    const r = duel('normal', 'normal', 5)
    expect(over(r.s)).toBe(true)
    expect(r.s.thrown).toEqual([THROWS, THROWS])
    expect(r.steps).toBeLessThan(60 * 60 * 5)
  })

  it('bots of both sides throw valid distances', () => {
    const r = duel('hard', 'hard', 8)
    expect(r.s.best[0]).toBeGreaterThan(20 * METRE)
    expect(r.s.best[1]).toBeGreaterThan(20 * METRE)
  })

  it('a hard bot out-throws a normal one most of the time', () => {
    let wins = 0
    for (let seed = 1; seed <= 12; seed++) {
      if (leader(duel('hard', 'normal', seed).s) === 0) wins++
    }
    expect(wins).toBeGreaterThanOrEqual(8)
  })

  it('a hard bot out-throws an easy one most of the time', () => {
    let wins = 0
    for (let seed = 1; seed <= 8; seed++) {
      if (leader(duel('hard', 'easy', seed).s) === 0) wins++
    }
    expect(wins).toBeGreaterThanOrEqual(5)
  })
})
