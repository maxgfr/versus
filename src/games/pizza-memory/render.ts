import { inFrame, textAngle } from '../../core/frame.ts'
import { bigScore, namePill } from '../../core/hud.ts'
import type { Side } from '../../core/game.ts'
import { inCubic, outBack, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import type { State } from './index.ts'
import { LEAD, MAX_ORDERS, SHOW, TOPPINGS, watchLength } from './rules.ts'

/** The shared pizza, pizza-centred spots are relative to this. */
export const PIZZA = { x: 500, y: MID, r: 228 }
/** Each player's build strip (red frame) and tray (red frame). */
export const STRIP_Y = 1235
export const SLOT_GAP = 92
export const SLOT_R = 40
export const TILE = 132
export const TRAY_X = [200, 350, 500, 650, 800]
export const TRAY_Y = [1365, 1525]
/** Seconds the toppings take to leave the pizza when the rebuild starts. */
export const HIDE = 0.35

export const slotX = (k: number, len: number): number => 500 + (k - (len - 1) / 2) * SLOT_GAP

/** Tray tile centre for tile index `i` (0..9), red frame. */
export function tileXY(i: number): { x: number; y: number } {
  return { x: TRAY_X[i % 5] ?? 500, y: TRAY_Y[Math.floor(i / 5)] ?? 1365 }
}

/** Tray tile under a red-frame point, or -1. */
export function tileAt(x: number, y: number): number {
  for (let i = 0; i < TOPPINGS.length; i++) {
    const c = tileXY(i)
    if (Math.abs(x - c.x) <= TILE / 2 + 6 && Math.abs(y - c.y) <= TILE / 2 + 6) return i
  }
  return -1
}

/** Deterministic 0..1 noise, so splats look the same on every device. */
function noise(n: number): number {
  const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return v - Math.floor(v)
}

/** A splat of tomato sauce centred on (x, y), in the current transform. */
export function splat(g: Draw, x: number, y: number, r: number, seed: number): void {
  const n = 16
  const pts: number[] = []
  const inner: number[] = []
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2
    const spike = k % 2 === 0 ? 1 : 0.6
    const rr = r * spike * (0.8 + 0.4 * noise(seed * 31 + k))
    pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
    inner.push(x + Math.cos(a) * rr * 0.55, y + Math.sin(a) * rr * 0.55)
  }
  g.poly(pts, '#c92e22', alpha(C.ink, 0.45), 6)
  g.poly(inner, '#e8493a')
  for (let k = 0; k < 5; k++) {
    const a = noise(seed * 7 + k) * Math.PI * 2
    const d = r * (1.05 + 0.4 * noise(seed * 3 + k))
    g.circle(x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.12, '#c92e22')
  }
  g.alpha(0.5, () => g.circle(x - r * 0.25, y - r * 0.3, r * 0.14, '#ffffff'))
}

/** The pizza on its wooden board: bumpy crust, sauce, melted cheese. */
function drawPizza(g: Draw, glow: number): void {
  const { x, y, r } = PIZZA
  // Wooden board.
  g.shadow(x, y + r + 40, r * 1.05, 40, 0.45)
  g.circle(x, y + 14, r + 34, shade(C.wood, -0.45))
  g.circle(
    x,
    y,
    r + 34,
    g.rad(x, y, r * 0.2, r + 34, [
      [0, shade(C.wood, 0.15)],
      [1, shade(C.wood, -0.12)],
    ]),
  )
  for (let k = 0; k < 5; k++) {
    g.alpha(0.18, () => g.arc(x, y, r + 8 + k * 6, 0.3 + k, 1.5 + k, C.woodDark, 3))
  }
  if (glow > 0) {
    g.alpha(glow, () => g.circle(x, y, r + 30, undefined, C.yellow, 10))
  }
  // Crust with bumps.
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * Math.PI * 2
    g.circle(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95, r * 0.09, '#d9954a')
  }
  g.circle(
    x,
    y,
    r,
    g.rad(x, y, r * 0.6, r, [
      [0, '#f7cf8a'],
      [0.8, '#e7a95c'],
      [1, '#c27c34'],
    ]),
  )
  for (let k = 0; k < 14; k++) {
    const a = noise(k + 40) * Math.PI * 2
    g.alpha(0.35, () =>
      g.ellipse(
        x + Math.cos(a) * r * 0.93,
        y + Math.sin(a) * r * 0.93,
        r * 0.05,
        r * 0.025,
        '#9b5a22',
        a,
      ),
    )
  }
  // Sauce.
  g.circle(
    x,
    y,
    r * 0.84,
    g.rad(x, y, 0, r * 0.84, [
      [0, '#e9573f'],
      [1, '#b5301f'],
    ]),
  )
  // Melted cheese: soft blobs, deterministic.
  for (let k = 0; k < 11; k++) {
    const a = noise(k + 1) * Math.PI * 2
    const d = r * 0.62 * Math.sqrt(noise(k + 9))
    const cx = x + Math.cos(a) * d
    const cy = y + Math.sin(a) * d
    const rr = r * (0.09 + 0.06 * noise(k + 20))
    g.alpha(0.85, () => {
      g.circle(cx, cy, rr, '#ffd977')
      g.circle(cx - rr * 0.2, cy - rr * 0.2, rr * 0.55, '#ffe7a3')
    })
  }
  g.alpha(0.28, () => g.ellipse(x - r * 0.3, y - r * 0.45, r * 0.38, r * 0.14, '#ffffff', -0.5))
}

