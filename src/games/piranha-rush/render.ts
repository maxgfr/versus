import type { Side } from '../../core/game.ts'
import { clamp, outBack, outCubic } from '../../core/fx/ease.ts'
import { banner, bigScore, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, SIDE, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import type { PadLook, State } from './index.ts'
import { fishAt, HOME, inRiver, RIVER_BOT, RIVER_TOP, STUN, type Swimmer } from './rules.ts'

const JUNGLE = '#16302a'
const MUD = '#3a2d28'
const WATER_TOP = '#11507f'
const WATER_BOT = '#0b3760'
/** Silver-backed with a fiery belly: a real piranha, and never mistaken for red's team colour. */
const FISH_BODY = '#9fabc8'
const FISH_BELLY = '#ff8b3d'
/** Reeds along each bank (x), kept clear of the jetties and the pause button. */
const REEDS = [180, 300, 700, 820, 930]
/** Jungle on red's bank (red's layout; blue's is mirrored): x, y, glyph, size. Clear of the stick, clock and HUD. */
const PLANTS: readonly [number, number, string, number][] = [
  [120, 1250, '🌴', 96],
  [830, 1235, '🌴', 104],
  [690, 1420, '🪨', 54],
  [930, 1430, '🌱', 50],
  [330, 1300, '🌱', 44],
  [960, 1250, '🪨', 40],
]

/** Lily pads drifting on the river: x, y, size. */
const PADS: readonly [number, number, number][] = [
  [170, 760, 34],
  [860, 1040, 30],
  [330, 1060, 26],
  [690, 745, 28],
]

/** One piranha: a toothy fish nose toward `dir`, with a wake behind it. */
function piranha(g: Draw, x: number, y: number, dir: 1 | -1, t: number): void {
  g.ellipse(x - dir * 6, y + 14, 46, 12, alpha('#000000', 0.3))
  // Wake: a white V trailing behind.
  g.line(x - dir * 44, y, x - dir * 96, y - 18, alpha(C.white, 0.22), 5)
  g.line(x - dir * 44, y, x - dir * 96, y + 18, alpha(C.white, 0.22), 5)
  g.at(
    x,
    y,
    0,
    () => {
      const wag = Math.sin(t * 16 + x * 0.05) * 7
      g.poly([-30, 0, -62, -22 + wag, -54, 0, -62, 22 - wag], shade(FISH_BODY, -0.2))
      g.poly([-6, -16, 10, -30, 16, -14], shade(FISH_BODY, -0.25))
      g.ellipse(
        0,
        0,
        40,
        20,
        g.lin(0, -20, 0, 20, [
          [0, shade(FISH_BODY, 0.15)],
          [1, shade(FISH_BODY, -0.2)],
        ]),
      )
      g.ellipse(6, 9, 28, 8, FISH_BELLY)
      g.alpha(0.45, () => g.ellipse(-6, -10, 16, 5, '#ffffff'))
      // An underbite full of teeth.
      g.path(
        (p) => {
          p.moveTo(24, 2)
          p.lineTo(44, 4)
          p.lineTo(30, 12)
          p.closePath()
        },
        shade(FISH_BODY, -0.45),
      )
      for (const tx of [28, 34, 40]) g.poly([tx, 4, tx + 3, -2, tx + 6, 4], '#ffffff')
      g.circle(20, -7, 7, '#ffffff')
      g.circle(22, -7, 4, C.ink)
      g.line(14, -15, 27, -11, C.ink, 4)
    },
    dir,
    1,
  )
}

/** The river: deep night water, moonlit ripples, lily pads, foamy banks. */
function river(g: Draw, t: number): void {
  const v = g.stage.view
  g.rect(
    v.x - 2,
    RIVER_TOP,
    v.w + 4,
    RIVER_BOT - RIVER_TOP,
    g.lin(0, RIVER_TOP, 0, RIVER_BOT, [
      [0, WATER_TOP],
      [0.5, shade(WATER_TOP, -0.15)],
      [1, WATER_BOT],
    ]),
  )
  for (let row = 0; row < 7; row++) {
    const y = RIVER_TOP + 34 + row * 54
    const dir = row % 2 ? 1 : -1
    const off = (((t * 46 * dir + row * 70) % 180) + 180) % 180
    for (let x = -180 + off; x < W + 180; x += 180)
      g.line(x, y, x + 60, y - 3, alpha('#bfe6ff', 0.12), 5)
  }
  // Moonlight shimmer on the water.
  const c = g.ctx
  c.save()
  c.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 6; i++) {
    const x = 640 + Math.sin(t * 0.7 + i * 1.7) * 40 + (i % 2) * 30
    const y = RIVER_TOP + 70 + i * 52
    g.line(x - 40 + i * 4, y, x + 40 - i * 4, y, alpha('#cfe8ff', 0.14), 6)
  }
  c.restore()
  for (const [x, y, r] of PADS) {
    const bob = Math.sin(t * 1.5 + x) * 3
    g.circle(x, y + bob + 4, r, alpha('#000000', 0.25))
    g.path((p) => {
      p.moveTo(x, y + bob)
      p.arc(x, y + bob, r, 0.35, Math.PI * 2 - 0.05)
      p.closePath()
    }, '#2f8f47')
    g.circle(x - r * 0.2, y + bob - r * 0.2, r * 0.25, alpha('#ffffff', 0.12))
  }
  // Foam along each bank, wobbling a little.
  for (const y of [RIVER_TOP, RIVER_BOT]) {
    for (let x = -20; x < W + 20; x += 38) {
      const wob = Math.sin(t * 2 + x * 0.04 + y) * 5
      g.circle(x, y + wob, 12, alpha('#d8f1ff', 0.55))
    }
  }
}

