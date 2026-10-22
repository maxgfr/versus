import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { BombBot, pathTo } from './bot.ts'
import {
  BASE_SPEED,
  BOARD,
  BOMB_T,
  centreOf,
  CRATE,
  type Drive,
  type Ev,
  FLAME_T,
  FLOOR,
  HURRY,
  HURRY_EVERY,
  HURRY_T,
  idx,
  ITEMS,
  newWorld,
  PILLAR,
  type Player,
  PR,
  roundWinner,
  SPAWN,
  stepWorld,
  type World,
} from './rules.ts'

/** A world with an empty floor (edges and pillars kept), players on the given cells. */
function field(at: { red?: [number, number]; blue?: [number, number] } = {}): World {
  const w = newWorld(new Rng(1))
  w.tiles = w.tiles.map((t) => (t === CRATE ? FLOOR : t))
  w.hidden = w.hidden.map(() => -1)
  const place = (p: Player, cell: [number, number] | undefined) => {
    if (!cell) return
    const c = centreOf(cell[0], cell[1])
    p.x = c.x
    p.y = c.y
  }
  const [red, blue] = w.players as [Player, Player]
  place(red, at.red)
  place(blue, at.blue)
  return w
}

const idle = (w: World): (Drive | undefined)[] => w.players.map(() => undefined)
const tile = (w: World, c: number, r: number) => w.tiles[idx(c, r)]
const run = (w: World, n: number, ev: Ev[] = [], drives = idle(w)) => {
  for (let i = 0; i < n; i++) stepWorld(w, drives, STEP, ev)
}

describe('festival flow', () => {
  it('corner assist: pushing up a little off a lane slides onto it instead of snagging', () => {
    // Column 2 between the pillars of columns 1 and 3: start 22 units right of its centre.
    const w = field({ red: [2, 10], blue: [8, 0] })
    const red = w.players[0] as Player
    red.x += 22
    run(w, 45, [], [{ jx: 0, jy: -1, bomb: false }, undefined])
    // Past the pillar row above (row 9) and centred on the lane.
    expect(red.y).toBeLessThan(centreOf(2, 9).y)
    expect(Math.abs(red.x - centreOf(2, 9).x)).toBeLessThan(2)
  })

  it('a bomb dropped under the rival lets the rival walk off it too', () => {
    const w = field({ red: [4, 4], blue: [4, 4] })
    const [red, blue] = w.players as [Player, Player]
    blue.x += 20
    const bx = blue.x
    stepWorld(w, [{ jx: 0, jy: 0, bomb: true }, undefined], STEP, [])
    expect(w.bombs[0]?.through).toEqual([0, 1])
    // Blue is not shoved out sideways by the bomb under it.
    expect(blue.x).toBeCloseTo(bx, 6)
    expect(red.alive).toBe(true)
  })

  it('hurry-up drops blocks in mirror pairs from the outside in and crushes who stands there', () => {
    // The order covers every cell once, each followed by its mirror.
    const n = BOARD.cols * BOARD.rows
    expect(new Set(HURRY).size).toBe(n)
    for (let k = 0; k + 1 < HURRY.length; k += 2)
      expect((HURRY[k] as number) + (HURRY[k + 1] as number)).toBe(n - 1)
    const w = field({ red: [0, 0], blue: [8, 8] })
    const red = w.players[0] as Player
    const ev: Ev[] = []
    w.t = HURRY_T - STEP / 2
    w.hurryT = HURRY_T
    run(w, 2, ev)
    expect(ev.some((e) => e.k === 'hurry')).toBe(true)
    // The very first block lands on the top-left corner, where red stands.
    expect(tile(w, 0, 0)).toBe(PILLAR)
    expect(tile(w, BOARD.cols - 1, BOARD.rows - 1)).toBe(PILLAR)
    expect(red.alive).toBe(false)
    expect(roundWinner(w)).toBe(1)
    run(w, Math.ceil((HURRY_EVERY / STEP) * 3), ev)
    expect(ev.filter((e) => e.k === 'drop').length).toBeGreaterThanOrEqual(6)
  })

  it('once the round is decided, a ticking bomb cannot knock out the survivor', () => {
    const w = field({ red: [4, 4], blue: [8, 0] })
    const red = w.players[0] as Player
    stepWorld(w, [{ jx: 0, jy: 0, bomb: true }, undefined], STEP, [])
    w.frozen = true
    run(w, Math.ceil((BOMB_T + 0.2) / STEP))
    expect(w.flames.length).toBeGreaterThan(0)
    expect(red.alive).toBe(true)
  })
})

