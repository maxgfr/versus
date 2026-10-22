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
  BUFFER,
  COMMIT,
  HOLD_FORCE,
  REST,
  D_REST,
  IMPACT,
  LIFT,
  PULLED,
  STRIKE,
  STRIKE_MIN,
  TARGET,
  duelNew,
  handTarget,
  matchWinner,
  stepDuel,
  strikeTime,
  heatOf,
  HEAT_REST,
  HEAT_STRIKE,
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

  it('a flick commits the slap at once, and a harder flick lands sooner', () => {
    const rng = new Rng(20)
    const d = ready()
    stepDuel(d, STEP, PRESS, NONE, rng)
    const evs = stepDuel(d, STEP, { ...HOLD, flick: 1 }, NONE, rng)
    expect(evs).toContain('commit')
    expect(d.phase).toBe('strike')
    expect(d.force).toBe(1)
    expect(d.strike).toBeCloseTo(STRIKE_MIN)
    expect(strikeTime(HOLD_FORCE)).toBeCloseTo(STRIKE)
    expect(strikeTime(0.7)).toBeLessThan(STRIKE)
    expect(strikeTime(0.7)).toBeGreaterThan(STRIKE_MIN)
    // It lands within the shorter window.
    steps(d, Math.ceil(STRIKE_MIN / STEP) + 1, HOLD, NONE, rng)
    expect(d.points).toEqual([1, 0])
  })

  it('a flick that ends with the finger lifting is still a real slap, not a fake', () => {
    const rng = new Rng(21)
    const d = ready()
    stepDuel(d, STEP, PRESS, NONE, rng)
    const evs = stepDuel(d, STEP, { ...LET_GO, flick: 0.6 }, NONE, rng)
    expect(evs).toContain('commit')
    expect(evs).not.toContain('fake')
    expect(d.force).toBeCloseTo(0.6)
  })

  it('a held slap keeps the standard force and window', () => {
    const rng = new Rng(22)
    const d = ready()
    stepDuel(d, STEP, PRESS, NONE, rng)
    steps(d, Math.ceil(COMMIT / STEP) + 1, HOLD, NONE, rng)
    expect(d.force).toBe(HOLD_FORCE)
    expect(d.strike).toBe(STRIKE)
  })

  it('a press just before the rest ends is queued instead of swallowed', () => {
    const rng = new Rng(23)
    const d = duelNew(0)
    d.cool = BUFFER - 0.05
    stepDuel(d, STEP, PRESS, NONE, rng)
    expect(d.phase).toBe('rest')
    steps(d, Math.ceil(BUFFER / STEP) + 1, HOLD, NONE, rng)
    expect(d.phase).toBe('wind')
  })

  it('a queued press let go before the rest ends does nothing', () => {
    const rng = new Rng(24)
    const d = duelNew(0)
    d.cool = BUFFER - 0.05
    stepDuel(d, STEP, PRESS, NONE, rng)
    steps(d, Math.ceil(BUFFER / STEP) + 1, LET_GO, NONE, rng)
    expect(d.phase).toBe('rest')
  })

  it('an early press long before the rest ends is still ignored', () => {
    const rng = new Rng(25)
    const d = duelNew(0)
    d.cool = 0.6
    stepDuel(d, STEP, PRESS, NONE, rng)
    steps(d, Math.ceil(0.6 / STEP) + 2, HOLD, NONE, rng)
    expect(d.phase).toBe('rest')
  })

  it('a fake is followed by a shorter rest than a slap', () => {
    const rng = new Rng(26)
    const d = ready()
    stepDuel(d, STEP, PRESS, NONE, rng)
    stepDuel(d, STEP, LET_GO, NONE, rng)
    settle(d, rng, LET_GO)
    expect(d.cool).toBeLessThan(REST)
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
      const b = bot.drive(STEP, 'def', { phase: d.phase, t: d.t, strike: d.strike })
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

  it('difficulty orders the defence: easy < normal < hard (hard used to be slower than normal)', () => {
    const [easy, normal, hard] = (['easy', 'normal', 'hard'] as const).map((d) => dodgeRate(d))
    expect(normal).toBeGreaterThan((easy ?? 0) + 0.15)
    expect(hard).toBeGreaterThan((normal ?? 0) + 0.1)
    // Beatable: even hard gets caught now and then.
    expect(hard).toBeLessThan(1)
  })

  it('a hard defender pulls early against an attacker who never fakes', () => {
    const rng = new Rng(31)
    const bot = new SlapBot(rng.fork(), 'hard')
    let early = 0
    for (let i = 0; i < 40; i++) {
      const d = ready(0)
      let n = 0
      while (n++ < 600) {
        const a: Touch = d.phase === 'rest' ? PRESS : HOLD
        const b = bot.drive(STEP, 'def', { phase: d.phase, t: d.t, strike: d.strike })
        const wasWind = d.phase === 'wind'
        stepDuel(d, STEP, a, b.tap ? PULL : NONE, rng)
        if (wasWind && d.pend) {
          early++
          break
        }
        if (d.phase === 'rest' && n > 2) break
      }
    }
    expect(early).toBeGreaterThan(8)
  })

  it('a hard attacker fakes more against a jumpy defender than a patient one', () => {
    const fakeShare = (jumpy: boolean): number => {
      const rng = new Rng(12)
      const bot = new SlapBot(rng.fork(), 'hard')
      let fakes = 0
      let total = 0
      for (let i = 0; i < 200; i++) {
        const d = ready(0)
        let n = 0
        let faked = false
        let started = false
        while (n++ < 600) {
          const a = bot.drive(STEP, 'att', {
            phase: d.phase,
            t: d.t,
            cool: d.cool,
            pend: d.pend,
            flinched: d.flinched,
          })
          const b = jumpy && d.phase === 'wind' && d.t > 0 ? PULL : NONE
          stepDuel(d, STEP, a, b, rng)
          if (d.phase !== 'rest') started = true
          if (d.phase === 'fake') faked = true
          if (d.phase === 'rest' && started) break
        }
        // One more look at rest so the bot books the outcome.
        bot.drive(STEP, 'att', { phase: 'rest', t: 0, cool: 1 })
        total++
        if (faked) fakes++
      }
      return fakes / total
    }
    expect(fakeShare(true)).toBeGreaterThan(fakeShare(false) + 0.2)
  })

  it('a hard attacker flicks most real slaps, an easy one mostly holds', () => {
    const flickShare = (difficulty: Difficulty): number => {
      const rng = new Rng(5)
      const bot = new SlapBot(rng.fork(), difficulty)
      let flicks = 0
      let reals = 0
      for (let i = 0; i < 300; i++) {
        const d = ready(0)
        let n = 0
        while (n++ < 600 && d.phase !== 'strike' && d.phase !== 'fake') {
          stepDuel(d, STEP, bot.drive(STEP, 'att', { phase: d.phase, t: d.t, cool: 0 }), NONE, rng)
        }
        if (d.phase === 'strike') {
          reals++
          if (d.force > HOLD_FORCE) flicks++
        }
        bot.drive(STEP, 'att', { phase: 'rest', t: 0, cool: 1 })
      }
      return flicks / Math.max(1, reals)
    }
    expect(flickShare('hard')).toBeGreaterThan(0.6)
    expect(flickShare('easy')).toBeLessThan(0.3)
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

describe('hand slap ramp', () => {
  it('heat rises with the leading score and is full at match point', () => {
    expect(heatOf([0, 0], 5)).toBe(0)
    expect(heatOf([2, 1], 5)).toBeCloseTo(0.5)
    expect(heatOf([1, 4], 5)).toBe(1)
    expect(heatOf([0, 0], 1)).toBe(1)
  })

  it('a hotter match lands slaps sooner, the same for both players', () => {
    expect(strikeTime(HOLD_FORCE, 1)).toBeCloseTo(STRIKE * (1 - HEAT_STRIKE))
    expect(strikeTime(1, 1)).toBeLessThan(strikeTime(1, 0))
    const rng = new Rng(40)
    const d = ready()
    d.heat = 1
    stepDuel(d, STEP, PRESS, NONE, rng)
    steps(d, Math.ceil(COMMIT / STEP) + 1, HOLD, NONE, rng)
    expect(d.strike).toBeCloseTo(STRIKE * (1 - HEAT_STRIKE))
  })

  it('a hotter match rests less between attacks', () => {
    const rest = (heat: number): number => {
      const rng = new Rng(41)
      const d = ready()
      d.heat = heat
      stepDuel(d, STEP, PRESS, NONE, rng)
      settle(d, rng)
      return d.cool
    }
    expect(rest(1)).toBeLessThan(rest(0) * (1 - HEAT_REST) + 1e-9)
  })
})

/** A whole match between two bots, with the heat ramp, to `target` points. */
function botMatch(a: Difficulty, b: Difficulty, seed: number, target = 5): Side {
  const rng = new Rng(seed)
  const bots = [new SlapBot(rng.fork(), a), new SlapBot(rng.fork(), b)]
  const d = duelNew(rng.chance(0.5) ? 1 : 0)
  for (let i = 0; i < 60 * 600; i++) {
    const att = d.att
    const def: Side = att === 0 ? 1 : 0
    const view = {
      phase: d.phase,
      t: d.t,
      cool: d.cool,
      pend: d.pend,
      flinched: d.flinched,
      strike: d.strike,
    }
    const ta = (bots[att] as SlapBot).drive(STEP, 'att', view)
    const tb = (bots[def] as SlapBot).drive(STEP, 'def', view)
    stepDuel(d, STEP, ta, tb, rng)
    d.heat = heatOf(d.points, target)
    const w = matchWinner(d, target)
    if (w !== null) return w
  }
  throw new Error('match never ended')
}

describe('hand slap difficulty spread', () => {
  const share = (strong: Difficulty, weak: Difficulty, n: number): number => {
    let wins = 0
    for (let seed = 1; seed <= n; seed++) {
      // Swap sides every other match.
      const flip = seed % 2 === 0
      const w = flip ? botMatch(weak, strong, seed) : botMatch(strong, weak, seed)
      if ((w === 0) !== flip) wins++
    }
    return wins / n
  }

  it('hard beats easy most of the time over seeded matches', () => {
    expect(share('hard', 'easy', 40)).toBeGreaterThanOrEqual(0.85)
  })

  it('normal beats easy, and hard beats normal, more often than not', () => {
    expect(share('normal', 'easy', 40)).toBeGreaterThanOrEqual(0.75)
    expect(share('hard', 'normal', 40)).toBeGreaterThan(0.5)
  })
})
