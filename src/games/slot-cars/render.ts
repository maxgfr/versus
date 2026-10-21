import type { Side } from '../../core/game.ts'
import { banner, hudY, namePill } from '../../core/hud.ts'
import { clamp } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import type { State } from './index.ts'
import {
  A_MAX,
  type Car,
  curvatureAt,
  LANE,
  type Pt,
  RESPAWN,
  TOP,
  track,
  type Track,
} from './rules.ts'

/** A throttle button's look, copied into the state so the online guest can draw it. */
export interface ThrottleLook {
  side: Side
  x: number
  y: number
  r: number
  on: boolean
}

/** Half-width of the plastic road around the centre line. */
const ROAD = LANE + 64

/** How close a car is to flying off: lateral acceleration over the limit (0..1+). */
export function danger(c: Car): number {
  if (c.st !== 'run' || c.finishT >= 0) return 0
  const k = Math.abs(curvatureAt(track(), c.side, c.s))
  return (c.v * c.v * k) / A_MAX
}

function table(g: Draw): void {
  g.fillView(
    g.rad(W / 2, MID, 200, 1400, [
      [0, '#302a4c'],
      [1, '#0d0a18'],
    ]),
  )
  const v = g.stage.view
  g.rect(
    v.x - 2,
    v.y - 2,
    v.w + 4,
    v.h + 4,
    g.lin(0, v.y, 0, v.y + v.h, [
      [0, alpha(C.blue, 0.22)],
      [0.15, alpha(C.blue, 0)],
      [0.85, alpha(C.red, 0)],
      [1, alpha(C.red, 0.22)],
    ]),
  )
}

/** A closed path through a lane's points. */
function lanePath(
  g: Draw,
  pts: readonly Pt[],
  colour: string,
  width: number,
  dash?: number[],
): void {
  const first = pts[0] as Pt
  g.save()
  g.ctx.lineJoin = 'round'
  g.ctx.lineCap = 'round'
  if (dash) g.ctx.setLineDash(dash)
  g.path(
    (c) => {
      c.moveTo(first.x, first.y)
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i] as Pt
        c.lineTo(p.x, p.y)
      }
      c.closePath()
    },
    undefined,
    colour,
    width,
  )
  g.restore()
}

/** Red and white kerbs on the outside of every bend that cannot be taken flat out. */
let kerbCache: { a: Pt; b: Pt; red: boolean }[] | null = null
function kerbs(tr: Track): { a: Pt; b: Pt; red: boolean }[] {
  if (kerbCache) return kerbCache
  const out: { a: Pt; b: Pt; red: boolean }[] = []
  const n = tr.kap.length
  const kMin = A_MAX / (TOP * 0.88) ** 2
  const lane = tr.lanes[0].pts
  for (let i = 0; i < n; i++) {
    const k = tr.kap[i] ?? 0
    if (Math.abs(k) < kMin) continue
    const j = (i + 1) % n
    const at = (m: number): Pt => {
      // Centre line from the red lane (offset -LANE) back along the normal.
      const p = lane[m] ?? { x: 0, y: 0 }
      const nr = tr.nrm[m] ?? { x: 0, y: 0 }
      const off = (k > 0 ? -1 : 1) * (ROAD + 6) + LANE
      return { x: p.x + nr.x * off, y: p.y + nr.y * off }
    }
    out.push({ a: at(i), b: at(j), red: Math.floor(i / 7) % 2 === 0 })
  }
  kerbCache = out
  return out
}