/** Each bank in its team's colour, with mud at the water, reeds and the starting jetty. */
function banks(g: Draw, t: number): void {
  const v = g.stage.view
  const bank = (side: Side) => mix(JUNGLE, SIDE[side].dark, 0.32)
  g.rect(v.x - 2, RIVER_BOT, v.w + 4, v.y + v.h - RIVER_BOT + 2, bank(0))
  g.rect(v.x - 2, v.y - 2, v.w + 4, RIVER_TOP - v.y + 4, bank(1))
  // Pebbles on the banks (fixed positions).
  for (let i = 0; i < 18; i++) {
    const x = 60 + ((i * 211) % 880)
    const y0 = 140 + ((i * 97) % 440)
    for (const y of [y0, 1800 - y0])
      g.ellipse(x, y, 12 + (i % 3) * 4, 7 + (i % 2) * 3, alpha('#ffffff', 0.05))
  }
  // Grass clumps and jungle plants, upright for the bank's owner.
  for (const side of [0, 1] as Side[]) {
    for (let i = 0; i < 26; i++) {
      const x = 40 + ((i * 337) % 920)
      const y0 = 1170 + ((i * 151) % 600)
      const y = side === 0 ? y0 : 1800 - y0
      g.ellipse(x, y, 18, 7, alpha('#000000', 0.14))
      g.ellipse(x, y - 3, 14, 6, alpha(shade(C.grass, -0.3), 0.45))
    }
    for (const [px, py, glyph, size] of PLANTS) {
      const x = side === 0 ? px : W - px
      const y = side === 0 ? py : 1800 - py
      const sway = glyph === '🌴' ? Math.sin(t * 1.2 + px) * 0.04 : 0
      const a = g.orient(side)
      g.shadow(x + 10, y + Math.cos(a) * size * 0.38, size * 0.42, size * 0.16, 0.35)
      g.emoji(glyph, x, y, size, a + sway)
    }
  }
  g.rect(v.x - 2, RIVER_BOT, v.w + 4, 22, MUD)
  g.rect(v.x - 2, RIVER_TOP - 22, v.w + 4, 22, MUD)
  for (const x of REEDS) {
    for (const [y, s] of [
      [RIVER_TOP - 36, 1],
      [RIVER_BOT + 36, -1],
    ] as const) {
      const sway = Math.sin(t * 1.6 + x) * 0.08
      g.emoji('🌿', s > 0 ? x : W - x, y, 58, sway + (s > 0 ? 0 : Math.PI))
    }
  }
  for (const side of [0, 1] as Side[]) {
    const h = HOME[side] as { x: number; y: number }
    // A wooden jetty from the bank out to the start point.
    const top = side === 0 ? RIVER_BOT - 30 : h.y - 70
    const bottom = side === 0 ? h.y + 70 : RIVER_TOP + 30
    g.rect(h.x - 66, top + 12, 132, bottom - top, alpha('#000000', 0.3))
    for (const px of [-58, 58])
      for (const py of [top + 10, bottom - 10]) g.circle(h.x + px, py, 11, shade(C.woodDark, -0.2))
    const planks = Math.round((bottom - top) / 46)
    for (let i = 0; i < planks; i++) {
      const y = top + ((bottom - top) * i) / planks
      g.tile(h.x - 64, y, 128, (bottom - top) / planks, 8, i % 2 ? C.wood : shade(C.wood, -0.08), 6)
    }
    g.circle(h.x, h.y, 56, alpha(SIDE[side].main, 0.25))
    g.ring(h.x, h.y, 56, alpha(SIDE[side].light, 0.8), 6)
  }
}

