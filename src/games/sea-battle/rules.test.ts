import { describe, expect, it } from 'vitest'
import type { Difficulty, GameContext, Side } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import { Fx } from '../../core/fx/fx.ts'
import { Input } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import type { Stage } from '../../core/stage.ts'
import { choose } from './bot.ts'
import makeGame from './index.ts'
import { cellPos, peekRect, readyRect, shuffleRect } from './render.ts'
import {
  allSunk,
  CELLS,
  FLEET,
  fire,
  fits,
  freshSea,
  HIT,
  isVertical,
  MISS,
  moveShip,
  N,
  neighbours,
  pendingHits,
  placeFleet,
  type Sea,
  sunkCount,
  turnShip,
  UNTRIED,
  viewOf,
} from './rules.ts'

/** A hand-made sea: ships given as [row, col, len, 'h' | 'v']. */
function seaOf(ships: [number, number, number, 'h' | 'v'][]): Sea {
  return {
    ships: ships.map(([r, c, len, d]) =>
      Array.from({ length: len }, (_, k) => (d === 'h' ? r * N + c + k : (r + k) * N + c)),
    ),
    shots: Array<number>(CELLS).fill(UNTRIED),
  }
}

/** Bot vs bot until one side has sunk the whole fleet. Each shot must hit a cell not yet fired at. */
function play(a: Difficulty, b: Difficulty, seed: number): { winner: Side; shots: number } {
  const rng = new Rng(seed)
  const seas: [Sea, Sea] = [freshSea(rng), freshSea(rng)]
  const diff = [a, b] as const
  let turn: Side = seed % 2 ? 1 : 0
  for (let n = 1; n <= CELLS * 2; n++) {
    const target = other(turn)
    const cell = choose(viewOf(seas[target]), diff[turn], rng)
    expect(seas[target].shots[cell]).toBe(UNTRIED)
    const r = fire(seas[target], cell)
    seas[target] = r.sea
    if (r.shot.win) return { winner: turn, shots: n }
    turn = other(turn)
  }
  throw new Error('no winner within the board size')
}

