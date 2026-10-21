import type { Side } from '../../core/game.ts'
import { banner, namePill, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import type { State } from './index.ts'
import {
  airborne,
  available,
  COLS,
  type Frog,
  HOP_T,
  hopsFor,
  inPond,
  PAD_DX,
  PAD_DY,
  PAD_R,
  PAD_Y0,
  padCol,
  padRow,
  padXY,
  ROWS,
  SINK_AT,
  type World,
} from './rules.ts'

const WATER = '#0f6577'
const WATER_DEEP = '#073847'
const SINK_T = 0.9
/** Pad face colour by landings so far: fresh, used, wilting, doomed. */
const LEAF = ['#5ccb6c', '#7cc458', '#b4b544', '#a7823a']
/** Where the pond meets each player's bank. */
const BANK = PAD_Y0 - PAD_R - 40

/** Deep pond under the floodlights, with drifting ripples and light patches. */
function water(g: Draw, now: number): void {
  g.fillView(WATER_DEEP)
  g.fillView(
    g.rad(W / 2, MID, 120, H * 0.62, [
      [0, shade(WATER, 0.12)],
      [0.6, WATER],
      [1, WATER_DEEP],
    ]),
  )
  // Caustic light patches drifting slowly.
  for (let i = 0; i < 7; i++) {
    const x = ((i * 337 + now * (14 + i * 3)) % 1300) - 150
    const y = 260 + ((i * 523) % 1300)
    g.ellipse(x, y, 160, 60, alpha('#bff6ff', 0.035), 0.3 + i * 0.4)
  }
  for (let r = 0; r < 24; r++) {
    const y = r * 80 + 20
    const dir = r % 2 === 0 ? 1 : -0.6
    const off = ((now * 14 * dir + r * 61) % 160) - 160
    for (let c = -1; c < 9; c++)
      g.arc(c * 160 + off, y, 24, 0.4, Math.PI - 0.4, alpha('#d8fbff', 0.07), 4)
  }
}

/** Each player's muddy bank in their team colour, with reeds, where their HUD sits. */
function bank(g: Draw, side: Side): void {
  const v = g.stage.view
  const col = SIDE[side]
  const dir = side === 0 ? -1 : 1
  const edge = side === 0 ? H - BANK : BANK
  const far = side === 0 ? v.y + v.h + 4 : v.y - 4
  const wave = (c: CanvasRenderingContext2D, y: number) => {
    c.moveTo(v.x - 4, far)
    c.lineTo(v.x - 4, y)
    for (let x = v.x; x <= v.x + v.w + 60; x += 60)
      c.quadraticCurveTo(x + 30, y + dir * 16, x + 60, y)
    c.lineTo(v.x + v.w + 4, far)
    c.closePath()
  }
  g.path((c) => wave(c, edge + dir * 18), alpha('#000000', 0.25))
  g.path((c) => wave(c, edge), shade(col.main, -0.5))
  g.path((c) => wave(c, edge - dir * 16), shade(col.main, -0.62))
  g.path((c) => wave(c, edge - dir * 70), shade(col.main, -0.7))
  // Reeds at both corners, leaning over the water.
  for (const [rx, lean] of [
    [40, 1],
    [W - 40, -1],
  ] as const)
    for (let k = 0; k < 4; k++) {
      const x = rx + lean * k * 18
      const len = 70 + ((k * 37) % 40)
      const tip = edge + dir * len
      g.line(x, edge - dir * 30, x + lean * 14, tip, shade(C.grass, -0.3), 6)
      if (k % 2 === 0) g.ellipse(x + lean * 13, tip - dir * 14, 9, 22, C.woodDark, lean * 0.2)
    }
}

/** Pad outline with its notch, as a canvas path. */
function padPath(c: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  c.moveTo(x, y)
  c.arc(x, y, r, rot + 0.3, rot + Math.PI * 2 - 0.06)
  c.closePath()
}

/**
 * A lily pad: glossy green leaf with a notch and veins. It yellows, cracks and
 * starts to bob as it is landed on; a doomed pad bubbles under its frog.
 */
function pad(g: Draw, i: number, uses: number, now: number, scale = 1, fade = 1): void {
  const p = padXY(i)
  const wear = Math.min(uses, SINK_AT)
  const bob = wear >= SINK_AT - 1 ? Math.sin(now * (wear >= SINK_AT ? 9 : 5) + i) : 0
  const x = p.x
  const y = p.y + bob * (wear >= SINK_AT ? 3 : 1.5)
  const r = PAD_R * scale * (1 - wear * 0.03)
  const rot = -0.9 + ((i * 1.7) % 1.2)
  const leaf = LEAF[wear] ?? LEAF[0]!
  g.alpha(fade, () => {
    g.ellipse(x + 8, y + 14, r * 1.02, r * 0.9, alpha('#001820', 0.35))
    g.path((c) => padPath(c, x, y + 7, r, rot), shade(leaf, -0.45))
    g.path(
      (c) => padPath(c, x, y, r, rot),
      g.rad(
        x,
        y,
        4,
        r,
        [
          [0, shade(leaf, 0.3)],
          [0.7, leaf],
          [1, shade(leaf, -0.18)],
        ],
        x - r * 0.35,
        y - r * 0.4,
      ),
    )
    for (const a of [1.3, 2.4, 3.5, 4.6, 5.7])
      g.line(
        x,
        y,
        x + Math.cos(rot + a) * r * 0.82,
        y + Math.sin(rot + a) * r * 0.82,
        alpha(shade(leaf, -0.5), 0.35),
        3,
      )
    g.alpha(0.35, () => g.ellipse(x - r * 0.3, y - r * 0.42, r * 0.34, r * 0.16, '#fff', -0.5))
    // Cracks, one more per landing.
    const crack = alpha('#2d3a12', 0.75)
    const cracks = [
      [-34, 6, -20, 16, -26, 30, -16, 40],
      [36, -4, 20, 14, 28, 32],
      [-8, -44, 6, -26, -4, -10, 8, 2],
    ]
    for (let k = 0; k < Math.min(wear, cracks.length); k++) {
      const pts = cracks[k]!
      g.path(
        (c) => {
          c.moveTo(x + pts[0]!, y + pts[1]!)
          for (let j = 2; j < pts.length; j += 2) c.lineTo(x + pts[j]!, y + pts[j + 1]!)
        },
        undefined,
        crack,
        4,
      )
    }
    // A lotus flower on some pads.
    if (i % 3 === 1 && wear < 2) {
      const fx = x + Math.cos(rot + 3.2) * r * 0.45
      const fy = y + Math.sin(rot + 3.2) * r * 0.45
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + i
        g.ellipse(fx + Math.cos(a) * 7, fy + Math.sin(a) * 7, 8, 5, '#ffb3d1', a)
      }
      g.circle(fx, fy, 5, C.yellow)
    }
  })
  if (wear >= SINK_AT) {
    // Bubbles: this pad goes under as soon as its frog leaves.
    for (let k = 0; k < 3; k++) {
      const t = (now * 0.9 + k / 3 + i * 0.13) % 1
      const a = k * 2.1 + i
      g.ring(
        x + Math.cos(a) * (r + 6),
        y + Math.sin(a) * (r * 0.6) - t * 18,
        4 + t * 4,
        alpha('#e9fdff', 0.7 * (1 - t)),
        3,
      )
    }
  }
}

