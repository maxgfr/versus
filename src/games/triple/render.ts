import { inFrame, textAngle } from '../../core/frame.ts'
import { bigScore, hudY, namePill } from '../../core/hud.ts'
import { other, type Side } from '../../core/game.ts'
import { inCubic, outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { type CardRect, cardGrid, drawCard, flipAmount } from '../../engines/cards/index.ts'
import type { State } from './index.ts'
import { traits } from './rules.ts'

/**
 * Each player gets their own copy of the shared table in their half (red's
 * frame, mirrored for blue), so on one phone both can tap any card at once and
 * every tap belongs to whoever made it. Clear of the pause button and the pills.
 */
export const AREA = { x: 120, y: 946, w: 760, h: 676 }
const GAP = 18
const ASPECT = 1.32

/** Card rectangles (red frame) for `n` table slots: the column count that gives the biggest cards. */
export function tableGrid(n: number): CardRect[] {
  let best: CardRect[] = []
  let size = -1
  for (let cols = 3; cols <= 7; cols++) {
    const rows = Math.max(1, Math.ceil(n / cols))
    const g = cardGrid(cols, rows, AREA, GAP, ASPECT).slice(0, Math.max(n, 0))
    const w = g[0]?.w ?? 0
    if (w > size + 0.5) {
      size = w
      best = g
    }
  }
  return best
}

const COLOURS = [C.green, C.purple, C.orange] as const

/** Outline of a shape centred on (x, y), fitting sw × sh. Every shape is point-symmetric, so cards read the same from both ends. */
function shapePath(
  c: CanvasRenderingContext2D,
  shape: number,
  x: number,
  y: number,
  sw: number,
  sh: number,
): void {
  if (shape === 0) {
    // Pill / oval.
    c.roundRect(x - sw / 2, y - sh / 2, sw, sh, sh / 2)
    return
  }
  if (shape === 1) {
    c.moveTo(x, y - sh / 2)
    c.lineTo(x + sw / 2, y)
    c.lineTo(x, y + sh / 2)
    c.lineTo(x - sw / 2, y)
    c.closePath()
    return
  }
  // Squiggle: a sine band, tangents and normals sampled so the outline is point-symmetric.
  const n = 18
  const A = sw / 2 - sh * 0.15
  const B = sh * 0.26
  const th = sh * 0.3
  const left: [number, number][] = []
  const right: [number, number][] = []
  for (let k = 0; k <= n; k++) {
    const u = -1 + (2 * k) / n
    const cx = A * u
    const cy = B * Math.sin(Math.PI * u)
    const dx = A
    const dy = B * Math.PI * Math.cos(Math.PI * u)
    const len = Math.hypot(dx, dy) || 1
    const taper = 0.55 + 0.45 * Math.cos((u * Math.PI) / 2)
    const nx = (-dy / len) * th * taper
    const ny = (dx / len) * th * taper
    left.push([x + cx + nx, y + cy + ny])
    right.push([x + cx - nx, y + cy - ny])
  }
  right.reverse()
  const all = [...left, ...right]
  c.moveTo(all[0]?.[0] ?? x, all[0]?.[1] ?? y)
  for (const [px, py] of all.slice(1)) c.lineTo(px, py)
  c.closePath()
}

/** One symbol: solid, striped or empty (outline) in its colour, with a toy gloss. */
function drawSymbol(
  g: Draw,
  shape: number,
  colour: number,
  fill: number,
  x: number,
  y: number,
  sw: number,
  sh: number,
): void {
  const col = COLOURS[colour] ?? C.green
  const dark = shade(col, -0.3)
  const lw = Math.max(5, sh * 0.13)
  const path = (c: CanvasRenderingContext2D) => shapePath(c, shape, x, y, sw, sh)
  if (fill === 0) {
    g.path(
      path,
      g.lin(x, y - sh / 2, x, y + sh / 2, [
        [0, shade(col, 0.2)],
        [1, shade(col, -0.12)],
      ]),
      dark,
      lw * 0.55,
    )
    const c = g.ctx
    c.save()
    path(c)
    c.clip()
    g.alpha(0.4, () => g.ellipse(x - sw * 0.12, y - sh * 0.26, sw * 0.26, sh * 0.12, '#ffffff'))
    c.restore()
  } else if (fill === 2) {
    g.path(path, alpha(col, 0.08), col, lw)
  } else {
    g.path(path, alpha(col, 0.12))
    const c = g.ctx
    c.save()
    path(c)
    c.clip()
    c.strokeStyle = col
    c.lineWidth = lw * 0.55
    for (let xx = x - sw / 2; xx <= x + sw / 2; xx += lw * 1.35) {
      c.beginPath()
      c.moveTo(xx, y - sh / 2)
      c.lineTo(xx, y + sh / 2)
      c.stroke()
    }
    c.restore()
    g.path(path, undefined, col, lw * 0.85)
  }
}

/** The card face: one to three symbols stacked on the centre line. */
export function drawPips(g: Draw, id: number, w: number, h: number): void {
  const [count, shape, colour, fill] = traits(id)
  const sw = w * 0.62
  const sh = h * 0.2
  const d = h * 0.26
  for (let k = 0; k <= count; k++) {
    drawSymbol(g, shape, colour, fill, 0, (k - count / 2) * d, sw, sh)
  }
}

const has = (a: readonly number[], v: number): boolean => a.includes(v)

/** One half's copy of the table, seen by `f`. */
function renderHalf(g: Draw, s: State, now: number, f: Side): void {
  const grid = tableGrid(s.table.length)
  const o = other(f)
  const locked = s.lockUntil[f] - now
  inFrame(g, f, () => {
    // The felt mat the cards sit on.
    const pad = 22
    const top = Math.min(...grid.map((c) => c.y - c.h / 2)) - pad
    const bottom = Math.max(...grid.map((c) => c.y + c.h / 2)) + pad + 8
    const mat = shade(SIDE[f].main, -0.7)
    g.rrect(AREA.x - pad, top + 10, AREA.w + pad * 2, bottom - top, 40, shade(SIDE[f].main, -0.82))
    g.rrect(
      AREA.x - pad,
      top,
      AREA.w + pad * 2,
      bottom - top,
      40,
      g.lin(0, top, 0, bottom, [
        [0, shade(mat, 0.06)],
        [1, shade(mat, -0.1)],
      ]),
    )
    g.rrect(
      AREA.x - pad + 8,
      top + 8,
      AREA.w + pad * 2 - 16,
      bottom - top - 16,
      34,
      undefined,
      alpha(SIDE[f].light, 0.12),
      3,
    )

    const bad = s.bad
    const took = s.took
    s.table.forEach((id, i) => {
      const c = grid[i]
      if (c === undefined) return
      const placed = s.placedAt[i] ?? 0
      if (id === null || now < placed) {
        // Empty slot waiting for a card.
        g.rrect(
          c.x - c.w / 2,
          c.y - c.h / 2,
          c.w,
          c.h,
          c.w * 0.13,
          alpha('#000000', 0.18),
          alpha(C.white, 0.1),
          3,
        )
        return
      }
      const mine = has(s.sel[f], i)
      const theirs = has(s.sel[o], i)
      let x = c.x
      let ring: string | undefined
      if (mine) ring = SIDE[f].main
      else if (theirs) ring = alpha(SIDE[o].main, 0.65)
      if (bad && has(bad.slots, i) && now - bad.at < 0.55) {
        const p = prog(now - bad.at, 0, 0.55)
        x += Math.sin(p * Math.PI * 9) * 16 * (1 - p)
        ring = C.red
      }
      const flip = flipAmount(now, placed, true, 0.35)
      const pop = 1 + 0.08 * Math.sin(Math.PI * prog(now - placed, 0.2, 0.5))
      g.at(
        x,
        c.y,
        0,
        () =>
          drawCard(g, 0, 0, c.w, c.h, {
            flip,
            face: (w, h) => drawPips(g, id, w, h),
            faceColor: C.cream,
            backColor: shade(SIDE[f].main, -0.3),
            ...(ring ? { ring } : {}),
            lift: mine ? 0.45 : 0,
          }),
        pop,
      )
      // Who picked it: red's circle top-left, blue's square top-right (never colour alone).
      const lift = mine ? c.h * 0.054 : 0
      if (has(s.sel[0], i))
        g.sideMark(0, x - c.w / 2 + 22, c.y - c.h / 2 + 22 - lift, 13, SIDE[0].main)
      if (has(s.sel[1], i))
        g.sideMark(1, x + c.w / 2 - 22, c.y - c.h / 2 + 22 - lift, 13, SIDE[1].main)
    })

    // A triple just taken: its cards fly to the scorer (off your edge if it was you, over the midline if not).
    if (took) {
      const old = tableGrid(took.n)
      const p = prog(now - took.at, 0.12, 0.7)
      if (p < 1) {
        took.slots.forEach((slot, k) => {
          const c = old[slot]
          const id = took.ids[k]
          if (!c || id === undefined) return
          const e = took.side === f ? inCubic(p) : outCubic(p)
          const tx = 500 + (k - 1) * 90
          const ty = took.side === f ? 1980 : MID - 120
          const lift = Math.sin(Math.min(1, p * 2) * Math.PI) * 30
          const sc = 1 + 0.15 * Math.sin(Math.min(1, p * 3) * Math.PI) - 0.45 * e
          g.alpha(took.side === f ? 1 : 1 - e, () =>
            g.at(
              c.x + (tx - c.x) * e,
              c.y + (ty - c.y) * e - lift,
              (k - 1) * 0.5 * e,
              () =>
                drawCard(g, 0, 0, c.w, c.h, {
                  flip: 1,
                  face: (w, h) => drawPips(g, id, w, h),
                  faceColor: shade(SIDE[took.side].main, 0.7),
                  ring: SIDE[took.side].main,
                }),
              sc,
            ),
          )
        })
      }
    }

    // Locked out after a wrong triple: the mat dims and a countdown ring runs down.
    if (locked > 0) {
      const ta = textAngle(g, f)
      const k = locked / 2
      g.rrect(AREA.x - pad, top, AREA.w + pad * 2, bottom - top, 40, alpha(C.ink, 0.45))
      const cy = (top + bottom) / 2
      g.at(500, cy, ta, () => {
        g.circle(0, 0, 84, alpha(C.ink, 0.9))
        g.arc(0, 0, 70, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k, C.red, 14)
        g.text(Math.ceil(locked), 0, 4, { size: 72, weight: 700, color: C.white })
        g.text('Locked', 0, 120, {
          size: 40,
          weight: 700,
          color: C.redLight,
          drop: alpha('#000', 0.5),
        })
      })
    }
  })
}

/** The ending: the winner's mat lights up with the final count. */
function renderEnd(g: Draw, s: State, now: number): void {
  if (s.endAt < 0) return
  const t = now - s.endAt
  const w = s.score[0] === s.score[1] ? null : s.score[0] > s.score[1] ? 0 : 1
  for (const f of [0, 1] as Side[]) {
    const k = outBack(prog(t, 0.4, 0.8))
    if (k <= 0) continue
    inFrame(g, f, () => {
      const ta = textAngle(g, f)
      g.alpha(prog(t, 0.3, 0.6) * 0.82, () =>
        g.rrect(AREA.x - 22, AREA.y - 30, AREA.w + 44, AREA.h + 40, 40, C.ink),
      )
      g.at(500, AREA.y + AREA.h / 2, ta, () =>
        g.at(
          0,
          0,
          0,
          () => {
            const win = w === f
            const col = w === null ? C.white : win ? C.yellow : alpha(C.white, 0.75)
            if (win) g.emoji('🏆', 0, -110, 150)
            else g.blob(0, -110, 70, SIDE[f].main, { mood: w === null ? 'happy' : 'sad' })
            g.text(w === null ? 'Draw!' : win ? 'You win!' : 'So close!', 0, 30, {
              size: 76,
              weight: 700,
              color: col,
              drop: alpha('#000', 0.5),
            })
            g.text(`${s.score[f]} triple${Math.abs(s.score[f]) === 1 ? '' : 's'}`, 0, 110, {
              size: 44,
              weight: 600,
              color: SIDE[f].light,
            })
          },
          k,
          k,
        ),
      )
    })
  }
}

export function renderTriple(
  g: Draw,
  s: State,
  now: number,
  names: [string, string],
  label: (side: Side) => string | undefined,
  target: number,
): void {
  g.alpha(0.5, () => g.midline())
  for (const f of [0, 1] as Side[]) renderHalf(g, s, now, f)
  renderEnd(g, s, now)
  for (const side of [0, 1] as Side[]) {
    const locked = s.lockUntil[side] > now
    const text = label(side)
    namePill(g, side, names[side], {
      active: !locked && s.endAt < 0,
      ...(text ? { text } : {}),
    })
    const bump = 1 + 0.35 * Math.sin(Math.PI * prog(now - (s.scoredAt[side] ?? -10), 0, 0.4))
    bigScore(g, side, s.score[side], { size: 76 * bump, x: side === 0 ? 130 : 870 })
    points(g, side, Math.max(0, Math.min(target, s.score[side])), target, side === 0 ? 840 : 160)
  }
}

/**
 * Points as dots, like the shared `pips`, but spaced to fit: a long match (up
 * to 15 points) would run off the edge at the shared spacing. Same look at the
 * default 6 points.
 */
function points(g: Draw, side: Side, n: number, target: number, x: number): void {
  const gap = Math.min(46, 300 / Math.max(1, target - 1))
  const r = Math.min(15, gap / 3.05)
  const k = r / 15
  const y = hudY(g, side, 70)
  g.forSide(side, x, y, () => {
    const x0 = -((target - 1) * gap) / 2
    for (let i = 0; i < target; i++) {
      const on = i < n
      g.circle(x0 + i * gap, 0, r, on ? SIDE[side].main : alpha(C.white, 0.14))
      if (on) g.circle(x0 + i * gap - 4 * k, -4 * k, 5 * k, alpha(C.white, 0.6))
    }
  })
}
