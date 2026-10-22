import { inFrame } from '../../core/frame.ts'
import { clamp, outBack } from '../../core/fx/ease.ts'
import type { Side } from '../../core/game.ts'
import { banner } from '../../core/hud.ts'
import type { Draw, Mood } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { drawTrajectory, type Shell } from '../../engines/aim/index.ts'
import {
  APPLE,
  type Arrow,
  arrowAt,
  BODY,
  DUMMY,
  HEAD,
  lineY,
  type Outcome,
  type State,
  WIND_MAX,
} from './rules.ts'

/** Pseudo-3D: a point at height z shows up higher on screen and a little to the left. */
export const project = (x: number, y: number, z: number): { x: number; y: number } => ({
  x: x - z * 0.12,
  y: y - z * 0.18,
})

/** Things higher up are nearer the camera, so a little bigger. */
const lift = (z: number): number => 1 + Math.max(0, z) / 520

/** Where a shadow of a point at height z falls: the floodlight is behind the viewer's left shoulder. */
const shadowAt = (x: number, y: number, z: number) => ({ x: x + z * 0.42, y: y + z * 0.1 })

const STRAW = '#e7c97f'
const BURLAP = '#d6b27a'
const LAWN = '#2f7a46'

/** The range: a floodlit lawn, each archer's end in their colour, and their shooting lines. */
export function drawRange(g: Draw, gap: number): void {
  g.fillView(shade(LAWN, -0.62))
  const v = g.stage.view
  for (let y = Math.floor(v.y / 120) * 120; y < v.y + v.h; y += 120) {
    if ((y / 120) % 2 === 0) g.rect(v.x - 2, y, v.w + 4, 120, alpha(shade(LAWN, -0.35), 0.7))
  }
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, alpha(SIDE[1].dark, 0.6)],
      [0.28, alpha(SIDE[1].dark, 0)],
      [0.72, alpha(SIDE[0].dark, 0)],
      [1, alpha(SIDE[0].dark, 0.6)],
    ]),
  )
  // Floodlight pool on the dummy.
  g.fillView(
    g.rad(DUMMY.x, DUMMY.y, 40, 520, [
      [0, alpha('#fff4d8', 0.2)],
      [1, alpha('#fff4d8', 0)],
    ]),
  )
  for (const side of [0, 1] as Side[]) {
    const y = lineY(side, gap)
    const col = SIDE[side]
    // Shooting mat: a round woven rug in the team colour under bow and archer.
    const my = side === 0 ? y + 30 : y - 30
    g.ellipse(W / 2 + 8, my + 12, 172, 112, alpha('#000000', 0.3))
    g.ellipse(W / 2, my, 172, 112, shade(col.main, -0.6))
    g.path(
      (c) => c.ellipse(W / 2, my, 146, 90, 0, 0, Math.PI * 2),
      undefined,
      alpha(col.main, 0.5),
      6,
    )
    g.path(
      (c) => c.ellipse(W / 2, my, 112, 66, 0, 0, Math.PI * 2),
      undefined,
      alpha(col.main, 0.22),
      4,
    )
    const front = side === 0 ? y - 96 : y + 96
    g.dashed(150, front, W - 150, front, alpha(col.main, 0.6), 7, [26, 16])
  }
  g.vignette(0.32)
}

/**
 * The straw dummy, seen from above and stacked by height: stake, sack body,
 * crossbar arms, burlap head, and the apple on top. Its long shadow on the
 * grass shows how tall it stands. `wobble` sways it after a hit.
 */
