import { describe, expect, it } from 'vitest'
import { STEP, type Difficulty, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { blast, blockAt, simulate, solveShot, trace } from '../../engines/aim/index.ts'
import { choose } from './bot.ts'
import {
  advance,
  BALL,
  cannonOf,
  coreHp,
  coreOf,
  CORE_HP,
  fire,
  fort,
  newState,
  nextRound,
  winner,
  WIND_MAX,
} from './rules.ts'

describe('aim engine', () => {
  it('a block stops a low shell but not a high one', () => {
    const blocks = fort(0)
    const wall = blocks.find((b) => b.kind === 'wall')
    if (!wall) throw new Error('no wall')
    expect(blockAt(blocks, wall.x, wall.y, 50)).toBeGreaterThanOrEqual(0)
    expect(blockAt(blocks, wall.x, wall.y, 500)).toBe(-1)
  })

  it('blast damages nearby blocks and doubles a direct hit', () => {
    const blocks = fort(0)
    const core = blocks.findIndex((b) => b.kind === 'core')
    const c = blocks[core]
    if (!c) throw new Error('no core')
    const r = blast(blocks, c.x, c.y, 80, 1, core, 2)
    expect(r.hit).toContain(core)
    expect(c.hp).toBe(CORE_HP - 2)
    const wall = blocks.findIndex((b) => b.kind === 'wall' && b.hp > 0)
    const w = blocks[wall]
    if (!w) throw new Error('no wall')
    const hp = c.hp
    blast(blocks, w.x, w.y, 300, 1, wall, 2, (b) => b.kind !== 'core')
    expect(c.hp).toBe(hp)
  })

  it('wind bends the flight', () => {
    const shot = { dx: 0, dy: -1, power: 0.7 }
    const calm = simulate(500, 1600, shot, BALL, 0, [])
    const windy = simulate(500, 1600, shot, BALL, 200, [])
    expect(windy.x).toBeGreaterThan(calm.x + 50)
    expect(trace(500, 1600, shot, BALL, 0).length).toBeGreaterThan(5)
  })

  it('the solver lands near an open target', () => {
    const from = { x: 200, y: 1600 }
    const target = { x: 700, y: 500 }
    const shot = solveShot((s) => simulate(from.x, from.y, s, BALL, 0, []), from, target)
    const im = simulate(from.x, from.y, shot, BALL, 0, [])
    expect(Math.hypot(im.x - target.x, im.y - target.y)).toBeLessThan(30)
  })
})

function duel(a: Difficulty, b: Difficulty, seed: number): { winner: Side | null; turns: number } {
  const rng = new Rng(seed)
  const wind = () => rng.range(-WIND_MAX, WIND_MAX)
  const s = newState(0, wind())
  let turns = 0
  let steps = 0
  while (winner(s) === null && steps < 60 * 60 * 20) {
    if (s.phase === 'aim') {
      fire(s, choose(s, s.turn, s.turn === 0 ? a : b, rng))
      turns++
    }
    advance(s, STEP, wind)
    steps++
  }
  return { winner: winner(s), turns }
}

describe('cannon duel', () => {
  it('forts are mirror images', () => {
    expect(cannonOf(1)).toEqual({ x: 1000 - cannonOf(0).x, y: 1800 - cannonOf(0).y })
    expect(coreOf(1).y).toBeLessThan(900)
    expect(coreHp(newState(0, 0), 1)).toBe(CORE_HP)
  })

  it('bot vs bot destroys a core', () => {
    const r = duel('normal', 'normal', 4)
    expect(r.winner).not.toBeNull()
    expect(r.turns).toBeLessThan(80)
  })

  it('a hard bot beats an easy one most of the time', () => {
    let wins = 0
    for (let s = 1; s <= 5; s++) if (duel('hard', 'easy', s).winner === 0) wins++
    expect(wins).toBeGreaterThanOrEqual(3)
  })
})

/** Shots one side needs to raze the other's keep when it shoots every turn. */
function shotsToKill(d: Difficulty, seed: number): number {
  const rng = new Rng(seed)
  const wind = () => rng.range(-WIND_MAX, WIND_MAX)
  const s = newState(0, wind())
  let n = 0
  while (winner(s) === null && n < 200) {
    s.turn = 0
    fire(s, choose(s, 0, d, rng))
    n++
    while (s.phase !== 'aim' && winner(s) === null) advance(s, STEP, wind)
  }
  return n
}

describe('cannon duel: edge cases', () => {
  it('each difficulty is clearly sharper than the one below', () => {
    const avg = (d: Difficulty) => {
      let t = 0
      for (let seed = 1; seed <= 12; seed++) t += shotsToKill(d, seed)
      return t / 12
    }
    const [easy, normal, hard] = [avg('easy'), avg('normal'), avg('hard')]
    expect(hard).toBeLessThan(normal)
    expect(normal).toBeLessThan(easy)
    // Easy still gets there: a beginner is not facing a wall.
    expect(easy).toBeLessThan(30)
  })

  it('razing your own keep hands the round to your rival', () => {
    const s = newState(0, 0)
    const core = s.blocks.findIndex((b) => b.kind === 'core' && b.side === 0)
    const k = s.blocks[core]
    if (!k) throw new Error('no core')
    k.hp = 1
    s.shell = { x: k.x, y: k.y, z: 40, vx: 0, vy: 0, vz: -200, t: 0, side: 0 }
    s.phase = 'fly'
    const ev = advance(s, STEP, () => 0)
    expect(ev[0]?.kind).toBe('boom')
    expect(winner(s)).toBe(1)
  })

  it('ground hits leave a capped trail of craters, block hits do not', () => {
    const s = newState(0, 0)
    for (let i = 0; i < 14; i++) {
      s.shell = { x: 500, y: 900, z: 5, vx: 0, vy: 0, vz: -600, t: 0, side: 0 }
      s.phase = 'fly'
      const ev = advance(s, STEP, () => 0)
      const e = ev[0]
      expect(e?.kind === 'boom' && e.speed > 500).toBe(true)
    }
    expect(s.craters.length).toBe(10)
    expect(s.hitAt.length).toBe(s.blocks.length)
  })

  it('a new round brings fresh forts and clears the scars', () => {
    const s = newState(0, 0)
    s.craters.push({ x: 1, y: 2, r: 30 })
    s.hitAt[0] = 3
    s.wins[1] = 1
    nextRound(s, 1, 0)
    expect(s.craters).toEqual([])
    expect(s.hitAt.every((t) => t === -1)).toBe(true)
    expect(s.wins).toEqual([0, 1])
    expect(s.turn).toBe(1)
  })
})
