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
import factory, { match, type State } from './index.ts'
import { botHop, type BotMind, type BotView, chance, hopMeets, newMind, type Plan } from './bot.ts'
import {
  attackDir,
  BALL_R,
  ballPath,
  BODY,
  canHop,
  capped,
  closingSpeed,
  escaped,
  KICK_MAX,
  KICK_MIN,
  KICK_SPEED,
  kickPower,
  kickSpeed,
  leadX,
  MAX_BALL,
  REST_STEPS,
  restCount,
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
import { addBall, addPitch, addPlayer, bodyId, headId } from './sim.ts'

/** A context with no DOM: the game only touches fx, audio and input in step(). */
function fakeCtx(
  seed: number,
  difficulty: Difficulty,
  target: number,
  bots: [boolean, boolean] = [true, true],
): GameContext {
  const inputs = [new PlayerInput(0), new PlayerInput(1)]
  return {
    stage: {} as Stage,
    input: { player: (s: 0 | 1) => inputs[s] } as unknown as Input,
    fx: new Fx(),
    audio: { play: () => {}, buzz: () => {} } as unknown as Audio,
    rng: new Rng(seed),
    mode: '1p',
    difficulty,
    bots,
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
    expect(botHop(view({ time: 10 }), 'hard', rng, mind)).toBeNull()
    expect(botHop(view({ time: 10.5 }), 'hard', rng, mind)).not.toBeNull()
  })

  it('never hops for a ball on the other side, or while cooling down', () => {
    const rng = new Rng(2)
    const mind = newMind()
    for (let t = 0; t < 3; t += 0.1) {
      expect(
        botHop(view({ ball: { x: 200, y: PITCH.ground - 30 }, time: t }), 'hard', rng, mind),
      ).toBeNull()
    }
    const m2 = newMind()
    for (let t = 0; t < 3; t += 0.1) {
      expect(botHop(view({ cool: COOLDOWN, time: t }), 'hard', rng, m2)).toBeNull()
    }
  })

  it('plays either side: red hops for a ball on the left', () => {
    const rng = new Rng(3)
    const mind = newMind()
    let hopped = false
    for (let t = 0; t < 2 && !hopped; t += 0.05) {
      hopped =
        botHop(
          view({
            side: 0,
            ball: { x: 300, y: PITCH.ground - 30 },
            me: { x: 300, y: STAND_Y },
            time: t,
          }),
          'hard',
          rng,
          mind,
        ) !== null
    }
    expect(hopped).toBe(true)
  })

  // Bug: the old bot only hopped for a ball within reach, so a ball resting on
  // its own half a few strides away was never chased: dead time until the
  // stall reset, every time.
  it('hops over to a ball resting on its own half out of reach, at every level', () => {
    for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
      const rng = new Rng(4)
      const mind = newMind()
      let plan: Plan | null = null
      for (let t = 0; t < 4 && !plan; t += 1 / 60) {
        plan = botHop(
          view({
            ball: { x: 520, y: PITCH.ground - BALL_R },
            me: { x: 860, y: STAND_Y },
            time: t,
          }),
          d,
          rng,
          mind,
        )
      }
      expect(plan, d).not.toBeNull()
      // It heads for the ball, landing between it and its own (right) goal.
      expect(plan!.aimX, d).toBeGreaterThan(520)
      expect(plan!.aimX, d).toBeLessThan(860)
    }
  })

  it('reads the ball ahead: hops to meet a ball dropping onto it, not where it is now', () => {
    // The ball is high above, falling toward the player: a hop now meets it in the air.
    const hit = hopMeets({ x: 700, y: STAND_Y }, 700, ballPath(700, PITCH.ceil + 60, 0, 6, 40), 40)
    expect(hit).not.toBeNull()
    expect(
      chance(view({ ball: { x: 700, y: PITCH.ceil + 60 }, bv: { x: 0, y: 6 } }), 'hard'),
    ).not.toBeNull()
    // A ball far up the other end is nobody's business.
    expect(chance(view({ ball: { x: 150, y: PITCH.ceil + 60 } }), 'hard')).toBeNull()
  })

  it('hard reacts faster and winds up harder than easy', () => {
    const delays: Record<string, number> = {}
    const charges: Record<string, number> = {}
    for (const d of ['easy', 'hard'] as Difficulty[]) {
      let total = 0
      let charge = 0
      for (let seed = 1; seed <= 30; seed++) {
        const rng = new Rng(seed)
        const mind = newMind()
        let t = 0
        let plan: Plan | null = null
        for (; t < 5 && !plan; t += 1 / 60) plan = botHop(view({ time: t }), d, rng, mind)
        total += t
        charge += plan?.charge ?? 0
      }
      delays[d] = total / 30
      charges[d] = charge / 30
    }
    expect(delays.hard).toBeLessThan(delays.easy! * 0.5)
    expect(charges.hard).toBeGreaterThan(charges.easy! + 0.3)
  })
})