export function drawDummy(g: Draw, wobble: number, apple: { k: number } | null): void {
  const { x, y } = DUMMY
  const sway = (z: number) => wobble * (z / 262) * 26
  // Long shadow.
  g.alpha(0.32, () => {
    const s0 = shadowAt(x, y, 0)
    const s1 = shadowAt(x, y, BODY.h)
    g.line(s0.x, s0.y, s1.x, s1.y, '#000', 22)
    const sb = shadowAt(x, y, 110)
    g.ellipse(sb.x, sb.y, BODY.w * 1.05, 26, '#000')
    const sa = shadowAt(x, y, 150)
    g.rrect(sa.x - 150, sa.y - 10, 300, 20, 10, '#000')
    const sh = shadowAt(x, y, HEAD.z)
    g.circle(sh.x, sh.y, HEAD.r, '#000')
    if (apple) {
      const sp = shadowAt(x, y, APPLE.z)
      g.circle(sp.x, sp.y, APPLE.r * apple.k, '#000')
    }
  })
  g.circle(x, y, 18, shade(C.woodDark, -0.5))
  // Stake.
  const top = project(x + sway(60), y, 60)
  g.line(x, y, top.x, top.y, shade(C.woodDark, -0.2), 18)
  // Body: a stuffed sack tied with rope.
  const b = project(x + sway(105), y, 105)
  const kb = lift(105)
  g.at(b.x, b.y, wobble * 0.08, () => {
    const w = BODY.w * kb
    g.rrect(-w, -40, w * 2, 86, 40, shade(STRAW, -0.35))
    g.rrect(-w, -46, w * 2, 84, 40, STRAW)
    for (let i = -4; i <= 4; i++)
      g.line(i * 19 - 6, -36, i * 19 + 6, 30, alpha(C.woodDark, 0.25), 3)
    g.rrect(-w + 4, -10, w * 2 - 8, 12, 6, shade(C.woodDark, 0.1))
    g.alpha(0.35, () => g.rrect(-w + 12, -40, w * 0.9, 18, 9, '#ffffff'))
  })
  // Arms: a crossbar with straw hands.
  const a = project(x + sway(150), y, 150)
  const ka = lift(150)
  g.at(a.x, a.y, wobble * 0.12, () => {
    g.rrect(-150 * ka, -13, 300 * ka, 26, 12, shade(C.woodDark, 0.05), shade(C.woodDark, -0.4), 4)
    for (const sx of [-1, 1]) {
      for (let i = -2; i <= 2; i++) {
        g.line(sx * 150 * ka, 0, sx * (150 * ka + 30), i * 12, shade(STRAW, -0.1), 6)
      }
    }
  })
  // Head of burlap with a stitched face.
  const h = project(x + sway(HEAD.z), y, HEAD.z)
  const kh = lift(HEAD.z)
  const hr = HEAD.r * kh
  g.at(h.x, h.y, wobble * 0.2, () => {
    g.circle(0, 6, hr, shade(BURLAP, -0.4))
    g.circle(
      0,
      0,
      hr,
      g.rad(
        0,
        0,
        4,
        hr,
        [
          [0, shade(BURLAP, 0.25)],
          [1, shade(BURLAP, -0.12)],
        ],
        -hr * 0.3,
        -hr * 0.3,
      ),
    )
    for (const sx of [-1, 1]) {
      g.line(sx * hr * 0.42 - 7, hr * 0.05 - 7, sx * hr * 0.42 + 7, hr * 0.05 + 7, C.ink, 4)
      g.line(sx * hr * 0.42 - 7, hr * 0.05 + 7, sx * hr * 0.42 + 7, hr * 0.05 - 7, C.ink, 4)
    }
    g.arc(0, hr * 0.3, hr * 0.32, 0.3, Math.PI - 0.3, C.ink, 4)
  })
  if (apple && apple.k > 0.01) {
    const p = project(x + sway(APPLE.z), y, APPLE.z)
    // The one thing to hit: a soft yellow halo under it.
    g.alpha(0.35, () => g.circle(p.x, p.y, APPLE.r * lift(APPLE.z) * 1.3 * apple.k, C.yellow))
    g.emoji('🍎', p.x, p.y - 4, APPLE.r * 2.1 * lift(APPLE.z) * apple.k)
  }
}

/** An arrow: shaft along +x from the nock (0,0) to the tip, team fletching at the back. */
function arrowShape(g: Draw, side: Side, len = 110): void {
  const col = SIDE[side]
  g.line(0, 0, len, 0, shade(C.woodDark, 0.1), 7)
  g.line(4, -2, len - 6, -2, alpha('#ffffff', 0.25), 2)
  g.poly([len + 22, 0, len - 2, -11, len - 2, 11], '#dfe6f2', shade('#dfe6f2', -0.5), 2)
  g.poly([0, 0, -18, -14, 22, -4, 22, 0], col.main)
  g.poly([0, 0, -18, 14, 22, 4, 22, 0], col.dark)
}

/** An arrow stuck in the dummy at its crossing point, the shaft running back toward its archer. */
export function drawStuck(g: Draw, side: Side, x: number, z: number): void {
  const p = project(x, DUMMY.y, z)
  const dir = side === 0 ? Math.PI / 2 : -Math.PI / 2
  const k = lift(z)
  g.alpha(0.3, () => {
    const s = shadowAt(x, DUMMY.y, z)
    g.line(s.x, s.y, s.x, s.y + (side === 0 ? 90 : -90), '#000', 6)
  })
  // Shaft from the tip (buried in the dummy) back to the fletching.
  g.at(p.x, p.y, dir, () => g.at(118 * k, 0, Math.PI, () => arrowShape(g, side, 110)), k)
}

