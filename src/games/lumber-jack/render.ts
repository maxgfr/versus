import type { Side } from '../../core/game.ts'
import { frame, inFrame, textAngle } from '../../core/frame.ts'
import { inCubic, outBack, outCubic } from '../../core/fx/ease.ts'
import { banner, bigScore, namePill } from '../../core/hud.ts'
import type { Draw, Mood } from '../../core/render/draw.ts'
import { alpha, C, mix, SIDE, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { isStunned, type Chopper, type State } from './rules.ts'

/*
 * The yard is drawn once in red's frame (bottom half, the trunk rising from the
 * stump at BASE_BOT toward the middle) and placed for blue by `inFrame`.
 * Anything that must read upright uses `textAngle` inside the frame.
 */

export const TRUNK_X = W / 2
export const SEG_W = 224
const SEG_H = 108
export const BASE_BOT = 1600
/** Visible trunk segments above the stump. */
const SLOTS = 5
/** The lumberjack stands this far to either side of the trunk. */
const STAND_X = 320
const STAND_Y = 1500
const WOOD = C.wood
const WOOD_DARK = C.woodDark
const LEAF = '#3fb760'
const FOREST = '#0f2a22'
/** Progress race bar, red frame. */
const BAR_X0 = 180
const BAR_X1 = 820
const BAR_Y = MID + 74

/** Top y of the slot `k` (0 = the one resting on the stump). */
const slotTop = (k: number): number => BASE_BOT - (k + 1) * SEG_H
/** The lumberjack's x for a chop from `from`. */
const standX = (from: number): number => TRUNK_X + (from === 0 ? -STAND_X : STAND_X)
/** Where the axe bites for a chop from `from`, red frame. */
export const biteAt = (from: number): { x: number; y: number } => ({
  x: TRUNK_X + (from === 0 ? -SEG_W / 2 : SEG_W / 2),
  y: slotTop(0) + SEG_H / 2,
})
/** The lumberjack's head, red frame (where a bonk lands). */
export const headAt = (from: number): { x: number; y: number } => ({
  x: standX(from),
  y: STAND_Y - 70,
})

/** Grass tufts and fallen leaves, fixed for the whole match (red frame, mirrored for blue). */
const TUFTS: { x: number; y: number; s: number; leaf: boolean }[] = (() => {
  let a = 1234567
  const r = () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) as number
  const out: { x: number; y: number; s: number; leaf: boolean }[] = []
  for (let i = 0; i < 26; i++) {
    const x = 120 + r() * 760
    const y = 1000 + r() * 760
    // Keep the trunk column clear, and the HUD row (score, name pill) clean.
    if (Math.abs(x - TRUNK_X) < 160 || y > 1650) continue
    out.push({ x, y, s: 0.7 + r() * 0.6, leaf: r() < 0.35 })
  }
  return out
})()

function yard(g: Draw, now: number): void {
  const v = g.stage.view
  g.fillView(FOREST)
  const bot = v.y + v.h + 2
  g.rect(
    v.x - 2,
    MID,
    v.w + 4,
    bot - MID,
    g.lin(0, MID, 0, bot, [
      [0, mix(FOREST, C.red, 0.12)],
      [1, mix('#07140f', C.red, 0.42)],
    ]),
  )
  g.rect(
    v.x - 2,
    v.y - 2,
    v.w + 4,
    MID - v.y + 2,
    g.lin(0, MID, 0, v.y, [
      [0, mix(FOREST, C.blue, 0.14)],
      [1, mix('#07140f', C.blue, 0.46)],
    ]),
  )
  for (const side of [0, 1] as Side[]) {
    inFrame(g, side, () => {
      // Floodlight pool around the stump.
      g.ellipse(
        TRUNK_X,
        BASE_BOT - 60,
        560,
        420,
        g.rad(TRUNK_X, BASE_BOT - 60, 0, 560, [
          [0, alpha(SIDE[side].light, 0.16)],
          [1, alpha(SIDE[side].light, 0)],
        ]),
      )
      for (const t of TUFTS) {
        const sway = Math.sin(now * 1.6 + t.x) * 0.12
        if (t.leaf) {
          g.ellipse(t.x, t.y, 16 * t.s, 8 * t.s, alpha(C.orange, 0.35), t.x)
        } else {
          for (const a of [-0.5, 0, 0.5]) {
            const ang = a + sway - Math.PI / 2
            g.line(
              t.x,
              t.y,
              t.x + Math.cos(ang) * 30 * t.s,
              t.y + Math.sin(ang) * 30 * t.s,
              alpha(C.grass, 0.3),
              6,
            )
          }
        }
      }
    })
  }
  g.midline(alpha(C.white, 0.08))
  g.vignette(0.42)
}

