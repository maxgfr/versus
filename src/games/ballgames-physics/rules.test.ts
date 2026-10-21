import { describe, expect, it } from 'vitest'
import type { Audio } from '../../core/audio.ts'
import { Fx } from '../../core/fx/fx.ts'
import type { Difficulty, GameContext } from '../../core/game.ts'
import type { Input } from '../../core/input.ts'
import { PlayerInput } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import type { Stage } from '../../core/stage.ts'
import { W } from '../../core/stage.ts'
import { loadMatter, PhysicsWorld } from '../../engines/ragdoll/index.ts'
import factory, { match } from './index.ts'
import { botHop, type BotMind, type BotView, newMind } from './bot.ts'
import {
  attackDir,
  BODY,
  COOLDOWN,
  GOAL_TOP,
  goalBy,
  grounded,
  HOP_MAX_X,
  hopX,
  kickoffBall,
  kickVelocity,
  leanFor,
  matchOver,
  onOwnHalf,
  PITCH,
  STAND_Y,
} from './rules.ts'
import { addPitch, addPlayer, bodyId, headId } from './sim.ts'

/** A context with no DOM: the game only touches fx, audio and input in step(). */
function fakeCtx(seed: number, difficulty: Difficulty, target: number): GameContext {
  const inputs = [new PlayerInput(0), new PlayerInput(1)]
  return {
    stage: {} as Stage,
    input: { player: (s: 0 | 1) => inputs[s] } as unknown as Input,
    fx: new Fx(),
    audio: { play: () => {} } as unknown as Audio,
    rng: new Rng(seed),
    mode: '1p',
    difficulty,
    bots: [true, true],
    teams: false,
    names: ['Red', 'Blue'],
    local: 0,
    seed,
    target,
  }
}

describe('ballgames rules', () => {
  it('gives the match a sane length', () => {
    expect(match.unit).toBe('points')
    expect(match.default).toBe(5)
    expect(match.min).toBeLessThanOrEqual(match.default)
    expect(match.max).toBeGreaterThanOrEqual(match.default)
  })

  it('a goal belongs to the side that defends it: blue scores into the left goal', () => {
    expect(goalBy(PITCH.left + 10, GOAL_TOP + 100)).toBe(1)
    expect(goalBy(PITCH.right - 10, GOAL_TOP + 100)).toBe(0)
  })

  it('no goal above the crossbar or in the middle of the pitch', () => {
    expect(goalBy(PITCH.left + 10, GOAL_TOP - 5)).toBeNull()
    expect(goalBy(W / 2, PITCH.ground - 20)).toBeNull()
    expect(goalBy(PITCH.left + PITCH.goalD + 10, PITCH.ground - 20)).toBeNull()
    expect(goalBy(PITCH.right - PITCH.goalD - 10, PITCH.ground - 20)).toBeNull()
  })

  it('a kick aims at the attacked goal and lifts the ball', () => {
    expect(attackDir(0)).toBe(1)
    expect(attackDir(1)).toBe(-1)
    const red = kickVelocity({ x: 300, y: 995 }, { x: 330, y: 1016 }, 0)
    expect(red.x).toBeGreaterThan(0)
    expect(red.y).toBeLessThan(0)
    const blue = kickVelocity({ x: 700, y: 995 }, { x: 670, y: 1016 }, 1)
    expect(blue.x).toBeLessThan(0)
    expect(Math.hypot(red.x, red.y)).toBeCloseTo(Math.hypot(blue.x, blue.y))
  })

  it('a hop carries a player toward the ball but never faster than the cap', () => {
    expect(hopX(300, 400)).toBeGreaterThan(0)
    expect(hopX(300, 200)).toBeLessThan(0)
    expect(Math.abs(hopX(0, 5000))).toBe(HOP_MAX_X)
    expect(hopX(300, 300)).toBe(0)
  })

  it('leans toward the ball and no further than half a radian', () => {
    expect(leanFor(300, 500)).toBeGreaterThan(0)
    expect(leanFor(300, 100)).toBeLessThan(0)
    expect(Math.abs(leanFor(300, 9000))).toBeCloseTo(0.5)
    expect(leanFor(300, 300)).toBe(0)
  })

  it('knows when feet are on the grass', () => {
    expect(grounded(STAND_Y)).toBe(true)
    expect(grounded(STAND_Y - 40)).toBe(false)
    expect(STAND_Y).toBe(PITCH.ground - BODY.h / 2)
  })

  it('finishes the match at the chosen number of goals', () => {
    expect(matchOver([4, 4], 5)).toBeNull()
    expect(matchOver([5, 2], 5)).toBe(0)
    expect(matchOver([1, 3], 3)).toBe(1)
    expect(matchOver([0, 0], 1)).toBeNull()
  })

  it('each half of the pitch belongs to its side', () => {
    expect(onOwnHalf(0, 200)).toBe(true)
    expect(onOwnHalf(0, 800)).toBe(false)
    expect(onOwnHalf(1, 800)).toBe(true)
    expect(onOwnHalf(1, 200)).toBe(false)
  })

  it('puts the ball back on the centre spot, a little jittered', () => {
    const at = kickoffBall(25)
    expect(at.x).toBe(W / 2 + 25)
    expect(at.y).toBeLessThan(PITCH.ground)
  })
})

