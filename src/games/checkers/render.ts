import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { cellCenter, type Geom } from '../../engines/board/index.ts'
import type { State } from './index.ts'
import { type Cell, colOf, count, HOP, hops, isKing, MAX_PLIES, owner, rowOf } from './rules.ts'

const INK = C.ink
const PAD = 30
const LIP = 24
/** Seconds a taken piece flies to the taker's tray once it has been jumped. */
const FLY = 0.45
const TRAY_W = 780
const TRAY_R = 26
const TRAY_GAP = 56

/**
 * A man in the shape of its side: a round checker for red, a rounded square
 * block for blue (shape says whose it is, not only colour). Grooves on the face
 * and a lit rim make it a chunky toy. Drawn around (0, 0), radius `r`.
 */
function drawMan(g: Draw, side: Side, r: number, color: string): void {
  const depth = r * 0.24
  const dark = shade(color, -0.42)
  if (side === 0) {
    g.circle(0, depth, r, dark, INK, r * 0.06)
    g.circle(
      0,
      0,
      r,
      g.rad(
        0,
        0,
        r * 0.1,
        r,
        [
          [0, shade(color, 0.28)],
          [0.75, color],
          [1, shade(color, -0.12)],
        ],
        -r * 0.35,
        -r * 0.4,
      ),
      INK,
      r * 0.06,
    )
    g.ring(0, 0, r * 0.68, alpha(INK, 0.22), r * 0.08)
    g.ring(0, -r * 0.03, r * 0.68, alpha('#ffffff', 0.25), r * 0.04)
    g.ring(0, 0, r * 0.36, alpha(INK, 0.16), r * 0.06)
    g.alpha(0.6, () => g.ellipse(-r * 0.36, -r * 0.46, r * 0.26, r * 0.13, '#fff', -0.6))
  } else {
    const s = r * 0.92
    const rr = r * 0.34
    g.rrect(-s, -s + depth, s * 2, s * 2, rr, dark, INK, r * 0.06)
    g.rrect(
      -s,
      -s,
      s * 2,
      s * 2,
      rr,
      g.rad(
        0,
        0,
        r * 0.1,
        r * 1.2,
        [
          [0, shade(color, 0.28)],
          [0.75, color],
          [1, shade(color, -0.12)],
        ],
        -r * 0.35,
        -r * 0.4,
      ),
      INK,
      r * 0.06,
    )
    const i = s * 0.66
    g.rrect(-i, -i, i * 2, i * 2, rr * 0.6, undefined, alpha(INK, 0.22), r * 0.08)
    g.rrect(-i, -i - r * 0.03, i * 2, i * 2, rr * 0.6, undefined, alpha('#ffffff', 0.25), r * 0.04)
    g.alpha(0.6, () => g.ellipse(-r * 0.38, -r * 0.5, r * 0.26, r * 0.12, '#fff', -0.2))
  }
}

/**
 * One checker at (x, y). A king is two men stacked, with a crown star that
 * faces its owner. `crown` (0..1) drops the crown in when a man is crowned.
 */
export function drawChecker(
  g: Draw,
  cell: Cell,
  x: number,
  y: number,
  r: number,
  o: { lift?: number; scale?: number; alpha?: number; crown?: number; squash?: number } = {},
): void {
  const side: Side = owner(cell) === 1 ? 1 : 0
  const col = SIDE[side].main
  const sc = o.scale ?? 1
  const lift = o.lift ?? 0
  const sq = o.squash ?? 0
  g.alpha(o.alpha ?? 1, () => {
    g.shadow(
      x,
      y + r * 0.42,
      r * 1.0 * sc * (1 - Math.min(0.5, lift / (r * 3))),
      r * 0.26 * sc,
      0.4,
    )
    g.at(
      x,
      y - lift + r * 0.3 * sq,
      0,
      () => {
        if (!isKing(cell)) {
          drawMan(g, side, r, col)
          return
        }
        g.at(0, r * 0.16, 0, () => drawMan(g, side, r, shade(col, -0.18)))
        g.at(0, -r * 0.16, 0, () => drawMan(g, side, r, col))
        const k = o.crown ?? 1
        if (k <= 0) return
        // The crown faces its owner (upside down for blue in local 2P) and drops in when won.
        g.at(
          0,
          -r * 0.18 - (1 - k) * r * 2.2,
          g.orient(side),
          () => {
            g.star(0, r * 0.07, r * 0.52, alpha(INK, 0.55))
            g.star(0, 0, r * 0.52, C.white)
            g.star(0, 0, r * 0.3, alpha(SIDE[side].light, 0.9))
          },
          Math.min(1.25, 0.4 + k * 0.85),
        )
      },
      sc * (1 + sq * 0.5),
      sc * (1 - sq),
    )
  })
}

