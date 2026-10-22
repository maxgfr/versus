import type { Side } from '../../core/game.ts'
import { frame, inFrame, textAngle } from '../../core/frame.ts'
import { outBack } from '../../core/fx/ease.ts'
import { banner, namePill, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, SIDE, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { BEAT, isDown, laps, loopAt, PERFECT, TAU, TRACK, type Rat, type State } from './rules.ts'

/*
 * Each half is a loop drawn once in red's layout and placed for blue by
 * `inFrame`. The rat is seen from above and turns with the track; text uses
 * `textAngle`. The beat drum lives in each infield so both players can see it.
 */

const DIRT = '#7a5a40'
const TURF = '#2f8a52'
const FLOOR = '#171228'
/** Progress bar across each half's inner edge, red frame. */
const BAR_X0 = 180
const BAR_X1 = 820
const BAR_Y = MID + 50
/** Lane half-width. */
const LANE = 50

function floor(g: Draw): void {
  const v = g.stage.view
  g.fillView(FLOOR)
  const bot = v.y + v.h + 2
  g.rect(
    v.x - 2,
    MID,
    v.w + 4,
    bot - MID,
    g.lin(0, MID, 0, bot, [
      [0, mix(FLOOR, C.red, 0.12)],
      [1, mix(FLOOR, C.red, 0.34)],
    ]),
  )
  g.rect(
    v.x - 2,
    v.y - 2,
    v.w + 4,
    MID - v.y + 2,
    g.lin(0, MID, 0, v.y, [
      [0, mix(FLOOR, C.blue, 0.14)],
      [1, mix(FLOOR, C.blue, 0.38)],
    ]),
  )
  g.midline()
  g.vignette(0.4)
}

/** The track: striped kerb in the team colour, dirt lane, turf infield, chequered line at the bottom. */
function track(g: Draw, side: Side, now: number, boost: number): void {
  const { cx, cy, rx, ry } = TRACK
  const col = SIDE[side]
  // Floodlight pool and ground shadow.
  g.ellipse(
    cx,
    cy,
    rx + 200,
    ry + 180,
    g.rad(cx, cy, 0, rx + 200, [
      [0, alpha(col.light, 0.14)],
      [1, alpha(col.light, 0)],
    ]),
  )
  g.ellipse(cx, cy + 16, rx + LANE + 26, ry + LANE + 26, alpha('#000000', 0.35))
  // Kerb: alternating team colour and white blocks.
  const n = 36
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * TAU
    const a1 = ((k + 1) / n) * TAU
    g.path(
      (c) => {
        c.ellipse(cx, cy, rx + LANE + 22, ry + LANE + 22, 0, a0, a1)
        c.ellipse(cx, cy, rx + LANE, ry + LANE, 0, a1, a0, true)
        c.closePath()
      },
      k % 2 ? C.white : col.main,
    )
  }
  g.ellipse(cx, cy, rx + LANE, ry + LANE, DIRT)
  // Worn racing line.
  g.path((c) => c.ellipse(cx, cy, rx, ry, 0, 0, TAU), undefined, alpha(shade(DIRT, 0.18), 0.8), 34)
  g.path((c) => c.ellipse(cx, cy, rx - LANE, ry - LANE, 0, 0, TAU), alpha(col.main, 0.6), undefined)
  g.ellipse(cx, cy, rx - LANE - 8, ry - LANE - 8, TURF)
  // Mowed stripes in the infield.
  g.ctx.save()
  g.path((c) => c.ellipse(cx, cy, rx - LANE - 8, ry - LANE - 8, 0, 0, TAU))
  g.ctx.clip()
  for (let x = cx - rx; x < cx + rx; x += 80) g.rect(x, cy - ry, 40, ry * 2, alpha('#000000', 0.08))
  g.ctx.restore()
  // Lane dashes, sliding when the rat is boosted.
  g.ctx.save()
  g.ctx.setLineDash([30, 26])
  g.ctx.lineDashOffset = -now * 40 * (1 + boost * 2)
  g.path((c) => c.ellipse(cx, cy, rx, ry, 0, 0, TAU), undefined, alpha(C.white, 0.45), 6)
  g.ctx.restore()
  // Start / finish: a chequered strip across the lane at the bottom of the loop.
  const sy = cy + ry - LANE
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 5; j++) {
      g.rect(cx - 24 + i * 24, sy + j * 20, 24, 20, (i + j) % 2 ? C.white : C.ink)
    }
  }
}

