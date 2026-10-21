import type { Side } from '../../core/game.ts'
import { frame } from '../../core/frame.ts'
import { banner, bigScore, clock, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, shade, SIDE } from '../../core/render/palette.ts'
import { clamp, outBack, outCubic } from '../../core/fx/ease.ts'
import { H, MID, type Stage } from '../../core/stage.ts'
import type { State, Wreck } from './index.ts'
import {
  AVENUES,
  canLaunch,
  CAR_L,
  CAR_W,
  type Cross,
  crossX,
  hash01,
  LAUNCH_Y,
  type Racer,
  ROAD_X,
  STALL,
} from './rules.ts'

/** The Go buttons sit between the two streets, in each player's half (red's layout, mirrored for blue), clear of the name pill below. */
export const GO_R = 92
export const GO_AT = [frame(0, 520, 1552), frame(1, 520, 1552)] as const

/** Where a side's big score figure sits (matches `bigScore`'s default spot). */
export function scoreAt(side: Side, stage?: Partial<Stage>): { x: number; y: number } {
  const edge = typeof stage?.edge === 'function' ? stage.edge(side) : side === 0 ? H : 0
  return { x: 130, y: side === 0 ? edge - 70 : edge + 70 }
}

const NIGHT = '#0e1120'
const ASPHALT = '#262c45'
const ASPHALT_HI = '#2d3452'
const KERB = '#4a4f72'
const CROSS_COLS = [C.cream, C.teal, C.purple, C.green, C.pink, C.orange, C.cyan]
/** Queue slots are this far apart along a street. */
const SLOT = 146
/** Half-width of a street, and the avenue's band. */
const STREET_HW = 78
const AVENUE_TOP = (AVENUES[0] as number) - 75
const AVENUE_BOT = (AVENUES[AVENUES.length - 1] as number) + 75
/** Street lamps along the avenue's kerbs (x), both sides. */
const LAMPS = [120, 500, 880]
/** Trees on red's sidewalks (red's layout); blue's are mirrored. */
const TREES: readonly [number, number][] = [
  [96, 1290],
  [880, 1300],
  [915, 1500],
  [590, 1270],
]

// ---------- the city ----------

function sidewalks(g: Draw): void {
  // Team colour owns each half's sidewalks: red below the avenue, blue above.
  const v = g.stage.view
  const top = mix(NIGHT, C.blueDark, 0.28)
  const bot = mix(NIGHT, C.redDark, 0.28)
  g.rect(v.x - 2, v.y - 2, v.w + 4, MID - v.y + 2, top)
  g.rect(v.x - 2, MID, v.w + 4, v.y + v.h - MID + 2, bot)
  // Paving: a faint grid of slabs, so the blocks read as a floor.
  for (let y = 0; y < H; y += 90) {
    if (y > AVENUE_TOP - 90 && y < AVENUE_BOT) continue
    g.line(v.x, y, v.x + v.w, y, alpha('#ffffff', 0.025), 3)
  }
}

