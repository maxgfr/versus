import { other, type Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import { frame, inFrame, textAngle } from '../../core/frame.ts'
import { banner, hudY, namePill, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { COMMIT, D_REST } from './rules.ts'
import type { State } from './index.ts'

/*
 * The table is drawn in red's frame: each player's hand lies on their own side
 * of the midline and their arm runs off their own edge. `inFrame` turns the
 * whole picture for blue, so the two players see the same thing from their side.
 */

const OUT = C.ink
/** Finger x, length, and tilt (radians), little finger last. */
const FINGERS: readonly (readonly [number, number, number])[] = [
  [-56, 84, -0.1],
  [-19, 106, -0.03],
  [19, 100, 0.03],
  [55, 78, 0.1],
]

function field(g: Draw, glow: [number, number]): void {
  const v = g.stage.view
  g.fillView(C.ink)
  g.halves(shade(C.red, -0.76), shade(C.blue, -0.76))
  for (const side of [0, 1] as Side[]) {
    if (glow[side] <= 0) continue
    const y0 = side === 0 ? MID : v.y - 2
    const y1 = side === 0 ? v.y + v.h + 2 : MID
    g.alpha(glow[side] * 0.25, () => g.rect(v.x - 2, y0, v.w + 4, y1 - y0, SIDE[side].main))
  }
  // Floodlight over the middle of the table.
  g.fillView(
    g.rad(W / 2, MID, 40, 820, [
      [0, alpha(C.white, 0.16)],
      [1, alpha(C.white, 0)],
    ]),
  )
  for (let y = Math.floor(v.y / 90) * 90; y < v.y + v.h; y += 90) {
    for (let x = Math.floor(v.x / 90) * 90; x < v.x + v.w; x += 90) {
      g.circle(x + 45, y + 45, 3, alpha(C.white, 0.06))
    }
  }
  // The slap mat: a felt circle across the midline.
  g.ellipse(W / 2, MID + 12, 360, 300, alpha('#000000', 0.3))
  g.ellipse(W / 2, MID, 352, 292, shade(C.ink3, -0.1))
  g.ellipse(W / 2, MID, 336, 276, C.ink2)
  g.path(
    (c) => c.ellipse(W / 2, MID, 300, 240, 0, 0, Math.PI * 2),
    undefined,
    alpha(C.white, 0.08),
    6,
  )
  g.dashed(W / 2 - 336, MID, W / 2 + 336, MID, alpha(C.white, 0.25), 6, [24, 18])
  g.vignette(0.42)
}

/** The fingers, thumb and palm as one silhouette path list, drawn in two passes so outlines never cut fills. */
function handShape(g: Draw, fill: (k: number) => string, lw: number): void {
  const pill = (x: number, y: number, w: number, h: number, r: number, c: string, a = 0) =>
    g.at(x, y, a, () => g.rrect(-w / 2 - lw, -h / 2 - lw, w + lw * 2, h + lw * 2, r + lw, c))
  for (const [x, len, a] of FINGERS) pill(x + a * 60, -54 - len / 2, 38, len + 24, 19, fill(0))
  pill(84, 6, 42, 104, 21, fill(1), 0.8)
  pill(0, 0, 176, 156, 70, fill(2))
}

/** A cartoon hand seen from above, palm centre at (0, 0), fingers toward -y (the midline). */
function drawHand(g: Draw, col: string, o: { pain: number; red: number; now: number }): void {
  const base = mix(col, '#ff5a6a', o.red * 0.6)
  const lite = shade(base, 0.12)
  // Outline pass, then fills.
  handShape(g, () => OUT, 7)
  handShape(g, (k) => (k === 2 ? base : lite), 0)
  // Shading: light from the fingertips' side.
  g.alpha(0.35, () =>
    g.ellipse(
      0,
      26,
      80,
      54,
      g.rad(0, 40, 0, 90, [
        [0, alpha(shade(base, -0.5), 0)],
        [1, alpha(shade(base, -0.5), 0.6)],
      ]),
    ),
  )
  // Nails and knuckles.
  for (const [x, len, a] of FINGERS) {
    const tx = x + a * 60 + a * 30
    g.rrect(tx - 11, -54 - len + 2, 22, 24, 10, alpha('#ffffff', 0.45))
    g.arc(x, -62, 12, Math.PI * 1.15, Math.PI * 1.85, alpha(shade(base, -0.45), 0.8), 4)
  }
  g.ellipse(-44, -14, 20, 42, alpha('#ffffff', 0.28), 0.25)
  g.arc(70, 34, 30, -1.2, 0.2, alpha(shade(base, -0.45), 0.6), 4)
  if (o.pain > 0) {
    for (let i = 0; i < 4; i++) {
      const a = o.now * 8 + i * (Math.PI / 2)
      g.alpha(o.pain, () =>
        g.star(Math.cos(a) * 120, -40 + Math.sin(a) * 34, 22, C.yellow, 5, 0.45, a),
      )
    }
  }
}

/** One player's hand and arm. `dist` is the palm's distance from the midline, own side positive. */
function hand(
  g: Draw,
  side: Side,
  dist: number,
  o: {
    lift: number
    /** Spring value around 1: below flattens the palm (impact), above stretches it (lift / strike). */
    squash: number
    /** 0..1 speed of the palm: streaks behind a flying slap. */
    blur: number
    flash: number
    red: number
    pain: number
    tremble: number
    wave: number
    now: number
  },
): void {
  const col = mix(SIDE[side].main, '#ffffff', o.flash * 0.7)
  const sleeve = SIDE[side].dark
  inFrame(g, side, () => {
    const x = W / 2 + Math.sin(o.now * 60) * o.tremble * 4
    const y = MID + dist
    const reach = H + 200 - y
    // Idle life: a slow breath, out of step between the two players.
    const breath = 1 + Math.sin(o.now * 2.4 + side * 1.9) * 0.012
    const k = (1.22 + o.lift * 0.14) * breath
    const sq = Math.max(0.7, Math.min(1.3, o.squash))
    // Speed streaks on the arm's side of the palm, trailing back to the player.
    if (o.blur > 0.25)
      for (let i = 0; i < 4; i++) {
        const lx = x + (i - 1.5) * 64
        const len = 90 + o.blur * 220 - Math.abs(i - 1.5) * 40
        g.line(lx, y + 120, lx, y + 120 + len, alpha(C.white, (o.blur - 0.25) * 0.5), 8)
      }
    // Contact shadow: drifts away and fades as the hand lifts.
    g.ellipse(
      x + 14 + o.lift * 40,
      y + 30 + o.lift * 50,
      92 * k,
      86 * k,
      alpha('#000000', 0.42 - o.lift * 0.2),
    )
    g.at(
      x,
      y,
      o.wave,
      () => {
        // Sleeve to the player's edge, with a cuff.
        g.rrect(-70, 80, 140, reach, 40, OUT)
        g.rrect(
          -62,
          86,
          124,
          reach,
          34,
          g.lin(-62, 0, 62, 0, [
            [0, shade(sleeve, -0.25)],
            [0.4, shade(sleeve, 0.12)],
            [1, shade(sleeve, -0.35)],
          ]),
        )
        g.rrect(-76, 70, 152, 62, 24, OUT)
        g.rrect(-69, 76, 138, 50, 20, C.white)
        g.rect(-69, 94, 138, 14, SIDE[side].main)
        drawHand(g, col, { pain: o.pain, red: o.red, now: o.now })
      },
      k * (1 + (1 - sq) * 0.6),
      k * sq,
    )
  })
}

/** Rings on the spot the slap will land, closing in as the wind-up runs. */
function target(g: Draw, side: Side, dist: number, now: number, t: number): void {
  const p = frame(side, W / 2, MID + dist - 30)
  const k = Math.min(1, t / COMMIT)
  g.ring(p.x, p.y, 150 - k * 40, alpha(C.yellow, 0.3 + k * 0.6), 10)
  g.ring(p.x, p.y, 124 - k * 24 + Math.sin(now * 14) * 5, alpha(C.white, 0.15 + k * 0.3), 6)
}

/** A comic "POW" star at the impact point. */
function pow(g: Draw, x: number, y: number, k: number, force: number): void {
  if (k <= 0) return
  const s = outBack(Math.min(1, (1 - k) * 4)) * (0.8 + k * 0.4) * (0.8 + force * 0.4)
  g.at(
    x,
    y,
    0.2,
    () => {
      g.star(0, 0, 170, alpha(C.ink, 0.9), 12, 0.6)
      g.star(0, 0, 150, C.yellow, 12, 0.6)
      g.star(0, 0, 90, '#fff3c4', 12, 0.62)
    },
    s,
  )
}

/** A role chip beside the arm: who slaps, who dodges. */
function roleChip(g: Draw, side: Side, att: boolean, now: number, swapAge: number): void {
  inFrame(g, side, () => {
    const pop = swapAge < 0.6 ? outBack(prog(swapAge, 0, 0.4)) : 1
    if (pop <= 0) return
    const text = att ? 'ATTACK' : 'DEFEND'
    g.at(
      W / 2 + 270,
      MID + 300,
      textAngle(g, side),
      () => {
        const w = g.measure(text, 40, 700) + 90
        const bob = att ? Math.sin(now * 5) * 3 : 0
        g.rrect(-w / 2, -36 + bob, w, 72, 36, alpha(C.ink, 0.9))
        g.rrect(
          -w / 2 + 6,
          -30 + bob,
          w - 12,
          60,
          30,
          att ? C.yellow : shade(SIDE[side].main, -0.4),
        )
        // Drawn icons in the chip's own ink, not emoji: a red emoji shield on a
        // blue chip (or a yellow hand on the yellow chip) clashed and vanished.
        const ix = -w / 2 + 40
        const iy = bob
        if (att) {
          g.rrect(ix - 13, iy - 6, 26, 24, 9, C.ink)
          for (let i = 0; i < 4; i++) g.rrect(ix - 13 + i * 7, iy - 22, 6, 20, 3, C.ink)
          g.at(ix - 12, iy + 4, -0.7, () => g.rrect(-4, -14, 8, 18, 4, C.ink))
        } else {
          g.poly(
            [ix - 15, iy - 18, ix + 15, iy - 18, ix + 15, iy - 2, ix, iy + 20, ix - 15, iy - 2],
            C.white,
          )
          g.poly(
            [ix - 9, iy - 12, ix + 9, iy - 12, ix + 9, iy - 3, ix, iy + 10, ix - 9, iy - 3],
            SIDE[side].main,
          )
        }
        g.text(text, 22, 3 + bob, { size: 40, weight: 700, color: att ? C.ink : C.white })
      },
      pop,
    )
  })
}

/** How-to lines beside the arm, upright for their reader. */
function prompt(g: Draw, side: Side, lines: readonly string[], a: number): void {
  if (a <= 0) return
  inFrame(g, side, () =>
    g.alpha(a, () => {
      const x = W / 2 - 280
      const y = MID + 290
      lines.forEach((line, i) =>
        g.text(line, x, y + (i === 0 ? 0 : 62 + (i - 1) * 52), {
          size: i === 0 ? 44 : 36,
          weight: i === 0 ? 700 : 600,
          color: i === 0 ? C.white : alpha(C.white, 0.75),
          stroke: alpha(C.ink, 0.9),
          strokeWidth: i === 0 ? 10 : 9,
          angle: textAngle(g, side),
        }),
      )
    }),
  )
}

const ATT_HELP = ['Hold to slap', 'Flick = faster!', 'Quick tap = fake'] as const
const DEF_HELP = ['Tap to dodge', 'only a real slap!'] as const

export function renderSlap(
  g: Draw,
  s: State,
  now: number,
  o: {
    names: [string, string]
    over: boolean
    bots: [boolean, boolean]
    /** Interpolated palm distances for this frame. */
    hand: [number, number]
    /** Squash springs (rest 1) and score pulses (0..1) per side. */
    squash: [number, number]
    pulse: [number, number]
    /** 0..1 palm speed per side. */
    blur: [number, number]
  },
): void {
  const d = s.duel
  const def: Side = other(d.att)
  const m = s.mark
  const age = now - m.at
  const glow: [number, number] = [0, 0]
  if (s.winner !== null) glow[s.winner] = 0.5 + 0.5 * Math.sin(now * 8)
  else if ((m.kind === 'connect' || m.kind === 'flinch') && age < 0.8) glow[m.by] = 1 - age / 0.8
  field(g, glow)

  const hurt = m.kind === 'connect' && age < 0.9 ? other(m.by) : null
  const impact = m.kind === 'connect' ? Math.max(0, 1 - age / 0.3) : 0
  const flinch = m.kind === 'flinch' && age < 0.7 ? 1 - age / 0.7 : 0

  if (d.phase === 'wind') target(g, def, o.hand[def], now, d.t)

  // The defender first, the attacker over them: the slap lands on top.
  for (const side of [def, d.att]) {
    const isAtt = side === d.att
    const lift = isAtt ? (d.phase === 'wind' ? 1 : d.phase === 'fake' ? 0.6 : 0) : flinch * 0.5
    const isHurt = hurt === side
    const won = s.winner === side
    hand(g, side, o.hand[side], {
      lift: s.winner !== null ? (won ? 0.5 + 0.5 * Math.sin(now * 6) : 0) : lift,
      squash: o.squash[side],
      blur: isAtt ? o.blur[side] : 0,
      flash: isHurt ? Math.max(0, impact - 0.1) * 1.4 : 0,
      red: isHurt ? Math.max(0, 1 - age / 0.9) : s.winner !== null && !won ? 0.6 : 0,
      pain: isHurt ? 1 - prog(age, 0.5, 0.9) : 0,
      // The attacker shakes with intent; the defender with nerves.
      tremble: d.phase === 'wind' ? (isAtt ? 1 : 0.35) : 0,
      wave: won ? Math.sin(now * 9) * 0.18 : 0,
      now,
    })
  }
  if (impact > 0) {
    const p = frame(other(m.by), W / 2, MID + D_REST - 60)
    pow(g, p.x, p.y, impact, m.k)
  }

  const ready = d.phase === 'rest' && d.cool <= 0 && !o.over
  const swapAge = m.kind === 'swap' ? age : 99
  for (const side of [0, 1] as Side[]) {
    if (!o.over) roleChip(g, side, side === d.att, now, swapAge)
    const isAtt = side === d.att
    const a = d.phase === 'rest' || d.phase === 'wind' ? 1 : 0.5
    if (!o.over && !o.bots[side])
      prompt(
        g,
        side,
        isAtt ? ATT_HELP : DEF_HELP,
        isAtt ? (ready || d.phase === 'wind' ? 1 : 0.55) : a * 0.8,
      )
  }

  if (m.kind === 'swap' && age < 1.1 && !o.over) {
    const a = 1 - prog(age, 0.8, 1.1)
    for (const side of [0, 1] as Side[]) {
      // Only the halves somebody reads (a demo with two bots keeps both).
      if (o.bots[side] && !o.bots[other(side)]) continue
      const p = frame(side, W / 2, MID + 520)
      banner(g, side, side === d.att ? 'Your turn to slap!' : 'Roles swap!', p.y, {
        size: 50,
        alpha: a * outCubic(prog(age, 0, 0.2)),
        color: side === d.att ? C.yellow : C.white,
      })
    }
  }

  for (const side of [0, 1] as Side[]) {
    const active = d.att === side && (d.phase === 'wind' || ready)
    namePill(g, side, o.names[side], { active, x: side === 0 ? 360 : W - 360 })
    // The pips pop when a point lands.
    const px = side === 0 ? W - 190 : 190
    const py = hudY(g, side)
    g.at(
      px,
      py,
      0,
      () => g.at(-px, -py, 0, () => pips(g, side, d.points[side], s.target, { x: px })),
      1 + o.pulse[side] * 0.35,
    )
  }
}