describe('sea battle rules', () => {
  it('places every fleet whole, straight, on the board and never touching', () => {
    for (let seed = 0; seed < 60; seed++) {
      const ships = placeFleet(new Rng(seed))
      expect(ships.map((s) => s.length)).toEqual([...FLEET])
      const all = ships.flat()
      expect(new Set(all).size).toBe(all.length)
      for (const cells of ships) {
        const rows = new Set(cells.map((c) => Math.floor(c / N)))
        const cols = new Set(cells.map((c) => c % N))
        expect(rows.size === 1 || cols.size === 1).toBe(true)
        for (const c of cells) expect(c).toBeGreaterThanOrEqual(0)
        for (const c of cells) expect(c).toBeLessThan(CELLS)
      }
      for (let i = 0; i < ships.length; i++) {
        for (let j = 0; j < ships.length; j++) {
          if (i === j) continue
          for (const c of ships[i] ?? []) {
            expect((ships[j] ?? []).some((d) => neighbours(c).includes(d) || d === c)).toBe(false)
          }
        }
      }
    }
  })

  it('reports a miss and a hit, and sinks a ship only once every cell is hit', () => {
    const sea = seaOf([[0, 0, 2, 'h']])
    const miss = fire(sea, 20)
    expect(miss.shot).toEqual({ hit: false, ship: -1, sunk: false, win: false })
    expect(miss.sea.shots[20]).toBe(MISS)

    const first = fire(sea, 0)
    expect(first.shot).toMatchObject({ hit: true, ship: 0, sunk: false, win: false })
    const second = fire(first.sea, 1)
    expect(second.shot).toMatchObject({ hit: true, sunk: true, win: true })
    expect(allSunk(second.sea)).toBe(true)
    expect(sunkCount(second.sea)).toBe(1)
  })

  it('does not change the sea it was given', () => {
    const sea = seaOf([[0, 0, 2, 'h']])
    fire(sea, 0)
    expect(sea.shots[0]).toBe(UNTRIED)
  })

  it('refuses a cell that was already fired at', () => {
    const sea = seaOf([[0, 0, 2, 'h']])
    const once = fire(sea, 5)
    expect(() => fire(once.sea, 5)).toThrow()
  })

  it('shows the computer only what a human could see', () => {
    const sea = seaOf([
      [0, 0, 2, 'h'],
      [5, 5, 3, 'v'],
    ])
    const view = viewOf(sea)
    expect(view.sunk).toEqual([])
    expect(view.left).toEqual([2, 3])
    const sunk = fire(fire(sea, 0).sea, 1).sea
    expect(viewOf(sunk).sunk).toEqual([[0, 1]])
    expect(viewOf(sunk).left).toEqual([3])
  })

  it('finds hits still waiting for their ship to sink', () => {
    const sea = seaOf([[0, 0, 3, 'h']])
    const hit = fire(sea, 1).sea
    expect(pendingHits(viewOf(hit))).toEqual([1])
    const sunk = fire(fire(hit, 0).sea, 2).sea
    expect(pendingHits(viewOf(sunk))).toEqual([])
  })

  it('records every shot on the sea and keeps earlier ones', () => {
    const sea = seaOf([[2, 2, 2, 'h']])
    const a = fire(sea, 0).sea
    const b = fire(a, 2 * N + 2).sea
    const c = fire(b, 2 * N + 3)
    expect(c.sea.shots[0]).toBe(MISS)
    expect(c.sea.shots[2 * N + 2]).toBe(HIT)
    expect(c.shot).toMatchObject({ hit: true, sunk: true, win: true })
    expect(c.sea.shots.filter((v) => v !== UNTRIED)).toHaveLength(3)
    expect(freshSea(new Rng(3)).shots.every((v) => v === UNTRIED)).toBe(true)
  })
})

describe('sea battle placement', () => {
  const at = (r: number, c: number) => r * N + c

  it('drags a ship by the cell held, keeping its heading, and only to a free place on the sea', () => {
    const { ships } = seaOf([
      [0, 0, 3, 'h'],
      [5, 5, 2, 'v'],
    ])
    // Held by its middle cell, dropped on (3, 3): it now runs (3, 2)..(3, 4).
    expect(moveShip(ships, 0, 1, at(3, 3))?.[0]).toEqual([at(3, 2), at(3, 3), at(3, 4)])
    // Off the edge.
    expect(moveShip(ships, 0, 0, at(0, 6))).toBeNull()
    // Overlapping, then merely touching the other ship.
    expect(moveShip(ships, 0, 0, at(5, 4))).toBeNull()
    expect(moveShip(ships, 0, 0, at(4, 3))).toBeNull()
    // The fleet it was given is untouched.
    expect(ships[0]).toEqual([0, 1, 2])
  })

  it('turns a ship around the touched cell, sliding along when the edge or a neighbour is in the way', () => {
    const { ships } = seaOf([[2, 2, 3, 'h']])
    expect(turnShip(ships, 0, at(2, 3))?.[0]).toEqual([at(1, 3), at(2, 3), at(3, 3)])
    // Back again: a down ship turns across.
    const down = turnShip(ships, 0, at(2, 3)) ?? []
    expect(isVertical(down[0] ?? [])).toBe(true)
    expect(turnShip(down, 0, at(2, 3))?.[0]).toEqual([at(2, 2), at(2, 3), at(2, 4)])
    // On the top row, turning about its first cell slides it down instead of off the sea.
    const top = seaOf([[0, 0, 3, 'h']]).ships
    expect(turnShip(top, 0, at(0, 0))?.[0]).toEqual([at(0, 0), at(1, 0), at(2, 0)])
    // Boxed in by another ship on every side it could take: it stays as it was.
    const boxed = seaOf([
      [0, 0, 2, 'h'],
      [2, 0, 4, 'h'],
    ]).ships
    expect(turnShip(boxed, 0, at(0, 0))).toBeNull()
  })

  it('a dragged or turned ship never breaks the fleet rules', () => {
    const rng = new Rng(11)
    let ships = placeFleet(rng)
    for (let n = 0; n < 400; n++) {
      const i = rng.int(0, ships.length - 1)
      const cur = ships[i] ?? []
      const next = rng.chance(0.5)
        ? moveShip(ships, i, rng.int(0, cur.length - 1), rng.int(0, CELLS - 1))
        : turnShip(ships, i, cur[rng.int(0, cur.length - 1)] ?? 0)
      if (next) ships = next
      expect(ships.map((s) => s.length)).toEqual([...FLEET])
      for (let j = 0; j < ships.length; j++) expect(fits(ships, j, ships[j] ?? [])).toBe(true)
    }
  })
})