function roads(g: Draw): void {
  const v = g.stage.view
  // Streets run the whole height; their far ends fade into the night.
  for (const x of ROAD_X) {
    g.rect(x - STREET_HW - 8, v.y - 2, STREET_HW * 2 + 16, v.h + 4, KERB)
    g.rect(
      x - STREET_HW,
      v.y - 2,
      STREET_HW * 2,
      v.h + 4,
      g.lin(x - STREET_HW, 0, x + STREET_HW, 0, [
        [0, shade(ASPHALT, -0.15)],
        [0.5, ASPHALT_HI],
        [1, shade(ASPHALT, -0.15)],
      ]),
    )
  }
  // The avenue, with raised kerbs.
  g.rect(v.x - 2, AVENUE_TOP - 10, v.w + 4, AVENUE_BOT - AVENUE_TOP + 20, KERB)
  g.rect(
    v.x - 2,
    AVENUE_TOP,
    v.w + 4,
    AVENUE_BOT - AVENUE_TOP,
    g.lin(0, AVENUE_TOP, 0, AVENUE_BOT, [
      [0, shade(ASPHALT, -0.1)],
      [0.5, ASPHALT_HI],
      [1, shade(ASPHALT, -0.1)],
    ]),
  )
  g.line(v.x, AVENUE_TOP - 10, v.x + v.w, AVENUE_TOP - 10, alpha('#ffffff', 0.18), 4)
  g.line(v.x, AVENUE_BOT + 10, v.x + v.w, AVENUE_BOT + 10, alpha('#000000', 0.3), 4)
  // Lane dashes on the avenue, skipping the crossings.
  const [l, r] = [...ROAD_X].sort((a, b) => a - b) as [number, number]
  const dash = alpha(C.white, 0.38)
  for (let j = 0; j < AVENUES.length - 1; j++) {
    const y = ((AVENUES[j] as number) + (AVENUES[j + 1] as number)) / 2
    g.dashed(v.x, y, l - STREET_HW - 10, y, dash, 6, [34, 26])
    g.dashed(l + STREET_HW + 10, y, r - STREET_HW - 10, y, dash, 6, [34, 26])
    g.dashed(r + STREET_HW + 10, y, v.x + v.w, y, dash, 6, [34, 26])
  }
  // Zebra crossings and stop lines on each street, just before the avenue.
  for (const x of ROAD_X) {
    for (const [y, up] of [
      [AVENUE_TOP - 44, true],
      [AVENUE_BOT + 14, false],
    ] as const) {
      for (let i = 0; i < 5; i++)
        g.rrect(x - STREET_HW + 12 + i * 29, y, 16, 30, 4, alpha(C.white, 0.34))
      g.line(
        x - STREET_HW + 8,
        up ? y - 14 : y + 44,
        x + STREET_HW - 8,
        up ? y - 14 : y + 44,
        alpha(C.white, 0.5),
        6,
      )
    }
  }
}

/** Warm pools of light from the avenue's street lamps: the floodlit table. */
function lampLight(g: Draw): void {
  const c = g.ctx
  c.save()
  c.globalCompositeOperation = 'lighter'
  for (const x of LAMPS) {
    for (const y of [AVENUE_TOP - 30, AVENUE_BOT + 30]) {
      g.circle(
        x,
        y,
        260,
        g.rad(x, y, 0, 260, [
          [0, 'rgba(255,214,140,0.16)'],
          [1, 'rgba(255,214,140,0)'],
        ]),
      )
    }
  }
  c.restore()
}

function lampPosts(g: Draw, now: number): void {
  for (const x of LAMPS) {
    for (const y of [AVENUE_TOP - 30, AVENUE_BOT + 30]) {
      g.shadow(x + 6, y + 8, 18, 9, 0.35)
      g.circle(x, y, 15, '#3b3a52')
      const flick = 0.85 + 0.15 * Math.sin(now * 3 + x)
      g.circle(x, y, 26, alpha('#ffd68c', 0.18 * flick))
      g.ball(x, y - 2, 10, '#ffe7b0', 0.9)
    }
  }
}

function trees(g: Draw): void {
  for (const side of [0, 1] as Side[]) {
    for (const [tx, ty] of TREES) {
      const p = frame(side, tx, ty)
      g.shadow(p.x + 10, p.y + 34, 46, 18, 0.4)
      g.emoji('🌳', p.x, p.y, 92, g.orient(side))
    }
  }
}

// ---------- cars ----------

/** Headlight beams ahead of a car's nose (local frame, nose toward -y). */
function beams(g: Draw, len = 230): void {
  const c = g.ctx
  c.save()
  c.globalCompositeOperation = 'lighter'
  g.poly(
    [-30, -58, 30, -58, 74, -58 - len, -74, -58 - len],
    g.lin(0, -58, 0, -58 - len, [
      [0, 'rgba(255,240,190,0.26)'],
      [1, 'rgba(255,240,190,0)'],
    ]),
  )
  c.restore()
}

