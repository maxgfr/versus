import { frame, inFrame, textAngle } from '../../core/frame.ts'
import type { Side } from '../../core/game.ts'
import { clamp, lerp, outBack, outCubic } from '../../core/fx/ease.ts'
import { banner, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, SIDE, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { AWAKE, type Guard, PILE_START, STIR, type Table, type Thief, ZONE } from './rules.ts'

/** Each thief's loot sack, in that thief's frame (red's view). */
export const BAG = { x: 820, y: 1555 }
/** The guard, sitting on top of the heap. */
export const GUARD = { x: W / 2, y: MID - 20 }
/** Where a reaching hand closes on the heap (thief's frame). */
export const GRAB = { x: W / 2, y: MID + 175 }
/** Where an idle hand waits, just off the heap (thief's frame). */
const REST = { x: W / 2, y: MID + 545 }
/** Shoulder of the reaching arm, tucked under the name pill. */
const SHOULDER = { x: W / 2, y: MID + 840 }

export const GEMS = ['#ff5c8a', '#5ce1e6', '#7cf29a', '#b388ff', '#ff9f43', '#ffe066']
const GUARD_COL = '#8790c8'
const GLOVE = '#f4efe6'

export interface View {
  table: Table
  names: [string, string]
  /** Whole seconds left. */
  sec: number
  over: boolean
  /** Game time the match ended (-1 while playing). */
  endAt: number
}

/** World point of a point in `side`'s frame. */
export function worldOf(side: Side, x: number, y: number): { x: number; y: number } {
  return frame(side, x, y)
}

/** 0..1 reach of a thief's hand: out while holding, back when released. */
function reach(th: Thief, now: number): number {
  const t = now - th.heldAt
  if (th.holding) return outBack(clamp(t / 0.16, 0, 1))
  return 1 - outCubic(clamp(t / 0.22, 0, 1))
}

/** Hand position in the thief's frame. */
export function handAt(th: Thief, now: number): { x: number; y: number } {
  const k = reach(th, now)
  const idle = Math.sin(now * 3) * 8 * (1 - k)
  return { x: lerp(REST.x, GRAB.x, k), y: lerp(REST.y, GRAB.y, k) + idle }
}

export function renderLight(g: Draw, v: View, now: number): void {
  const gd = v.table.guard
  table(g, gd, now)
  for (const side of [0, 1] as Side[]) {
    inFrame(g, side, () => mat(g, side, v.table.thieves[side].holding, gd, now, !v.over && now < 6))
  }
  heap(g, v.table.pile, now)
  searchlights(g, gd, now, v.over)
  guard(g, v.table, now, v.over)
  for (const side of [0, 1] as Side[]) {
    const th = v.table.thieves[side]
    inFrame(g, side, () => {
      bag(g, side, th, now, v.over && winnerOf(v.table) === side)
      flight(g, th, now)
      arm(g, side, th, gd, now)
    })
  }
  guardBubble(g, gd, now, v.over)
  for (const side of [0, 1] as Side[]) {
    const th = v.table.thieves[side]
    namePill(g, side, v.names[side], { active: th.holding, x: W / 2 })
    sideClock(g, side, v.sec)
  }
  if (v.over && v.endAt >= 0) {
    const t = now - v.endAt
    const pop = outBack(clamp(t / 0.35, 0, 1))
    g.alpha(clamp(t * 5, 0, 1), () =>
      banner(g, undefined, "Time's up!", g.flipTop ? MID : MID + (g.stage.rot ? -330 : 330), {
        size: 60 * pop + 1,
        gap: 330,
      }),
    )
  }
}

const winnerOf = (t: Table): Side | 'draw' => {
  const a = t.thieves[0].bag
  const b = t.thieves[1].bag
  return a === b ? 'draw' : a > b ? 0 : 1
}

// ---------- table ----------

function table(g: Draw, gd: Guard, now: number): void {
  const v = g.stage.view
  g.fillView(C.ink2)
  g.halves(mix(C.ink2, C.red, 0.16), mix(C.ink2, C.blue, 0.16))
  // Plank lines of the floor.
  for (let y = Math.floor(v.y / 90) * 90; y < v.y + v.h; y += 90) {
    g.rect(v.x, y, v.w, 3, alpha('#000000', 0.12))
  }
  // Floodlight on the treasure.
  g.fillView(
    g.rad(W / 2, MID, 60, 760, [
      [0, 'rgba(255,214,140,0.26)'],
      [0.5, 'rgba(255,214,140,0.08)'],
      [1, 'rgba(255,214,140,0)'],
    ]),
  )
  g.vignette(0.55)
  // Alarm tint while the guard is awake.
  if (gd.phase === 'awake') {
    const el = AWAKE - gd.left
    const a = 0.16 * (0.6 + 0.4 * Math.sin(now * 14)) * clamp(gd.left * 3, 0, 1)
    g.alpha(a * clamp(el * 6, 0, 1), () => g.fillView(C.red))
  }
}

/** The grab mat: the front of the heap on your side. Drawn in the thief's frame. */
function mat(g: Draw, side: Side, holding: boolean, gd: Guard, now: number, hint: boolean): void {
  const z = ZONE
  const w = z.x1 - z.x0
  const h = z.y1 - z.y0
  const col = SIDE[side]
  const danger = gd.phase === 'awake'
  g.rrect(z.x0, z.y0, w, h, 64, alpha(col.main, holding ? 0.22 : 0.09))
  const c = g.ctx
  c.setLineDash(holding ? [] : [26, 18])
  g.rrect(
    z.x0 + 3,
    z.y0 + 3,
    w - 6,
    h - 6,
    62,
    undefined,
    alpha(danger ? C.red : col.light, holding ? 0.9 : 0.4),
    holding ? 8 : 5,
  )
  c.setLineDash([])
  if (hint) {
    const a = clamp((6 - now) * 2, 0, 1)
    const angle = textAngle(g, side)
    const cy = z.y1 - 120
    g.alpha(a, () => {
      g.at(300, cy, angle, () => {
        g.emoji('✋', -95, 0, 60, Math.sin(now * 6) * 0.15)
        g.text('HOLD', 40, 4, {
          size: 64,
          weight: 700,
          color: C.white,
          stroke: col.dark,
          strokeWidth: 14,
        })
      })
    })
  }
}

// ---------- the heap ----------

function gem(g: Draw, x: number, y: number, s: number, col: string): void {
  const top = y - s * 0.3
  g.poly(
    [x - s, top, x - s * 0.55, y - s * 0.78, x + s * 0.55, y - s * 0.78, x + s, top, x, y + s],
    col,
    alpha(C.ink, 0.45),
    2.5,
  )
  g.poly(
    [x - s, top, x - s * 0.55, y - s * 0.78, x + s * 0.55, y - s * 0.78, x + s, top],
    shade(col, 0.35),
  )
  g.poly([x, y + s, x + s, top, x + s * 0.3, top], shade(col, -0.28))
  g.poly(
    [x - s * 0.3, y - s * 0.78, x + s * 0.1, y - s * 0.78, x - s * 0.05, top],
    alpha('#ffffff', 0.55),
  )
}

function heap(g: Draw, pile: number, now: number): void {
  const frac = clamp(pile / PILE_START, 0, 1)
  const cx = W / 2
  const cy = MID
  const k = 0.55 + 0.45 * frac
  g.shadow(cx, cy + 150 * k, 400 * k, 80 * k, 0.5)
  // A mound of gold coins under the gems.
  g.ellipse(
    cx,
    cy + 10,
    370 * k,
    190 * k,
    g.rad(cx - 60, cy - 60, 20, 420 * k, [
      [0, '#fff0a8'],
      [0.45, '#e9b23c'],
      [1, '#7a4a12'],
    ]),
  )
  for (let i = 0; i < 26; i++) {
    const a = i * 2.39996 + 0.7
    const r = Math.sqrt((i + 0.5) / 26) * 0.92
    const x = cx + Math.cos(a) * r * 350 * k
    const y = cy + 10 + Math.sin(a) * r * 175 * k
    g.ellipse(x, y + 3, 26, 12, '#9a6a1c')
    g.ellipse(x, y, 26, 12, '#ffd96b')
  }
  const N = 120
  const n = Math.round(frac * N)
  const slots: { x: number; y: number; r: number; i: number }[] = []
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996
    const r = Math.sqrt((i + 0.5) / N)
    // The middle is heaped higher: lift inner gems.
    slots.push({
      x: cx + Math.cos(a) * r * 340,
      y: cy + Math.sin(a) * r * 168 - (1 - r) * 40,
      r,
      i,
    })
  }
  slots.sort((a, b) => a.y - b.y)
  for (const s of slots) {
    const size = 30 - s.r * 8
    gem(g, s.x, s.y, size, GEMS[s.i % GEMS.length] as string)
    // Glints wander over the heap.
    const tw = (s.i * 0.37 + now * 0.9) % 1
    if ((s.i * 7) % 11 === 0 && tw < 0.25) {
      const a = Math.sin((tw / 0.25) * Math.PI)
      g.alpha(a, () => g.star(s.x - size * 0.2, s.y - size * 0.5, size * 0.6, '#ffffff', 4, 0.25))
    }
  }
}

