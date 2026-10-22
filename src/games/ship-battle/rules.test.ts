import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { ShipBot } from './bot.ts'
import {
  BALL_LIFE,
  type Drive,
  type Ev,
  HP,
  LAYOUTS,
  layoutIsles,
  newWorld,
  onIsle,
  RELOAD,
  roundWinner,
  MAX_SPEED,
  SALVO,
  SEA,
  settle,
  SHIP_R,
  SQUALL_RELOAD,
  SQUALL_T,
  stepWorld,
  type World,
} from './rules.ts'

const idle = (w: World): (Drive | undefined)[] => w.ships.map(() => undefined)

/** Put both ships in clear water, facing each other across open sea. */
function duel(layout = 0): World {
  const w = newWorld(layout)
  w.isles = []
  const [red, blue] = w.ships
  if (!red || !blue) throw new Error('two ships expected')
  red.x = 500
  red.y = 1100
  red.a = -Math.PI / 2
  blue.x = 500
  blue.y = 700
  blue.a = Math.PI / 2
  return w
}

describe('ship layouts', () => {
  it('are point-symmetric and keep the docks clear', () => {
    for (let i = 0; i < LAYOUTS; i++) {
      const isles = layoutIsles(i)
      expect(isles.length % 2).toBe(0)
      for (const isle of isles) {
        expect(isle.y - isle.r).toBeGreaterThanOrEqual(SEA.top - 60)
        expect(isle.y + isle.r).toBeLessThanOrEqual(SEA.bottom + 60)
      }
      const w = newWorld(i)
      const [red, blue] = w.ships
      expect(red?.x).toBeCloseTo(1000 - (blue?.x ?? 0))
      expect(red?.y).toBeCloseTo(1800 - (blue?.y ?? 0))
      for (const s of w.ships) expect(onIsle(w.isles, s.x, s.y, SHIP_R)).toBe(false)
    }
  })
})

