import { describe, expect, it } from 'vitest'
import { STEP, type Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { H, MID, W } from '../../core/stage.ts'
import { decide, newMemory } from './bot.ts'
import {
  spawnGap,
  SPAWN_FAST,
  BACK,
  BASE_Y,
  END_GRACE,
  type Event,
  headAt,
  HOLD,
  lunge,
  LUNGE_OUT,
  MARBLE_R,
  mouthOf,
  newWorld,
  POND,
  SPAWN_EVERY,
  step,
  type World,
  winner,
} from './rules.ts'

const NONE = [{ tap: null }, { tap: null }] as const

/** Run two bots until the match is decided (or a step cap). */
function botMatch(
  a: Difficulty,
  b: Difficulty,
  seed: number,
  target = 30,
): { w: World; steps: number } {
  const rng = new Rng(seed)
  const w = newWorld(target)
  const mem = [newMemory(), newMemory()]
  let steps = 0
  while (winner(w) === null && steps < 60 * 150) {
    const c0 = decide(w, 0, a, rng, mem[0]!, STEP)
    const c1 = decide(w, 1, b, rng, mem[1]!, STEP)
    step(w, STEP, [c0, c1], rng)
    steps++
  }
  return { w, steps }
}

describe('happy hippos rules', () => {
  it('puts one hippo on each shore, facing the pond', () => {
    const w = newWorld(30)
    expect(w.hippos[0].by).toBe(BASE_Y)
    expect(w.hippos[1].by).toBe(H - BASE_Y)
    expect(w.hippos[0].fy).toBe(-1)
    expect(w.hippos[1].fy).toBe(1)
  })

  it('a tap ahead lunges, a tap back toward the shore does nothing', () => {
    const w = newWorld(30)
    const ev: Event[] = []
    // Red's hippo faces up the table, so a tap well above it lunges.
    expect(lunge(w, 0, W / 2, MID, ev)).toBe(true)
    expect(w.hippos[0].phase).toBe('out')
    expect(ev.some((e) => e.kind === 'lunge' && e.side === 0)).toBe(true)
    // Blue's tap above its shore (back toward its own edge) is refused.
    expect(lunge(w, 1, W / 2, 0, [])).toBe(false)
    expect(lunge(w, 1, W / 2, MID, [])).toBe(true)
  })

  it('a lunge runs out, holds, comes back and then cools down', () => {
    const w = newWorld(30)
    lunge(w, 0, W / 2, MID, [])
    const h = w.hippos[0]
    const rest = headAt({ ...h, phase: 'rest', t: 0 })
    const tip = headAt({ ...h, phase: 'hold', t: 0 })
    expect(tip.y).toBeLessThan(rest.y)
    step(w, LUNGE_OUT + 0.01, [...NONE], new Rng(1))
    expect(h.phase).toBe('hold')
    step(w, HOLD + 0.01, [...NONE], new Rng(1))
    expect(h.phase).toBe('back')
    step(w, BACK + 0.01, [...NONE], new Rng(1))
    expect(h.phase).toBe('rest')
    // Cooling down: another lunge straight away is refused.
    expect(lunge(w, 0, W / 2, MID, [])).toBe(false)
  })

  it('a marble in the mouth while lunging is eaten and scores for that side', () => {
    const w = newWorld(30)
    lunge(w, 0, W / 2, MID, [])
    w.hippos[0].phase = 'hold'
    w.hippos[0].t = 0
    const m = mouthOf(w.hippos[0])
    w.marbles.push({ id: 99, x: m.x, y: m.y, vx: 0, vy: 0, r: MARBLE_R })
    const ev = step(w, STEP, [...NONE], new Rng(2))
    expect(w.marbles.find((x) => x.id === 99)).toBeUndefined()
    expect(w.hippos[0].eaten).toBe(1)
    expect(ev.some((e) => e.kind === 'eat' && e.side === 0 && e.id === 99)).toBe(true)
  })

  it('a resting mouth eats nothing', () => {
    const w = newWorld(30)
    const m = mouthOf(w.hippos[1])
    w.marbles.push({ id: 5, x: m.x, y: m.y, vx: 0, vy: 0, r: MARBLE_R })
    step(w, STEP, [...NONE], new Rng(3))
    expect(w.hippos[1].eaten).toBe(0)
    expect(w.marbles.some((x) => x.id === 5)).toBe(true)
  })

  it('keeps marbles inside the round pond', () => {
    const w = newWorld(30)
    w.marbles.push({ id: 1, x: POND.x + POND.r - 5, y: POND.y, vx: 1500, vy: 0, r: MARBLE_R })
    for (let i = 0; i < 120; i++) step(w, STEP, [...NONE], new Rng(4))
    for (const m of w.marbles) {
      expect(Math.hypot(m.x - POND.x, m.y - POND.y) + m.r).toBeLessThanOrEqual(POND.r + 1e-6)
    }
  })

  it('releases the match length of marbles, quicker and quicker', () => {
    const w = newWorld(4)
    const rng = new Rng(5)
    let t = 0
    while (w.released < 4 && t < 60) {
      step(w, STEP, [...NONE], rng)
      t += STEP
    }
    expect(w.released).toBe(4)
    expect(w.nextId - 1).toBe(4)
    expect(t).toBeGreaterThan(3 * SPAWN_FAST)
    expect(t).toBeLessThan(3 * SPAWN_EVERY + 0.7)
  })

  it('the release gap shrinks from SPAWN_EVERY to SPAWN_FAST over the match', () => {
    const w = newWorld(30)
    w.released = 1
    const early = spawnGap(w)
    w.released = 29
    const late = spawnGap(w)
    expect(early).toBeGreaterThan(late)
    expect(early).toBeLessThanOrEqual(SPAWN_EVERY)
    expect(late).toBeCloseTo(SPAWN_FAST, 5)
  })

  it('a tap puts the mouth, not the head, on the tapped point', () => {
    const w = newWorld(10)
    const ev: Event[] = []
    const h = w.hippos[0]
    const tx = h.bx
    const ty = h.by - 300
    expect(lunge(w, 0, tx, ty, ev)).toBe(true)
    h.phase = 'hold'
    const m = mouthOf(h)
    expect(Math.hypot(m.x - tx, m.y - ty)).toBeLessThan(2)
  })

  it('stragglers out of reach are tilted back toward the shores once all are released', () => {
    const w = newWorld(1)
    w.released = 1
    w.lastSpawn = 0
    w.t = 20
    // A marble creeping along the side wall, level with the middle.
    w.marbles = [
      { id: 1, x: POND.x - POND.r + MARBLE_R + 5, y: POND.y + 40, vx: 0, vy: 0, r: MARBLE_R },
    ]
    const rng = new Rng(2)
    for (let i = 0; i < 90; i++) step(w, STEP, [...NONE], rng)
    expect((w.marbles[0]?.y ?? 0) - POND.y).toBeGreaterThan(200)
  })

  it('ends when all marbles are released and cleared, else after the grace period', () => {
    const w = newWorld(2)
    w.released = 2
    w.marbles = []
    w.hippos[0].eaten = 3
    w.hippos[1].eaten = 1
    expect(winner(w)).toBe(0)
    w.marbles = [{ id: 1, x: POND.x, y: POND.y, vx: 0, vy: 0, r: MARBLE_R }]
    w.lastSpawn = 0
    w.t = END_GRACE - 1
    expect(winner(w)).toBeNull()
    w.t = END_GRACE + 0.1
    expect(winner(w)).toBe(0)
  })

  it('a tie in eaten marbles is a draw', () => {
    const w = newWorld(2)
    w.released = 2
    w.hippos[0].eaten = 2
    w.hippos[1].eaten = 2
    expect(winner(w)).toBe('draw')
  })

  it('the chosen match length sets the marble count', () => {
    expect(newWorld(45).target).toBe(45)
  })

  it('the bot only lunges at marbles in front of it', () => {
    const w = newWorld(30)
    // A marble straight in front of blue's shore, in reach: the bot taps it.
    w.marbles.push({ id: 1, x: W / 2, y: MID - 420, vx: 0, vy: 0, r: MARBLE_R })
    const rng = new Rng(6)
    const cmd = decide(w, 1, 'hard', rng, { wait: 0 }, 1)
    expect(cmd.tap).not.toBeNull()
    expect(cmd.tap!.y).toBeLessThan(MID)
    // A marble behind blue (on its own shore side) is ignored.
    const back = newWorld(30)
    back.marbles.push({ id: 2, x: W / 2, y: 40, vx: 0, vy: 0, r: MARBLE_R })
    expect(decide(back, 1, 'hard', rng, { wait: 0 }, 1).tap).toBeNull()
  })
})

describe('happy hippos bots', () => {
  it('bot vs bot reaches a result in bounded steps', () => {
    const { w, steps } = botMatch('hard', 'normal', 3)
    expect(winner(w)).not.toBeNull()
    expect(steps).toBeLessThan(60 * 120)
  })

  it('bot vs bot on a short match finishes too', () => {
    const { w } = botMatch('easy', 'normal', 8, 10)
    expect(winner(w)).not.toBeNull()
  })

  it('the harder bot usually eats more: hard beats easy and normal, normal beats easy', () => {
    const wins = (a: Difficulty, b: Difficulty): number => {
      let n = 0
      for (let s = 1; s <= 8; s++) if (winner(botMatch(a, b, s).w) === 0) n++
      return n
    }
    expect(wins('hard', 'easy')).toBeGreaterThanOrEqual(7)
    expect(wins('normal', 'easy')).toBeGreaterThanOrEqual(6)
    // Hard against normal is close (the pond is luck-heavy), but hard eats more overall,
    // playing either shore.
    let hard = 0
    let normal = 0
    for (let s = 1; s <= 8; s++) {
      const a = botMatch('hard', 'normal', s).w
      const b = botMatch('normal', 'hard', s).w
      hard += a.hippos[0].eaten + b.hippos[1].eaten
      normal += a.hippos[1].eaten + b.hippos[0].eaten
    }
    expect(hard).toBeGreaterThan(normal)
  })

  it('an open mouth eats the marble it reaches instead of the head batting it away', () => {
    const w = newWorld(10)
    const h = w.hippos[0]
    // A marble resting right where the bite will land.
    w.marbles = [{ id: 1, x: h.bx, y: h.by - 330, vx: 0, vy: 0, r: MARBLE_R }]
    w.released = 10
    const rng = new Rng(1)
    step(w, STEP, [{ tap: { x: h.bx, y: h.by - 330 } }, { tap: null }], rng)
    for (let i = 0; i < 20; i++) step(w, STEP, [...NONE], rng)
    expect(h.eaten).toBe(1)
  })

  it('the bot plays the blue hippo as well', () => {
    let blueEats = 0
    for (let s = 1; s <= 3; s++) {
      const { w } = botMatch('normal', 'hard', s + 10)
      blueEats += w.hippos[1].eaten as number
    }
    expect(blueEats).toBeGreaterThan(0)
  })
})
