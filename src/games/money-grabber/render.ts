import { frame, inFrame, textAngle } from '../../core/frame.ts'
import type { Side } from '../../core/game.ts'
import { clamp, outBack } from '../../core/fx/ease.ts'
import { banner, clock, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, SIDE, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import {
  BAG,
  BASKET_HALF,
  BASKET_Y,
  BILL,
  BOMB,
  COIN,
  type Item,
  KINDS,
  type Lane,
  SPAWN_Y,
} from './rules.ts'

export interface View {
  /** Seconds the frame sits before the last step (smooth motion). */
  back: number
  names: [string, string]
  sec: number
  over: boolean
  /** Game time the match ended (-1 while playing). */
  endAt: number
}

const GOLD = '#ffc83d'
const NOTE = '#3cbf7a'
/** The rail the basket rides on, lane y. */
const RAIL_Y = BASKET_Y + 58
/** Score figure, in the lane frame. */
const SCORE_X = 150

export function renderMoney(g: Draw, lanes: [Lane, Lane], now: number, v: View): void {
  const view = g.stage.view
  g.fillView(C.ink2)
  g.halves(mix(C.ink2, C.red, 0.16), mix(C.ink2, C.blue, 0.18))
  // Gold light spilling from the chute into both halves.
  g.fillView(
    g.lin(0, MID - 520, 0, MID + 520, [
      [0, alpha(GOLD, 0)],
      [0.5, alpha(GOLD, 0.13)],
      [1, alpha(GOLD, 0)],
    ]),
  )
  for (const side of [0, 1] as Side[]) {
    const lane = lanes[side]
    inFrame(g, side, () => {
      backdrop(g, side, now)
      // Between two steps: money a fraction of a step higher, the basket a fraction back.
      const b = v.back
      const items = b > 0 ? lane.items.map((it) => ({ ...it, y: it.y - it.vy * b })) : lane.items
      for (const it of items) marker(g, it)
      for (const it of items) item(g, it, now)
      basket(g, side, b > 0 ? { ...lane, basket: lane.basket - lane.bv * b } : lane, now)
      // Online, each phone coaches only its own player.
      if (!v.over && now < 3.5 && (g.viewer === null || g.viewer === side)) hint(g, side, lane, now)
    })
  }
  // The chute both lanes rain from.
  g.rect(view.x, MID - 26, view.w, 52, '#0d0a16')
  g.rect(view.x, MID - 26, view.w, 6, alpha(GOLD, 0.35))
  g.rect(view.x, MID + 20, view.w, 6, alpha(GOLD, 0.35))
  for (let x = 40; x < W; x += 80)
    g.circle(x, MID, 6, alpha(GOLD, 0.25 + 0.2 * Math.sin(now * 4 + x)))
  g.vignette(0.45)
  const lead = lanes[0].score === lanes[1].score ? -1 : lanes[0].score > lanes[1].score ? 0 : 1
  for (const side of [0, 1] as Side[]) {
    score(g, side, lanes[side], now, v.over && lead === side)
    namePill(g, side, v.names[side], { active: now - lanes[side].hitAt < 0.25 })
  }
  if (!v.over) clock(g, v.sec, MID)
  else if (v.endAt >= 0) {
    const t = now - v.endAt
    g.alpha(clamp(t * 5, 0, 1), () =>
      banner(g, undefined, 'Time!', MID, { size: 64 * outBack(clamp(t / 0.35, 0, 1)) + 1 }),
    )
  }
}

/** Light pouring from the chute, falling streaks, a faint $ and the rail. Lane frame. */
function backdrop(g: Draw, side: Side, now: number): void {
  g.text('$', W / 2, MID + 420, { size: 520, weight: 700, color: alpha(SIDE[side].main, 0.06) })
  const top = MID + 30
  const len = H - top
  for (let i = 0; i < 14; i++) {
    const x = 40 + ((i * 197) % 920)
    const y = top + ((((now * (360 + (i % 4) * 60) + i * 137) % len) + len) % len)
    g.line(x, y, x, y + 46, alpha(C.white, 0.06), 3)
  }
  // Rail with sleepers.
  g.rrect(40, RAIL_Y - 10, W - 80, 20, 10, shade(SIDE[side].main, -0.55))
  g.rrect(40, RAIL_Y - 10, W - 80, 8, 4, alpha(SIDE[side].light, 0.35))
  for (let x = 80; x < W - 40; x += 70) g.circle(x, RAIL_Y, 4, alpha('#000000', 0.35))
}

/** Where each drop will land: a shadow on the rail that firms up as it nears. Bombs warn in red. */
function marker(g: Draw, it: Item): void {
  const k = clamp((it.y - SPAWN_Y) / (BASKET_Y - SPAWN_Y), 0, 1)
  const r = (KINDS[it.kind] as (typeof KINDS)[number]).r
  if (it.kind === BOMB) {
    g.ellipse(it.x, RAIL_Y, r * (0.6 + k * 0.6), 10, alpha(C.red, 0.25 + 0.45 * k))
    return
  }
  g.ellipse(it.x, RAIL_Y, r * (0.5 + k * 0.6), 8, alpha('#000000', 0.15 + 0.3 * k))
}

function item(g: Draw, it: Item, now: number): void {
  const k = KINDS[it.kind] as (typeof KINDS)[number]
  if (it.kind === COIN) {
    const face = Math.cos(it.rot * 1.6)
    const squeeze = 0.22 + 0.78 * Math.abs(face)
    g.at(
      it.x,
      it.y,
      0,
      () => {
        g.disc(0, 0, k.r, face > 0 ? GOLD : shade(GOLD, -0.12), k.r * 0.22)
        if (squeeze > 0.5)
          g.text('$', 0, 2, { size: k.r * 1.1, weight: 700, color: shade(GOLD, -0.38) })
      },
      squeeze,
      1,
    )
    return
  }
  if (it.kind === BILL) {
    const flutter = Math.sin(it.rot * 1.3)
    g.at(
      it.x,
      it.y,
      flutter * 0.45,
      () => {
        g.rrect(-54, -26, 108, 60, 10, shade(NOTE, -0.45))
        g.rrect(-54, -30, 108, 60, 10, NOTE)
        g.rrect(-46, -22, 92, 44, 7, undefined, alpha('#e8fff2', 0.6), 3)
        g.circle(0, 0, 17, '#e8fff2')
        g.text('$', 0, 2, { size: 26, weight: 700, color: shade(NOTE, -0.4) })
      },
      1,
      0.75 + 0.25 * Math.abs(Math.cos(it.rot)),
    )
    return
  }
  if (it.kind === BAG) {
    const glow = 0.5 + 0.5 * Math.sin(now * 8)
    g.circle(it.x, it.y, 64 + glow * 6, alpha(GOLD, 0.12 + 0.1 * glow))
    g.emoji('💰', it.x, it.y, 108, Math.sin(it.rot) * 0.25)
    return
  }
  // A bomb: red warning glow.
  const p = 0.5 + 0.5 * Math.sin(now * 14)
  g.circle(
    it.x,
    it.y,
    k.r + 22 + p * 8,
    g.rad(it.x, it.y, 6, k.r + 22 + p * 8, [
      [0, alpha(C.red, 0.4)],
      [1, alpha(C.red, 0)],
    ]),
  )
  g.emoji('💣', it.x, it.y, 104, Math.sin(it.rot) * 0.3)
}

function basket(g: Draw, side: Side, lane: Lane, now: number): void {
  const x = lane.basket
  const y = BASKET_Y
  const col = SIDE[side]
  const stunned = now < lane.stunUntil
  const age = now - lane.hitAt
  const bounce = age < 0.3 && lane.hitKind !== BOMB ? Math.sin((age / 0.3) * Math.PI) : 0
  const shake = stunned ? Math.sin(now * 50) * 6 * clamp(lane.stunUntil - now, 0, 1) : 0
  const body = stunned ? mix(col.main, '#3a3340', 0.6) : col.main
  const heap = clamp(lane.score / 160, 0, 1)
  g.shadow(x, RAIL_Y + 4, 112, 16, 0.4)
  // Wheels on the rail.
  for (const dx of [-62, 62]) g.ball(x + dx + shake, RAIL_Y - 4, 16, '#d6d9e6', 0.6)
  // The bucket leans into its slide and swings back when it stops.
  const lean = Math.max(-0.16, Math.min(0.16, -(lane.bv ?? 0) / 9000))
  g.at(
    x + shake,
    y + 40,
    lean,
    () => {
      // Loot heaped inside, more as the score grows.
      if (heap > 0) {
        g.ellipse(0, -96, 80, 18 + heap * 26, shade(GOLD, -0.25))
        for (let i = 0; i < 3 + Math.round(heap * 6); i++) {
          const cx = ((i * 53) % 140) - 70
          g.ellipse(cx, -100 - heap * 18 - (i % 3) * 8, 20, 8, i % 4 === 0 ? NOTE : GOLD)
        }
      }
      // Bucket body.
      g.poly(
        [-96, -92, 96, -92, 74, 0, -74, 0],
        g.lin(-96, 0, 96, 0, [
          [0, shade(body, -0.25)],
          [0.35, shade(body, 0.15)],
          [1, shade(body, -0.35)],
        ]),
        shade(body, -0.55),
        5,
      )
      for (const by of [-60, -30])
        g.line(-86 + by * -0.1, by, 86 + by * 0.1, by, alpha('#000000', 0.15), 4)
      g.sideMark(side, 0, -44, 18, alpha(C.white, 0.85))
      // Rim.
      g.rrect(
        -BASKET_HALF - 14,
        -110,
        BASKET_HALF * 2 + 28,
        28,
        14,
        '#f2eee6',
        shade('#f2eee6', -0.4),
        4,
      )
      g.rrect(-BASKET_HALF - 4, -106, BASKET_HALF * 2 - 10, 7, 4, alpha('#ffffff', 0.8))
      if (stunned) {
        for (let i = 0; i < 3; i++) {
          g.circle(-50 + i * 50, -40 + (i % 2) * 20, 12, alpha('#141018', 0.5))
        }
      }
    },
    1 + 0.1 * bounce,
    1 - 0.12 * bounce,
  )
  if (stunned) {
    // Stars circle above the basket for the stun's full second.
    for (let i = 0; i < 3; i++) {
      const a = now * 6 + (i * Math.PI * 2) / 3
      g.star(x + Math.cos(a) * 80, y - 130 + Math.sin(a) * 20, 18, C.yellow, 5, 0.5, a)
    }
    g.text('Stunned!', x, y - 200, {
      size: 46,
      weight: 700,
      color: C.white,
      stroke: C.ink,
      strokeWidth: 10,
      angle: textAngle(g, side),
    })
  }
}

function hint(g: Draw, side: Side, lane: Lane, now: number): void {
  const a = clamp((3.5 - now) * 2, 0, 1)
  const angle = textAngle(g, side)
  const nudge = Math.sin(now * 5) * 16
  g.alpha(a, () => {
    g.at(lane.basket, BASKET_Y - 230, angle, () => {
      g.text('DRAG', 0, 0, {
        size: 64,
        weight: 700,
        color: C.white,
        stroke: SIDE[side].dark,
        strokeWidth: 14,
      })
      g.poly([-120 - nudge, 0, -92 - nudge, -20, -92 - nudge, 20], C.white)
      g.poly([120 + nudge, 0, 92 + nudge, -20, 92 + nudge, 20], C.white)
    })
  })
}

function score(g: Draw, side: Side, lane: Lane, now: number, winner: boolean): void {
  const age = now - lane.hitAt
  const bump = age < 0.3 ? 1 - age / 0.3 : 0
  const bad = lane.hitKind === BOMB && age < 0.6
  const s = 1 + 0.3 * bump + (winner ? 0.12 * Math.abs(Math.sin(now * 6)) : 0)
  const shake = bad ? Math.sin(age * 60) * 10 * (1 - age / 0.6) : 0
  const p = frame(side, SCORE_X, H)
  g.forSide(side, p.x, hudY(g, side), () => {
    if (winner) g.circle(0, 2, 76, alpha(SIDE[side].main, 0.3))
    g.text(`$${lane.score}`, shake, 4, {
      size: 72 * s,
      weight: 700,
      color: bad ? C.red : bump > 0 ? GOLD : SIDE[side].main,
      stroke: alpha(C.ink, 0.6),
      strokeWidth: 12,
    })
  })
}
