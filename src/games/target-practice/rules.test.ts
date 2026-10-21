import { describe, expect, it } from 'vitest'
import { STEP, type Difficulty, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { aimPoint, pickTarget, reaction } from './bot.ts'
import {
  advance,
  BOLT_TIME,
  BOW,
  fire,
  HIT_PAD,
  hitValue,
  isAlive,
  KINDS,
  leader,
  MAX_ALIVE,
  newState,
  pointIn,
  RELOAD,
  type State,
  TAP_PAD,
  TIME,
  type Target,
} from './rules.ts'

function target(s: State, over: Partial<Target> & { x: number; y: number }): Target {
  const kind = over.kind ?? 'bull'
  const t: Target = {
    id: s.nextId++,
    kind,
    r: KINDS[kind].r,
    born: s.now,
    life: KINDS[kind].life,
    vy: 0,
    ...over,
  }
  s.targets.push(t)
  return t
}

/** Run the clock until nothing is left in flight. */
function run(s: State, rng: Rng, seconds: number): Set<string> {
  const seen = new Set<string>()
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    for (const e of advance(s, STEP, rng)) seen.add(e.kind)
  }
  return seen
}

describe('target practice: firing', () => {
  it('a tap off every target fires nothing', () => {
    const s = newState()
    target(s, { x: 500, y: 900 })
    expect(fire(s, 0, 100, 300)).toBe(false)
    expect(s.bolts).toHaveLength(0)
    expect(s.reload[0]).toBe(0)
  })

  it('a tap near a target loads a bolt that lands after BOLT_TIME', () => {
    const s = newState()
    const t = target(s, { x: 500, y: 900 })
    expect(fire(s, 0, 500, 900)).toBe(true)
    expect(s.bolts).toHaveLength(1)
    expect(s.bolts[0]?.at).toBeCloseTo(BOLT_TIME)
    expect(s.reload[0]).toBe(RELOAD)
    const ev = advance(s, BOLT_TIME + STEP, new Rng(1))
    expect(ev.find((e) => e.kind === 'hit')).toBeDefined()
    expect(s.targets.find((x) => x.id === t.id)).toBeUndefined()
  })

  it('the bow reloads: no second bolt until RELOAD has passed', () => {
    const s = newState()
    target(s, { x: 300, y: 900 })
    target(s, { x: 700, y: 900 })
    expect(fire(s, 1, 300, 900)).toBe(true)
    expect(fire(s, 1, 700, 900)).toBe(false)
    run(s, new Rng(2), RELOAD + STEP)
    expect(fire(s, 1, 700, 900)).toBe(true)
  })

  it('a tap counts for the nearest target when two overlap', () => {
    const s = newState()
    const near = target(s, { x: 500, y: 900, kind: 'can' })
    target(s, { x: 560, y: 900, kind: 'bull' })
    expect(fire(s, 0, 490, 900)).toBe(true)
    expect(s.bolts[0]?.target).toBe(near.id)
  })
})

describe('target practice: landing', () => {
  it('the first bolt to arrive takes the target, the rival arrives too late', () => {
    const s = newState()
    const t = target(s, { x: 500, y: 900 })
    fire(s, 0, 500, 900)
    s.reload[1] = 0
    fire(s, 1, 500, 905)
    const ev = run(s, new Rng(3), 0.5)
    expect(ev.has('hit')).toBe(true)
    expect(ev.has('late')).toBe(true)
    expect(s.score).toEqual([t.kind === 'bull' ? 3 : 0, 0])
    expect(s.hits).toEqual([1, 0])
  })

  it('a target that expires before the bolt lands is a miss', () => {
    const s = newState()
    target(s, { x: 500, y: 900, kind: 'can', life: 0.2 } as Partial<Target> & {
      x: number
      y: number
    })
    const t = s.targets[0] as Target
    t.life = 0.2
    fire(s, 0, 500, 900)
    const ev = run(s, new Rng(4), 0.4)
    expect(ev.has('late')).toBe(true)
    expect(s.score).toEqual([0, 0])
  })

  it('a balloon popped while fresh earns the bonus, an old one only its base', () => {
    const fresh = newState()
    target(fresh, { x: 500, y: 900, kind: 'balloon' })
    fire(fresh, 0, 500, 900)
    run(fresh, new Rng(5), 0.3)
    expect(fresh.score[0]).toBe(1 + 3)

    const old = newState()
    const t = target(old, { x: 500, y: 900, kind: 'balloon' })
    old.now = t.life * 0.6
    old.reload = [0, 0]
    fire(old, 0, 500, 900)
    run(old, new Rng(6), 0.3)
    expect(old.score[0]).toBe(1)
    expect(hitValue(t, t.born).bonus).toBe(true)
    expect(hitValue(t, t.born + t.life).bonus).toBe(false)
  })

  it('points follow the target type', () => {
    expect(hitValue({ kind: 'bull' } as Target, 0).pts).toBe(3)
    expect(hitValue({ kind: 'can' } as Target, 0).pts).toBe(2)
  })

  it('the hit rule uses the pad around the target', () => {
    const t = { x: 500, y: 900, r: 70 } as Target
    expect(pointIn(t, 500 + 70 + HIT_PAD - 1, 900, HIT_PAD)).toBe(true)
    expect(pointIn(t, 500 + 70 + HIT_PAD + 2, 900, HIT_PAD)).toBe(false)
    expect(TAP_PAD).toBeGreaterThan(0)
  })
})