/** The bank a swimmer must touch next: a dashed line in its colour, pulsing. */
function goal(g: Draw, sw: Swimmer, now: number): void {
  const side = sw.side
  // Red's far bank is the top one; blue's is the bottom one. Phase 1 heads home.
  const top = (side === 0) === (sw.phase === 0)
  const off = side === 0 ? 0 : 16
  const y = top ? RIVER_TOP - 36 - off : RIVER_BOT + 36 + off
  const p = 0.5 + 0.5 * Math.sin(now * 6 + side)
  g.dashed(130, y, W - 130, y, alpha(SIDE[side].light, 0.45 + 0.4 * p), 8, [26, 18])
}

/** A swimmer: the blob mascot, head above the water while swimming, carrying a star on the way home. */
function swimmer(g: Draw, s: State, sw: Swimmer, now: number): void {
  const side = sw.side
  const col = SIDE[side]
  const { x, y } = sw
  const wet = inRiver(y)
  const stunned = sw.stunT >= 0 && s.t < sw.stunT
  const squash = 1 + 0.07 * Math.sin(now * 9 + side)
  // Pop back in at the jetty after a bite.
  const bt = now - s.bitAt[side]
  const pop = bt < 0.4 ? outBack(clamp(bt / 0.4, 0, 1)) : 1
  const goingUp = (side === 0) === (sw.phase === 0)
  const look: [number, number] = [0, goingUp ? -0.6 : 0.6]
  if (wet) {
    for (let k = 0; k < 2; k++) {
      const p = (now * 0.9 + k * 0.5 + side * 0.3) % 1
      g.alpha(0.5 * (1 - p), () =>
        g.path(
          (c) => c.ellipse(x, y + 14, 40 + p * 50, (40 + p * 50) * 0.42, 0, 0, Math.PI * 2),
          undefined,
          '#d8f1ff',
          4,
        ),
      )
    }
    // Head above the water: the body below the waterline is hidden.
    g.clip(x - 60, y - 80, 120, 94, 0, () =>
      g.blob(x, y, 30, col.main, {
        mood: stunned ? 'dizzy' : 'happy',
        look,
        sx: 1 / squash,
        sy: squash,
      }),
    )
    g.ellipse(x, y + 14, 38, 12, alpha('#d8f1ff', 0.55))
  } else {
    g.shadow(x + 4, y + 26, 30, 11, 0.35)
    g.blob(x, y, 30 * pop, col.main, {
      mood: stunned ? 'dizzy' : 'happy',
      look,
      sx: 1 / squash,
      sy: squash,
    })
  }
  g.sideMark(side, x, y - 50, 9, alpha(C.white, 0.95))
  if (stunned) {
    const k = clamp((sw.stunT - s.t) / STUN, 0, 1)
    g.alpha(k, () => {
      for (let i = 0; i < 3; i++) {
        const a = now * 5 + (i * Math.PI * 2) / 3
        g.emoji('💫', x + Math.cos(a) * 40, y - 40 + Math.sin(a) * 12, 28)
      }
    })
  }
  // The star from the far bank, carried home.
  if (sw.phase === 1) {
    const ft = now - s.farAt[side]
    const k = ft < 0.35 ? outBack(clamp(ft / 0.35, 0, 1)) : 1
    const bob = Math.sin(now * 5) * 5
    g.circle(x + 38, y - 44 + bob, 26 * k, alpha(C.yellow, 0.25))
    g.emoji('⭐', x + 38, y - 44 + bob, 44 * k)
  }
}

