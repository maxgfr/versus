import { other, type Side } from '../../core/game.ts'
import { clamp, outCubic } from '../../core/fx/ease.ts'
import type { Draw, Mood } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { W } from '../../core/stage.ts'
import type { BodySnap } from '../../engines/ragdoll/index.ts'
import { BALL_R, BODY, GOAL_TOP, HEAD_R, KICK_TIME, PITCH } from './rules.ts'
import { KIND } from './sim.ts'

/** Everything the scene needs, read from state (never written). */
export interface SceneView {
  bodies: BodySnap[]
  phase: 'play' | 'goal'
  /** Seconds since the phase began. */
  phaseAge: number
  scorer: Side
  kick: [number, number]
  /** Seconds since each player's kick last connected. */
  hitAge: [number, number]
  /** Power 0..1 of each player's last connecting kick. */
  power: [number, number]
  /** Wind-up of each player's current kick, and whether it is still growing. */
  charge: [number, number]
  winding: [boolean, boolean]
  /** Seconds since each player's last hop and landing; how hard that landing was. */
  hopAge: [number, number]
  landAge: [number, number]
  landK: [number, number]
  /** Seconds since the ball's last hard knock and how hard (0..1). */
  bumpAge: number
  bumpK: number
  /** Ball squash spring (1 = round), cosmetic. */
  squash: number
  /** Recent ball positions, oldest first, while it flies fast. */
  trail: readonly { x: number; y: number }[]
  /** Ball velocity, per step. */
  bv: [number, number]
  /** How heated the match is, 0..1: the ball glows and its trail burns. */
  heat: number
  time: number
  loading: boolean
  /** The match is decided: the winner (if any) celebrates. */
  winner: Side | null
}

const GRASS_A = '#2a8a43'
const GRASS_B = '#35a04f'
const SKIN = '#ffd7a8'
const BOOT = '#1b1433'
const NIGHT = '#17112e'

/** Top of the stands; the band runs from here to PITCH.bottom. */
export const BAND_TOP = PITCH.ceil - 160

/** A small supporter: a head over shoulders in the team colour. */
function fan(g: Draw, x: number, y: number, col: string, k: number): void {
  const shirt = k % 3 === 0 ? shade(col, 0.2) : k % 3 === 1 ? col : shade(col, -0.25)
  g.rrect(x - 11, y + 4, 22, 22, 9, shirt)
  g.circle(x, y, 9, k % 4 === 0 ? '#c99a6b' : k % 4 === 1 ? '#ffd7a8' : '#8d5a3b')
}

/**
 * The stands above the ceiling: red supporters at red's end (left), blue at
 * blue's, neutral seats in between. A goal makes the scorer's end jump.
 */