/** The stump the trunk stands on, with roots. Red frame. */
function stump(g: Draw): void {
  const y = BASE_BOT
  g.shadow(TRUNK_X, y + 46, 220, 40, 0.4)
  for (const [dx, w, a] of [
    [-150, 110, 0.35],
    [150, 110, -0.35],
    [-70, 80, 0.1],
    [80, 80, -0.1],
  ] as const) {
    g.ellipse(TRUNK_X + dx, y + 30, w * 0.6, 22, shade(WOOD_DARK, -0.2), a)
  }
  g.rrect(TRUNK_X - SEG_W / 2 - 20, y - 6, SEG_W + 40, 54, 18, shade(WOOD_DARK, -0.15))
  g.rrect(
    TRUNK_X - SEG_W / 2 - 20,
    y - 10,
    SEG_W + 40,
    44,
    18,
    g.lin(TRUNK_X - SEG_W / 2 - 20, 0, TRUNK_X + SEG_W / 2 + 20, 0, [
      [0, shade(WOOD_DARK, -0.05)],
      [0.4, shade(WOOD, -0.12)],
      [1, shade(WOOD_DARK, -0.25)],
    ]),
  )
}

/** A log segment whose top edge is y, centred on x. Index `i` picks its knots. */
function log(g: Draw, x: number, y: number, i: number): void {
  const left = x - SEG_W / 2
  const h = SEG_H - 6
  g.rrect(left, y + 10, SEG_W, h - 4, 20, shade(WOOD_DARK, -0.45))
  g.rrect(
    left,
    y,
    SEG_W,
    h,
    20,
    g.lin(left, 0, left + SEG_W, 0, [
      [0, shade(WOOD, -0.28)],
      [0.3, shade(WOOD, 0.06)],
      [0.65, WOOD],
      [1, shade(WOOD, -0.4)],
    ]),
  )
  // Bark creases, offset per segment so the trunk does not look tiled.
  const off = (i * 37) % 40
  for (const dx of [30, 92, 158]) {
    const xx = left + dx + off * 0.5
    if (xx > left + SEG_W - 20) continue
    g.line(xx, y + 14, xx + 6, y + h - 16, alpha(WOOD_DARK, 0.55), 7)
  }
  if (i % 3 === 1) {
    const kx = left + 60 + ((i * 53) % 110)
    g.ellipse(kx, y + h * 0.5, 16, 11, shade(WOOD_DARK, -0.2))
    g.ellipse(kx, y + h * 0.5, 9, 6, shade(WOOD, -0.25))
  }
  // Gloss along the top.
  g.rrect(left + 10, y + 6, SEG_W - 20, 14, 7, alpha('#fff3d6', 0.18))
}

/** The cut face of a log flying off: end grain with rings. Drawn around its centre. */
function flyingLog(g: Draw, i: number): void {
  log(g, 0, -SEG_H / 2, i)
  g.ellipse(SEG_W / 2 - 6, 0, 20, SEG_H / 2 - 8, '#f3d29a')
  g.ellipse(SEG_W / 2 - 6, 0, 12, SEG_H / 2 - 22, alpha(WOOD, 0.6))
}

/** Leaves: a chunky cluster of glossy balls. */
function foliage(g: Draw, x: number, y: number, dir: number, shake = 0): void {
  const jx = Math.sin(shake * 40) * 6 * Math.min(1, shake)
  for (const [dx, dy, r, k] of [
    [-6, 18, 34, -0.25],
    [24, 6, 30, -0.1],
    [2, -14, 36, 0],
    [36, -24, 26, 0.12],
  ] as const) {
    g.ball(x + dir * dx + jx, y + dy, r, shade(LEAF, k), 0.5)
  }
}

/** A branch sticking out of the trunk on `side` (0 left, 1 right), leaves at its tip. */
function branch(g: Draw, side: 0 | 1, yc: number, shake = 0): void {
  const dir = side === 0 ? -1 : 1
  const x0 = TRUNK_X + dir * (SEG_W / 2 - 14)
  const x1 = TRUNK_X + dir * (SEG_W / 2 + 130)
  g.poly([x0, yc - 22, x1, yc - 20, x1, yc - 4, x0, yc + 26], shade(WOOD_DARK, -0.1))
  g.poly([x0, yc - 22, x1, yc - 20, x1 - dir * 6, yc - 12, x0, yc - 2], shade(WOOD, -0.05))
  foliage(g, x1 + dir * 6, yc - 18, dir, shake)
}

