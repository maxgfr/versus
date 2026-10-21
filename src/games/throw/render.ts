import { outBack } from '../../core/fx/ease.ts'
import type { Side } from '../../core/game.ts'
import { banner, hudY } from '../../core/hud.ts'
import type { Draw, Mood } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { H, W } from '../../core/stage.ts'
import {
  ATHLETE,
  handOf,
  HANDLE,
  idealAngle,
  inSector,
  type Mark,
  METRE,
  predict,
  SECTOR,
  type State,
  THROW_BALLISTICS,
  WIND,
} from './rules.ts'

/** Forward for a side: red throws up the table, blue down. */
const forward = (side: Side): number => (side === 0 ? -Math.PI / 2 : Math.PI / 2)
const CIRCLE = 74
const CAGE = 172
const STEEL = '#9aa3bf'

/** 0..1 that is 1 at `t0` and fades to 0 over `dur`. */
/** Distance in metres to the centimetre, as the board shows it. */
export const fmt = (range: number): string => (range / METRE).toFixed(2)

const since = (t: number, t0: number, dur: number): number => {
  const d = t - t0
  return d < 0 || d > dur ? 0 : 1 - d / dur
}

/** Night stadium turf: mown stripes, floodlight pools on both circles, each end washed in its team colour. */
export function drawField(g: Draw, s: State): void {
  g.fillView(shade(C.grass, -0.62))
  const v = g.stage.view
  for (let y = Math.floor(v.y / 150) * 150; y < v.y + v.h; y += 150) {
    if (Math.abs(Math.round(y / 150)) % 2 === 0)
      g.rect(v.x - 2, y, v.w + 4, 150, alpha('#ffffff', 0.035))
  }
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, alpha(SIDE[1].main, 0.3)],
      [0.3, alpha(SIDE[1].dark, 0)],
      [0.7, alpha(SIDE[0].dark, 0)],
      [1, alpha(SIDE[0].main, 0.3)],
    ]),
  )
  for (const side of [0, 1] as Side[]) {
    const a = ATHLETE[side] as { x: number; y: number }
    g.fillView(
      g.rad(a.x, a.y, 30, 520, [
        [0, alpha('#fff6dc', 0.2)],
        [1, alpha('#fff6dc', 0)],
      ]),
    )
  }
  // The live sector, then the other one barely there.
  drawSector(g, other(s.turn), false)
  drawSector(g, s.turn, true)
  g.vignette(0.4)
}

const other = (s: Side): Side => (s === 0 ? 1 : 0)

/** A side's throwing sector: the wedge, its lines, and the arcs every 10 metres measured from its circle. */
function drawSector(g: Draw, side: Side, live: boolean): void {
  const a = ATHLETE[side] as { x: number; y: number }
  const f = forward(side)
  const a0 = f - SECTOR
  const a1 = f + SECTOR
  const far = 1560
  const pts: number[] = [a.x, a.y]
  for (let i = 0; i <= 12; i++) {
    const t = a0 + ((a1 - a0) * i) / 12
    pts.push(a.x + Math.cos(t) * far, a.y + Math.sin(t) * far)
  }
  if (live) {
    g.poly(pts, alpha('#ffffff', 0.07))
    g.poly(pts, alpha(SIDE[side].light, 0.06))
  }
  const lineA = live ? 0.9 : 0.14
  for (const t of [a0, a1]) {
    g.line(
      a.x + Math.cos(t) * CIRCLE,
      a.y + Math.sin(t) * CIRCLE,
      a.x + Math.cos(t) * far,
      a.y + Math.sin(t) * far,
      alpha(C.white, lineA),
      7,
    )
  }
  for (let k = 1; k <= 5; k++) {
    const r = k * 10 * METRE
    g.arc(a.x, a.y, r, a0, a1, alpha(C.white, live ? 0.42 : 0.08), 5)
    if (!live) continue
    // Labels sit just outside the left-hand line (left as the thrower sees it).
    const la = a0 - 0.07
    g.sideText(side, `${k * 10}`, a.x + Math.cos(la) * r, a.y + Math.sin(la) * r, {
      size: 36,
      weight: 700,
      color: alpha(C.white, 0.55),
    })
  }
}