function stands(g: Draw, v: SceneView): void {
  const top = BAND_TOP
  const h = PITCH.ceil - top
  g.rect(
    -1000,
    top,
    W + 2000,
    h,
    g.lin(0, top, 0, PITCH.ceil, [
      [0, '#120d26'],
      [1, '#241a47'],
    ]),
  )
  // Tiers.
  for (let r = 0; r < 4; r++) g.rect(-1000, top + 34 + r * 30, W + 2000, 4, alpha('#000000', 0.25))
  const cheer = v.phase === 'goal' ? Math.max(0, 1 - v.phaseAge / 1.6) : 0
  const win = v.winner
  for (let r = 0; r < 4; r++) {
    const y = top + 26 + r * 30
    for (let i = 0; i < 44; i++) {
      const x = -40 + i * 25 + (r % 2) * 12
      const end: Side | null = x < W * 0.42 ? 0 : x > W * 0.58 ? 1 : null
      const col = end === null ? C.mute : SIDE[end].main
      let hop = Math.sin(v.time * 3 + i * 1.7 + r) * 1.5
      if (end !== null && (v.scorer === end ? cheer : 0) > 0)
        hop -= Math.abs(Math.sin(v.time * 14 + i * 0.8 + r * 2)) * 12 * cheer
      if (end !== null && win === end) hop -= Math.abs(Math.sin(v.time * 12 + i + r)) * 10
      fan(g, x, y + hop, col, i + r)
    }
  }
  // Under the roof's shade: the crowd stays behind the action.
  g.rect(-1000, top, W + 2000, h, alpha(NIGHT, 0.3 * (1 - cheer)))
  // Flags waving at each end.
  for (const side of [0, 1] as Side[]) {
    for (const fx of side === 0 ? [90, 260] : [W - 90, W - 260]) {
      const fy = top + 20
      const wave = Math.sin(v.time * 4 + fx) * 10
      g.line(fx, fy, fx, fy + 70, alpha(C.white, 0.6), 4)
      g.poly([fx, fy, fx + 56, fy + 10 + wave, fx, fy + 30], SIDE[side].main)
      g.sideMark(side, fx + 18, fy + 14, 6, C.white)
    }
  }
  // Roof edge and the advertising rail.
  g.rect(-1000, top - 12, W + 2000, 14, '#2c2350')
  g.rect(-1000, PITCH.ceil - 14, W + 2000, 14, '#0f0b1f')
  g.rect(-1000, PITCH.ceil - 14, W + 2000, 3, alpha(C.white, 0.2))
}

/** Two floodlight rigs over the corners with soft cones on the pitch. */
function floodlights(g: Draw, v: SceneView): void {
  const c = g.ctx
  c.save()
  c.globalCompositeOperation = 'lighter'
  for (const side of [0, 1] as const) {
    const lx = side === 0 ? PITCH.left + 20 : PITCH.right - 20
    const ly = PITCH.ceil
    const tx = side === 0 ? W * 0.62 : W * 0.38
    g.poly(
      [lx - 30, ly, lx + 30, ly, tx + 200, PITCH.ground, tx - 200, PITCH.ground],
      g.lin(lx, ly, tx, PITCH.ground, [
        [0, 'rgba(255,244,214,0.16)'],
        [1, 'rgba(255,244,214,0.02)'],
      ]),
    )
  }
  // A pool of light on the grass.
  g.ellipse(
    W / 2,
    PITCH.ground,
    460,
    60,
    g.rad(W / 2, PITCH.ground, 10, 460, [
      [0, 'rgba(255,248,220,0.14)'],
      [1, 'rgba(255,248,220,0)'],
    ]),
  )
  c.restore()
  for (const side of [0, 1] as const) {
    const lx = side === 0 ? 70 : W - 70
    const ly = BAND_TOP - 40
    g.rect(lx - 5, ly, 10, 50, '#3a3159')
    g.rrect(lx - 54, ly - 34, 108, 50, 12, '#2a2243', alpha(C.white, 0.25), 3)
    for (let i = 0; i < 3; i++) {
      const bx = lx - 32 + i * 32
      const flick = 0.85 + 0.15 * Math.sin(v.time * 9 + i * 2 + side)
      g.circle(bx, ly - 9, 18, alpha('#fff4d6', 0.25 * flick))
      g.circle(bx, ly - 9, 11, '#fff8ef')
    }
  }
}

/** Night air over the pitch, each end tinted by the team that defends it. */
function air(g: Draw): void {
  g.rect(
    -1000,
    PITCH.ceil,
    W + 2000,
    PITCH.ground - PITCH.ceil,
    g.lin(0, PITCH.ceil, 0, PITCH.ground, [
      [0, '#2a1f57'],
      [1, NIGHT],
    ]),
  )
  for (const side of [0, 1] as Side[]) {
    const x0 = side === 0 ? PITCH.left : PITCH.right
    const x1 = side === 0 ? PITCH.left + 330 : PITCH.right - 330
    g.rect(
      Math.min(x0, x1),
      PITCH.ceil,
      330,
      PITCH.ground - PITCH.ceil,
      g.lin(x0, 0, x1, 0, [
        [0, alpha(SIDE[side].main, 0.22)],
        [1, alpha(SIDE[side].main, 0)],
      ]),
    )
  }
}

