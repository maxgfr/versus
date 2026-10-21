import { other, type Side } from '../../core/game.ts'
import { clamp, outCubic } from '../../core/fx/ease.ts'
import type { Draw, Mood } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { W } from '../../core/stage.ts'
import type { BodySnap } from '../../engines/ragdoll/index.ts'
import { HEAD_R, RING, SCALE, STAND_Y } from './rules.ts'
import { partKind } from './sim.ts'

/** Everything the scene needs, read from state (never written). */
export interface SceneView {
  bodies: BodySnap[]
  phase: 'fight' | 'down'
  /** Seconds since the phase began. */
  phaseAge: number
  winner: Side | 'draw' | null
  /** The match winner once decided. */
  champ: Side | null
  /** Seconds since each wrestler's last jump and since the last big clash. */
  tapAge: [number, number]
  clashAge: number
  clash: [number, number]
  time: number
  loading: boolean
}

const SKIN = '#ffd7a8'
const BOOT = '#1b1433'
const NIGHT = '#17112e'
/** Top of the hall behind the ring; the band runs from here to RING.bottom. */
export const BAND_TOP = RING.top - 120
const POST_X: [number, number] = [RING.left - 30, RING.right + 30]

function fan(g: Draw, x: number, y: number, col: string, k: number): void {
  const shirt = k % 3 === 0 ? shade(col, 0.2) : k % 3 === 1 ? col : shade(col, -0.25)
  g.rrect(x - 12, y + 5, 24, 24, 10, shirt)
  g.circle(x, y, 10, k % 4 === 0 ? '#c99a6b' : k % 4 === 1 ? '#ffd7a8' : '#8d5a3b')
}

/** The hall: crowd in team ends, spotlights, darkness over the ropes. */
function hall(g: Draw, v: SceneView): void {
  const top = BAND_TOP
  g.rect(
    -1000,
    top,
    W + 2000,
    RING.mat - top,
    g.lin(0, top, 0, RING.mat, [
      [0, '#120d26'],
      [0.35, '#221a45'],
      [1, NIGHT],
    ]),
  )
  const roundWin = v.phase === 'down' && v.winner !== null && v.winner !== 'draw' ? v.winner : null
  const cheer = roundWin !== null ? Math.max(0, 1 - v.phaseAge / 1.6) : 0
  for (let r = 0; r < 3; r++) {
    const y = top + 30 + r * 32
    for (let i = 0; i < 42; i++) {
      const x = -30 + i * 26 + (r % 2) * 13
      const end: Side | null = x < W * 0.4 ? 0 : x > W * 0.6 ? 1 : null
      const col = end === null ? C.mute : SIDE[end].main
      let hop = Math.sin(v.time * 3 + i * 1.3 + r) * 1.5
      if (end !== null && end === roundWin)
        hop -= Math.abs(Math.sin(v.time * 14 + i * 0.8 + r * 2)) * 12 * cheer
      if (end !== null && end === v.champ) hop -= Math.abs(Math.sin(v.time * 12 + i + r)) * 10
      // A clash makes everybody flinch.
      hop -= clamp(1 - v.clashAge / 0.25, 0, 1) * 5
      fan(g, x, y + hop, col, i + r * 5)
    }
  }
  g.rect(-1000, top, W + 2000, 120, alpha(NIGHT, 0.3 * (1 - cheer)))
  // Camera flashes from the crowd on a big moment.
  if (v.clashAge < 0.2 || (v.phase === 'down' && v.phaseAge < 0.5)) {
    for (let i = 0; i < 4; i++) {
      const fx = ((i * 263 + Math.floor(v.time * 20) * 97) % 1000) | 0
      g.circle(fx, top + 40 + ((i * 41) % 60), 12, alpha('#ffffff', 0.7))
    }
  }
  g.rect(-1000, top - 12, W + 2000, 14, '#2c2350')
}

