import type { Side } from '../../core/game.ts'
import { inFrame, textAngle } from '../../core/frame.ts'
import { clamp, outBack, outCubic } from '../../core/fx/ease.ts'
import { drawRounds, type Rounds } from '../../engines/reflex/index.ts'
import { banner, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, shade, SIDE } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import type { Bump } from './index.ts'
import {
  CAR_HH,
  CAR_HW,
  CAR_Y,
  distAt,
  HORIZON,
  LANE_X,
  LIVES,
  ROAD_L,
  ROAD_R,
  speedAt,
  type Driver,
  type World,
} from './rules.ts'

const NIGHT = '#0c1020'
const ASPHALT = '#2a3150'
const DASH = alpha(C.white, 0.55)
const DASH_PERIOD = 180
const LAMP_PERIOD = 560
const TREE_PERIOD = 300
const OTHER_COLS = [C.cream, C.teal, C.purple, C.green, C.pink, C.orange, C.cyan]

/** Local y of the top of a side's dashboard (the HUD panel at its edge). */
function dashTop(g: Draw, side: Side): number {
  return side === 0 ? hudY(g, 0) - 62 : H - hudY(g, 1) - 62
}

/** Positions of a scrolling repeating item: first one just above the horizon, moving toward the driver. */
function rows(dist: number, period: number, phase = 0): number[] {
  const out: number[] = []
  const off = (((dist + phase) % period) + period) % period
  for (let y = HORIZON - period + off; y < H + period; y += period) out.push(y)
  return out
}

// ---------- the road ----------

function road(g: Draw, side: Side, s: World): void {
  const dist = distAt(s.rt)
  const v = speedAt(s.rt)
  const col = SIDE[side]
  const up = textAngle(g, side)
  inFrame(g, side, () => {
    // Verges, tinted in the driver's colour: each half is its owner's.
    g.rect(-600, HORIZON, W + 1200, H, mix(NIGHT, col.dark, 0.3))
    for (const y of rows(dist, 120))
      if (y > HORIZON) g.rect(-600, y, W + 1200, 10, alpha('#000000', 0.12))
    // Asphalt, darker toward the horizon.
    g.rect(
      ROAD_L,
      HORIZON,
      ROAD_R - ROAD_L,
      H,
      g.lin(0, HORIZON, 0, CAR_Y, [
        [0, shade(ASPHALT, -0.45)],
        [1, ASPHALT],
      ]),
    )
    // Rumble strips at the kerbs in the driver's colour, scrolling toward them.
    for (const y of rows(dist, DASH_PERIOD)) {
      const k = Math.round((y - HORIZON - dist) / DASH_PERIOD)
      const c = k % 2 === 0 ? col.main : C.white
      const y0 = Math.max(HORIZON, y)
      const y1 = y + DASH_PERIOD / 2
      if (y1 <= y0) continue
      g.rect(ROAD_L - 24, y0, 24, y1 - y0, c)
      g.rect(ROAD_R, y0, 24, y1 - y0, c)
    }
    g.rect(ROAD_L - 2, HORIZON, 6, H, alpha(C.white, 0.85))
    g.rect(ROAD_R - 4, HORIZON, 6, H, alpha(C.white, 0.85))
    // Lane dashes between the three lanes, scrolling.
    for (const x of [(LANE_X[0]! + LANE_X[1]!) / 2, (LANE_X[1]! + LANE_X[2]!) / 2]) {
      for (const y of rows(dist, DASH_PERIOD)) {
        const y0 = Math.max(HORIZON, y)
        const y1 = y + DASH_PERIOD * 0.5
        if (y1 > y0) g.rrect(x - 7, y0, 14, y1 - y0, 4, DASH)
      }
    }
    // Street lamps on both kerbs, staggered, each throwing a warm pool on the road.
    const lamps: [number, number][] = [
      ...rows(dist, LAMP_PERIOD).map((y): [number, number] => [ROAD_L - 40, y]),
      ...rows(dist, LAMP_PERIOD, LAMP_PERIOD / 2).map((y): [number, number] => [ROAD_R + 40, y]),
    ].filter(([, y]) => y > HORIZON - 120)
    const c = g.ctx
    c.save()
    c.globalCompositeOperation = 'lighter'
    for (const [lx, y] of lamps)
      g.circle(
        lx,
        y,
        300,
        g.rad(lx, y, 0, 300, [
          [0, 'rgba(255,214,140,0.2)'],
          [1, 'rgba(255,214,140,0)'],
        ]),
      )
    c.restore()
    for (const [lx, y] of lamps) {
      if (y < HORIZON) continue
      g.circle(lx, y, 13, '#3b3a52')
      g.ball(lx, y - 2, 9, '#ffe7b0', 0.9)
    }
    // Pines on the verges.
    for (const y of rows(dist, TREE_PERIOD, 90)) {
      if (y < HORIZON + 20) continue
      for (const [tx, dy] of [
        [40, 0],
        [W - 40, TREE_PERIOD / 2],
      ] as const) {
        const ty = y + dy
        if (ty > H + 100) continue
        g.shadow(tx + 10, ty + 30, 34, 14, 0.4)
        g.emoji('🌲', tx, ty, 76, up)
      }
    }
    // Speed streaks on the verges once the road gets fast.
    const fast = clamp((v - 620) / 260, 0, 1)
    if (fast > 0) {
      for (const y of rows(dist * 1.6, 230, 40)) {
        if (y < HORIZON + 60) continue
        g.line(90, y, 90, y + 110, alpha(C.white, 0.25 * fast), 5)
        g.line(W - 90, y + 115, W - 90, y + 225, alpha(C.white, 0.25 * fast), 5)
      }
    }
    // Night fog at the horizon, where traffic appears.
    g.rect(
      -600,
      HORIZON,
      W + 1200,
      340,
      g.lin(0, HORIZON, 0, HORIZON + 340, [
        [0, NIGHT],
        [1, alpha(NIGHT, 0)],
      ]),
    )
  })
}