/** One topping on the pizza (pizza-centred spot), dropping in with a squash. */
function drawTopping(
  g: Draw,
  glyph: string,
  x: number,
  y: number,
  a: number,
  t: number,
  out = 0,
): void {
  const drop = prog(t, 0, 0.22)
  const land = prog(t, 0.22, 0.5)
  const fall = (1 - inCubic(drop)) * 120
  const squash = land > 0 && land < 1 ? Math.sin(land * Math.PI) * 0.22 : 0
  const s = (out > 0 ? 1 - inCubic(out) : 1) * (0.7 + 0.3 * drop)
  if (s <= 0.01) return
  g.alpha(Math.min(1, drop * 2), () => {
    g.shadow(x + 6, y + 30, 36 * s * (0.6 + 0.4 * drop), 12 * s, 0.35 * drop)
    g.emoji(glyph, x, y - fall, 108 * s, a, 1 + squash, 1 - squash)
  })
}

/** Order ticket: "Order 3/8", readable from each edge (two copies in local 2P). */
function drawTicket(g: Draw, s: State): void {
  const label = `${s.round + 1}/${MAX_ORDERS}`
  const one = (x: number, y: number, angle: number) =>
    g.at(x, y, angle, () => {
      g.rrect(-74, -64, 148, 128, 18, alpha('#000000', 0.3))
      g.rrect(-70, -70, 140, 128, 18, C.cream)
      for (let k = 0; k < 7; k++) g.circle(-60 + k * 20, 58, 7, C.cream)
      g.text('ORDER', 0, -36, { size: 34, weight: 700, color: shade(C.red, -0.1) })
      g.text(label, 0, 14, { size: 48, weight: 700, color: C.ink })
    })
  if (g.flipTop) {
    one(860, MID + 130, -0.06)
    one(860, MID - 130, Math.PI - 0.06)
  } else one(860, MID, g.orient() - 0.06)
}