// ---------- the guard ----------

/** Seconds since the guard's current phase began (sleep: unknown, 99). */
function phaseAge(gd: Guard): number {
  if (gd.phase === 'stir') return STIR - gd.left
  if (gd.phase === 'awake') return AWAKE - gd.left
  return 99
}

function searchlights(g: Draw, gd: Guard, now: number, over: boolean): void {
  if (gd.phase !== 'awake' || over) return
  const el = phaseAge(gd)
  const a = clamp(el * 5, 0, 1) * clamp(gd.left * 3, 0, 1)
  const { x, y } = GUARD
  for (const dir of [1, -1]) {
    const sweep = Math.sin(now * 3.4 + (dir > 0 ? 0 : 1.7)) * 220
    const ty = y + dir * 520
    const fill = g.lin(x, y, x, ty, [
      [0, alpha('#fff3b0', 0.55)],
      [1, alpha('#ff6b5c', 0)],
    ])
    g.alpha(a * 0.75, () =>
      g.poly([x - 30, y, x + 30, y, x + sweep + 230, ty, x + sweep - 230, ty], fill),
    )
  }
}

function guard(g: Draw, t: Table, now: number, over: boolean): void {
  const gd = t.guard
  const { x, y } = GUARD
  const el = phaseAge(gd)
  let sx = 1
  let sy = 1
  let gx = x
  let mood: 'sleep' | 'happy' | 'angry' | 'wow' | 'grin' = 'sleep'
  let look: [number, number] = [0, 0.2]
  if (gd.phase === 'sleep') {
    const b = Math.sin(now * 2.2) * 0.035
    sx = 1 - b
    sy = 1 + b
  } else if (gd.phase === 'stir') {
    gx += Math.sin(now * 46) * 4
    // Eyes flicker open, more and more as he comes round.
    const open = Math.sin(now * 22) > 0.6 - el * 1.2
    mood = open ? 'happy' : 'sleep'
    look = [Math.sin(now * 5) * 0.8, 0]
    sy = 1 + Math.sin(now * 8) * 0.03
  } else {
    const pop = outBack(clamp(el / 0.22, 0, 1))
    sx = 1 + 0.12 * pop
    sy = 1 + 0.16 * pop
    mood = el < 0.45 ? 'wow' : 'angry'
    // He glares at whoever is still reaching.
    const r = t.thieves[0].holding
    const b = t.thieves[1].holding
    look = r && !b ? [0, 0.9] : b && !r ? [0, -0.9] : [Math.sin(now * 6) * 0.9, 0]
    gx += Math.sin(now * 40) * 3 * clamp(1 - el * 3, 0, 1)
  }
  if (over) {
    mood = 'wow'
    look = [0, 0]
  }
  const r = 108
  g.shadow(x, y + r * 0.95, r * 1.05, 26, 0.45)
  // Warning ring while he stirs: the one thing to watch.
  if (gd.phase === 'stir' && !over) {
    const p = (now * 2.4) % 1
    g.alpha(1 - p, () => g.ring(x, y, r * (1.15 + p * 0.6), C.yellow, 10))
  }
  g.blob(gx, y, r, GUARD_COL, { mood, sx, sy, look, eyes: gd.phase === 'awake' ? 1.15 : 1 })
  // Police cap: crown, band, visor, badge.
  const top = y - r * sy
  g.at(gx, top + 26, 0, () => {
    g.ellipse(0, 10, 104, 22, alpha('#000000', 0.25))
    g.rrect(
      -92,
      -50,
      184,
      62,
      30,
      g.lin(0, -50, 0, 12, [
        [0, '#3a4fa0'],
        [1, '#1f2b63'],
      ]),
    )
    g.rrect(-88, -6, 176, 20, 8, '#141c44')
    g.ellipse(0, 18, 112, 16, '#10173a')
    g.star(0, -20, 15, '#f0c85a')
    g.ellipse(-46, -36, 26, 8, alpha('#ffffff', 0.25), -0.15)
  })
  if (gd.phase === 'sleep' && !over) {
    for (let k = 0; k < 3; k++) {
      const p = (now * 0.4 + k / 3) % 1
      g.text('z', x + 110 + p * 80, y - 70 - p * 190, {
        size: 44 + p * 30,
        weight: 700,
        color: alpha(C.white, 0.85 * Math.sin(p * Math.PI)),
        drop: alpha(C.ink, 0.4 * Math.sin(p * Math.PI)),
      })
    }
  }
}

