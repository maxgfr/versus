import { describe, expect, it } from 'vitest'
import { type Difficulty, type Side, STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { decideKeeper, decideShot, type KeeperMemory, newKeeperMemory, TUNING } from './bot.ts'
import {
  type Cmd,
  crossX,
  GOAL,
  KEEPER_HOME,
  keeperOf,
  keeperRange,
  LINE,
  newWorld,
  outcome,
  type Shot,
  shooterOf,
  SPOT,
  step,
  trace,
  type World,
} from './rules.ts'

/** A shot from the shooter's spot straight at `x` on the goal line it aims at. */
function shotAt(x: number, power = 1, curl = 0, shooter: Side = 0): Shot {
  const s = SPOT[shooter]
  const dx = x - s.x
  const dy = LINE[keeperOf(shooter)] - s.y
  const m = Math.hypot(dx, dy)
  return { dx: dx / m, dy: dy / m, power, curl }
}

/** Take one kick: the keeper stands at `keepX` (and dives `dive` as the ball flies). */
function kick(shot: Shot, keepX: number, dive = 0, shooter: Side = 0): World {
  const w = newWorld()
  w.shooter = shooter
  w.ball = { x: SPOT[shooter].x, y: SPOT[shooter].y, vx: 0, vy: 0, curl: 0 }
  w.phase = 'aim'
  const keeper = keeperOf(shooter)
  w.keepers[keeper].x = keepX
  step(w, STEP, { keepX: [null, null], dive: [0, 0], shot }, 5)
  for (let i = 0; i < 60 * 4 && (w.phase as World['phase']) !== 'result'; i++) {
    const c: Cmd = { keepX: [null, null], dive: [0, 0], shot: null }
    if (i === 0) c.dive[keeper] = dive
    step(w, STEP, c, 5)
  }
  return w
}

describe('a kick', () => {
  it('a shot into the mouth past a keeper standing elsewhere is a goal', () => {
    const w = kick(shotAt(300), 600)
    expect(w.outcome).toBe('goal')
    expect(w.score).toEqual([1, 0])
  })

  it('a shot straight at a keeper is saved', () => {
    const w = kick(shotAt(500), 500)
    expect(w.outcome).toBe('save')
    expect(w.score).toEqual([0, 0])
  })

  it('a shot wide of the posts is a miss', () => {
    const w = kick(shotAt(GOAL.x0 - 80), 500)
    expect(w.outcome).toBe('miss')
    expect(w.score).toEqual([0, 0])
  })

  it('a dive covers a shot the standing keeper could not reach', () => {
    const standing = kick(shotAt(650), 500)
    expect(standing.outcome).toBe('goal')
    const diving = kick(shotAt(650), 500, 1)
    expect(diving.outcome).toBe('save')
  })

  it('the keeper cannot move past the posts', () => {
    const [lo, hi] = keeperRange()
    const w = newWorld()
    w.phase = 'shot'
    w.keepers[1].x = KEEPER_HOME
    for (let i = 0; i < 300; i++)
      step(w, STEP, { keepX: [null, 9999], dive: [0, 0], shot: null }, 5)
    expect(w.keepers[1].x).toBeLessThanOrEqual(hi + 1e-6)
    for (let i = 0; i < 300; i++)
      step(w, STEP, { keepX: [null, -9999], dive: [0, 0], shot: null }, 5)
    expect(w.keepers[1].x).toBeGreaterThanOrEqual(lo - 1e-6)
  })

  it('swipe bend curls the ball sideways', () => {
    const right = crossX(shotAt(500, 1, 1), 0, LINE[1])
    const left = crossX(shotAt(500, 1, -1), 0, LINE[1])
    expect(right).not.toBeNull()
    expect(left).not.toBeNull()
    expect(right as number).toBeGreaterThan(540)
    expect(left as number).toBeLessThan(460)
  })

  it('the trail preview stays on the pitch and heads toward the goal line', () => {
    const pts = trace(shotAt(500, 1), 0)
    expect(pts.length).toBeGreaterThan(3)
    expect(pts[pts.length - 1]?.y).toBeLessThan(SPOT[0].y)
  })
})

describe('shootout rules', () => {
  it('shooters alternate, red first', () => {
    expect(shooterOf(0)).toBe(0)
    expect(shooterOf(1)).toBe(1)
    expect(shooterOf(2)).toBe(0)
    expect(shooterOf(3)).toBe(1)
  })

  it('ends early once one side cannot be caught', () => {
    expect(outcome([3, 0], 6, 5)).toBe(0)
    expect(outcome([0, 3], 6, 5)).toBe(1)
    expect(outcome([2, 0], 6, 5)).toBeNull()
  })

  it('a level regulation goes to sudden death, decided in pairs', () => {
    expect(outcome([2, 2], 10, 5)).toBeNull()
    expect(outcome([3, 2], 10, 5)).toBe(0)
    expect(outcome([2, 3], 10, 5)).toBe(1)
    expect(outcome([3, 3], 11, 5)).toBeNull()
    expect(outcome([4, 3], 11, 5)).toBeNull()
    expect(outcome([4, 2], 11, 5)).toBe(0)
    expect(outcome([3, 3], 12, 5)).toBeNull()
  })

  it('follows the chosen number of kicks, not the default', () => {
    expect(outcome([1, 0], 2, 1)).toBe(0)
    expect(outcome([1, 1], 2, 1)).toBeNull()
    expect(outcome([2, 1], 4, 2)).toBe(0)
  })
})

/** Computer vs computer until the shootout is decided; returns the world and steps taken. */
function botShootout(
  a: Difficulty,
  b: Difficulty,
  seed: number,
  rounds = 5,
): { w: World; steps: number } {
  const rng = new Rng(seed)
  const w = newWorld()
  const mem: [KeeperMemory, KeeperMemory] = [newKeeperMemory(), newKeeperMemory()]
  const diffOf = (s: Side): Difficulty => (s === 0 ? a : b)
  let aimT = 0
  let steps = 0
  while (outcome(w.score, w.done, rounds) === null && steps < 60 * 600) {
    const shooter = w.shooter
    const keeper = keeperOf(shooter)
    const cmd: Cmd = { keepX: [null, null], dive: [0, 0], shot: null }
    if (w.phase === 'aim') {
      aimT += STEP
      if (aimT >= TUNING[diffOf(shooter)].wait) {
        cmd.shot = decideShot(w, diffOf(shooter), rng)
        aimT = 0
      }
    } else aimT = 0
    const kd = decideKeeper(w, keeper, diffOf(keeper), rng, mem[keeper], STEP)
    cmd.keepX[keeper] = kd.x
    cmd.dive[keeper] = kd.dive
    step(w, STEP, cmd, rounds)
    steps++
  }
  return { w, steps }
}

describe('penalty bots', () => {
  it('a bot-vs-bot shootout is decided in bounded time', () => {
    const { w, steps } = botShootout('normal', 'normal', 41)
    expect(outcome(w.score, w.done, 5)).not.toBeNull()
    expect(steps).toBeLessThan(60 * 600)
  })

  it('sudden death is reached and still ends', () => {
    const { w, steps } = botShootout('easy', 'easy', 42, 1)
    expect(outcome(w.score, w.done, 1)).not.toBeNull()
    expect(steps).toBeLessThan(60 * 600)
  })

  it('plays either side: a blue shooter aims toward the red goal', () => {
    const rng = new Rng(43)
    const w = newWorld()
    w.shooter = 1
    w.ball = { x: SPOT[1].x, y: SPOT[1].y, vx: 0, vy: 0, curl: 0 }
    const shot = decideShot(w, 'hard', rng)
    expect(shot.dy).toBeGreaterThan(0)
    expect(Math.hypot(shot.dx, shot.dy)).toBeCloseTo(1, 6)
  })

  it('the harder shooter usually scores more', () => {
    let hard = 0
    for (let s = 1; s <= 4; s++) {
      const { w } = botShootout('hard', 'easy', s)
      if (w.score[0] > w.score[1]) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(3)
  })
})