/** Splash rings where a piranha bit, so the bite reads even after the swimmer is sent home. */
function biteSplash(g: Draw, s: State, now: number): void {
  for (const side of [0, 1] as Side[]) {
    const t = now - s.bitAt[side]
    if (t < 0 || t > 0.6) continue
    const k = outCubic(t / 0.6)
    const x = s.bitX[side]
    const y = s.bitY[side]
    g.alpha(1 - k, () => {
      g.ring(x, y, 30 + 90 * k, '#d8f1ff', 8)
      g.ring(x, y, 20 + 50 * k, alpha(C.red, 0.8), 6)
      g.emoji('🦷', x, y - 30 * k, 50)
    })
  }
}

function pad(g: Draw, side: Side, p: PadLook): void {
  const col = SIDE[side]
  g.alpha(p.on ? 0.95 : 0.5, () => {
    g.circle(p.bx, p.by, 110, alpha(col.dark, 0.4), alpha(col.light, 0.5), 5)
    g.shadow(p.kx + 4, p.ky + 10, 46, 18, 0.35)
    g.ball(p.kx, p.ky, 50, col.main, 0.7)
  })
}

/** Each player's own clock on their bank, upright for them. */
function sideClock(g: Draw, side: Side, left: number, now: number): void {
  const sec = Math.max(0, Math.ceil(left))
  const label = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  const urgent = sec <= 5
  const x = side === 0 ? 800 : W - 800
  const y = side === 0 ? hudY(g, 0, 52) - 150 : hudY(g, 1, 52) + 150
  const pop = urgent ? 1 + 0.08 * Math.max(0, Math.sin(now * Math.PI * 2)) : 1
  g.forSide(side, x, y, () => {
    g.rrect(-92 * pop, -38 * pop, 184 * pop, 76 * pop, 24, alpha(C.ink, 0.75))
    g.text(`⏱ ${label}`, 0, 3, { size: 40 * pop, weight: 700, color: urgent ? C.yellow : C.white })
  })
}

export function renderRiver(
  g: Draw,
  s: State,
  names: [string, string],
  left: number,
  now: number,
): void {
  g.fillView(JUNGLE)
  river(g, s.t)
  banks(g, s.t)
  for (const sw of s.swim) goal(g, sw, now)
  for (const side of [0, 1] as Side[]) pad(g, side, s.pads[side])
  for (const f of fishAt(s.schools, s.t)) piranha(g, f.x, f.y, f.dir, s.t)
  biteSplash(g, s, now)
  for (const sw of s.swim) swimmer(g, s, sw, now)
  for (const side of [0, 1] as Side[]) {
    namePill(g, side, names[side], { inset: 52 })
    const dt = now - s.scoredAt[side]
    const k = dt < 0.5 ? 1 + 0.5 * (1 - outBack(clamp(dt / 0.5, 0, 1))) : 1
    bigScore(g, side, s.swim[side].crossings, { inset: 52, x: 130, size: 76 * k })
    if (s.endAt < 0) sideClock(g, side, left, now)
  }
  if (s.endAt >= 0) {
    const t = now - s.endAt
    const w = s.winner
    const text = w === 'draw' || w === null ? 'Draw!' : `${names[w]} wins!`
    banner(g, undefined, t < 0.8 ? 'Time!' : text, MID, {
      size: 64 + 12 * (1 - outBack(clamp(t / 0.3, 0, 1))),
      alpha: clamp(t * 4, 0, 1),
      color: t < 0.8 || w === 'draw' || w === null ? C.yellow : SIDE[w].light,
    })
  }
}