/** A toy car seen from above, nose toward local -y, drawn at the origin. */
function carBody(
  g: Draw,
  body: string,
  o: { marker?: Side; brake?: boolean; hazard?: boolean } = {},
): void {
  const w = CAR_W
  const l = CAR_L
  // Wheels poke out of the sides.
  for (const sx of [-1, 1])
    for (const wy of [-34, 36]) g.rrect(sx * (w / 2) - 9, wy - 15, 18, 30, 6, '#0b0912')
  // Body: dark rim, then the glossy shell shaded across its width.
  g.rrect(-w / 2, -l / 2, w, l, 24, shade(body, -0.45))
  g.rrect(
    -w / 2 + 3,
    -l / 2 + 2,
    w - 6,
    l - 6,
    21,
    g.lin(-w / 2, 0, w / 2, 0, [
      [0, shade(body, -0.12)],
      [0.3, shade(body, 0.16)],
      [0.7, body],
      [1, shade(body, -0.22)],
    ]),
  )
  // Bonnet crease.
  g.line(-14, -54, -12, -42, alpha('#000000', 0.15), 3)
  g.line(14, -54, 12, -42, alpha('#000000', 0.15), 3)
  // Windscreen with a reflection streak, roof, rear window.
  const glass = g.lin(0, -40, 0, -18, [
    [0, '#1a2440'],
    [1, '#0b1020'],
  ])
  g.poly([-27, -38, 27, -38, 23, -17, -23, -17], glass)
  g.line(-14, -34, -4, -21, alpha('#ffffff', 0.35), 4)
  g.rrect(-24, -16, 48, 44, 13, shade(body, 0.1))
  g.alpha(0.5, () => g.ellipse(-8, -6, 12, 6, '#ffffff', -0.4))
  g.poly([-23, 30, 23, 30, 26, 46, -26, 46], alpha('#0b1020', 0.75))
  // Lights.
  g.rrect(-28, -62, 16, 8, 4, '#fff6c8')
  g.rrect(12, -62, 16, 8, 4, '#fff6c8')
  const tail = o.brake ? '#ff5468' : '#b0283a'
  g.rrect(-28, 54, 14, 7, 3, tail)
  g.rrect(14, 54, 14, 7, 3, tail)
  if (o.hazard) {
    for (const sx of [-1, 1]) {
      g.circle(sx * 30, -54, 14, alpha(C.orange, 0.45))
      g.circle(sx * 30, 54, 14, alpha(C.orange, 0.45))
      g.circle(sx * 30, -54, 6, C.yellow)
      g.circle(sx * 30, 54, 6, C.yellow)
    }
  }
  if (o.marker !== undefined) {
    g.sideMark(o.marker, 0, 6, 11, shade(body, -0.35))
    g.sideMark(o.marker, 0, 5, 9, alpha('#ffffff', 0.92))
  }
}

function car(
  g: Draw,
  x: number,
  y: number,
  angle: number,
  body: string,
  o: { marker?: Side; brake?: boolean; hazard?: boolean; lights?: boolean; sy?: number } = {},
): void {
  g.shadow(x + 8, y + 14, CAR_W * 0.62, CAR_L * 0.54, 0.38)
  g.at(
    x,
    y,
    angle,
    () => {
      if (o.lights) beams(g)
      carBody(g, body, o)
    },
    1 / Math.sqrt(o.sy ?? 1),
    o.sy ?? 1,
  )
}

function crossCar(g: Draw, c: Cross, t: number, seed: number): void {
  const x = crossX(c, t)
  const y = AVENUES[c.lane] as number
  // Along the avenue: nose toward travel (+x for dir > 0).
  const angle = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2
  const pick = Math.floor(hash01(seed, c.lane + 11, Math.round(c.t0 * 100)) * CROSS_COLS.length)
  const body = CROSS_COLS[pick] as string
  g.shadow(x + 8, y + 14, CAR_L * 0.54, CAR_W * 0.62, 0.38)
  g.at(x, y, angle, () => {
    beams(g, 200)
    carBody(g, body)
  })
}

