import { other, type Side } from '../../core/game.ts'
import { banner, hudY } from '../../core/hud.ts'
import type { Draw, Mood } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import {
  aimAngle,
  canThrow,
  CAP,
  dirOf,
  PIVOT,
  RELOAD,
  RIM,
  type Shield,
  START,
  type State,
  type Sword,
} from './rules.ts'

/** Sword length in world units, from the tip to the end of the pommel. */
const LEN = 150
const BLADE = 120
const GOLD = '#f2b84b'
const STEEL = '#c9d0e6'

/** 0..1 that starts at 1 when `t0` happens and fades out over `dur` seconds. */
const since = (now: number, t0: number, dur: number): number => {
  const d = now - t0
  return d < 0 || d > dur ? 0 : 1 - d / dur
}

/**
 * A dark plank table under two floodlights that follow the shields; each end is
 * washed in its team colour, with a toe-board where the thrower stands.
 */
export function drawTable(g: Draw, s: State): void {
  g.fillView('#1d1418')
  const v = g.stage.view
  for (let y = Math.floor(v.y / 90) * 90; y < v.y + v.h; y += 90) {
    const k = Math.abs(Math.round(y / 90)) % 3
    g.rect(v.x - 2, y, v.w + 4, 90, shade(C.woodDark, -0.52 - k * 0.05))
    g.rect(v.x - 2, y, v.w + 4, 4, alpha('#000000', 0.35))
    g.rect(v.x - 2, y + 4, v.w + 4, 3, alpha('#ffffff', 0.04))
    // Plank joints, staggered row by row.
    const off = (Math.abs(Math.round(y / 90)) * 370) % 1000
    for (const jx of [off - 1000, off, off + 1000]) {
      g.rect(jx, y + 4, 4, 86, alpha('#000000', 0.3))
      g.circle(jx + 18, y + 20, 4, alpha('#000000', 0.35))
      g.circle(jx + 18, y + 70, 4, alpha('#000000', 0.35))
    }
  }
  // Team washes owning each end.
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, alpha(SIDE[1].main, 0.42)],
      [0.36, alpha(SIDE[1].dark, 0.05)],
      [0.5, alpha('#000000', 0)],
      [0.64, alpha(SIDE[0].dark, 0.05)],
      [1, alpha(SIDE[0].main, 0.42)],
    ]),
  )
  // Floodlight pools on the shields.
  for (const sh of s.shields) {
    g.fillView(
      g.rad(sh.x, sh.y, 40, 430, [
        [0, alpha('#fff3d6', 0.2)],
        [0.6, alpha('#fff3d6', 0.06)],
        [1, alpha('#fff3d6', 0)],
      ]),
    )
  }
  g.midline(alpha(C.cream, 0.28), true)
  for (const side of [0, 1] as Side[]) drawToeBoard(g, side)
  g.vignette(0.42)
}

/** The board each thrower stands behind: a raised strip in the team colour. */
function drawToeBoard(g: Draw, side: Side): void {
  const p = PIVOT[side] as { x: number; y: number }
  const y = p.y + (side === 0 ? -112 : 112)
  const col = SIDE[side]
  g.rrect(W / 2 - 330, y - 4, 660, 30, 13, alpha('#000000', 0.35))
  g.tile(W / 2 - 330, y - 14, 660, 30, 13, shade(col.main, -0.25), 8)
  for (let i = -2; i <= 2; i++) g.circle(W / 2 + i * 130, y - 3, 5, alpha('#ffffff', 0.35))
}

/**
 * A round spinning target: a studded rim in the owner's colour, painted rings,
 * spokes that show the spin, and a boss shaped like the owner's marker. It
 * punches out when a sword lands and flashes white; nearly full, it glows yellow.
 */
