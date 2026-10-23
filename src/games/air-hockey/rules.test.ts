import { describe, expect, it } from 'vitest'
import { STEP, type Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import {
  collideKinematic,
  collideWalls,
  disc,
  predictX,
  scoredBy,
} from '../../engines/puck/index.ts'
import { decide, newMemory, TUNING } from './bot.ts'
import {
  MAX_PUCK,
  newWorld,
  RINK,
  step,
  TARGET,
  TEMPO,
  tempoOf,
  winner,
  type World,
} from './rules.ts'

describe('puck engine', () => {
  it('bounces off side walls and keeps the disc inside', () => {
    const d = disc(RINK.x0 + 10, MID, 40)
    d.vx = -500
    const c = collideWalls(d, RINK)
    expect(c?.kind).toBe('wall')
    expect(d.x).toBe(RINK.x0 + 40)
    expect(d.vx).toBeGreaterThan(0)
  })

  it('lets the puck into the goal mouth and detects the goal', () => {
    const d = disc(W / 2, RINK.y0 - 60, 40)
    expect(collideWalls(d, RINK)).toBeNull()
    expect(scoredBy(d, RINK)).toBe(0)
    const e = disc(W / 2, RINK.y1 + 60, 40)
    expect(scoredBy(e, RINK)).toBe(1)
  })

  it('a moving mallet launches a resting puck', () => {
    const puck = disc(500, 900, 40)
    const mallet = { ...disc(500, 990, 60), vy: -1500 }
    const c = collideKinematic(puck, mallet)
    expect(c?.speed).toBeGreaterThan(1000)
    expect(puck.vy).toBeLessThan(-1000)
  })

  it('predicts x across a wall bounce', () => {
    const d = disc(800, 1000, 40)
    d.vx = 800
    d.vy = -800
    const x = predictX(d, 500, RINK)
    expect(x).not.toBeNull()
    expect(x as number).toBeGreaterThan(RINK.x0)
    expect(x as number).toBeLessThan(RINK.x1)
  })
})

function botMatch(
  a: Difficulty,
  b: Difficulty,
  seed: number,
  teams = false,
  target = TARGET,
  maxPuck = MAX_PUCK,
): { w: World; steps: number } {
  const rng = new Rng(seed)
  const w = newWorld(teams, 0)
  const mem = [newMemory(), newMemory()]
  let steps = 0
  while (winner(w, target) === null && steps < 60 * 60 * 8) {
    const t0 = decide(w, 0, a, rng, mem[0] as ReturnType<typeof newMemory>, STEP)
    const t1 = decide(w, 1, b, rng, mem[1] as ReturnType<typeof newMemory>, STEP)
    const targets = w.mallets.map((m, i) => (m.side === 0 ? t0[i] : t1[i]) ?? null)
    const speeds = w.mallets.map((m) => TUNING[m.side === 0 ? a : b].speed)
    step(w, STEP, targets, speeds, maxPuck)
    steps++
  }
  return { w, steps }
}

describe('air hockey', () => {
  it('bot vs bot reaches seven goals', () => {
    const { w } = botMatch('hard', 'normal', 3)
    expect(winner(w)).not.toBeNull()
    expect(Math.max(...w.score)).toBe(TARGET)
  })

  it('ends the match at the chosen goal count, not the default', () => {
    const { w } = botMatch('hard', 'normal', 3, false, 3)
    expect(winner(w, 3)).not.toBeNull()
    expect(Math.max(...w.score)).toBe(3)
    expect(winner({ ...w, score: [TARGET - 1, 0] }, TARGET)).toBeNull()
    expect(winner({ ...w, score: [3, 0] }, 3)).toBe(0)
  })

  it('the harder bot usually wins', () => {
    let hard = 0
    for (let s = 1; s <= 4; s++) if (winner(botMatch('hard', 'easy', s).w) === 0) hard++
    expect(hard).toBeGreaterThanOrEqual(3)
  })

  it('2 vs 2 bot match finishes', () => {
    const { w } = botMatch('normal', 'normal', 9, true)
    expect(w.mallets).toHaveLength(4)
    expect(winner(w)).not.toBeNull()
  })

  it('keeps every mallet in its own half', () => {
    const { w } = botMatch('hard', 'hard', 5)
    for (const m of w.mallets) {
      if (m.side === 0) expect(m.y).toBeGreaterThan(MID)
      else expect(m.y).toBeLessThan(MID)
    }
  })
})

describe('tempo', () => {
  /** Top speed a hard slap reaches under a given cap. */
  function slap(maxPuck?: number): number {
    const w = newWorld(false, 0)
    w.puck.x = W / 2
    w.puck.y = MID + 300
    const m = w.mallets[0] as World['mallets'][number]
    m.x = W / 2
    m.y = MID + 300 + 110
    const target = { x: W / 2, y: MID + 60 }
    let top = 0
    for (let i = 0; i < 20 && w.phase === 'play'; i++) {
      step(w, STEP, [target, null], [5200, 0], maxPuck)
      top = Math.max(top, Math.hypot(w.puck.vx, w.puck.vy))
    }
    return top
  }

  it('normal keeps the puck cap exactly as before', () => {
    expect(TEMPO.normal).toBe(1)
    expect(slap()).toBeCloseTo(MAX_PUCK, 0)
    expect(slap(MAX_PUCK * TEMPO.normal)).toBe(slap())
  })

  it('hard lets the puck fly faster, easy calmer', () => {
    expect(slap(MAX_PUCK * TEMPO.hard)).toBeGreaterThan(MAX_PUCK * 1.2)
    expect(slap(MAX_PUCK * TEMPO.easy)).toBeLessThan(MAX_PUCK * 0.9)
  })

  it('only a match with a computer changes pace', () => {
    expect(tempoOf('hard', [false, true])).toBe(TEMPO.hard)
    expect(tempoOf('easy', [true, true])).toBe(TEMPO.easy)
    expect(tempoOf('hard', [false, false])).toBe(1)
    expect(tempoOf('easy', [false, false])).toBe(1)
  })

  it('bots still finish, and hard still beats easy, at the hard tempo', () => {
    const fast = MAX_PUCK * TEMPO.hard
    expect(winner(botMatch('hard', 'hard', 7, false, TARGET, fast).w)).not.toBeNull()
    let hard = 0
    for (let s = 1; s <= 4; s++)
      if (winner(botMatch('hard', 'easy', s, false, TARGET, fast).w) === 0) hard++
    expect(hard).toBeGreaterThanOrEqual(3)
  })
})