/** The end walls behind each goal, owned by the team that defends it. */
function ends(g: Draw): void {
  for (const side of [0, 1] as Side[]) {
    const col = SIDE[side].main
    const x0 = side === 0 ? -1000 : PITCH.right
    const w = side === 0 ? 1000 + PITCH.left : 1000 + W - PITCH.right
    g.rect(
      x0,
      PITCH.ceil,
      w,
      PITCH.ground - PITCH.ceil,
      g.lin(0, PITCH.ceil, 0, PITCH.ground, [
        [0, shade(col, -0.68)],
        [1, shade(col, -0.78)],
      ]),
    )
    // Padding stripes and the team mark, upright for everyone.
    const edge = side === 0 ? PITCH.left : PITCH.right
    g.rect(
      edge - (side === 0 ? 10 : 0),
      PITCH.ceil,
      10,
      PITCH.ground - PITCH.ceil,
      shade(col, -0.45),
    )
    const cx = side === 0 ? PITCH.left / 2 : (W + PITCH.right) / 2
    for (let k = 0; k < 3; k++)
      g.sideMark(side, cx, PITCH.ceil + 70 + k * 46, 9, alpha(col, 0.55 - k * 0.12))
  }
}

/** Grass with mowing stripes, the touchline and the centre spot. */
function pitch(g: Draw): void {
  const h = PITCH.bottom - PITCH.ground
  for (let x = PITCH.left, i = 0; x < PITCH.right; x += 130, i++) {
    g.rect(x, PITCH.ground, Math.min(130, PITCH.right - x), h, i % 2 ? GRASS_A : GRASS_B)
  }
  // Running track beyond each goal.
  g.rect(-1000, PITCH.ground, 1000 + PITCH.left, h, '#7a3b3b')
  g.rect(PITCH.right, PITCH.ground, 1000 + W - PITCH.right, h, '#3b4f7a')
  g.rect(
    -1000,
    PITCH.ground,
    W + 2000,
    h,
    g.lin(0, PITCH.ground, 0, PITCH.bottom, [
      [0, 'rgba(255,255,255,0.08)'],
      [0.25, 'rgba(0,0,0,0)'],
      [1, 'rgba(0,0,0,0.35)'],
    ]),
  )
  g.rect(PITCH.left, PITCH.ground, PITCH.right - PITCH.left, 5, alpha(C.white, 0.8))
  // Halfway line, seen side-on, and the centre spot.
  g.rect(W / 2 - 3, PITCH.ground, 6, h - 16, alpha(C.white, 0.22))
  g.path(
    (c) => c.ellipse(W / 2, PITCH.ground + 40, 120, 22, 0, 0, Math.PI * 2),
    undefined,
    alpha(C.white, 0.22),
    5,
  )
  g.rect(-1000, PITCH.bottom - 16, W + 2000, 16, shade(GRASS_A, -0.5))
}