describe('ballgames bot', () => {
  const view = (over: Partial<BotView>): BotView => ({
    side: 1,
    ball: { x: 700, y: PITCH.ground - 30 },
    me: { x: 700, y: STAND_Y },
    cool: 0,
    time: 10,
    ...over,
  })

  it('hops for a ball near it on its own half, after its reaction time', () => {
    const rng = new Rng(1)
    const mind: BotMind = newMind()
    // First look arms the reaction; nothing happens until the time passes.
    expect(botHop(view({ time: 10 }), 'hard', rng, mind)).toBe(false)
    expect(botHop(view({ time: 10.5 }), 'hard', rng, mind)).toBe(true)
  })

  it('never hops for a ball on the other side, or while cooling down', () => {
    const rng = new Rng(2)
    const mind = newMind()
    for (let t = 0; t < 3; t += 0.1) {
      expect(
        botHop(view({ ball: { x: 200, y: PITCH.ground - 30 }, time: t }), 'hard', rng, mind),
      ).toBe(false)
    }
    const m2 = newMind()
    for (let t = 0; t < 3; t += 0.1) {
      expect(botHop(view({ cool: COOLDOWN, time: t }), 'hard', rng, m2)).toBe(false)
    }
  })

  it('plays either side: red hops for a ball on the left', () => {
    const rng = new Rng(3)
    const mind = newMind()
    let hopped = false
    for (let t = 0; t < 2 && !hopped; t += 0.05) {
      hopped = botHop(
        view({
          side: 0,
          ball: { x: 300, y: PITCH.ground - 30 },
          me: { x: 300, y: STAND_Y },
          time: t,
        }),
        'hard',
        rng,
        mind,
      )
    }
    expect(hopped).toBe(true)
  })
})

describe('ballgames physics', () => {
  it('a hop leaves the grass and lands back on it', async () => {
    const Mx = await loadMatter()
    const w = new PhysicsWorld(Mx)
    addPitch(Mx, w)
    addPlayer(Mx, w, 0)
    const body = w.bodies.get(bodyId(0))!
    const head = w.bodies.get(headId(0))!
    for (let i = 0; i < 60; i++) w.step(1 / 60)
    expect(grounded(body.position.y)).toBe(true)
    Mx.Body.setVelocity(body, { x: 0, y: -15 })
    Mx.Body.setVelocity(head, { x: 0, y: -15 })
    let apex = Infinity
    for (let i = 0; i < 40; i++) {
      w.step(1 / 60)
      apex = Math.min(apex, body.position.y)
    }
    expect(STAND_Y - apex).toBeGreaterThan(150)
    for (let i = 0; i < 240 && !grounded(body.position.y); i++) w.step(1 / 60)
    expect(grounded(body.position.y)).toBe(true)
  })

  it('a head-to-head pin keeps the head joined to the torso', async () => {
    const Mx = await loadMatter()
    const w = new PhysicsWorld(Mx)
    addPitch(Mx, w)
    addPlayer(Mx, w, 1)
    const body = w.bodies.get(bodyId(1))!
    const head = w.bodies.get(headId(1))!
    for (let i = 0; i < 120; i++) w.step(1 / 60)
    const gap = Math.hypot(head.position.x - body.position.x, head.position.y - body.position.y)
    expect(gap).toBeLessThan(120)
  })
})

describe('ballgames end to end', () => {
  const run = async (seed: number, difficulty: Difficulty, target: number, limit: number) => {
    const game = factory()
    game.init(fakeCtx(seed, difficulty, target))
    // The world is built when matter has loaded: wait for that before stepping.
    await loadMatter()
    await new Promise((r) => setTimeout(r, 0))
    let steps = 0
    while (!game.result && steps < limit) {
      game.update(1 / 60)
      steps++
    }
    return { result: game.result, steps }
  }

  it('bot vs bot reaches a result within bounded steps (normal, first to 2)', async () => {
    const { result, steps } = await run(7, 'normal', 2, 60 * 900)
    expect(result).not.toBeNull()
    expect(steps).toBeLessThan(60 * 900)
    expect(result!.winner === 0 || result!.winner === 1).toBe(true)
  }, 60000)

  it('bot vs bot at easy and hard also finishes (first to 2)', async () => {
    for (const d of ['easy', 'hard'] as Difficulty[]) {
      const { result, steps } = await run(11, d, 2, 60 * 900)
      expect(result, d).not.toBeNull()
      expect(steps, d).toBeLessThan(60 * 900)
    }
  }, 120000)
})
