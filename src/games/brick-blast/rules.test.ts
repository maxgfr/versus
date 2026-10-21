import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { H, MID, W } from '../../core/stage.ts'
import { decide, newMemory, TUNING } from './bot.ts'
import {
  BALL_R,
  type Cmd,
  COLS,
  JUNK_EVERY,
  LIVES,
  type Match,
  newBoard,
  newMatch,
  PADDLE_Y,
  predictX,
  remaining,
  serveBall,
  START_ROWS,
  step,
  stepBoard,
  winner,
} from './rules.ts'
import type { Difficulty } from '../../core/game.ts'

const idle: Cmd = { x: null, launch: false }

/** Run the match with two bots until it is decided (or a step cap). */
function botMatch(
  a: Difficulty,
  b: Difficulty,
  seed: number,
  limit = 90,
): { m: Match; steps: number } {
  const rng = new Rng(seed)
  const m = newMatch(limit)
  const mem = [newMemory(), newMemory()]
  let steps = 0
  while (winner(m) === null && steps < 60 * 200) {
    const c0 = decide(m.boards[0], a, rng, mem[0] as ReturnType<typeof newMemory>, STEP)
    const c1 = decide(m.boards[1], b, rng, mem[1] as ReturnType<typeof newMemory>, STEP)
    step(m, STEP, [c0, c1], rng)
    steps++
  }
  return { m, steps }
}