/** A pad going under: it shrinks, darkens and leaves rings on the water. */
function sinking(g: Draw, i: number, now: number, sunkT: number): void {
  const k = (now - sunkT) / SINK_T
  if (k < 0 || k > 1.6) return
  const { x, y } = padXY(i)
  if (k < 1) pad(g, i, SINK_AT, now, 1 - k * 0.55, 1 - k)
  const kk = Math.min(1, k / 1.6)
  g.ring(x, y, PAD_R * (0.5 + kk * 1.1), alpha('#e6fbff', 0.55 * (1 - kk)), 5)
  g.ring(x, y, PAD_R * (0.2 + kk * 0.7), alpha('#e6fbff', 0.4 * (1 - kk)), 4)
}

interface Pose {
  x: number
  y: number
  /** Height above the water (world units). */
  h: number
  /** Facing (radians, 0 = toward -y). */
  a: number
  /** 0 = sitting, 1 = fully stretched mid-hop. */
  stretch: number
  sx: number
  sy: number
  /** Opacity. */
  o: number
  /** How far it has gone under (0..1). */
  under: number
}

/** Direction a frog looks: where it last hopped, or across the pond at the start. */
function facing(f: Frog): number {
  if (f.from === f.pad || f.pad < 0) return f.side === 0 ? 0 : Math.PI
  const dc = padCol(f.pad) - padCol(f.from)
  const dr = padRow(f.pad) - padRow(f.from)
  return Math.atan2(dr, dc) + Math.PI / 2
}