/** Spotlight cones meeting in the middle of the ring. */
function spotlights(g: Draw, v: SceneView): void {
  const c = g.ctx
  c.save()
  c.globalCompositeOperation = 'lighter'
  for (const side of [0, 1] as const) {
    const x = side === 0 ? 120 : W - 120
    const y = RING.top - 20
    const sway = Math.sin(v.time * 0.7 + side * 2) * 40
    const tx = W / 2 + (side === 0 ? -60 : 60) + sway
    g.poly(
      [x - 20, y, x + 20, y, tx + 170, RING.mat, tx - 170, RING.mat],
      g.lin(x, y, tx, RING.mat, [
        [0, 'rgba(255,244,214,0.18)'],
        [1, 'rgba(255,244,214,0.03)'],
      ]),
    )
  }
  g.ellipse(
    W / 2,
    RING.mat + 4,
    380,
    34,
    g.rad(W / 2, RING.mat, 10, 380, [
      [0, 'rgba(255,248,220,0.2)'],
      [1, 'rgba(255,248,220,0)'],
    ]),
  )
  c.restore()
}

/** Corner posts with padded turnbuckles in each team's colour. */
function posts(g: Draw): void {
  const postY = RING.top - 40
  for (const owner of [0, 1] as Side[]) {
    const x = POST_X[owner]
    const col = SIDE[owner].main
    g.rrect(x - 13, postY, 26, RING.mat - postY + 30, 10, '#cfc8de')
    g.rect(x - 6, postY + 4, 5, RING.mat - postY + 20, alpha('#ffffff', 0.6))
    // Turnbuckle pads at each rope.
    for (const k of [0, 1, 2]) {
      const y = ropeY(k)
      g.tile(x - 24, y - 26, 48, 56, 16, col, 8)
      if (k === 2) g.sideMark(owner, x, y - 2, 9, C.white)
    }
  }
}

const ropeY = (k: number): number => RING.mat - 150 - k * 110

/** Three ropes that sag in the middle and bounce when a wrestler is thrown at them. */
function ropes(g: Draw, v: SceneView): void {
  const x0 = POST_X[0] + 20
  const x1 = POST_X[1] - 20
  const kick = clamp(1 - v.clashAge / 0.5, 0, 1)
  for (const k of [2, 1, 0]) {
    const y = ropeY(k)
    const sag = 10 + Math.sin(v.time * 18 + k) * 10 * kick
    const col = k === 1 ? C.white : k === 2 ? SIDE[0].light : SIDE[1].light
    const path = (c: CanvasRenderingContext2D, dy: number) => {
      c.moveTo(x0, y + dy)
      c.quadraticCurveTo(W / 2, y + sag * 2 + dy, x1, y + dy)
    }
    g.path((c) => path(c, 7), undefined, alpha('#000000', 0.35), 16)
    g.path((c) => path(c, 0), undefined, k === 1 ? col : shade(col, -0.05), 13)
    g.path((c) => path(c, -3), undefined, alpha('#ffffff', 0.45), 3)
  }
}

/** The canvas, the apron skirt owned half by each side, and the steps. */
function ring(g: Draw): void {
  // Canvas top: a lit strip.
  g.rect(-1000, RING.mat, W + 2000, 26, '#e9e4f0')
  g.rect(
    -1000,
    RING.mat,
    W + 2000,
    26,
    g.lin(0, RING.mat, 0, RING.mat + 26, [
      [0, 'rgba(255,255,255,0.5)'],
      [1, 'rgba(0,0,0,0.12)'],
    ]),
  )
  // Apron: each half owned by its side.
  const top = RING.mat + 26
  const h = RING.bottom - top
  for (const side of [0, 1] as Side[]) {
    const col = SIDE[side].main
    const x = side === 0 ? -1000 : W / 2
    g.rect(
      x,
      top,
      1000 + W / 2,
      h,
      g.lin(0, top, 0, RING.bottom, [
        [0, shade(col, -0.25)],
        [1, shade(col, -0.6)],
      ]),
    )
    // Skirt folds.
    for (let fx = side === 0 ? 30 : W / 2 + 30; fx < (side === 0 ? W / 2 : W); fx += 60)
      g.rect(fx, top, 3, h, alpha('#000000', 0.12))
    // A big team badge on each half.
    const bx = side === 0 ? W * 0.27 : W * 0.73
    g.disc(bx, top + h / 2 - 6, 46, shade(col, 0.1), 7)
    g.sideMark(side, bx, top + h / 2 - 6, 20, C.white)
  }
  // Centre seam with a star.
  g.rect(W / 2 - 4, top, 8, h, alpha('#000000', 0.3))
  g.star(W / 2, top + h / 2 - 6, 34, C.yellow)
  g.rect(-1000, top, W + 2000, 8, alpha('#000000', 0.25))
  g.rect(-1000, RING.bottom - 12, W + 2000, 12, alpha('#000000', 0.35))
}

