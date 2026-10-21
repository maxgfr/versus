import { describe, expect, it } from 'vitest'
import type { Audio } from '../../core/audio.ts'
import { Fx } from '../../core/fx/fx.ts'
import { STEP, type Difficulty, type GameContext, type Side } from '../../core/game.ts'
import { Input } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import type { Stage } from '../../core/stage.ts'
import { SlapBot } from './bot.ts'
import factory from './index.ts'
import {
  A_REST,
  COMMIT,
  D_REST,
  IMPACT,
  LIFT,
  PULLED,
  STRIKE,
  TARGET,
  duelNew,
  handTarget,
  matchWinner,
  stepDuel,
  type Duel,
  type Ev,
  type Touch,
} from './rules.ts'

const NONE: Touch = { press: false, held: false, tap: false }
const PRESS: Touch = { press: true, held: true, tap: false }
const HOLD: Touch = { press: false, held: true, tap: false }
const LET_GO: Touch = { press: false, held: false, tap: false }
const PULL: Touch = { press: false, held: false, tap: true }

/** Run `n` steps with fixed touches; collect the events. */
function steps(d: Duel, n: number, a: Touch, b: Touch, rng: Rng): Ev[] {
  const evs: Ev[] = []
  for (let i = 0; i < n; i++) evs.push(...stepDuel(d, STEP, a, b, rng))
  return evs
}

/** Run until the duel is back at rest (an attack resolved). */
function settle(d: Duel, rng: Rng, a: Touch = HOLD, b: Touch = NONE): Ev[] {
  const evs: Ev[] = []
  let n = 0
  while (d.phase !== 'rest') {
    evs.push(...stepDuel(d, STEP, a, b, rng))
    if (++n > 600) throw new Error('attack never resolved')
  }
  return evs
}

/** A ready duel with `att` attacking and no cool-down. */
const ready = (att: Side = 0): Duel => ({ ...duelNew(att), cool: 0 })

describe('hand slap rules', () => {
  it('a quick press and release is a fake the defender can ignore', () => {
    const rng = new Rng(1)
    const d = ready()
    stepDuel(d, STEP, PRESS, NONE, rng)
    const evs = [...steps(d, 1, LET_GO, NONE, rng), ...settle(d, rng, LET_GO)]
    expect(evs).toContain('fake')
    expect(evs).not.toContain('commit')
    expect(d.points).toEqual([0, 0])
    expect(d.att).toBe(0)
  })

  it('holding through the commit point makes the slap real and it connects', () => {
    const rng = new Rng(2)
    const d = ready()
    stepDuel(d, STEP, PRESS, NONE, rng)
    steps(d, Math.ceil(COMMIT / STEP) + 1, HOLD, NONE, rng)
    expect(d.phase).toBe('strike')
    const evs = settle(d, rng)
    expect(evs).toContain('connect')
    expect(d.points).toEqual([1, 0])
    expect(d.att).toBe(0)
  })

  it('pulling away from a real slap swaps the roles and scores nothing', () => {
    const rng = new Rng(3)
    const d = ready()
    stepDuel(d, STEP, PRESS, NONE, rng)
    steps(d, Math.ceil(COMMIT / STEP) + 1, HOLD, NONE, rng)
    expect(d.phase).toBe('strike')
    const evs = [...stepDuel(d, STEP, HOLD, PULL, rng), ...settle(d, rng)]
    expect(evs).toContain('pull')
    expect(evs).toContain('whiff')
    expect(evs).toContain('swap')
    expect(d.points).toEqual([0, 0])
    expect(d.att).toBe(1)
  })

  it('a tap during the wind-up on a fake is a flinch, which scores for the attacker', () => {
    const rng = new Rng(4)
    const d = ready()
    stepDuel(d, STEP, PRESS, NONE, rng)
    stepDuel(d, STEP, HOLD, PULL, rng)
    const evs = [...stepDuel(d, STEP, LET_GO, NONE, rng), ...settle(d, rng, LET_GO)]
    expect(evs).toContain('fake')
    expect(evs).toContain('flinch')
    expect(d.points).toEqual([1, 0])
    expect(d.att).toBe(0)
  })

  it('a flinch on a fake scores once, however often the defender taps', () => {
    const rng = new Rng(5)
    const d = ready()
    stepDuel(d, STEP, PRESS, NONE, rng)
    stepDuel(d, STEP, LET_GO, NONE, rng)
    expect(d.phase).toBe('fake')
    steps(d, 5, NONE, PULL, rng)
    steps(d, 5, NONE, PULL, rng)
    settle(d, rng, LET_GO)
    expect(d.points).toEqual([1, 0])
  })

  it('a tap before the slap is revealed still dodges it when the slap is real', () => {
    const rng = new Rng(6)
    const d = ready()
    stepDuel(d, STEP, PRESS, NONE, rng)
    stepDuel(d, STEP, HOLD, PULL, rng)
    steps(d, Math.ceil(COMMIT / STEP) + 1, HOLD, NONE, rng)
    expect(d.phase).toBe('strike')
    expect(d.dodged).toBe(true)
    const evs = settle(d, rng)
    expect(evs).toContain('whiff')
    expect(d.points).toEqual([0, 0])
    expect(d.att).toBe(1)
  })

  it('a defender tap after the impact is too late to dodge', () => {
    const rng = new Rng(7)
    const d = ready()
    stepDuel(d, STEP, PRESS, NONE, rng)
    steps(d, Math.ceil(COMMIT / STEP) + 1, HOLD, NONE, rng)
    steps(d, Math.ceil(STRIKE / STEP) + 2, HOLD, NONE, rng)
    expect(d.phase).toBe('rest')
    expect(d.points).toEqual([1, 0])
  })

  it('the attacker cannot press again while cooling down', () => {
    const rng = new Rng(8)
    const d = duelNew(0)
    expect(d.cool).toBeGreaterThan(0)
    stepDuel(d, STEP, PRESS, NONE, rng)
    expect(d.phase).toBe('rest')
  })

  it('first to the target takes the match', () => {
    const d = ready()
    d.points = [TARGET - 1, 2]
    expect(matchWinner(d)).toBeNull()
    d.points = [TARGET, 2]
    expect(matchWinner(d)).toBe(0)
    d.points = [2, TARGET]
    expect(matchWinner(d)).toBe(1)
  })

  it('the hands follow the attack: the attacker lifts, strikes and the defender pulls back', () => {
    const d = ready()
    expect(handTarget(d, 0)).toBe(A_REST)
    expect(handTarget(d, 1)).toBe(D_REST)
    d.phase = 'wind'
    expect(handTarget(d, 0)).toBe(A_REST + LIFT)
    d.phase = 'strike'
    expect(handTarget(d, 0)).toBe(IMPACT)
    d.dodged = true
    expect(handTarget(d, 1)).toBe(PULLED)
  })
})

