import { describe, expect, it } from 'vitest'
import { STEP, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { TongueBot } from './bot.ts'
import {
  FIELD,
  FLICK_MAX,
  flickSpeed,
  FLY_COUNT,
  FRENZY_EXTRA,
  OUT_SPEED,
  GAME_TIME,
  HOLD,
  MIN_REACH,
  POINTS,
  QUEUE_TIME,
  REACH,
  reelIn,
  fire,
  frogNew,
  mouth,
  stepWorld,
  timeLeft,
  tipOf,
  winnerOf,
  worldNew,
  type FieldEvent,
  type Fly,
  type World,
} from './rules.ts'

/** A fly that does not move (its heading never changes). */
function still(id: number, x: number, y: number, golden = false): Fly {
  return { id, x, y, vx: 0, vy: 0, golden, turn: 1e9, held: -1 }
}

/** A world with only the given flies on the field and no spawning. */
function table(flies: Fly[], seed = 1): World {
  const w = worldNew(new Rng(seed))
  w.flies = flies
  w.nextId = 100
  w.spawn = 1e9
  return w
}

/** Step until `done` or a time limit; collects events. */
function run(w: World, rng: Rng, from: number, limit: number, done: () => boolean) {
  const events: FieldEvent[] = []
  let t = from
  while (!done() && t < from + limit) {
    t += STEP
    events.push(...stepWorld(w, STEP, rng, t))
  }
  return { t, events }
}

describe('sticky tongues: flicks and the frenzy', () => {
  it('a harder flick sends a faster tongue, within bounds', () => {
    expect(flickSpeed(0)).toBeLessThan(OUT_SPEED)
    expect(flickSpeed(1500)).toBeGreaterThan(flickSpeed(500))
    expect(flickSpeed(99999)).toBe(FLICK_MAX)
    const f = frogNew()
    fire(f, 0, 500, 1000, 0, flickSpeed(99999))
    expect(f.tongue.speed).toBe(FLICK_MAX)
  })

  it('a fast tongue gets there first', () => {
    const w = table([still(1, 500, 900)])
    fire(w.frogs[0], 0, 500, 1000, 0, FLICK_MAX)
    fire(w.frogs[1], 1, 500, 1100, 0, OUT_SPEED * 0.85)
    run(w, new Rng(3), 0, 3, () => w.frogs[0].score + w.frogs[1].score > 0)
    expect(w.frogs[0].score).toBe(POINTS.plain)
  })

  it('the frenzy fills the field with more flies, more of them golden', () => {
    const w = worldNew(new Rng(5))
    let golden = 0
    let spawned = 0
    const seen = new Set(w.flies.map((f) => f.id))
    for (let t = 0; t < 30; t += STEP) {
      // Keep eating flies so new ones keep coming.
      if (w.flies.length > FLY_COUNT) w.flies.shift()
      stepWorld(w, STEP, new Rng(Math.round(t * 600)), t, true)
      for (const f of w.flies)
        if (!seen.has(f.id)) {
          seen.add(f.id)
          spawned++
          if (f.golden) golden++
        }
    }
    expect(spawned).toBeGreaterThan(30)
    expect(golden / spawned).toBeGreaterThan(0.2)
    const full = worldNew(new Rng(6))
    for (let t = 0; t < 5; t += STEP) stepWorld(full, STEP, new Rng(9), t, true)
    expect(full.flies.length).toBe(FLY_COUNT + FRENZY_EXTRA)
  })
})

describe('sticky tongues: firing', () => {
  it('shoots toward the aim point and caps the reach', () => {
    const f = frogNew()
    expect(fire(f, 0, 500, 600, 1)).toBe(true)
    expect(f.tongue.phase).toBe('out')
    expect(f.tongue.dy).toBeLessThan(0)
    expect(f.tongue.reach).toBe(REACH)
    expect(f.shotAt).toBe(1)
  })

  it('a short tap only aims: the tongue still stretches to full length', () => {
    const f = frogNew()
    const m = mouth(0)
    expect(fire(f, 0, m.x, m.y - 200, 0)).toBe(true)
    expect(f.tongue.reach).toBe(REACH)
  })

  it('ignores a second shot while the tongue is busy', () => {
    const f = frogNew()
    expect(fire(f, 0, 500, 900, 0)).toBe(true)
    expect(fire(f, 0, 300, 1000, 0.1)).toBe(false)
  })

  it('ignores a tap too close to the mouth to be a shot', () => {
    const f = frogNew()
    const m = mouth(0)
    expect(fire(f, 0, m.x, m.y - MIN_REACH + 10, 0)).toBe(false)
    expect(f.tongue.phase).toBe('idle')
  })

  it('blue shoots downward from the top of the table', () => {
    const f = frogNew()
    fire(f, 1, 500, 1200, 0)
    expect(f.tongue.dy).toBeGreaterThan(0)
  })
})

describe('sticky tongues: catching', () => {
  it('catches a fly on its path for one point and eats it on the way home', () => {
    const w = table([still(1, 500, 1300)])
    fire(w.frogs[0], 0, 500, 1000, 0)
    const { events } = run(w, new Rng(2), 0, 5, () => w.frogs[0].tongue.phase === 'idle')
    expect(w.frogs[0].score).toBe(POINTS.plain)
    expect(w.frogs[0].caught).toBe(1)
    expect(events.some((e) => e.kind === 'catch' && e.side === 0 && !e.golden)).toBe(true)
    expect(events.some((e) => e.kind === 'eat')).toBe(true)
    expect(events.some((e) => e.kind === 'miss')).toBe(false)
    expect(w.flies.some((f) => f.id === 1)).toBe(false)
  })

  it('a golden fly is worth three', () => {
    const w = table([still(1, 500, 1300, true)])
    fire(w.frogs[0], 0, 500, 1000, 0)
    run(w, new Rng(2), 0, 5, () => w.frogs[0].tongue.phase === 'idle')
    expect(w.frogs[0].score).toBe(POINTS.golden)
  })

  it('a fly held by one tongue cannot be taken by the other', () => {
    const w = table([still(1, 500, 1300)])
    const rng = new Rng(2)
    fire(w.frogs[0], 0, 500, 1000, 0)
    run(w, rng, 0, 0.5, () => w.frogs[0].tongue.fly >= 0)
    expect(w.frogs[0].tongue.fly).toBe(1)
    // Blue's tongue sweeps the same column while red still carries the fly home.
    fire(w.frogs[1], 1, 500, 1100, 1)
    run(w, rng, 1, 5, () => w.frogs[1].tongue.phase === 'idle')
    expect(w.frogs[1].score).toBe(0)
    expect(w.frogs[0].score).toBe(POINTS.plain)
  })

  it('both tips on the same fly in the same step: the nearer one has it, not always red', () => {
    // A fly right on the midline, a touch nearer blue's mouth.
    const w = table([still(1, 500, 895)])
    fire(w.frogs[0], 0, 500, 1000, 0)
    fire(w.frogs[1], 1, 500, 1100, 0)
    run(w, new Rng(3), 0, 3, () => w.frogs[0].score + w.frogs[1].score > 0)
    expect(w.frogs[1].score).toBe(POINTS.plain)
    expect(w.frogs[0].score).toBe(0)
  })

  it('steals a free fly from the other half of the table', () => {
    const w = table([still(1, 500, 1000)])
    fire(w.frogs[1], 1, 500, 1100, 0)
    run(w, new Rng(3), 0, 5, () => w.frogs[1].tongue.phase === 'idle')
    expect(w.frogs[1].score).toBe(POINTS.plain)
    expect(w.frogs[0].score).toBe(0)
  })

  it('a miss goes out, holds, comes home empty', () => {
    const w = table([still(1, 700, 700)])
    fire(w.frogs[0], 0, 500, 1000, 0)
    const { events } = run(w, new Rng(4), 0, 5, () => w.frogs[0].tongue.phase === 'idle')
    expect(w.frogs[0].score).toBe(0)
    expect(events.filter((e) => e.kind === 'miss')).toHaveLength(1)
    expect(w.flies.some((f) => f.id === 1)).toBe(true)
  })

  it('holds at full stretch before retracting', () => {
    const w = table([])
    const rng = new Rng(5)
    fire(w.frogs[0], 0, 500, 600, 0)
    let t = 0
    while (w.frogs[0].tongue.phase !== 'hold') {
      t += STEP
      stepWorld(w, STEP, rng, t)
    }
    expect(tipOf(0, w.frogs[0].tongue).y).toBeCloseTo(mouth(0).y - REACH, 0)
    const hold = w.frogs[0].tongue.hold
    expect(hold).toBeCloseTo(HOLD, 5)
    run(w, rng, t, 1, () => w.frogs[0].tongue.phase === 'back')
    expect(w.frogs[0].tongue.phase).toBe('back')
  })
})

describe('sticky tongues: queue and field', () => {
  it('fires a tap that arrived while the tongue was coming home', () => {
    const w = table([])
    const f = w.frogs[0]
    const rng = new Rng(6)
    fire(f, 0, 500, 1200, 0)
    let t = 0
    while (f.tongue.phase !== 'back') {
      t += STEP
      stepWorld(w, STEP, rng, t)
    }
    f.queue = { x: 500, y: 1200, t }
    run(w, rng, t, 2, () => f.tongue.phase === 'idle')
    stepWorld(w, STEP, rng, t + 2 * STEP)
    expect(f.tongue.phase).toBe('out')
    expect(f.queue).toBeNull()
  })

  it('drops a stale tap', () => {
    const w = table([])
    w.frogs[0].queue = { x: 500, y: 1100, t: 0 }
    stepWorld(w, STEP, new Rng(7), QUEUE_TIME + 0.5)
    expect(w.frogs[0].queue).toBeNull()
    expect(w.frogs[0].tongue.phase).toBe('idle')
  })

  it('keeps free flies inside the band and the field full', () => {
    const rng = new Rng(8)
    const w = worldNew(rng)
    let t = 0
    for (let i = 0; i < 60 * 60; i++) {
      t += STEP
      stepWorld(w, STEP, rng, t)
      for (const f of w.flies) {
        if (f.held >= 0) continue
        expect(f.x).toBeGreaterThanOrEqual(FIELD.x0 - 1e-6)
        expect(f.x).toBeLessThanOrEqual(FIELD.x1 + 1e-6)
        expect(f.y).toBeGreaterThanOrEqual(FIELD.y0 - 1e-6)
        expect(f.y).toBeLessThanOrEqual(FIELD.y1 + 1e-6)
      }
    }
    expect(w.flies).toHaveLength(FLY_COUNT)
  })

  it('a fresh world starts with a full field and empty frogs', () => {
    const w = worldNew(new Rng(9))
    expect(w.flies).toHaveLength(FLY_COUNT)
    expect(w.frogs.map((f) => f.score)).toEqual([0, 0])
  })
})

describe('sticky tongues: result', () => {
  it('the most points wins, a tie is a draw', () => {
    const w = worldNew(new Rng(10))
    w.frogs[0].score = 9
    w.frogs[1].score = 4
    expect(winnerOf(w)).toBe(0)
    w.frogs[1].score = 9
    expect(winnerOf(w)).toBe('draw')
    w.frogs[1].score = 12
    expect(winnerOf(w)).toBe(1 as Side)
  })
})

/** A whole match, bot against bot, on the real clock. */
function botMatch(seed: number, red: 'easy' | 'normal' | 'hard', blue: 'easy' | 'normal' | 'hard') {
  const rng = new Rng(seed)
  const w = worldNew(rng)
  const bots = [new TongueBot(rng.fork(), red, 0), new TongueBot(rng.fork(), blue, 1)] as const
  let t = 0
  let steps = 0
  while (t < GAME_TIME) {
    t += STEP
    steps++
    for (const side of [0, 1] as Side[]) {
      const aim = bots[side].step(t, w)
      if (aim) w.frogs[side].queue = { x: aim.x, y: aim.y, t }
    }
    stepWorld(w, STEP, rng, t)
  }
  return { w, steps }
}

describe('sticky tongues: bots', () => {
  it('a bot aims at a reachable fly', () => {
    const rng = new Rng(11)
    const w = table([still(1, 500, 1100)])
    const bot = new TongueBot(rng, 'hard', 0)
    let aim: { x: number; y: number } | null = null
    let t = 0
    while (!aim && t < 5) {
      t += STEP
      aim = bot.step(t, w)
    }
    expect(aim).not.toBeNull()
    expect(Math.hypot((aim?.x ?? 0) - 500, (aim?.y ?? 0) - 1100)).toBeLessThan(60)
  })

  it('a bot with nothing in reach stays quiet', () => {
    const rng = new Rng(12)
    const w = table([still(1, 500, 150)])
    const bot = new TongueBot(rng, 'normal', 0)
    let aims = 0
    for (let t = STEP; t < 6; t += STEP) if (bot.step(t, w)) aims++
    expect(aims).toBe(0)
  })

  it('bot vs bot reaches a result within the game clock, both sides scoring', () => {
    for (let seed = 0; seed < 6; seed++) {
      const { w, steps } = botMatch(seed, 'normal', 'normal')
      expect(steps).toBeLessThanOrEqual(Math.ceil(GAME_TIME / STEP) + 1)
      expect(w.frogs[0].score + w.frogs[1].score).toBeGreaterThan(0)
      expect(['draw', 0, 1]).toContain(winnerOf(w))
    }
  })

  it('a hard bot out-flies an easy bot most of the time', () => {
    let hard = 0
    const games = 12
    for (let seed = 0; seed < games; seed++) {
      const { w } = botMatch(100 + seed, 'hard', 'easy')
      if (winnerOf(w) === 0) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(Math.ceil(games * 0.6))
  })
})

describe('sticky tongues: match length', () => {
  it('the clock counts down from the chosen length', () => {
    expect(timeLeft(10, 60)).toBe(50)
    expect(timeLeft(10)).toBe(GAME_TIME - 10)
    expect(timeLeft(90, 60)).toBe(0)
  })
})

describe('sticky tongues: buzzer', () => {
  it('reels a tongue home after time and swallows what it holds', () => {
    const w = table([still(1, 500, 1300)])
    const rng = new Rng(13)
    fire(w.frogs[0], 0, 500, 1000, 0)
    run(w, rng, 0, 1, () => w.frogs[0].tongue.fly >= 0)
    for (let i = 0; i < 120; i++) reelIn(w, STEP)
    expect(w.frogs[0].tongue.phase).toBe('idle')
    expect(w.flies).toHaveLength(0)
    expect(w.frogs[0].score).toBe(POINTS.plain)
  })
})
