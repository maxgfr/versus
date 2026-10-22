import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import {
  bfsNext,
  collideCircle,
  lineOfSight,
  moveBouncing,
  parseMap,
  reachable,
  solidCell,
} from '../../engines/arena/index.ts'
import { bankShot, TankBot } from './bot.ts'
import {
  type Drive,
  type Ev,
  HP,
  MAPS,
  newWorld,
  roundWinner,
  SHELL_SPEED,
  SPEED,
  stepWorld,
  TANK_R,
} from './rules.ts'

describe('arena maps', () => {
  it('are point-symmetric, fully connected and have every spawn', () => {
    for (const rows of MAPS) {
      const g = parseMap(rows)
      expect(g.rows).toBe(12)
      expect(g.cols).toBe(10)
      let floor = 0
      for (let r = 0; r < g.rows; r++)
        for (let c = 0; c < g.cols; c++) {
          expect(solidCell(g, c, r)).toBe(solidCell(g, g.cols - 1 - c, g.rows - 1 - r))
          if (!solidCell(g, c, r)) floor++
        }
      for (const k of ['R', 'r', 'B', 'b']) expect(g.spawns[k]).toBeDefined()
      const R = g.spawns.R as { x: number; y: number }
      expect(reachable(g, Math.floor(R.x / 100), Math.floor((R.y - 300) / 100))).toBe(floor)
    }
  })
})

describe('arena physics', () => {
  const g = parseMap(['....', '.#..', '....'])
  it('pushes circles out of walls', () => {
    const b = { x: 150, y: 400 }
    collideCircle(g, b, 30)
    expect(solidCell(g, Math.floor(b.x / 100), Math.floor((b.y - 300) / 100))).toBe(false)
  })
  it('bounces projectiles off walls', () => {
    const p = { x: 60, y: 450, vx: 600, vy: 0 }
    let n = 0
    for (let i = 0; i < 10; i++) n += moveBouncing(g, p, STEP)
    expect(n).toBe(1)
    expect(p.vx).toBeLessThan(0)
  })
  it('sees through floor but not walls', () => {
    expect(lineOfSight(g, 50, 350, 350, 350)).toBe(true)
    expect(lineOfSight(g, 50, 450, 350, 450)).toBe(false)
  })
  it('paths around walls', () => {
    const n = bfsNext(g, 50, 450, 250, 450)
    expect(n.steps).toBeGreaterThan(1)
  })
})

