import { describe, expect, it } from 'vitest'
import { STEP, type Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { W } from '../../core/stage.ts'
import { decide, newMemory } from './bot.ts'
import {
  ARENA,
  BLOB_R,
  DASH_COOL,
  DASH_TIME,
  inZone,
  LIMIT,
  MAX_SPEED,
  surge,
  ZONE_FAST,
  zoneEvery,
  newWorld,
  type Targets,
  step,
  winner,
  type World,
  ZONE_EVERY,
  ZONE_R,
} from './rules.ts'

const NONE: Targets = [null, null]

/** Put both blobs somewhere and the crown in the middle, away from the walls. */
function place(w: World, red: [number, number], blue: [number, number]): void {
  w.zone.x = W / 2
  w.zone.y = 900
  w.zone.t = 100
  w.blobs[0].x = red[0]
  w.blobs[0].y = red[1]
  w.blobs[0].vx = 0
  w.blobs[0].vy = 0
  w.blobs[1].x = blue[0]
  w.blobs[1].y = blue[1]
  w.blobs[1].vx = 0
  w.blobs[1].vy = 0
}

/** Two bots play until the match is decided (or a step cap). */
function botMatch(
  a: Difficulty,
  b: Difficulty,
  seed: number,
  target = 15,
): { w: World; steps: number } {
  const rng = new Rng(seed)
  const w = newWorld(target)
  const mem = [newMemory(), newMemory()]
  let steps = 0
  while (winner(w) === null && steps < 60 * 400) {
    const t0 = decide(w, 0, a, rng, mem[0]!, STEP)
    const t1 = decide(w, 1, b, rng, mem[1]!, STEP)
    step(w, STEP, [t0, t1], rng)
    steps++
  }
  return { w, steps }
}

describe('king of the hill rules', () => {
  it('starts with both blobs on their own ends and no crown time', () => {
    const w = newWorld(15)
    expect(w.blobs[0].y).toBeGreaterThan(900)
    expect(w.blobs[1].y).toBeLessThan(900)
    expect(w.crown).toEqual([0, 0])
    expect(w.target).toBe(15)
  })

  it('a blob alone in the zone fills only its own crown meter', () => {
    const w = newWorld(15)
    place(w, [W / 2, 900], [W / 2 - 600, 400])
    for (let i = 0; i < 60; i++) step(w, STEP, NONE, new Rng(1))
    expect(w.crown[0]).toBeCloseTo(1, 1)
    expect(w.crown[1]).toBe(0)
    expect(w.holder).toBe(0)
  })

  it('contested or empty, the crown fills nothing', () => {
    const w = newWorld(15)
    place(w, [W / 2 + 40, 900], [W / 2 - 40, 900])
    for (let i = 0; i < 60; i++) step(w, STEP, NONE, new Rng(2))
    expect(w.crown).toEqual([0, 0])
    expect(w.holder).toBeNull()
    place(w, [100, 300], [900, 1500])
    for (let i = 0; i < 60; i++) step(w, STEP, NONE, new Rng(2))
    expect(w.crown).toEqual([0, 0])
  })

  it('the crown jumps to a new spot every ZONE_EVERY seconds', () => {
    const w = newWorld(15)
    const rng = new Rng(3)
    const before = { x: w.zone.x, y: w.zone.y }
    let moved = 0
    for (let i = 0; i < 60 * (ZONE_EVERY + 0.5); i++) {
      const ev = step(w, STEP, NONE, rng)
      if (ev.some((e) => e.kind === 'zone')) moved++
    }
    expect(moved).toBe(1)
    expect(Math.hypot(w.zone.x - before.x, w.zone.y - before.y)).toBeGreaterThan(0)
    // The spot keeps the whole zone inside the arena.
    expect(w.zone.x - ZONE_R).toBeGreaterThanOrEqual(ARENA.x0)
    expect(w.zone.x + ZONE_R).toBeLessThanOrEqual(ARENA.x1)
    expect(w.zone.y - ZONE_R).toBeGreaterThanOrEqual(ARENA.y0)
    expect(w.zone.y + ZONE_R).toBeLessThanOrEqual(ARENA.y1)
  })

  it('a blob steers toward its finger', () => {
    const w = newWorld(15)
    place(w, [300, 1300], [700, 500])
    const tgt = { x: 300, y: 1000 }
    for (let i = 0; i < 60; i++) step(w, STEP, [tgt, null], new Rng(4))
    expect(Math.abs(w.blobs[0].y - 1000)).toBeLessThan(100)
  })

  it('a bumped blob is shoved away', () => {
    const w = newWorld(15)
    place(w, [W / 2, 1000], [W / 2, 1000 - BLOB_R * 1.6])
    w.blobs[0].vy = -600
    const y0 = w.blobs[1].y
    step(w, STEP, NONE, new Rng(5))
    expect(w.blobs[1].y).toBeLessThan(y0)
  })

  it('a hard charge sends the blob that was hit reeling, unable to steer', () => {
    const w = newWorld(15)
    place(w, [W / 2, 1000], [W / 2, 1000 - BLOB_R * 2.05])
    w.blobs[0].vy = -780
    const events = step(w, STEP, [null, null], new Rng(5))
    expect(events.some((e) => e.kind === 'shove' && e.side === 1)).toBe(true)
    expect(w.blobs[1].stun).toBeGreaterThan(0)
    expect(w.blobs[0].stun).toBe(0)
    // While reeling, the target is ignored: it keeps flying away from the charger.
    const vy = w.blobs[1].vy
    step(w, STEP, [null, { x: W / 2, y: 1400 }], new Rng(5))
    expect(w.blobs[1].vy).toBeLessThan(0)
    expect(w.blobs[1].vy).toBeGreaterThan(vy)
  })

  it('the first side to the target crown seconds wins', () => {
    const w = newWorld(3)
    w.crown = [2.9, 0]
    expect(winner(w)).toBeNull()
    w.crown = [3, 1]
    expect(winner(w)).toBe(0)
    w.crown = [1, 3]
    expect(winner(w)).toBe(1)
  })

  it('at the safety limit the side with more crown seconds wins', () => {
    const w = newWorld(15)
    w.t = LIMIT
    w.crown = [4, 2]
    expect(winner(w)).toBe(0)
    w.crown = [2, 2]
    expect(winner(w)).toBe('draw')
  })

  it('inZone is measured from the centre', () => {
    const w = newWorld(15)
    place(w, [W / 2 + ZONE_R - 5, 900], [0, 0])
    expect(inZone(w.blobs[0], w.zone)).toBe(true)
    place(w, [W / 2 + ZONE_R + 5, 900], [0, 0])
    expect(inZone(w.blobs[0], w.zone)).toBe(false)
  })

  it('the chosen match length sets the crown seconds needed', () => {
    expect(newWorld(30).target).toBe(30)
  })
})

describe('king of the hill bots', () => {
  it('bot vs bot reaches a winner within the safety limit', () => {
    const { w, steps } = botMatch('hard', 'normal', 3)
    expect(winner(w)).not.toBeNull()
    expect(steps).toBeLessThan(60 * 400)
  })

  it('bot vs bot on a short match finishes too', () => {
    const { w } = botMatch('normal', 'easy', 6, 5)
    expect(winner(w)).not.toBeNull()
  })

  it('the harder bot usually wins, on either side', () => {
    const wins = (a: Difficulty, b: Difficulty): number => {
      let n = 0
      for (let s = 1; s <= 6; s++) {
        if (winner(botMatch(a, b, s).w) === 0) n++
        if (winner(botMatch(b, a, s).w) === 1) n++
      }
      return n
    }
    expect(wins('hard', 'easy')).toBeGreaterThanOrEqual(10)
    expect(wins('hard', 'normal')).toBeGreaterThanOrEqual(8)
    expect(wins('normal', 'easy')).toBeGreaterThanOrEqual(9)
  })

  it('a flick from rest is a charge: faster, once per flick, after a cooldown', () => {
    const w = newWorld(15)
    place(w, [500, 1300], [500, 400])
    const rng = new Rng(1)
    const far = { x: 500, y: 300 }
    step(w, STEP, NONE, rng)
    const ev = step(w, STEP, [far, null], rng)
    expect(ev.some((e) => e.kind === 'dash' && e.side === 0)).toBe(true)
    expect(surge(w.blobs[0], w.t)).toBeGreaterThan(1.5)
    let top = 0
    let dashes = 1
    for (let i = 0; i < 30; i++) {
      for (const e of step(w, STEP, [far, null], rng)) if (e.kind === 'dash') dashes++
      top = Math.max(top, Math.hypot(w.blobs[0].vx, w.blobs[0].vy))
    }
    expect(top).toBeGreaterThan(MAX_SPEED * 1.1)
    expect(dashes).toBe(1)
    // A slow ramp from rest is a push, not a charge.
    const v = newWorld(15)
    place(v, [500, 1300], [500, 400])
    let any = false
    for (let i = 0; i <= 30; i++) {
      const tgt = { x: 500, y: 1300 - (i / 30) * 120 }
      for (const e of step(v, STEP, [tgt, null], rng)) if (e.kind === 'dash') any = true
    }
    expect(any).toBe(false)
    expect(DASH_COOL).toBeGreaterThan(DASH_TIME)
  })

  it('the crown hops sooner as the leader closes in on the target', () => {
    const w = newWorld(20)
    expect(zoneEvery(w)).toBe(ZONE_EVERY)
    w.crown = [18, 3]
    expect(zoneEvery(w)).toBeLessThan(ZONE_EVERY)
    expect(zoneEvery(w)).toBeGreaterThanOrEqual(ZONE_FAST)
  })

  it('a sharp bot heads for the telegraphed next spot before the hop', () => {
    const w = newWorld(15)
    place(w, [500, 1300], [500, 400])
    w.zone.t = 0.5
    w.next = { x: 300, y: 1400 }
    const hard = decide(w, 0, 'hard', new Rng(1), newMemory(), STEP)
    const easy = decide(w, 0, 'easy', new Rng(1), newMemory(), STEP)
    expect(Math.hypot(hard.x - 300, hard.y - 1400)).toBeLessThan(
      Math.hypot(easy.x - 300, easy.y - 1400),
    )
  })

  it('a bot heads for the crown when nobody holds it', () => {
    const w = newWorld(15)
    place(w, [W / 2 - 400, 1400], [W / 2, 400])
    const rng = new Rng(7)
    const aim = decide(w, 0, 'hard', rng, newMemory(), STEP)
    const d0 = Math.hypot(w.blobs[0].x - w.zone.x, w.blobs[0].y - w.zone.y)
    const d1 = Math.hypot(aim.x - w.zone.x, aim.y - w.zone.y)
    expect(d1).toBeLessThan(d0)
  })

  it('blue plays the crown too', () => {
    const w = newWorld(15)
    place(w, [W / 2, 1400], [W / 2 - 300, 400])
    const aim = decide(w, 1, 'normal', new Rng(8), newMemory(), STEP)
    expect(Math.hypot(aim.x - w.zone.x, aim.y - w.zone.y)).toBeLessThan(
      Math.hypot(w.blobs[1].x - w.zone.x, w.blobs[1].y - w.zone.y),
    )
  })
})