/** The concrete circle with its white rim and the stop-board at the front. */
function drawCircle(g: Draw, side: Side, live: boolean): void {
  const a = ATHLETE[side] as { x: number; y: number }
  const f = forward(side)
  g.circle(a.x, a.y + 8, CIRCLE + 6, alpha('#000000', 0.35))
  g.circle(
    a.x,
    a.y,
    CIRCLE + 6,
    g.rad(a.x, a.y, 10, CIRCLE + 6, [
      [0, '#cfcadb'],
      [1, '#9c97ad'],
    ]),
  )
  g.ring(a.x, a.y, CIRCLE, live ? C.white : alpha(C.white, 0.6), 7)
  g.arc(a.x, a.y, CIRCLE + 12, f - 0.55, f + 0.55, live ? C.white : alpha(C.white, 0.6), 14)
}

/** The safety cage: two wings of posts and net, open toward the sector. */
function drawCage(g: Draw, side: Side): void {
  const a = ATHLETE[side] as { x: number; y: number }
  const f = forward(side)
  for (const sgn of [-1, 1]) {
    const angs = [0.8, 1.25, 1.7, 2.15, 2.6].map((d) => f + sgn * d)
    for (let i = 0; i < angs.length - 1; i++) {
      const t0 = angs[i] as number
      const t1 = angs[i + 1] as number
      g.arc(a.x, a.y, CAGE, Math.min(t0, t1), Math.max(t0, t1), alpha('#000000', 0.35), 12)
      g.arc(a.x, a.y, CAGE, Math.min(t0, t1), Math.max(t0, t1), alpha(C.white, 0.22), 6)
    }
    for (const t of angs) {
      const x = a.x + Math.cos(t) * CAGE
      const y = a.y + Math.sin(t) * CAGE
      g.circle(x + 3, y + 5, 11, alpha('#000000', 0.4))
      g.circle(x, y, 11, shade(SIDE[side].main, -0.3))
      g.circle(x - 3, y - 3, 4, alpha('#ffffff', 0.5))
    }
  }
}

/** The release window on the handle's circle: yellow while letting go now would land in the sector. */
function drawWindow(g: Draw, s: State, side: Side, now: number): void {
  const a = ATHLETE[side] as { x: number; y: number }
  const c = idealAngle(side)
  const r = HANDLE + 50
  const sp = s.spin?.side === side ? s.spin : null
  const live = s.turn === side && s.phase === 'aim'
  if (!live) return
  const on = sp !== null && inSector(side, sp.theta)
  g.arc(a.x, a.y, r, c - SECTOR, c + SECTOR, alpha('#000000', 0.35), 22)
  g.arc(
    a.x,
    a.y,
    r,
    c - SECTOR,
    c + SECTOR,
    on ? C.yellow : alpha(SIDE[side].light, 0.55 + 0.2 * Math.sin(now * 5)),
    on ? 18 : 12,
  )
  // The sweet spot.
  g.line(
    a.x + Math.cos(c) * (r - 16),
    a.y + Math.sin(c) * (r - 16),
    a.x + Math.cos(c) * (r + 16),
    a.y + Math.sin(c) * (r + 16),
    C.white,
    6,
  )
}