/** The figure-8 mat: a raised plastic road, kerbs, two glowing slots and the start line. */
function circuit(g: Draw, tr: Track): void {
  const [red, blue] = tr.lanes
  // Road: shadow, rim, surface, both lanes stroked wide so they merge into one road.
  g.save()
  g.ctx.translate(8, 14)
  lanePath(g, red.pts, alpha('#000000', 0.35), ROAD * 2 - LANE * 2 + 20)
  lanePath(g, blue.pts, alpha('#000000', 0.35), ROAD * 2 - LANE * 2 + 20)
  g.restore()
  for (const [col, w] of [
    ['#5a5180', ROAD * 2 - LANE * 2 + 18],
    ['#3a3454', ROAD * 2 - LANE * 2 + 4],
    ['#423b5f', ROAD * 2 - LANE * 2 - 20],
  ] as const) {
    lanePath(g, red.pts, col, w)
    lanePath(g, blue.pts, col, w)
  }
  for (const k of kerbs(tr)) g.line(k.a.x, k.a.y, k.b.x, k.b.y, k.red ? C.red : C.white, 14, 'butt')
  // Slots: a team-coloured glow, metal rails and a dark groove.
  for (const [lane, side] of [
    [red, 0],
    [blue, 1],
  ] as const) {
    const col = SIDE[side].main
    lanePath(g, lane.pts, alpha(col, 0.28), 34)
    lanePath(g, lane.pts, '#b9b3cc', 18)
    lanePath(g, lane.pts, col, 13)
    lanePath(g, lane.pts, '#120f1c', 6)
  }
  // Start and finish: a chequered band across both lanes.
  const p = red.pts[0] as Pt
  const q = blue.pts[0] as Pt
  const mx = (p.x + q.x) / 2
  const my = (p.y + q.y) / 2
  const h = tr.hd[0] ?? 0
  const span = ROAD * 2
  g.at(mx, my, h, () => {
    const n = 12
    for (let i = 0; i < n; i++)
      for (let j = 0; j < 2; j++)
        g.rect(
          -12 + j * 12,
          -span / 2 + (i * span) / n,
          12,
          span / n,
          (i + j) % 2 === 0 ? C.white : C.ink,
        )
  })
}

/** A slot car: a low chunky body, a pin at the front that rides in the slot. */
function car(g: Draw, c: Car, now: number, leader: boolean): void {
  const col = SIDE[c.side].main
  const flying = c.st === 'fly'
  const k = flying ? Math.min(1, (now - c.t0) / RESPAWN) : 0
  const lift = flying ? Math.sin(k * Math.PI) * 60 : 0
  const blink = !flying && now - c.t0 < 0.6 && c.t0 > 0 && Math.floor(now * 14) % 2 === 0
  const d = danger(c)
  // Shadow on the mat stays put while the car rises above it.
  g.shadow(c.x + 5, c.y + 10 + lift * 0.4, 40 - lift * 0.25, 24 - lift * 0.15, 0.4)
  if (d > 0.7 && !flying) {
    const a = clamp((d - 0.7) / 0.3, 0, 1) * (0.55 + 0.45 * Math.sin(now * 40))
    g.circle(c.x, c.y, 56, alpha(C.orange, 0.35 * a))
  }
  const scale = 1.4 + lift / 150
  g.alpha(blink ? 0.4 : 1, () => {
    g.at(
      c.x,
      c.y - lift,
      c.h + (flying ? k * 9 : 0),
      () => {
        for (const wx of [-20, 12]) for (const wy of [-25, 15]) g.rrect(wx, wy, 15, 10, 4, C.ink)
        g.rrect(-31, -17, 62, 36, 15, shade(col, -0.45))
        g.rrect(
          -31,
          -20,
          62,
          36,
          15,
          g.lin(0, -20, 0, 16, [
            [0, shade(col, 0.35)],
            [1, col],
          ]),
        )
        g.rrect(-31, -4, 62, 8, 3, alpha(C.white, 0.7))
        g.rrect(-34, -19, 7, 38, 3, shade(col, -0.5))
        g.ellipse(3, -1, 12, 10, '#1d1b2c')
        g.ball(2, -1, 7, leader ? C.yellow : C.white, 0.8)
        g.circle(27, -11, 3.5, C.yellow)
        g.circle(27, 9, 3.5, C.yellow)
        // The guide pin at the nose that rides in the slot.
        g.circle(33, -1, 5, '#d6d0e6')
      },
      scale,
      scale,
    )
  })
  if (!flying) {
    // Red circle, blue square, upright for its player.
    const bx = c.x - Math.cos(c.h) * 28
    const by = c.y - Math.sin(c.h) * 28
    g.forSide(c.side, bx, by, () => {
      g.sideMark(c.side, 0, 0, 9, C.white)
      g.sideMark(c.side, 0, 0, 5.5, col)
    })
  }
}