/** Where a frog is drawn and how it sits right now (all from state timestamps). */
function pose(w: World, f: Frog, now: number, cheer: boolean): Pose {
  const base = { a: facing(f), stretch: 0, sx: 1, sy: 1, o: 1, under: 0 }
  if (f.fellT >= 0) {
    const from = padXY(f.from)
    if (f.dx || f.dy) {
      // Knocked off: tumbles in an arc to the water, then goes under.
      const k = Math.min(1, Math.max(0, (now - f.hopT) / 0.5))
      const under = Math.min(1, Math.max(0, (now - f.fellT - 0.5) / 0.7))
      return {
        ...base,
        x: from.x + f.dx * PAD_DX * k,
        y: from.y + f.dy * PAD_DY * k,
        h: Math.sin(Math.PI * k) * 80,
        a: Math.atan2(f.dy, f.dx) + Math.PI / 2 + k * Math.PI * 3,
        stretch: 1 - under,
        o: 1 - under,
        under,
      }
    }
    const p = padXY(f.pad)
    const k = Math.min(1, Math.max(0, (now - f.fellT) / 0.7))
    return { ...base, x: p.x, y: p.y, h: 0, sx: 1 - k * 0.3, sy: 1 - k * 0.3, o: 1 - k, under: k }
  }
  if (airborne(w, f)) {
    const k = Math.min(1, Math.max(0, (now - f.hopT) / HOP_T))
    const a = padXY(f.from)
    const b = padXY(f.pad)
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    const s = Math.sin(Math.PI * k)
    return {
      ...base,
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
      h: s * (50 + dist * 0.14),
      stretch: s,
      sx: 1 - 0.08 * s,
      sy: 1 + 0.16 * s,
    }
  }
  const p = padXY(f.pad)
  const land = Math.max(0, 1 - (now - f.hopT - HOP_T) / 0.16)
  // Breathing while it sits, a victory bounce when the match is won.
  const breathe = Math.sin(now * 3 + f.side * 2) * 0.03
  const jump = cheer ? Math.abs(Math.sin(now * 7)) : 0
  return {
    ...base,
    x: p.x,
    y: p.y,
    h: jump * 46,
    stretch: jump * 0.6,
    sx: 1 + 0.22 * land + breathe,
    sy: 1 - 0.18 * land - breathe,
  }
}