/** A loosed arrow: its shadow on the grass, the shaft lifted by height and pointing along its path. */
export function drawFlying(g: Draw, sh: Shell, side: Side, fade = 1): void {
  const z = Math.max(0, sh.z)
  const k = lift(z)
  const ground = Math.atan2(sh.vy, sh.vx)
  // On screen the arrow tilts with its climb or fall.
  const a = Math.atan2(sh.vy - sh.vz * 0.18, sh.vx - sh.vz * 0.12)
  g.alpha(fade * (0.35 / k), () =>
    g.at(sh.x, sh.y, ground, () => g.rrect(-110, -4, 130, 8, 4, '#000')),
  )
  const h = project(sh.x, sh.y, z)
  g.alpha(fade, () => g.at(h.x, h.y, a, () => g.at(-120, 0, 0, () => arrowShape(g, side, 110)), k))
}

/**
 * An archer at their line, drawn in their own frame: a team blob behind a
 * bow whose string is pulled back by the live aim.
 */
export function drawArcher(
  g: Draw,
  side: Side,
  gap: number,
  aim: { dx: number; dy: number; power: number } | null,
  glow: number,
  mood: Mood,
  t: number,
  kick = 1,
): void {
  inFrame(g, side, () => {
    g.at(500, MID + gap, 0, () => {
      const col = SIDE[side]
      // Shot direction in this frame (red's frame: up is -y).
      const sx = aim ? (side === 0 ? aim.dx : -aim.dx) : 0
      const sy = aim ? (side === 0 ? aim.dy : -aim.dy) : -1
      const rot = Math.atan2(sy, sx) + Math.PI / 2
      const pull = aim ? aim.power * 70 : 0
      if (glow > 0) g.alpha(glow, () => g.circle(0, 10, 112, undefined, col.light, 8))
      g.shadow(8, 70, 80, 24, 0.4)
      const breathe = 1 + Math.sin(t * 3) * 0.03
      g.blob(0, 64, 56, col.main, {
        mood,
        look: [sx * 0.8, sy * 0.8],
        sx: (1 + pull * 0.002) * (2 - kick),
        sy: (breathe - pull * 0.002) * kick,
      })
      g.at(0, -8, rot, () => {
        // Bow limbs bulge toward the target.
        const R = 120
        const tipX = Math.sin(1) * R
        const tipY = -Math.cos(1) * R + 40
        g.at(0, 40, 0, () => {
          g.arc(0, 0, R, -Math.PI / 2 - 1, -Math.PI / 2 + 1, shade(C.woodDark, -0.25), 22)
          g.arc(0, 0, R, -Math.PI / 2 - 1, -Math.PI / 2 + 1, C.wood, 11)
          g.rrect(-15, -R - 18, 30, 40, 10, col.dark)
        })
        const ny = tipY + 6 + pull
        g.line(-tipX, tipY, 0, ny, C.cream, 4)
        g.line(tipX, tipY, 0, ny, C.cream, 4)
        // Arrow nocked on the string.
        g.at(0, ny, -Math.PI / 2, () => arrowShape(g, side, 100))
      })
    })
  })
}

/** Wind sock panel on a player's own half, upright for them: an arrow whose length and colour say how hard. */
export function windSock(g: Draw, wind: number, y: number, mirror: boolean, t: number): void {
  const k = Math.min(1, Math.abs(wind) / WIND_MAX)
  // Blue's frame is turned half a turn, so world +x is blue's left: flip the arrow there.
  const dir = (Math.sign(wind) || 1) * (mirror ? -1 : 1)
  const col = k < 0.35 ? C.green : k < 0.7 ? C.yellow : C.orange
  g.rrect(W / 2 - 190, y - 40, 380, 80, 40, alpha(C.ink, 0.72))
  if (k < 0.05) {
    g.text('No wind', W / 2, y + 2, { size: 36, weight: 700, color: alpha(C.white, 0.85) })
    return
  }
  const len = 70 + 130 * k
  const x0 = W / 2 + 40 - (dir * len) / 2
  const x1 = W / 2 + 40 + (dir * len) / 2
  g.line(x0, y, x1 - dir * 20, y, col, 14)
  g.poly([x1, y, x1 - dir * 32, y - 24, x1 - dir * 32, y + 24], col)
  for (let i = 0; i < 2; i++) {
    const f = (t * (0.7 + k) + i / 2) % 1
    const gx = x0 + dir * len * f
    g.alpha(Math.sin(f * Math.PI) * 0.7, () =>
      g.line(gx, y - 24, gx + dir * 26, y - 24, C.white, 4),
    )
  }
  g.emoji('💨', W / 2 - 130, y, 40, 0, dir < 0 ? 1 : -1, 1)
}