/** Each player's strip and tray, drawn in their own frame. */
function drawSide(g: Draw, s: State, side: Side, now: number): void {
  const len = s.order.length
  const mine = s.builder === side && s.phase === 'build' && s.done[side] === null
  const reveal = s.phase === 'after'
  inFrame(g, side, () => {
    const ta = textAngle(g, side)
    // Build strip: one slot per topping in the order. While anyone is still
    // building, filled slots show only a tick, so the rival can't copy them.
    const stripW = len * SLOT_GAP + 24
    g.rrect(500 - stripW / 2, STRIP_Y - 54, stripW, 108, 54, alpha(C.ink, 0.5))
    if (mine)
      g.rrect(
        500 - stripW / 2,
        STRIP_Y - 54,
        stripW,
        108,
        54,
        undefined,
        alpha(C.yellow, 0.5 + 0.3 * Math.sin(g.t * 6)),
        5,
      )
    const built = s.built[side]
    for (let k = 0; k < len; k++) {
      const cx = slotX(k, len)
      const id = built[k]
      const next = mine && k === built.length
      g.circle(
        cx,
        STRIP_Y,
        SLOT_R,
        alpha(C.white, next ? 0.16 : 0.06),
        alpha(C.white, next ? 0.6 : 0.2),
        4,
      )
      if (id === undefined) {
        g.at(cx, STRIP_Y, ta, () =>
          g.text(k + 1, 0, 2, { size: 34, weight: 700, color: alpha(C.white, 0.3) }),
        )
        continue
      }
      const t = now - (s.builtAt[side][k] ?? -10)
      const pop = outBack(prog(t, 0, 0.3))
      if (reveal) {
        g.at(cx, STRIP_Y, ta, () => g.emoji(TOPPINGS[id] ?? '', 0, 0, 70 * pop))
      } else {
        g.disc(cx, STRIP_Y, SLOT_R * 0.86 * pop, SIDE[side].main, 6)
        g.at(cx, STRIP_Y, ta, () =>
          g.path(
            (c) => {
              c.moveTo(-14 * pop, 0)
              c.lineTo(-4 * pop, 11 * pop)
              c.lineTo(15 * pop, -11 * pop)
            },
            undefined,
            C.white,
            8,
          ),
        )
      }
    }
    // Tray: a dark inset with ten raised tiles, one per topping.
    g.rrect(60, 1290, 880, 320, 40, alpha(C.ink, 0.42))
    g.rrect(60, 1290, 880, 320, 40, undefined, alpha(SIDE[side].main, mine ? 0.5 : 0.15), 4)
    const press = s.press[side]
    for (let i = 0; i < TOPPINGS.length; i++) {
      const c = tileXY(i)
      const topping = s.perm[i] ?? 0
      const face = mine ? SIDE[side].main : shade(SIDE[side].main, -0.5)
      const pt = press && press.tile === i ? prog(now - press.at, 0, 0.25) : 1
      const pressed = pt < 1 ? Math.sin(pt * Math.PI) : 0
      g.tile(c.x - TILE / 2, c.y - TILE / 2, TILE, TILE, 28, face, 14, pressed)
      g.alpha(mine ? 1 : 0.55, () =>
        g.at(c.x, c.y - 4 + pressed * 10, ta, () =>
          g.emoji(TOPPINGS[topping] ?? '', 0, 0, 92 * (1 - pressed * 0.1)),
        ),
      )
    }
    // The wrong pick: a splat on the tile, and a "?" on the slot it should have filled.
    const bad = s.failTile[side] ?? -1
    if (bad >= 0) {
      const t = now - s.failAt[side]
      const k = outBack(prog(t, 0, 0.25))
      const c = tileXY(bad)
      g.at(c.x, c.y, 0, () => splat(g, 0, 0, TILE * 0.62, bad + side * 11), k)
      const slot = built.length
      const sc = slotX(slot, len)
      g.circle(sc, STRIP_Y, SLOT_R * 0.9, '#c92e22', alpha(C.ink, 0.6), 4)
      if (reveal) {
        const right = s.order[slot]
        g.alpha(0.7, () =>
          g.at(sc, STRIP_Y, ta, () => g.emoji(TOPPINGS[right ?? 0] ?? '', 0, 0, 60)),
        )
      } else {
        g.at(sc, STRIP_Y, ta, () => g.text('✗', 0, 2, { size: 44, weight: 700, color: C.white }))
      }
    }
  })
}

/** The round's verdict over each tray once both have built. */
function drawVerdicts(g: Draw, s: State, now: number): void {
  if (s.phase !== 'after' || s.endAt >= 0) return
  const t = now - s.phaseAt
  for (const side of [0, 1] as Side[]) {
    const k = outBack(prog(t, 0.15, 0.45))
    if (k <= 0) continue
    const ok = s.done[side] === true
    inFrame(g, side, () => {
      g.at(500, 1450, textAngle(g, side), () =>
        g.at(
          0,
          0,
          ok ? -0.05 : 0.05,
          () => {
            const w = 420
            g.rrect(-w / 2, -60, w, 120, 60, alpha('#000000', 0.35))
            g.rrect(-w / 2, -66, w, 120, 60, ok ? '#25936a' : shade(C.red, -0.15))
            g.rrect(-w / 2 + 8, -60, w - 16, 50, 26, alpha('#ffffff', 0.2))
            g.text(ok ? 'Perfect! +1' : 'Oops!', 0, -4, { size: 60, weight: 700, color: C.white })
          },
          k,
        ),
      )
    })
  }
}

/** The ending: trophy for the winner, a sad blob for the other. */
function drawEnd(g: Draw, s: State, now: number): void {
  if (s.endAt < 0) return
  const t = now - s.endAt
  const w = s.winner === 'draw' ? null : s.winner
  for (const f of [0, 1] as Side[]) {
    const k = outBack(prog(t, 0.6, 1.0))
    if (k <= 0) continue
    inFrame(g, f, () => {
      g.alpha(prog(t, 0.4, 0.7) * 0.82, () => g.rrect(60, 1170, 880, 440, 40, C.ink))
      g.at(500, 1400, textAngle(g, f), () =>
        g.at(
          0,
          0,
          0,
          () => {
            const win = w === f
            if (win) g.emoji('🏆', 0, -70, 150)
            else g.blob(0, -70, 70, SIDE[f].main, { mood: w === null ? 'happy' : 'sad' })
            g.text(w === null ? 'Draw!' : win ? 'Top chef!' : 'Burnt it…', 0, 80, {
              size: 72,
              weight: 700,
              color: win ? C.yellow : C.white,
              drop: alpha('#000', 0.5),
            })
          },
          k,
        ),
      )
    })
  }
}

