import { describe, expect, it } from 'vitest'
import type { Audio } from '../../core/audio.ts'
import { Fx } from '../../core/fx/fx.ts'
import type { Difficulty, GameContext } from '../../core/game.ts'
import type { Input } from '../../core/input.ts'
import { PlayerInput } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import type { Stage } from '../../core/stage.ts'
import { loadMatter, PhysicsWorld } from '../../engines/ragdoll/index.ts'
import factory, { match } from './index.ts'
import { botTap, newMind, type BotView } from './bot.ts'
import {
  COOLDOWN,
  FLICK_MIN,
  FLICK_V,
  flickBoost,
  grounded,
  headDown,
  HEAD_R,
  inReach,
  lungeDir,
  matchOver,
  RING,
  roundLoser,
  ROUND_TIME,
  stamina,
  STAND_Y,
  TIRED,
  timeoutLoser,
} from './rules.ts'
import { addRing, addWrestler, partId, uprightTorques } from './sim.ts'

/** A context with no DOM: the game only touches fx, audio and input in step(). */
function fakeCtx(seed: number, difficulty: Difficulty, target: number): GameContext {
  const inputs = [new PlayerInput(0), new PlayerInput(1)]
  return {
    stage: {} as Stage,
    input: { player: (s: 0 | 1) => inputs[s] } as unknown as Input,
    fx: new Fx(),
    audio: { play: () => {}, buzz: () => {} } as unknown as Audio,
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

const MAT_HEAD = RING.mat - HEAD_R

describe('wrestle rules', () => {
  it('is best of five by default', () => {
    expect(match.unit).toBe('wins')
    expect(match.default).toBe(3)
    expect(match.max).toBe(5)
  })

  it('a head on the mat is down, a head in the air is not', () => {
    expect(headDown(MAT_HEAD)).toBe(true)
    expect(headDown(MAT_HEAD - 200)).toBe(false)
  })

  it('the wrestler whose head touches the mat loses; both at once is a replay', () => {
    expect(roundLoser([MAT_HEAD, MAT_HEAD - 300])).toBe(0)
    expect(roundLoser([MAT_HEAD - 300, MAT_HEAD])).toBe(1)
    expect(roundLoser([MAT_HEAD, MAT_HEAD])).toBe('both')
    expect(roundLoser([MAT_HEAD - 300, MAT_HEAD - 300])).toBeNull()
  })

  it('on timeout the lower head loses', () => {
    const torsoX: [number, number] = [400, 600]
    expect(timeoutLoser([800, 700], torsoX)).toBe(0)
    expect(timeoutLoser([700, 800], torsoX)).toBe(1)
  })

  it('on timeout with level heads, the one pushed closer to their own rope loses', () => {
    // Red is pressed against its left rope: red loses.
    expect(timeoutLoser([800, 800], [RING.left + 40, 700])).toBe(0)
    // Blue is pressed against its right rope: blue loses.
    expect(timeoutLoser([800, 800], [600, RING.right - 40])).toBe(1)
  })

  it('a lunge goes toward the rival, and faces the way it stands when level', () => {
    expect(lungeDir(0, 300, 600)).toBe(1)
    expect(lungeDir(1, 700, 400)).toBe(-1)
    expect(lungeDir(0, 500, 500)).toBe(1)
    expect(lungeDir(1, 500, 500)).toBe(-1)
  })

  it('the match ends at the chosen number of round wins', () => {
    expect(matchOver([2, 2], 3)).toBeNull()
    expect(matchOver([3, 1], 3)).toBe(0)
    expect(matchOver([0, 1], 1)).toBe(1)
  })

  it('the rival is in reach only within the given distance', () => {
    expect(inReach(300, 500, 300)).toBe(true)
    expect(inReach(300, 700, 300)).toBe(false)
  })

  it('feet on the mat count as grounded, a jump does not', () => {
    expect(grounded(STAND_Y)).toBe(true)
    expect(grounded(STAND_Y - 80)).toBe(false)
    expect(COOLDOWN).toBeGreaterThan(0)
  })
})

describe('wrestle pacing and flicks', () => {
  it('wrestlers tire as the round drags on, down to a floor', () => {
    expect(stamina(0)).toBe(1)
    expect(stamina(ROUND_TIME / 2)).toBeLessThan(1)
    expect(stamina(ROUND_TIME / 2)).toBeGreaterThan(TIRED)
    expect(stamina(ROUND_TIME * 3)).toBeCloseTo(TIRED)
  })

  it('a short drag is no flick; a fast one pushes its way, up to FLICK_V', () => {
    expect(flickBoost(FLICK_MIN - 5, 0, 0.05)).toEqual({ vx: 0, vy: 0 })
    const right = flickBoost(300, 0, 0.08)
    expect(right.vx).toBeCloseTo(FLICK_V)
    expect(right.vy).toBeCloseTo(0)
    const up = flickBoost(0, -300, 0.08)
    expect(up.vy).toBeCloseTo(-FLICK_V)
    // A downward flick never pushes into the mat.
    expect(flickBoost(0, 300, 0.08).vy).toBe(0)
    // A slow drag is weaker than a flick.
    expect(flickBoost(300, 0, 1).vx).toBeLessThan(right.vx / 2)
  })
})

describe('wrestle bot', () => {
  const view = (over: Partial<BotView>): BotView => ({
    me: { x: 330, y: STAND_Y },
    rival: { x: 500 },
    cool: 0,
    time: 5,
    ...over,
  })

  it('taps after its reaction time when the rival is in reach and it is on the mat', () => {
    const rng = new Rng(4)
    const mind = newMind()
    expect(botTap(view({ time: 5 }), 'hard', rng, mind)).toBe(false)
    expect(botTap(view({ time: 5.3 }), 'hard', rng, mind)).toBe(true)
  })

  it('hard waits a beat for a ready rival to commit, then goes anyway', () => {
    const rng = new Rng(4)
    const mind = newMind()
    let first = -1
    for (let t = 5; t < 7 && first < 0; t += 1 / 60) {
      if (botTap(view({ time: t, rivalCool: 0 }), 'hard', rng, mind)) first = t
    }
    expect(first).toBeGreaterThan(5.3)
    expect(first).toBeLessThan(6)
    // Against a rival still recovering from its own move, it goes at once.
    const quick = newMind()
    let at = -1
    for (let t = 5; t < 7 && at < 0; t += 1 / 60) {
      if (botTap(view({ time: t, rivalCool: 0.4 }), 'hard', new Rng(4), quick)) at = t
    }
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(first)
  })

  it('does not tap out of reach, in the air or while cooling down', () => {
    const rng = new Rng(5)
    expect(botTap(view({ rival: { x: 900 }, time: 9 }), 'hard', rng, newMind())).toBe(false)
    expect(botTap(view({ me: { x: 330, y: STAND_Y - 90 }, time: 9 }), 'hard', rng, newMind())).toBe(
      false,
    )
    expect(botTap(view({ cool: 0.4, time: 9 }), 'hard', rng, newMind())).toBe(false)
  })

  it('a computer wrestler taps from either corner', () => {
    const rng = new Rng(6)
    const mind = newMind()
    let tapped = false
    for (let t = 0; t < 3 && !tapped; t += 0.05) {
      tapped = botTap(
        view({ me: { x: 670, y: STAND_Y }, rival: { x: 500 }, time: t }),
        'hard',
        rng,
        mind,
      )
    }
    expect(tapped).toBe(true)
  })
})

describe('wrestle physics', () => {
  it('a wrestler stands on the mat without falling', async () => {
    const Mx = await loadMatter()
    const w = new PhysicsWorld(Mx)
    addRing(Mx, w)
    addWrestler(Mx, w, 0)
    for (let i = 0; i < 240; i++) {
      uprightTorques(w, 0)
      w.step(1 / 60)
    }
    const head = w.bodies.get(partId(0, 0))!
    expect(headDown(head.position.y)).toBe(false)
    expect(head.position.y).toBeLessThan(RING.mat - 150)
  })

  it('a jump leaves the mat and comes back to it', async () => {
    const Mx = await loadMatter()
    const w = new PhysicsWorld(Mx)
    addRing(Mx, w)
    addWrestler(Mx, w, 1)
    for (let i = 0; i < 120; i++) {
      uprightTorques(w, 1)
      w.step(1 / 60)
    }
    const torso = w.bodies.get(partId(1, 1))!
    expect(grounded(torso.position.y)).toBe(true)
    for (const i of [0, 1, 2, 3, 4, 5]) {
      const p = w.bodies.get(partId(1, i))!
      Mx.Body.setVelocity(p, { x: 0, y: -12.5 })
    }
    let apex = Infinity
    for (let i = 0; i < 40; i++) {
      uprightTorques(w, 1)
      w.step(1 / 60)
      apex = Math.min(apex, torso.position.y)
    }
    expect(STAND_Y - apex).toBeGreaterThan(120)
    for (let i = 0; i < 300 && !grounded(torso.position.y); i++) {
      uprightTorques(w, 1)
      w.step(1 / 60)
    }
    expect(grounded(torso.position.y)).toBe(true)
  })
})

describe('wrestle end to end', () => {
  const run = async (seed: number, difficulty: Difficulty, target: number, limit: number) => {
    const game = factory()
    game.init(fakeCtx(seed, difficulty, target))
    // The ring is built once matter has loaded: wait for that before stepping.
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
    const { result, steps } = await run(3, 'normal', 2, 60 * 900)
    expect(result).not.toBeNull()
    expect(steps).toBeLessThan(60 * 900)
  }, 60000)

  it('bot vs bot at easy and hard also finishes (first to 2)', async () => {
    for (const d of ['easy', 'hard'] as Difficulty[]) {
      const { result, steps } = await run(9, d, 2, 60 * 900)
      expect(result, d).not.toBeNull()
      expect(steps, d).toBeLessThan(60 * 900)
    }
  }, 120000)
})