/** A top-down toy frog facing -y: folded hind legs, front feet, eye domes, a back marked with its side's shape. */
function frogBody(g: Draw, side: Side, mood: 'happy' | 'wow' | 'dizzy' | 'grin', st: number): void {
  const col = SIDE[side]
  const limb = shade(col.main, -0.32)
  const toe = shade(col.main, -0.12)
  for (const sx of [-1, 1]) {
    // Hind legs: folded along the body when sitting, kicked out behind mid-hop.
    const tx = sx * (27 - st * 9)
    const ty = 12 + st * 22
    g.ellipse(tx, ty, 12, 22 + st * 8, limb, sx * (-0.45 + st * 0.3))
    const fx = sx * (34 - st * 12)
    const fy = 34 + st * 34
    g.ellipse(fx, fy, 13 - st * 3, 8 + st * 3, limb, sx * (0.3 - st * 0.2))
    for (const t of [-1, 0, 1])
      g.circle(fx + sx * 9 + t * 5 * sx, fy + 6 + t * 3 + st * 6, 4.5, toe)
    // Front feet.
    g.ellipse(sx * 25, -16 - st * 4, 8, 12, limb, sx * -0.35)
    for (const t of [-1, 0, 1])
      g.circle(sx * (29 + t * 4), -28 - st * 6 + Math.abs(t) * 2, 3.8, toe)
  }
  // Body.
  g.ellipse(0, 5, 31, 37, shade(col.main, -0.4))
  g.ellipse(
    0,
    0,
    31,
    36,
    g.rad(
      0,
      0,
      4,
      40,
      [
        [0, shade(col.main, 0.32)],
        [0.65, col.main],
        [1, shade(col.main, -0.2)],
      ],
      -10,
      -14,
    ),
  )
  // Back marking: red's spot is a circle, blue's a square.
  g.sideMark(side, 0, 12, 9, alpha(col.light, 0.85))
  g.circle(-15, 4, 4, alpha(col.light, 0.55))
  g.circle(14, 22, 3.5, alpha(col.light, 0.55))
  g.alpha(0.45, () => g.ellipse(-11, -14, 10, 6, '#fff', -0.5))
  // Eye domes at the front, a smile across the snout.
  for (const ex of [-14, 14]) {
    g.circle(ex, -24, 13, shade(col.main, 0.1))
    g.circle(ex, -26, 9.5, '#fff')
    if (mood === 'dizzy') {
      g.line(ex - 5, -31, ex + 5, -21, C.ink, 3.5)
      g.line(ex - 5, -21, ex + 5, -31, C.ink, 3.5)
      continue
    }
    g.circle(ex, -29, mood === 'wow' ? 3.5 : 5, C.ink)
    g.circle(ex - 1.8, -31, 1.8, '#fff')
  }
  if (mood === 'wow') g.ellipse(0, -12, 6, 5, C.ink)
  else if (mood === 'grin') g.arc(0, -18, 11, 0.4, Math.PI - 0.4, C.ink, 4)
  else g.arc(0, -16, 9, 0.5, Math.PI - 0.5, alpha(C.ink, 0.7), 3)
}

function frog(g: Draw, f: Frog, w: World, now: number, cheer: boolean): void {
  const p = pose(w, f, now, cheer)
  if (p.o <= 0) return
  const pushed = f.fellT < 0 && now - f.hopT < 0.45 && f.from !== f.pad && !airborne(w, f)
  const mood = f.fellT >= 0 ? 'dizzy' : cheer ? 'grin' : pushed ? 'wow' : 'happy'
  // Shadow stays on the pad / water; the frog grows as it rises toward the camera.
  const lift = 1 + p.h / 260
  g.alpha(p.o, () => {
    if (p.under < 1)
      g.shadow(p.x + 6 + p.h * 0.15, p.y + 14, 34 / lift, 24 / lift, 0.35 * (1 - p.under))
    g.at(
      p.x,
      p.y - p.h,
      p.a,
      () => frogBody(g, f.side, mood, p.stretch),
      1.15 * p.sx * lift * (1 - p.under * 0.3),
      1.15 * p.sy * lift * (1 - p.under * 0.3),
    )
  })
  if (p.under > 0 && p.under < 1) {
    g.ring(p.x, p.y, 30 + p.under * 70, alpha('#e9fdff', 0.6 * (1 - p.under)), 6)
    g.ring(p.x, p.y, 10 + p.under * 40, alpha('#e9fdff', 0.5 * (1 - p.under)), 4)
  }
}

