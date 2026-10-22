import { frame, frameAngle } from '../../core/frame.ts'
import { outBack } from '../../core/fx/ease.ts'
import { STEP, type Side } from '../../core/game.ts'
import { banner, bigScore, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, SIDE, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import {
  mouth,
  padAt,
  tipOf,
  type Fly,
  type Frog,
  type Tongue,
  type Vec,
  type World,
} from './rules.ts'

const WATER = '#0d3f4d'
const DEEP = '#07222c'
const PAD = '#55cf72'
const PAD_DARK = '#2a8a4b'
const TONGUE = '#ff6fb5'
const TONGUE_DARK = '#9e2f6b'
const PAD_R = 132

/** Decorative lily pads in red's layout (x, y, radius, notch angle); blue gets the mirror. */
const DECOR: readonly (readonly [number, number, number, number])[] = [
  [150, 1330, 56, 0.6],
  [880, 1420, 46, 2.4],
  [190, 1520, 36, 4.1],
  [860, 1650, 40, 1.2],
]

/** A lily pad outline with its notch pointing along `notch` (radians, world). */
function padPath(c: CanvasRenderingContext2D, x: number, y: number, r: number, notch: number) {
  const half = 0.26
  c.moveTo(x, y)
  c.arc(x, y, r, notch + half, notch - half + Math.PI * 2)
  c.closePath()
}

function pond(g: Draw, now: number): void {
  const v = g.stage.view
  g.fillView(WATER)
  // Each half is its team's water: deep and tinted at the player's edge, open in the middle.
  const bot = v.y + v.h + 2
  g.rect(
    v.x - 2,
    MID,
    v.w + 4,
    bot - MID,
    g.lin(0, MID, 0, bot, [
      [0, mix(WATER, C.red, 0.3)],
      [1, mix(DEEP, C.red, 0.5)],
    ]),
  )
  g.rect(
    v.x - 2,
    v.y - 2,
    v.w + 4,
    MID - v.y + 2,
    g.lin(0, MID, 0, v.y, [
      [0, mix(WATER, C.blue, 0.2)],
      [1, mix(DEEP, C.blue, 0.5)],
    ]),
  )
  for (const side of [0, 1] as Side[]) {
    const p = padAt(side)
    g.circle(
      p.x,
      p.y,
      520,
      g.rad(p.x, p.y, 0, 520, [
        [0, alpha(SIDE[side].main, 0.32)],
        [1, alpha(SIDE[side].main, 0)],
      ]),
    )
  }
  // Slow glints drifting over the water.
  for (let i = 0; i < 9; i++) {
    const y = 140 + i * 190 + Math.sin(now * 0.6 + i) * 20
    const x = ((i * 337 + now * (18 + (i % 3) * 8)) % 1200) - 100
    g.alpha(0.05 + 0.03 * Math.sin(now * 1.3 + i), () => g.ellipse(x, y, 54, 6, C.white))
  }
  // Ripples drift out from the middle of the pond.
  for (let k = 0; k < 3; k++) {
    const r = 120 + ((now * 60 + k * 230) % 690)
    g.ring(W / 2, MID, r, alpha(C.white, 0.12 * (1 - r / 820)), 5)
  }
  for (const side of [0, 1] as Side[]) {
    for (const [x, y, r, a] of DECOR) {
      const p = frame(side, x, y)
      const n = a + frameAngle(side) + Math.sin(now * 0.8 + x) * 0.08
      g.alpha(0.7, () => {
        g.path((c) => padPath(c, p.x, p.y + 6, r, n), alpha('#000000', 0.3))
        g.path((c) => padPath(c, p.x, p.y, r, n), mix(PAD_DARK, SIDE[side].dark, 0.3))
        g.path((c) => padPath(c, p.x, p.y - 2, r - 8, n), alpha(PAD, 0.45))
      })
    }
  }
  g.midline(alpha(C.white, 0.1))
  g.vignette(0.5)
}

function lilyPad(g: Draw, side: Side, now: number, f: Frog): void {
  const c = padAt(side)
  const notch = frameAngle(side) - Math.PI / 2
  const since = now - f.eatAt
  const splash = since >= 0 && since < 0.5 ? 1 - since / 0.5 : 0
  const bob = Math.sin(now * 2.2 + side) * 3 + splash * 6
  const y = c.y + bob
  g.path((p) => padPath(p, c.x, y + 16, PAD_R, notch), alpha('#000000', 0.35))
  g.path((p) => padPath(p, c.x, y + 8, PAD_R, notch), shade(PAD_DARK, -0.25))
  g.path(
    (p) => padPath(p, c.x, y, PAD_R, notch),
    g.rad(c.x, y, 10, PAD_R, [
      [0, shade(PAD, 0.25)],
      [0.75, PAD],
      [1, PAD_DARK],
    ]),
  )
  for (const a of [0.5, 1.3, 2.1, 2.9, 3.7, 4.4]) {
    const aa = a + frameAngle(side)
    g.line(
      c.x + Math.cos(aa) * 18,
      y + Math.sin(aa) * 18,
      c.x + Math.cos(aa) * (PAD_R - 22),
      y + Math.sin(aa) * (PAD_R - 22),
      alpha(PAD_DARK, 0.4),
      5,
    )
  }
  // Team rim: whose pad this is, without relying on colour alone (the frog's colour repeats it).
  g.arc(c.x, y, PAD_R + 12, notch + 0.5, notch - 0.5 + Math.PI * 2, alpha(SIDE[side].main, 0.55), 6)
  if (splash > 0) g.ring(c.x, y, PAD_R + (1 - splash) * 80, alpha(C.white, splash * 0.6), 8)
}

type FrogMood = 'play' | 'win' | 'lose'

/**
 * A poison-dart frog in its team colour, seen from behind its player: back
 * legs tucked, two bulging eyes on the front edge, the mouth facing the pond.
 * Drawn in world space (positions mapped through the side's frame) so the
 * gloss stays lit from the top of the screen for both frogs.
 */
function frog(
  g: Draw,
  side: Side,
  f: Frog,
  now: number,
  look: Vec,
  mood: FrogMood,
  endT: number,
): void {
  const c = padAt(side)
  const col = SIDE[side].main
  const dark = shade(col, -0.35)
  const k = side === 0 ? 1 : -1
  const sh = now - f.shotAt
  const kick = sh >= 0 && sh < 0.22 ? Math.sin((sh / 0.22) * Math.PI) : 0
  const ea = now - f.eatAt
  const chew = ea >= 0 && ea < 0.35 ? Math.sin((ea / 0.35) * Math.PI) : 0
  const breathe = Math.sin(now * 3 + side * 2) * 0.02
  const hop = mood === 'win' ? Math.abs(Math.sin(endT * 7)) : 0
  const sx = (1 + kick * 0.08 + chew * 0.12 + breathe + hop * 0.12) * (mood === 'lose' ? 0.96 : 1)
  const sy = (1 - kick * 0.1 + chew * 0.04 - breathe + hop * 0.12) * (mood === 'lose' ? 0.94 : 1)
  const bob = Math.sin(now * 2.2 + side) * 3
  const P = (lx: number, ly: number): Vec => ({
    x: c.x + k * lx * sx,
    y: c.y + bob + k * (ly - hop * 26) * sy,
  })
  const ball = (lx: number, ly: number, rx: number, ry: number, fill: string, a = 0) => {
    const p = P(lx, ly)
    const r = Math.max(rx * sx, ry * sy)
    g.ellipse(
      p.x,
      p.y,
      rx * sx,
      ry * sy,
      g.rad(
        p.x,
        p.y,
        r * 0.1,
        r,
        [
          [0, shade(fill, 0.4)],
          [0.6, fill],
          [1, shade(fill, -0.35)],
        ],
        p.x - r * 0.35,
        p.y - r * 0.4,
      ),
      a,
    )
  }
  // Contact shadow on the pad (shrinks as the winner hops).
  const s0 = P(0, 14 + hop * 26)
  g.ellipse(s0.x, s0.y, 86 * (1 - hop * 0.2), 70 * (1 - hop * 0.2), alpha('#000000', 0.3))
  for (const sd of [-1, 1]) {
    // Back legs folded at the sides, toes splayed.
    ball(sd * 66, 30, 30, 46, dark, sd * 0.5)
    for (const [tx, ty] of [
      [96, 58],
      [84, 74],
      [104, 40],
    ] as const) {
      const p = P(sd * tx, ty)
      g.circle(p.x, p.y, 9 * sx, shade(col, -0.15))
    }
    // Front feet.
    for (const [tx, ty] of [
      [66, -64],
      [80, -54],
      [58, -76],
    ] as const) {
      const p = P(sd * tx, ty)
      g.circle(p.x, p.y, 8 * sx, shade(col, -0.15))
    }
  }
  ball(0, 8, 74, 68, col)
  // Dark spots on the back.
  for (const [x, y, r] of [
    [-30, 26, 13],
    [28, 32, 11],
    [4, 50, 8],
    [-44, -4, 7],
    [42, 4, 8],
    [-6, 10, 6],
  ] as const) {
    const p = P(x, y)
    g.ellipse(p.x, p.y, r * sx, r * sy * 0.9, alpha(C.ink, 0.5))
  }
  ball(0, -42, 62, 40, col)
  const shine = P(-18, -10)
  g.alpha(0.35, () => g.ellipse(shine.x, shine.y - 6, 26, 12, C.white, -0.4))
  // Eyes on the front corners, pupils on the nearest fly (or the tongue tip).
  for (const sd of [-1, 1]) {
    const e = P(sd * 40, -62)
    g.circle(e.x, e.y, 27 * sx, dark)
    g.ball(e.x, e.y - 2, 25 * sx, col, 0.5)
    if (mood === 'win') {
      g.circle(e.x, e.y - 2, 18 * sx, C.white)
      g.arc(e.x, e.y + 4, 10 * sx, Math.PI + 0.4, -0.4, C.ink, 6)
      continue
    }
    g.circle(e.x, e.y - 2, 18 * sx, C.white)
    g.circle(e.x + look.x * 7, e.y - 2 + look.y * 7, 10 * sx, C.ink)
    g.circle(e.x + look.x * 7 - 3, e.y - 5 + look.y * 7, 3.5 * sx, C.white)
    if (mood === 'lose') {
      // Heavy lids.
      const lid = side === 0 ? 0 : Math.PI
      g.path(
        (p) => {
          p.arc(e.x, e.y - 2, 20 * sx, Math.PI + lid - 0.15, Math.PI * 2 + lid + 0.15)
          p.closePath()
        },
        shade(col, -0.1),
      )
    }
  }
  // Mouth on the front edge: a wide lip, open while the tongue is out.
  const m0 = P(-34, -78)
  const m1 = P(0, -70)
  const m2 = P(34, -78)
  const open = f.tongue.phase !== 'idle' ? 1 : kick
  if (open > 0.05) {
    const mo = P(0, -80)
    g.ellipse(mo.x, mo.y, 26 * sx, 12 * open + 4, C.ink)
  }
  g.path(
    (p) => {
      p.moveTo(m0.x, m0.y)
      p.quadraticCurveTo(m1.x, m1.y, m2.x, m2.y)
    },
    undefined,
    shade(col, -0.55),
    5,
  )
  if (chew > 0) {
    // Cheeks bulge with a fly.
    for (const sd of [-1, 1]) {
      const p = P(sd * 54, -50)
      g.circle(p.x, p.y, 14 * chew, alpha(shade(col, 0.3), 0.9))
    }
  }
}

/** The tongue as a wobbling pink rope from the mouth to a sticky tip. */
function tongue(g: Draw, side: Side, t: Tongue, now: number, len: number): void {
  if (t.phase === 'idle') return
  const m = mouth(side)
  // Drawn at its interpolated length; a fast shot stretches thinner.
  t = { ...t, len }
  const nx = -t.dy
  const ny = t.dx
  const pts: number[] = []
  const N = 18
  const amp = Math.min(1, t.len / 140) * (t.phase === 'out' ? 16 : 9)
  for (let i = 0; i <= N; i++) {
    const s = i / N
    const L = t.len * s
    const wob = Math.sin(now * 26 - s * 10) * amp * Math.sin(s * Math.PI)
    pts.push(m.x + t.dx * L + nx * wob, m.y + t.dy * L + ny * wob)
  }
  const trace = (c: CanvasRenderingContext2D, off = 0) => {
    c.lineCap = 'round'
    c.lineJoin = 'round'
    c.moveTo((pts[0] ?? 0) + off, (pts[1] ?? 0) + off)
    for (let i = 2; i < pts.length; i += 2) c.lineTo((pts[i] ?? 0) + off, (pts[i + 1] ?? 0) + off)
  }
  g.path((c) => trace(c, 10), undefined, alpha('#000000', 0.22), 30)
  g.path(trace, undefined, TONGUE_DARK, 36)
  g.path(trace, undefined, TONGUE, 24)
  g.path((c) => trace(c, -4), undefined, alpha(C.white, 0.3), 6)
  const tip = tipOf(side, t)
  g.ball(tip.x, tip.y, 27, TONGUE, 0.9)
  g.ring(tip.x, tip.y, 27, TONGUE_DARK, 4)
}

function fly(g: Draw, f: Fly, now: number, at: Vec): void {
  const held = f.held >= 0
  const x = at.x + (held ? 0 : Math.sin(now * 13 + f.id * 2.1) * 6)
  const y = at.y + (held ? 0 : Math.sin(now * 7 + f.id) * 6)
  const flap = held ? 0.25 : 0.35 + 0.65 * Math.abs(Math.sin(now * 40 + f.id))
  const body = f.golden ? C.yellow : '#3a3159'
  // Shadow on the water, far below the fly.
  g.ellipse(x + 20, y + 44, 30, 12, alpha('#000000', 0.25))
  if (f.golden) {
    const glow = 0.5 + 0.5 * Math.sin(now * 6 + f.id)
    g.circle(
      x,
      y,
      74 + glow * 10,
      g.rad(x, y, 6, 84, [
        [0, alpha(C.yellow, 0.6)],
        [1, alpha(C.yellow, 0)],
      ]),
    )
    // Twinkles orbit the golden fly.
    for (let i = 0; i < 3; i++) {
      const a = now * 3 + (i * Math.PI * 2) / 3 + f.id
      const tw = 0.5 + 0.5 * Math.sin(now * 9 + i * 2)
      g.star(x + Math.cos(a) * 52, y + Math.sin(a) * 40, 6 + tw * 8, C.white, 4, 0.35)
    }
  }
  const wing = alpha(f.golden ? '#ffffff' : '#dff4ff', f.golden ? 0.9 : 0.7)
  g.ellipse(x - 24, y - 12, 32 * flap, 18, wing, -0.45)
  g.ellipse(x + 24, y - 12, 32 * flap, 18, wing, 0.45)
  g.ball(x, y + 4, 21, body, 0.7)
  g.line(x - 14, y + 2, x + 14, y + 2, alpha(C.ink, f.golden ? 0.4 : 0.6), 4)
  g.line(x - 13, y + 12, x + 13, y + 12, alpha(C.ink, f.golden ? 0.4 : 0.6), 4)
  g.ball(x, y - 18, 13, f.golden ? shade(C.yellow, -0.1) : '#2a2243', 0.8)
  const eye = f.golden ? '#ff5c7a' : '#ff4b5c'
  g.circle(x - 7, y - 22, 6, eye)
  g.circle(x + 7, y - 22, 6, eye)
  g.circle(x - 8, y - 24, 2, alpha(C.white, 0.8))
  g.circle(x + 6, y - 24, 2, alpha(C.white, 0.8))
}

/** Seconds left as a round badge on the right edge (across from the pause button), one per reader. */
function timer(g: Draw, left: number, total: number): void {
  const s = Math.max(0, Math.ceil(left))
  const urgent = left <= 5 && left > 0
  const tick = urgent ? Math.max(0, (left % 1) - 0.7) / 0.3 : 0
  const col = urgent ? C.yellow : C.white
  const x = W - 82
  const draw = (angle: number, cy: number) =>
    g.at(
      x,
      cy,
      angle,
      () => {
        g.circle(0, 4, 54, alpha('#000000', 0.3))
        g.circle(0, 0, 54, alpha(C.ink, 0.85))
        g.arc(0, 0, 46, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * left) / total, col, 7)
        g.text(s, 0, 3, { size: 44, weight: 700, color: col })
      },
      1 + tick * 0.18,
    )
  if (g.flipTop) {
    draw(0, MID + 62)
    draw(Math.PI, MID - 62)
  } else draw(g.orient(), MID)
}