describe('sea battle bot', () => {
  it('always fires at an untried cell', () => {
    const sea = seaOf([
      [1, 1, 4, 'h'],
      [6, 0, 3, 'v'],
    ])
    for (const d of ['easy', 'normal', 'hard'] as const) {
      for (let seed = 0; seed < 10; seed++) {
        const rng = new Rng(seed)
        let s = sea
        for (let n = 0; n < 30; n++) {
          const cell = choose(viewOf(s), d, rng)
          expect(s.shots[cell]).toBe(UNTRIED)
          s = fire(s, cell).sea
        }
      }
    }
  })

  it('finishes a hit ship along its line on normal', () => {
    // Battleship at row 3, cols 2..5. Hit (3,3) and (3,4): the next shot must be on the line.
    const sea = seaOf([[3, 2, 4, 'h']])
    let s = fire(sea, 3 * N + 3).sea
    s = fire(s, 3 * N + 4).sea
    for (let seed = 0; seed < 20; seed++) {
      const cell = choose(viewOf(s), 'normal', new Rng(seed))
      expect([3 * N + 2, 3 * N + 5]).toContain(cell)
    }
  })

  it('hard follows up a lone hit with a neighbouring cell', () => {
    const sea = seaOf([[4, 4, 3, 'v']])
    const s = fire(sea, 4 * N + 4).sea
    let next = 0
    for (let seed = 0; seed < 20; seed++) {
      const cell = choose(viewOf(s), 'hard', new Rng(seed))
      if (neighbours(4 * N + 4).includes(cell)) next++
    }
    expect(next).toBeGreaterThanOrEqual(18)
  })

  it('plays a full game bot vs bot for every pairing, within the board size', () => {
    const levels: Difficulty[] = ['easy', 'normal', 'hard']
    for (const a of levels) {
      for (const b of levels) {
        for (let seed = 1; seed <= 3; seed++) {
          const r = play(a, b, seed)
          expect(r.shots).toBeLessThanOrEqual(CELLS * 2)
        }
      }
    }
  })

  it('normal and hard never waste a shot on the water around a sunk ship', () => {
    // A destroyer at (0,0)-(0,1) is sunk: (0,2) and (1,0), (1,1) are known to be empty.
    const sea = seaOf([
      [0, 0, 2, 'h'],
      [5, 5, 3, 'h'],
    ])
    let s = fire(sea, 0).sea
    s = fire(s, 1).sea
    const water = [2, N, N + 1]
    for (const d of ['normal', 'hard'] as const) {
      for (let seed = 0; seed < 30; seed++) {
        expect(water).not.toContain(choose(viewOf(s), d, new Rng(seed)))
      }
    }
  })

  it('hard extends two hits in a row along their line', () => {
    const sea = seaOf([[3, 2, 4, 'h']])
    let s = fire(sea, 3 * N + 3).sea
    s = fire(s, 3 * N + 4).sea
    for (let seed = 0; seed < 20; seed++) {
      expect([3 * N + 2, 3 * N + 5]).toContain(choose(viewOf(s), 'hard', new Rng(seed)))
    }
  })

  it('hard hunts where most ships still fit, not into a corner', () => {
    const s = seaOf([[3, 2, 4, 'h']])
    const cell = choose(viewOf(s), 'hard', new Rng(1))
    expect([0, N - 1, CELLS - N, CELLS - 1]).not.toContain(cell)
  })

  it('hard needs fewer shots than normal, and normal fewer than easy', () => {
    const avg = (d: Difficulty) => {
      let n = 0
      for (let seed = 1; seed <= 16; seed++) n += play(d, d, seed).shots
      return n / 16
    }
    const [e, n, h] = [avg('easy'), avg('normal'), avg('hard')]
    expect(h).toBeLessThan(n)
    expect(n).toBeLessThan(e)
  })

  it('hard needs fewer shots than easy on average', () => {
    let hard = 0
    let easy = 0
    const games = 12
    for (let seed = 1; seed <= games; seed++) {
      hard += play('hard', 'hard', seed).shots
      easy += play('easy', 'easy', seed).shots
    }
    expect(hard / games).toBeLessThan(easy / games)
  })
})