describe('brick blast rules', () => {
  it('starts with a full wall, three lives and a ball stuck to the paddle', () => {
    const b = newBoard()
    expect(b.bricks).toHaveLength(START_ROWS * COLS)
    expect(remaining(b)).toBe(START_ROWS * COLS)
    expect(b.lives).toBe(LIVES)
    expect(b.ball.stuck).toBe(true)
    expect(b.ball.y).toBeLessThan(PADDLE_Y)
  })

  it('launches on a tap and on the auto timer', () => {
    const rng = new Rng(1)
    const tapped = newBoard()
    stepBoard(tapped, 0, STEP, { x: null, launch: true }, rng, [])
    expect(tapped.ball.stuck).toBe(false)
    expect(tapped.ball.vy).toBeLessThan(0)

    const waiting = newBoard()
    const out: unknown[] = []
    for (let i = 0; i < 60 * 2; i++) stepBoard(waiting, 0, STEP, idle, rng, out as never[])
    expect(waiting.ball.stuck).toBe(false)
  })

  it('bounces the ball off the midline wall, never across it', () => {
    const b = newBoard()
    b.ball = { x: 500, y: MID + 40, vx: 0, vy: -900, speed: 900, stuck: false }
    const rng = new Rng(2)
    for (let i = 0; i < 30; i++) stepBoard(b, 0, STEP, idle, rng, [])
    expect(b.ball.y).toBeGreaterThanOrEqual(MID + BALL_R - 1e-6)
    expect(b.ball.vy).toBeGreaterThan(0)
  })

  it('a lost ball costs one life and is served again from the paddle', () => {
    const b = newBoard()
    b.ball = { x: 100, y: H + BALL_R - 2, vx: 0, vy: 900, speed: 900, stuck: false }
    const out: { kind: string }[] = []
    stepBoard(b, 0, STEP, idle, new Rng(3), out as never[])
    expect(b.lives).toBe(LIVES - 1)
    expect(b.ball.stuck).toBe(true)
    expect(out.some((e) => e.kind === 'lost')).toBe(true)
  })

  it('breaking a normal brick sends one junk brick to the rival', () => {
    const m = newMatch(90)
    // Red's ball rises into the bottom row of its wall.
    m.boards[0].ball = { x: 500, y: 1330, vx: 0, vy: -200, speed: 900, stuck: false }
    const rng = new Rng(4)
    let sentTotal = 0
    for (let i = 0; i < 60 * 3 && sentTotal === 0; i++) {
      const evs = step(m, STEP, [idle, idle], rng)
      sentTotal += evs.filter((e) => e.kind === 'brick' && e.sent).length
    }
    expect(sentTotal).toBeGreaterThan(0)
    const rivalJunk = m.boards[1].queue + m.boards[1].bricks.filter((b) => b.junk).length
    expect(rivalJunk).toBe(sentTotal)
    expect(m.boards[0].bricks.filter((b) => b.junk)).toHaveLength(0)
  })

  it('junk drops into a free cell of the wall, one per JUNK_EVERY', () => {
    const m = newMatch(90)
    m.boards[1].queue = 3
    const rng = new Rng(5)
    const drops: number[] = []
    let t = 0
    while (m.boards[1].queue > 0 && t < 10) {
      const evs = step(m, STEP, [idle, idle], rng)
      for (const e of evs) if (e.kind === 'junk' && e.side === 1) drops.push(m.t)
      t += STEP
    }
    expect(drops).toHaveLength(3)
    expect(drops[1]! - drops[0]!).toBeGreaterThanOrEqual(JUNK_EVERY - STEP)
    expect(m.boards[1].bricks.filter((b) => b.junk)).toHaveLength(3)
  })

  it('a wall cleared with no junk pending wins', () => {
    const m = newMatch(90)
    m.boards[0].bricks = []
    expect(winner(m)).toBe(0)
  })

  it('a wall still owed junk is not cleared', () => {
    const m = newMatch(90)
    m.boards[0].bricks = []
    m.boards[0].queue = 1
    expect(winner(m)).toBeNull()
  })

  it('losing all lives loses the match', () => {
    const m = newMatch(90)
    m.boards[0].lives = 0
    expect(winner(m)).toBe(1)
    m.boards[1].lives = 0
    expect(winner(m)).toBe('draw')
  })

  it('at the time limit the player with more broken bricks wins', () => {
    const m = newMatch(90)
    m.t = 90
    m.boards[0].broken = 4
    m.boards[1].broken = 9
    expect(winner(m)).toBe(1)
    m.boards[0].broken = 9
    expect(winner(m)).toBe('draw')
  })

  it('the chosen match length replaces the default', () => {
    const m = newMatch(45)
    m.t = 44
    expect(winner(m)).toBeNull()
    m.t = 45
    expect(winner(m)).toBe('draw')
  })

  it('predicts the landing x across side-wall bounces', () => {
    const x = predictX(500, 1000, 800, 800, PADDLE_Y)
    expect(x).not.toBeNull()
    expect(x as number).toBeGreaterThanOrEqual(BALL_R)
    expect(x as number).toBeLessThanOrEqual(W - BALL_R)
    expect(predictX(500, 1000, 0, -500, PADDLE_Y)).toBeNull()
  })

  it('serveBall sits on the paddle', () => {
    const b = serveBall(300)
    expect(b.stuck).toBe(true)
    expect(b.x).toBe(300)
  })
})

describe('brick blast bots', () => {
  it('bot vs bot reaches a result within the time limit', () => {
    const { m, steps } = botMatch('hard', 'normal', 7)
    expect(winner(m)).not.toBeNull()
    expect(steps).toBeLessThanOrEqual(60 * 90 + 2)
  })

  it('bot vs bot finishes on a short match too', () => {
    const { m } = botMatch('normal', 'easy', 11, 30)
    expect(winner(m)).not.toBeNull()
  })

  it('the harder bot usually wins', () => {
    let hard = 0
    let easy = 0
    for (let s = 1; s <= 20; s++) {
      const w = winner(botMatch('hard', 'easy', s).m)
      if (w === 0) hard++
      else if (w === 1) easy++
    }
    expect(hard).toBeGreaterThan(easy)
  })

  it('the bot can play blue as well as red', () => {
    const rng = new Rng(9)
    const b = newBoard()
    b.ball = { x: 300, y: 1000, vx: 0, vy: 700, speed: 800, stuck: false }
    const cmd = decide(b, 'normal', rng, newMemory(), STEP)
    expect(cmd.x).not.toBeNull()
    expect(TUNING.normal.speed).toBeGreaterThan(0)
  })
})