export function drawShield(g: Draw, sh: Shield, owner: Side, t: number, now: number): void {
  const col = SIDE[owner]
  const r = RIM
  const hit = since(t, sh.hitT, 0.28)
  const clang = since(t, sh.clangT, 0.2)
  const scale = 1 + 0.09 * hit * hit
  const jx = clang * Math.sin(now * 90) * 6
  g.shadow(sh.x + 14, sh.y + 34, (r + 22) * 1.02, (r + 22) * 0.34, 0.5)
  g.at(
    sh.x + jx,
    sh.y,
    0,
    () => {
      // Body edge, then the rim.
      g.circle(0, 16, r + 22, shade(col.dark, -0.45))
      g.circle(
        0,
        0,
        r + 22,
        g.rad(0, 0, r * 0.4, r + 22, [
          [0, shade(col.main, 0.3)],
          [0.85, col.main],
          [1, shade(col.main, -0.25)],
        ]),
      )
      // Studs on the rim turn with the shield.
      for (let i = 0; i < 12; i++) {
        const a = sh.rot + (i * Math.PI) / 6
        const x = Math.cos(a) * (r + 11)
        const y = Math.sin(a) * (r + 11)
        g.circle(x, y + 2, 6, alpha('#000000', 0.35))
        g.circle(x, y, 6, shade(col.light, 0.35))
      }
      // Painted face.
      g.circle(0, 0, r, C.cream)
      g.circle(0, 0, r * 0.82, col.light)
      g.circle(0, 0, r * 0.68, C.cream)
      g.circle(0, 0, r * 0.52, col.main)
      g.circle(0, 0, r * 0.36, C.cream)
      for (let i = 0; i < 6; i++) {
        const a = sh.rot + (i * Math.PI) / 3
        g.line(
          Math.cos(a) * r * 0.24,
          Math.sin(a) * r * 0.24,
          Math.cos(a) * r * 0.98,
          Math.sin(a) * r * 0.98,
          alpha(C.ink, 0.2),
          6,
        )
      }
      // The boss: circle for red, square for blue, turning with the face.
      g.at(0, 0, sh.rot, () => {
        g.sideMark(owner, 0, 4, r * 0.2, shade(col.dark, -0.3))
        g.sideMark(owner, 0, 0, r * 0.2, col.dark)
        g.sideMark(owner, -4, -5, r * 0.08, alpha('#ffffff', 0.45))
      })
      // Gloss across the top-left.
      g.alpha(0.55, () => g.arc(0, 0, r + 10, Math.PI * 1.08, Math.PI * 1.42, '#ffffff', 7))
      g.alpha(0.18, () => g.ellipse(-r * 0.35, -r * 0.45, r * 0.45, r * 0.2, '#ffffff', -0.5))
      if (hit > 0) g.alpha(hit * 0.55, () => g.circle(0, 0, r + 22, '#ffffff'))
    },
    scale,
  )
  // Almost full: the rim glows, because the next swords clear it.
  if (sh.stuck.length >= CAP - 2) {
    const k = 0.45 + 0.35 * Math.sin(now * 9)
    g.alpha(k, () => g.ring(sh.x, sh.y, r + 30, C.yellow, 8))
  }
  const clr = since(t, sh.clearT, 0.5)
  if (clr > 0) {
    g.alpha(clr, () => g.ring(sh.x, sh.y, r + 30 + (1 - clr) * 160, C.yellow, 14 * clr + 2))
  }
}

/**
 * A sword: `x, y` is the tip, `ang` the direction from the tip back to the hilt.
 * Drawn in its own frame so the same code serves flying, stuck and fallen swords.
 */
export function drawSword(
  g: Draw,
  x: number,
  y: number,
  ang: number,
  grip: string,
  opacity = 1,
): void {
  g.alpha(opacity, () =>
    g.at(x, y, ang, () => {
      const w = 11
      const hilt = BLADE
      const blade = [0, 0, 28, -w, hilt - 6, -w * 0.85, hilt, 0, hilt - 6, w * 0.85, 28, w]
      g.poly(blade, undefined, alpha(C.ink, 0.55), 5)
      g.poly(
        blade,
        g.lin(0, -w, 0, w, [
          [0, '#ffffff'],
          [0.45, STEEL],
          [1, '#7d86a6'],
        ]),
      )
      g.line(22, 0, hilt - 14, 0, alpha('#ffffff', 0.85), 3)
      // Crossguard, then a grip in the thrower's colour and a gold pommel.
      g.rrect(hilt - 6, -27, 15, 54, 7, shade(GOLD, -0.3))
      g.rrect(hilt - 6, -27, 13, 50, 6, GOLD)
      g.rrect(hilt + 7, -8, LEN - hilt - 18, 16, 8, shade(grip, -0.2))
      g.rrect(hilt + 7, -8, LEN - hilt - 18, 8, 4, grip)
      g.circle(LEN - 8, 0, 12, shade(GOLD, -0.3))
      g.circle(LEN - 9, -2, 10, GOLD)
      g.circle(LEN - 12, -5, 3.5, alpha('#ffffff', 0.7))
    }),
  )
}