/**
 * The beat drum in the infield: a ring closes in on the drum and lands on the
 * beat; the drum lights yellow while a tap would be perfect.
 */
function drum(g: Draw, side: Side, r: Rat, now: number, lap: number, target: number): void {
  const { cx, cy } = TRACK
  const y = cy - 26
  const ph = (now % BEAT) / BEAT
  const inWindow = Math.min(ph, 1 - ph) * BEAT <= PERFECT
  const hit = Math.max(0, 1 - ph * 5)
  const R = 62
  const col = SIDE[side]
  // The approach ring shrinks onto the drum.
  const rr = R + (1 - ph) * 110
  g.ring(cx, y, rr, alpha(inWindow ? C.yellow : C.white, 0.25 + ph * 0.55), 8)
  g.circle(cx, y + 10, R + 4, alpha('#000000', 0.35))
  g.circle(cx, y + 8, R, shade(col.main, -0.5))
  g.disc(cx, y, R * (1 + hit * 0.12), inWindow ? C.yellow : shade(col.main, -0.15), 10)
  const ang = textAngle(g, side)
  g.text(inWindow ? 'TAP' : '♪', cx, y + 2, {
    size: inWindow ? 40 : 46,
    weight: 700,
    color: inWindow ? C.ink : alpha(C.white, 0.85),
    angle: ang,
  })
  // Bar counter: four dots, the current beat lit.
  const b = Math.floor(now / BEAT + 1e-6) % 4
  for (let i = 0; i < 4; i++) {
    const dx = (i - 1.5) * 34
    const on = i === b
    g.circle(cx + dx, y + R + 34, on ? 10 : 7, on ? C.yellow : alpha(C.white, 0.3))
  }
  // Recent perfect: the drum flashes in the team colour.
  const since = now - r.perfectAt
  if (since >= 0 && since < 0.3)
    g.ring(cx, y, R + 10 + since * 120, alpha(C.yellow, 1 - since / 0.3), 8)
  const final = lap === target - 1
  g.text(final ? 'Final lap!' : `Lap ${Math.min(target, lap + 1)}/${target}`, cx, y + R + 86, {
    size: 38,
    weight: 700,
    color: final ? C.yellow : alpha(C.white, 0.85),
    angle: ang,
    stroke: alpha(C.ink, 0.5),
    strokeWidth: 8,
  })
}

