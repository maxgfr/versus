import { outBack } from '../../core/fx/ease.ts'
import type { Side } from '../../core/game.ts'
import { banner, bigScore, hudY } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, shade, SIDE } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { floodlit, tally, windSock } from './look.ts'
import {
  BAR,
  CEIL,
  forwardY,
  GOAL_BOT,
  GOAL_TOP,
  GOAL_X,
  goalY,
  KICKS,
  type Kick,
  POST_HALF,
  result,
  spotOf,
  type State,
  WIND_MAX,
} from './rules.ts'

export interface Look {
  /** The kick the side on turn is lining up, null when idle. */
  aim: { power: number; preview: { x: number; y: number; z: number }[] } | null
  /** Show the "swipe up" hint to the human on turn. */
  hint: boolean
}

/** Height on screen per unit of height: things stand up away from their kicker. */
const Z = 0.6
const LEFT = 50
const RIGHT = W - 50

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const hash = (i: number, k: number): number => {
  const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453
  return v - Math.floor(v)
}

/** Ground point (x, y) at height z, as seen by `side`'s kicker. */
const lift = (side: Side, y: number, z: number): number => y + forwardY(side) * z * Z

function drawPitch(g: Draw): void {
  const v = g.stage.view
  g.fillView(shade(C.grassDark, -0.25))
  // Mown bands between the touchlines.
  for (let i = 0; i < 15; i++)
    g.rect(LEFT, i * 120, RIGHT - LEFT, 120, i % 2 === 0 ? C.grass : shade(C.grass, -0.08))
  // End zones beyond each goal line, owned by the team whose edge they are.
  for (const side of [0, 1] as Side[]) {
    const y0 = side === 1 ? 0 : GOAL_BOT
    const y1 = side === 1 ? GOAL_TOP : H
    g.rect(LEFT, y0, RIGHT - LEFT, y1 - y0, alpha(SIDE[side].dark, 0.55))
    g.ctx.save()
    g.ctx.beginPath()
    g.ctx.rect(LEFT, y0, RIGHT - LEFT, y1 - y0)
    g.ctx.clip()
    for (let x = LEFT - 400; x < RIGHT; x += 70)
      g.line(x, y1, x + (y1 - y0), y0, alpha(SIDE[side].main, 0.22), 18)
    g.ctx.restore()
  }
  // Turf grain.
  for (let i = 0; i < 70; i++) {
    const x = v.x + hash(i, 1) * v.w
    const y = v.y + hash(i, 2) * v.h
    g.circle(x, y, 10 + hash(i, 3) * 16, alpha(shade(C.grassDark, -0.35), 0.12))
  }
  // Yard lines every 120 between the goal lines, with hash marks.
  const line = alpha(C.white, 0.85)
  for (let y = GOAL_TOP + 120; y < GOAL_BOT - 60; y += 120) {
    g.line(LEFT, y, RIGHT, y, alpha(C.white, 0.28), 5)
    for (const x of [GOAL_X - POST_HALF, GOAL_X + POST_HALF])
      g.line(x, y - 14, x, y + 14, alpha(C.white, 0.5), 5)
  }
  g.line(LEFT, MID, RIGHT, MID, alpha(C.white, 0.45), 7)
  g.line(LEFT, GOAL_TOP, RIGHT, GOAL_TOP, line, 10)
  g.line(LEFT, GOAL_BOT, RIGHT, GOAL_BOT, line, 10)
  g.rrect(LEFT, -40, RIGHT - LEFT, H + 80, 0, undefined, line, 8)
}

/**
 * The H at one end, standing up away from the side that kicks at it. The goal
 * on turn is yellow and its scoring window glows in the kicker's colour.
 */
