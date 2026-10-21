import { frame, inFrame, textAngle } from '../../core/frame.ts'
import type { Side } from '../../core/game.ts'
import { clamp, outBack } from '../../core/fx/ease.ts'
import { banner, clock, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, SIDE, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { BASKET_HALF, BASKET_Y, COMET, GOLD, type Item, KINDS, type Sky, SPAWN_Y } from './rules.ts'

export interface View {
  names: [string, string]
  sec: number
  over: boolean
  /** Game time the match ended (-1 while playing). */
  endAt: number
}

const GOLD_COL = '#ffc93c'
const STAR_COL = '#fff3b8'
const NIGHT = '#0b0f26'
/** Score figure, in the sky frame. */
const SCORE_X = 150

/** A fixed set of background stars (world units), so the sky is the same on every device. */
const FIELD: readonly [number, number, number][] = Array.from({ length: 70 }, (_, i) => [
  (i * 571) % W,
  (i * 829) % 1800,
  0.6 + ((i * 37) % 10) / 10,
])

export function renderSky(g: Draw, skies: [Sky, Sky], now: number, v: View): void {
  const view = g.stage.view
  g.fillView(NIGHT)
  g.halves(mix(NIGHT, C.red, 0.16), mix(NIGHT, C.blue, 0.2))
  // A band of milky light along the midline, where the stars are born.
  g.fillView(
    g.lin(0, MID - 360, 0, MID + 360, [
      [0, alpha('#9fb4ff', 0)],
      [0.5, alpha('#9fb4ff', 0.16)],
      [1, alpha('#9fb4ff', 0)],
    ]),
  )
  for (const [x, y, s] of FIELD) {
    const tw = 0.3 + 0.7 * Math.abs(Math.sin(now * 1.7 + x * 0.01 + y * 0.003))
    if (s > 1.3) g.star(x, y, 6 * s * tw, alpha(C.white, 0.6 * tw), 4, 0.3)
    else g.circle(x, y, 2.2 * s, alpha(C.white, 0.5 * tw))
  }
  moon(g, now)
  for (const side of [0, 1] as Side[]) inFrame(g, side, () => hills(g, side))
  g.vignette(0.4)
  for (const side of [0, 1] as Side[]) {
    const sky = skies[side]
    inFrame(g, side, () => {
      for (const it of sky.items) item(g, it, now)
      basket(g, side, sky, now)
      if (!v.over && now < 3.5) hint(g, side, sky, now)
    })
  }
  g.rect(view.x, MID - 2, view.w, 4, alpha(C.white, 0.15))
  const lead = skies[0].score === skies[1].score ? -1 : skies[0].score > skies[1].score ? 0 : 1
  for (const side of [0, 1] as Side[]) {
    score(g, side, skies[side], now, v.over && lead === side)
    namePill(g, side, v.names[side], { active: now - skies[side].hitAt < 0.25 })
  }
  if (!v.over) clock(g, v.sec, MID)
  else if (v.endAt >= 0) {
    const t = now - v.endAt
    g.alpha(clamp(t * 5, 0, 1), () =>
      banner(g, undefined, 'Time!', MID, { size: 64 * outBack(clamp(t / 0.35, 0, 1)) + 1 }),
    )
  }
}

/** The moon sits on the midline at the right: it is everyone's. */
function moon(g: Draw, now: number): void {
  const x = 850
  const y = MID
  g.circle(
    x,
    y,
    190,
    g.rad(x, y, 60, 190, [
      [0, alpha('#fff6d8', 0.22)],
      [1, alpha('#fff6d8', 0)],
    ]),
  )
  g.ball(x, y, 76, '#fff1c4', 0.5)
  for (const [dx, dy, r] of [
    [-24, -18, 14],
    [20, 22, 10],
    [28, -26, 7],
  ] as const) {
    g.circle(x + dx, y + dy, r, alpha('#d9c48f', 0.6))
  }
  // A slow sleepy blink.
  const blink = now % 4 < 0.15 ? 0.15 : 1
  g.ellipse(x - 24, y + 4, 7, 9 * blink, alpha('#6b5a32', 0.8))
  g.ellipse(x + 24, y + 4, 7, 9 * blink, alpha('#6b5a32', 0.8))
  g.arc(x, y + 22, 14, 0.3, Math.PI - 0.3, alpha('#6b5a32', 0.8), 4)
}

/** Rolling hills at the player's edge, team tinted. Sky frame. */
function hills(g: Draw, side: Side): void {
  const col = SIDE[side]
  const base = shade(mix(NIGHT, col.main, 0.35), -0.2)
  g.path((c) => {
    c.moveTo(-200, H + 300)
    c.lineTo(-200, 1640)
    c.bezierCurveTo(150, 1560, 300, 1700, 520, 1650)
    c.bezierCurveTo(720, 1600, 860, 1580, 1200, 1660)
    c.lineTo(1200, H + 300)
    c.closePath()
  }, base)
  g.path(
    (c) => {
      c.moveTo(-200, H + 300)
      c.lineTo(-200, 1720)
      c.bezierCurveTo(200, 1690, 420, 1760, 700, 1710)
      c.bezierCurveTo(880, 1680, 1000, 1700, 1200, 1720)
      c.lineTo(1200, H + 300)
      c.closePath()
    },
    shade(base, -0.25),
  )
}

/** A cute glossy star: gradient body, outline, highlight and sleepy eyes. */
function cuteStar(
  g: Draw,
  x: number,
  y: number,
  r: number,
  col: string,
  rot: number,
  eyes: boolean,
): void {
  g.star(x, y + 4, r, shade(col, -0.45), 5, 0.52, rot)
  g.star(
    x,
    y,
    r,
    g.rad(x - r * 0.25, y - r * 0.3, 2, r * 1.1, [
      [0, shade(col, 0.6)],
      [0.6, col],
      [1, shade(col, -0.2)],
    ]),
    5,
    0.52,
    rot,
  )
  g.ellipse(x - r * 0.22, y - r * 0.32, r * 0.18, r * 0.1, alpha('#ffffff', 0.7), -0.6)
  if (eyes) {
    g.circle(x - r * 0.18, y + r * 0.02, r * 0.08, C.ink)
    g.circle(x + r * 0.18, y + r * 0.02, r * 0.08, C.ink)
    g.arc(x, y + r * 0.12, r * 0.1, 0.4, Math.PI - 0.4, C.ink, r * 0.05)
  }
}

function item(g: Draw, it: Item, now: number): void {
  if (it.kind === COMET) {
    // A bright head with a tail streaming back up the sky.
    const tail = 230
    g.poly(
      [it.x - 34, it.y - 6, it.x + 34, it.y - 6, it.x + 4, it.y - tail, it.x - 4, it.y - tail],
      g.lin(0, it.y, 0, it.y - tail, [
        [0, alpha('#bfefff', 0.75)],
        [1, alpha('#46dcf0', 0)],
      ]),
    )
    for (let i = 0; i < 4; i++) {
      const p = (now * 3 + i / 4) % 1
      g.circle(
        it.x + Math.sin(i * 2.3 + now * 9) * 18,
        it.y - 30 - p * 160,
        5 * (1 - p),
        alpha('#ffffff', 1 - p),
      )
    }
    g.circle(
      it.x,
      it.y,
      62,
      g.rad(it.x, it.y, 10, 62, [
        [0, alpha('#bfefff', 0.6)],
        [1, alpha('#46dcf0', 0)],
      ]),
    )
    g.ball(it.x, it.y, 28, '#d8f8ff', 0.9)
    return
  }
  const gold = it.kind === GOLD
  const col = gold ? GOLD_COL : STAR_COL
  const r = gold ? 54 : 42
  const pulse = 0.5 + 0.5 * Math.sin(now * 5 + it.id)
  g.circle(
    it.x,
    it.y,
    r + 30 + pulse * 8,
    g.rad(it.x, it.y, r * 0.3, r + 30 + pulse * 8, [
      [0, alpha(col, gold ? 0.5 : 0.3)],
      [1, alpha(col, 0)],
    ]),
  )
  const wob = Math.sin(it.rot * 0.8) * 0.25
  cuteStar(g, it.x, it.y, r, col, -Math.PI / 2 + wob, !gold)
  if (gold) {
    // Sparkles orbit the golden star; it wears its x3.
    for (let i = 0; i < 4; i++) {
      const a = now * 3 + (i * Math.PI * 2) / 4 + it.id
      g.star(it.x + Math.cos(a) * (r + 26), it.y + Math.sin(a) * (r + 26), 9, '#ffffff', 4, 0.3)
    }
    g.text('x3', it.x, it.y + 6, { size: 34, weight: 700, color: shade(GOLD_COL, -0.55) })
  }
  // A faint trail of glitter above anything falling.
  const fall = clamp((it.y - SPAWN_Y) / 80, 0, 1)
  for (let i = 1; i <= 3; i++) {
    g.circle(it.x, it.y - r - i * 26, (5 - i) * fall, alpha(col, 0.4 / i))
  }
}

function basket(g: Draw, side: Side, sky: Sky, now: number): void {
  const x = sky.basket
  const y = BASKET_Y
  const col = SIDE[side]
  const age = now - sky.hitAt
  const bounce = age < 0.3 ? Math.sin((age / 0.3) * Math.PI) : 0
  const glow = age < 0.5 ? 1 - age / 0.5 : 0
  const gcol = sky.hitKind === GOLD ? GOLD_COL : sky.hitKind === COMET ? '#bfefff' : STAR_COL
  const fill = clamp(sky.score / 60, 0, 1)
  g.shadow(x, y + 96, 100, 18, 0.4)
  if (glow > 0) {
    g.circle(
      x,
      y - 30,
      170,
      g.rad(x, y - 30, 20, 170, [
        [0, alpha(gcol, 0.5 * glow)],
        [1, alpha(gcol, 0)],
      ]),
    )
  }
  g.at(
    x,
    y - 34,
    0,
    () => {
      // The catch so far glows inside the bowl.
      if (fill > 0) {
        g.ellipse(0, -2, BASKET_HALF - 10, 10 + fill * 18, alpha(STAR_COL, 0.6))
        for (let i = 0; i < 2 + Math.round(fill * 5); i++) {
          const sx = ((i * 47) % 150) - 75
          g.star(
            sx,
            -8 - fill * 14 - (i % 2) * 10,
            13,
            i % 3 === 0 ? GOLD_COL : STAR_COL,
            5,
            0.5,
            i,
          )
        }
      }
      g.path(
        (c) => {
          c.moveTo(-BASKET_HALF, 0)
          c.lineTo(BASKET_HALF, 0)
          c.arc(0, 0, BASKET_HALF, 0, Math.PI)
          c.closePath()
        },
        g.lin(-BASKET_HALF, 0, BASKET_HALF, 0, [
          [0, shade(col.main, -0.3)],
          [0.35, shade(col.main, 0.2)],
          [1, shade(col.main, -0.4)],
        ]),
        shade(col.main, -0.55),
        5,
      )
      g.ellipse(-BASKET_HALF * 0.45, 36, 18, 30, alpha('#ffffff', 0.25), 0.4)
      g.sideMark(side, 0, 44, 16, alpha(C.white, 0.85))
      g.rrect(
        -BASKET_HALF - 10,
        -14,
        (BASKET_HALF + 10) * 2,
        24,
        12,
        '#eef6ff',
        shade('#eef6ff', -0.4),
        3,
      )
      // A glint that rolls around the rim.
      const gx = -BASKET_HALF + ((now * 90) % (BASKET_HALF * 2))
      g.circle(gx, -4, 6, alpha('#ffffff', 0.95))
    },
    1 + 0.12 * bounce,
    1 - 0.14 * bounce,
  )
}

function hint(g: Draw, side: Side, sky: Sky, now: number): void {
  const a = clamp((3.5 - now) * 2, 0, 1)
  const angle = textAngle(g, side)
  const nudge = Math.sin(now * 5) * 16
  g.alpha(a, () => {
    g.at(sky.basket, BASKET_Y - 220, angle, () => {
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

function score(g: Draw, side: Side, sky: Sky, now: number, winner: boolean): void {
  const age = now - sky.hitAt
  const bump = age < 0.3 ? 1 - age / 0.3 : 0
  const big = (KINDS[sky.hitKind]?.points ?? 1) > 1
  const s = 1 + (big ? 0.45 : 0.25) * bump + (winner ? 0.12 * Math.abs(Math.sin(now * 6)) : 0)
  const p = frame(side, SCORE_X, H)
  g.forSide(side, p.x, hudY(g, side), () => {
    if (winner) g.circle(0, 2, 66, alpha(SIDE[side].main, 0.3))
    g.text(sky.score, 0, 4, {
      size: 80 * s,
      weight: 700,
      color: bump > 0 && sky.hitKind === GOLD ? GOLD_COL : SIDE[side].main,
      stroke: alpha(C.ink, 0.6),
      strokeWidth: 12,
    })
  })
}