/** The board frame: blue owns the top edge, red the bottom; the side to move lights its edge. */
export function renderBoard(g: Draw, geo: Geom, turn: Side, now: number, live: boolean): void {
  const x0 = geo.x - PAD
  const y0 = geo.y - PAD
  const w = geo.w + PAD * 2
  const h = geo.h + PAD * 2
  g.shadow(W / 2, y0 + h + LIP + 14, w * 0.56, 40, 0.45)
  g.rrect(x0, y0 + LIP, w, h, 40, shade(C.ink3, -0.45))
  g.rrect(
    x0,
    y0,
    w,
    h,
    40,
    g.lin(0, y0, 0, y0 + h, [
      [0, shade(SIDE[1].main, -0.55)],
      [0.5, C.ink3],
      [1, shade(SIDE[0].main, -0.55)],
    ]),
  )
  if (live) {
    const pulse = 0.5 + 0.5 * Math.sin(now * 5)
    const ey = turn === 0 ? y0 + h - PAD / 2 : y0 + PAD / 2
    g.alpha(0.55 + 0.35 * pulse, () => g.line(x0 + 60, ey, x0 + w - 60, ey, SIDE[turn].main, 10))
    g.alpha(0.2 * pulse, () => g.line(x0 + 50, ey, x0 + w - 50, ey, SIDE[turn].light, 22))
  }
  const light = g.lin(0, geo.y, 0, geo.y + geo.h, [
    [0, '#f6ecd6'],
    [1, '#e4d3b2'],
  ])
  const dark = g.lin(0, geo.y, 0, geo.y + geo.h, [
    [0, '#5a4c93'],
    [1, '#463a7a'],
  ])
  const u = geo.cell
  g.rrect(geo.x - 6, geo.y - 6, geo.w + 12, geo.h + 12, 12, INK)
  g.clip(geo.x, geo.y, geo.w, geo.h, 8, () => {
    g.rect(geo.x, geo.y, geo.w, geo.h, light)
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if ((c + r) % 2 === 1) g.rect(geo.x + c * u, geo.y + r * u, u, u, dark)
    g.rect(
      geo.x,
      geo.y,
      geo.w,
      geo.h,
      g.rad(W / 2, MID - geo.h * 0.2, 40, geo.w * 0.8, [
        [0, alpha('#ffffff', 0.12)],
        [1, alpha('#000000', 0.12)],
      ]),
    )
  })
}

export function trayY(geo: Geom, side: Side): number {
  const d = geo.h / 2 + PAD + LIP + 150
  return side === 0 ? MID + d : MID - d
}

/** World position of tray slot `i` for `side`, following that player's view. */
export function slotAt(g: Draw, geo: Geom, side: Side, i: number): { x: number; y: number } {
  const a = g.orient(side)
  const lx = -TRAY_W / 2 + 60 + i * TRAY_GAP
  return { x: W / 2 + Math.cos(a) * lx, y: trayY(geo, side) + Math.sin(a) * lx }
}

/** Rival pieces this side has taken, in a tray before them, with the lead in pieces. */
function drawTray(g: Draw, geo: Geom, s: State, side: Side, inFlight: number): void {
  const rival: Side = side === 0 ? 1 : 0
  const took = 12 - count(s.board, rival) - inFlight
  const lead = count(s.board, side) - count(s.board, rival)
  const pieceOf: Cell = rival === 0 ? 1 : 3
  g.forSide(side, W / 2, trayY(geo, side), () => {
    g.rrect(
      -TRAY_W / 2,
      -52,
      TRAY_W,
      104,
      52,
      g.lin(0, -52, 0, 52, [
        [0, alpha('#000000', 0.5)],
        [1, alpha(INK, 0.35)],
      ]),
    )
    g.rrect(-TRAY_W / 2, -52, TRAY_W, 104, 52, undefined, alpha(SIDE[side].main, 0.3), 4)
    if (took <= 0 && inFlight === 0)
      g.text('Captures', 0, 2, { size: 36, weight: 600, color: alpha(C.white, 0.36) })
    for (let i = 0; i < took; i++)
      drawChecker(g, pieceOf, -TRAY_W / 2 + 60 + i * TRAY_GAP, -6, TRAY_R)
    if (lead > 0) {
      const lw = g.measure(`+${lead}`, 44, 700) + 40
      g.rrect(TRAY_W / 2 - lw - 14, -34, lw, 68, 34, SIDE[side].main)
      g.text(`+${lead}`, TRAY_W / 2 - 14 - lw / 2, 2, { size: 44, weight: 700, color: C.white })
    }
    const left = MAX_PLIES - s.ply
    if (left <= 20 && left > 0 && s.endedAt < 0) {
      g.text(`${left} moves to the limit`, 0, 92, {
        size: 34,
        weight: 600,
        color: left <= 6 ? C.yellow : alpha(C.white, 0.6),
      })
    }
  })
}