/** The goal frame's back post, floor and net, behind the ball. A goal billows the net. */
function goalBack(g: Draw, owner: Side, v: SceneView): void {
  const back = owner === 0 ? PITCH.left : PITCH.right
  const mouth = owner === 0 ? PITCH.left + PITCH.goalD : PITCH.right - PITCH.goalD
  const x0 = Math.min(back, mouth)
  const w = PITCH.goalD
  const base = PITCH.ground
  const conceded = v.phase === 'goal' && other(v.scorer) === owner
  const k = conceded ? Math.max(0, 1 - v.phaseAge / 1.2) : 0
  const out = owner === 0 ? -1 : 1
  g.rect(x0, GOAL_TOP, w, base - GOAL_TOP, alpha(SIDE[owner].main, 0.18 + k * 0.25))
  // Net mesh: verticals billow outwards on a goal.
  const net = alpha(C.white, 0.32 + k * 0.3)
  for (let i = 1; i < 8; i++) {
    const t = i / 8
    const x = x0 + w * t
    const bulge = Math.sin(t * Math.PI) * k * 26 * Math.sin(v.phaseAge * 18) * out
    g.path(
      (c) => {
        c.moveTo(x, GOAL_TOP + 6)
        c.quadraticCurveTo(x + bulge, (GOAL_TOP + base) / 2, x, base)
      },
      undefined,
      net,
      2,
    )
  }
  for (let y = GOAL_TOP + 16; y < base; y += 16) {
    const wob = k * 14 * Math.sin(v.phaseAge * 18 + y * 0.05) * out
    g.path(
      (c) => {
        c.moveTo(x0, y)
        c.quadraticCurveTo(x0 + w / 2 + wob, y + wob * 0.3, x0 + w, y)
      },
      undefined,
      net,
      2,
    )
  }
  // Back post.
  g.rrect(back - 7, GOAL_TOP - 4, 14, base - GOAL_TOP + 4, 6, '#d9d3e6')
  g.rect(back - 2, GOAL_TOP, 4, base - GOAL_TOP, alpha('#ffffff', 0.7))
}

/** The crossbar, front post and owner's marker, in front of the ball. */
function goalFront(g: Draw, owner: Side, v: SceneView): void {
  const back = owner === 0 ? PITCH.left : PITCH.right
  const mouth = owner === 0 ? PITCH.left + PITCH.goalD : PITCH.right - PITCH.goalD
  const x0 = Math.min(back, mouth)
  const w = PITCH.goalD
  const col = SIDE[owner].main
  const conceded = v.phase === 'goal' && other(v.scorer) === owner
  const k = conceded ? Math.max(0, 1 - v.phaseAge / 1.2) : 0
  // Front post: thin, so the ball still reads behind it.
  g.rrect(mouth - 6, GOAL_TOP, 12, PITCH.ground - GOAL_TOP, 6, alpha('#f3eefa', 0.85))
  g.rect(mouth - 2, GOAL_TOP, 3, PITCH.ground - GOAL_TOP, alpha('#ffffff', 0.9))
  // Crossbar in the owner's colour, flashing on a goal.
  const bar = k > 0 && Math.sin(v.phaseAge * 30) > 0 ? C.yellow : col
  g.tile(x0 - 10, GOAL_TOP - 14, w + 20, 34, 12, bar, 8)
  // Owner's badge on a little flag above the goal.
  const fy = GOAL_TOP - 70
  const fx = x0 + w / 2
  g.line(fx, fy - 8, fx, GOAL_TOP - 14, alpha(C.white, 0.7), 4)
  g.disc(fx, fy - 18, 22, shade(col, -0.2), 5)
  g.sideMark(owner, fx, fy - 18, 10, C.white)
}

/** Shadow under a player; it shrinks and fades the higher they hop. */
function shadow(g: Draw, x: number, y: number): void {
  const f = clamp((PITCH.ground - 60 - y) / 260, 0, 1)
  g.shadow(x, PITCH.ground + 6, 60 * (1 - f * 0.5), 13 * (1 - f * 0.5), 0.4 * (1 - f * 0.7))
}