function drawGoal(
  g: Draw,
  kicker: Side,
  active: boolean,
  wind: number,
  flash: number,
  now: number,
): void {
  const gy = goalY(kicker)
  const col = active ? C.yellow : shade(C.white, -0.08)
  const xl = GOAL_X - POST_HALF
  const xr = GOAL_X + POST_HALF
  const bar = lift(kicker, gy, BAR)
  const top = lift(kicker, gy, CEIL)
  const f = forwardY(kicker)
  // Shadows of the frame laid on the turf, away from the light.
  g.alpha(0.22, () => {
    g.line(xl + 8, gy + 6, xl + 60, gy + 46, '#000', 12)
    g.line(xr + 8, gy + 6, xr + 60, gy + 46, '#000', 12)
  })
  // The scoring window.
  g.poly(
    [xl, bar, xr, bar, xr, top, xl, top],
    alpha(active ? SIDE[kicker].light : C.white, (active ? 0.16 : 0.05) + flash * 0.45),
  )
  // Uprights taper toward the top: a touch of perspective.
  for (const x of [xl, xr]) {
    g.poly([x - 9, gy, x + 9, gy, x + 5, top, x - 5, top], shade(col, -0.3))
    g.poly([x - 7, gy, x + 3, gy, x + 1, top, x - 4, top], col)
    // Padding at the foot.
    g.rrect(x - 16, gy - (f < 0 ? 46 : 0), 32, 46, 10, SIDE[kicker === 0 ? 1 : 0].main)
    // Ribbon at the top, streaming with the wind.
    const k = Math.min(1, Math.abs(wind) / WIND_MAX)
    const dir = Math.sign(wind) || 1
    const flap = Math.sin(now * (6 + 6 * k) + x) * 6
    g.poly(
      [x, top, x + dir * (24 + 40 * k), top + f * -4 + flap, x, top + f * -14],
      active ? C.orange : alpha(C.white, 0.7),
    )
  }
  g.line(xl, bar, xr, bar, shade(col, -0.3), 18, 'butt')
  g.line(xl, bar - 3, xr, bar - 3, col, 11, 'butt')
  if (flash > 0)
    g.alpha(flash, () =>
      g.rrect(
        xl - 30,
        Math.min(top, gy) - 30,
        xr - xl + 60,
        Math.abs(gy - top) + 60,
        30,
        undefined,
        C.yellow,
        8,
      ),
    )
}

/** A glossy leather ball along +x, laces on top, white bands near the tips. */
function football(g: Draw, x: number, y: number, len: number, angle: number): void {
  const leather = '#9a5426'
  g.at(x, y, angle, () => {
    g.ellipse(0, 3, len / 2, len * 0.32, shade(leather, -0.45))
    g.ellipse(
      0,
      0,
      len / 2,
      len * 0.31,
      g.rad(
        0,
        0,
        len * 0.05,
        len * 0.5,
        [
          [0, shade(leather, 0.35)],
          [0.7, leather],
          [1, shade(leather, -0.3)],
        ],
        -len * 0.12,
        -len * 0.12,
      ),
    )
    for (const sx of [-1, 1])
      g.line(sx * len * 0.3, -len * 0.2, sx * len * 0.3, len * 0.2, C.white, len * 0.05)
    g.line(-len * 0.16, -len * 0.02, len * 0.16, -len * 0.02, C.white, len * 0.05)
    for (let i = -2; i <= 2; i++)
      g.line(i * len * 0.065, -len * 0.08, i * len * 0.065, len * 0.04, C.white, len * 0.035)
    g.alpha(0.5, () => g.ellipse(-len * 0.12, -len * 0.16, len * 0.16, len * 0.05, '#fff'))
  })
}

/** The ball in flight, tumbling end over end, its shadow on the turf. */
function drawFlying(g: Draw, k: Kick, now: number): void {
  const gy = goalY(k.side)
  const rem = Math.abs(gy - k.y)
  const scale = Math.max(0.55, 0.62 + 0.38 * clamp01(rem / 900)) * (1 + Math.max(0, k.z) / 1400)
  const sy = lift(k.side, k.y, k.z)
  g.shadow(k.x, k.y + 6, 22 * scale, 9 * scale, 0.35 / (1 + k.z / 300))
  // Streak behind it along the screen motion.
  const vy = k.vy + forwardY(k.side) * k.vz * Z
  for (let i = 1; i <= 3; i++)
    g.alpha(0.2 - i * 0.05, () =>
      g.circle(k.x - k.vx * 0.02 * i, sy - vy * 0.02 * i, 18 * scale, C.white),
    )
  football(g, k.x, sy, 54 * scale * (0.75 + 0.25 * Math.abs(Math.cos(now * 14))), now * 3)
}