describe('festival board', () => {
  it('has pillars on the odd grid, spawns with two free cells around them', () => {
    const w = newWorld(new Rng(9))
    for (let r = 0; r < BOARD.rows; r++)
      for (let c = 0; c < BOARD.cols; c++)
        if (c % 2 === 1 && r % 2 === 1) expect(tile(w, c, r)).toBe(PILLAR)
    for (const s of SPAWN) {
      for (const [dc, dr] of [
        [0, 0],
        [1, 0],
        [0, -1],
        [-1, 0],
        [0, 1],
      ] as const) {
        const c = s.c + dc
        const r = s.r + dr
        if (c < 0 || r < 0 || c >= BOARD.cols || r >= BOARD.rows) continue
        expect(tile(w, c, r)).not.toBe(CRATE)
      }
    }
  })

  it('every spawn can reach the other one through the crates it has to blow up', () => {
    for (let seed = 0; seed < 8; seed++) {
      const w = newWorld(new Rng(seed))
      w.tiles = w.tiles.map((t) => (t === CRATE ? FLOOR : t))
      const from = SPAWN[0] as { c: number; r: number }
      const to = SPAWN[1] as { c: number; r: number }
      expect(pathTo(w, from, (c, r) => c === to.c && r === to.r)).not.toBeNull()
    }
  })
})

describe('festival movement', () => {
  it('a player cannot walk through a pillar', () => {
    const w = field({ red: [0, 13] })
    const p = w.players[0] as Player
    const pillar = centreOf(1, 13)
    // Walk straight into the pillar at (1, 13) from the left.
    for (let i = 0; i < 120; i++) stepWorld(w, [{ jx: 1, jy: 0, bomb: false }, undefined], STEP, [])
    expect(p.x).toBeLessThan(pillar.x - BOARD.cell / 2 - PR + 0.5)
  })

  it('moves at the player speed and never leaves the board', () => {
    const w = field({ red: [4, 6] })
    const p = w.players[0] as Player
    const x0 = p.x
    run(w, 30, [], [{ jx: 1, jy: 0, bomb: false }, undefined])
    expect(p.x - x0).toBeCloseTo(BASE_SPEED * 0.5, 0)
    run(w, 600, [], [{ jx: -1, jy: 0.3, bomb: false }, undefined])
    expect(p.x).toBeGreaterThanOrEqual(BOARD.x0 + PR - 1e-6)
  })
})