/** Shadow under a wrestler, shrinking as it leaves the mat. */
function shadow(g: Draw, x: number, y: number): void {
  const f = clamp((STAND_Y - y) / 200, 0, 1)
  g.shadow(x, RING.mat + 10, 86 * (1 - f * 0.5), 15 * (1 - f * 0.5), 0.38 * (1 - f * 0.7))
}

/** One wrestler: legs, torso (singlet), arms with gloves, and a head with a headband. */
function wrestler(
  g: Draw,
  side: Side,
  parts: BodySnap[],
  mood: Mood,
  look: number,
  v: SceneView,
): void {
  const col = SIDE[side].main
  const p = (i: number) => parts.find((b) => b.k === partKind(side, i))
  const head = p(0)
  const torso = p(1)
  const armL = p(2)
  const armR = p(3)
  const legL = p(4)
  const legR = p(5)
  if (!head || !torso) return
  shadow(g, torso.x, torso.y)
  const limb = (b: BodySnap | undefined, draw: () => void) => {
    if (b) g.at(b.x, b.y, b.a, draw)
  }
  const k = SCALE
  // Arm furthest from the rival goes behind the body.
  const [backArm, frontArm] = look > 0 ? [armL, armR] : [armR, armL]
  const arm = (b: BodySnap | undefined) =>
    limb(b, () => {
      g.rrect(-10 * k, -30 * k, 20 * k, 56 * k, 10 * k, SKIN)
      g.rrect(-10 * k, -30 * k, 7 * k, 50 * k, 4 * k, alpha('#ffffff', 0.25))
      g.rrect(-11 * k, 6 * k, 22 * k, 9 * k, 4, shade(col, -0.2))
      g.ball(0, 27 * k, 14 * k, col, 0.9)
    })
  arm(backArm)
  // Legs: trunks at the top, knee pads, boots.
  for (const leg of [legL, legR]) {
    limb(leg, () => {
      g.rrect(-11 * k, -35 * k, 22 * k, 70 * k, 10 * k, SKIN)
      g.rrect(-12 * k, -36 * k, 24 * k, 26 * k, 8 * k, shade(col, -0.45))
      g.rrect(-12 * k, 2 * k, 24 * k, 14 * k, 6 * k, '#f3eefa')
      g.rrect(-12 * k, 18 * k, 24 * k, 22 * k, 8 * k, BOOT)
      g.ellipse(-3 * k, 22 * k, 5 * k, 3 * k, alpha('#ffffff', 0.35))
    })
  }
  // Torso: a glossy singlet in the owner's colour, trunks at the hips, a belt.
  g.at(torso.x, torso.y, torso.a, () => {
    const w = 46 * k
    const h = 90 * k
    g.rrect(-w / 2, -h / 2 + 6, w, h, 18, shade(col, -0.45))
    g.rrect(
      -w / 2,
      -h / 2,
      w,
      h,
      18,
      g.lin(-w / 2, 0, w / 2, 0, [
        [0, shade(col, 0.2)],
        [0.55, col],
        [1, shade(col, -0.22)],
      ]),
    )
    // Bare shoulders and a strap.
    g.rrect(-w / 2 + 2, -h / 2, w - 4, 16, 10, SKIN)
    g.rect(-w / 2 + 8, -h / 2, 8, 18, col)
    g.rect(w / 2 - 16, -h / 2, 8, 18, col)
    g.rrect(-w / 2, h * 0.12, w, h * 0.38, 14, shade(col, -0.5))
    g.rrect(-w / 2, h * 0.1, w, 10, 5, C.yellow)
    g.sideMark(side, 0, -h * 0.12, 11, C.white)
    g.alpha(0.4, () => g.ellipse(-w * 0.22, -h * 0.22, w * 0.14, h * 0.12, '#ffffff', -0.4))
  })
  arm(frontArm)
  // Head: a face with a headband in the owner's colour.
  const r = HEAD_R * 1.04
  const hit = clamp(1 - v.clashAge / 0.2, 0, 1)
  g.blob(head.x, head.y, r, SKIN, {
    mood,
    look: [look, 0.1],
    angle: head.a,
    cheeks: true,
    sx: 1 + hit * 0.1,
    sy: 1 - hit * 0.1,
  })
  g.at(head.x, head.y, head.a, () => {
    g.arc(0, -r * 0.05, r * 0.86, Math.PI * 1.1, Math.PI * 1.9, col, r * 0.36)
    g.arc(0, -r * 0.05, r * 0.86, Math.PI * 1.1, Math.PI * 1.9, alpha('#ffffff', 0.25), r * 0.08)
    // Fierce brows while the fight is on.
    if (mood === 'happy' && v.phase === 'fight') {
      for (const sx of [-1, 1])
        g.line(sx * r * 0.52, -r * 0.44, sx * r * 0.1, -r * 0.27, C.ink, r * 0.12)
    }
    // Headband tails flying behind.
    const tail = -look
    const flap = Math.sin(v.time * 12 + side) * 6
    g.line(tail * r * 0.8, -r * 0.35, tail * (r * 1.35), -r * 0.2 + flap, col, 8)
    g.line(tail * r * 0.8, -r * 0.3, tail * (r * 1.25), r * 0.05 - flap, shade(col, -0.2), 7)
  })
}