/** A falling branch, drawn around its middle. */
function branchPiece(g: Draw, dir: number): void {
  g.poly([-dir * 70, -14, dir * 60, -12, dir * 60, 6, -dir * 70, 16], shade(WOOD_DARK, -0.1))
  foliage(g, dir * 66, -10, dir)
}

/** The trunk: the stack settling after a chop, the cut log, and the branch that came off. */
function trunk(g: Draw, c: Chopper, seq: number[], now: number, fall: number): void {
  const since = c.chopAt >= 0 ? now - c.chopAt : 99
  // Segments settle one slot down after each chop.
  const settle = outCubic(Math.min(1, since / 0.12))
  const fallDir = c.from === 0 ? 1 : -1
  const pivotX = TRUNK_X + fallDir * (SEG_W / 2)
  const tilt = fall > 0 ? inCubic(Math.min(1, fall / 0.7)) * (Math.PI / 2) * fallDir : 0
  g.alpha(fall > 1.2 ? Math.max(0, 1 - (fall - 1.2) * 3) : 1, () =>
    g.at(
      pivotX,
      BASE_BOT,
      tilt,
      () =>
        g.at(-pivotX, -BASE_BOT, 0, () => {
          for (let k = SLOTS - 1; k >= 0; k--) {
            const i = c.chops + k
            if (i >= seq.length) continue
            const y = slotTop(k) - (1 - settle) * SEG_H
            const top = k === SLOTS - 1
            g.alpha(top ? 0.55 : k === SLOTS - 2 ? 0.85 : 1, () => {
              log(g, TRUNK_X, y, i)
              const b = seq[i] ?? -1
              if (b === 0 || b === 1) branch(g, b, y + SEG_H / 2, k === 0 ? since : 0)
            })
          }
        }),
      1,
    ),
  )
  // The cut log is knocked out sideways, away from the axe, spinning.
  if (c.chops > 0 && since < 0.9) {
    const away = c.from === 0 ? 1 : -1
    const x = TRUNK_X + away * since * 1100
    const y = slotTop(0) + SEG_H / 2 - since * 260 + since * since * 1700
    g.at(x, y, since * away * 7, () => flyingLog(g, c.chops - 1))
  }
  // The branch from the cut segment: onto the chopper if it sat on their side, else away.
  if (c.branch >= 0 && since < 1.1) {
    const dir = c.branch === 0 ? -1 : 1
    const sx = TRUNK_X + dir * (SEG_W / 2 + 60)
    const sy = slotTop(0) + SEG_H / 2
    const t = Math.min(1, since / 0.3)
    if (c.bonk) {
      const h = headAt(c.from)
      const land = since > 0.3 ? (since - 0.3) * 900 : 0
      const x = sx + (h.x - sx) * t
      const y = sy + (h.y - 50 - sy) * t * t + land * land * 0.002 + land
      g.alpha(since > 0.7 ? Math.max(0, 1 - (since - 0.7) * 3) : 1, () =>
        g.at(x, y, since * 6 * dir, () => branchPiece(g, dir)),
      )
    } else {
      const x = sx + dir * 420 * t
      const y = sy - 120 * t + 1300 * t * t
      g.at(x, y, since * 7 * dir, () => branchPiece(g, dir))
    }
  }
}

/** A hand axe drawn from its grip at the origin, blade toward +x when `a` = 0. */
function axe(g: Draw): void {
  g.line(0, 0, 120, 0, shade(WOOD_DARK, -0.2), 18)
  g.line(0, -2, 120, -2, WOOD, 10)
  g.poly([96, -46, 140, -38, 148, 0, 140, 34, 96, 42, 106, 0], '#9aa3b8')
  g.poly([126, -40, 140, -38, 148, 0, 140, 34, 126, 36, 134, 0], '#e6ecf5')
  g.circle(104, 0, 8, shade(WOOD_DARK, -0.3))
}