/** The ball: glossy, spinning, stretched along its flight, with a trail when it flies. */
function ball(g: Draw, b: BodySnap, v: SceneView): void {
  const { x, y, a } = b
  const [vx, vy] = v.bv
  const speed = Math.hypot(vx, vy)
  const f = clamp((PITCH.ground - BALL_R - y) / 320, 0, 1)
  g.shadow(x, PITCH.ground + 6, BALL_R * 1.15 * (1 - f * 0.5), 9, 0.4 * (1 - f * 0.6))
  // A fresh kick: the ball is the one active thing, ringed in yellow; a harder kick rings wider.
  const kicker = v.hitAge[0] < v.hitAge[1] ? 0 : 1
  const hit = v.hitAge[kicker]
  const power = v.power[kicker]
  if (hit < 0.45) {
    const t = hit / 0.45
    g.alpha(1 - t, () =>
      g.ring(
        x,
        y,
        BALL_R + 10 + outCubic(t) * (30 + power * 60),
        C.yellow,
        (6 + power * 8) * (1 - t) + 2,
      ),
    )
    // A full-power strike flashes a star at the contact for a few frames.
    if (power > 0.7 && hit < 0.12)
      g.alpha(1 - hit / 0.12, () =>
        g.star(x, y, BALL_R * (1.4 + power), alpha(C.white, 0.85), 6, 0.42, hit * 6),
      )
  }
  // Motion trail: fading ghosts along the real path, wider and brighter the faster it flies.
  // A heated match sets the trail and the ball's halo burning orange.
  const fast = clamp((speed - 9) / 14, 0, 1)
  const hot = clamp((v.heat - 0.2) / 0.8, 0, 1)
  const tint = hot > 0.5 ? C.orange : hot > 0 ? C.yellow : '#fff8ef'
  const tr = v.trail
  for (let i = 0; i < tr.length; i++) {
    const p = tr[i] as { x: number; y: number }
    const f = (i + 1) / (tr.length + 1)
    g.alpha(0.32 * f * fast, () => g.circle(p.x, p.y, BALL_R * (0.55 + 0.4 * f), tint))
  }
  if (hot > 0) {
    const flick = 0.85 + 0.15 * Math.sin(v.time * 18)
    const hr = BALL_R * (1.5 + hot * 0.5) * flick
    g.circle(
      x,
      y,
      hr,
      g.rad(x, y, BALL_R * 0.8, hr, [
        [0, alpha(C.orange, 0.5 * hot)],
        [1, alpha(C.orange, 0)],
      ]),
    )
  }
  // Stretched along its flight, squashed by the last knock (spring).
  const stretch = (1 + clamp((speed - 6) / 30, 0, 0.18)) * v.squash
  const dir = Math.atan2(vy, vx)
  g.at(
    x,
    y,
    dir,
    () => {
      g.ball(0, 0, BALL_R, '#fff8ef', 1)
    },
    stretch,
    1 / stretch,
  )
  g.at(x, y, a, () => {
    const pent = (cx: number, cy: number, r: number) => {
      const pts: number[] = []
      for (let i = 0; i < 5; i++) {
        const t = -Math.PI / 2 + (i * Math.PI * 2) / 5
        pts.push(cx + Math.cos(t) * r, cy + Math.sin(t) * r)
      }
      g.poly(pts, BOOT)
    }
    pent(0, 0, BALL_R * 0.34)
    for (let i = 0; i < 5; i++) {
      const t = -Math.PI / 2 + (i * Math.PI * 2) / 5
      const ex = Math.cos(t) * BALL_R
      const ey = Math.sin(t) * BALL_R
      g.line(Math.cos(t) * BALL_R * 0.34, Math.sin(t) * BALL_R * 0.34, ex * 0.8, ey * 0.8, BOOT, 3)
      g.alpha(0.8, () => pent(ex * 0.98, ey * 0.98, BALL_R * 0.2))
    }
  })
  // Gloss on top of the panels, fixed to the light.
  g.alpha(0.55, () =>
    g.ellipse(x - BALL_R * 0.32, y - BALL_R * 0.42, BALL_R * 0.3, BALL_R * 0.17, '#fff', -0.6),
  )
  g.ring(x, y, BALL_R, alpha('#1a1030', 0.25), 3)
}