const OUTCOME: Record<Outcome, string> = {
  apple: 'Apple! +1',
  dummy: 'Ouch! −1 life',
  wide: 'Wide!',
  short: 'Too short!',
  over: 'Too high!',
}

export interface Look {
  aim: {
    dx: number
    dy: number
    power: number
    preview: { x: number; y: number; z: number }[]
  } | null
  glow: [number, number]
  /** Sides that read banners: both in local 2P, the viewer's own otherwise. */
  readers: Side[]
  winner: Side | 'draw' | null
  /** Archer squash springs (1 = rest): the kick of the release. */
  kick: [number, number]
}

/** The arrow after it reached the dummy's plane: misses fly on and fade, the apple rides away on it. */
function drawAfter(g: Draw, s: State, a: Arrow, since: number): void {
  if (a.outcome === 'dummy' || since > 0.6) return
  const sh = arrowAt({ ...a, t: a.tEnd + since }, s.gap, s.wind)
  const fade = 1 - since / 0.6
  if (a.outcome === 'short') {
    // Stuck in the grass, quivering.
    const sx = arrowAt({ ...a, t: a.tEnd }, s.gap, s.wind)
    const ang = Math.atan2(sx.vy, sx.vx)
    g.alpha(fade, () =>
      g.at(sx.x, sx.y, ang + Math.sin(since * 50) * 0.08 * fade, () =>
        g.at(-120, 0, 0, () => arrowShape(g, a.side, 110)),
      ),
    )
    return
  }
  drawFlying(g, sh, a.side, fade)
  if (a.outcome === 'apple') {
    const p = project(sh.x, sh.y, Math.max(0, sh.z))
    g.alpha(fade, () => g.emoji('🍎', p.x, p.y, APPLE.r * 2.1 * lift(sh.z), since * 14))
  }
}

export function render(g: Draw, s: State, look: Look, t: number, mood: [Mood, Mood]): void {
  drawRange(g, s.gap)
  const res = s.phase === 'result' || s.phase === 'over' ? s.last : null
  const since = s.now - s.hitAt
  const knocked = res?.outcome === 'apple'
  const wob = res?.outcome === 'dummy' && since < 1 ? Math.sin(since * 18) * (1 - since) : 0
  const pop = outBack(clamp((s.now - s.turnAt) / 0.35, 0, 1))
  const appleK = knocked ? 0 : s.turnAt > 0 && s.phase === 'aim' ? pop : 1
  drawDummy(g, wob, { k: appleK })
  for (const st of s.stuck) drawStuck(g, st.side, st.x, st.z)
  if (s.arrow && s.phase === 'fly') {
    // Two fading ghosts behind a fast arrow: the faster the draw, the longer the streak.
    const a = s.arrow
    for (let i = 2; i >= 1; i--) {
      const back = i * (0.02 + 0.025 * a.power)
      if (a.t > back)
        drawFlying(g, arrowAt({ ...a, t: a.t - back }, s.gap, s.wind), a.side, 0.18 / i)
    }
    drawFlying(g, arrowAt(a, s.gap, s.wind), a.side)
  }
  if (res && s.lastArrow) drawAfter(g, s, s.lastArrow, since)
  // The flight preview is the shooter's control: online, only their own phone shows it.
  const own = g.viewer === null || g.viewer === s.turn
  if (look.aim && s.phase === 'aim' && own) drawTrajectory(g, look.aim.preview, SIDE[s.turn].light)
  for (const side of [0, 1] as Side[]) {
    const mine = s.phase === 'aim' && s.turn === side ? look.aim : null
    drawArcher(g, side, s.gap, mine, look.glow[side], mood[side], t, look.kick[side])
  }
  // The wind panel sits in each reader's half, between the dummy and their line.
  for (const side of look.readers) {
    const wy = MID + Math.min(330, s.gap - 190)
    inFrame(g, side, () => windSock(g, s.wind, wy, side === 1, t))
  }
  const by = (side: Side) => (side === 0 ? MID + 175 : MID - 175)
  if (look.winner !== null) {
    for (const side of look.readers) {
      const w = look.winner
      const text = w === 'draw' ? 'Draw' : w === side ? 'You win!' : `${SIDE[w].name} wins`
      banner(g, side, text, by(side), { size: 72, color: w === side ? C.yellow : C.white })
    }
  } else if (res) {
    const k = outBack(clamp(since / 0.25, 0, 1))
    const color =
      res.outcome === 'apple' ? C.yellow : res.outcome === 'dummy' ? C.redLight : C.white
    for (const side of look.readers) {
      banner(g, side, OUTCOME[res.outcome], by(side), { size: 64 * k, color })
    }
  }
}