function drawKicker(
  g: Draw,
  side: Side,
  spot: { x: number; y: number },
  lunge: number,
  mood: 'happy' | 'wow' | 'sad' | 'grin',
): void {
  const f = forwardY(side)
  const bx = spot.x - 58 + lunge * 30
  const by = spot.y - f * (100 - lunge * 60)
  g.shadow(bx + 6, by + 42, 44, 14, 0.35)
  g.blob(bx, by, 48, SIDE[side].main, {
    mood,
    look: [0.3, f * 0.9],
    angle: g.orient(side),
    sx: 1 + lunge * 0.15,
    sy: 1 - lunge * 0.15,
  })
}

/** Kicking tee with the ball standing on it. */
function drawTee(g: Draw, side: Side, x: number, y: number, active: boolean, now: number): void {
  if (active) {
    const p = 0.5 + 0.5 * Math.sin(now * 6)
    g.alpha(0.5 + p * 0.5, () => g.ring(x, y, 44 + p * 6, C.yellow, 6))
  }
  g.shadow(x + 4, y + 8, 26, 10, 0.35)
  g.poly([x - 16, y + 10, x + 16, y + 10, x + 8, y - 6, x - 8, y - 6], C.orange)
  football(g, x, y - 16, 48, g.orient(side) - Math.PI / 2)
}