/** How a side's athlete looks right now. */
function moodOf(s: State, side: Side): { mood: Mood; hop: number } {
  if (s.endAt >= 0) {
    const [r, b] = s.best
    if (r === b) return { mood: 'happy', hop: 0 }
    const won = side === 0 ? r > b : b > r
    return won
      ? { mood: 'grin', hop: Math.abs(Math.sin((s.t - s.endAt) * 7)) * 30 }
      : { mood: 'sad', hop: 0 }
  }
  const sp = s.spin?.side === side ? s.spin : null
  if (sp) return { mood: sp.hold >= WIND ? 'grin' : 'wow', hop: 0 }
  const last = [...s.marks].reverse().find((m) => m.side === side)
  if (last && since(s.t, last.at, 1.3) > 0) {
    if (last.foul) return { mood: 'sad', hop: 0 }
    const best = last.range > 0 && last.range === s.best[side]
    return {
      mood: best ? 'grin' : 'happy',
      hop: best ? Math.sin((1 - since(s.t, last.at, 0.5)) * Math.PI) * 26 : 0,
    }
  }
  if (s.turn === side && since(s.t, s.throwAt, 1.2) > 0) return { mood: 'dizzy', hop: 0 }
  return { mood: 'happy', hop: 0 }
}

/** The athlete in the circle, swinging the hammer while the spin is held. */
function drawAthlete(g: Draw, s: State, side: Side, now: number): void {
  const a = ATHLETE[side] as { x: number; y: number }
  const col = SIDE[side]
  const sp = s.spin?.side === side ? s.spin : null
  const { mood, hop } = moodOf(s, side)
  const o = g.orient(side)
  const flip = Math.abs(o) > 1 ? -1 : 1
  const live = s.turn === side && s.phase === 'aim'
  if (sp) {
    const h = handOf(side, sp.theta)
    // Wind-up meter: fills as the hold winds the spin up.
    const wind = Math.min(1, sp.hold / WIND)
    g.arc(a.x, a.y, 96, -Math.PI / 2, Math.PI * 1.5, alpha('#000000', 0.3), 10)
    g.arc(
      a.x,
      a.y,
      96,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * wind,
      wind >= 1 ? alpha(C.white, 0.7 + 0.3 * Math.sin(now * 20)) : col.light,
      10,
    )
    // Motion smear behind the hammer head.
    const sweep = Math.min(1.6, sp.omega * 0.16)
    for (let i = 4; i >= 1; i--) {
      g.alpha(0.08 * (5 - i), () =>
        g.arc(a.x, a.y, HANDLE, sp.theta - (sweep * i) / 4, sp.theta, '#ffffff', 46 - i * 6),
      )
    }
    g.shadow(h.x + 8, h.y + 14, 26, 12, 0.4)
    g.line(a.x, a.y, h.x, h.y, alpha('#000000', 0.3), 9)
    g.line(a.x, a.y, h.x, h.y, '#e8e6f0', 5)
    g.ball(h.x, h.y, 26, STEEL, 0.9)
    g.shadow(a.x + 6, a.y + 34, 58, 20, 0.4)
    g.blob(a.x, a.y, 54, col.main, {
      mood,
      angle: o,
      look: [Math.cos(sp.theta) * flip, Math.sin(sp.theta) * flip],
      sx: 1 + Math.sin(sp.theta * 2) * 0.05,
      sy: 1 - Math.sin(sp.theta * 2) * 0.05,
    })
    return
  }
  // Resting: the hammer lies in front, ready (or spent).
  if (live || s.phase === 'aim') {
    const f = forward(side)
    const rx = a.x + Math.cos(f + 0.6) * (HANDLE * 0.85)
    const ry = a.y + Math.sin(f + 0.6) * (HANDLE * 0.85)
    if (live) {
      g.line(a.x, a.y, rx, ry, '#e8e6f0', 5)
      g.shadow(rx + 6, ry + 12, 24, 10, 0.4)
      g.ball(rx, ry, 24, STEEL, 0.9)
    }
  }
  g.shadow(a.x + 6, a.y + 34, 58 - hop * 0.3, 20, 0.4)
  g.blob(a.x, a.y - hop * flip, 54, col.main, {
    mood,
    angle: o,
    look: [0, -1],
    sy: 1 + Math.sin(now * 3 + side) * 0.025,
  })
}

