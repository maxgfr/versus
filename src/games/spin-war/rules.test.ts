import { describe, expect, it } from 'vitest'
import { STEP, type Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import { decide, newMemory } from './bot.ts'
import {
  BOWL,
  DASH_CD,
  DASH_V1,
  matchWinner,
  rimAt,
  SHRINK,
  SHRINK_END,
  newWorld,
  ROUND_LIMIT,
  type Targets,
  step,
  startRound,
  TOP_R,
  type World,
} from './rules.ts'

const R = new Rng(42)
const NO_STEER = (w: World): Targets => w.tops.map(() => null)

/** Two bots play rounds until one side has won the match (or a step cap). */
function botMatch(
  a: Difficulty,
  b: Difficulty,
  seed: number,
  teams = false,
  target = 2,
): { w: World; steps: number } {
  const rng = new Rng(seed)
  const w = newWorld(teams, target, rng)
  const mem = [newMemory(), newMemory()]
  let steps = 0
  while (matchWinner(w) === null && steps < 60 * 900) {
    const t0 = decide(w, 0, a, rng, mem[0]!, STEP)
    const t1 = decide(w, 1, b, rng, mem[1]!, STEP)
    const targets: Targets = w.tops.map((top, i) => (top.side === 0 ? t0[i] : t1[i]) ?? null)
    step(w, STEP, targets, rng)
    steps++
  }
  return { w, steps }
}

describe('spin war rules', () => {
  it('one top a side in 1v1, two lanes a side in teams', () => {
    expect(newWorld(false, 2, R).tops).toHaveLength(2)
    const teams = newWorld(true, 2, R).tops
    expect(teams).toHaveLength(4)
    expect(teams.filter((t) => t.side === 0).map((t) => t.lane)).toEqual([0, 1])
  })

  it('steers a top toward the finger', () => {
    const w = newWorld(false, 2, R)
    const red = w.tops.find((t) => t.side === 0)!
    const x0 = red.x
    const y0 = red.y
    const targets = w.tops.map((t) => (t.side === 0 ? { x: W / 2, y: MID + 200 } : null))
    for (let i = 0; i < 60; i++) step(w, STEP, targets, R)
    expect(Math.hypot(red.x - W / 2, red.y - (MID + 200))).toBeLessThan(
      Math.hypot(x0 - W / 2, y0 - (MID + 200)),
    )
  })

  it('the bowl pulls a coasting top toward the centre', () => {
    const w = newWorld(false, 2, R)
    const top = w.tops[0]!
    top.x = BOWL.x + 300
    top.y = BOWL.y
    top.vx = 0
    top.vy = 0
    const d0 = Math.hypot(top.x - BOWL.x, top.y - BOWL.y)
    for (let i = 0; i < 60; i++) step(w, STEP, NO_STEER(w), R)
    expect(Math.hypot(top.x - BOWL.x, top.y - BOWL.y)).toBeLessThan(d0)
  })

  it('spin drains over time and a stopped top loses the round', () => {
    const w = newWorld(false, 2, R)
    const red = w.tops.find((t) => t.side === 0)!
    red.spin = 0.01
    const ev = step(w, 1, NO_STEER(w), R)
    expect(red.out).toBe(true)
    expect(ev.some((e) => e.kind === 'out' && e.reason === 'stopped')).toBe(true)
    expect(w.phase).toBe('over')
    expect(w.result).toBe(1)
    expect(w.wins).toEqual([0, 1])
  })

  it('a top that leaves the bowl loses the round', () => {
    const w = newWorld(false, 2, R)
    const blue = w.tops.find((t) => t.side === 1)!
    blue.x = BOWL.x + BOWL.r + TOP_R
    blue.y = BOWL.y
    blue.vx = 0
    blue.vy = 0
    step(w, STEP, NO_STEER(w), R)
    expect(blue.out).toBe(true)
    expect(w.result).toBe(0)
  })

  it('both tops out in the same step is a draw and scores nothing', () => {
    const w = newWorld(false, 2, R)
    for (const t of w.tops) t.spin = 0
    step(w, STEP, NO_STEER(w), R)
    expect(w.result).toBe('draw')
    expect(w.wins).toEqual([0, 0])
  })

  it('in teams a side loses only when both of its tops are out', () => {
    const w = newWorld(true, 2, R)
    const [r0, r1] = w.tops.filter((t) => t.side === 0)
    r0!.spin = 0
    step(w, STEP, NO_STEER(w), R)
    expect(w.phase).toBe('play')
    r1!.spin = 0
    step(w, STEP, NO_STEER(w), R)
    expect(w.result).toBe(1)
  })

  it('a match is won by reaching the target number of rounds', () => {
    const w = newWorld(false, 2, R)
    w.wins = [1, 0]
    expect(matchWinner(w)).toBeNull()
    w.wins = [2, 1]
    expect(matchWinner(w)).toBe(0)
    w.wins = [0, 2]
    expect(matchWinner(w)).toBe(1)
  })

  it('the next round starts once the banner has run', () => {
    const w = newWorld(false, 3, R)
    w.tops[0]!.spin = 0
    step(w, STEP, NO_STEER(w), R)
    expect(w.phase).toBe('over')
    for (let i = 0; i < 60 * 3; i++) step(w, STEP, NO_STEER(w), R)
    expect(w.phase).toBe('play')
    expect(w.tops.every((t) => !t.out)).toBe(true)
    expect(w.t).toBeLessThan(3)
  })

  it('at the round limit the side with more spin left wins', () => {
    const w = newWorld(false, 2, R)
    w.t = ROUND_LIMIT - STEP / 2
    // Both well inside the rim, which has closed in by now.
    w.tops.forEach((t, i) => {
      t.x = BOWL.x - 100 + i * 200
      t.y = BOWL.y
    })
    w.tops.find((t) => t.side === 0)!.spin = 0.5
    w.tops.find((t) => t.side === 1)!.spin = 0.9
    step(w, STEP, NO_STEER(w), R)
    expect(w.result).toBe(1)
  })

  it('a heavier (more spun-up) top knocks the lighter one back further', () => {
    const w = newWorld(false, 2, R)
    const [red, blue] = [w.tops.find((t) => t.side === 0)!, w.tops.find((t) => t.side === 1)!]
    red.x = 500
    red.y = 900
    red.vx = 0
    red.vy = 0
    red.spin = 1
    blue.x = 500
    blue.y = 900 - TOP_R * 1.5
    blue.vx = 0
    blue.vy = 600
    blue.spin = 0.1
    // Blue drives into a resting red: the heavier red barely moves, blue rebounds.
    step(w, STEP, NO_STEER(w), R)
    expect(Math.abs(blue.vy - 600)).toBeGreaterThan(Math.abs(red.vy))
    expect(blue.vy).toBeLessThan(0)
  })

  it('a clash sends both tops reeling: steering is ignored for a moment', () => {
    const w = newWorld(false, 2, R)
    const [red, blue] = [w.tops.find((t) => t.side === 0)!, w.tops.find((t) => t.side === 1)!]
    red.x = 500
    red.y = 900 + TOP_R
    red.vx = 0
    red.vy = -700
    blue.x = 500
    blue.y = 900 - TOP_R
    blue.vx = 0
    blue.vy = 700
    const events = step(w, STEP, NO_STEER(w), R)
    expect(events.some((e) => e.kind === 'hit')).toBe(true)
    expect(red.recoil).toBeGreaterThan(0)
    expect(blue.recoil).toBeGreaterThan(0)
    // Red asks to drive back up into blue, but keeps flying down while it reels.
    const toward = w.tops.map((t) => (t === red ? { x: 500, y: 0 } : null))
    step(w, STEP, toward, R)
    expect(red.vy).toBeGreaterThan(0)
  })

  it('the chosen match length sets the rounds needed', () => {
    expect(newWorld(false, 4, R).target).toBe(4)
  })

  it('startRound resets the tops', () => {
    const w = newWorld(false, 2, R)
    w.tops[0]!.out = true
    w.tops[0]!.spin = 0
    startRound(w, R)
    expect(w.tops[0]!.out).toBe(false)
    expect(w.tops[0]!.spin).toBeGreaterThanOrEqual(0.85)
    expect(w.tops[0]!.spin).toBeLessThanOrEqual(1)
  })
})

describe('spin war bots', () => {
  it('bot vs bot reaches a match winner in bounded steps', () => {
    const { w, steps } = botMatch('hard', 'normal', 3)
    expect(matchWinner(w)).not.toBeNull()
    expect(steps).toBeLessThan(60 * 900)
  })

  it('bot vs bot in teams reaches a winner', () => {
    const { w } = botMatch('normal', 'normal', 5, true)
    expect(matchWinner(w)).not.toBeNull()
  })

  it('the harder bot wins most matches, from either side', () => {
    let hard = 0
    for (let s = 1; s <= 8; s++) {
      const hs = s % 2 === 0 ? 0 : 1
      const { w } = botMatch(hs === 0 ? 'hard' : 'easy', hs === 0 ? 'easy' : 'hard', s, false, 3)
      if (matchWinner(w) === hs) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(6)
  })

  it('hard edges normal over seeded matches', () => {
    let hard = 0
    for (let s = 1; s <= 8; s++) {
      const hs = s % 2 === 0 ? 0 : 1
      const { w } = botMatch(
        hs === 0 ? 'hard' : 'normal',
        hs === 0 ? 'normal' : 'hard',
        50 + s,
        false,
        3,
      )
      if (matchWinner(w) === hs) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(4)
  })

  it('the bot steers its top (blue as well as red)', () => {
    const w = newWorld(false, 2, R)
    const rng = new Rng(9)
    const blueTargets = decide(w, 1, 'normal', rng, newMemory(), STEP)
    const i = w.tops.findIndex((t) => t.side === 1)
    expect(blueTargets[i]).not.toBeNull()
  })

  it('a flick dashes the top toward the stick, then it must wait to dash again', () => {
    const w = newWorld(false, 2, R)
    const red = w.tops.find((t) => t.side === 0)!
    red.x = BOWL.x
    red.y = BOWL.y + 200
    const i = w.tops.indexOf(red)
    const go = (dash: number): Targets =>
      w.tops.map((_, k) => (k === i ? { x: BOWL.x, y: BOWL.y, dash } : null))
    const ev = step(w, STEP, go(1), R)
    expect(ev.some((e) => e.kind === 'dash')).toBe(true)
    expect(red.vy).toBeLessThan(-DASH_V1 * 0.8)
    expect(step(w, STEP, go(1), R).some((e) => e.kind === 'dash')).toBe(false)
    for (let k = 0; k < 60 * DASH_CD + 2; k++) {
      // Hold it still in the middle while the cooldown runs out.
      red.x = BOWL.x
      red.y = BOWL.y + 200
      red.vx = red.vy = 0
      step(w, STEP, NO_STEER(w), R)
    }
    expect(step(w, STEP, go(0.2), R).some((e) => e.kind === 'dash')).toBe(true)
  })

  it('a soft flick dashes slower than a hard one', () => {
    const a = newWorld(false, 2, new Rng(1))
    const b = newWorld(false, 2, new Rng(1))
    const at = (w: World, dash: number): Targets =>
      w.tops.map((t) => (t.side === 0 ? { x: BOWL.x, y: BOWL.y, dash } : null))
    step(a, STEP, at(a, 0.1), R)
    step(b, STEP, at(b, 1), R)
    const va = Math.hypot(a.tops[0]!.vx, a.tops[0]!.vy)
    const vb = Math.hypot(b.tops[0]!.vx, b.tops[0]!.vy)
    expect(vb).toBeGreaterThan(va + 400)
  })

  it('the rim closes in as the round drags on, and a top left outside it is out', () => {
    expect(rimAt(0)).toBe(BOWL.r)
    expect(rimAt(SHRINK_END + 1)).toBeCloseTo(BOWL.r * SHRINK, 5)
    const w = newWorld(false, 2, R)
    const blue = w.tops.find((t) => t.side === 1)!
    const red = w.tops.find((t) => t.side === 0)!
    red.x = BOWL.x
    red.y = BOWL.y + 50
    blue.x = BOWL.x
    blue.y = BOWL.y - BOWL.r * 0.9
    w.t = SHRINK_END
    step(w, STEP, NO_STEER(w), R)
    expect(blue.out).toBe(true)
    expect(w.result).toBe(0)
  })
})