export function renderPizza(
  g: Draw,
  s: State,
  now: number,
  names: [string, string],
  pill: (side: Side) => { text?: string; active: boolean },
): void {
  const watchT = now - s.phaseAt
  const glow = s.phase === 'watch' ? 0.5 + 0.3 * Math.sin(g.t * 6) : 0
  drawPizza(g, glow)
  if (s.phase === 'watch') {
    for (let i = 0; i < s.order.length; i++) {
      const shownAt = s.phaseAt + LEAD + i * SHOW
      const spot = s.spots[i]
      const id = s.order[i]
      if (now < shownAt || !spot || id === undefined) continue
      drawTopping(g, TOPPINGS[id] ?? '', PIZZA.x + spot.x, PIZZA.y + spot.y, spot.a, now - shownAt)
    }
    // Memory timer: the arc around the board runs down while the order is on show.
    const total = watchLength(s.order.length)
    const left = 1 - prog(watchT, LEAD, total)
    if (watchT > LEAD)
      g.arc(
        PIZZA.x,
        PIZZA.y,
        PIZZA.r + 52,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * left,
        C.yellow,
        10,
      )
    if (watchT < LEAD) {
      const k = outBack(prog(watchT, 0, 0.35))
      g.both(
        'Watch the order!',
        { size: 56 * k, weight: 700, color: C.white, stroke: alpha(C.ink, 0.85), gap: 70 },
        MID,
      )
    }
  } else if (s.phase === 'build') {
    // The toppings lift off as the rebuild starts.
    const out = prog(watchT, 0, HIDE)
    if (out < 1) {
      for (let i = 0; i < s.order.length; i++) {
        const spot = s.spots[i]
        const id = s.order[i]
        if (spot && id !== undefined)
          drawTopping(g, TOPPINGS[id] ?? '', PIZZA.x + spot.x, PIZZA.y + spot.y, spot.a, 1, out)
      }
    }
    // Numbered empty spots fill with ticks as the builder goes (no toppings: nothing to copy).
    const b = s.builder
    const done = s.built[b].length
    for (let i = 0; i < s.order.length; i++) {
      const spot = s.spots[i]
      if (!spot) continue
      const x = PIZZA.x + spot.x
      const y = PIZZA.y + spot.y
      const k = outBack(prog(watchT, HIDE + i * 0.05, HIDE + 0.3 + i * 0.05))
      if (k <= 0) continue
      if (i < done) {
        const pop = outBack(prog(now - (s.builtAt[b][i] ?? -10), 0, 0.3))
        g.disc(x, y, 34 * pop, SIDE[b].main, 6)
        g.at(x, y, g.orient(b), () =>
          g.text('✓', 0, 2, { size: 40 * pop, weight: 700, color: C.white }),
        )
      } else {
        g.circle(x, y, 34 * k, alpha(C.ink, 0.25), alpha(C.white, 0.7), 4)
        g.at(x, y, g.orient(b), () =>
          g.text(i + 1, 0, 2, { size: 36 * k, weight: 700, color: C.white }),
        )
      }
    }
  } else {
    // Reveal: the real order back on the pizza.
    for (let i = 0; i < s.order.length; i++) {
      const spot = s.spots[i]
      const id = s.order[i]
      if (spot && id !== undefined)
        drawTopping(
          g,
          TOPPINGS[id] ?? '',
          PIZZA.x + spot.x,
          PIZZA.y + spot.y,
          spot.a,
          watchT - i * 0.06,
        )
    }
  }
  drawTicket(g, s)
  for (const side of [0, 1] as Side[]) drawSide(g, s, side, now)
  drawVerdicts(g, s, now)
  drawEnd(g, s, now)
  for (const side of [0, 1] as Side[]) {
    const p = pill(side)
    namePill(
      g,
      side,
      names[side],
      p.text ? { active: p.active, text: p.text } : { active: p.active },
    )
    const bump = 1 + 0.35 * Math.sin(Math.PI * prog(now - (s.scoredAt[side] ?? -10), 0, 0.4))
    bigScore(g, side, s.scores[side], { size: 76 * bump, x: side === 0 ? 130 : 870 })
  }
}
