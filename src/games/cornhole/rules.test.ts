import { describe, expect, it } from 'vitest'
import { STEP, type Difficulty, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { simulate, solveShot } from '../../engines/aim/index.ts'
import { choose } from './bot.ts'
import {
  advance,
  type Bag,
  BAG_R,
  BAGS_EACH,
  bagPoints,
  HOLE,
  landingOf,
  newState,
  onBoard,
  SCORE_PAUSE,
  type State,
  THROW,
  TO_WIN,
  TOSS,
  toss,
  winner,
} from './rules.ts'

/** Advance until every bag has settled and the turn (or round) has moved on. */
function settle(s: State, maxSteps = 60 * 30): number {
  let steps = 0
  while (s.phase === 'fly' && steps < maxSteps) {
    advance(s, STEP)
    steps++
  }
  return steps
}

/** A shot from `side` that lands on the target point (no jitter), found by the aim solver. */
function shotTo(side: Side, target: { x: number; y: number }) {
  const from = THROW[side] as { x: number; y: number }
  return solveShot((sh) => simulate(from.x, from.y, sh, TOSS, 0, []), from, target)
}

function bag(side: Side, st: Bag['st'], x = HOLE.x, y = HOLE.y): Bag {
  return { side, x, y, z: 0, vx: 0, vy: 0, vz: 0, st, since: 0 }
}

/** A state mid-round with `bags` thrown and all tosses used, so the next settle ends the round. */
function roundWith(bags: Bag[], score: [number, number] = [0, 0]): State {
  const s = newState(0)
  s.bags = bags
  s.tosses = [BAGS_EACH, BAGS_EACH]
  s.score = score
  s.phase = 'fly'
  return s
}

/** Full match between two computer players, bounded. */
function playOut(
  a: Difficulty,
  b: Difficulty,
  seed: number,
): { winner: Side | null; steps: number; rounds: number } {
  const rng = new Rng(seed)
  const s = newState(rng.chance(0.5) ? 0 : 1)
  let steps = 0
  const limit = 60 * 60 * 6
  while (winner(s) === null && steps < limit) {
    if (s.phase === 'aim') toss(s, choose(s, s.turn, s.turn === 0 ? a : b, rng))
    if (s.phase === 'score') {
      advance(s, STEP)
    } else advance(s, STEP)
    if (s.phase === 'over') break
    steps++
  }
  return { winner: winner(s), steps, rounds: s.round }
}

describe('cornhole: throwing', () => {
  it('only the player on turn throws, and only four bags each', () => {
    const s = newState(0)
    expect(toss(s, { dx: 0, dy: -1, power: 0.5 })).toBe(true)
    expect(s.phase).toBe('fly')
    expect(toss(s, { dx: 0, dy: -1, power: 0.5 })).toBe(false) // still flying
    settle(s)
    expect(s.turn).toBe(1)
    expect(s.tosses).toEqual([1, 0])
    for (let i = 0; i < 7; i++) {
      toss(s, { dx: 0, dy: 1, power: 0.5 })
      settle(s)
    }
    expect(s.tosses).toEqual([BAGS_EACH, BAGS_EACH])
    expect(toss(s, { dx: 0, dy: -1, power: 0.5 })).toBe(false)
  })

  it('a weak throw falls short on the table and scores nothing', () => {
    const s = newState(0)
    toss(s, { dx: 0, dy: -1, power: 0.1 })
    settle(s)
    expect(s.bags[0]?.st).toBe('table')
    expect(bagPoints(s.bags[0] as Bag)).toBe(0)
  })

  it('a soft throw at the hole drops in for three', () => {
    const s = newState(0)
    toss(s, shotTo(0, HOLE))
    settle(s)
    expect(s.bags[0]?.st).toBe('hole')
    expect(bagPoints(s.bags[0] as Bag)).toBe(3)
  })

  it('a bag that lands near the far end slides off the board', () => {
    const s = newState(0)
    toss(s, shotTo(0, { x: 500, y: 520 }))
    settle(s)
    expect(s.bags[0]?.st).toBe('off')
    expect(bagPoints(s.bags[0] as Bag)).toBe(0)
  })

  it("a bag landing near red's end slides a little and stays on the board for one", () => {
    const s = newState(0)
    toss(s, shotTo(0, { x: 500, y: 1200 }))
    settle(s)
    expect(s.bags[0]?.st).toBe('rest')
    expect(onBoard(s.bags[0]?.x ?? 0, s.bags[0]?.y ?? 0)).toBe(true)
    expect(bagPoints(s.bags[0] as Bag)).toBe(1)
  })

  it('the landing spot of a throw is where the bag touches down', () => {
    const shot = shotTo(1, { x: 500, y: 700 })
    const p = landingOf(1, shot)
    expect(Math.hypot(p.x - 500, p.y - 700)).toBeLessThan(25)
  })
})

describe('cornhole: scoring', () => {
  it('cancellation: only the difference of a round counts, for the leader', () => {
    // Red: a hole and three on the board (6). Blue: a hole (3). Red nets 3.
    const s = roundWith([
      bag(0, 'hole'),
      bag(0, 'rest', 500, 1100),
      bag(0, 'rest', 500, 1150),
      bag(0, 'rest', 500, 1200),
      bag(1, 'hole'),
      bag(1, 'table', 100, 100),
      bag(1, 'table', 100, 120),
      bag(1, 'table', 100, 140),
    ])
    advance(s, STEP)
    expect(s.phase).toBe('score')
    expect(s.roundPts).toEqual([6, 3])
    expect(s.score).toEqual([3, 0])
  })

  it('an even round gains nothing for either side', () => {
    const s = roundWith([bag(0, 'hole'), bag(1, 'hole')])
    advance(s, STEP)
    expect(s.score).toEqual([0, 0])
    expect(s.roundPts).toEqual([3, 3])
  })

  it('the round summary holds, then the turn passes to the other starter', () => {
    const s = roundWith([bag(0, 'hole')], [0, 0])
    s.tosses = [BAGS_EACH, BAGS_EACH]
    advance(s, STEP)
    expect(s.phase).toBe('score')
    advance(s, SCORE_PAUSE)
    expect(s.phase).toBe('aim')
    expect(s.round).toBe(2)
    expect(s.starter).toBe(1)
    expect(s.turn).toBe(1)
    expect(s.bags).toEqual([])
  })

  it('first to 11 ends the match at the end of that round', () => {
    const s = roundWith([bag(0, 'hole'), bag(0, 'hole'), bag(0, 'hole'), bag(0, 'hole')], [9, 0])
    s.tosses = [BAGS_EACH, BAGS_EACH]
    advance(s, STEP)
    expect(s.score[0]).toBe(9 + 12)
    advance(s, SCORE_PAUSE)
    expect(s.phase).toBe('over')
    expect(winner(s)).toBe(0)
    expect(winner(newState(0))).toBeNull()
    expect(TO_WIN).toBe(11)
  })

  it('a chosen match length replaces the default: first to 3 ends at 3, not 11', () => {
    const s = newState(0, 3)
    s.bags = [bag(0, 'hole')]
    s.tosses = [BAGS_EACH, BAGS_EACH]
    s.phase = 'fly'
    advance(s, STEP)
    expect(s.score[0]).toBe(3)
    advance(s, SCORE_PAUSE)
    expect(s.phase).toBe('over')
    expect(winner(s)).toBe(0)
    expect(winner(newState(0, 3))).toBeNull()
    s.score = [2, 1]
    expect(winner(s)).toBeNull()
  })
})

describe('cornhole: sliding', () => {
  it('a sliding bag shoves a resting bag, which then slides too', () => {
    const s = roundWith([])
    s.phase = 'fly'
    s.bags = [
      { side: 0, x: 500, y: 1200, z: 0, vx: 0, vy: -300, vz: 0, st: 'slide', since: 0 },
      { side: 1, x: 500, y: 1200 - BAG_R * 1.5, z: 0, vx: 0, vy: 0, vz: 0, st: 'rest', since: 0 },
    ]
    advance(s, STEP)
    const pushed = s.bags[1] as Bag
    expect(pushed.st).toBe('slide')
    expect(pushed.vy).toBeLessThan(0)
  })

  it('a bag already in the hole is not knocked back out', () => {
    const s = roundWith([
      { side: 0, x: HOLE.x, y: HOLE.y, z: 0, vx: 0, vy: 0, vz: 0, st: 'hole', since: 0 },
      {
        side: 1,
        x: HOLE.x,
        y: HOLE.y + BAG_R * 1.5,
        z: 0,
        vx: 0,
        vy: -300,
        vz: 0,
        st: 'slide',
        since: 0,
      },
    ])
    settle(s)
    expect(s.bags[0]?.st).toBe('hole')
  })
})

describe('cornhole: computer players', () => {
  it('a hard bot drops most throws in the hole', () => {
    const rng = new Rng(3)
    let holes = 0
    const n = 20
    for (let i = 0; i < n; i++) {
      const s = newState(0)
      toss(s, choose(s, 0, 'hard', rng))
      settle(s)
      if (s.bags[0]?.st === 'hole') holes++
    }
    expect(holes).toBeGreaterThanOrEqual(Math.floor(n * 0.6))
  })

  it('the bot throws for either side', () => {
    const rng = new Rng(5)
    const s = newState(1)
    const shot = choose(s, 1, 'hard', rng)
    expect(shot.dy).toBeGreaterThan(0) // blue throws down the table
    const s0 = newState(0)
    expect(choose(s0, 0, 'hard', rng).dy).toBeLessThan(0)
  })

  it('bot vs bot reaches a result in bounded steps, either side can win', () => {
    const r = playOut('normal', 'normal', 7)
    expect(r.winner).not.toBeNull()
    expect(r.steps).toBeLessThan(60 * 60 * 6)
  })

  it('a hard bot beats an easy one most of the time', () => {
    let wins = 0
    for (let seed = 1; seed <= 5; seed++) if (playOut('hard', 'easy', seed).winner === 0) wins++
    expect(wins).toBeGreaterThanOrEqual(3)
  })
})