/** Little stars circling a beaten wrestler's head. */
function dizzy(g: Draw, x: number, y: number, t: number): void {
  for (let i = 0; i < 4; i++) {
    const a = t * 5 + (i * Math.PI) / 2
    const sx = x + Math.cos(a) * 52
    const sy = y - 46 + Math.sin(a) * 14
    g.star(sx, sy, 13, i % 2 ? C.yellow : C.white)
  }
}

export function drawScene(g: Draw, v: SceneView): void {
  hall(g, v)
  spotlights(g, v)
  ropes(g, v)
  posts(g)
  ring(g)
  const loser =
    v.phase === 'down' && v.winner !== null && v.winner !== 'draw' ? other(v.winner) : null
  for (const side of [0, 1] as Side[]) {
    const parts = v.bodies.filter((b) => b.k >= partKind(side, 0) && b.k <= partKind(side, 5))
    const torso = parts.find((b) => b.k === partKind(side, 1))
    const rivalTorso = v.bodies.find((b) => b.k === partKind(other(side), 1))
    const look = rivalTorso && torso && rivalTorso.x > torso.x ? 1 : -1
    let mood: Mood = v.tapAge[side] < 0.35 ? 'wow' : 'happy'
    if (v.phase === 'down') {
      if (v.winner === 'draw') mood = 'wow'
      else if (v.winner !== null) mood = v.winner === side ? 'grin' : 'dizzy'
    }
    if (v.champ !== null) mood = v.champ === side ? 'grin' : 'dizzy'
    wrestler(g, side, parts, mood, look, v)
  }
  if (loser !== null) {
    const head = v.bodies.find((b) => b.k === partKind(loser, 0))
    if (head) dizzy(g, head.x, head.y, v.time)
  }
  // Impact star where the wrestlers clashed.
  if (v.clashAge < 0.25) {
    const t = v.clashAge / 0.25
    g.alpha(1 - t, () => {
      g.star(v.clash[0], v.clash[1], 40 + outCubic(t) * 50, C.yellow, 8, 0.45, t * 2)
      g.star(v.clash[0], v.clash[1], 20 + outCubic(t) * 26, C.white, 8, 0.45, t * 2)
    })
  }
  // Vignette over the band only, so the pads stay clean.
  g.rect(
    -1000,
    BAND_TOP - 12,
    W + 2000,
    RING.bottom - BAND_TOP + 12,
    g.lin(0, BAND_TOP, 0, RING.bottom, [
      [0, 'rgba(0,0,0,0.25)'],
      [0.2, 'rgba(0,0,0,0)'],
      [0.85, 'rgba(0,0,0,0)'],
      [1, 'rgba(0,0,0,0.3)'],
    ]),
  )
  if (v.loading) g.both('Loading…', { size: 48, color: shade(C.white, -0.2) })
}
