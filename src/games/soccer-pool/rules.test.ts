import { describe, expect, it } from 'vitest'
import { STEP, type Difficulty, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { W } from '../../core/stage.ts'
import { choose, plan } from './bot.ts'
import {
  BALL_R,
  DISC_R,
  GOAL_PAUSE,
  RINK,
  SHOT_CLOCK,
  formation,
  newWorld,
  ownDiscs,
  reset,
  shoot,
  shotClock,
  step,
  winner,
  type World,
} from './rules.ts'

/** Play a whole match computer vs computer; returns the final world and steps used. */
function botMatch(
  a: Difficulty,
  b: Difficulty,
  seed: number,
  target = 3,
): { w: World; steps: number } {
  const rng = new Rng(seed)
  const w = newWorld(rng.chance(0.5) ? 0 : 1)
  let steps = 0
  while (winner(w, target) === null && steps < 60 * 60 * 15) {
    if (w.phase === 'aim') {
      const side = w.turn
      const p = choose(w, side, side === 0 ? a : b, rng)
      shoot(w, p.disc, p.dx, p.dy, p.power)
    }
    step(w, STEP)
    steps++
  }
  return { w, steps }
}

/** Put the ball in front of the top goal, flying straight at it. */
function ballAtTopGoal(w: World): void {
  w.ball.x = W / 2
  w.ball.y = RINK.y0 + 200
  w.ball.vx = 0
  w.ball.vy = -1400
}

describe('soccer pool rules', () => {
  it('starts with five discs a side, all on their own half', () => {
    const w = newWorld(0)
    expect(w.discs).toHaveLength(10)
    expect(ownDiscs(w, 0)).toHaveLength(5)
    expect(ownDiscs(w, 1)).toHaveLength(5)
    for (const d of w.discs) {
      if (d.side === 0) expect(d.y).toBeGreaterThan(900)
      else expect(d.y).toBeLessThan(900)
    }
    // Formation spots never overlap.
    for (let i = 0; i < w.discs.length; i++) {
      for (let j = i + 1; j < w.discs.length; j++) {
        const a = w.discs[i]
        const b = w.discs[j]
        if (!a || !b) continue
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(DISC_R * 2)
      }
    }
    expect(formation()).toHaveLength(10)
  })

  it('only the side to play may flick, and only one of its own discs', () => {
    const w = newWorld(0)
    const blue = ownDiscs(w, 1)[0] ?? 5
    expect(shoot(w, blue, 0, 1, 1)).toEqual([])
    expect(w.phase).toBe('aim')
    const red = ownDiscs(w, 0)[0] ?? 0
    expect(shoot(w, red, 0, -1, 0)).toEqual([])
    expect(shoot(w, red, 0, -1, 1)).toHaveLength(1)
    expect(w.phase).toBe('roll')
  })

  it('a turn ends when everything stops, and passes to the other side', () => {
    const w = newWorld(0)
    const red = ownDiscs(w, 0)[0] ?? 0
    shoot(w, red, 0, -1, 0.3)
    let turns = 0
    for (let i = 0; i < 60 * 30 && w.phase !== 'aim'; i++) {
      for (const e of step(w, STEP)) if (e.kind === 'turn') turns++
    }
    expect(w.phase).toBe('aim')
    expect(turns).toBe(1)
    expect(w.turn).toBe(1)
    for (const d of w.discs) expect(Math.hypot(d.vx, d.vy)).toBe(0)
  })

  it('a ball driven into the top goal scores for red and the conceding side kicks off', () => {
    const w = newWorld(0)
    // Move every disc out of the way.
    for (const d of w.discs) {
      d.x = 60
      d.y = 1700
    }
    ballAtTopGoal(w)
    w.phase = 'roll'
    let goal: Side | null = null
    for (let i = 0; i < 60 && goal === null; i++) {
      for (const e of step(w, STEP)) if (e.kind === 'goal') goal = e.side
    }
    expect(goal).toBe(0)
    expect(w.score).toEqual([1, 0])
    expect(w.phase).toBe('goal')
    expect(w.turn).toBe(1)
    for (let i = 0; i < GOAL_PAUSE * 60 + 2; i++) step(w, STEP)
    expect(w.phase).toBe('aim')
    expect(w.ball.x).toBe(W / 2)
    expect(ownDiscs(w, 1)).toHaveLength(5)
  })

  it('blue scores in the bottom goal', () => {
    const w = newWorld(1)
    for (const d of w.discs) {
      d.x = 60
      d.y = 100
    }
    w.ball.x = W / 2
    w.ball.y = RINK.y1 - 200
    w.ball.vx = 0
    w.ball.vy = 1400
    w.phase = 'roll'
    let goal: Side | null = null
    for (let i = 0; i < 60 && goal === null; i++) {
      for (const e of step(w, STEP)) if (e.kind === 'goal') goal = e.side
    }
    expect(goal).toBe(1)
    expect(w.score).toEqual([0, 1])
  })

  it('discs bounce off the goal line and cannot enter the goal', () => {
    const w = newWorld(0)
    for (const d of w.discs) {
      d.x = 60
      d.y = 1700
    }
    const d = w.discs[0]
    if (!d) throw new Error('no disc')
    d.x = W / 2
    d.y = RINK.y0 + DISC_R + 5
    d.vx = 0
    d.vy = -2000
    w.phase = 'roll'
    for (let i = 0; i < 120; i++) step(w, STEP)
    expect(d.y).toBeGreaterThanOrEqual(RINK.y0 + DISC_R - 1)
    expect(w.score).toEqual([0, 0])
  })

  it('a stuck roll is cut short by the safety valve', () => {
    const w = newWorld(0)
    const red = ownDiscs(w, 0)[0] ?? 0
    shoot(w, red, 0, -1, 1)
    // Pretend the discs never settle: keep the ball spinning on the spot.
    for (let i = 0; i < 60 * 12 && w.phase !== 'aim'; i++) {
      w.ball.vx = 900
      step(w, STEP)
    }
    expect(w.phase).toBe('aim')
  })

  it('reset restores the formation and keeps the score', () => {
    const w = newWorld(0)
    w.score = [2, 1]
    w.discs[0] = { ...(w.discs[0] as NonNullable<(typeof w.discs)[0]>), x: 100, y: 100 }
    reset(w)
    expect(w.score).toEqual([2, 1])
    expect(w.discs[0]?.x).not.toBe(100)
  })

  it('the bot flicks one of its own discs whichever side it plays', () => {
    const w = newWorld(0)
    const rng = new Rng(4)
    for (const side of [0, 1] as Side[]) {
      w.turn = side
      const pick = choose(w, side, 'hard', rng)
      expect(w.discs[pick.disc]?.side).toBe(side)
      expect(Math.hypot(pick.dx, pick.dy)).toBeCloseTo(1, 5)
      expect(pick.power).toBeGreaterThan(0)
      expect(pick.power).toBeLessThanOrEqual(1)
    }
    expect(BALL_R).toBeGreaterThan(0)
  })

  it('bot vs bot reaches the goal target within bounded steps', () => {
    const { w, steps } = botMatch('hard', 'normal', 7)
    expect(winner(w, 3)).not.toBeNull()
    expect(Math.max(...w.score)).toBe(3)
    expect(steps).toBeLessThan(60 * 60 * 15)
  })

  it('a shot not taken in time passes the turn (no stalled match)', () => {
    const w = newWorld(0, 3)
    let ev: ReturnType<typeof step> = []
    for (let i = 0; i < 60 * (SHOT_CLOCK + 0.5) && w.turn === 0; i++) ev = ev.concat(step(w, STEP))
    expect(w.turn).toBe(1)
    expect(w.phase).toBe('aim')
    expect(ev.some((e) => e.kind === 'timeout' && e.side === 0)).toBe(true)
    // ...and the clock starts again for the new shooter.
    expect(w.t).toBeLessThan(0.1)
  })

  it('the shot clock tightens once someone is one goal away', () => {
    const w = newWorld(0, 3)
    expect(shotClock(w)).toBe(SHOT_CLOCK)
    w.score = [0, 2]
    expect(shotClock(w)).toBeLessThan(SHOT_CLOCK)
  })

  it('the bot never takes an own goal when a safe shot exists', () => {
    // Ball sitting right in front of red's own goal, a red disc behind it on the
    // goal side: driving straight through the ball would put it in red's net.
    for (const d of ['normal', 'hard'] as Difficulty[]) {
      const w = newWorld(0, 3)
      w.ball.x = W / 2
      w.ball.y = RINK.y1 - 160
      const i = ownDiscs(w, 0)[0] ?? 0
      const disc = w.discs[i]
      if (!disc) throw new Error('no disc')
      disc.x = W / 2
      disc.y = RINK.y1 - 420
      const pick = choose(w, 0, d, new Rng(3))
      shoot(w, pick.disc, pick.dx, pick.dy, pick.power)
      let own = false
      for (let k = 0; k < 60 * 6 && w.phase === 'roll'; k++)
        own ||= step(w, STEP).some((e) => e.kind === 'goal' && e.side === 1)
      expect(own).toBe(false)
    }
  })

  it('the search can be spread over many steps and gives the same shot', () => {
    const w = newWorld(1, 3)
    const a = choose(w, 1, 'normal', new Rng(9))
    const it = plan(w, 1, 'normal', new Rng(9))
    let n = 0
    let r = it.next()
    while (!r.done) {
      n++
      r = it.next()
    }
    expect(n).toBeGreaterThan(10)
    expect(r.value).toEqual(a)
  })

  it('the harder bot usually wins', () => {
    let hard = 0
    for (let s = 1; s <= 4; s++) if (winner(botMatch('hard', 'easy', s, 2).w, 2) === 0) hard++
    expect(hard).toBeGreaterThanOrEqual(3)
  })

  it('a two-goal match ends at two, not the default', () => {
    const { w } = botMatch('normal', 'easy', 11, 2)
    expect(winner(w, 2)).not.toBeNull()
    expect(Math.max(...w.score)).toBe(2)
  })
})
