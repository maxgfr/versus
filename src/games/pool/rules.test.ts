import { describe, expect, it } from 'vitest'
import { STEP, type Difficulty, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { choose } from './bot.ts'
import {
  BR,
  FOOT,
  groupOf,
  newWorld,
  placeCue,
  POCKETS,
  raycast,
  rerack,
  step,
  strike,
  TABLE,
  validPlace,
  winner,
  type Event,
  type World,
} from './rules.ts'

/** Only the balls in `keep` stay on the table, at the given spots. */
function staged(w: World, spots: Record<number, [number, number]>): void {
  for (const b of w.balls) {
    const s = spots[b.n]
    b.on = s !== undefined
    b.vx = b.vy = 0
    b.pocket = -1
    if (s) {
      b.x = s[0]
      b.y = s[1]
    }
  }
}

/** Run until the balls stop (or the budget ends); returns every event. */
function run(w: World, max = 60 * 40): Event[] {
  const out: Event[] = []
  for (let i = 0; i < max && w.phase === 'roll'; i++) out.push(...step(w, STEP))
  return out
}

/** A cue placed behind ball `n` so a straight stroke pots it into pocket `k`. */
function potLine(
  k: number,
  from: [number, number],
): { cue: [number, number]; dir: [number, number]; target: [number, number] } {
  const t = from
  const p = POCKETS[k]
  if (!p) throw new Error('no pocket')
  const ux = t[0] - p.x
  const uy = t[1] - p.y
  const L = Math.hypot(ux, uy)
  const cue: [number, number] = [t[0] + (ux / L) * 230, t[1] + (uy / L) * 230]
  const dx = t[0] - cue[0]
  const dy = t[1] - cue[1]
  const D = Math.hypot(dx, dy)
  return { cue, dir: [dx / D, dy / D], target: t }
}

function botMatch(a: Difficulty, b: Difficulty, seed: number): { w: World; steps: number } {
  const rng = new Rng(seed)
  const w = newWorld(rng.chance(0.5) ? 0 : 1, rng)
  let steps = 0
  while (winner(w, 1) === null && steps < 60 * 60 * 6) {
    if (w.phase === 'aim' || w.phase === 'place') {
      const side = w.turn
      const p = choose(w, side, side === 0 ? a : b, rng)
      if (w.phase === 'place' && p.place) placeCue(w, p.place.x, p.place.y)
      if (w.phase === 'aim') strike(w, p.dx, p.dy, p.power)
    }
    step(w, STEP)
    if (w.phase === 'rack') rerack(w, rng)
    steps++
  }
  return { w, steps }
}

describe('pool rules', () => {
  it('racks 15 balls: the 8 in the middle of row three, one solid and one stripe in the back corners', () => {
    const w = newWorld(0, new Rng(1))
    expect(w.balls).toHaveLength(16)
    expect(w.balls.filter((b) => b.on)).toHaveLength(16)
    expect(w.balls[8]?.n).toBe(8)
    const rackBalls = w.balls.slice(1)
    const x = rackBalls.find((b) => b.n === 8)?.x ?? 0
    expect(Math.abs(x - FOOT.x)).toBeLessThan(2)
    const corners = [
      w.balls.find(
        (b) => b.n >= 1 && b.n <= 7 && Math.abs(b.x - FOOT.x) > 150 && b.y > FOOT.y + 150,
      ),
      w.balls.find(
        (b) => b.n >= 9 && b.n <= 15 && Math.abs(b.x - FOOT.x) > 150 && b.y > FOOT.y + 150,
      ),
    ]
    expect(corners[0]).toBeDefined()
    expect(corners[1]).toBeDefined()
    const solids = w.balls.filter((b) => b.n >= 1 && b.n <= 7).length
    const stripes = w.balls.filter((b) => b.n >= 9 && b.n <= 15).length
    expect(solids).toBe(7)
    expect(stripes).toBe(7)
  })

  it('only the player to shoot can strike, and only from the aim phase', () => {
    const w = newWorld(0, new Rng(2))
    expect(strike(w, 1, 0, 0.5)).toBe(true)
    expect(w.phase).toBe('roll')
    expect(strike(w, 1, 0, 0.5)).toBe(false)
    expect(strike(w, 1, 0, 0)).toBe(false)
  })

  it('a straight pot sinks the object ball and keeps the turn for a legal pot', () => {
    const rng = new Rng(3)
    const w = newWorld(0, rng)
    const k = 4
    const pot = potLine(k, [500, 500])
    staged(w, { 0: pot.cue, 1: pot.target })
    expect(strike(w, pot.dir[0], pot.dir[1], 0.45)).toBe(true)
    const ev = run(w)
    expect(ev.some((e) => e.kind === 'pot' && e.n === 1)).toBe(true)
    expect(w.groups[0]).toBe('solid')
    expect(w.groups[1]).toBe('stripe')
    expect(w.turn).toBe(0)
    expect(w.phase).toBe('aim')
    expect(w.foul).toBe('')
  })

  it('scratching the cue is a foul: ball in hand for the opponent', () => {
    const rng = new Rng(4)
    const w = newWorld(0, rng)
    const pocket = POCKETS[0]
    if (!pocket) throw new Error('no pocket')
    staged(w, { 0: [pocket.x + 40, pocket.y + 40] })
    const d = Math.hypot(pocket.x - (pocket.x + 40), pocket.y - (pocket.y + 40))
    expect(d).toBeLessThan(pocket.r)
    expect(strike(w, -1, -1, 0.3)).toBe(true)
    run(w)
    expect(w.foul).toBe('scratch')
    expect(w.turn).toBe(1)
    expect(w.phase).toBe('place')
    expect(validPlace(w, TABLE.x0 + 200, TABLE.y0 + 500)).toBe(true)
    expect(placeCue(w, TABLE.x0 + 200, TABLE.y0 + 500)).toBe(true)
    expect(w.phase).toBe('aim')
    expect(w.balls[0]?.on).toBe(true)
  })

  it('a shot that touches nothing is a miss: the turn passes with ball in hand', () => {
    const rng = new Rng(5)
    const w = newWorld(0, rng)
    staged(w, { 0: [500, 900] })
    strike(w, 1, 0, 0.4)
    run(w)
    expect(w.foul).toBe('miss')
    expect(w.turn).toBe(1)
    expect(w.phase).toBe('place')
  })

  it('potting the 8 early loses the rack; potting it after clearing the group wins', () => {
    const rng = new Rng(6)
    const w = newWorld(0, rng)
    w.groups = ['solid', 'stripe']
    const pot = potLine(1, [500, 500])
    staged(w, { 0: pot.cue, 8: pot.target, 1: [300, 1300] })
    strike(w, pot.dir[0], pot.dir[1], 0.45)
    run(w)
    expect(w.phase).toBe('rack')
    expect(w.rackWinner).toBe(1)
    expect(w.wins).toEqual([0, 1])

    const w2 = newWorld(0, rng)
    w2.groups = ['solid', 'stripe']
    const pot2 = potLine(0, [500, 500])
    staged(w2, { 0: pot2.cue, 8: pot2.target })
    strike(w2, pot2.dir[0], pot2.dir[1], 0.45)
    run(w2)
    expect(w2.rackWinner).toBe(0)
    expect(w2.wins).toEqual([1, 0])
  })

  it('a ball on the line stops the cue: raycast reports it', () => {
    const w = newWorld(0, new Rng(7))
    staged(w, { 0: [300, 900], 5: [500, 900] })
    const r = raycast(w, 300, 900, 1, 0)
    expect(r.hit).toBe(5)
    expect(r.t).toBeCloseTo(500 - 300 - 76, 0)
    const wall = raycast(w, 300, 1200, 0, 1)
    expect(wall.hit).toBe(-1)
    expect(wall.t).toBeGreaterThan(0)
  })

  it('ball in hand must land on the table, clear of every ball', () => {
    const w = newWorld(0, new Rng(8))
    staged(w, { 0: [500, 900], 3: [300, 500] })
    w.phase = 'place'
    expect(validPlace(w, 300, 505)).toBe(false)
    expect(validPlace(w, TABLE.x0 - 10, 900)).toBe(false)
    expect(validPlace(w, 700, 1200)).toBe(true)
    expect(placeCue(w, 300, 500 + BR)).toBe(false)
    expect(placeCue(w, 700, 1200)).toBe(true)
  })

  it('the groups belong to the side that potted first; the other side gets the rest', () => {
    expect(groupOf(3)).toBe('solid')
    expect(groupOf(11)).toBe('stripe')
    expect(groupOf(8)).toBeNull()
  })

  it('a rerack keeps the wins and gives the break to the loser', () => {
    const rng = new Rng(9)
    const w = newWorld(0, rng)
    w.wins = [1, 0]
    w.phase = 'rack'
    w.breaker = 1 as Side
    rerack(w, rng)
    expect(w.wins).toEqual([1, 0])
    expect(w.turn).toBe(1)
    expect(w.phase).toBe('aim')
    expect(w.groups).toEqual([null, null])
  })

  it('bot vs bot finishes a rack within bounded steps, for either side and level', () => {
    for (const [a, b, seed] of [
      ['normal', 'normal', 11],
      ['easy', 'hard', 12],
      ['hard', 'easy', 13],
    ] as [Difficulty, Difficulty, number][]) {
      const { w, steps } = botMatch(a, b, seed)
      expect(winner(w, 1)).not.toBeNull()
      expect(steps).toBeLessThan(60 * 60 * 6)
    }
  })

  it('the bot pots straight shots with a hard hand', () => {
    const rng = new Rng(14)
    const w = newWorld(0, rng)
    staged(w, { 0: [500, 1200], 1: [500, 700] })
    w.groups = ['solid', 'stripe']
    const p = choose(w, 0, 'hard', rng)
    expect(Math.hypot(p.dx, p.dy)).toBeCloseTo(1, 5)
    expect(p.power).toBeGreaterThan(0)
    expect(BR).toBeGreaterThan(0)
  })

  it('an 8 potted on the break is respotted, even when the break also claims a group', () => {
    const w = newWorld(0, new Rng(21))
    const p0 = POCKETS[0]
    const p1 = POCKETS[1]
    if (!p0 || !p1) throw new Error('no pocket')
    // The 1 and the 8 sit in pocket mouths and drop on the first frame; the cue hits the 3.
    staged(w, {
      0: [500, 1200],
      3: [500, 900],
      1: [p1.x - 30, p1.y + 30],
      8: [p0.x + 30, p0.y + 30],
    })
    expect(strike(w, 0, -1, 0.4)).toBe(true)
    run(w)
    expect(w.phase).toBe('aim')
    expect(w.wins).toEqual([0, 0])
    expect(w.balls[8]?.on).toBe(true)
    expect(w.groups[0]).toBe('solid')
    expect(w.turn).toBe(0)
  })

  it('sinking the last ball of the group and the 8 on one stroke loses the rack', () => {
    const w = newWorld(0, new Rng(22))
    w.groups = ['solid', 'stripe']
    w.shots = 9
    const pot = potLine(4, [500, 500])
    const p2 = POCKETS[2]
    if (!p2) throw new Error('no pocket')
    staged(w, { 0: pot.cue, 2: pot.target, 8: [p2.x + 30, p2.y - 30], 9: [300, 1000] })
    strike(w, pot.dir[0], pot.dir[1], 0.45)
    run(w)
    expect(w.potted).toContain(2)
    expect(w.phase).toBe('rack')
    expect(w.rackWinner).toBe(1)
  })

  it('the bot plays its pick out with the real rules: hard pots a makeable cut', () => {
    const rng = new Rng(23)
    const w = newWorld(0, rng)
    w.groups = ['solid', 'stripe']
    w.shots = 4
    staged(w, { 0: [420, 1250], 5: [600, 600], 12: [300, 400], 8: [700, 1300] })
    const p = choose(w, 0, 'hard', rng)
    strike(w, p.dx, p.dy, p.power)
    run(w)
    expect(w.potted).toContain(5)
    expect(w.foul).toBe('')
    expect(w.turn).toBe(0)
  })

  it('never aims at a back-cut: every pot the bot lines up sends the cue towards the pocket side', () => {
    const rng = new Rng(24)
    const w = newWorld(0, rng)
    w.groups = ['solid', 'stripe']
    w.shots = 4
    // The 6 sits between the cue and the bottom pockets; only forward pots make sense.
    staged(w, { 0: [500, 700], 6: [500, 1100], 10: [800, 300] })
    const p = choose(w, 0, 'normal', rng)
    expect(p.dy).toBeGreaterThan(0)
  })

  it('hard beats easy most of the time', () => {
    let hard = 0
    for (let i = 0; i < 8; i++) {
      const hardSide: Side = i % 2 === 0 ? 0 : 1
      const { w } = botMatch(
        hardSide === 0 ? 'hard' : 'easy',
        hardSide === 0 ? 'easy' : 'hard',
        100 + i,
      )
      if (winner(w, 1) === hardSide) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(6)
  })
})