/** A crashed car skids off in the cross car's direction, spinning, then fades in smoke. */
function wreck(g: Draw, w: Wreck, now: number): void {
  const t = now - w.at
  if (t < 0 || t > 1.4) return
  const k = outCubic(clamp(t / 0.6, 0, 1))
  const x = w.x + w.dir * 150 * k
  const spin = w.dir * (1.4 * k + (w.side === 0 ? 0 : Math.PI))
  const fade = t < 0.9 ? 1 : 1 - (t - 0.9) / 0.5
  g.alpha(fade, () => {
    g.shadow(x + 8, w.y + 14, CAR_W * 0.62, CAR_L * 0.5, 0.35)
    g.at(x, w.y, spin, () => {
      carBody(g, mix(SIDE[w.side].main, '#3a3542', clamp(t / 0.5, 0, 0.7)), { marker: w.side })
      // Scorch and a flash of white on impact.
      if (t < 0.12) g.alpha(0.8, () => g.rrect(-40, -66, 80, 132, 26, '#fff'))
    })
  })
}

// ---------- queues and controls ----------

/** Queue bay for a side: a painted box around its waiting cars, in its colour. */
function queueBay(g: Draw, side: Side, active: boolean, now: number): void {
  const x = ROAD_X[side]
  const back = side === 0 ? 1 : -1
  const far = LAUNCH_Y[side] + back * SLOT * 3
  const y0 = Math.min(LAUNCH_Y[side], far) - 76
  const y1 = Math.max(LAUNCH_Y[side], far) + 76
  const col = SIDE[side]
  g.rrect(x - 68, y0, 136, y1 - y0, 28, alpha(col.main, 0.14))
  g.rrect(x - 68, y0, 136, y1 - y0, 28, undefined, alpha(col.light, active ? 0.75 : 0.35), 5)
  // The launch line: glows yellow when the front car may go.
  const ly = LAUNCH_Y[side] - back * 80
  const pulse = active ? 0.6 + 0.4 * Math.sin(now * 8) : 0
  g.line(
    x - 62,
    ly,
    x + 62,
    ly,
    active ? alpha(C.yellow, 0.6 + 0.4 * pulse) : alpha(col.light, 0.4),
    8,
  )
}

/** Waiting cars: the front one sits at the launch point, the rest queue behind and slide up on each launch. */
function queue(g: Draw, side: Side, r: Racer, t: number, stalled: boolean): void {
  if (r.queue <= 0) return
  const back = side === 0 ? 1 : -1
  const slide = 1 - outCubic(clamp((t - r.lastLaunch) / 0.25, 0, 1))
  const n = Math.min(4, r.queue)
  const x = ROAD_X[side]
  const blink = stalled && Math.floor(t * 6) % 2 === 0
  for (let k = n - 1; k >= 0; k--) {
    const y = LAUNCH_Y[side] + back * SLOT * (k + slide)
    car(g, x, y, side === 0 ? 0 : Math.PI, SIDE[side].main, {
      marker: side,
      brake: true,
      hazard: k === 0 && blink,
      lights: k === 0 && !stalled,
    })
  }
  if (r.queue > 1) {
    // Cars still waiting, on the sidewalk beside the queue (upright for its owner).
    const pos = frame(side, ROAD_X[0] - STREET_HW - 24, LAUNCH_Y[0] + 20)
    g.forSide(side, pos.x, pos.y, () => {
      g.rrect(-92, -30, 92, 60, 30, alpha(C.ink, 0.7))
      g.text(`×${r.queue}`, -46, 3, { size: 40, weight: 700, color: SIDE[side].light })
    })
  }
}

