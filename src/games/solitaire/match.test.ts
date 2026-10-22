import { describe, expect, it } from 'vitest'
import type { GameContext } from '../../core/game.ts'
import { PlayerInput } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import { toWorld } from '../../engines/puzzle/index.ts'
import { halfFrame } from '../../engines/runner/frame.ts'
import game, { match, type State } from './index.ts'
import { keyOf, keyPos, tableView } from './render.ts'
import { destinationFor } from './rules.ts'

/** Effects and sound do nothing. Sides run as bots (or stay idle) on hard, so the races play themselves out. */
function ctx(target: number | undefined, bots: [boolean, boolean]): GameContext {
  const sink = new Proxy({}, { get: () => () => {} })
  return {
    stage: sink,
    input: { player: () => ({ downs: [], ups: [], held: new Map() }) },
    fx: sink,
    audio: sink,
    rng: new Rng(5),
    mode: '2p',
    difficulty: 'hard',
    bots,
    teams: false,
    names: ['Red', 'Blue'],
    local: 0,
    seed: 17,
    target,
  } as never
}

describe('solitaire match length', () => {
  it('declares one race as the default, first to five at most', () => {
    expect(match).toEqual({ unit: 'wins', default: 1, min: 1, max: 5 })
  })

  it('gives each race to the side ahead on the clock, until the chosen number of wins', () => {
    // Red's bot clears some cards and blue never taps: every race is decided on the four-minute clock.
    const g = game()
    g.init(ctx(2, [true, false]))
    for (let i = 0; i < 60 * 700 && !g.result; i++) g.update(1 / 60)
    expect(g.result?.winner).toBe(0)
    expect(g.result?.score).toEqual([2, 0])
    expect((g.snapshot() as { s: { round: number } }).s.round).toBe(1)
  })
})

/** A game with real per-side inputs, so presses, drags and releases can be scripted. */
function live(bots: [boolean, boolean] = [false, false]) {
  const players = [new PlayerInput(0), new PlayerInput(1)]
  const c = { ...ctx(undefined, bots), input: { player: (s: 0 | 1) => players[s] } } as never
  const g = game()
  g.init(c)
  const s = () => (g.snapshot() as { s: State }).s
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      g.update(1 / 60)
      for (const p of players) p.endStep()
    }
  }
  return { g, s, tick, red: players[0] as PlayerInput }
}

/** World point of a table-unit point on red's half (local 2P: red's frame is upright). */
function redWorld(x: number, y: number): { x: number; y: number } {
  const f = halfFrame(0, '2p')
  const tv = tableView(f.w, f.h)
  return toWorld(f, tv.tx + x * tv.k, tv.ty + y * tv.k)
}

describe('solitaire touch', () => {
  it('moves a tapped card on release, to its best place', () => {
    const { s, tick, red } = live()
    const b = s().boards[0]
    const col = b.tab.findIndex((cards, c) => {
      const src = { from: 'tab' as const, col: c, idx: cards.length - 1 }
      return destinationFor(b, src) !== null
    })
    if (col < 0) return // this deal has no opening move: nothing to test
    const idx = (b.tab[col]?.length ?? 1) - 1
    const p = keyPos(900, b, keyOf(col, idx))
    const w = redWorld(p.x + 60, p.y + 120)
    red.press(1, w.x, w.y)
    tick()
    // Held: picked up, not moved yet.
    expect(s().boards[0].drag).not.toBeNull()
    expect(s().boards[0].tab[col]).toHaveLength(idx + 1)
    red.release(1)
    tick()
    expect(s().boards[0].drag).toBeNull()
    expect(s().boards[0].tab[col]).toHaveLength(idx)
  })

  it('drops a dragged card where it is let go, and puts it back on an illegal spot', () => {
    const { s, tick, red, g } = live()
    // A known table: 5♥ on column 0, black sixes on columns 1 and 2, an empty column 3.
    const st = s()
    const b = st.boards[0]
    b.tab = [[17], [5], [44], [], [], [], []]
    b.down = [0, 0, 0, 0, 0, 0, 0]
    b.stock = [25]
    b.waste = []
    b.found = [0, 0, 0, 0]
    g.restore(g.snapshot())
    const from = keyPos(900, b, keyOf(0, 0))
    const grab = redWorld(from.x + 60, from.y + 120)
    // Drag it onto column 2 (the 6♣), not the first fit.
    red.press(1, grab.x, grab.y)
    tick()
    const to = keyPos(900, b, keyOf(2, 0))
    for (let i = 1; i <= 6; i++) {
      const w = redWorld(from.x + 60 + ((to.x - from.x) * i) / 6, from.y + 120 + 40)
      red.move(1, w.x, w.y)
      tick()
    }
    red.release(1)
    tick()
    expect(s().boards[0].tab[2]).toEqual([44, 17])
    expect(s().boards[0].tab[0]).toEqual([])
    // Now drag the 5♥ onto the empty column 3: illegal, it goes back.
    tick(30)
    const at = keyPos(900, s().boards[0], keyOf(2, 1))
    const g2 = redWorld(at.x + 60, at.y + 100)
    red.press(2, g2.x, g2.y)
    tick()
    const empty = keyPos(900, s().boards[0], keyOf(3, 0))
    for (let i = 1; i <= 4; i++) {
      const w = redWorld(at.x + 60 + ((empty.x - at.x) * i) / 4, at.y + 100)
      red.move(2, w.x, w.y)
      tick(2)
    }
    red.release(2)
    tick()
    expect(s().boards[0].tab[2]).toEqual([44, 17])
    expect(s().boards[0].tab[3]).toEqual([])
  })
})

describe('solitaire dead ends in a race', () => {
  it('ends the race when both players are out of moves: most cards home wins', () => {
    const { g, s, tick } = live()
    const st = s()
    st.boards[0].stuck = true
    st.boards[1].stuck = true
    st.boards[0].found = [3, 0, 0, 0]
    st.boards[1].found = [5, 0, 0, 0]
    tick()
    expect(g.result).toBeNull()
    tick(120)
    expect(g.result?.winner).toBe(1)
  })

  it('gives the race to the side still playing once it has more cards home', () => {
    const { g, s, tick } = live()
    const st = s()
    st.boards[0].stuck = true
    st.boards[0].found = [2, 0, 0, 0]
    st.boards[1].found = [2, 0, 0, 0]
    tick(120)
    expect(g.result).toBeNull()
    st.boards[1].found = [3, 0, 0, 0]
    tick(120)
    expect(g.result?.winner).toBe(1)
  })

  it('calls a tie when both are stuck with as many cards home', () => {
    const { g, s, tick } = live()
    const st = s()
    st.boards[0].stuck = st.boards[1].stuck = true
    tick(120)
    expect(g.result?.winner).toBe('draw')
  })
})
