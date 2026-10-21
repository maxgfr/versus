import { frame, inFrame, textAngle } from '../../core/frame.ts'
import type { Side } from '../../core/game.ts'
import { clamp, outBack, outCubic } from '../../core/fx/ease.ts'
import { banner, clock, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, SIDE, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import {
  BOMB,
  FRUITS,
  type Fruit,
  type Half,
  type Lane,
  REACH,
  SPLAT_LIFE,
  type Splat,
  TRAIL_LIFE,
} from './rules.ts'

/** Emoji size in world units. */
export const FRUIT_SIZE = 168
const HALF_LIFE = 1.1

export interface View {
  names: [string, string]
  /** Whole seconds left. */
  sec: number
  over: boolean
  /** Game time the match ended (-1 while playing). */
  endAt: number
}

/** World point of a point in `side`'s lane. */
export function worldOf(side: Side, x: number, y: number): { x: number; y: number } {
  return frame(side, x, y)
}

export function renderDuel(g: Draw, lanes: [Lane, Lane], now: number, v: View): void {
  court(g, now)
  for (const side of [0, 1] as Side[]) {
    const lane = lanes[side]
    inFrame(g, side, () => {
      for (const sp of lane.splats) splat(g, sp, now)
      if (!v.over && now < 3.2) hint(g, side, now)
      for (const f of lane.fruit) fruit(g, f, now)
      for (const h of lane.halves) half(g, h, now)
      swipe(g, side, lane, now)
    })
  }
  const lead = lanes[0].score === lanes[1].score ? -1 : lanes[0].score > lanes[1].score ? 0 : 1
  for (const side of [0, 1] as Side[]) {
    score(g, side, lanes[side], now, v.over && lead === side)
    namePill(g, side, v.names[side], { active: now - lanes[side].hitAt < 0.25 })
  }
  if (!v.over) clock(g, v.sec, MID)
  else if (v.endAt >= 0) {
    const t = now - v.endAt
    g.alpha(clamp(t * 5, 0, 1), () =>
      banner(g, undefined, 'Time!', MID, { size: 64 * outBack(clamp(t / 0.35, 0, 1)) + 1 }),
    )
  }
}

// ---------- board ----------

function court(g: Draw, now: number): void {
  const view = g.stage.view
  g.fillView(C.ink2)
  g.halves(mix(C.ink2, C.red, 0.17), mix(C.ink2, C.blue, 0.18))
  // Floodlight from each player's edge.
  for (const side of [0, 1] as Side[]) {
    const y = side === 0 ? H : 0
    g.fillView(
      g.rad(W / 2, y, 40, 900, [
        [0, alpha(SIDE[side].light, 0.16)],
        [1, alpha(SIDE[side].light, 0)],
      ]),
    )
  }
  // Dojo dots and a big faint emblem per half.
  for (let x = 55; x < W; x += 110) {
    for (let y = Math.floor(view.y / 110) * 110 + 55; y < view.y + view.h; y += 110) {
      g.circle(x, y, 3, alpha(C.white, 0.06))
    }
  }
  for (const side of [0, 1] as Side[]) {
    const p = frame(side, W / 2, MID + 470)
    g.ring(p.x, p.y, 300, alpha(SIDE[side].main, 0.1), 26)
    g.ring(p.x, p.y, 200, alpha(SIDE[side].main, 0.06), 10)
  }
  // The midline is a taut wire with a soft glow.
  g.rect(view.x, MID - 10, view.w, 20, alpha(C.ink, 0.45))
  g.rect(view.x, MID - 2, view.w, 4, alpha(C.white, 0.25 + 0.05 * Math.sin(now * 2)))
  g.vignette(0.5)
}

/** Cheap stable noise from a few numbers, for stain shapes. */
const hash = (a: number, b: number): number => {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return v - Math.floor(v)
}

function splat(g: Draw, sp: Splat, now: number): void {
  const age = now - sp.born
  const grow = outCubic(clamp(age / 0.18, 0, 1))
  const a = clamp((SPLAT_LIFE - age) / 2, 0, 1) * 0.3
  if (a <= 0) return
  const bomb = sp.kind === BOMB
  const col = bomb
    ? '#07050b'
    : mix((FRUITS[sp.kind] as (typeof FRUITS)[number]).juice, C.ink2, 0.2)
  g.alpha(bomb ? a * 1.6 : a, () => {
    // An irregular puddle of overlapping drops...
    const n = bomb ? 7 : 5
    for (let i = 0; i < n; i++) {
      const h = hash(sp.born * 3 + i, sp.y)
      const ang = h * Math.PI * 2
      const d = (bomb ? 34 : 22) * hash(i, sp.x) * grow
      const r = ((bomb ? 34 : 20) + h * (bomb ? 22 : 16)) * grow
      g.circle(sp.x + Math.cos(ang) * d, sp.y + Math.sin(ang) * d, r, col)
    }
    // ...and droplets flung out across the cut.
    for (let i = 0; i < 7; i++) {
      const h = hash(sp.born + i, sp.x)
      const dir = i % 2 === 0 ? 1 : -1
      const d = (48 + h * 100) * grow
      const ang = sp.rot + dir * (Math.PI / 2) * (0.35 + hash(i, sp.y) * 0.65)
      g.circle(sp.x + Math.cos(ang) * d, sp.y + Math.sin(ang) * d, 4 + (1 - h) * 9, col)
    }
  })
}

function hint(g: Draw, side: Side, now: number): void {
  const a = clamp((3.2 - now) * 2, 0, 1)
  const angle = textAngle(g, side)
  const sweep = Math.sin(now * 4) * 180
  g.alpha(a, () => {
    g.at(W / 2, MID + 330, angle, () => {
      g.text('SWIPE!', 0, 0, {
        size: 84,
        weight: 700,
        color: C.white,
        stroke: SIDE[side].dark,
        strokeWidth: 16,
      })
      g.line(-200, 100, 200, 100, alpha(C.white, 0.18), 10)
      g.emoji('👆', sweep, 150, 84, sweep / 900)
    })
  })
}

// ---------- fruit ----------

function fruit(g: Draw, f: Fruit, now: number): void {
  if (f.kind === BOMB) {
    const p = 0.5 + 0.5 * Math.sin(now * 14)
    // A red warning glow and a fizzing fuse, so bombs read as bombs.
    g.circle(
      f.x,
      f.y,
      REACH + p * 10,
      g.rad(f.x, f.y, 10, REACH + p * 10, [
        [0, alpha(C.red, 0.4)],
        [1, alpha(C.red, 0)],
      ]),
    )
    g.emoji('💣', f.x, f.y, FRUIT_SIZE, f.rot * 0.35)
    return
  }
  // A soft shadow under each fruit makes it feel thrown rather than pasted on.
  g.shadow(f.x + 14, f.y + 74, 54, 13, 0.22)
  g.emoji((FRUITS[f.kind] as (typeof FRUITS)[number]).ch, f.x, f.y, FRUIT_SIZE, f.rot)
}

/** One half of a sliced fruit: the emoji clipped to its side of the cut, flesh showing. */
function half(g: Draw, h: Half, now: number): void {
  const age = now - h.born
  const a = clamp((HALF_LIFE - age) / 0.35, 0, 1)
  const kind = FRUITS[h.kind] as (typeof FRUITS)[number]
  // The cut flashes as a white slash for an instant.
  if (h.part === 1 && age < 0.16) {
    const k = 1 - age / 0.16
    const dx = Math.cos(h.cut) * 190
    const dy = Math.sin(h.cut) * 190
    g.line(h.x - dx, h.y - dy, h.x + dx, h.y + dy, alpha(C.white, 0.9 * k), 4 + 12 * k)
  }
  g.alpha(a, () =>
    g.at(h.x, h.y, h.rot, () => {
      const c = g.ctx
      const ang = h.cut - h.rot
      const dx = Math.cos(ang)
      const dy = Math.sin(ang)
      // Normal pointing to this half's side of the cut.
      const nx = -dy * h.part
      const ny = dx * h.part
      const L = 400
      c.save()
      c.beginPath()
      c.moveTo(-dx * L, -dy * L)
      c.lineTo(dx * L, dy * L)
      c.lineTo(dx * L + nx * L, dy * L + ny * L)
      c.lineTo(-dx * L + nx * L, -dy * L + ny * L)
      c.closePath()
      c.clip()
      g.emoji(kind.ch, 0, 0, FRUIT_SIZE)
      // The juicy flesh along the cut.
      g.ellipse(nx * 4, ny * 4, FRUIT_SIZE * 0.3, 10, shade(kind.juice, 0.2), ang)
      g.ellipse(nx * 3, ny * 3, FRUIT_SIZE * 0.2, 4, alpha('#ffffff', 0.55), ang)
      c.restore()
    }),
  )
}

/** The blade: a tapered glowing streak along the last few points of a swipe. */
function swipe(g: Draw, side: Side, lane: Lane, now: number): void {
  const pts = lane.trail
  const col = SIDE[side]
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      if (!a || !b) continue
      const k = clamp(1 - (now - b.t) / TRAIL_LIFE, 0, 1)
      if (k <= 0) continue
      if (pass === 0) g.line(a.x, a.y, b.x, b.y, alpha(col.main, 0.45 * k), 10 + 46 * k)
      else g.line(a.x, a.y, b.x, b.y, alpha(C.white, 0.95 * k), 3 + 18 * k)
    }
  }
  const tip = pts[pts.length - 1]
  if (tip && now - tip.t < 0.06) {
    g.circle(tip.x, tip.y, 20, alpha(C.white, 0.9))
    g.circle(tip.x, tip.y, 34, alpha(col.light, 0.35))
  }
}

// ---------- HUD ----------

function score(g: Draw, side: Side, lane: Lane, now: number, winner: boolean): void {
  const age = now - lane.hitAt
  const bump = age < 0.3 ? 1 - age / 0.3 : 0
  const bad = lane.hitValue < 0 && age < 0.6
  const s = 1 + 0.35 * outCubic(bump) + (winner ? 0.12 * Math.abs(Math.sin(now * 6)) : 0)
  const shake = bad ? Math.sin(age * 60) * 10 * (1 - age / 0.6) : 0
  g.forSide(side, 140 + shake, hudY(g, side), () => {
    if (winner) g.circle(0, 2, 70, alpha(SIDE[side].main, 0.3))
    g.text(lane.score, 0, 4, {
      size: 80 * s,
      weight: 700,
      color: bad ? C.red : bump > 0 ? C.white : SIDE[side].main,
      stroke: alpha(C.ink, 0.6),
      strokeWidth: 12,
    })
  })
}