describe('ballgames kick power', () => {
  it('a held wind-up and a fast hop both make a harder kick', () => {
    const tap = kickPower(0.1, 4)
    expect(kickPower(1, 4)).toBeGreaterThan(tap + 0.3)
    expect(kickPower(0.1, 18)).toBeGreaterThan(tap + 0.2)
    expect(kickPower(0, -10)).toBeGreaterThanOrEqual(0)
    expect(kickPower(1, 99)).toBeLessThanOrEqual(1)
    const soft = Math.hypot(...Object.values(kickVelocity({ x: 0, y: 0 }, { x: 30, y: 0 }, 0, 0)))
    const hard = Math.hypot(...Object.values(kickVelocity({ x: 0, y: 0 }, { x: 30, y: 0 }, 0, 1)))
    expect(soft).toBeCloseTo(KICK_MIN)
    expect(hard).toBeCloseTo(KICK_MAX)
    expect(kickSpeed(0.5)).toBeCloseTo(KICK_SPEED)
  })

  it('closing speed is how fast the kicker runs into the ball', () => {
    expect(closingSpeed({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 0 })).toBe(10)
    expect(closingSpeed({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 50, y: 0 }, { x: -5, y: 0 })).toBe(15)
    expect(closingSpeed({ x: 0, y: 0 }, { x: -10, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 0 })).toBe(
      -10,
    )
    expect(closingSpeed({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0)
  })

  it('no ball speed can carry it through a crossbar (20 thick) in one step', () => {
    expect(KICK_MAX).toBeLessThanOrEqual(MAX_BALL)
    expect(MAX_BALL).toBeLessThan(20 + BALL_R * 2)
    const v = capped({ x: 300, y: -400 })
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(MAX_BALL)
    expect(capped({ x: 3, y: 4 })).toEqual({ x: 3, y: 4 })
  })
})

describe('ballgames standing', () => {
  // Bug: only feet on the grass counted as standing, so a player who landed on
  // top of a crossbar (or the ball, or the rival) could never hop again.
  it('a player perched still off the grass may hop again after a few still steps', () => {
    const y = GOAL_TOP - 20 - BODY.h / 2
    let rest = 0
    for (let i = 0; i < REST_STEPS - 1; i++) rest = restCount(rest, y, 0)
    expect(canHop(y, rest)).toBe(false)
    rest = restCount(rest, y, 0.1)
    expect(canHop(y, rest)).toBe(true)
    // The apex of a hop is only still for a step or two: no double jump there.
    expect(restCount(restCount(0, y, 0.2), y, -0.4)).toBe(0)
    expect(restCount(9, STAND_Y, 0)).toBe(0)
  })

  it('a player dropped on a crossbar settles there, off the grass, and can hop off', async () => {
    const Mx = await loadMatter()
    const w = new PhysicsWorld(Mx)
    addPitch(Mx, w)
    const barX = PITCH.left + PITCH.goalD / 2
    addPlayer(Mx, w, 0, barX)
    const body = w.bodies.get(bodyId(0))!
    const head = w.bodies.get(headId(0))!
    Mx.Body.setPosition(body, { x: barX, y: GOAL_TOP - 10 - BODY.h / 2 - 4 })
    Mx.Body.setPosition(head, { x: barX, y: GOAL_TOP - 10 - BODY.h / 2 - 4 - 70 })
    let rest = 0
    for (let i = 0; i < 90; i++) {
      w.step(1 / 60)
      rest = restCount(rest, body.position.y, body.velocity.y)
    }
    expect(grounded(body.position.y)).toBe(false)
    expect(canHop(body.position.y, rest)).toBe(true)
  })

  it('knows a body that has left the pitch', () => {
    expect(escaped(W / 2, PITCH.ground - 40)).toBe(false)
    expect(escaped(PITCH.left - 60, 900)).toBe(true)
    expect(escaped(W / 2, PITCH.ground + 200)).toBe(true)
    expect(escaped(Number.NaN, 900)).toBe(true)
  })
})

describe('ballgames ball path', () => {
  it('never leaves the pitch and bounces off the grass', () => {
    const p = ballPath(W / 2, PITCH.ceil + 100, 25, 10, 240)
    let bounced = false
    for (let i = 0; i < 240; i++) {
      const x = p[i * 2]!
      const y = p[i * 2 + 1]!
      expect(x).toBeGreaterThanOrEqual(PITCH.left + BALL_R)
      expect(x).toBeLessThanOrEqual(PITCH.right - BALL_R)
      expect(y).toBeLessThanOrEqual(PITCH.ground - BALL_R)
      if (i > 0 && y < p[i * 2 - 1]! && p[i * 2 - 1]! >= PITCH.ground - BALL_R - 1) bounced = true
    }
    expect(bounced).toBe(true)
  })

  it('matches the real ball in free flight', async () => {
    const Mx = await loadMatter()
    const w = new PhysicsWorld(Mx)
    addPitch(Mx, w)
    const ball = addBall(Mx, w, 400, 800)
    Mx.Body.setVelocity(ball, { x: 6, y: -8 })
    const p = ballPath(400, 800, 6, -8, 20)
    for (let i = 0; i < 20; i++) w.step(1 / 60)
    expect(Math.abs(ball.position.x - p[38]!)).toBeLessThan(6)
    expect(Math.abs(ball.position.y - p[39]!)).toBeLessThan(6)
    expect(leadX(400, 800, 6, -8, 20)).toBeCloseTo(p[38]!)
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

  it('is deterministic: the same seed plays the same match', async () => {
    const a = await run(5, 'hard', 1, 60 * 600)
    const b = await run(5, 'hard', 1, 60 * 600)
    expect(a.result).toEqual(b.result)
    expect(a.steps).toBe(b.steps)
  }, 60000)

  // Bug: once the match was decided only the winner's kick timer ran down, so
  // a loser caught mid-kick kept its leg frozen out through the whole ending.
  it('every kick timer runs down while the ending plays', async () => {
    const game = factory()
    game.init(fakeCtx(3, 'hard', 1))
    await loadMatter()
    await new Promise((r) => setTimeout(r, 0))
    const g = game as unknown as { s: State; over: boolean }
    let steps = 0
    while (!g.over && steps < 60 * 600) {
      game.update(1 / 60)
      steps++
    }
    expect(g.over).toBe(true)
    g.s.kick = [1, 1]
    for (let i = 0; i < 90; i++) game.update(1 / 60)
    expect(g.s.kick).toEqual([0, 0])
  }, 60000)

  it('holding the finger after a hop winds up the kick; letting go stops it', async () => {
    const ctx = fakeCtx(9, 'easy', 3, [false, true])
    const game = factory()
    game.init(ctx)
    await loadMatter()
    await new Promise((r) => setTimeout(r, 0))
    const g = game as unknown as { s: State }
    const red = ctx.input.player(0)
    const tick = () => {
      game.update(1 / 60)
      red.endStep()
    }
    for (let i = 0; i < 30; i++) tick()
    red.press(1, 500, 1500)
    tick()
    expect(g.s.kick[0]).toBeGreaterThan(0)
    for (let i = 0; i < 12; i++) tick()
    const held = g.s.charge[0]
    expect(held).toBeGreaterThan(0.3)
    red.release(1)
    for (let i = 0; i < 12; i++) tick()
    expect(g.s.charge[0]).toBeLessThanOrEqual(held + 0.05)
    expect(g.s.winding[0]).toBe(false)
  }, 30000)
})