function goButton(g: Draw, s: State, side: Side, now: number): void {
  const at = GO_AT[side]
  const r = GO_R
  const racer = s.racers[side]
  const stallLeft = racer.stallUntil - s.t
  const ready = canLaunch(s, side) && s.endAt < 0
  const col = stallLeft > 0 || racer.queue <= 0 ? '#5a5670' : SIDE[side].main
  const depth = r * 0.18
  const press = s.pressed[side] ? depth : 0
  // Refused tap: the button shakes its head.
  const rt = s.t - s.refusedAt[side]
  const wob = rt < 0.35 ? Math.sin(rt * 50) * 12 * (1 - rt / 0.35) : 0
  const x = at.x + wob
  if (ready) {
    const p = 0.5 + 0.5 * Math.sin(now * 5)
    g.circle(x, at.y + depth / 2, r + 14 + p * 8, alpha(SIDE[side].main, 0.18 + 0.12 * p))
  }
  g.shadow(x + 8, at.y + depth + 16, r * 0.95, r * 0.4, 0.4)
  g.circle(x, at.y + depth, r, shade(col, -0.45))
  g.circle(
    x,
    at.y + press,
    r,
    g.rad(
      x,
      at.y + press,
      r * 0.1,
      r,
      [
        [0, shade(col, 0.32)],
        [0.7, col],
        [1, shade(col, -0.1)],
      ],
      x - r * 0.3,
      at.y + press - r * 0.4,
    ),
  )
  g.alpha(0.5, () =>
    g.ellipse(x - r * 0.32, at.y + press - r * 0.48, r * 0.3, r * 0.16, '#fff', -0.5),
  )
  if (stallLeft > 0) {
    const k = clamp(stallLeft / STALL, 0, 1)
    g.arc(x, at.y + press, r - 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k, C.orange, 14)
  }
  g.forSide(side, x, at.y + press, () =>
    g.text(stallLeft > 0 ? '💥' : 'GO', 0, 3, {
      size: r * 0.66,
      weight: 700,
      color: '#fff',
      drop: alpha('#000000', 0.35),
    }),
  )
}

function scorePop(g: Draw, s: State, side: Side, stage: Stage): void {
  const dt = s.t - s.scoredAt[side]
  const k = dt < 0.45 ? 1 + 0.45 * (1 - outBack(clamp(dt / 0.45, 0, 1))) : 1
  const at = scoreAt(side, stage)
  if (dt < 0.45) g.circle(at.x, at.y, 70 * k, alpha(SIDE[side].main, 0.25 * (1 - dt / 0.45)))
  bigScore(g, side, s.racers[side].across, { x: at.x, size: 80 * k })
}

function ending(g: Draw, s: State, names: [string, string]): void {
  if (s.endAt < 0) return
  const t = s.t - s.endAt
  const a = clamp(t * 4, 0, 1)
  const w = s.winner
  const text = w === 'draw' || w === null ? 'Draw!' : `${names[w]} wins!`
  const col = w === 0 || w === 1 ? SIDE[w].light : C.yellow
  banner(g, undefined, t < 0.8 ? 'Time!' : text, MID, {
    size: 64 + 10 * (1 - outBack(clamp(t / 0.3, 0, 1))),
    alpha: a,
    color: t < 0.8 ? C.yellow : col,
  })
}

export function renderJam(
  g: Draw,
  s: State,
  left: number,
  names: [string, string],
  now: number,
): void {
  sidewalks(g)
  roads(g)
  lampLight(g)
  trees(g)
  lampPosts(g, now)
  for (const side of [0, 1] as Side[]) {
    const x = ROAD_X[side]
    const far = side === 0 ? 0 : H
    g.dashed(x, LAUNCH_Y[side], x, far, alpha(SIDE[side].main, 0.3), 8, [18, 22])
    queueBay(g, side, canLaunch(s, side) && s.endAt < 0, now)
  }
  for (const c of s.cross) crossCar(g, c, s.t, s.seed)
  for (const side of [0, 1] as Side[]) {
    const r = s.racers[side]
    for (const c of r.cars) {
      // A quick stretch as it pulls away from the line.
      const sy = 1 + 0.12 * Math.max(0, 1 - c.prog / 140)
      car(g, ROAD_X[side], c.y, side === 0 ? 0 : Math.PI, SIDE[side].main, {
        marker: side,
        lights: true,
        sy,
      })
    }
    queue(g, side, r, s.t, s.t < r.stallUntil)
  }
  for (const w of s.wrecks) wreck(g, w, s.t)
  for (const side of [0, 1] as Side[]) goButton(g, s, side, now)
  for (const side of [0, 1] as Side[]) {
    const r = s.racers[side]
    const stalled = s.t < r.stallUntil
    namePill(g, side, names[side], {
      active: canLaunch(s, side) && s.endAt < 0,
      text: stalled ? 'Crashed!' : undefined,
    })
    scorePop(g, s, side, g.stage)
  }
  if (s.endAt < 0) clock(g, left, MID)
  ending(g, s, names)
}