// ---------- cars ----------

/** Headlight beam ahead of a car's nose (local frame, nose toward -y). */
function beams(g: Draw, len: number, a = 0.24): void {
  const c = g.ctx
  c.save()
  c.globalCompositeOperation = 'lighter'
  g.poly(
    [-34, -CAR_HH + 4, 34, -CAR_HH + 4, 96, -CAR_HH - len, -96, -CAR_HH - len],
    g.lin(0, -CAR_HH, 0, -CAR_HH - len, [
      [0, `rgba(255,240,190,${a})`],
      [1, 'rgba(255,240,190,0)'],
    ]),
  )
  c.restore()
}

/** A toy car seen from above, nose toward local -y, drawn at the origin. */
function carBody(g: Draw, body: string, marker?: Side): void {
  const w = CAR_HW * 2
  const h = CAR_HH * 2
  for (const sx of [-1, 1])
    for (const wy of [-h * 0.28, h * 0.3]) g.rrect(sx * (w / 2) - 11, wy - 19, 22, 38, 7, '#0b0912')
  g.rrect(-w / 2, -h / 2, w, h, 28, shade(body, -0.45))
  g.rrect(
    -w / 2 + 4,
    -h / 2 + 3,
    w - 8,
    h - 8,
    25,
    g.lin(-w / 2, 0, w / 2, 0, [
      [0, shade(body, -0.12)],
      [0.3, shade(body, 0.16)],
      [0.7, body],
      [1, shade(body, -0.22)],
    ]),
  )
  g.line(-18, -h * 0.44, -15, -h * 0.3, alpha('#000000', 0.15), 4)
  g.line(18, -h * 0.44, 15, -h * 0.3, alpha('#000000', 0.15), 4)
  g.poly(
    [-34, -h * 0.28, 34, -h * 0.28, 29, -h * 0.12, -29, -h * 0.12],
    g.lin(0, -h * 0.28, 0, -h * 0.12, [
      [0, '#1a2440'],
      [1, '#0b1020'],
    ]),
  )
  g.line(-18, -h * 0.25, -6, -h * 0.15, alpha('#ffffff', 0.35), 5)
  g.rrect(-31, -h * 0.11, 62, h * 0.36, 16, shade(body, 0.1))
  g.alpha(0.5, () => g.ellipse(-10, -h * 0.03, 15, 8, '#ffffff', -0.4))
  g.poly([-29, h * 0.27, 29, h * 0.27, 33, h * 0.38, -33, h * 0.38], alpha('#0b1020', 0.75))
  g.rrect(-36, -h / 2 - 1, 20, 10, 5, '#fff6c8')
  g.rrect(16, -h / 2 + -1, 20, 10, 5, '#fff6c8')
  g.rrect(-36, h / 2 - 11, 18, 8, 4, '#ff4b5c')
  g.rrect(18, h / 2 - 11, 18, 8, 4, '#ff4b5c')
  if (marker !== undefined) {
    g.sideMark(marker, 0, 9, 13, shade(body, -0.35))
    g.sideMark(marker, 0, 7, 11, alpha('#ffffff', 0.92))
  }
}