/** Pale dotted line down the sword's flight: where it will go if the tap lands now. */
function drawAimGuide(g: Draw, s: State, side: Side): void {
  const d = dirOf(side, aimAngle(s, side))
  const p = PIVOT[side] as { x: number; y: number }
  const col = SIDE[side].light
  for (let i = 0; i < 9; i++) {
    const dist = START + 60 + i * 72
    const x = p.x + d.x * dist
    const y = p.y + d.y * dist
    g.alpha(0.7 - i * 0.075, () => g.circle(x, y, 8 - i * 0.5, col))
  }
}

/** Face and bounce for the side's thrower: reacts to its last throw, then to the clock. */
function moodOf(s: State, side: Side, end: number): { mood: Mood; hop: number } {
  if (s.left <= 0) {
    const [r, b] = s.score
    const won = side === 0 ? r > b : b > r
    if (r === b) return { mood: 'happy', hop: 0 }
    if (!won) return { mood: 'sad', hop: 0 }
    return { mood: 'grin', hop: Math.abs(Math.sin(end * 7)) * 34 }
  }
  const re = s.react[side]
  const k = since(s.t, re.t, 0.7)
  if (k > 0) {
    if (re.k === 'stick' || re.k === 'clear')
      return { mood: 'grin', hop: Math.sin((1 - k) * Math.PI) * (re.k === 'clear' ? 40 : 18) }
    if (re.k === 'clang') return { mood: 'dizzy', hop: 0 }
    if (re.k === 'own') return { mood: 'sad', hop: 0 }
  }
  return { mood: canThrow(s, side) ? 'happy' : 'wow', hop: 0 }
}

/** The side's thrower: a blob holding its next sword, lunging as it lets go. */
function drawThrower(g: Draw, s: State, side: Side, now: number, end: number): void {
  const p = PIVOT[side] as { x: number; y: number }
  const col = SIDE[side]
  const ready = canThrow(s, side)
  const d = dirOf(side, aimAngle(s, side))
  // 1 right after a throw, 0 when the arm has recovered.
  const k = s.left > 0 ? Math.max(0, s.reload[side] / RELOAD) : 0
  const lunge = Math.pow(k, 3)
  const { mood, hop } = moodOf(s, side, end)
  const fwd = side === 0 ? -1 : 1
  const bx = p.x + d.x * lunge * 26
  const by = p.y + fwd * lunge * 26
  g.shadow(p.x + 6, p.y + 44, 64 - hop * 0.4, 20, 0.4)
  if (ready && s.left > 0) {
    // The sword is held out in front, its hilt in the blob's fist.
    drawSword(g, p.x + d.x * START, p.y + d.y * START, Math.atan2(-d.y, -d.x), col.main)
    g.circle(p.x + d.x * 64, p.y + d.y * 64, 17, shade(col.main, -0.25))
    g.circle(p.x + d.x * 64 - 3, p.y + d.y * 64 - 3, 13, col.main)
  } else if (s.left > 0) {
    const r = 1 - s.reload[side] / RELOAD
    g.arc(p.x, p.y, 88, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * r, alpha(col.light, 0.9), 12)
  }
  // Upright for its own player; eyes on the sword.
  const o = g.orient(side)
  const flip = Math.abs(o) > 1 ? -1 : 1
  g.blob(bx, by - hop * (flip === 1 ? 1 : -1), 58, col.main, {
    mood,
    angle: o,
    look: [d.x * flip, d.y * flip],
    sx: 1 + lunge * 0.14,
    sy: 1 - lunge * 0.12 + (hop > 0 ? 0.04 : Math.sin(now * 5) * 0.02),
  })
}

export function render(
  g: Draw,
  s: State,
  now: number,
  endAt: number,
  human: readonly [boolean, boolean] = [true, true],
): void {
  const end = endAt >= 0 ? now - endAt : 0
  drawTable(g, s)
  // Each shield is drawn with the swords stuck in it, before the flying ones.
  for (const side of [0, 1] as Side[]) {
    const sh = s.shields[side] as Shield
    drawShield(g, sh, side, s.t, now)
    for (const st of sh.stuck) {
      const age = s.t - st.t
      const slide = Math.max(0, 1 - age / 0.12) * 110
      // A fresh sword quivers about its tip.
      const wob = age < 0.45 ? Math.sin(age * 70) * 0.16 * (1 - age / 0.45) : 0
      const th = sh.rot + st.a
      const tipR = RIM * 0.3
      const tx = sh.x + Math.cos(th) * (tipR + slide)
      const ty = sh.y + Math.sin(th) * (tipR + slide)
      drawSword(g, tx, ty, th + wob, SIDE[other(side)].main)
    }
  }
  for (const side of [0, 1] as Side[]) {
    if (s.left > 0 && canThrow(s, side)) drawAimGuide(g, s, side)
    drawThrower(g, s, side, now, end)
  }
  for (const sw of s.swords) drawFlying(g, sw)
  if (s.t < 5 && s.left > 0) {
    for (const side of [0, 1] as Side[]) {
      if (!human[side]) continue
      const y = side === 0 ? 1395 : 405
      banner(g, side, 'Tap to throw', y, {
        size: 44,
        alpha: Math.min(1, (5 - s.t) / 0.6) * (0.75 + 0.25 * Math.sin(now * 4)),
      })
    }
  }
}