/** The throttle: a big glossy button with a power ring that fills with speed. */
function throttle(g: Draw, t: ThrottleLook, speed: number, warn: number, hint: number): void {
  const col = SIDE[t.side].main
  const depth = t.r * 0.16
  const press = t.on ? 1 : 0
  g.forSide(t.side, t.x, t.y, () => {
    if (t.on) g.circle(0, depth, t.r + 26, alpha(col, 0.25))
    g.circle(0, depth, t.r + 4, shade(col, -0.45))
    g.circle(
      0,
      depth * press,
      t.r,
      g.rad(
        0,
        0,
        t.r * 0.1,
        t.r,
        [
          [0, shade(col, 0.3)],
          [1, col],
        ],
        -t.r * 0.3,
        -t.r * 0.4,
      ),
    )
    g.arc(0, depth * press, t.r + 14, 0, Math.PI * 2, alpha('#000000', 0.35), 9)
    g.arc(
      0,
      depth * press,
      t.r + 14,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * speed,
      warn > 0.85 ? C.orange : alpha(C.white, 0.9),
      9,
    )
    g.emoji('⚡', 0, depth * press, t.r * 1.05)
    if (hint > 0)
      g.alpha(hint, () =>
        g.text('HOLD', 0, -t.r - 50, {
          size: 40,
          weight: 700,
          color: C.white,
          stroke: alpha(C.ink, 0.8),
        }),
      )
  })
}

/** Lap counter on the player's left, upright for them. */
function laps(g: Draw, c: Car, total: number): void {
  const side = c.side
  const x = side === 0 ? 150 : W - 150
  g.forSide(side, x, hudY(g, side), () => {
    g.text('LAP', 0, -34, { size: 26, weight: 700, color: alpha(C.white, 0.7) })
    g.text(c.finishT >= 0 ? '🏁' : `${Math.min(total, c.laps + 1)}/${total}`, 0, 12, {
      size: 52,
      weight: 700,
      color: SIDE[side].light,
      drop: alpha('#000000', 0.4),
    })
  })
}

export function renderSlot(
  g: Draw,
  s: State,
  now: number,
  names: [string, string],
  over: boolean,
  humans: readonly [boolean, boolean],
): void {
  const tr = track()
  const [a, b] = s.cars
  const lead: Side =
    a.finishT >= 0 && (b.finishT < 0 || a.finishT <= b.finishT)
      ? 0
      : b.finishT >= 0
        ? 1
        : a.s >= b.s
          ? 0
          : 1
  table(g)
  circuit(g, tr)
  // Flying cars over grounded ones.
  const order = [...s.cars].sort((x, y) => Number(x.st === 'fly') - Number(y.st === 'fly'))
  for (const c of order) car(g, c, now, c.side === lead)
  const hint = now - s.go < 3 ? Math.min(1, (3 - (now - s.go)) * 2) : 0
  for (const t of s.ctl) {
    const c = s.cars[t.side]
    throttle(g, t, Math.min(1, (c?.v ?? 0) / TOP), c ? danger(c) : 0, humans[t.side] ? hint : 0)
  }
  namePill(g, 0, names[0], { active: lead === 0 })
  namePill(g, 1, names[1], { active: lead === 1 })
  for (const c of s.cars) laps(g, c, s.laps)
  if (over) return
  if (now < s.go) {
    const left = s.go - now
    banner(g, undefined, left > 2 ? '3' : left > 1 ? '2' : '1', MID, { size: 150 })
  }
}
