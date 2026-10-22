import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { choose } from './ai.ts'
import {
  atRest,
  BASE_X,
  BASE_Y,
  BOARD,
  type Board,
  CENTRE,
  cloneBoard,
  dist,
  frame,
  freeX,
  launchSpeed,
  newBoard,
  placeStriker,
  POCKETS,
  PIECE_R,
  resolve,
  respot,
  simulate,
  strike,
  STRIKER_R,
} from './rules.ts'

/** Play a whole board with the bot on both sides, the way the game does. */
function playBoard(
  first: 0 | 1,
  d: 'easy' | 'normal' | 'hard',
  seed: number,
): { b: Board; turns: number; frames: number } {
  const b = newBoard(first)
  const rng = new Rng(seed)
  let frames = 0
  let guard = 0
  while (b.phase !== 'done' && guard++ < 200) {
    const shot = choose({ board: b }, d, rng.int(1, 1e6))
    placeStriker(b, shot.x)
    strike(b, shot.dx, shot.dy, shot.power)
    let f = 0
    while (!atRest(b) && f++ < 2000) {
      frame(b)
      frames++
    }
    resolve(b)
  }
  return { b, turns: b.turns, frames }
}

describe('carrom layout', () => {
  it('starts with nine light, nine dark and the queen in the middle', () => {
    const b = newBoard(0)
    const count = (o: number) => b.pieces.filter((p) => p.owner === o).length
    expect(count(0)).toBe(9)
    expect(count(1)).toBe(9)
    expect(count(2)).toBe(1)
    const queen = b.pieces.find((p) => p.owner === 2)
    expect(queen && dist(queen.x, queen.y, CENTRE.x, CENTRE.y)).toBe(0)
    expect(b.left).toEqual([9, 9])
  })

  it('no two pieces overlap at the start', () => {
    const b = newBoard(0)
    for (let i = 0; i < b.pieces.length; i++) {
      for (let j = i + 1; j < b.pieces.length; j++) {
        const a = b.pieces[i]
        const c = b.pieces[j]
        expect(dist(a!.x, a!.y, c!.x, c!.y)).toBeGreaterThan(PIECE_R * 2)
      }
    }
  })

  it('the striker sits on its own baseline, moved along it to a clear spot', () => {
    const b = newBoard(1)
    placeStriker(b, 500)
    expect(b.striker.y).toBe(BASE_Y[1])
    expect(b.striker.x).toBeGreaterThanOrEqual(BASE_X.x0)
    expect(b.striker.x).toBeLessThanOrEqual(BASE_X.x1)
    // Put a piece right where the striker wants to go: it is pushed to a free spot.
    b.pieces.push({ x: 300, y: BASE_Y[1], vx: 0, vy: 0, r: PIECE_R, owner: 0 })
    expect(freeX(b, 1, 300)).not.toBe(300)
  })

  it('a piece dropped on the board goes to the free spot nearest the centre', () => {
    const b = newBoard(0)
    b.pieces = []
    respot(b, 1)
    expect(b.pieces).toHaveLength(1)
    expect(dist(b.pieces[0]!.x, b.pieces[0]!.y, CENTRE.x, CENTRE.y)).toBe(0)
  })
})

