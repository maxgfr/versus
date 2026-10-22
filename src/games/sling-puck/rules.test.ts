import { describe, expect, it } from 'vitest'
import { STEP, type Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { H, MID, W } from '../../core/stage.ts'
import { decide, laneScore, newMemory, planRelease } from './bot.ts'
import {
  applyCmd,
  type Event,
  fire,
  GAP,
  GAP_WIDE,
  gapAt,
  grabIndex,
  HOLD,
  RAMP_END,
  RAMP_START,
  BAND_Y,
  MAX_PULL,
  newTable,
  shotFrom,
  stretchAt,
  owned,
  releaseAim,
  SAFETY_TIME,
  startAim,
  step,
  type Table,
  winner,
  moveAim,
} from './rules.ts'

/** Run two bots until one side has no pucks (or a step cap). */
function botMatch(a: Difficulty, b: Difficulty, seed: number, n = 5): { t: Table; steps: number } {
  const rng = new Rng(seed)
  const t = newTable(n, rng)
  const mem = [newMemory(), newMemory()]
  let steps = 0
  while (winner(t) === null && steps < 60 * 400) {
    const events: Event[] = []
    applyCmd(t, 0, decide(t, 0, a, rng, mem[0] as ReturnType<typeof newMemory>, STEP), events, STEP)
    applyCmd(t, 1, decide(t, 1, b, rng, mem[1] as ReturnType<typeof newMemory>, STEP), events, STEP)
    step(t, STEP, events)
    steps++
  }
  return { t, steps }
}

describe('sling puck rules', () => {
  it('deals the same number of pucks to each half, on its own side', () => {
    const t = newTable(5, new Rng(1))
    expect(t.pucks).toHaveLength(10)
    expect(owned(t, 0)).toBe(5)
    expect(owned(t, 1)).toBe(5)
    for (const p of t.pucks) {
      if (p.half === 0) expect(p.y).toBeGreaterThan(MID)
      else expect(p.y).toBeLessThan(MID)
    }
  })

  it('only grabs a puck on the grabbing side, within reach', () => {
    const t = newTable(3)
    const red = t.pucks.find((p) => p.half === 0)
    const blue = t.pucks.find((p) => p.half === 1)
    expect(red && blue).toBeTruthy()
    const idxRed = t.pucks.indexOf(red!)
    expect(grabIndex(t, 0, red!.x, red!.y)).toBe(idxRed)
    expect(grabIndex(t, 1, red!.x, red!.y)).toBe(-1)
    expect(grabIndex(t, 0, red!.x + 400, red!.y)).toBe(-1)
  })

  it('letting go without stretching the band just sets the puck down', () => {
    const t = newTable(3)
    const ev: Event[] = []
    const idx = grabIndex(t, 0, t.pucks[0]!.x, t.pucks[0]!.y)
    startAim(t, 0, idx, 7, ev)
    const p = t.pucks[idx]!
    moveAim(t, 0, p.x + 40, p.y + 30)
    const x = p.x
    releaseAim(t, 0, ev)
    expect(ev.some((e) => e.kind === 'shot')).toBe(false)
    expect(p.x).toBe(x)
    expect(p.vx).toBe(0)
    expect(p.vy).toBe(0)
    expect(t.aims[0]).toBeNull()
    expect(stretchAt(p.y)).toBe(0)
  })

  it('a full stretch of the band fires straight ahead at full power', () => {
    const t = newTable(3)
    const ev: Event[] = []
    const idx = 0
    const puck = t.pucks[idx]!
    expect(puck.half).toBe(0)
    startAim(t, 0, idx, 1, ev)
    moveAim(t, 0, W / 2, BAND_Y + MAX_PULL * 3) // dragged far back behind the band
    expect(stretchAt(puck.y)).toBeCloseTo(MAX_PULL)
    releaseAim(t, 0, ev)
    const shot = ev.find((e) => e.kind === 'shot')
    expect(shot && shot.kind === 'shot' && shot.power).toBe(1)
    expect(puck.vy).toBeLessThan(0) // flies toward the gap
    expect(Math.abs(puck.vx)).toBeLessThan(1)
  })

  it('an off-centre stretch angles the shot toward the middle, for blue too', () => {
    const t = newTable(3)
    const ev: Event[] = []
    // Red, pulled at the left of its band: flies up and to the right.
    startAim(t, 0, 0, 1, ev)
    moveAim(t, 0, 200, BAND_Y + 200)
    releaseAim(t, 0, ev)
    expect(t.pucks[0]!.vy).toBeLessThan(0)
    expect(t.pucks[0]!.vx).toBeGreaterThan(0)
    // Blue's band is mirrored: pulled at world right, it flies down and to the left.
    const b = t.pucks.findIndex((p) => p.half === 1)
    startAim(t, 1, b, 2, ev)
    moveAim(t, 1, W - 200, H - BAND_Y - 200)
    releaseAim(t, 1, ev)
    expect(t.pucks[b]!.vy).toBeGreaterThan(0)
    expect(t.pucks[b]!.vx).toBeLessThan(0)
  })

  it('a free puck bounces off the band instead of passing it', () => {
    const t = newTable(1)
    const p = t.pucks[0]!
    p.x = W / 2
    p.y = BAND_Y - 200
    p.vy = 1500
    const ev: Event[] = []
    for (let i = 0; i < 30; i++) step(t, STEP, ev)
    expect(p.y).toBeLessThanOrEqual(BAND_Y - p.r + 1e-6)
    expect(ev.some((e) => e.kind === 'band')).toBe(true)
  })

  it('the bot plans a release spot that aims through the gap', () => {
    for (const tx of [W / 2 - 80, W / 2, W / 2 + 80]) {
      const at = planRelease(tx, 150)
      const s = shotFrom(at.x, at.y)
      const k = (MID - at.y) / s.dy
      expect(Math.abs(at.x + s.dx * k - tx)).toBeLessThan(25)
    }
  })

  it('a shot through the gap moves the puck to the other side', () => {
    const t = newTable(1)
    // One red puck, pointed straight at the gap.
    const p = t.pucks[0]!
    p.x = W / 2
    p.y = MID + 300
    t.pucks.push({ x: 200, y: MID - 600, vx: 0, vy: 0, r: 54, held: false, half: 1 })
    const ev: Event[] = []
    fire(t, 0, 0, 0, -1, 1, ev)
    let crossed = false
    for (let i = 0; i < 60 * 3 && !crossed; i++) {
      step(t, STEP, ev)
      crossed = ev.some((e) => e.kind === 'cross' && e.to === 1)
    }
    expect(crossed).toBe(true)
    expect(p.half).toBe(1)
    expect(owned(t, 0)).toBe(0)
  })

  it('the midline wall stops a puck outside the gap', () => {
    const t = newTable(1)
    const p = {
      x: W / 2 + GAP,
      y: MID + 80,
      vx: 0,
      vy: -1200,
      r: 54,
      held: false,
      half: 0 as const,
    }
    t.pucks = [p]
    const ev: Event[] = []
    for (let i = 0; i < 60; i++) step(t, STEP, ev)
    expect(p.y).toBeGreaterThanOrEqual(MID + 54)
    expect(p.half).toBe(0)
    expect(ev.some((e) => e.kind === 'cross')).toBe(false)
  })

  it('keeps pucks inside the table', () => {
    const t = newTable(1)
    const p = t.pucks[0]!
    p.x = 60
    p.y = 900 + 200
    p.vx = -3000
    p.vy = 3000
    const ev: Event[] = []
    for (let i = 0; i < 120; i++) step(t, STEP, ev)
    expect(p.x).toBeGreaterThanOrEqual(p.r - 1e-6)
    expect(p.y).toBeLessThanOrEqual(H - p.r + 1e-6)
  })

  /** Park every puck in one half, at rest and clear of each other. */
  function allIn(t: Table, half: 0 | 1): void {
    t.pucks.forEach((p, i) => {
      p.x = 150 + i * 130
      p.y = half === 0 ? MID + 400 : MID - 400
      p.vx = p.vy = 0
    })
  }

  it('a side whose half stays empty for a moment wins', () => {
    const t = newTable(2)
    allIn(t, 1)
    step(t, STEP, [])
    // Red has emptied its half, but the win waits a beat.
    expect(winner(t)).toBeNull()
    for (let i = 0; i < Math.ceil(HOLD * 60) + 1; i++) step(t, STEP, [])
    expect(winner(t)).toBe(0)
    const u = newTable(2)
    allIn(u, 0)
    for (let i = 0; i < Math.ceil(HOLD * 60) + 2; i++) step(u, STEP, [])
    expect(winner(u)).toBe(1)
  })

  it('a last puck that bounces back through the gap does not win the match', () => {
    const t = newTable(1)
    const red = t.pucks[0]!
    const blue = t.pucks[1]!
    blue.x = 150
    blue.y = MID - 500
    // Red's only puck just went through the gap, but is already heading back.
    red.x = W / 2
    red.y = MID - 70
    red.vx = 0
    red.vy = 900
    step(t, STEP, [])
    let won: ReturnType<typeof winner> = null
    for (let i = 0; i < 60 && won === null; i++) {
      step(t, STEP, [])
      won = winner(t)
    }
    expect(red.half).toBe(0)
    expect(won).toBeNull()
  })

  it('the gap widens as a long match drags on', () => {
    const t = newTable(1)
    expect(gapAt(t)).toBe(GAP)
    t.t = RAMP_END + 1
    expect(gapAt(t)).toBeCloseTo(GAP_WIDE, 5)
    t.t = (RAMP_START + RAMP_END) / 2
    expect(gapAt(t)).toBeGreaterThan(GAP)
    expect(gapAt(t)).toBeLessThan(GAP_WIDE)
  })

  it('at the safety time the side with fewer pucks wins', () => {
    const t = newTable(3)
    // Red 2, blue 4: red has fewer pucks.
    t.pucks[0]!.half = 1
    t.t = SAFETY_TIME
    expect(winner(t)).toBe(0)
    // Red 5, blue 1: blue has fewer pucks.
    t.pucks.forEach((p, i) => {
      p.half = i === 3 ? 1 : 0
    })
    t.t = SAFETY_TIME - 1
    expect(winner(t)).toBeNull()
    t.t = SAFETY_TIME
    expect(winner(t)).toBe(1)
  })

  it('the chosen pucks-per-side count sets the table', () => {
    expect(owned(newTable(8, new Rng(2)), 0)).toBe(8)
    expect(owned(newTable(3, new Rng(2)), 1)).toBe(3)
  })
})

describe('sling puck bots', () => {
  it('bot vs bot reaches a winner in bounded steps', () => {
    const { t, steps } = botMatch('hard', 'normal', 3)
    expect(winner(t)).not.toBeNull()
    expect(steps).toBeLessThan(60 * 400)
  })

  it('bot vs bot with a short match finishes', () => {
    const { t } = botMatch('normal', 'easy', 6, 3)
    expect(winner(t)).not.toBeNull()
  })

  it('the bot plays blue as well as red', () => {
    const t = newTable(5, new Rng(4))
    const rng = new Rng(4)
    const cmd = decide(t, 1, 'normal', rng, newMemory(), 1 / 60)
    expect(cmd).toEqual({})
    const mem = newMemory()
    mem.cool = 0
    const grab = decide(t, 1, 'normal', rng, mem, 1 / 60)
    expect(grab.grab).toBeTruthy()
    expect(t.pucks[grab.grab!.idx]!.half).toBe(1)
  })

  it('hard beats easy most of the time', () => {
    let hard = 0
    for (let seed = 1; seed <= 8; seed++) {
      const hardSide = seed % 2 === 0 ? 0 : 1
      const { t } = botMatch(
        hardSide === 0 ? 'hard' : 'easy',
        hardSide === 0 ? 'easy' : 'hard',
        40 + seed,
      )
      if (winner(t) === hardSide) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(6)
  })

  it('the bot sees a puck blocking its lane', () => {
    const t = newTable(1)
    const blocker = t.pucks[1]!
    blocker.half = 0
    blocker.x = W / 2
    blocker.y = MID + 250
    const at = planRelease(W / 2, 150)
    expect(laneScore(t, 0, 0, at.x, at.y, W / 2)).toBe(0)
    blocker.x = 120
    expect(laneScore(t, 0, 0, at.x, at.y, W / 2)).toBeGreaterThan(0)
  })
})