/** A speech bubble upright for one reader, with a tail toward the guard. */
function bubble(
  g: Draw,
  side: Side,
  text: string,
  x: number,
  y: number,
  fill: string,
  ink: string,
  s: number,
) {
  g.at(
    x,
    y,
    g.orient(side),
    () => {
      const w = Math.max(100, g.measure(text, 58, 700) + 60)
      g.poly([-w / 2 + 14, 20, -w / 2 - 30, 44, -w / 2 + 40, 34], fill)
      g.rrect(-w / 2, -46, w, 92, 46, fill, alpha(C.ink, 0.35), 5)
      g.text(text, 0, 3, { size: 58, weight: 700, color: ink })
    },
    s,
  )
}

function guardBubble(g: Draw, gd: Guard, now: number, over: boolean): void {
  if (over || gd.phase === 'sleep') return
  const sides: Side[] = g.flipTop ? [0, 1] : [g.stage.rot ? 1 : 0]
  const el = phaseAge(gd)
  const s = outBack(clamp(el / 0.2, 0, 1))
  for (const side of sides) {
    // Beside the guard's head, on the reader's right.
    const p = frame(side, GUARD.x + 250, GUARD.y - 70)
    if (gd.phase === 'stir') bubble(g, side, 'hmm?', p.x, p.y, C.white, C.ink, s)
    else {
      const wob = 1 + Math.sin(now * 18) * 0.04
      bubble(g, side, '!', p.x, p.y, C.red, C.white, s * wob * 1.15)
    }
  }
}