/** A floppy two-part player: a shirt-and-shorts torso with a head on top, arms flailing. */
function player(
  g: Draw,
  side: Side,
  body: BodySnap,
  head: BodySnap,
  v: SceneView,
  ballX: number,
): void {
  const col = SIDE[side].main
  const kick = v.kick[side]
  const dir = ballX >= body.x ? 1 : -1
  const airborne = clamp((PITCH.ground - BODY.h / 2 - 8 - body.y) / 60, 0, 1)
  shadow(g, body.x, body.y)
  const q = kick > 0 ? 1 - kick / KICK_TIME : 0
  // Squash & stretch: tall and thin off the launch, squat on a landing (harder = squatter),
  // and a slow breath while standing.
  const ha = v.hopAge[side]
  const la = v.landAge[side]
  const launch = ha < 0.25 ? Math.sin((ha / 0.25) * Math.PI) * 0.14 : 0
  const land =
    la < 0.32
      ? -Math.sin((la / 0.32) * Math.PI) * (0.08 + v.landK[side] * 0.16) * (1 - la / 0.32 / 2)
      : 0
  const breathe = airborne < 0.1 && kick <= 0 ? Math.sin(v.time * 3 + side * 1.7) * 0.025 : 0
  const sq = 1 + launch + land + breathe
  // Keep the feet planted while squashing: scale about the soles, not the middle.
  const foot = (BODY.h / 2) * (1 - sq)
  // The wind-up: the kicking leg draws back while the finger is held, and snaps through on contact.
  const wound = kick > 0 && v.hitAge[side] > ha ? v.charge[side] : 0
  g.at(
    body.x,
    body.y + foot,
    body.a,
    () => {
      const hipY = BODY.h / 2 - 10
      const shoulderY = -BODY.h / 2 + 26
      // Back arm, behind the shirt.
      const flail = airborne * Math.sin(v.time * 16 + side) * 0.5
      const armA = (s: number) => s * (0.35 + airborne * 1.4) + flail * s
      const arm = (s: number) => {
        const t = armA(s)
        const ax = s * (BODY.w / 2 - 4)
        const hx = ax + Math.sin(t) * 46
        const hy = shoulderY + Math.cos(t) * 46
        g.line(ax, shoulderY, hx, hy, shade(col, -0.15), 18)
        g.circle(hx, hy, 11, SKIN)
      }
      arm(-dir)
      // Kicking leg swings forward over the hop, reaching out as the player comes down.
      if (kick > 0) {
        // Right after contact the leg follows through high, harder kicks higher.
        const ft =
          v.hitAge[side] < 0.25 ? (1 - v.hitAge[side] / 0.25) * (0.4 + v.power[side] * 0.6) : 0
        const th = dir * (0.3 + 1.15 * q - wound * 1.5 + ft)
        const lx = Math.sin(th) * 76
        const ly = hipY + Math.cos(th) * 76
        g.line(0, hipY, lx * 0.55, hipY + (ly - hipY) * 0.55, shade(col, -0.35), 26)
        g.line(lx * 0.55, hipY + (ly - hipY) * 0.55, lx, ly, '#f3eefa', 20)
        // A wound-up boot glows: the more power held, the hotter.
        if (wound > 0.15)
          g.circle(
            lx + dir * 9,
            ly + 2,
            24 + wound * 20,
            g.rad(lx + dir * 9, ly + 2, 4, 24 + wound * 20, [
              [0, alpha(C.yellow, 0.35 + wound * 0.45)],
              [1, alpha(C.yellow, 0)],
            ]),
          )
        g.ellipse(lx + dir * 9, ly + 2, 19, 12, BOOT, th)
        g.alpha(0.6, () => g.ellipse(lx + dir * 4, ly - 2, 7, 3, '#ffffff', th))
      }
      // Standing legs: socks and boots under the shorts.
      for (const sx of kick > 0 ? [-dir * 14] : [-15, 15]) {
        g.line(sx, hipY, sx, BODY.h / 2 + 4, '#f3eefa', 20)
        g.ellipse(sx + dir * 6, BODY.h / 2 + 8, 16, 10, BOOT)
      }
      // Shirt: a lipped, glossy block in the owner's colour.
      const w = BODY.w
      const h = BODY.h
      g.rrect(-w / 2, -h / 2 + 7, w, h - 8, BODY.r, shade(col, -0.4))
      g.rrect(
        -w / 2,
        -h / 2,
        w,
        h - 8,
        BODY.r,
        g.lin(-w / 2, 0, w / 2, 0, [
          [0, shade(col, 0.15)],
          [0.6, col],
          [1, shade(col, -0.2)],
        ]),
      )
      // Collar and a sash in the team's light tone.
      g.arc(0, -h / 2 + 6, 14, 0.15 * Math.PI, 0.85 * Math.PI, SIDE[side].light, 6)
      // Shorts.
      g.rrect(-w / 2 + 1, 12, w - 2, h / 2 - 16, 16, '#f3eefa')
      g.rrect(-w / 2 + 1, 12, w - 2, 8, 4, alpha('#000000', 0.12))
      // Team mark on the chest: red circle, blue square.
      g.sideMark(side, 0, -12, 12, C.white)
      g.alpha(0.45, () => g.ellipse(-w * 0.22, -h * 0.3, w * 0.13, h * 0.09, '#ffffff', -0.5))
      arm(dir)
    },
    1 / sq,
    sq,
  )
  let mood: Mood = wound > 0.5 ? 'angry' : kick > 0 ? 'wow' : 'happy'
  if (v.phase === 'goal') mood = v.scorer === side ? 'grin' : 'sad'
  if (v.winner !== null) mood = v.winner === side ? 'grin' : 'sad'
  // The head squashes as the kick connects.
  const squash =
    1 + (0.08 + v.power[side] * 0.1) * clamp(1 - v.hitAge[side] / 0.2, 0, 1) - land * 0.6
  g.blob(head.x, head.y, HEAD_R, SKIN, {
    mood,
    look: [dir * 0.8, 0.1],
    angle: head.a,
    cheeks: true,
    sx: squash,
    sy: 1 / squash,
  })
  // Hair in the owner's dark tone, a little tuft on top.
  g.at(head.x, head.y, head.a, () => {
    g.arc(0, 0, HEAD_R * 0.8, Math.PI * 1.12, Math.PI * 1.88, shade(col, -0.35), 16)
    g.circle(-dir * 6, -HEAD_R * 0.95, 9, shade(col, -0.35))
  })
}