/** The rat, seen from above, nose along the track. Red frame. */
function rat(
  g: Draw,
  side: Side,
  r: Rat,
  now: number,
  mood: 'play' | 'win' | 'lose',
  angle: number,
  squash: number,
): void {
  const at = loopAt(angle)
  const t = angle + Math.PI / 2
  const heading = Math.atan2(TRACK.ry * Math.cos(t), -TRACK.rx * Math.sin(t))
  const down = isDown(r, now)
  const col = SIDE[side].main
  const fur = mix(col, '#d8cfe6', 0.12)
  const run = angle * 9
  const speed = Math.min(1, r.speed / 2.2)
  const since = now - r.perfectAt
  const glow = since >= 0 && since < 0.35 ? 1 - since / 0.35 : 0
  if (glow > 0) g.circle(at.x, at.y, 90 + (1 - glow) * 30, alpha(C.yellow, 0.4 * glow))
  g.shadow(at.x + 6, at.y + 14, 70, 34, 0.35)
  const spin = down ? (now - (r.downUntil - 0.9)) * 14 : 0
  const hop = mood === 'win' ? Math.abs(Math.sin(now * 9)) * 0.12 : 0
  // Stretch along the track with speed, squash on each tap (sx runs nose to tail).
  const stretch = 1 + speed * 0.12
  const sq = Math.max(0.6, Math.min(1.4, squash))
  g.at(
    at.x,
    at.y,
    heading + spin,
    () => {
      // Speed streaks behind a fast rat.
      if (speed > 0.45) {
        for (const dy of [-20, 0, 20]) {
          g.line(-70, dy, -70 - speed * 90, dy, alpha(C.white, (speed - 0.45) * 0.8), 5)
        }
      }
      // Tail.
      g.path(
        (c) => {
          c.moveTo(-40, 0)
          c.bezierCurveTo(
            -80,
            Math.sin(now * 12) * 20,
            -100,
            -Math.sin(now * 12) * 24,
            -130,
            Math.sin(now * 12 + 1) * 14,
          )
        },
        undefined,
        '#f2a0b8',
        8,
      )
      // Legs, scurrying.
      for (const [lx, sd, ph] of [
        [22, 1, 0],
        [22, -1, Math.PI],
        [-20, 1, Math.PI],
        [-20, -1, 0],
      ] as const) {
        const k = down ? 0 : Math.sin(run + ph) * 14 * Math.min(1, r.speed + 0.2)
        g.ellipse(lx + k, sd * 30, 12, 8, '#f2a0b8')
      }
      g.ellipse(
        0,
        0,
        48,
        32,
        g.lin(0, -32, 0, 32, [
          [0, shade(fur, -0.25)],
          [0.5, shade(fur, 0.18)],
          [1, shade(fur, -0.25)],
        ]),
      )
      // Head and ears.
      g.ellipse(40, 0, 30, 24, shade(fur, 0.05))
      for (const sd of [-1, 1]) {
        g.circle(28, sd * 24, 15, shade(fur, -0.15))
        g.circle(28, sd * 24, 9, '#f6b3c6')
      }
      g.circle(70, 0, 8, '#ff7aa0')
      for (const sd of [-1, 1]) {
        if (down) {
          g.line(46, sd * 10 - 5, 54, sd * 10 + 5, C.ink, 4)
          g.line(46, sd * 10 + 5, 54, sd * 10 - 5, C.ink, 4)
        } else {
          g.circle(50, sd * 11, 5.5, C.ink)
          g.circle(51.5, sd * 11 - 2, 1.8, C.white)
        }
        g.line(64, sd * 6, 84, sd * 22, alpha(C.white, 0.6), 2.5)
        g.line(64, sd * 4, 88, sd * 8, alpha(C.white, 0.6), 2.5)
      }
      // A team number on its back, for the not-by-colour read.
      g.sideMark(side, -8, 0, 10, alpha(C.white, 0.85))
    },
    (1 + hop) * stretch * (2 - sq),
    (1 + hop) * (1 / stretch) * sq,
  )
  if (down) {
    for (let i = 0; i < 3; i++) {
      const a = now * 6 + (i * TAU) / 3
      g.star(at.x + Math.cos(a) * 64, at.y + Math.sin(a) * 30, 15, C.yellow, 5, 0.5, a)
    }
  }
  if (mood === 'lose') {
    g.text('💤', at.x + 40, at.y - 60 + Math.sin(now * 3) * 6, { size: 40 })
  }
}