// ---------- each thief ----------

function glove(g: Draw, side: Side, closed: boolean, tint: number): void {
  const col = SIDE[side]
  const skin = tint > 0 ? mix(GLOVE, C.red, tint * 0.6) : GLOVE
  // Cuff in the team colour.
  g.rrect(-40, 26, 80, 40, 16, col.dark)
  g.rrect(-40, 22, 80, 30, 14, col.main)
  if (closed) {
    for (const fx of [-27, -9, 9, 27]) g.circle(fx, -30, 17, shade(skin, -0.12))
    g.ball(0, 0, 44, skin, 0.7)
    for (const fx of [-27, -9, 9, 27]) g.circle(fx, -26, 13, skin)
  } else {
    for (const [fx, fy] of [
      [-30, -52],
      [-10, -62],
      [10, -62],
      [30, -52],
    ] as const) {
      g.rrect(fx - 12, fy - 10, 24, 50, 12, skin, alpha(C.ink, 0.15), 3)
    }
    g.ball(0, 0, 44, skin, 0.7)
    g.ellipse(-46, -4, 14, 22, skin, -0.5)
  }
}

function arm(g: Draw, side: Side, th: Thief, gd: Guard, now: number): void {
  const col = SIDE[side]
  const caught = now - th.caughtAt
  const shake = caught < 0.5 ? Math.sin(caught * 70) * 18 * (1 - caught * 2) : 0
  const h = handAt(th, now)
  const hx = h.x + shake
  const hy = h.y
  // Sleeve from under the pill.
  g.line(SHOULDER.x, SHOULDER.y, hx, hy + 50, shade(col.main, -0.45), 58)
  g.line(SHOULDER.x, SHOULDER.y, hx, hy + 50, col.main, 44)
  g.line(SHOULDER.x - 8, SHOULDER.y, hx - 8, hy + 50, alpha('#ffffff', 0.18), 10)
  // Gems streaming into the fist while it drags.
  const dragging = th.holding && gd.phase !== 'awake'
  if (dragging) {
    for (let k = 0; k < 4; k++) {
      const p = (now * 2.6 + k / 4) % 1
      const sx = W / 2 + (k - 1.5) * 150
      const x = lerp(sx, hx, outCubic(p))
      const y = lerp(MID + 40, hy - 20, p) - Math.sin(p * Math.PI) * 40
      g.alpha(Math.sin(p * Math.PI), () => gem(g, x, y, 14, GEMS[k + 1] as string))
    }
  }
  const tint = caught < 0.6 ? 1 - caught / 0.6 : 0
  g.at(hx, hy, 0, () => glove(g, side, th.holding, tint))
  // Stash at risk, in the hand.
  if (th.stash > 0) {
    const angle = textAngle(g, side)
    const pulse = 1 + Math.sin(now * 12) * 0.05
    g.at(
      hx + 130,
      hy - 10,
      angle,
      () => {
        const label = `+${th.stash}`
        const w = g.measure(label, 46, 700) + 40
        g.rrect(-w / 2, -32, w, 64, 32, C.yellow, shade(C.yellow, -0.4), 4)
        g.text(label, 0, 3, { size: 46, weight: 700, color: C.ink })
      },
      pulse,
    )
  }
  if (caught < 0.9 && th.lost > 0) {
    const t = caught / 0.9
    g.alpha(1 - t * t, () =>
      g.text(`-${th.lost}`, hx + 130, hy - 10 - outCubic(t) * 60, {
        size: 54,
        weight: 700,
        color: C.red,
        stroke: C.white,
        strokeWidth: 10,
        angle: textAngle(g, side),
      }),
    )
  }
}