export interface Route {
  /** The rest of a legal route from the current prefix: next landings, to the end. */
  path: number[]
  /** Squares of the pieces it takes along the way. */
  jumps: number[]
}

/** Seconds the last move takes to play out (one hop per landing), plus a beat. */
export function moveTime(last: State['last']): number {
  return last ? (last.path.length - 1) * HOP + 0.15 : 0
}

/** The whole table: board, routes, pieces in motion, captures, crowning and the trays. */
export function renderCheckers(
  g: Draw,
  s: State,
  geo: Geom,
  now: number,
  routes: readonly Route[],
  forced: readonly number[],
  over: boolean,
  showSel = true,
): void {
  const live = !over && s.endedAt < 0
  // Online, the selection and its routes are the mover's own guide: not drawn on the rival's phone.
  const sel = showSel ? s.sel : null
  renderBoard(g, geo, s.turn, now, live)
  const u = geo.cell
  const r0 = u * 0.36
  const at = (sq: number) => cellCenter(geo, colOf(sq), rowOf(sq))
  const sinceMove = now - s.movedAt
  const last = s.last
  const dur = last ? (last.path.length - 1) * HOP : 0
  const sliding = last && sinceMove < dur ? last : null
  const landing = last ? (last.path[last.path.length - 1] ?? -1) : -1
  const mover: Side = s.turn === 0 ? 1 : 0
  const pulse = 0.5 + 0.5 * Math.sin(now * 7)

  // The last move's route, in the mover's colour: fades after a while.
  if (last && last.path.length > 1) {
    const fade = 1 - prog(sinceMove, 1.6, 2.6)
    const shown = Math.min(1, sinceMove / Math.max(0.01, dur))
    if (fade > 0) {
      const pts = last.path.map(at)
      const n = (pts.length - 1) * shown
      g.alpha(0.75 * fade, () => {
        for (let i = 0; i < pts.length - 1 && i < n; i++) {
          const p = pts[i]
          const q = pts[i + 1]
          if (!p || !q) continue
          const f = Math.min(1, n - i)
          const ex = p.x + (q.x - p.x) * f
          const ey = p.y + (q.y - p.y) * f
          g.line(p.x, p.y, ex, ey, alpha(INK, 0.5), 22)
          g.line(p.x, p.y, ex, ey, SIDE[mover].light, 12)
        }
        const first = pts[0]
        if (first) g.ring(first.x, first.y, u * 0.2, SIDE[mover].light, 8)
      })
    }
  }

  // The piece being played: its square, the routes it may take and their landings.
  const victims = new Set<number>()
  if (sel !== null && live) {
    const c = at(sel)
    g.rrect(c.x - u / 2 + 4, c.y - u / 2 + 4, u - 8, u - 8, 10, alpha(C.yellow, 0.28), C.yellow, 7)
    const prefix = [sel, ...s.via].map(at)
    for (let i = 0; i < prefix.length - 1; i++) {
      const p = prefix[i]
      const q = prefix[i + 1]
      if (p && q) g.line(p.x, p.y, q.x, q.y, C.yellow, 14)
    }
    const from = prefix[prefix.length - 1] ?? c
    for (const rt of routes) {
      let p = from
      rt.path.forEach((sq) => {
        const q = at(sq)
        g.dashed(p.x, p.y, q.x, q.y, alpha(C.yellow, 0.75), 9, [18, 14])
        p = q
      })
      for (const v of rt.jumps) victims.add(v)
    }
    for (const rt of routes) {
      rt.path.forEach((sq, i) => {
        const q = at(sq)
        const end = i === rt.path.length - 1
        if (end) {
          g.circle(q.x, q.y + 4, u * 0.2, alpha(INK, 0.4))
          g.circle(q.x, q.y, u * 0.19, C.yellow, alpha(INK, 0.7), 5)
        } else {
          g.circle(q.x, q.y, u * 0.12, alpha(C.yellow, 0.85), alpha(INK, 0.6), 4)
        }
      })
    }
  }

  // Pieces at rest. Ones that must jump glow; the selected one lifts.
  s.board.forEach((cell, sq) => {
    if (!cell) return
    if (sliding && sq === landing) return
    const c = at(sq)
    const picked = sq === sel && live
    if (live && forced.includes(sq) && sel === null) {
      g.circle(
        c.x,
        c.y,
        u * 0.52,
        g.rad(c.x, c.y, u * 0.2, u * 0.52, [
          [0, alpha(C.yellow, 0.75 * (0.5 + 0.5 * pulse))],
          [1, alpha(C.yellow, 0)],
        ]),
      )
      g.ring(c.x, c.y, r0 * 1.22, alpha(C.yellow, 0.45 + 0.45 * pulse), 7)
    }
    let lift = picked ? r0 * 0.35 + Math.sin(now * 6) * r0 * 0.06 : 0
    let squash = 0
    let crown = 1
    if (last && sq === landing && sinceMove >= dur && sinceMove < dur + 0.2) {
      squash = 0.2 * Math.sin(Math.PI * prog(sinceMove, dur, dur + 0.2))
    }
    if (last?.crowned && sq === landing) crown = outBack(prog(sinceMove, dur, dur + 0.4))
    // The winners hop for joy, in a wave across the board.
    if (s.winner !== null && s.winner !== 'draw' && owner(cell) === s.winner) {
      const d = rowOf(sq) + colOf(sq) * 0.5
      const t0 = now - s.endedAt - dur - 0.5 - d * 0.05
      const t = t0 % 1.1
      if (t0 > 0 && t < 0.4) {
        lift = Math.sin((Math.PI * t) / 0.4) * u * 0.25
        squash = -0.12 * Math.sin((Math.PI * t) / 0.4)
      }
    }
    drawChecker(g, cell, c.x, c.y, r0, { lift, scale: picked ? 1.08 : 1, squash, crown })
    if (victims.has(sq)) {
      g.ring(c.x, c.y, r0 * (1.15 + 0.08 * pulse), alpha(C.white, 0.9), 6)
      g.line(c.x - r0 * 0.4, c.y - r0 * 0.4, c.x + r0 * 0.4, c.y + r0 * 0.4, alpha(C.white, 0.9), 8)
      g.line(c.x - r0 * 0.4, c.y + r0 * 0.4, c.x + r0 * 0.4, c.y - r0 * 0.4, alpha(C.white, 0.9), 8)
    }
  })

  // Jumped pieces stay put until their jump lands, then fly, spinning, to the taker's tray.
  let flying = 0
  if (last && last.captured.length) {
    const taker = mover
    const before = 12 - count(s.board, taker === 0 ? 1 : 0) - last.captured.length
    hops({ path: last.path, captured: last.captured }).forEach((jumped, i) => {
      const hit = (i + 1) * HOP
      for (const sq of jumped) {
        const k = last.captured.indexOf(sq)
        const cell = last.taken[k] ?? 0
        if (!cell || sinceMove > hit + FLY) continue
        flying++
        const c = at(sq)
        if (sinceMove < hit) {
          drawChecker(g, cell, c.x, c.y, r0, { squash: 0.12 * prog(sinceMove, hit - 0.1, hit) })
          continue
        }
        const slot = slotAt(g, geo, taker, before + k)
        const t = prog(sinceMove, hit, hit + FLY)
        const e = outCubic(t)
        const arc = Math.sin(Math.PI * t) * 240
        drawChecker(
          g,
          cell,
          c.x + (slot.x - c.x) * e,
          c.y + (slot.y - c.y) * e - arc,
          r0 + (TRAY_R - r0) * e,
          { scale: 1 + 0.3 * Math.sin(Math.PI * t), squash: -0.15 * Math.sin(Math.PI * 2 * t) },
        )
      }
    })
  }

  // The moving piece hops along its route, arcing high over each piece it jumps.
  if (sliding) {
    const steps = hops({ path: sliding.path, captured: sliding.captured })
    const hop = Math.min(sliding.path.length - 2, Math.floor(sinceMove / HOP))
    const t = Math.min(1, Math.max(0, (sinceMove - hop * HOP) / HOP))
    const e = t * t * (3 - 2 * t)
    const a = at(sliding.path[hop] ?? 0)
    const b = at(sliding.path[hop + 1] ?? 0)
    const high = (steps[hop]?.length ?? 0) > 0 ? 0.55 : 0.18
    drawChecker(g, sliding.piece, a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, r0, {
      lift: Math.sin(Math.PI * t) * u * high,
      scale: 1 + 0.12 * Math.sin(Math.PI * t),
    })
  }

  for (const side of [0, 1] as Side[]) drawTray(g, geo, s, side, side === mover ? flying : 0)
}