describe('ship physics', () => {
  it('sails forward when the stick points where the bow is', () => {
    const w = duel()
    const red = w.ships[0] as NonNullable<World['ships'][number]>
    const y0 = red.y
    for (let i = 0; i < 120; i++)
      stepWorld(w, [{ jx: 0, jy: -1, fire: false }, undefined], STEP, [])
    expect(red.y).toBeLessThan(y0 - 100)
    expect(red.v).toBeGreaterThan(120)
  })

  it('turns toward the stick at a limited rate and crawls while coming about', () => {
    const w = duel()
    const red = w.ships[0] as NonNullable<World['ships'][number]>
    const a0 = red.a
    stepWorld(w, [{ jx: 1, jy: 0, fire: false }, undefined], STEP, [])
    expect(Math.abs(red.a - a0)).toBeLessThanOrEqual(1.5 * STEP + 1e-9)
    // Stick pointing straight back: the ship turns, barely moving.
    const w2 = duel()
    const r2 = w2.ships[0] as NonNullable<World['ships'][number]>
    for (let i = 0; i < 30; i++) stepWorld(w2, [{ jx: 0, jy: 1, fire: false }, undefined], STEP, [])
    expect(r2.v).toBeLessThan(60)
  })

  it('cannot sail through an island', () => {
    const w = duel()
    w.isles = [{ x: 500, y: 900, r: 80 }]
    const red = w.ships[0] as NonNullable<World['ships'][number]>
    for (let i = 0; i < 400; i++)
      stepWorld(w, [{ jx: 0, jy: -1, fire: false }, undefined], STEP, [])
    expect(onIsle(w.isles, red.x, red.y, SHIP_R - 1)).toBe(false)
  })

  it('stays inside the sea', () => {
    const w = duel()
    const red = w.ships[0] as NonNullable<World['ships'][number]>
    for (let i = 0; i < 900; i++) stepWorld(w, [{ jx: 1, jy: 0, fire: false }, undefined], STEP, [])
    expect(red.x).toBeLessThanOrEqual(SEA.right - SHIP_R + 1e-6)
    expect(red.y).toBeGreaterThanOrEqual(SEA.top + SHIP_R - 1e-6)
  })

  it('fires a salvo out the side the rival is on, then reloads', () => {
    const w = duel()
    const ev: Ev[] = []
    const red = w.ships[0] as NonNullable<World['ships'][number]>
    red.cd = 0
    // Red faces north: starboard is east, so put blue to the east.
    const blue = w.ships[1] as NonNullable<World['ships'][number]>
    blue.x = red.x + 260
    blue.y = red.y
    stepWorld(w, [{ jx: 0, jy: -1, fire: true }, undefined], STEP, ev)
    expect(ev.filter((e) => e.k === 'fire').length).toBe(1)
    expect(red.fireSide).toBe(1)
    expect(w.balls.length).toBe(SALVO)
    for (const b of w.balls) expect(b.vx).toBeGreaterThan(0)
    expect(red.cd).toBeCloseTo(RELOAD, 6)
    // Still reloading: a held fire button starts no second salvo.
    for (let i = 0; i < 60; i++) stepWorld(w, [{ jx: 0, jy: -1, fire: true }, undefined], STEP, ev)
    expect(ev.filter((e) => e.k === 'fire').length).toBe(1)
  })

  it('a salvo fired to port goes out the other side', () => {
    const w = duel()
    const ev: Ev[] = []
    const red = w.ships[0] as NonNullable<World['ships'][number]>
    red.cd = 0
    const blue = w.ships[1] as NonNullable<World['ships'][number]>
    blue.x = red.x - 260
    blue.y = red.y
    stepWorld(w, [{ jx: 0, jy: -1, fire: true }, undefined], STEP, ev)
    expect(red.fireSide).toBe(-1)
    for (const b of w.balls) expect(b.vx).toBeLessThan(0)
  })

  it('a broadside sinks a ship in three hits, one hit per salvo at most', () => {
    const w = duel()
    const ev: Ev[] = []
    const red = w.ships[0] as NonNullable<World['ships'][number]>
    const blue = w.ships[1] as NonNullable<World['ships'][number]>
    red.x = 500
    red.y = 1000
    red.a = -Math.PI / 2
    blue.x = 500 + 240
    blue.y = 1000
    blue.a = -Math.PI / 2
    for (let salvo = 1; salvo <= HP && blue.alive; salvo++) {
      red.cd = 0
      stepWorld(w, [{ jx: 0, jy: 0, fire: true }, undefined], STEP, ev)
      for (let i = 0; i < 60 * 2; i++) stepWorld(w, [undefined, undefined], STEP, ev)
      expect(blue.hp).toBe(HP - salvo)
    }
    expect(blue.alive).toBe(false)
    expect(blue.sunkT).toBeGreaterThanOrEqual(0)
    expect(ev.filter((e) => e.k === 'hit').length).toBe(HP)
    expect(ev.some((e) => e.k === 'sink')).toBe(true)
    expect(roundWinner(w)).toBe(0)
  })

  it('a ball that runs out of reach drops into the sea as a splash', () => {
    const w = duel()
    w.balls.push({ id: 99, salvo: 50, owner: 0, side: 0, x: 100, y: 500, vx: 0, vy: 0, born: w.t })
    const ev: Ev[] = []
    for (let i = 0; i < Math.ceil((BALL_LIFE + 0.1) / STEP) + 2; i++)
      stepWorld(w, idle(w), STEP, ev)
    expect(w.balls.length).toBe(0)
    expect(ev.some((e) => e.k === 'splash')).toBe(true)
  })

  it('an island stops a cannonball', () => {
    const w = duel()
    w.isles = [{ x: 500, y: 760, r: 60 }]
    w.balls.push({
      id: 5,
      salvo: 50,
      owner: 0,
      side: 0,
      x: 500,
      y: 800,
      vx: 0,
      vy: -560,
      born: w.t,
    })
    const ev: Ev[] = []
    stepWorld(w, idle(w), STEP, ev)
    expect(w.balls.length).toBe(0)
    expect(ev.some((e) => e.k === 'rock')).toBe(true)
  })

  it('a ship is only hit by rival balls', () => {
    const w = duel()
    const red = w.ships[0] as NonNullable<World['ships'][number]>
    w.balls.push({
      id: 6,
      salvo: 50,
      owner: 0,
      side: 0,
      x: red.x,
      y: red.y,
      vx: 0,
      vy: 0,
      born: w.t,
    })
    const ev: Ev[] = []
    stepWorld(w, idle(w), STEP, ev)
    expect(red.hp).toBe(HP)
    expect(ev.some((e) => e.k === 'hit')).toBe(false)
  })

  it('a round is decided by the first sinking and a draw when both go down', () => {
    const w = duel()
    expect(roundWinner(w)).toBeNull()
    const [red, blue] = w.ships as NonNullable<World['ships'][number]>[]
    if (!red || !blue) throw new Error('ships')
    blue.alive = false
    expect(roundWinner(w)).toBe(0)
    red.alive = false
    expect(roundWinner(w)).toBe('draw')
  })
})