export function render(g: Draw, s: State, look: Look, now: number): void {
  drawPitch(g)
  floodlit(g, 0.4)

  const outAge = now - s.outAt
  const flashOf = (kicker: Side) =>
    s.last?.side === kicker && s.last.outcome === 'good' && s.phase === 'beat'
      ? Math.max(0, 1 - outAge / 0.9)
      : 0
  const k = s.kick
  const crossed = (kicker: Side) =>
    k !== null && k.side === kicker && (kicker === 0 ? k.y < GOAL_TOP : k.y > GOAL_BOT)

  // Each side's next spot: the kicker on turn stands at theirs, ready.
  const kicking = s.phase === 'aim' || (s.phase === 'fly' && now - s.kickAt < 0.5)
  for (const side of [0, 1] as Side[]) {
    const spot = spotOf(s, side)
    const on = s.turn === side && s.endAt < 0
    if (!on) {
      g.alpha(0.35, () => g.ring(spot.x, spot.y, 30, SIDE[side].light, 5))
      continue
    }
    if (s.phase === 'aim') drawTee(g, side, spot.x, spot.y, true, now)
    else
      g.poly(
        [
          spot.x - 16,
          spot.y + 10,
          spot.x + 16,
          spot.y + 10,
          spot.x + 8,
          spot.y - 6,
          spot.x - 8,
          spot.y - 6,
        ],
        C.orange,
      )
  }

  // Ball beyond a goal plane is drawn behind those posts.
  for (const kicker of [0, 1] as Side[]) {
    if (k && crossed(kicker)) drawFlying(g, k, now)
    drawGoal(g, kicker, s.turn === kicker && s.endAt < 0, s.wind, flashOf(kicker), now)
  }

  // Preview: the first part of the arc, lifted the same way the ball is.
  // Online, it is the kicker's own control: only their phone shows it.
  const own = g.viewer === null || g.viewer === s.turn
  if (look.aim && own) {
    const side = s.turn
    const pts = look.aim.preview
    pts.forEach((p, i) => {
      const a = 1 - i / (pts.length + 2)
      g.alpha(a * 0.25, () => g.circle(p.x, p.y, 7, '#000'))
      g.alpha(a, () => g.circle(p.x, lift(side, p.y, p.z), 7 + p.z * 0.02, SIDE[side].light))
    })
    const spot = spotOf(s, side)
    const p = look.aim.power
    g.arc(spot.x, spot.y, 64, 0, Math.PI * 2, alpha(C.ink, 0.5), 12)
    g.arc(
      spot.x,
      spot.y,
      64,
      -Math.PI / 2,
      -Math.PI / 2 + p * Math.PI * 2,
      mix(SIDE[side].light, C.yellow, p * p),
      12,
    )
  }

  // The kicker on turn, lunging through the ball as it goes.
  if (s.endAt < 0 || s.phase === 'beat') {
    const side = s.turn
    const spot =
      s.phase === 'beat' && s.last ? s.spots[side][Math.max(0, s.kicks[side] - 1)] : spotOf(s, side)
    if (spot) {
      const ka = now - s.kickAt
      const lunge = kicking && ka < 0.3 ? Math.sin((ka / 0.3) * Math.PI) : 0
      const good = s.last?.side === side && s.last.outcome === 'good'
      const w = s.endAt >= 0 ? result(s) : null
      const mood =
        w !== null
          ? w === side
            ? 'grin'
            : 'sad'
          : s.phase === 'beat' && s.last?.side === side
            ? good
              ? 'grin'
              : 'sad'
            : look.aim && look.aim.power > 0.85
              ? 'wow'
              : 'happy'
      drawKicker(g, side, spot, lunge, mood)
      // Distance from the posts, for the kicker.
      if (s.phase === 'aim') {
        const f = forwardY(side)
        g.sideText(side, `${Math.round(spot.d / 20)} yd`, spot.x + 110, spot.y - f * 20, {
          size: 36,
          weight: 700,
          color: C.white,
          stroke: alpha(C.ink, 0.85),
        })
      }
    }
  }

  if (k && !crossed(0) && !crossed(1)) drawFlying(g, k, now)

  windSock(g, s.wind, WIND_MAX, W - 120, MID)

  const suddenAge = now - s.suddenAt
  if (suddenAge < 2.4 && s.endAt < 0) {
    const kk = outBack(clamp01(suddenAge / 0.35))
    g.alpha(Math.min(1, (2.4 - suddenAge) * 2.5), () =>
      g.at(
        W / 2,
        MID,
        0,
        () => {
          g.ctx.translate(-W / 2, -MID)
          banner(g, undefined, 'Sudden death!', MID, { size: 52, color: C.yellow, gap: 120 })
        },
        kk,
      ),
    )
  }
  if (look.hint && own) {
    const side = s.turn
    banner(g, side, 'Swipe up to kick', side === 0 ? MID + 420 : MID - 420, {
      size: 40,
      alpha: 0.75 + 0.25 * Math.sin(now * 4),
    })
  }
  if (s.endAt >= 0) {
    const w = result(s)
    tally(g, s.points, w ?? 'draw', now - s.endAt - 0.9, 'Field goals')
  }
}

/** HUD: points big at the edge; each kick as a pip (filled = good, crossed = missed). */
export function hud(g: Draw, s: State, pulse: [number, number] = [0, 0]): void {
  // A longer match shrinks the row so it still fits the edge (full size up to KICKS).
  const n = s.regular
  const k = Math.min(1, KICKS / n)
  for (const side of [0, 1] as const) {
    bigScore(g, side, s.points[side], { x: 130, size: 64 * (1 + pulse[side] * 0.35) })
    const log = s.log[side]
    const shown = log.length > n ? log.slice(log.length - n) : log
    const y = hudY(g, side)
    g.forSide(side, W - 160, y, () => {
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * 42 * k
        const r = shown[i]
        if (r === undefined) g.circle(x, 0, 14 * k, alpha(C.white, 0.14))
        else if (r) {
          g.circle(x, 0, 15 * k, SIDE[side].main)
          g.circle(x - 4 * k, -4 * k, 5 * k, alpha(C.white, 0.6))
        } else {
          g.circle(x, 0, 14 * k, alpha(C.ink, 0.8))
          g.line(x - 7 * k, -7 * k, x + 7 * k, 7 * k, alpha(C.white, 0.6), 4 * k)
          g.line(x - 7 * k, 7 * k, x + 7 * k, -7 * k, alpha(C.white, 0.6), 4 * k)
        }
      }
    })
  }
}
