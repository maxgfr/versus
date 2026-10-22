import type { Side } from '../../core/game.ts'
import { frame, inFrame, textAngle } from '../../core/frame.ts'
import { outBack } from '../../core/fx/ease.ts'
import { banner, bigScore, namePill } from '../../core/hud.ts'
import type { Draw, Mood } from '../../core/render/draw.ts'
import { alpha, C, mix, SIDE, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import {
  BEAT,
  GOOD,
  LANE_X,
  LANES,
  LEAD,
  PAD_Y,
  SPAWN_Y,
  arrowY,
  type Dancer,
  type State,
} from './rules.ts'

/*
 * Each player's stage is drawn once in red's layout (pads along the bottom,
 * arrows scrolling down from the middle) and placed for blue with `inFrame`.
 * The disco ball hangs over the middle for both of them.
 */

/** Lane colours: left, down, up, right. Yellow stays free for "perfect". */
export const LANE_COL = [C.purple, C.cyan, C.green, C.pink] as const
/** Arrow directions (radians) for left, down, up, right. */
const DIR = [Math.PI, Math.PI / 2, -Math.PI / 2, 0] as const
const PAD_R = 62
const ARROW = 52
const BLOB_Y = 1640
const TILE = 125
const FLOOR = '#120e22'

/** A right-pointing arrow of size s (around the origin). */
function arrowPts(s: number): number[] {
  return [
    s,
    0,
    s * 0.08,
    -s * 0.66,
    s * 0.08,
    -s * 0.3,
    -s * 0.8,
    -s * 0.3,
    -s * 0.8,
    s * 0.3,
    s * 0.08,
    s * 0.3,
    s * 0.08,
    s * 0.66,
  ]
}

/** A chunky glossy arrow: ink outline, lane colour face, a shine along one edge. */
function arrow(g: Draw, s: number, col: string, glow = 0): void {
  const pts = arrowPts(s)
  if (glow > 0) g.alpha(glow * 0.6, () => g.poly(arrowPts(s * 1.3), C.yellow))
  g.poly(pts, shade(col, -0.45), C.ink, 10)
  g.poly(
    pts,
    g.lin(0, -s * 0.66, 0, s * 0.66, [
      [0, shade(col, 0.45)],
      [0.5, col],
      [1, shade(col, -0.25)],
    ]),
  )
  g.poly([s * 0.62, -s * 0.12, s * 0.16, -s * 0.52, s * 0.16, -s * 0.36], alpha(C.white, 0.5))
}

/** Whether this screen shows `side`'s input cues: always, except the rival's online. */
const isMine = (g: Draw, side: Side): boolean => g.viewer === null || g.viewer === side

/** Brightness pulse from a lane's last tap (0..1). */
const laneFlash = (at: number, now: number): number =>
  at < 0 ? 0 : Math.max(0, 1 - (now - at) / 0.18)

/** Cheap stable hash for the floor lights. */
const hash = (a: number, b: number, c: number): number => {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
  return x - Math.floor(x)
}

/** An LED dance floor in each half: tiles light up in the team colour on the beat, more with the combo. */
function floor(g: Draw, s: State, now: number, endAt: number, winner: Side | 'draw' | null): void {
  const v = g.stage.view
  g.fillView(FLOOR)
  const beatNo = Math.floor(now / BEAT + 1e-6)
  const ph = (now % BEAT) / BEAT
  for (const side of [0, 1] as Side[]) {
    const col = SIDE[side]
    const d = s.p[side]
    const heat = Math.min(1, d.combo / 20)
    const won = endAt >= 0 && winner === side
    const bottom = side === 0 ? v.y + v.h : H - v.y
    inFrame(g, side, () => {
      g.rect(v.x - 2, MID, v.w + 4, bottom - MID + 4, mix(FLOOR, col.main, 0.14))
      for (let j = 0; MID + j * TILE < bottom; j++) {
        for (let i = -1; i * TILE < W + TILE; i++) {
          const x = i * TILE + 4
          const y = MID + j * TILE + 4
          const h = hash(i, j, beatNo + side * 17)
          const lit = won ? hash(i, j, Math.floor(now * 6)) < 0.5 : h < 0.12 + heat * 0.22
          const a = lit ? (won ? 0.3 : (0.1 + heat * 0.14) * (1 - ph * 0.8)) : 0
          g.rrect(x, y, TILE - 8, TILE - 8, 14, mix(FLOOR, col.main, 0.22))
          if (a > 0) g.rrect(x, y, TILE - 8, TILE - 8, 14, alpha(h < 0.05 ? C.white : col.light, a))
        }
      }
    })
  }
  g.midline(alpha(C.white, 0.12))
  g.vignette(0.5)
}

/** The disco ball over the middle: spins faster with the combo, throws beams to both halves. */
function discoBall(g: Draw, s: State, now: number): void {
  const cx = W / 2
  const combo = Math.max(s.p[0].combo, s.p[1].combo)
  const spin = now * (0.9 + Math.min(combo, 30) * 0.06)
  const beat = Math.pow(1 - (now % BEAT) / BEAT, 3)
  const R = 66 + beat * 5
  // Beams: soft coloured wedges from the ball toward both players.
  const beams = 8
  g.alpha(0.06 + Math.min(combo, 30) * 0.004 + beat * 0.03, () => {
    for (let i = 0; i < beams; i++) {
      const a = spin * 0.5 + (i * Math.PI * 2) / beams
      const col = [C.cyan, C.pink, C.purple, C.green][i % 4] as string
      g.poly(
        [
          cx,
          MID,
          cx + Math.cos(a) * 1700,
          MID + Math.sin(a) * 1700,
          cx + Math.cos(a + 0.14) * 1700,
          MID + Math.sin(a + 0.14) * 1700,
        ],
        col,
      )
    }
  })
  g.circle(
    cx,
    MID,
    R + 30,
    g.rad(cx, MID, R, R + 30, [
      [0, alpha(C.white, 0.18 + beat * 0.12)],
      [1, alpha(C.white, 0)],
    ]),
  )
  g.circle(cx, MID + 8, R + 4, alpha('#000000', 0.35))
  g.ball(cx, MID, R, '#9aa6c4', 0)
  // Mirror facets turning with the spin.
  g.ctx.save()
  g.path((c) => c.arc(cx, MID, R - 2, 0, Math.PI * 2))
  g.ctx.clip()
  for (let row = -3; row <= 3; row++) {
    const lat = row * 0.36
    for (let k = 0; k < 16; k++) {
      const lon = (k * Math.PI * 2) / 16 + spin
      const z = Math.cos(lon)
      if (z < 0.05) continue
      const x = cx + Math.sin(lon) * R * Math.cos(lat)
      const y = MID + Math.sin(lat) * R
      const sw = 13 * z * Math.cos(lat) + 2
      const sh = 13 * Math.cos(lat) + 2
      const twinkle = hash(k, row, Math.floor(now * 8)) > 0.9
      const tone = twinkle
        ? C.white
        : (row + k) % 3 === 0
          ? mix('#c9d3ee', C.cyan, 0.3)
          : (row + k) % 3 === 1
            ? mix('#c9d3ee', C.pink, 0.25)
            : '#dfe6f7'
      g.rect(x - sw / 2, y - sh / 2, sw, sh, alpha(tone, 0.35 + z * 0.6))
    }
  }
  g.ctx.restore()
  g.alpha(0.75, () => g.ellipse(cx - R * 0.35, MID - R * 0.4, R * 0.28, R * 0.18, '#fff', -0.6))
  // Glints that flash off the ball on the beat.
  for (let i = 0; i < 4; i++) {
    const a = spin * 0.8 + i * 1.7
    const tw = Math.max(0, Math.sin(now * 7 + i * 2))
    g.star(cx + Math.cos(a) * (R + 18), MID + Math.sin(a) * (R + 18), 6 + tw * 12, C.white, 4, 0.3)
  }
}

/** A side's stage in its own layout: lane rails, arrows, pads, judgement, the dancer. */
function stage(
  g: Draw,
  side: Side,
  d: Dancer,
  now: number,
  end: 'play' | 'win' | 'lose',
  endT: number,
  o: DiscoOpts,
): void {
  const ang = textAngle(g, side)
  const pads = o.pads[side]
  const ph = (now % BEAT) / BEAT
  const beat = Math.pow(1 - ph, 2)
  for (let lane = 0; lane < LANES; lane++) {
    const x = LANE_X[lane] as number
    const col = LANE_COL[lane] as string
    g.rrect(x - 54, SPAWN_Y + 40, 108, PAD_Y - SPAWN_Y, 54, alpha(C.ink, 0.55))
    g.rrect(x - 54, SPAWN_Y + 40, 108, PAD_Y - SPAWN_Y, 54, undefined, alpha(col, 0.22), 4)
  }
  // Online, the rival's pads stay (they are where its arrows land and its hits
  // flash) but lose the "tap now" cue: that is an input hint for its own phone.
  const mine = isMine(g, side)
  // Pads (receptors), each flashing on its own lane's taps and breathing with the beat.
  for (let lane = 0; lane < LANES; lane++) {
    const x = LANE_X[lane] as number
    const col = LANE_COL[lane] as string
    const f = laneFlash(d.laneAt[lane] as number, now)
    // Is an arrow inside the hit window right now?
    let ready = false
    for (let i = mine ? d.cursor : d.hits.length; i < d.hits.length; i++) {
      const h = d.hits[i]
      if (!h || h.t - now > GOOD) break
      if (h.r === 0 && h.lane === lane && Math.abs(h.t - now) <= GOOD) ready = true
    }
    // The pad squashes into the table when pressed (spring, harder on a clean hit).
    const p = Math.max(0.6, Math.min(1.25, pads[lane] ?? 1))
    g.circle(x, PAD_Y + 12, PAD_R + 6, alpha('#000000', 0.4))
    g.at(
      x,
      PAD_Y + (1 - p) * 10,
      0,
      () => {
        g.disc(0, 0, PAD_R + f * 8, mix(shade(col, -0.35), C.white, f * 0.5), 10 * p)
        g.ring(0, 0, PAD_R - 8, alpha(C.white, 0.35 + beat * 0.3), 5)
        g.at(0, 0, DIR[lane] as number, () =>
          g.poly(arrowPts(30), alpha(C.white, 0.6 + f * 0.4), alpha(C.ink, 0.4), 5),
        )
      },
      2 - p,
      p,
    )
    if (ready) g.ring(x, PAD_Y, PAD_R + 14 + beat * 4, alpha(C.yellow, 0.85), 6)
    if (f > 0) g.ring(x, PAD_Y, PAD_R + 26 + (1 - f) * 44, alpha(col, f), 8)
  }
  // Missed arrows keep sliding past the pad, grey and tumbling, then fade.
  if (end === 'play') {
    for (let i = d.cursor - 1; i >= 0; i--) {
      const h = d.hits[i]
      if (!h || now - h.t > 0.5) break
      if (h.r !== 3) continue
      const t = (now - h.t - GOOD) / (0.5 - GOOD)
      if (t < 0) continue
      const y = arrowY(h, now)
      const x = LANE_X[h.lane] as number
      g.alpha(0.7 * (1 - t), () =>
        g.at(x + Math.sin(t * 9) * 6, y, (DIR[h.lane] as number) + t * 0.9, () =>
          arrow(g, ARROW * (1 - t * 0.3), '#5d5770'),
        ),
      )
    }
  }
  // Hit arrows burst out of the pad: a quick expanding ghost (bigger on a clean hit).
  for (const gh of o.ghosts) {
    if (gh.side !== side) continue
    const t = (now - gh.at) / 0.32
    if (t < 0 || t >= 1) continue
    const x = LANE_X[gh.lane] as number
    const col = gh.perfect ? C.yellow : (LANE_COL[gh.lane] as string)
    g.alpha((1 - t) * (0.5 + gh.k * 0.5), () =>
      g.at(
        x,
        PAD_Y - t * 40,
        DIR[gh.lane] as number,
        () => g.poly(arrowPts(ARROW), alpha(col, 0.35), col, 8),
        1 + outBack(t) * (0.4 + gh.k * 0.5),
      ),
    )
  }
  // Arrows on their way (or just past the pad, before they expire).
  if (end === 'play') {
    for (let i = d.cursor; i < d.hits.length; i++) {
      const h = d.hits[i]
      if (!h) break
      if (h.t - now > LEAD) break
      if (h.r !== 0 || now - h.t > GOOD) continue
      const y = arrowY(h, now)
      if (y < SPAWN_Y - 10) continue
      const fade = Math.min(1, (y - SPAWN_Y) / 90)
      const near = Math.max(0, 1 - Math.abs(y - PAD_Y) / 120)
      const x = LANE_X[h.lane] as number
      const lc = LANE_COL[h.lane] as string
      // A motion streak behind each arrow, toward where it came from.
      const tl = Math.min(110, y - SPAWN_Y)
      if (tl > 10)
        g.rrect(
          x - 18,
          y - tl - 20,
          36,
          tl,
          18,
          g.lin(0, y - tl - 20, 0, y - 20, [
            [0, alpha(lc, 0)],
            [1, alpha(lc, 0.32 * fade)],
          ]),
        )
      g.alpha(fade, () =>
        g.at(
          x,
          y,
          DIR[h.lane] as number,
          () => arrow(g, ARROW, LANE_COL[h.lane] as string, near),
          1 + near * 0.08,
        ),
      )
    }
  }
  // Judgement and combo, popping in above the pads.
  const since = d.judgeAt >= 0 ? now - d.judgeAt : 99
  if (d.judge && since < 0.7 && end === 'play') {
    const t = Math.min(1, since / 0.14)
    const a = since > 0.45 ? 1 - (since - 0.45) / 0.25 : 1
    const label = d.judge === 'perfect' ? 'PERFECT' : d.judge === 'good' ? 'GOOD' : 'MISS'
    const col = d.judge === 'perfect' ? C.yellow : d.judge === 'good' ? C.cyan : C.redLight
    // A clean hit pops bigger; a miss sags.
    const k = d.judge === 'miss' ? 0 : Math.max(0, 1 - Math.abs(d.err) / GOOD)
    const drop = d.judge === 'miss' ? since * 40 : 0
    g.alpha(a, () =>
      g.at(W / 2, PAD_Y - 190 + drop, ang, () => {
        g.text(label, 0, 0, {
          size: (56 + k * 14) * (0.6 + 0.4 * outBack(t)),
          weight: 700,
          color: col,
          stroke: alpha(C.ink, 0.85),
          strokeWidth: 12,
        })
        if (d.judge === 'good')
          g.text(d.err < 0 ? 'early' : 'late', 0, -60, {
            size: 34,
            weight: 700,
            color: alpha(C.white, 0.8),
            stroke: alpha(C.ink, 0.8),
            strokeWidth: 8,
          })
      }),
    )
  }
  if (d.combo >= 4 && end === 'play') {
    const mult = 1 + Math.min(3, Math.floor(d.combo / 10))
    const pop = d.judge !== 'miss' && since < 0.15 ? 1 - since / 0.15 : 0
    g.at(W / 2, PAD_Y - 122, ang, () =>
      g.text(mult > 1 ? `${d.combo} combo  x${mult}` : `${d.combo} combo`, 0, 0, {
        size: 40 * (1 + pop * 0.15),
        weight: 700,
        color: mult > 1 ? C.yellow : C.white,
        stroke: alpha(C.ink, 0.7),
        strokeWidth: 8,
      }),
    )
  }
  dancer(g, side, d, now, end, endT, ang, ph, o.lean[side], o.hop[side], o.squash[side])
}

/** The dancer: bounces and sways on the beat, waves its arms, shades on at a x2 combo. */
function dancer(
  g: Draw,
  side: Side,
  d: Dancer,
  now: number,
  end: 'play' | 'win' | 'lose',
  endT: number,
  ang: number,
  ph: number,
  leanK: number,
  hopK: number,
  squashK: number,
): void {
  const col = SIDE[side].main
  const beatNo = Math.floor(now / BEAT + 1e-6)
  const sway = (beatNo % 2 ? 1 : -1) * (1 - Math.pow(1 - Math.min(1, ph * 3), 2)) * 0.22
  const since = d.judgeAt >= 0 ? now - d.judgeAt : 99
  let bob = -Math.pow(1 - ph, 2) * 22
  let sq = Math.pow(1 - ph, 3) * 0.12
  let mood: Mood = 'happy'
  if (d.judge === 'perfect' && since < 0.3) mood = 'grin'
  else if (d.judge === 'miss' && since < 0.5) mood = 'sad'
  else if (d.combo >= 20) mood = 'wow'
  if (end === 'win') {
    mood = 'grin'
    bob = -Math.abs(Math.sin(endT * 8)) * 50
    sq = 0
  } else if (end === 'lose') {
    mood = 'sad'
    bob = 0
    sq = 0
  }
  const shades = (d.combo >= 10 && end === 'play') || end === 'win'
  const R = 56
  // Dance moves from the springs: lean toward a side arrow, jump on up, squat on down.
  const lean = (end === 'lose' ? 0 : sway) + leanK * 0.35
  const dx = leanK * 40
  bob -= hopK * 60
  const sx = (1 + sq) * (2 - squashK)
  const sy = (1 - sq) * squashK
  g.shadow(W / 2 + dx, BLOB_Y + 60, Math.max(30, 56 + bob * 0.3), 14)
  if (end === 'win') {
    // Spotlight cone onto the winner.
    g.poly(
      [
        W / 2 - 40,
        MID + 40,
        W / 2 + 40,
        MID + 40,
        W / 2 + 170,
        BLOB_Y + 70,
        W / 2 - 170,
        BLOB_Y + 70,
      ],
      alpha(C.white, 0.08 + Math.min(1, endT) * 0.06),
    )
    g.ellipse(W / 2, BLOB_Y + 62, 170, 40, alpha(C.yellow, 0.22))
  }
  g.at(W / 2 + dx, BLOB_Y + bob, ang + lean, () => {
    // Arms pump on the beat.
    const up = end === 'lose' ? -0.2 : 0.9 - ph * 1.2
    for (const sd of [-1, 1]) {
      const a = sd * (0.6 + up * 0.5 * (beatNo % 2 ? (sd > 0 ? 1 : 0.4) : sd < 0 ? 1 : 0.4))
      const hx = sd * (R + 18) + Math.sin(a) * 6
      const hy = -Math.cos(a) * 40 + 10
      g.line(sd * R * 0.8, 6, hx, hy, shade(col, -0.25), 14)
      g.circle(hx, hy, 14, shade(col, 0.15))
    }
    g.blob(0, 0, R, col, { mood, sx, sy, look: [leanK * 0.6, 0.3] })
    if (shades) {
      const ey = -R * 0.12
      for (const sd of [-1, 1]) g.rrect(sd * R * 0.36 - 18, ey - 12, 36, 24, 9, C.ink)
      g.line(-6, ey - 4, 6, ey - 4, C.ink, 5)
      g.line(-R * 0.36 - 10, ey - 6, -R * 0.36 - 2, ey - 6, alpha(C.white, 0.6), 3)
      g.line(R * 0.36 - 10, ey - 6, R * 0.36 - 2, ey - 6, alpha(C.white, 0.6), 3)
    }
  })
}

/** Seconds left as a round badge on the right edge (across from the pause button), one per reader. */
function timer(g: Draw, left: number, total: number): void {
  const s = Math.max(0, Math.ceil(left))
  const urgent = left <= 5 && left > 0
  const tick = urgent ? Math.max(0, (left % 1) - 0.7) / 0.3 : 0
  const col = urgent ? C.yellow : C.white
  const draw = (angle: number, cy: number) =>
    g.at(
      W - 70,
      cy,
      angle,
      () => {
        g.circle(0, 4, 50, alpha('#000000', 0.3))
        g.circle(0, 0, 50, alpha(C.ink, 0.88))
        g.arc(0, 0, 42, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * left) / total, col, 7)
        g.text(s, 0, 3, { size: 40, weight: 700, color: col })
      },
      1 + tick * 0.18,
    )
  if (g.flipTop) {
    draw(0, MID + 58)
    draw(Math.PI, MID - 58)
  } else draw(g.orient(), MID)
}

