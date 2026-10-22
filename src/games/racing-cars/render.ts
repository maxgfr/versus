import type { Side } from '../../core/game.ts'
import { banner, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import type { State } from './index.ts'
import { type Car, CHARGE_MIN, lapOf, nearest, type Pt, TRACK_W, type Track } from './rules.ts'

/** Cosmetic extras from the game: interpolated cars, squash springs, HUD pulses. */
export interface RaceLook {
  cars: Car[]
  squash: [number, number]
  pulse: [number, number]
}

/** A joystick's visuals, copied into the state so the online guest can draw it. */
export interface StickLook {
  side: Side
  on: boolean
  bx: number
  by: number
  kx: number
  ky: number
  r: number
}

/** Seconds a skid mark stays visible. */
const SKID_LIFE = 2.4

/** Cheap deterministic hash in 0..1. */
function hash(i: number, k = 0): number {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453
  return s - Math.floor(s)
}

interface Decor {
  x: number
  y: number
  glyph: string
  size: number
}

/** Trees and bushes off the road, placed once per circuit (same on every device). */
const decorCache = new WeakMap<Track, Decor[]>()
function decorOf(tr: Track): Decor[] {
  const hit = decorCache.get(tr)
  if (hit) return hit
  const out: Decor[] = []
  const glyphs = ['🌳', '🌲', '🌳', '🌼', '🪨']
  for (let k = 0; k < 140 && out.length < 34; k++) {
    const x = 60 + hash(k, 1) * 880
    const y = 60 + hash(k, 2) * 1680
    // Off the road and its run-off, and clear of the players' HUD rows.
    if (nearest(tr, x, y).d < TRACK_W / 2 + 70) continue
    if (y < 170 || y > 1630) continue
    if (x < 130 && Math.abs(y - MID) < 160) continue
    if (out.some((d) => Math.hypot(d.x - x, d.y - y) < 90)) continue
    const glyph = glyphs[Math.floor(hash(k, 3) * glyphs.length)] ?? '🌳'
    const big = glyph === '🌳' || glyph === '🌲'
    out.push({ x, y, glyph, size: big ? 64 + hash(k, 4) * 26 : 34 + hash(k, 4) * 10 })
  }
  decorCache.set(tr, out)
  return out
}

function grass(g: Draw): void {
  g.fillView(
    g.rad(W / 2, MID, 200, 1400, [
      [0, '#2f7a48'],
      [1, '#163d27'],
    ]),
  )
  // Mown stripes, so the speed reads on the grass.
  for (let y = -200; y < H + 200; y += 120) g.rect(-200, y, W + 400, 60, alpha('#000000', 0.05))
  // Team ends: a wash of each colour at its player's edge.
  const v = g.stage.view
  g.rect(
    v.x - 2,
    v.y - 2,
    v.w + 4,
    v.h + 4,
    g.lin(0, v.y, 0, v.y + v.h, [
      [0, alpha(C.blue, 0.28)],
      [0.14, alpha(C.blue, 0)],
      [0.86, alpha(C.red, 0)],
      [1, alpha(C.red, 0.28)],
    ]),
  )
}

/** The track as one closed line, stroked with the given colour and width. */
function trackLine(g: Draw, tr: Track, colour: string, width: number, dash?: number[]): void {
  const pts = tr.pts
  const first = pts[0] as Pt
  g.save()
  g.ctx.lineJoin = 'round'
  g.ctx.lineCap = 'butt'
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

function track(g: Draw, tr: Track): void {
  // Drop shadow, kerbs, asphalt with a lighter racing line, centre dashes.
  g.save()
  g.ctx.translate(8, 14)
  trackLine(g, tr, alpha('#000000', 0.3), TRACK_W + 40)
  g.restore()
  trackLine(g, tr, C.red, TRACK_W + 32)
  trackLine(g, tr, C.white, TRACK_W + 32, [30, 30])
  trackLine(g, tr, '#2b2836', TRACK_W + 4)
  trackLine(g, tr, '#3b3747', TRACK_W - 4)
  trackLine(g, tr, '#433f50', TRACK_W * 0.55)
  trackLine(g, tr, alpha(C.white, 0.45), 6, [34, 34])
  // Start and finish: a chequered band across the road, flags at each side.
  const p = tr.pts[0] as Pt
  const h = tr.hd[0] ?? 0
  g.at(p.x, p.y, h, () => {
    const n = 10
    for (let i = 0; i < n; i++)
      for (let j = 0; j < 3; j++)
        g.rect(
          -21 + j * 14,
          -TRACK_W / 2 + i * (TRACK_W / n),
          14,
          TRACK_W / n,
          (i + j) % 2 === 0 ? C.white : C.ink,
        )
    for (const sy of [-1, 1]) {
      g.circle(0, sy * (TRACK_W / 2 + 34), 12, '#2b2836')
      g.circle(0, sy * (TRACK_W / 2 + 34), 7, C.white)
    }
  })
  g.emoji('🏁', p.x - Math.sin(h) * (TRACK_W / 2 + 40), p.y + Math.cos(h) * (TRACK_W / 2 + 40), 50)
}

function decor(g: Draw, tr: Track): void {
  for (const d of decorOf(tr)) {
    g.shadow(d.x + 6, d.y + d.size * 0.38, d.size * 0.42, d.size * 0.16, 0.3)
    g.emoji(d.glyph, d.x, d.y, d.size)
  }
}

/** Skid marks: consecutive marks only join when they were laid down together. */
function skids(g: Draw, c: Car, now: number): void {
  const col = shade(SIDE[c.side].main, -0.75)
  for (let i = 1; i < c.marks.length; i++) {
    const a = c.marks[i - 1]
    const b = c.marks[i]
    if (!a || !b) continue
    const age = now - b.t
    if (age > SKID_LIFE) continue
    if (b.t - a.t > 0.06 || Math.hypot(b.x - a.x, b.y - a.y) > 40) continue
    const k = alpha(col, 0.45 * (1 - age / SKID_LIFE))
    // Two tyre tracks either side of the car's line.
    const dx = b.x - a.x
    const dy = b.y - a.y
    const m = Math.hypot(dx, dy) || 1
    const nx = (-dy / m) * 18
    const ny = (dx / m) * 18
    g.line(a.x + nx, a.y + ny, b.x + nx, b.y + ny, k, 9)
    g.line(a.x - nx, a.y - ny, b.x - nx, b.y - ny, k, 9)
  }
}

/** A chunky toy racer, nose along its heading, with its side's mark on the deck. */
function car(g: Draw, c: Car, leader: boolean, now: number, squash: number): void {
  const col = SIDE[c.side].main
  g.shadow(c.x + 7, c.y + 14, 46, 28, 0.38)
  const speed = Math.hypot(c.vx, c.vy)
  const buzz = speed > 60 ? Math.sin(now * 70 + c.side) * 0.8 : 0
  // Boost: a flickering exhaust flame and speed streaks off the tail.
  if (c.boost > 0) {
    const f = 0.75 + 0.25 * Math.sin(now * 50 + c.side * 2)
    const len = (40 + Math.min(1, c.boost) * 50) * f
    g.at(c.x, c.y, c.h, () => {
      g.ellipse(-50 - len * 0.5, 0, len * 0.6, 15, alpha(C.orange, 0.75))
      g.ellipse(-50 - len * 0.3, 0, len * 0.35, 8, alpha(C.yellow, 0.95))
      for (const sy of [-30, 0, 30])
        g.line(-70 - len, sy, -150 - len * 1.4, sy, alpha(C.white, 0.25), 4)
    })
  }
  // A charging drift spits sparks from the rear tyres: white, then orange once it will pay.
  if (c.charge > 0.12) {
    const ready = c.charge >= CHARGE_MIN
    const sc = ready ? (Math.floor(now * 20) % 2 ? C.orange : C.yellow) : C.white
    g.at(c.x, c.y, c.h, () => {
      for (const sy of [-30, 30]) {
        const j = Math.sin(now * 90 + sy) * 6
        g.circle(-38 + j, sy, ready ? 9 : 6, alpha(sc, 0.9))
        g.circle(-52 + j, sy + j * 0.6, ready ? 6 : 4, alpha(sc, 0.6))
      }
    })
  }
  // Squash and stretch along the car: >1 lunges forward, <1 crumples on a knock.
  const sq = Math.max(0.75, Math.min(1.3, squash))
  g.at(
    c.x,
    c.y + buzz,
    c.h,
    () => {
      // Wheels.
      for (const wx of [-30, 20])
        for (const wy of [-33, 21]) {
          g.rrect(wx, wy, 22, 12, 4, C.ink)
          g.rrect(wx + 3, wy + 2, 16, 3, 2, alpha('#ffffff', 0.18))
        }
      // Body: lip, then a glossy top that narrows to the nose.
      const body = (dy: number, fill: string | CanvasGradient) =>
        g.path((q) => {
          q.moveTo(-42, -24 + dy)
          q.lineTo(22, -22 + dy)
          q.quadraticCurveTo(46, -16 + dy, 48, dy)
          q.quadraticCurveTo(46, 16 + dy, 22, 22 + dy)
          q.lineTo(-42, 24 + dy)
          q.quadraticCurveTo(-48, 0 + dy, -42, -24 + dy)
        }, fill)
      body(4, shade(col, -0.45))
      body(
        0,
        g.lin(0, -24, 0, 24, [
          [0, shade(col, 0.35)],
          [0.5, col],
          [1, shade(col, -0.15)],
        ]),
      )
      // Racing stripe, rear wing, cockpit with a helmet.
      g.rrect(-42, -5, 88, 10, 4, alpha(C.white, 0.75))
      g.rrect(-50, -27, 12, 54, 5, shade(col, -0.55))
      g.rrect(-49, -26, 10, 52, 4, shade(col, -0.25))
      g.ellipse(4, 0, 17, 14, '#1d1b2c')
      g.ball(2, 0, 10, leader ? C.yellow : C.white, 0.8)
      g.alpha(0.5, () => g.ellipse(-14, -14, 14, 5, '#fff', 0))
      // Headlights.
      g.circle(42, -11, 4.5, C.yellow)
      g.circle(42, 11, 4.5, C.yellow)
    },
    sq,
    1 / Math.sqrt(sq),
  )
  // Red is a circle, blue a square: a badge on the rear deck, upright for its player.
  const bx = c.x - Math.cos(c.h) * 30
  const by = c.y - Math.sin(c.h) * 30
  g.forSide(c.side, bx, by, () => {
    g.sideMark(c.side, 0, 0, 10, C.white)
    g.sideMark(c.side, 0, 0, 6, col)
  })
}

function sticks(g: Draw, looks: StickLook[]): void {
  for (const k of looks) {
    if (!k.on) continue
    const col = SIDE[k.side]
    g.alpha(0.9, () => {
      g.circle(k.bx, k.by, k.r, alpha(col.dark, 0.35), alpha(col.light, 0.5), 5)
      g.ball(k.kx, k.ky, k.r * 0.45, col.main, 0.6)
    })
  }
}

/** A side's race HUD: lap on their left, position on their right, upright for them. */
function hud(g: Draw, s: State, tr: Track, side: Side, place: 1 | 2, pulse: number): void {
  const c = s.cars[side]
  const col = SIDE[side]
  const y = hudY(g, side)
  const left = side === 0 ? 140 : W - 140
  const right = side === 0 ? W - 140 : 140
  const done = c.finishT >= 0
  g.forSide(side, left, y, () => {
    g.text('LAP', 0, -40, { size: 34, weight: 700, color: alpha(C.white, 0.75) })
    g.text(done ? '🏁' : `${lapOf(c, tr, s.laps)}/${s.laps}`, 0, 12, {
      size: 50 * (1 + 0.35 * Math.min(1, pulse)),
      weight: 700,
      color: col.light,
      drop: alpha('#000000', 0.4),
    })
  })
  g.forSide(side, right, y, () => {
    g.text(place === 1 ? '1st' : '2nd', 0, 4, {
      size: place === 1 ? 64 : 52,
      weight: 700,
      color: place === 1 ? C.white : alpha(C.white, 0.6),
      drop: alpha('#000000', 0.4),
    })
  })
}

export function renderRace(
  g: Draw,
  s: State,
  tr: Track,
  now: number,
  names: [string, string],
  over: boolean,
  humans: readonly [boolean, boolean],
  look: RaceLook,
): void {
  grass(g)
  decor(g, tr)
  track(g, tr)
  for (const c of s.cars) skids(g, c, now)
  const [a, b] = s.cars
  const lead: Side =
    a.finishT >= 0 && (b.finishT < 0 || a.finishT <= b.finishT)
      ? 0
      : b.finishT >= 0
        ? 1
        : a.dist >= b.dist
          ? 0
          : 1
  // The car further down the screen is drawn last (in front).
  const ca = look.cars[0] ?? a
  const cb = look.cars[1] ?? b
  const order = ca.y >= cb.y ? [cb, ca] : [ca, cb]
  for (const c of order) car(g, c, c.side === lead, now, look.squash[c.side])
  sticks(g, s.ctl)
  for (const side of [0, 1] as const) hud(g, s, tr, side, side === lead ? 1 : 2, look.pulse[side])
  namePill(g, 0, names[0], { active: lead === 0 })
  namePill(g, 1, names[1], { active: lead === 1 })
  if (over) return
  // A first-seconds hint for each human, in their half.
  if (now - s.go < 2.6 && now >= s.go)
    for (const side of [0, 1] as const) {
      if (!humans[side] || s.ctl[side]?.on) continue
      const y = side === 0 ? MID + 640 : MID - 640
      g.alpha(Math.min(1, (2.6 - (now - s.go)) * 2), () =>
        g.sideText(side, 'Drag to steer', W / 2, y, {
          size: 46,
          weight: 700,
          color: C.white,
          stroke: alpha(C.ink, 0.8),
        }),
      )
    }
  // Countdown (only when the race has its own, e.g. after a restart).
  if (now < s.go) {
    const left = s.go - now
    banner(g, undefined, left > 2 ? '3' : left > 1 ? '2' : '1', MID, { size: 150 })
  } else if (now < s.go + 0.5 && s.go > 0)
    banner(g, undefined, 'GO!', MID, { size: 110, alpha: 1 - (now - s.go) / 0.5, color: C.yellow })
}