/** Gems arcing from the hand into the sack after a bank. */
function flight(g: Draw, th: Thief, now: number): void {
  const n = Math.min(10, th.lastBank)
  const age = now - th.bankedAt
  if (n <= 0 || age > 0.9) return
  const from = { x: W / 2, y: GRAB.y + 120 }
  for (let j = 0; j < n; j++) {
    const t = clamp((age - j * 0.035) / 0.42, 0, 1)
    if (t <= 0 || t >= 1) continue
    const x = lerp(from.x + (j - n / 2) * 12, BAG.x, t)
    const y = lerp(from.y, BAG.y - 60, t) - Math.sin(t * Math.PI) * 180
    gem(g, x, y, 16, GEMS[j % GEMS.length] as string)
  }
}

function bag(g: Draw, side: Side, th: Thief, now: number, winner: boolean): void {
  const { x, y } = BAG
  const col = SIDE[side].main
  // Bounce when the flight lands, and keep bouncing for the winner.
  const land = now - th.bankedAt - 0.4
  let b = land > 0 ? Math.max(0, 1 - land * 3) * Math.cos(land * 26) : 0
  if (winner) b = Math.abs(Math.sin(now * 7)) * 0.8
  const fill = 0.85 + Math.min(0.35, th.bag / 120)
  // Drawn upright for whoever looks at it, turning about the sack's middle.
  const pivot = y - 17
  g.at(x, pivot, textAngle(g, side), () => {
    g.ctx.translate(0, y - pivot)
    sack(g, col, fill, b, th.bag)
  })
}