export interface DiscoOpts {
  names: [string, string]
  /** Game time the music stopped (-1 while dancing). */
  endAt: number
  winner: Side | 'draw' | null
  bots: [boolean, boolean]
  /** Seconds the music plays (the clock's full circle). */
  total: number
  /** Cosmetic springs (from index.ts), per side: pad press per lane, dancer lean / hop / squash. */
  pads: [number[], number[]]
  lean: [number, number]
  hop: [number, number]
  squash: [number, number]
  /** 0..1 score pulse. */
  pulse: [number, number]
  /** Score as displayed (rolls up toward the real one). */
  shown: [number, number]
  ghosts: readonly Ghost[]
}

/** A hit arrow bursting out of its pad (cosmetic). */
export interface Ghost {
  side: Side
  lane: number
  at: number
  perfect: boolean
  /** 0..1 timing cleanliness. */
  k: number
}

/** The whole table: dance floors, the disco ball, both stages, the HUD and the clock. */
export function renderDisco(g: Draw, s: State, now: number, o: DiscoOpts): void {
  floor(g, s, now, o.endAt, o.winner)
  const endT = o.endAt >= 0 ? now - o.endAt : 0
  for (const side of [0, 1] as Side[]) {
    const end: 'play' | 'win' | 'lose' =
      o.endAt < 0 || o.winner === null || o.winner === 'draw'
        ? 'play'
        : o.winner === side
          ? 'win'
          : 'lose'
    inFrame(g, side, () => stage(g, side, s.p[side], now, end, endT, o))
  }
  discoBall(g, s, now)
  for (const side of [0, 1] as Side[]) {
    const d = s.p[side]
    const mult = 1 + Math.min(3, Math.floor(d.combo / 10))
    namePill(g, side, o.names[side], { active: mult > 1 })
    bigScore(g, side, o.shown[side], {
      x: frame(side, 150, 0).x,
      size: 62 * (1 + Math.min(1, o.pulse[side]) * 0.3),
    })
  }
  timer(g, o.total - now, o.total)
  // Start-up prompt, upright for each player.
  const hint = 1 - Math.max(0, (now - 2.6) / 0.6)
  if (hint > 0) {
    for (const side of [0, 1] as Side[]) {
      if (o.bots[side] || !isMine(g, side)) continue
      banner(g, side, 'Tap the pads on the beat!', frame(side, W / 2, 1210).y, {
        size: 44,
        alpha: hint,
      })
    }
  }
  if (o.endAt >= 0) {
    const t = Math.min(1, endT / 0.35)
    g.at(
      W / 2,
      MID,
      0,
      () =>
        g.at(-W / 2, -MID, 0, () =>
          banner(g, undefined, 'Time!', MID, { size: 72, alpha: Math.min(1, endT * 5), gap: 150 }),
        ),
      0.4 + 0.6 * outBack(t),
    )
  }
}