describe('tanks', () => {
  it('a shell to the face costs a life', () => {
    const grid = parseMap(MAPS[0] as string[])
    const w = newWorld(grid, false)
    const [red, blue] = w.tanks
    if (!red || !blue) throw new Error('missing tanks')
    // Put them face to face in open floor.
    red.x = 450
    red.y = 1050
    red.a = -Math.PI / 2
    blue.x = 450
    blue.y = 850
    const ev: Ev[] = []
    const drives: Drive[] = [{ jx: 0, jy: 0, fire: true }]
    red.cd = 0
    for (let i = 0; i < 40; i++) stepWorld(w, grid, i === 0 ? drives : [], STEP, ev)
    expect(ev.some((e) => e.k === 'shot')).toBe(true)
    expect(blue.hp).toBe(HP - 1)
  })

  it('two shells crossing at speed cancel out instead of slipping past', () => {
    const grid = parseMap(['..........', '..........', '..........'])
    const w = newWorld(grid, false)
    w.tanks.length = 0
    // Closing 21.3 units a step on lines 17 apart: their overlap window is only
    // ~21 units long, so checking positions at whole steps alone would miss it.
    const close = (SHELL_SPEED * 2) / 60
    for (const [id, x, y, vx] of [
      [1, 100, 450, SHELL_SPEED],
      [2, 100 + 10.6 + close * 38, 467, -SHELL_SPEED],
    ] as const)
      w.shells.push({ id, owner: 9, side: 0, x, y, vx, vy: 0, bounces: 0, born: 0 })
    const ev: Ev[] = []
    for (let i = 0; i < 60 && w.shells.length; i++) stepWorld(w, grid, [], STEP, ev)
    expect(ev.some((e) => e.k === 'clash')).toBe(true)
    expect(w.shells.length).toBe(0)
  })

  const open = parseMap([
    '....B.....',
    ...Array.from({ length: 10 }, () => '..........'),
    '....R.....',
  ])
  it('a charging tank fires a faster shell than a parked one', () => {
    const grid = open
    const fire = (drive: boolean): number => {
      const w = newWorld(grid, false)
      const red = w.tanks[0] as (typeof w.tanks)[number]
      red.x = 450
      red.y = 1250
      red.a = -Math.PI / 2
      red.cd = 9
      for (let i = 0; i < 30; i++)
        stepWorld(w, grid, [{ jx: 0, jy: drive ? -1 : 0, fire: false }], STEP, [])
      red.cd = 0
      stepWorld(w, grid, [{ jx: 0, jy: drive ? -1 : 0, fire: true }], STEP, [])
      const sh = w.shells[0]
      if (!sh) throw new Error('no shell')
      return Math.hypot(sh.vx, sh.vy)
    }
    expect(fire(false)).toBeCloseTo(SHELL_SPEED, 0)
    expect(fire(true)).toBeGreaterThan(SHELL_SPEED + SPEED * 0.4)
  })

  it('the stick eases the hull up to speed instead of teleporting to it', () => {
    const grid = open
    const w = newWorld(grid, false)
    const red = w.tanks[0] as (typeof w.tanks)[number]
    red.x = 450
    red.y = 1250
    red.a = -Math.PI / 2
    stepWorld(w, grid, [{ jx: 0, jy: -1, fire: false }], STEP, [])
    const first = Math.hypot(red.vx, red.vy)
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(SPEED * 0.5)
    for (let i = 0; i < 30; i++) stepWorld(w, grid, [{ jx: 0, jy: -1, fire: false }], STEP, [])
    expect(Math.hypot(red.vx, red.vy)).toBeGreaterThan(SPEED * 0.95)
  })

  it('the bot finds a bank shot around a wall and the real physics agrees', () => {
    const grid = parseMap(['..........', '..........', '....#.....', '..........', '..........'])
    const w = newWorld(grid, false)
    w.tanks.length = 0
    const mk = (id: number, side: 0 | 1, x: number, y: number) => ({
      id,
      side,
      lane: 0 as const,
      x,
      y,
      a: 0,
      vx: 0,
      vy: 0,
      hp: HP,
      alive: true,
      cd: 0,
      tread: 0,
      hitT: -9,
      fireT: -9,
    })
    const me = mk(0, 0, 450, 750)
    const foe = mk(1, 1, 450, 350)
    w.tanks.push(me, foe)
    expect(lineOfSight(grid, me.x, me.y, foe.x, foe.y)).toBe(false)
    const a = bankShot(grid, me, foe, 2)
    expect(a).not.toBeNull()
    me.a = a as number
    const ev: Ev[] = []
    for (let i = 0; i < 200 && foe.hp === HP; i++)
      stepWorld(w, grid, i === 0 ? [{ jx: 0, jy: 0, fire: true }] : [], STEP, ev)
    expect(foe.hp).toBe(HP - 1)
    expect(me.hp).toBe(HP)
  })

  it('tanks never end up inside walls', () => {
    const grid = parseMap(MAPS[1] as string[])
    const w = newWorld(grid, true)
    for (let i = 0; i < 600; i++) {
      stepWorld(
        w,
        grid,
        w.tanks.map((_, j) => ({
          jx: Math.cos(i * 0.01 + j),
          jy: Math.sin(i * 0.013 + j),
          fire: false,
        })),
        STEP,
        [],
      )
    }
    for (const t of w.tanks) {
      for (const [dx, dy] of [
        [0, 0],
        [TANK_R * 0.7, 0],
        [0, TANK_R * 0.7],
      ] as const) {
        const c = Math.floor((t.x + dx - grid.x0) / grid.cell)
        const r = Math.floor((t.y + dy - grid.y0) / grid.cell)
        expect(solidCell(grid, c, r)).toBe(false)
      }
    }
  })

  for (const teams of [false, true]) {
    it(`bot vs bot reaches a result (${teams ? '2 vs 2' : '1 vs 1'})`, () => {
      for (let seed = 0; seed < 6; seed++) {
        const rng = new Rng(seed)
        const grid = parseMap(MAPS[seed % MAPS.length] as string[])
        const w = newWorld(grid, teams)
        const bots = w.tanks.map(() => new TankBot(rng.fork(), seed % 2 ? 'hard' : 'normal'))
        let steps = 0
        while (roundWinner(w) === null && steps < 60 * 150) {
          const drives = w.tanks.map((t, i) => (bots[i] as TankBot).decide(w, grid, t, STEP))
          stepWorld(w, grid, drives, STEP, [])
          steps++
        }
        expect(roundWinner(w)).not.toBeNull()
      }
    })
  }
})