describe('target practice: the clock and the table', () => {
  it('spawns stay on the table, below the cap, and clear of each other', () => {
    const s = newState()
    const rng = new Rng(7)
    run(s, rng, 20)
    expect(s.targets.length).toBeLessThanOrEqual(MAX_ALIVE)
    for (const t of s.targets) {
      expect(t.x).toBeGreaterThan(100)
      expect(t.x).toBeLessThan(900)
      expect(t.y).toBeGreaterThan(200)
      expect(t.y).toBeLessThan(1600)
    }
  })

  it('the round ends after TIME seconds with the most points winning', () => {
    const s = newState()
    s.score = [4, 4]
    const ev = run(s, new Rng(8), TIME + 1)
    expect(ev.has('end')).toBe(true)
    expect(s.left).toBe(0)
    expect(leader(s)).toBe('draw')
    s.score = [4, 5]
    expect(leader(s)).toBe(1)
  })

  it('nothing can be fired after time is up', () => {
    const s = newState()
    run(s, new Rng(9), TIME + 1)
    target(s, { x: 500, y: 900 })
    expect(fire(s, 0, 500, 900)).toBe(false)
  })

  it('isAlive ends at life', () => {
    const t = { born: 1, life: 1.5 } as Target
    expect(isAlive(t, 2)).toBe(true)
    expect(isAlive(t, 2.5)).toBe(false)
    expect(BOW[0]).toEqual({ x: 500, y: 1590 })
  })
})

describe('target practice: computer players', () => {
  it('the bot picks the nearest live target to its own crossbow', () => {
    const s = newState()
    target(s, { x: 500, y: 300 }) // far from red
    const near = target(s, { x: 500, y: 1500 })
    expect(pickTarget(s, 0)?.id).toBe(near.id)
    expect(pickTarget(s, 1)?.id).not.toBe(near.id)
  })

  it('the bot does not chase a target it already has a bolt on', () => {
    const s = newState()
    const t = target(s, { x: 500, y: 1500 })
    fire(s, 0, 500, 1500)
    expect(pickTarget(s, 0)).toBeUndefined()
    expect(pickTarget(s, 1)?.id).toBe(t.id)
  })

  it('reaction time falls with difficulty', () => {
    const rng = new Rng(10)
    const avg = (d: Difficulty) => {
      let total = 0
      for (let i = 0; i < 50; i++) total += reaction(d, rng)
      return total / 50
    }
    expect(avg('easy')).toBeGreaterThan(avg('normal'))
    expect(avg('normal')).toBeGreaterThan(avg('hard'))
  })

  it('a hard bot takes more targets than an easy one', () => {
    const play = (a: Difficulty, b: Difficulty, seed: number): [number, number] => {
      const rng = new Rng(seed)
      const s = newState()
      const bots: [Difficulty, Difficulty] = [a, b]
      const wait: [number, number] = [reaction(a, rng), reaction(b, rng)]
      for (let i = 0; i < Math.round((TIME + 1) / STEP); i++) {
        for (const side of [0, 1] as Side[]) {
          wait[side] -= STEP
          if (wait[side] > 0 || s.reload[side] > 0) continue
          const t = pickTarget(s, side)
          if (!t) {
            wait[side] = 0.1
            continue
          }
          const p = aimPoint(t, bots[side], rng)
          fire(s, side, p.x, p.y)
          wait[side] = reaction(bots[side], rng)
        }
        advance(s, STEP, rng)
        if (s.ended) break
      }
      return s.score
    }
    let hard = 0
    let easy = 0
    for (let seed = 1; seed <= 4; seed++) {
      const [r, b] = play('hard', 'easy', seed)
      hard += r
      easy += b
    }
    expect(hard).toBeGreaterThan(easy)
  })

  it('a bot match ends with a result in bounded steps', () => {
    const rng = new Rng(11)
    const s = newState()
    const wait: [number, number] = [0.5, 0.5]
    let steps = 0
    while (!s.ended && steps < 60 * 70) {
      for (const side of [0, 1] as Side[]) {
        wait[side] -= STEP
        if (wait[side] > 0 || s.reload[side] > 0) continue
        const t = pickTarget(s, side)
        if (!t) {
          wait[side] = 0.1
          continue
        }
        const p = aimPoint(t, 'normal', rng)
        fire(s, side, p.x, p.y)
        wait[side] = reaction('normal', rng)
      }
      advance(s, STEP, rng)
      steps++
    }
    expect(s.ended).toBe(true)
    expect(steps).toBeLessThan(60 * 50)
    expect(s.score[0] + s.score[1]).toBeGreaterThan(0)
    expect(MAX_ALIVE).toBeGreaterThan(0)
  })
})