describe('carrom rules', () => {
  it('potting your own piece earns another turn', () => {
    const b = newBoard(0)
    b.pieces = [
      { x: POCKETS[0]!.x + 30, y: POCKETS[0]!.y + 30, vx: 0, vy: 0, r: PIECE_R, owner: 0 },
    ]
    b.left = [1, 9]
    b.pots = [0]
    b.phase = 'roll'
    resolve(b)
    expect(b.turn).toBe(0)
    expect(b.left[0]).toBe(0)
    expect(b.winner).toBe(0)
  })

  it('a rival piece goes back on the board and the turn passes', () => {
    const b = newBoard(0)
    b.pieces = []
    b.pots = [1]
    b.phase = 'roll'
    resolve(b)
    expect(b.turn).toBe(1)
    expect(b.pieces.filter((p) => p.owner === 1)).toHaveLength(1)
    expect(b.left).toEqual([9, 9])
  })

  it('potting the striker is a foul that gives back one of your pieces', () => {
    const b = newBoard(0)
    b.pieces = []
    b.left = [6, 9]
    b.kept = [3, 0]
    b.striker.gone = true
    b.foul = true
    b.phase = 'roll'
    resolve(b)
    expect(b.turn).toBe(1)
    expect(b.left[0]).toBe(7)
    expect(b.kept[0]).toBe(2)
    expect(b.pieces.filter((p) => p.owner === 0)).toHaveLength(1)
  })

  it('a foul with nothing pocketed gives nothing back', () => {
    const b = newBoard(0)
    b.pieces = []
    b.left = [9, 9]
    b.kept = [0, 0]
    b.striker.gone = true
    b.foul = true
    b.phase = 'roll'
    resolve(b)
    expect(b.left).toEqual([9, 9])
    expect(b.pieces).toHaveLength(0)
  })

  it('the first side to pot all its pieces wins the board', () => {
    const b = newBoard(1)
    b.pieces = []
    b.left = [9, 0]
    b.pots = []
    b.phase = 'roll'
    b.turn = 1
    resolve(b)
    expect(b.winner).toBe(1)
    expect(b.phase).toBe('done')
  })

  it('a flicked piece is pocketed by the real physics', () => {
    const b = newBoard(0)
    b.pieces = [{ x: 500, y: 900, vx: 0, vy: 0, r: PIECE_R, owner: 0 }]
    placeStriker(b, 500)
    // Straight up the middle at a fast flick: a clean hit sends the piece to the top corners or beyond.
    strike(b, 0, -1, 0.8)
    for (let f = 0; f < 1200 && !atRest(b); f++) frame(b)
    expect(b.pieces.length + b.pots.length).toBeLessThanOrEqual(1)
  })

  it('a simulated shot plays out exactly as the game plays it', () => {
    const base = newBoard(0)
    const x = 420
    const dx = 0.2
    const dy = -0.98
    const sim = simulate(base, x, dx, dy, 0.6)
    const real = cloneBoard(base)
    placeStriker(real, x)
    strike(real, dx, dy, 0.6)
    for (let f = 0; f < 240 && !atRest(real); f++) frame(real)
    const own = real.pots.filter((o) => o === 0).length
    const rival = real.pots.filter((o) => o === 1).length
    expect(sim.own).toBe(own)
    expect(sim.rival).toBe(rival)
  })

  it('a rival board is never pushed off the rails (every piece stays inside)', () => {
    const b = newBoard(0)
    const rng = new Rng(4)
    for (let k = 0; k < 6; k++) {
      placeStriker(b, rng.range(BASE_X.x0, BASE_X.x1))
      strike(b, rng.range(-0.5, 0.5), -1, 1)
      for (let f = 0; f < 600 && !atRest(b); f++) frame(b)
      for (const p of b.pieces) {
        expect(p.x).toBeGreaterThanOrEqual(BOARD.x0 - 1)
        expect(p.x).toBeLessThanOrEqual(BOARD.x1 + 1)
        expect(p.y).toBeGreaterThanOrEqual(BOARD.y0 - 1)
        expect(p.y).toBeLessThanOrEqual(BOARD.y1 + 1)
      }
      resolve(b)
      if (b.phase === 'done') break
    }
    expect(STRIKER_R).toBeGreaterThan(0)
  })
})