export function drawScene(g: Draw, v: SceneView): void {
  stands(g, v)
  floodlights(g, v)
  air(g)
  ends(g)
  pitch(g)
  goalBack(g, 0, v)
  goalBack(g, 1, v)

  const ballSnap = v.bodies.find((b) => b.k === KIND.ball)
  for (const side of [0, 1] as Side[]) {
    const body = v.bodies.find((b) => b.k === KIND.body(side))
    const head = v.bodies.find((b) => b.k === KIND.head(side))
    if (!body || !head) continue
    player(g, side, body, head, v, ballSnap?.x ?? W / 2)
  }
  if (ballSnap) ball(g, ballSnap, v)
  goalFront(g, 0, v)
  goalFront(g, 1, v)
  // Vignette over the band only, so the pads stay clean.
  g.rect(
    -1000,
    BAND_TOP - 12,
    W + 2000,
    PITCH.bottom - BAND_TOP + 12,
    g.lin(0, BAND_TOP, 0, PITCH.bottom, [
      [0, 'rgba(0,0,0,0.25)'],
      [0.2, 'rgba(0,0,0,0)'],
      [0.85, 'rgba(0,0,0,0)'],
      [1, 'rgba(0,0,0,0.3)'],
    ]),
  )
  if (v.loading) g.both('Loading…', { size: 48, color: shade(C.white, -0.2) })
}

/** Goal celebration scale for the score figure: pops when the scorer's tally goes up. */
export function scorePop(age: number): number {
  return 1 + 0.6 * Math.max(0, 1 - age / 0.5) ** 2
}