/** A pad outline in the side's shape: circle for red, rounded square for blue. */
function marker(
  g: Draw,
  side: Side,
  x: number,
  y: number,
  r: number,
  stroke: string,
  lw: number,
): void {
  if (side === 0) g.ring(x, y, r, stroke, lw)
  else g.rrect(x - r, y - r, r * 2, r * 2, r * 0.42, undefined, stroke, lw)
}

/**
 * Where each human's frog can hop, outlined in their shape and colour; a rival
 * within reach gets the yellow target and an arrow showing where the push sends it.
 */
function hints(g: Draw, w: World, now: number, show: readonly boolean[]): void {
  for (const f of w.frogs) {
    if (!show[f.side] || f.fellT >= 0 || airborne(w, f)) continue
    const col = SIDE[f.side]
    const rival = w.frogs.find((k) => k.side !== f.side && k.fellT < 0)
    for (const i of hopsFor(w, f)) {
      const { x, y } = padXY(i)
      const k = 0.5 + 0.5 * Math.sin(now * 4 + i * 0.7)
      if (rival && rival.pad === i && !airborne(w, rival)) {
        const dc = Math.sign(padCol(i) - padCol(f.pad))
        const dr = Math.sign(padRow(i) - padRow(f.pad))
        const nc = padCol(i) + dc
        const nr = padRow(i) + dr
        const off = !inPond(nc, nr) || !available(w, nc + nr * COLS)
        marker(g, f.side, x, y, PAD_R + 16 + k * 6, C.yellow, 7)
        const ax = x + dc * (PAD_R + 40)
        const ay = y + dr * (PAD_R + 40)
        g.at(ax, ay, Math.atan2(dr, dc), () =>
          g.poly([-14, -18, 16, 0, -14, 18], off ? C.yellow : alpha(C.yellow, 0.55)),
        )
        continue
      }
      marker(g, f.side, x, y, PAD_R + 12, alpha(col.light, 0.3 + 0.35 * k), 5)
    }
  }
}

export interface View {
  names: [string, string]
  over: boolean
  /** Sides whose reachable pads are outlined (the humans). */
  hints: readonly boolean[]
}

/** The whole pond: water, banks, pads, hop hints, frogs, the score rows and the round banners. */
export function renderPond(g: Draw, s: State, now: number, v: View): void {
  const w = s.w
  const r = s.rounds
  water(g, w.t)
  bank(g, 1)
  bank(g, 0)
  for (let i = 0; i < COLS * ROWS; i++) {
    if (w.sunk[i] === 1) sinking(g, i, w.t, w.sunkT[i] ?? -9)
    else pad(g, i, w.uses[i] ?? 0, w.t)
  }
  if (r.phase === 'play' && !v.over) hints(g, w, w.t, v.hints)
  const champ = v.over && r.last !== 'draw' ? r.last : null
  // Fallen frogs under, then grounded, then airborne ones on top.
  const order = [...w.frogs].sort(
    (a, b) =>
      Number(a.fellT < 0) - Number(b.fellT < 0) || Number(airborne(w, a)) - Number(airborne(w, b)),
  )
  for (const f of order) frog(g, f, w, w.t, champ === f.side)
  g.vignette(0.35)
  for (const side of [0, 1] as const) {
    namePill(g, side, v.names[side], { active: champ === side })
    pips(g, side, r.wins[side], r.target)
  }
  if (v.over) return
  if (r.phase === 'between' && r.text) {
    const col =
      r.last === 'draw' || r.last === null ? C.white : mix(C.white, SIDE[r.last].light, 0.4)
    banner(g, undefined, r.text, MID, {
      size: 56,
      alpha: Math.min(1, (now - r.at) * 4),
      color: col,
    })
  } else if (r.phase === 'play' && r.round > 1 && now - r.at < 1.1)
    banner(g, undefined, `Round ${r.round}`, MID, {
      size: 64,
      alpha: Math.min(1, (1.1 - (now - r.at)) * 4),
    })
}