/** The lumberjack: a team blob in a beanie that hops to the side it chops from. Red frame. */
function jack(
  g: Draw,
  side: Side,
  c: Chopper,
  now: number,
  end: 'play' | 'win' | 'lose',
  endT: number,
): void {
  const since = c.chopAt >= 0 ? now - c.chopAt : 99
  const from = c.from === 1 ? 1 : 0
  const prev = c.prev === 1 ? 1 : c.prev === 0 ? 0 : from
  // Hop across when switching sides.
  const hopT = Math.min(1, since / 0.12)
  const x = standX(prev) + (standX(from) - standX(prev)) * outCubic(hopT)
  const lift = prev !== from && hopT < 1 ? Math.sin(hopT * Math.PI) * 60 : 0
  const dir = from === 0 ? -1 : 1
  const stunned = isStunned(c, now)
  const kick = since < 0.2 ? Math.sin((since / 0.2) * Math.PI) : 0
  const winHop = end === 'win' ? Math.abs(Math.sin(endT * 8)) * 50 : 0
  const bob = Math.sin(now * 5 + side) * 4
  const y = STAND_Y + bob - lift - winHop
  let mood: Mood = stunned ? 'dizzy' : since < 0.3 ? (c.bonk ? 'wow' : 'grin') : 'happy'
  if (end === 'win') mood = 'grin'
  if (end === 'lose') mood = 'sad'
  const angle = textAngle(g, side)
  const flip = Math.abs(angle) > 1
  const col = SIDE[side].main
  // Axe: raised, then a fast swing into the trunk on each chop.
  const swing = since < 0.08 ? since / 0.08 : since < 0.3 ? 1 - (since - 0.08) / 0.22 : 0
  const axeA = -1.9 + swing * 2.0 + (stunned ? 0.9 : 0)
  // Contact shadow stays on the ground (under the figure as its reader sees it).
  g.at(
    standX(from),
    STAND_Y,
    angle,
    () => g.shadow(0, 84, 76 - (lift + winHop) * 0.25, 20),
    flip ? -1 : 1,
    1,
  )
  // The whole figure turns upright for its reader; mirroring keeps the axe toward the trunk.
  g.at(
    x,
    y,
    angle,
    () => {
      const toward = -dir
      g.blob(0, 0, 72, col, {
        mood,
        sx: 1 + kick * 0.12 + (stunned ? 0.06 : 0),
        sy: 1 - kick * 0.12 - (stunned ? 0.08 : 0),
        look: [toward * 0.6, 0.1],
      })
      // Beanie with a pompom.
      g.path(
        (p) => {
          p.arc(0, -40, 58, Math.PI + 0.2, -0.2)
          p.closePath()
        },
        shade(col, -0.45),
      )
      g.rrect(-62, -56, 124, 22, 11, shade(col, -0.25))
      g.ball(0, -100, 17, C.white, 0.6)
      g.at(toward * 48, 22, 0, () => g.at(0, 0, axeA, () => axe(g)), toward, 1)
      if (stunned) {
        g.ball(toward * -20, -72, 14, shade(col, 0.25), 0.6)
        for (let i = 0; i < 3; i++) {
          const a = now * 6 + (i * Math.PI * 2) / 3
          g.star(Math.cos(a) * 64, -96 + Math.sin(a) * 16, 16, C.yellow, 5, 0.5, a)
        }
      }
    },
    flip ? -1 : 1,
    1,
  )
}

/** The side just chopped lights up for a moment. Red frame. */
function zone(g: Draw, side: Side, c: Chopper, now: number): void {
  const since = c.chopAt >= 0 ? now - c.chopAt : 99
  if (since > 0.25) return
  const x = c.from === 0 ? 250 : 750
  const y = 1400
  g.alpha((1 - since / 0.25) * 0.45, () =>
    g.circle(
      x,
      y,
      320,
      g.rad(x, y, 0, 320, [
        [0, c.bonk ? C.yellow : SIDE[side].light],
        [1, alpha(SIDE[side].light, 0)],
      ]),
    ),
  )
}