/** Oncoming cars, nose toward the driver, headlights blazing, growing out of the fog. */
function oncoming(g: Draw, side: Side, s: World): void {
  inFrame(g, side, () => {
    for (const o of s.obs[side]) {
      const a = clamp((o.y - HORIZON) / 160, 0, 1)
      if (a <= 0) continue
      const x = LANE_X[o.lane] as number
      const sc = 0.72 + 0.28 * clamp((o.y - HORIZON) / 520, 0, 1)
      const body = OTHER_COLS[o.id % OTHER_COLS.length] as string
      g.alpha(a, () => {
        g.shadow(x + 8, o.y + 14, CAR_HW * 1.1 * sc, CAR_HH * 1.02 * sc, 0.38)
        g.at(
          x,
          o.y,
          Math.PI,
          () => {
            beams(g, 200, 0.18)
            carBody(g, body)
          },
          sc,
        )
      })
    }
  })
}

/** A car knocked out of the way by a crash: it spins off the road and fades. */
function bump(g: Draw, b: Bump, now: number): void {
  const t = now - b.at
  if (t < 0 || t > 1) return
  const k = outCubic(clamp(t / 0.7, 0, 1))
  const x = b.x + b.dir * 300 * k
  const y = b.y - 60 * k
  inFrame(g, b.side, () =>
    g.alpha(1 - clamp((t - 0.6) / 0.4, 0, 1), () => {
      g.shadow(x + 8, y + 14, CAR_HW * 1.1, CAR_HH, 0.3)
      g.at(x, y, Math.PI + b.dir * 2.6 * k, () =>
        carBody(g, OTHER_COLS[b.id % OTHER_COLS.length] as string),
      )
    }),
  )
}

/** The driver's own car: leans into turns, blinks while invulnerable, burns when out. */
function ownCar(g: Draw, side: Side, d: Driver, rt: number, real: number): void {
  inFrame(g, side, () => {
    const ht = rt - d.hitT
    if (d.out) {
      const k = outBack(clamp(ht / 0.4, 0, 1))
      g.shadow(d.x + 8, CAR_Y + 14, CAR_HW * 1.2, CAR_HH, 0.4)
      g.at(d.x, CAR_Y, 0.5 * k, () => carBody(g, mix(SIDE[side].main, '#2b2733', 0.65), side))
      const f = 1 + 0.12 * Math.sin(real * 18)
      g.emoji('🔥', d.x + 6, CAR_Y - 40, 70 * f)
      g.emoji('🔥', d.x - 22, CAR_Y + 10, 48 * (2 - f))
      return
    }
    const shake = ht < 0.35 ? Math.sin(ht * 70) * 16 * (1 - ht / 0.35) : 0
    const lean = clamp((d.tx - d.x) / 260, -0.22, 0.22)
    const x = d.x + shake
    g.shadow(x + 8, CAR_Y + 14, CAR_HW * 1.1, CAR_HH * 1.02, 0.4)
    g.at(x, CAR_Y, lean, () => beams(g, 520, 0.3))
    const blink = rt < d.invT && Math.floor(rt * 14) % 2 === 0
    g.alpha(blink ? 0.35 : 1, () => g.at(x, CAR_Y, lean, () => carBody(g, SIDE[side].main, side)))
    if (ht < 0.16) g.alpha(0.7, () => g.rrect(x - 56, CAR_Y - 96, 112, 192, 30, '#ffffff'))
  })
}

