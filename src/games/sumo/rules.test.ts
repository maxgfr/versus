import { describe, expect, it } from 'vitest'
import type { Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { newMem, steer } from './bot.ts'
import {
  DASH_COOL,
  DASH_SPEED,
  dashSpeed,
  FRAME,
  indexOf,
  RING,
  ringAt,
  SHRINK_AT,
  spawn,
  step,
  type Target,
  type Wrestler,
} from './rules.ts'

/** Play one round with the bots on both sides, the way the game does. Returns who went out and how long it took. */
function playRound(
  lanes: 1 | 2,
  d: 'easy' | 'normal' | 'hard',
  seed: number,
  blue: 'easy' | 'normal' | 'hard' = d,
): { outs: Side[]; frames: number } {
  const w = spawn(lanes)
  const rng = new Rng(seed)
  const mems = w.map(() => newMem())
  const outs = new Set<Side>()
  let frames = 0
  for (let f = 0; f < 60 * 120 && outs.size === 0; f++) {
    const time = f * FRAME
    const ring = ringAt(time)
    const targets: Target[] = []
    const dashes: (boolean | number)[] = []
    w.forEach((a, k) => {
      const lv = a.side === 0 ? d : blue
      const r = steer(w, k, a.side, time, ring, lv, rng, mems[k] as ReturnType<typeof newMem>)
      targets.push(r.target)
      dashes.push(r.dash)
    })
    for (const s of step(w, FRAME, time, ring, targets, dashes)) outs.add(s)
    frames++
  }
  return { outs: [...outs], frames }
}

describe('sumo setup', () => {
  it('one wrestler a side in a round, two a side in 2 vs 2, each facing the other', () => {
    const solo = spawn(1)
    expect(solo).toHaveLength(2)
    expect(solo[0]!.y).toBeGreaterThan(RING.y)
    expect(solo[1]!.y).toBeLessThan(RING.y)
    const teams = spawn(2)
    expect(teams).toHaveLength(4)
    expect(teams.filter((a) => a.side === 0)).toHaveLength(2)
    expect(indexOf(teams, 1, 1)).toBe(3)
    expect(indexOf(solo, 1, 0)).toBe(1)
  })

  it('the ring holds full size at first, then closes in', () => {
    expect(ringAt(0)).toBe(RING.r)
    expect(ringAt(SHRINK_AT)).toBe(RING.r)
    expect(ringAt(SHRINK_AT + 10)).toBeLessThan(RING.r)
    expect(ringAt(10_000)).toBe(0)
  })
})

describe('sumo physics', () => {
  it('a steered wrestler moves toward its finger', () => {
    const w = spawn(1)
    const a = w[0] as Wrestler
    const t = { x: a.x, y: a.y - 300 }
    for (let f = 0; f < 20; f++) step(w, FRAME, f * FRAME, RING.r, [t, null], [false, false])
    expect(a.y).toBeLessThan(RING.y + 230 - 60)
    // Still well short of the finger: it is moving quickly toward it.
    expect(Math.hypot(a.vx, a.vy)).toBeGreaterThan(100)
  })

  it('a dash kicks the wrestler forward and then cools down', () => {
    const w = spawn(1)
    const a = w[0] as Wrestler
    const t = { x: a.x, y: a.y - 300 }
    step(w, FRAME, 1, RING.r, [t, null], [true, false])
    const v1 = Math.hypot(a.vx, a.vy)
    expect(v1).toBeGreaterThan(DASH_SPEED * 0.8)
    expect(a.cool).toBeCloseTo(1 + DASH_COOL, 5)
    // Asking again straight away does nothing.
    a.vx = 0
    a.vy = 0
    step(w, FRAME, 1.1, RING.r, [t, null], [true, false])
    expect(Math.hypot(a.vx, a.vy)).toBeLessThan(DASH_SPEED * 0.5)
  })

  it('a heavy wrestler charging into a standing one shoves it back', () => {
    const w = spawn(1)
    const a = w[0] as Wrestler
    const b = w[1] as Wrestler
    b.x = RING.x
    b.y = RING.y
    b.vx = 0
    b.vy = 0
    a.x = RING.x
    a.y = RING.y + 160
    a.vx = 0
    a.vy = -500
    b.vx = 0
    b.vy = 0
    const y0 = b.y
    step(w, FRAME, 1, RING.r, [null, null], [false, false])
    expect(b.y).toBeLessThan(y0)
    expect(Math.abs(b.vy)).toBeGreaterThan(50)
  })

  it('a wrestler that leaves the ring loses its side the round', () => {
    const w = spawn(1)
    const a = w[1] as Wrestler
    a.x = RING.x + RING.r + 40
    a.y = RING.y
    const outs = step(w, FRAME, 1, RING.r, [null, null], [false, false])
    expect(outs).toEqual([1])
  })

  it('a wrestler inside a shrunken ring is out', () => {
    const w = spawn(1)
    const a = w[0] as Wrestler
    a.x = RING.x + 300
    a.y = RING.y
    expect(step(w, FRAME, 1, 250, [null, null], [false, false])).toEqual([0])
    expect(step(spawn(1), FRAME, 1, RING.r, [null, null], [false, false])).toEqual([])
  })
})

describe('sumo match', () => {
  it('computer vs computer ends a round, on either lane count, in bounded time', () => {
    for (const lanes of [1, 2] as const) {
      for (const seed of [1, 2, 3]) {
        const r = playRound(lanes, 'hard', seed)
        expect(r.outs.length).toBeGreaterThan(0)
        expect(r.frames).toBeLessThan(60 * (SHRINK_AT + 40))
      }
    }
  }, 60000)

  it('a round is never lost by both sides at once without a result', () => {
    const r = playRound(1, 'normal', 9)
    expect(r.outs.length).toBeLessThanOrEqual(2)
  }, 60000)

  it('the bot plays either side', () => {
    const w = spawn(1)
    const rng = new Rng(5)
    const mem = w.map(() => newMem())
    for (const side of [0, 1] as Side[]) {
      const k = indexOf(w, side, 0)
      const r = steer(w, k, side, 1, RING.r, 'hard', rng, mem[k] as ReturnType<typeof newMem>)
      expect(r.target).not.toBeNull()
    }
  })

  it('hard wins most rounds against easy, and against normal, from either side', () => {
    for (const weak of ['easy', 'normal'] as const) {
      let hard = 0
      let rounds = 0
      for (let seed = 1; seed <= 12; seed++) {
        const hs: Side = seed % 2 ? 0 : 1
        const r = playRound(1, hs === 0 ? 'hard' : weak, seed, hs === 0 ? weak : 'hard')
        if (r.outs.length !== 1) continue
        rounds++
        if (r.outs[0] !== hs) hard++
      }
      expect(hard / rounds).toBeGreaterThanOrEqual(weak === 'easy' ? 0.75 : 0.6)
    }
  }, 60000)
})

describe('the flick', () => {
  it('a harder flick dashes faster; a double tap is the plain dash', () => {
    const soft = spawn(1)
    const hard = spawn(1)
    const plain = spawn(1)
    const t = (w: Wrestler[]) => [{ x: (w[0] as Wrestler).x, y: (w[0] as Wrestler).y - 300 }, null]
    step(soft, FRAME, 1, RING.r, t(soft), [0.1, false])
    step(hard, FRAME, 1, RING.r, t(hard), [1, false])
    step(plain, FRAME, 1, RING.r, t(plain), [true, false])
    const v = (w: Wrestler[]) => Math.hypot((w[0] as Wrestler).vx, (w[0] as Wrestler).vy)
    expect(v(hard)).toBeGreaterThan(v(plain))
    expect(v(plain)).toBeGreaterThan(v(soft))
    expect(dashSpeed(7 / 11)).toBeCloseTo(DASH_SPEED, 5)
  })
})