/** The race to the target: a track per player across the middle, filling toward the flag. Red frame. */
function raceBar(
  g: Draw,
  side: Side,
  chops: number,
  target: number,
  now: number,
  since: number,
): void {
  const w = BAR_X1 - BAR_X0
  const col = SIDE[side]
  const k = Math.min(1, chops / target)
  g.rrect(BAR_X0 - 8, BAR_Y - 30, w + 16, 60, 30, alpha(C.ink, 0.75))
  for (let i = 1; i < 5; i++) {
    const x = BAR_X0 + (w * i) / 5
    g.line(x, BAR_Y - 12, x, BAR_Y + 12, alpha(C.white, 0.15), 4)
  }
  if (k > 0) {
    const fw = Math.max(44, w * k)
    g.rrect(BAR_X0, BAR_Y - 22, fw, 44, 22, shade(col.main, -0.3))
    g.rrect(
      BAR_X0,
      BAR_Y - 22,
      fw,
      36,
      18,
      g.lin(0, BAR_Y - 22, 0, BAR_Y + 14, [
        [0, col.light],
        [1, col.main],
      ]),
    )
  }
  // Checkered flag at the finish.
  for (let r = 0; r < 4; r++)
    for (let q = 0; q < 2; q++)
      g.rect(BAR_X1 + 14 + q * 12, BAR_Y - 24 + r * 12, 12, 12, (r + q) % 2 ? C.ink : C.white)
  const pop = since < 0.2 ? 1 - since / 0.2 : 0
  const hx = BAR_X0 + Math.max(22, w * k)
  g.disc(hx, BAR_Y - 2, 26 + pop * 8, C.white, 5)
  g.sideMark(side, hx, BAR_Y - 3, 12, col.main)
  if (chops >= target - 5 && chops < target) {
    const a = 0.5 + 0.5 * Math.sin(now * 10)
    g.ring(BAR_X1 + 26, BAR_Y, 40 + a * 6, alpha(C.yellow, 0.6), 5)
  }
}

export interface YardOpts {
  names: [string, string]
  target: number
  /** Game time the race was won (-1 while racing). */
  endAt: number
  winner: Side | 'draw' | null
  /** Which sides the computer plays (no tap hints for them). */
  bots: [boolean, boolean]
}

/** The whole yard for both players, with the HUD and the start prompt. */
export function renderYard(g: Draw, s: State, now: number, o: YardOpts): void {
  yard(g, now)
  const endT = o.endAt >= 0 ? now - o.endAt : 0
  for (const side of [0, 1] as Side[]) {
    const c = s.p[side]
    const end: 'play' | 'win' | 'lose' =
      o.endAt < 0 || o.winner === null || o.winner === 'draw'
        ? 'play'
        : o.winner === side
          ? 'win'
          : 'lose'
    inFrame(g, side, () => {
      zone(g, side, c, now)
      stump(g)
      trunk(g, c, s.seq, now, end === 'win' ? endT - 0.25 : -1)
      jack(g, side, c, now, end, endT)
      const since = c.chopAt >= 0 ? now - c.chopAt : 99
      raceBar(g, side, c.chops, o.target, now, since)
      // Before the first chop: show where to tap.
      if (c.chops === 0 && !o.bots[side]) {
        const a = 0.55 + 0.45 * Math.sin(now * 6)
        for (const from of [0, 1] as const) {
          const x = from === 0 ? 170 : 830
          g.alpha(a, () =>
            g.text(from === 0 ? '◀ TAP' : 'TAP ▶', x, 1290, {
              size: 50,
              weight: 700,
              color: SIDE[side].light,
              stroke: alpha(C.ink, 0.6),
              strokeWidth: 10,
              angle: textAngle(g, side),
            }),
          )
        }
      }
    })
  }
  for (const side of [0, 1] as Side[]) {
    const c = s.p[side]
    const since = c.chopAt >= 0 ? now - c.chopAt : 99
    namePill(g, side, o.names[side], {
      active: since < 0.15,
      text: isStunned(c, now) ? 'Ouch!' : undefined,
    })
    const pop = since < 0.22 ? 1 - since / 0.22 : 0
    bigScore(g, side, c.chops, { x: frame(side, 140, 0).x, size: 80 * (1 + pop * 0.3) })
  }
  const hint = 1 - Math.max(0, (now - 2.6) / 0.6)
  if (hint > 0) {
    for (const side of [0, 1] as Side[]) {
      if (o.bots[side]) continue
      banner(g, side, 'Chop away from the branch!', frame(side, TRUNK_X, 1190).y, {
        size: 44,
        alpha: hint,
      })
    }
  }
  if (o.endAt >= 0 && o.winner !== null && o.winner !== 'draw') {
    const w = o.winner
    const t = Math.min(1, Math.max(0, endT - 0.5) / 0.3)
    if (t > 0) {
      const y = frame(w, TRUNK_X, 1180).y
      g.at(
        W / 2,
        y,
        0,
        () =>
          g.at(-W / 2, -y, 0, () =>
            banner(g, w, 'TIMBER!', y, { size: 84, color: C.yellow, alpha: Math.min(1, t * 2) }),
          ),
        0.3 + 0.7 * outBack(t),
      )
    }
  }
}