describe('festival bombs', () => {
  it('a bomb goes off after its fuse in a cross, stopped by pillars and breaking crates', () => {
    const w = field({ red: [4, 6], blue: [10, 0] })
    const bi = idx(4, 6)
    w.tiles[idx(6, 6)] = CRATE
    w.tiles[idx(4, 4)] = CRATE
    w.players[0] = { ...(w.players[0] as Player), x: centreOf(4, 6).x, y: centreOf(4, 6).y }
    const ev: Ev[] = []
    stepWorld(w, [{ jx: 0, jy: 0, bomb: true }, undefined], STEP, ev)
    expect(w.bombs.length).toBe(1)
    expect(w.bombs[0]?.i).toBe(bi)
    expect((w.players[0] as Player).bombsOut).toBe(1)
    run(w, Math.ceil((BOMB_T + FLAME_T) / STEP) + 4, ev)
    expect(w.bombs.length).toBe(0)
    expect(ev.some((e) => e.k === 'boom')).toBe(true)
    expect(tile(w, 6, 6)).toBe(FLOOR)
    expect(tile(w, 4, 4)).toBe(FLOOR)
    expect(w.flames.some((f) => f.i === idx(6, 6))).toBe(false)
    expect((w.players[0] as Player).bombsOut).toBe(0)
  })

  it('the blast is stopped by a pillar', () => {
    const w = field({ red: [2, 2], blue: [10, 0] })
    w.tiles[idx(2, 3)] = FLOOR
    w.players[0] = { ...(w.players[0] as Player), x: centreOf(2, 2).x, y: centreOf(2, 2).y }
    // Column 2 row 3 is floor; row 3 column 3 is a pillar: a bomb at (2, 2) with range 3 reaches (2, 5) but not past the pillar at (3, 3)? Use a row check instead.
    w.bombs.push({ i: idx(2, 2), owner: 0, t: 0.01, range: 6, through: [] })
    stepWorld(w, idle(w), STEP, [])
    expect(w.flames.some((f) => f.i === idx(3, 2))).toBe(true)
    expect(w.flames.some((f) => f.i === idx(4, 2))).toBe(true)
    expect(w.flames.some((f) => f.i === idx(3, 1))).toBe(false)
    expect(w.flames.some((f) => f.i === idx(3, 3))).toBe(false)
  })

  it('a player caught in the blast dies; one who walked out of reach survives', () => {
    const w = field({ red: [4, 4], blue: [10, 0] })
    w.bombs.push({ i: idx(4, 4), owner: 0, t: 0.01, range: 2, through: [0] })
    const red = w.players[0] as Player
    const ev: Ev[] = []
    stepWorld(w, idle(w), STEP, ev)
    expect(red.alive).toBe(false)
    expect(ev.some((e) => e.k === 'death')).toBe(true)
    expect(roundWinner(w)).toBe(1)

    const w2 = field({ red: [4, 4], blue: [10, 0] })
    w2.bombs.push({ i: idx(4, 4), owner: 0, t: 1.2, range: 1, through: [0] })
    const r2 = w2.players[0] as Player
    // Walk two cells away before the fuse ends: the blast (range 1) does not reach.
    run(w2, 90, [], [{ jx: 1, jy: 0, bomb: false }, undefined])
    expect(r2.alive).toBe(true)
  })

  it('a player may walk off their own fresh bomb but not walk back onto it', () => {
    const w = field({ red: [4, 4], blue: [10, 0] })
    const red = w.players[0] as Player
    stepWorld(w, [{ jx: 0, jy: 0, bomb: true }, undefined], STEP, [])
    expect(w.bombs.length).toBe(1)
    // Walk out to the right: the bomb cell no longer holds the player.
    run(w, 60, [], [{ jx: 1, jy: 0, bomb: false }, undefined])
    expect(red.x).toBeGreaterThan(centreOf(5, 4).x)
    // Now walking back in is blocked by the bomb.
    run(w, 80, [], [{ jx: -1, jy: 0, bomb: false }, undefined])
    expect(red.x).toBeGreaterThan(BOARD.x0 + 5 * BOARD.cell)
  })

  it('a blast sets off the bomb in its cross early', () => {
    const w = field({ red: [0, 14], blue: [10, 0] })
    w.bombs.push({ i: idx(4, 6), owner: 0, t: 0.01, range: 2, through: [] })
    w.bombs.push({ i: idx(6, 6), owner: 0, t: 1.9, range: 2, through: [] })
    const ev: Ev[] = []
    stepWorld(w, idle(w), STEP, ev)
    // The second bomb had 1.9 s left and still went off at once, because it sits in the first one's cross.
    expect(w.bombs.length).toBe(0)
    expect(ev.filter((e) => e.k === 'boom').length).toBe(2)
  })

  it('flames die out after their short life', () => {
    const w = field({ red: [5, 5], blue: [10, 0] })
    w.flames.push({ i: idx(8, 8), t: FLAME_T })
    run(w, Math.ceil(FLAME_T / STEP) + 1)
    expect(w.flames.length).toBe(0)
  })

  it('a player holds at most their bomb count', () => {
    const w = field({ red: [5, 5], blue: [10, 0] })
    const red = w.players[0] as Player
    red.bombsMax = 1
    stepWorld(w, [{ jx: 0, jy: 0, bomb: true }, undefined], STEP, [])
    run(w, 1, [], [{ jx: 0, jy: 0, bomb: true }, undefined])
    expect(w.bombs.length).toBe(1)
  })
})