// ---------- the game itself, driven headlessly through its own update loop ----------

/** A throwaway game context: real input routing, real fx, silent audio. */
function ctxFor(
  seed: number,
  mode: GameContext['mode'],
  bots: [boolean, boolean],
  local: Side = 0,
): GameContext {
  return {
    stage: {} as Stage,
    input: new Input({} as Stage, mode, local),
    fx: new Fx(),
    audio: { play: () => {}, buzz: () => {} } as unknown as GameContext['audio'],
    rng: new Rng(seed),
    mode,
    difficulty: 'normal',
    bots,
    teams: false,
    names: ['Red', 'Blue'],
    local,
    seed,
  }
}

/** Presses and releases one finger for exactly one fixed step. */
function tap(c: GameContext, side: Side, x: number, y: number, id: number): void {
  c.input.player(side).press(id, x, y)
}

describe('sea battle game', () => {
  it('a human against the computer reaches a result on every seed', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const c = ctxFor(seed, '1p', [false, true])
      const game = makeGame()
      game.init(c)
      let id = 1
      const ready = readyRect(0)
      for (let f = 0; f < 60 * 60 * 300 && !game.result; f++) {
        const s = game.s
        // No shot lands before the human calls Ready: the guns stay closed until then.
        if (f === 30) {
          expect(s.seas[1].shots.every((v) => v === UNTRIED)).toBe(true)
          tap(c, 0, ready.x + ready.w / 2, ready.y + ready.h / 2, id++)
        }
        if (s.turn === 0 && s.setupEnd >= 0 && s.shell === null && f % 15 === 0) {
          const open = s.seas[1].shots.flatMap((v, i) => (v === UNTRIED ? [i] : []))
          const cell = open[(seed * 7 + f) % open.length]
          if (cell !== undefined) {
            const p = cellPos(1, cell)
            tap(c, 0, p.x, p.y, id++)
          }
        }
        game.update(1 / 60)
        c.input.endStep()
        c.input.player(0).releaseAll()
      }
      expect(game.result).not.toBeNull()
      expect(game.result?.winner === 0 || game.result?.winner === 1).toBe(true)
    }
  })

  /** One fixed step, then every finger lifts. */
  function stepOnce(c: GameContext, game: ReturnType<typeof makeGame>): void {
    game.update(1 / 60)
    c.input.endStep()
    c.input.player(0).releaseAll()
    c.input.player(1).releaseAll()
  }

  function press(
    c: GameContext,
    game: ReturnType<typeof makeGame>,
    side: Side,
    r: { x: number; y: number; w: number; h: number },
    id: number,
  ): void {
    tap(c, side, r.x + r.w / 2, r.y + r.h / 2, id)
    stepOnce(c, game)
  }

  it('shuffles the fleet only until its owner calls Ready', () => {
    const c = ctxFor(3, '2p', [false, false])
    const game = makeGame()
    game.init(c)
    const before = JSON.stringify(game.s.seas[0].ships)
    press(c, game, 0, shuffleRect(0), 1)
    expect(JSON.stringify(game.s.seas[0].ships)).not.toBe(before)

    press(c, game, 0, readyRect(0), 2)
    expect(game.s.ready).toEqual([true, false])
    const locked = JSON.stringify(game.s.seas[0].ships)
    press(c, game, 0, shuffleRect(0), 3)
    expect(JSON.stringify(game.s.seas[0].ships)).toBe(locked)
  })

  it('the guns open only once both players are ready, however long they take', () => {
    const c = ctxFor(7, '2p', [false, false])
    const game = makeGame()
    game.init(c)
    for (let f = 0; f < 60 * 30; f++) stepOnce(c, game)
    expect(game.s.setupEnd).toBe(-1)
    press(c, game, 0, readyRect(0), 1)
    expect(game.s.setupEnd).toBe(-1)
    press(c, game, 1, readyRect(1), 2)
    expect(game.s.setupEnd).toBeGreaterThan(game.time)
  })

  it('a player drags a ship across their sea, and a still tap turns it', () => {
    const c = ctxFor(8, '2p', [false, false])
    const game = makeGame()
    game.init(c)
    const sea = game.s.seas[0]
    const big = sea.ships[0] ?? []
    // Pick the battleship up by its first cell and slide it, cell by cell, wherever it can go.
    const from = cellPos(0, big[0] ?? 0)
    c.input.player(0).press(1, from.x, from.y)
    game.update(1 / 60)
    c.input.endStep()
    expect(game.s.grab[0]).toMatchObject({ ship: 0, k: 0, moved: false })
    let moved = false
    for (let cell = 0; cell < CELLS && !moved; cell++) {
      const p = cellPos(0, cell)
      c.input.player(0).move(1, p.x, p.y)
      game.update(1 / 60)
      c.input.endStep()
      moved = JSON.stringify(game.s.seas[0].ships[0]) !== JSON.stringify(big)
    }
    expect(moved).toBe(true)
    c.input.player(0).releaseAll()
    game.update(1 / 60)
    c.input.endStep()
    expect(game.s.grab[0]).toBeNull()
    const placed = game.s.seas[0].ships
    for (let j = 0; j < placed.length; j++) expect(fits(placed, j, placed[j] ?? [])).toBe(true)

    // A tap that does not move turns a ship if it can, and never breaks the fleet.
    for (let i = 0; i < placed.length; i++) {
      const cells = game.s.seas[0].ships[i] ?? []
      if (cells.length < 2) continue
      const was = isVertical(cells)
      const p = cellPos(0, cells[0] ?? 0)
      tap(c, 0, p.x, p.y, 10 + i)
      stepOnce(c, game)
      stepOnce(c, game)
      const now = game.s.seas[0].ships[i] ?? []
      if (JSON.stringify(now) !== JSON.stringify(cells)) expect(isVertical(now)).toBe(!was)
      const all = game.s.seas[0].ships
      for (let j = 0; j < all.length; j++) expect(fits(all, j, all[j] ?? [])).toBe(true)
    }
  })

  it('a flick that presses, moves and lifts within one step still drags the ship', () => {
    const c = ctxFor(8, '2p', [false, false])
    const game = makeGame()
    game.init(c)
    const ships = game.s.seas[0].ships
    const big = ships[0] ?? []
    // The first free spot the battleship could slide to, held by its first cell.
    let to = -1
    for (let cell = 0; cell < CELLS && to < 0; cell++)
      if (cell !== big[0] && moveShip(ships, 0, 0, cell)) to = cell
    expect(to).toBeGreaterThanOrEqual(0)
    const a = cellPos(0, big[0] ?? 0)
    const b = cellPos(0, to)
    const inp = c.input.player(0)
    inp.press(1, a.x, a.y)
    inp.move(1, b.x, b.y)
    inp.release(1)
    stepOnce(c, game)
    expect(game.s.seas[0].ships[0]?.[0]).toBe(to)
    expect(game.s.grab[0]).toBeNull()
  })

  it('on a shared phone, a touch on a sea belongs to its owner while placing, to the shooter after', () => {
    const c = ctxFor(12, '2p', [false, false])
    const game = makeGame()
    game.init(c)
    const assign = c.input.assign
    if (!assign) throw new Error('sea battle routes touches itself')
    const top = cellPos(1, 0)
    const bottom = cellPos(0, 0)
    // Whoever opens, each player places on their own sea.
    expect(assign(top.x, top.y)).toBe(1)
    expect(assign(bottom.x, bottom.y)).toBe(0)
    press(c, game, 0, readyRect(0), 1)
    press(c, game, 1, readyRect(1), 2)
    // Once the guns open, the rival's sea is the shooter's to tap.
    const shooter = game.s.turn
    const target = cellPos(other(shooter), 0)
    expect(assign(target.x, target.y)).toBe(shooter)
  })

  it("online, the snapshot keeps this device's unsunk ships off the wire", () => {
    const c = ctxFor(4, 'online', [false, false], 0)
    const game = makeGame()
    game.init(c)
    const snap = game.snapshot() as { s: { seas: { ships: number[][] }[] } }
    expect(snap.s.seas[0]?.ships.every((cells) => cells.length === 0)).toBe(true)
    expect(snap.s.seas[1]?.ships.every((cells) => cells.length > 0)).toBe(true)
    // The live state is untouched: only the copy on the wire is redacted.
    expect(game.s.seas[0].ships.every((cells) => cells.length > 0)).toBe(true)
  })

  it('Peek is a local-2P control: a finger in its corner shows a fleet only in 2P', () => {
    // Online, the host's Peek corner is live input, so it must not reveal the host's fleet to the guest.
    const online = ctxFor(5, 'online', [false, false], 0)
    const host = makeGame()
    host.init(online)
    const r = peekRect(0)
    tap(online, 0, r.x + r.w / 2, r.y + r.h / 2, 1)
    host.update(1 / 60)
    online.input.endStep()
    expect(host.s.peek[0]).toBe(false)

    const local = ctxFor(6, '2p', [false, false])
    const hot = makeGame()
    hot.init(local)
    tap(local, 0, r.x + r.w / 2, r.y + r.h / 2, 1)
    hot.update(1 / 60)
    local.input.endStep()
    expect(hot.s.peek[0]).toBe(true)
  })

  it('the computer finishes a game with no errors, both sides driven by the bot', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const c = ctxFor(seed, '2p', [true, true])
      const game = makeGame()
      game.init(c)
      for (let f = 0; f < 60 * 60 * 300 && !game.result; f++) {
        game.update(1 / 60)
        c.input.endStep()
      }
      expect(game.result).not.toBeNull()
    }
  })

  it('a match to two round wins ends only when one side has two, scored in rounds', () => {
    const c = { ...ctxFor(9, '2p', [true, true]), target: 2 }
    const game = makeGame()
    game.init(c)
    for (let f = 0; f < 60 * 60 * 900 && !game.result; f++) {
      game.update(1 / 60)
      c.input.endStep()
    }
    const [red, blue] = game.s.wins
    expect(game.result).not.toBeNull()
    expect(Math.max(red, blue)).toBe(2)
    expect(game.result?.winner).toBe(red === 2 ? 0 : 1)
    expect(game.result?.score).toEqual([red, blue])
  })
})
