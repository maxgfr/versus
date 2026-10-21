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