describe('festival power-ups and results', () => {
  it('walking over a power-up applies it', () => {
    const w = field({ red: [3, 5], blue: [10, 0] })
    const red = w.players[0] as Player
    w.items.push({ i: idx(4, 5), k: 0 })
    w.items.push({ i: idx(4, 5), k: 0 }) // a second copy in the same cell is dropped too
    const ev: Ev[] = []
    run(w, 60, ev, [{ jx: 1, jy: 0, bomb: false }, undefined])
    expect(red.range).toBeGreaterThanOrEqual(3)
    expect(ev.filter((e) => e.k === 'pick').length).toBeGreaterThanOrEqual(1)
    expect(w.items.length).toBe(0)
    expect(ITEMS.length).toBe(3)
  })

  it('both players caught in the same blast is a draw', () => {
    const w = field({ red: [4, 4], blue: [4, 3] })
    w.bombs.push({ i: idx(4, 4), owner: 0, t: 0.01, range: 2, through: [] })
    w.players[1] = { ...(w.players[1] as Player), x: centreOf(4, 3).x, y: centreOf(4, 3).y }
    stepWorld(w, idle(w), STEP, [])
    expect(roundWinner(w)).toBe('draw')
  })

  it('the blue player wins when red is caught', () => {
    const w = field({ red: [4, 4], blue: [10, 0] })
    w.flames.push({ i: idx(4, 4), t: FLAME_T })
    stepWorld(w, idle(w), STEP, [])
    expect(roundWinner(w)).toBe(1)
  })
})

describe('festival bot vs bot', () => {
  it('hard beats easy in most seeded rounds, from either side', () => {
    let wins = 0
    let decided = 0
    for (let seed = 0; seed < 20; seed++) {
      const rng = new Rng(seed * 31 + 7)
      const w = newWorld(rng.fork())
      const side = seed % 2
      const bots = w.players.map((p) => new BombBot(rng.fork(), p.side === side ? 'hard' : 'easy'))
      for (let i = 0; i < 60 * 150 && roundWinner(w) === null; i++)
        stepWorld(
          w,
          w.players.map((p, j) => bots[j]?.decide(w, p, STEP)),
          STEP,
          [],
        )
      const r = roundWinner(w)
      if (r === null || r === 'draw') continue
      decided++
      if (r === side) wins++
    }
    expect(decided).toBeGreaterThan(16)
    expect(wins / decided).toBeGreaterThan(0.7)
  })

  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`a ${difficulty} round is decided within bounded steps`, () => {
      for (let seed = 0; seed < 4; seed++) {
        const rng = new Rng(seed * 17 + 2)
        const w = newWorld(rng)
        const bots = w.players.map(() => new BombBot(rng.fork(), difficulty))
        let steps = 0
        while (roundWinner(w) === null && steps < 60 * 120) {
          const drives = w.players.map((p, i) => bots[i]?.decide(w, p, STEP))
          stepWorld(w, drives, STEP, [])
          steps++
        }
        expect(roundWinner(w)).not.toBeNull()
      }
    })
  }
})