export interface RenderOpts {
  names: [string, string]
  left: number
  /** Length of the match in seconds (the clock's full circle). */
  total: number
  /** Game time the clock ran out (-1 while playing). */
  endAt: number
  /** Interpolation between the last two steps, and the tongue lengths at the last one. */
  alpha: number
  prevLen: [number, number]
  /** The last seconds' frenzy is on. */
  frenzy: boolean
}

/** Where a frog's eyes point: its tongue tip when out, else the nearest free fly. */
function lookFor(s: World, side: Side): Vec {
  const m = mouth(side)
  const t = s.frogs[side].tongue
  let target: Vec | null = t.phase !== 'idle' ? tipOf(side, t) : null
  if (!target) {
    let best = Infinity
    for (const f of s.flies) {
      if (f.held >= 0) continue
      const d = Math.hypot(f.x - m.x, f.y - m.y)
      if (d < best) {
        best = d
        target = f
      }
    }
  }
  if (!target) return { x: 0, y: side === 0 ? -1 : 1 }
  const dx = target.x - m.x
  const dy = target.y - m.y
  const d = Math.hypot(dx, dy) || 1
  return { x: dx / d, y: dy / d }
}

/** The whole table: pond, lily pads, frogs, tongues, flies and HUD. */
export function renderField(g: Draw, s: World, now: number, o: RenderOpts): void {
  pond(g, now)
  if (o.frenzy) {
    // Frenzy: the pond glows gold at its edges.
    const pulse = 0.5 + 0.5 * Math.sin(now * 8)
    g.alpha(0.1 + 0.08 * pulse, () => g.vignette(0.9))
    g.fillView(
      g.rad(W / 2, MID, 300, 1100, [
        [0, alpha(C.yellow, 0)],
        [1, alpha(C.yellow, 0.1 + 0.06 * pulse)],
      ]),
    )
  }
  const over = o.endAt >= 0
  const endT = over ? now - o.endAt : 0
  const [a, b] = [s.frogs[0].score, s.frogs[1].score]
  for (const side of [0, 1] as Side[]) lilyPad(g, side, now, s.frogs[side])
  for (const side of [0, 1] as Side[]) {
    const mine = s.frogs[side].score
    const theirs = side === 0 ? b : a
    const mood: FrogMood = !over ? 'play' : mine > theirs ? 'win' : mine < theirs ? 'lose' : 'play'
    frog(g, side, s.frogs[side], now, lookFor(s, side), mood, endT)
  }
  // Between fixed steps: free flies keep flying, tongues keep stretching.
  const back = (1 - o.alpha) * STEP
  const lens = ([0, 1] as Side[]).map((side) => {
    const t = s.frogs[side].tongue
    const p = o.prevLen[side] ?? t.len
    return t.phase === 'idle' ? 0 : p + (t.len - p) * o.alpha
  })
  for (const f of s.flies)
    if (f.held < 0) fly(g, f, now, over ? f : { x: f.x - f.vx * back, y: f.y - f.vy * back })
  for (const side of [0, 1] as Side[]) tongue(g, side, s.frogs[side].tongue, now, lens[side] ?? 0)
  // Flies on a tongue ride on top of it, on its interpolated tip.
  for (const f of s.flies)
    if (f.held >= 0) {
      const side = f.held as Side
      const t = s.frogs[side].tongue
      fly(g, f, now, tipOf(side, { ...t, len: lens[side] ?? t.len }))
    }

  // Start-of-match prompts, each facing its player.
  const intro = 1 - Math.max(0, (now - 2.4) / 0.6)
  if (intro > 0) {
    for (const side of [0, 1] as Side[]) {
      // Online, each phone prompts only its own player.
      if (g.viewer !== null && side !== g.viewer) continue
      const y = side === 0 ? 1270 : 530
      g.alpha(intro, () => {
        g.sideText(side, 'Tap a fly, or flick!', W / 2, y, {
          size: 54,
          weight: 700,
          color: C.white,
          stroke: alpha(SIDE[side].dark, 0.9),
          strokeWidth: 12,
        })
        g.sideText(side, 'Golden fly = 3', W / 2, y + (side === 0 ? 68 : -68), {
          size: 42,
          weight: 700,
          color: C.yellow,
          stroke: alpha(C.ink, 0.7),
          strokeWidth: 10,
        })
      })
    }
  }

  timer(g, o.left, o.total)
  for (const side of [0, 1] as Side[]) {
    const f = s.frogs[side]
    const busy = f.tongue.phase !== 'idle'
    namePill(g, side, o.names[side], { active: busy })
    const since = now - f.catchAt
    const pop = f.catchAt >= 0 && since < 0.35 ? 1 - since / 0.35 : 0
    bigScore(g, side, f.score, { x: frame(side, 140, 0).x, size: 84 * (1 + pop * 0.4) })
  }

  if (over) {
    const t = Math.min(1, endT / 0.35)
    g.at(
      W / 2,
      MID,
      0,
      () =>
        g.at(-W / 2, -MID, 0, () =>
          banner(g, undefined, 'Time!', MID, { size: 72, alpha: Math.min(1, endT * 5) }),
        ),
      0.4 + 0.6 * outBack(t),
    )
  }
}