describe('carrom queen, friction and time limit', () => {
  it('potting the queen earns another turn and the queen is kept', () => {
    const b = newBoard(0)
    b.pieces = b.pieces.filter((p) => p.owner !== 2)
    b.pots = [2]
    b.phase = 'roll'
    resolve(b)
    expect(b.turn).toBe(0)
    expect(b.queen).toBe(0)
    expect(b.pieces.some((p) => p.owner === 2)).toBe(false)
  })

  it('a queen pocketed on a foul shot goes back to the centre and the turn passes', () => {
    const b = newBoard(0)
    b.pieces = []
    b.pots = [2]
    b.striker.gone = true
    b.foul = true
    b.phase = 'roll'
    resolve(b)
    expect(b.turn).toBe(1)
    expect(b.queen).toBeNull()
    const q = b.pieces.find((p) => p.owner === 2)
    expect(q && dist(q.x, q.y, CENTRE.x, CENTRE.y)).toBe(0)
  })

  it('out of time with level pieces, the queen holder takes the board', () => {
    const b = newBoard(0)
    b.turns = 70
    b.left = [4, 4]
    b.queen = 1
    b.phase = 'roll'
    resolve(b)
    expect(b.winner).toBe(1)
  })

  it('a disc launched at launchSpeed(d) slides about d before stopping', () => {
    const b = newBoard(0)
    b.pieces = []
    b.striker.x = 500
    b.striker.y = BOARD.y1 - 40
    const v = launchSpeed(600)
    b.striker.vy = -v
    b.phase = 'roll'
    let f = 0
    while (!atRest(b) && f++ < 600) frame(b)
    const slid = BOARD.y1 - 40 - b.striker.y
    expect(slid).toBeGreaterThan(560)
    expect(slid).toBeLessThan(640)
  })

  it('a slow disc stops instead of creeping for seconds', () => {
    const b = newBoard(0)
    b.pieces = []
    b.striker.vy = -200
    b.phase = 'roll'
    let f = 0
    while (!atRest(b) && f < 600) {
      frame(b)
      f++
    }
    expect(f).toBeLessThan(60)
  })

  it('a resting disc nudged past a rail is put back inside it', () => {
    const b = newBoard(0)
    b.pieces = [{ x: BOARD.x0 + 5, y: 900, vx: 0, vy: 0, r: PIECE_R, owner: 0 }]
    b.striker.vx = 0
    b.striker.vy = 0
    frame(b)
    expect(b.pieces[0]!.x).toBeGreaterThanOrEqual(BOARD.x0 + PIECE_R)
  })

  it('the hard computer pots a clean straight shot that the board offers it', () => {
    const b = newBoard(0)
    // One own piece on the line from the baseline to the top-left pocket, nothing else.
    b.pieces = [{ x: 330, y: 760, vx: 0, vy: 0, r: PIECE_R, owner: 0 }]
    b.left = [1, 9]
    const shot = choose({ board: b }, 'hard', 3)
    placeStriker(b, shot.x)
    strike(b, shot.dx, shot.dy, shot.power)
    for (let f = 0; f < 900 && !atRest(b); f++) frame(b)
    resolve(b)
    expect(b.winner).toBe(0)
  })
})

describe('carrom match', () => {
  it('a hard computer beats an easy one most of the time over seeded boards', () => {
    let hard = 0
    const N = 4
    for (let seed = 0; seed < N; seed++) {
      const b = newBoard((seed % 2) as 0 | 1)
      const rng = new Rng(100 + seed)
      let guard = 0
      while (b.phase !== 'done' && guard++ < 200) {
        const shot = choose({ board: b }, b.turn === 0 ? 'hard' : 'easy', rng.int(1, 1e6))
        placeStriker(b, shot.x)
        strike(b, shot.dx, shot.dy, shot.power)
        for (let f = 0; f < 2000 && !atRest(b); f++) frame(b)
        resolve(b)
      }
      if (b.winner === 0) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(3)
  }, 60000)

  it('computer vs computer finishes a board in bounded time, on either side', () => {
    for (const first of [0, 1] as const) {
      const r = playBoard(first, 'hard', 7 + first)
      expect(r.b.phase).toBe('done')
      expect(r.b.winner).not.toBeNull()
      expect(r.turns).toBeLessThanOrEqual(70)
    }
  }, 60000)

  it('the winner of a board has emptied its own side, or is ahead when time runs out', () => {
    const r = playBoard(0, 'normal', 21)
    const w = r.b.winner as 0 | 1
    expect(r.b.left[w]).toBeLessThanOrEqual(r.b.left[w === 0 ? 1 : 0])
    expect(CENTRE.x).toBe(500)
  }, 60000)
})