function sack(g: Draw, col: string, fill: number, b: number, count: number): void {
  g.shadow(0, 96, 104, 22, 0.45)
  g.at(
    0,
    90,
    0,
    () => {
      const r = 92 * fill
      const body = g.rad(-30, -90, 10, r * 1.4, [
        [0, shade(col, 0.35)],
        [0.55, col],
        [1, shade(col, -0.45)],
      ])
      g.path(
        (c) => {
          c.moveTo(-r * 0.42, -r * 1.55)
          c.bezierCurveTo(-r * 0.2, -r * 1.35, -r * 1.15, -r * 1.2, -r * 1.05, -r * 0.5)
          c.bezierCurveTo(-r * 1.0, -r * 0.05, -r * 0.7, 0, 0, 0)
          c.bezierCurveTo(r * 0.7, 0, r * 1.0, -r * 0.05, r * 1.05, -r * 0.5)
          c.bezierCurveTo(r * 1.15, -r * 1.2, r * 0.2, -r * 1.35, r * 0.42, -r * 1.55)
          c.closePath()
        },
        body,
        shade(col, -0.5),
        5,
      )
      // Tie and the ruffled top.
      g.poly(
        [
          -r * 0.42,
          -r * 1.55,
          -r * 0.62,
          -r * 1.95,
          -r * 0.1,
          -r * 1.75,
          0,
          -r * 2.0,
          r * 0.1,
          -r * 1.75,
          r * 0.62,
          -r * 1.95,
          r * 0.42,
          -r * 1.55,
        ],
        shade(col, -0.15),
        shade(col, -0.5),
        5,
      )
      g.rrect(-r * 0.5, -r * 1.62, r, 22, 11, '#c99a5a', '#7a5226', 4)
      g.ellipse(-r * 0.5, -r * 0.95, r * 0.22, r * 0.12, alpha('#ffffff', 0.35), -0.6)
    },
    1 + 0.14 * b,
    1 - 0.12 * b,
  )
  g.text(count, 0, 32 + 4 * b, {
    size: 70,
    weight: 700,
    color: C.white,
    stroke: shade(col, -0.55),
    strokeWidth: 12,
  })
}

function sideClock(g: Draw, side: Side, sec: number): void {
  const s = Math.max(0, sec)
  const label = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const urgent = s <= 5
  const x = side === 0 ? 170 : W - 170
  g.forSide(side, x, hudY(g, side), () => {
    const k = urgent ? 1 + 0.08 * Math.abs(Math.sin(g.t * 6)) : 1
    g.at(
      0,
      0,
      0,
      () => {
        g.rrect(
          -82,
          -34,
          164,
          68,
          34,
          alpha(C.ink, 0.75),
          urgent ? C.yellow : alpha(C.white, 0.15),
          4,
        )
        g.text(label, 0, 3, { size: 42, weight: 700, color: urgent ? C.yellow : C.white })
      },
      k,
    )
  })
}