/**
 * The live readout while the spin is held: how far a perfect release would go
 * at this speed. It grows as the hold winds the spin up, and stays steady
 * (no flicker) while the handle goes round.
 */
function drawReadout(g: Draw, s: State, side: Side): void {
  const sp = s.spin
  if (!sp || sp.side !== side) return
  const p = predict(side, idealAngle(side), sp.omega)
  const a = ATHLETE[side] as { x: number; y: number }
  const f = forward(side)
  const x = a.x + Math.cos(f) * 270
  const y = a.y + Math.sin(f) * 270
  const on = inSector(side, sp.theta)
  g.forSide(side, x, y, () => {
    const text = `${fmt(p.range)} m`
    const w = g.measure(text, 50, 700) + 50
    g.rrect(-w / 2, -40, w, 80, 40, on ? alpha(C.yellow, 0.9) : alpha(C.ink, 0.72))
    g.text(text, 0, 3, { size: 50, weight: 700, color: on ? C.ink : C.white })
  })
}

/** Where a landed throw is: a divot and a flag in the thrower's colour, with its distance. */
function drawMark(g: Draw, s: State, m: Mark, best: boolean): void {
  const a = ATHLETE[m.side] as { x: number; y: number }
  const age = s.t - m.at
  const pop = outBack(Math.min(1, Math.max(0, age) / 0.35))
  const col = SIDE[m.side]
  if (m.foul) {
    g.at(
      m.x,
      m.y,
      0,
      () => {
        g.line(-20, -20, 20, 20, alpha('#000000', 0.4), 14)
        g.line(-20, 20, 20, -20, alpha('#000000', 0.4), 14)
        g.line(-20, -22, 20, 18, col.light, 10)
        g.line(-20, 18, 20, -22, col.light, 10)
      },
      pop,
    )
    return
  }
  // The measuring tape runs out to the mark, and the arc at its distance glows.
  const sweep = since(s.t, m.at, 1.1)
  if (sweep > 0) {
    const f = forward(m.side)
    g.alpha(sweep, () => {
      g.arc(a.x, a.y, m.range, f - SECTOR, f + SECTOR, col.light, 12)
      g.line(a.x, a.y, m.x, m.y, alpha(C.yellow, 0.9), 6)
    })
  }
  // Divot.
  g.ellipse(m.x, m.y + 4, 30, 15, alpha('#000000', 0.35))
  g.ellipse(m.x, m.y, 26, 12, '#5b3d23')
  g.ellipse(m.x - 4, m.y - 3, 14, 6, '#7a5532')
  // Flag pin, standing up toward the light.
  g.at(
    m.x,
    m.y,
    0,
    () => {
      const hgt = best ? 96 : 66
      g.line(4, 0, 22, -10, alpha('#000000', 0.25), 6)
      g.line(0, 0, 0, -hgt, C.white, 6)
      g.poly([0, -hgt, 44, -hgt + 14, 0, -hgt + 28], col.main)
      g.poly([0, -hgt, 44, -hgt + 14, 0, -hgt + 14], alpha('#ffffff', 0.25))
      g.sideMark(m.side, 0, -hgt, 9, best ? C.yellow : C.white)
    },
    pop,
  )
}

/**
 * A mark's distance tag, just in front of the divot (the flag stands behind it),
 * upright for the thrower. Drawn after the cages so a throw landing near the
 * other circle still shows its number. Only the best throw keeps its tag; the
 * others show it briefly, so tags of neighbouring flags never pile up.
 */
function drawTag(g: Draw, s: State, m: Mark, best: boolean): void {
  if (m.foul) return
  const age = s.t - m.at
  const pop = outBack(Math.min(1, Math.max(0, age) / 0.35))
  const col = SIDE[m.side]
  const tagA = best ? pop : pop * Math.min(1, Math.max(0, (2.6 - age) / 0.4))
  if (tagA <= 0) return
  const tx = m.x
  const ty = m.y + 50
  g.alpha(tagA, () => {
    g.forSide(m.side, tx, ty, () => {
      const label = `${fmt(m.range)} m`
      const w = g.measure(label, 36, 700) + 30
      g.rrect(-w / 2, -26, w, 52, 26, best ? col.main : alpha(C.ink, 0.75))
      g.text(label, 0, 2, { size: 36, weight: 700, color: C.white })
    })
  })
}