/** Laps as a race bar on each half's inner edge, filling toward the flag. Red frame. */
function raceBar(g: Draw, side: Side, r: Rat, target: number, now: number, angle: number): void {
  const w = BAR_X1 - BAR_X0
  const col = SIDE[side]
  const k = Math.min(1, angle / (target * TAU))
  g.rrect(BAR_X0 - 8, BAR_Y - 26, w + 16, 52, 26, alpha(C.ink, 0.75))
  for (let i = 1; i < target; i++) {
    const x = BAR_X0 + (w * i) / target
    g.line(x, BAR_Y - 12, x, BAR_Y + 12, alpha(C.white, 0.25), 5)
  }
  if (k > 0) {
    const fw = Math.max(36, w * k)
    g.rrect(BAR_X0, BAR_Y - 18, fw, 36, 18, shade(col.main, -0.3))
    g.rrect(
      BAR_X0,
      BAR_Y - 18,
      fw,
      30,
      15,
      g.lin(0, BAR_Y - 18, 0, BAR_Y + 12, [
        [0, col.light],
        [1, col.main],
      ]),
    )
  }
  for (let q = 0; q < 4; q++)
    for (let c = 0; c < 2; c++)
      g.rect(BAR_X1 + 14 + c * 11, BAR_Y - 22 + q * 11, 11, 11, (q + c) % 2 ? C.ink : C.white)
  const hx = BAR_X0 + Math.max(20, w * k)
  const since = now - r.perfectAt
  const pop = since >= 0 && since < 0.2 ? 1 - since / 0.2 : 0
  g.disc(hx, BAR_Y - 2, 23 + pop * 7, pop > 0 ? C.yellow : C.white, 4)
  g.sideMark(side, hx, BAR_Y - 3, 10, col.main)
}

export interface RaceOpts {
  names: [string, string]
  target: number
  /** Game time the race was won (-1 while racing). */
  endAt: number
  winner: Side | 'draw' | null
  bots: [boolean, boolean]
  /** Interpolated run angles. */
  angles: [number, number]
  /** Tap squash springs (1 = rest). */
  squash: [number, number]
}

/** Both halves, the HUD (name, laps) and the start prompt. */
export function renderRace(g: Draw, s: State, now: number, o: RaceOpts): void {
  floor(g)
  for (const side of [0, 1] as Side[]) {
    const r = s.rats[side]
    const mood =
      o.winner === null || o.winner === 'draw' ? 'play' : o.winner === side ? 'win' : 'lose'
    const since = now - r.perfectAt
    const boost = since >= 0 && since < 0.4 ? 1 - since / 0.4 : 0
    inFrame(g, side, () => {
      track(g, side, now, boost)
      drum(g, side, r, now, laps(r, o.target), o.target)
      rat(g, side, r, now, mood, o.angles[side], o.squash[side])
      raceBar(g, side, r, o.target, now, o.angles[side])
    })
  }
  for (const side of [0, 1] as Side[]) {
    const r = s.rats[side]
    namePill(g, side, o.names[side], {
      active: r.perfectAt >= 0 && now - r.perfectAt < 0.25,
      text: isDown(r, now) ? 'Too fast!' : undefined,
    })
    pips(g, side, laps(r, o.target), o.target)
  }
  const hint = 1 - Math.max(0, (now - 2.8) / 0.6)
  if (hint > 0) {
    for (const side of [0, 1] as Side[]) {
      if (o.bots[side]) continue
      banner(g, side, 'Tap on the beat!', frame(side, 500, 1640).y, { size: 46, alpha: hint })
    }
  }
  if (o.endAt >= 0 && o.winner !== null) {
    const t = Math.min(1, (now - o.endAt) / 0.35)
    const draw = (side: Side | undefined, y: number) =>
      g.at(
        W / 2,
        y,
        0,
        () =>
          g.at(-W / 2, -y, 0, () =>
            banner(g, side, o.winner === 'draw' ? 'Photo finish!' : 'FINISH!', y, {
              size: 80,
              color: C.yellow,
              alpha: Math.min(1, t * 2),
            }),
          ),
        0.3 + 0.7 * outBack(t),
      )
    if (o.winner === 'draw') draw(undefined, MID)
    else draw(o.winner, frame(o.winner, 500, 1300).y)
  }
}