describe('round flow', () => {
  it('once a round is decided, balls still flying drop into the sea', () => {
    const w = duel()
    const [red, blue] = w.ships as NonNullable<World['ships'][number]>[]
    if (!red || !blue) throw new Error('ships')
    red.a = 0
    red.cd = 0
    stepWorld(w, [{ jx: 0, jy: 0, fire: true }, undefined], STEP, [])
    expect(w.balls.length).toBe(SALVO)
    red.alive = false
    const ev: Ev[] = []
    settle(w, ev)
    expect(w.balls.length).toBe(0)
    expect(ev.filter((e) => e.k === 'splash').length).toBe(SALVO)
    for (let i = 0; i < 90; i++) stepWorld(w, idle(w), STEP, [])
    expect(blue.hp).toBe(HP)
  })

  it('hulls meeting at speed bump and lose way, but take no damage', () => {
    const w = duel()
    const [red, blue] = w.ships as NonNullable<World['ships'][number]>[]
    if (!red || !blue) throw new Error('ships')
    red.y = 940
    blue.y = 860
    red.v = MAX_SPEED
    blue.v = MAX_SPEED
    const ev: Ev[] = []
    const ahead: Drive[] = [
      { jx: 0, jy: -1, fire: false },
      { jx: 0, jy: 1, fire: false },
    ]
    for (let i = 0; i < 20; i++) stepWorld(w, ahead, STEP, ev)
    const bump = ev.find((e) => e.k === 'bump')
    expect(bump).toBeDefined()
    expect(bump?.k === 'bump' && bump.speed).toBeGreaterThan(MAX_SPEED)
    expect(red.v).toBeLessThan(MAX_SPEED * 0.8)
    expect(red.hp).toBe(HP)
    expect(blue.hp).toBe(HP)
    expect(Math.hypot(red.x - blue.x, red.y - blue.y)).toBeGreaterThanOrEqual(SHIP_R * 2 - 0.01)
  })
})

describe('squall', () => {
  it('a long round turns into a squall: both crews reload faster', () => {
    const w = duel()
    const [red] = w.ships as NonNullable<World['ships'][number]>[]
    if (!red) throw new Error('ships')
    red.a = 0
    red.cd = 0
    stepWorld(w, [{ jx: 0, jy: 0, fire: true }, undefined], STEP, [])
    expect(red.cd).toBeCloseTo(RELOAD, 6)
    w.balls = []
    w.t = SQUALL_T - STEP / 2
    red.cd = 0
    const ev: Ev[] = []
    stepWorld(w, [{ jx: 0, jy: 0, fire: false }, undefined], STEP, ev)
    expect(ev.filter((e) => e.k === 'squall').length).toBe(1)
    stepWorld(w, [{ jx: 0, jy: 0, fire: true }, undefined], STEP, ev)
    expect(red.cd).toBeCloseTo(SQUALL_RELOAD, 6)
    expect(ev.filter((e) => e.k === 'squall').length).toBe(1)
  })
})

describe('bot vs bot', () => {
  it('a hard captain beats an easy one most of the time', () => {
    let hard = 0
    let rounds = 0
    for (let seed = 0; seed < 12; seed++) {
      const layout = seed % LAYOUTS
      const rng = new Rng(seed * 97 + 3)
      const w = newWorld(layout)
      // Swap sides every other duel so neither end is favoured.
      const hardSide = seed % 2
      const bots = w.ships.map(
        (s) => new ShipBot(rng.fork(), s.side === hardSide ? 'hard' : 'easy'),
      )
      let steps = 0
      while (roundWinner(w) === null && steps < 60 * 120) {
        stepWorld(
          w,
          w.ships.map((s, i) => bots[i]?.decide(w, s, STEP)),
          STEP,
          [],
        )
        steps++
      }
      const r = roundWinner(w)
      if (r === null || r === 'draw') continue
      rounds++
      if (r === hardSide) hard++
    }
    expect(rounds).toBeGreaterThan(8)
    expect(hard / rounds).toBeGreaterThan(0.7)
  })

  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`a ${difficulty} duel reaches a result on every layout`, () => {
      for (let layout = 0; layout < LAYOUTS; layout++) {
        const rng = new Rng(layout * 31 + 7)
        const w = newWorld(layout)
        const bots = w.ships.map(() => new ShipBot(rng.fork(), difficulty))
        let steps = 0
        while (roundWinner(w) === null && steps < 60 * 120) {
          const drives = w.ships.map((s, i) => bots[i]?.decide(w, s, STEP))
          stepWorld(w, drives, STEP, [])
          steps++
        }
        expect(roundWinner(w)).not.toBeNull()
      }
    })
  }
})