/** The other side's best, drawn across the live sector: the distance to beat. */
function drawToBeat(g: Draw, s: State, part: 'arc' | 'label'): void {
  if (s.phase === 'beat' || s.endAt >= 0) return
  const side = s.turn
  const rival = other(side)
  const r = s.best[rival]
  if (r <= 0) return
  const a = ATHLETE[side] as { x: number; y: number }
  const f = forward(side)
  if (part === 'arc') {
    g.arc(a.x, a.y, r, f - SECTOR - 0.03, f + SECTOR + 0.03, alpha('#000000', 0.3), 14)
    g.arc(a.x, a.y, r, f - SECTOR - 0.03, f + SECTOR + 0.03, SIDE[rival].light, 8)
    return
  }
  // The label rides over the flags, so a flag landing on it never hides the number.
  g.forSide(side, a.x + Math.cos(f) * (r - 46), a.y + Math.sin(f) * (r - 46), () => {
    const label = `To beat ${fmt(r)}`
    const w = g.measure(label, 34, 700) + 56
    g.rrect(-w / 2, -26, w, 52, 26, shade(SIDE[rival].main, -0.45))
    g.sideMark(rival, -w / 2 + 26, 0, 9, SIDE[rival].light)
    g.text(label, 14, 2, { size: 34, weight: 700, color: C.white })
  })
}

/** The hammer in flight: a trail of where it has been, its shadow on the turf, the ball lifted by its height. */
function drawFlight(g: Draw, s: State): void {
  const f = s.flight
  if (!f) return
  const sh = f.shell
  const gz = THROW_BALLISTICS.g
  for (let i = 6; i >= 1; i--) {
    const tau = i * 0.035
    const z = sh.z - sh.vz * tau - 0.5 * gz * tau * tau
    if (z < 0) continue
    const x = sh.x - sh.vx * tau
    const y = sh.y - sh.vy * tau
    g.alpha(0.28 - i * 0.035, () =>
      g.circle(x - z * 0.12, y - z * 0.18, 20 + z * 0.03, SIDE[f.side].light),
    )
  }
  const k = 1 + Math.max(0, sh.z) / 700
  g.alpha(0.45 / k, () =>
    g.ellipse(sh.x, sh.y, 26 * (1.2 - Math.min(0.5, sh.z / 1200)), 16, '#000'),
  )
  const r = 24 * k
  const bx = sh.x - sh.z * 0.12
  const by = sh.y - sh.z * 0.18
  // The wire trails behind the ball.
  const sp = Math.hypot(sh.vx, sh.vy) || 1
  g.line(bx, by, bx - (sh.vx / sp) * 60 * k, by - (sh.vy / sp) * 60 * k, '#e8e6f0', 4)
  g.ball(bx, by, r, STEEL, 0.9)
}