// ---------- game level ----------

function ctxFor(
  bots: [boolean, boolean],
  difficulty: Difficulty,
  seed: number,
  mode: GameContext['mode'] = '2p',
): GameContext {
  const audio = { play: () => {}, unlock: () => {}, buzz: () => {} } as unknown as Audio
  return {
    stage: { edge: (side: Side) => (side === 0 ? 1800 : 0) } as unknown as Stage,
    input: new Input({} as Stage, mode, 0),
    fx: new Fx(),
    audio,
    rng: new Rng(seed),
    mode,
    difficulty,
    bots,
    teams: false,
    names: ['Red', 'Blue'],
    local: 0,
    seed,
  }
}

/** Share of real slaps a defender bot pulls away from, over many attacks. */
function dodgeRate(difficulty: Difficulty): number {
  const rng = new Rng(77)
  const bot = new SlapBot(rng.fork(), difficulty)
  let dodges = 0
  const trials = 300
  for (let i = 0; i < trials; i++) {
    const d = ready(0)
    let n = 0
    let whiffed = false
    while (!whiffed && n++ < 600) {
      const a: Touch = d.phase === 'rest' ? PRESS : HOLD
      const b = bot.drive(STEP, 'def', { phase: d.phase, t: d.t })
      const evs = stepDuel(d, STEP, a, b.tap ? PULL : NONE, rng)
      if (evs.includes('whiff')) whiffed = true
      if (evs.includes('connect')) break
    }
    if (whiffed) dodges++
  }
  return dodges / trials
}

describe('hand slap bots', () => {
  it('a hard defender pulls away from more real slaps than an easy one', () => {
    const hard = dodgeRate('hard')
    const easy = dodgeRate('easy')
    expect(hard).toBeGreaterThan(easy + 0.2)
    expect(hard).toBeGreaterThan(0.5)
    expect(easy).toBeLessThan(0.4)
  })

  it('a bot attacker mixes real slaps with fakes', () => {
    const bot = new SlapBot(new Rng(9), 'normal')
    let presses = 0
    let holds = 0
    let releases = 0
    for (let i = 0; i < 12000; i++) {
      const t = bot.drive(STEP, 'att', { phase: 'rest', t: 0, cool: 0 })
      if (!t.press) continue
      presses++
      let wt = 0
      let held = true
      while (held && wt < 0.5) {
        wt += STEP
        held = bot.drive(STEP, 'att', { phase: 'wind', t: wt }).held
      }
      if (wt >= COMMIT) holds++
      else releases++
    }
    expect(presses).toBeGreaterThan(150)
    expect(holds).toBeGreaterThan(0)
    expect(releases).toBeGreaterThan(0)
  })
})

describe('hand slap game', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`bot vs bot plays a match to five points (${difficulty})`, () => {
      const game = factory()
      game.init(ctxFor([true, true], difficulty, 41))
      let n = 0
      while (!game.result) {
        game.update(STEP)
        if (++n > 60 * 400) throw new Error('no result')
      }
      const w = game.result.winner
      expect(w === 0 || w === 1).toBe(true)
      const [red, blue] = game.result.score ?? [0, 0]
      expect(w === 0 ? red : blue).toBe(TARGET)
      expect(Math.min(red, blue)).toBeLessThan(TARGET)
    })
  }
})

describe('hand slap match length', () => {
  it('honours a chosen points target', () => {
    const d = duelNew(0)
    d.points = [3, 1]
    expect(matchWinner(d, 3)).toBe(0)
    expect(matchWinner(d, 7)).toBeNull()
  })
})