/** A sword in flight: ghost copies streak behind it. Loose ones tumble and fade. */
function drawFlying(g: Draw, sw: Sword): void {
  const grip = SIDE[sw.side].main
  if (sw.drop) {
    const fade = Math.max(0, 1 - sw.t / 0.8)
    const ang = Math.atan2(-sw.vy, -sw.vx)
    drawSword(g, sw.x, sw.y, ang + sw.t * 9, grip, fade)
    return
  }
  const ang = Math.atan2(-sw.vy, -sw.vx)
  for (let i = 3; i >= 1; i--) {
    drawSword(g, sw.x - sw.vx * 0.016 * i, sw.y - sw.vy * 0.016 * i, ang, grip, 0.22 / i)
  }
  g.shadow(sw.x - sw.vx * 0.04 + 10, sw.y - sw.vy * 0.04 + 22, 46, 10, 0.25)
  drawSword(g, sw.x, sw.y, ang, grip)
}

/** Score plaque at a player's corner, popping when it goes up. */
export function drawScore(g: Draw, s: State, side: Side, win: boolean, now: number): void {
  const y = hudY(g, side, 74)
  const x = side === 0 ? 120 : W - 120
  const re = s.react[side]
  const pop = re.k === 'stick' || re.k === 'clear' ? since(s.t, re.t, 0.3) : 0
  const col = SIDE[side]
  g.forSide(side, x, y, () => {
    g.at(
      0,
      0,
      0,
      () => {
        if (win) {
          g.alpha(0.5 + 0.3 * Math.sin(now * 8), () => g.rrect(-82, -56, 164, 112, 34, C.yellow))
        }
        g.tile(-72, -46, 144, 100, 28, shade(col.main, -0.45), 10)
        g.text(s.score[side], 0, 0, { size: 66, weight: 700, color: C.white })
      },
      1 + pop * 0.35,
    )
  })
}

/** Time running out: a fuse along the midline that burns toward the middle, yellow at the end. */
export function drawFuse(g: Draw, s: State, now: number): void {
  const k = Math.max(0, s.left / s.total)
  const urgent = s.left <= 10
  const half = 470 * k
  const col = urgent ? C.yellow : alpha(C.cream, 0.55)
  g.line(W / 2 - 470, MID, W / 2 + 470, MID, alpha('#000000', 0.3), 10)
  if (half > 1) {
    g.line(W / 2 - half, MID, W / 2 + half, MID, col, 8)
    if (s.left > 0) {
      for (const sx of [-1, 1]) {
        const fx = W / 2 + sx * half
        g.circle(fx, MID, 11 + Math.sin(now * 30 + sx) * 3, C.orange)
        g.circle(fx, MID, 6, C.yellow)
      }
    }
  }
}

/** "Time!" stamped over the table as the whistle goes, readable from both ends. */
export function drawTimeUp(g: Draw, end: number): void {
  if (end <= 0 || end > 1.6) return
  const a = Math.min(1, (1.6 - end) / 0.3)
  const pop = end < 0.25 ? 0.6 + (end / 0.25) * 0.55 : 1.15 - Math.min(0.15, (end - 0.25) * 0.6)
  g.alpha(a, () => {
    const one = (angle: number, cy: number) =>
      g.at(
        W / 2,
        cy,
        angle,
        () => {
          g.rrect(-190, -64, 380, 128, 64, alpha(C.ink, 0.88))
          g.text('Time!', 0, 4, { size: 86, weight: 700, color: C.yellow })
        },
        pop,
      )
    if (g.flipTop) {
      one(0, MID + 150)
      one(Math.PI, MID - 150)
    } else one(g.orient(), MID)
  })
}