// ---------- HUD ----------

/** Each driver's dashboard at their edge: the panel their name, hearts and round pips sit on. */
function dashboard(g: Draw, side: Side): void {
  const top = dashTop(g, side)
  const col = SIDE[side]
  inFrame(g, side, () => {
    g.rect(-600, top, W + 1200, H, mix(C.ink, col.dark, 0.18))
    g.rect(-600, top, W + 1200, 7, col.main)
    g.rect(-600, top + 7, W + 1200, 18, alpha(col.main, 0.18))
  })
}

/** Lives as hearts beside the name pill, upright for the driver; the one just lost pops. */
function lives(g: Draw, side: Side, d: Driver, rt: number): void {
  const y = hudY(g, side)
  // Hearts sit on the side away from the round pips, so the two never overlap.
  const x = side === 0 ? 262 : W - 262
  const ht = rt - d.hitT
  g.forSide(side, x, y, () => {
    for (let i = 0; i < LIVES; i++) {
      const hx = (i - 1) * 56
      if (i < d.lives) g.emoji('❤️', hx, 0, 50)
      else {
        g.alpha(0.22, () => g.emoji('🖤', hx, 0, 46))
        if (i === d.lives && ht < 0.5) {
          const k = ht / 0.5
          g.alpha(1 - k, () => g.emoji('💔', hx, -40 * k, 50 * (1 + 0.6 * k)))
        }
      }
    }
  })
}

export function renderRoad(
  g: Draw,
  s: World & { rounds: Rounds; bumps: Bump[] },
  names: [string, string],
  now: number,
  over: boolean,
  real: number,
): void {
  g.fillView(NIGHT)
  for (const side of [0, 1] as Side[]) road(g, side, s)
  // The seam where the two roads meet: a glowing horizon line.
  const v = g.stage.view
  g.rect(v.x - 2, MID - 8, v.w + 4, 16, C.ink)
  g.rect(v.x - 2, MID - 2, v.w + 4, 4, alpha(C.yellow, 0.25))
  for (const side of [0, 1] as Side[]) oncoming(g, side, s)
  for (const b of s.bumps) bump(g, b, now)
  for (const side of [0, 1] as Side[]) ownCar(g, side, s.drivers[side], s.rt, real)
  for (const side of [0, 1] as Side[]) {
    const d = s.drivers[side]
    dashboard(g, side)
    namePill(g, side, names[side], {
      active: s.rounds.phase === 'play' && !d.out && !over,
      text: d.out ? 'Out!' : undefined,
    })
    lives(g, side, d, s.rt)
  }
  drawRounds(g, s.rounds, now, { over })
  const r = s.rounds
  if (over && r.last !== null) {
    const t = now - r.at
    const w = r.last
    banner(g, undefined, w === 'draw' ? 'Draw!' : `${names[w]} wins!`, MID, {
      size: 64 + 14 * (1 - outBack(clamp(t / 0.35, 0, 1))),
      alpha: clamp(t * 4, 0, 1),
      color: w === 'draw' ? C.yellow : SIDE[w].light,
    })
  }
}