export function render(g: Draw, s: State, now: number, human: [boolean, boolean]): void {
  drawField(g, s)
  for (const side of [0, 1] as Side[]) drawCircle(g, side, s.turn === side)
  drawToBeat(g, s, 'arc')
  for (const side of [0, 1] as Side[]) drawWindow(g, s, side, now)
  const bests = s.marks.map((m) => !m.foul && m.range > 0 && m.range === s.best[m.side])
  // Far marks first so nearer flags overlap them.
  s.marks.forEach((m, i) => {
    if (!bests[i]) drawMark(g, s, m, false)
  })
  s.marks.forEach((m, i) => {
    if (bests[i]) drawMark(g, s, m, true)
  })
  drawToBeat(g, s, 'label')
  for (const side of [0, 1] as Side[]) {
    drawCage(g, side)
    drawAthlete(g, s, side, now)
  }
  s.marks.forEach((m, i) => drawTag(g, s, m, bests[i] ?? false))
  for (const side of [0, 1] as Side[]) drawReadout(g, s, side)
  drawFlight(g, s)
  drawMedal(g, s)
  if (s.phase === 'aim' && s.spin === null && s.endAt < 0) {
    const side = s.turn
    const y = side === 0 ? 1290 : 510
    const n = s.thrown[side] + 1
    const intro = s.t - s.turnAt < 1.4
    const label =
      intro || !human[side]
        ? n === s.throws
          ? 'Last throw!'
          : `Throw ${n} of ${s.throws}`
        : 'Hold to spin, let go on the yellow'
    banner(g, side, label, y, {
      size: 40,
      alpha: intro ? 1 : 0.75 + 0.25 * Math.sin(now * 4),
    })
  }
}

/** The winner's best flag gets the gold. */
function drawMedal(g: Draw, s: State): void {
  if (s.endAt < 0) return
  const [r, b] = s.best
  if (r === b) return
  const w: Side = r > b ? 0 : 1
  const m = s.marks.find((k) => k.side === w && !k.foul && k.range === s.best[w])
  if (!m) return
  const age = s.t - s.endAt
  const k = outBack(Math.min(1, age / 0.45))
  g.alpha(0.5, () => g.circle(m.x, m.y - 40, 110 * k, alpha(C.yellow, 0.35)))
  g.emoji('🥇', m.x, m.y - 130 - Math.sin(age * 4) * 8, 110 * k, g.orient(w))
}

/** Best throw at the player's corner, and three pips for the throws taken. */
export function drawHud(g: Draw, s: State, side: Side, now: number): void {
  const y = hudY(g, side, 74)
  const col = SIDE[side]
  const best = s.best[side]
  const last = [...s.marks].reverse().find((m) => m.side === side)
  const pop = last && !last.foul && last.range === best ? since(s.t, last.at, 0.35) : 0
  const won = s.endAt >= 0 && best > s.best[other(side)]
  g.forSide(side, side === 0 ? 150 : W - 150, y, () => {
    g.at(
      0,
      0,
      0,
      () => {
        if (won) {
          g.alpha(0.5 + 0.3 * Math.sin(now * 8), () => g.rrect(-118, -58, 236, 116, 38, C.yellow))
        }
        g.tile(-108, -48, 216, 104, 30, shade(col.main, -0.45), 10)
        if (best > 0) {
          g.text(fmt(best), -14, -2, { size: 50, weight: 700, color: C.white })
          g.text('m', 72, 8, { size: 32, weight: 600, color: alpha(C.white, 0.7) })
        } else {
          g.text('Best', 0, 0, { size: 38, weight: 600, color: alpha(C.white, 0.45) })
        }
      },
      1 + pop * 0.3,
    )
  })
  // One pip per throw: filled for a valid throw, a cross for a foul, hollow to come.
  // Long matches shrink the pips so the row stays on the screen.
  const marks = s.marks.filter((m) => m.side === side)
  const gap = Math.min(50, 240 / Math.max(1, s.throws - 1))
  const k = gap / 50
  g.forSide(side, side === 0 ? W - 150 : 150, y, () => {
    for (let i = 0; i < s.throws; i++) {
      const x = (i - (s.throws - 1) / 2) * gap
      const m = marks[i]
      g.circle(x, 0, 18 * k, alpha(C.white, 0.14))
      if (!m) continue
      if (m.foul) {
        g.line(x - 9 * k, -9 * k, x + 9 * k, 9 * k, SIDE[0].light, 6 * k)
        g.line(x - 9 * k, 9 * k, x + 9 * k, -9 * k, SIDE[0].light, 6 * k)
      } else {
        g.circle(x, 0, 16 * k, col.main)
        g.circle(x - 5 * k, -5 * k, 5 * k, alpha('#ffffff', 0.6))
      }
    }
  })
}
