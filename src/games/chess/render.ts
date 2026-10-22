import type { PieceSymbol } from 'chess.js'
import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw, Fill } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { cellAt, cellCenter, type Geom } from '../../engines/board/index.ts'
import type { State } from './index.ts'
import {
  boardOf,
  colorOf,
  coordsOf,
  findKing,
  MAX_PLIES,
  type Piece,
  sideOf,
  squareAt,
} from './rules.ts'

const INK = C.ink
const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
/** Seconds a move takes to slide across the board. */
export const SLIDE = 0.3
/** Seconds a taken piece flies from its square to the taker's tray. */
const FLY = 0.5
/** Frame around the squares, and its lip. */
const PAD = 30
const LIP = 24

/**
 * One chess piece, built from shapes: a chunky toy on a round plinth, with a
 * dark outline, a side-lit body and a gloss streak. (x, y) is the centre of
 * its square; `u` is the square size; `angle` turns it to face its owner (or
 * lays a mated king down).
 */
export function drawPiece(
  g: Draw,
  p: Piece,
  x: number,
  y: number,
  u: number,
  o: { angle?: number; scale?: number; alpha?: number; lift?: number; squash?: number } = {},
): void {
  const col = SIDE[sideOf(p.color)]
  const k = (v: number) => v * u
  const lw = u * 0.045
  const fill = g.lin(-k(0.3), -k(0.3), k(0.3), k(0.25), [
    [0, shade(col.main, 0.42)],
    [0.45, col.main],
    [1, shade(col.dark, -0.15)],
  ])
  const solid = (fn: (c: CanvasRenderingContext2D) => void) => g.path(fn, fill, INK, lw)
  const gloss = (gx: number, gy: number, rx: number, ry: number) =>
    g.alpha(0.6, () => g.ellipse(k(gx), k(gy), k(rx), k(ry), '#ffffff', 0.25))
  const plinth = (w: number) => {
    g.ellipse(0, k(0.27), k(w), k(0.1), INK)
    g.path((c) => c.ellipse(0, k(0.24), k(w), k(0.1), 0, 0, Math.PI * 2), col.dark, INK, lw)
    g.path(
      (c) => c.ellipse(0, k(0.2), k(w - 0.02), k(0.075), 0, 0, Math.PI * 2),
      shade(col.main, 0.1),
      INK,
      lw * 0.7,
    )
  }
  const body = () => {
    g.ctx.lineJoin = 'round'
    switch (p.type) {
      case 'p': {
        plinth(0.25)
        solid((c) => {
          c.moveTo(-k(0.2), k(0.2))
          c.bezierCurveTo(-k(0.14), k(0.04), -k(0.08), k(0.0), -k(0.08), -k(0.1))
          c.lineTo(k(0.08), -k(0.1))
          c.bezierCurveTo(k(0.08), k(0.0), k(0.14), k(0.04), k(0.2), k(0.2))
          c.closePath()
        })
        g.rrect(-k(0.14), -k(0.15), k(0.28), k(0.08), k(0.04), fill, INK, lw)
        g.circle(0, -k(0.27), k(0.15), fill, INK, lw)
        gloss(-0.06, -0.32, 0.05, 0.035)
        gloss(-0.1, 0.07, 0.02, 0.06)
        break
      }
      case 'r': {
        plinth(0.28)
        solid((c) => {
          c.moveTo(-k(0.2), k(0.2))
          c.lineTo(-k(0.16), -k(0.17))
          c.lineTo(k(0.16), -k(0.17))
          c.lineTo(k(0.2), k(0.2))
          c.closePath()
        })
        g.rrect(-k(0.24), -k(0.24), k(0.48), k(0.1), k(0.04), fill, INK, lw)
        g.path(
          (c) => {
            c.moveTo(-k(0.24), -k(0.22))
            c.lineTo(-k(0.24), -k(0.4))
            c.lineTo(-k(0.13), -k(0.4))
            c.lineTo(-k(0.13), -k(0.32))
            c.lineTo(-k(0.055), -k(0.32))
            c.lineTo(-k(0.055), -k(0.4))
            c.lineTo(k(0.055), -k(0.4))
            c.lineTo(k(0.055), -k(0.32))
            c.lineTo(k(0.13), -k(0.32))
            c.lineTo(k(0.13), -k(0.4))
            c.lineTo(k(0.24), -k(0.4))
            c.lineTo(k(0.24), -k(0.22))
            c.closePath()
          },
          fill,
          INK,
          lw,
        )
        gloss(-0.11, -0.02, 0.025, 0.1)
        break
      }
      case 'n': {
        plinth(0.27)
        // A horse's head in profile, facing left: back of the neck, mane, ear, nose, jaw, chest.
        solid((c) => {
          c.moveTo(k(0.21), k(0.2))
          c.quadraticCurveTo(k(0.26), -k(0.08), k(0.16), -k(0.27))
          c.quadraticCurveTo(k(0.11), -k(0.36), k(0.05), -k(0.39))
          c.lineTo(k(0.02), -k(0.49))
          c.lineTo(-k(0.05), -k(0.38))
          c.quadraticCurveTo(-k(0.2), -k(0.3), -k(0.29), -k(0.1))
          c.quadraticCurveTo(-k(0.32), -k(0.01), -k(0.24), k(0.01))
          c.lineTo(-k(0.12), -k(0.02))
          c.quadraticCurveTo(-k(0.05), -k(0.02), -k(0.07), k(0.06))
          c.quadraticCurveTo(-k(0.17), k(0.12), -k(0.19), k(0.2))
          c.closePath()
        })
        // Mane ridges.
        for (const t of [0, 1, 2])
          g.line(
            k(0.15 - t * 0.012),
            -k(0.24 - t * 0.12),
            k(0.21 - t * 0.012),
            -k(0.19 - t * 0.12),
            INK,
            lw * 0.8,
          )
        g.circle(-k(0.09), -k(0.22), k(0.04), INK)
        g.circle(-k(0.1), -k(0.235), k(0.013), '#ffffff')
        g.circle(-k(0.24), -k(0.06), k(0.018), INK)
        gloss(-0.14, -0.2, 0.06, 0.025)
        break
      }
      case 'b': {
        plinth(0.25)
        solid((c) => {
          c.moveTo(-k(0.13), k(0.2))
          c.quadraticCurveTo(-k(0.1), k(0.08), -k(0.07), k(0.04))
          c.lineTo(k(0.07), k(0.04))
          c.quadraticCurveTo(k(0.1), k(0.08), k(0.13), k(0.2))
          c.closePath()
        })
        g.rrect(-k(0.15), k(0.0), k(0.3), k(0.07), k(0.035), fill, INK, lw)
        g.path(
          (c) => {
            c.moveTo(0, -k(0.4))
            c.bezierCurveTo(k(0.2), -k(0.26), k(0.2), -k(0.02), 0, k(0.01))
            c.bezierCurveTo(-k(0.2), -k(0.02), -k(0.2), -k(0.26), 0, -k(0.4))
            c.closePath()
          },
          fill,
          INK,
          lw,
        )
        g.circle(0, -k(0.43), k(0.055), fill, INK, lw)
        g.line(k(0.02), -k(0.27), k(0.1), -k(0.17), INK, lw * 1.2)
        gloss(-0.08, -0.17, 0.025, 0.08)
        break
      }
      case 'q':
      case 'k': {
        plinth(0.3)
        solid((c) => {
          c.moveTo(-k(0.23), k(0.2))
          c.bezierCurveTo(-k(0.13), k(0.06), -k(0.11), -k(0.04), -k(0.15), -k(0.16))
          c.lineTo(k(0.15), -k(0.16))
          c.bezierCurveTo(k(0.11), -k(0.04), k(0.13), k(0.06), k(0.23), k(0.2))
          c.closePath()
        })
        g.rrect(-k(0.19), -k(0.22), k(0.38), k(0.09), k(0.045), fill, INK, lw)
        if (p.type === 'q') {
          solid((c) => {
            c.moveTo(-k(0.17), -k(0.21))
            c.lineTo(-k(0.23), -k(0.36))
            c.lineTo(-k(0.1), -k(0.29))
            c.lineTo(0, -k(0.4))
            c.lineTo(k(0.1), -k(0.29))
            c.lineTo(k(0.23), -k(0.36))
            c.lineTo(k(0.17), -k(0.21))
            c.closePath()
          })
          for (const [cx, cy] of [
            [-0.23, -0.37],
            [0, -0.42],
            [0.23, -0.37],
          ] as const)
            g.circle(k(cx), k(cy), k(0.05), fill, INK, lw * 0.9)
        } else {
          g.path(
            (c) => {
              c.moveTo(-k(0.15), -k(0.21))
              c.quadraticCurveTo(-k(0.17), -k(0.33), 0, -k(0.33))
              c.quadraticCurveTo(k(0.17), -k(0.33), k(0.15), -k(0.21))
              c.closePath()
            },
            fill,
            INK,
            lw,
          )
          g.rrect(-k(0.035), -k(0.52), k(0.07), k(0.2), k(0.025), fill, INK, lw)
          g.rrect(-k(0.1), -k(0.465), k(0.2), k(0.065), k(0.03), fill, INK, lw)
        }
        gloss(-0.1, -0.03, 0.025, 0.1)
        break
      }
    }
  }
  const sc = o.scale ?? 1
  const sq = o.squash ?? 0
  const lift = o.lift ?? 0
  // Everything happens in the owner's frame: they see it upright, and it hops toward their "up".
  g.alpha(o.alpha ?? 1, () =>
    g.at(x, y, o.angle ?? 0, () => {
      g.shadow(0, k(0.3), k(0.3) * sc * (1 - lift / u), k(0.08) * sc, 0.35)
      // Squash keeps the base on its square: scale about the plinth.
      g.at(0, k(0.24) - lift, 0, () =>
        g.at(0, -k(0.24), 0, body, sc * (1 + sq * 0.5), sc * (1 - sq)),
      )
    }),
  )
}

/** The board frame: blue owns the top edge, red the bottom; the side to move lights its edge. */
export function renderBoard(g: Draw, geo: Geom, turn: Side, now: number, live: boolean): void {
  const x0 = geo.x - PAD
  const y0 = geo.y - PAD
  const w = geo.w + PAD * 2
  const h = geo.h + PAD * 2
  g.shadow(W / 2, y0 + h + LIP + 14, w * 0.56, 40, 0.45)
  // Lip, then the frame face, tinted toward each player's colour.
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
  // The edge of the side to move glows.
  if (live) {
    const pulse = 0.5 + 0.5 * Math.sin(now * 5)
    const ey = turn === 0 ? y0 + h - PAD / 2 : y0 + PAD / 2
    g.alpha(0.55 + 0.35 * pulse, () => g.line(x0 + 60, ey, x0 + w - 60, ey, SIDE[turn].main, 10))
    g.alpha(0.2 * pulse, () => g.line(x0 + 50, ey, x0 + w - 50, ey, SIDE[turn].light, 22))
  }

  // Squares, each colour lit by a single floodlight gradient.
  const light = g.lin(0, geo.y, 0, geo.y + geo.h, [
    [0, '#f6ecd6'],
    [1, '#e4d3b2'],
  ])
  const dark = g.lin(0, geo.y, 0, geo.y + geo.h, [
    [0, '#62539c'],
    [1, '#4d4084'],
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

/** Where the taken pieces sit: a recessed tray between each player and the board. */
export function trayY(geo: Geom, side: Side): number {
  const d = geo.h / 2 + PAD + LIP + 150
  return side === 0 ? MID + d : MID - d
}

const TRAY_W = 780
const TRAY_U = 84
const TRAY_GAP = 46

/** The captures of `side`, best first: rival pieces as codes like 'bq'. */
function trophies(lost: readonly string[], side: Side): string[] {
  return lost
    .filter((code) => code[0] !== colorOf(side))
    .sort((a, b) => VALUE[b[1] as PieceSymbol] - VALUE[a[1] as PieceSymbol])
}

/** World position of tray slot `i` for `side`, following that player's view. */
function slotAt(g: Draw, geo: Geom, side: Side, i: number): { x: number; y: number; a: number } {
  const a = g.orient(side)
  const lx = -TRAY_W / 2 + 56 + i * TRAY_GAP
  return { x: W / 2 + Math.cos(a) * lx, y: trayY(geo, side) + Math.sin(a) * lx, a }
}

/** Captured pieces in a tray before each player, upright for them, with the material lead. */
function drawTray(g: Draw, geo: Geom, s: State, side: Side, flying: string | null): void {
  const mine = trophies(s.lost, side)
  const theirs = trophies(s.lost, side === 0 ? 1 : 0)
  const worth = (codes: string[]) => codes.reduce((n, code) => n + VALUE[code[1] as PieceSymbol], 0)
  const lead = worth(mine) - worth(theirs)
  // The piece in flight lands in its slot only when it arrives.
  const skip = flying && flying[0] !== colorOf(side) ? mine.lastIndexOf(flying) : -1
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
    if (mine.length === 0)
      g.text('Captures', 0, 2, { size: 36, weight: 600, color: alpha(C.white, 0.36) })
    mine.forEach((code, i) => {
      if (i === skip) return
      drawPiece(
        g,
        { color: code[0] as 'w' | 'b', type: code[1] as PieceSymbol },
        -TRAY_W / 2 + 56 + i * TRAY_GAP,
        -4,
        TRAY_U,
      )
    })
    if (lead > 0) {
      const lw = g.measure(`+${lead}`, 44, 700) + 40
      g.rrect(TRAY_W / 2 - lw - 14, -34, lw, 68, 34, SIDE[side].main)
      g.text(`+${lead}`, TRAY_W / 2 - 14 - lw / 2, 2, { size: 44, weight: 700, color: C.white })
    }
    // The game is judged on material at the move limit: warn when it is close.
    const left = MAX_PLIES - s.history.length
    if (left <= 20 && left > 0 && s.status !== 'mate') {
      g.text(`${left} moves to the limit`, 0, 92, {
        size: 34,
        weight: 600,
        color: left <= 6 ? C.yellow : alpha(C.white, 0.6),
      })
    }
  })
}

/** The whole table: board, highlights, pieces and their motion, check, mate and the trays. */
export function renderChess(
  g: Draw,
  s: State,
  geo: Geom,
  now: number,
  targets: readonly string[],
  over: boolean,
  showSel = true,
): void {
  const live = !over && s.endedAt < 0
  const sel = showSel ? s.sel : null
  const drag = s.drag && live ? s.drag : null
  renderBoard(g, geo, s.turn, now, live)
  const u = geo.cell
  const at = (sq: string) => {
    const { c, r } = coordsOf(sq)
    return cellCenter(geo, c, r)
  }
  const fillSquare = (sq: string, color: Fill) => {
    const { c, r } = coordsOf(sq)
    g.rect(geo.x + c * u, geo.y + r * u, u, u, color)
  }
  const board = boardOf(s.fen)
  const sinceMove = now - s.movedAt
  const mover: Side = s.turn === 0 ? 1 : 0
  const moving = s.lastMove && sinceMove < SLIDE ? s.lastMove : null

  // Castling: the rook slides too.
  let rook: { from: string; to: string } | null = null
  if (s.lastMove) {
    const p = board[coordsOf(s.lastMove.to).r * 8 + coordsOf(s.lastMove.to).c]
    const a = coordsOf(s.lastMove.from)
    const b = coordsOf(s.lastMove.to)
    if (p?.type === 'k' && Math.abs(a.c - b.c) === 2) {
      const rank = s.lastMove.from[1] ?? '1'
      rook = b.c > a.c ? { from: `h${rank}`, to: `f${rank}` } : { from: `a${rank}`, to: `d${rank}` }
    }
  }
  const rookMoving = rook && sinceMove < SLIDE ? rook : null

  // The last move, in the mover's colour.
  if (s.lastMove) {
    const a = Math.min(1, sinceMove / 0.2)
    g.alpha(a, () => {
      fillSquare(s.lastMove!.from, alpha(SIDE[mover].main, 0.28))
      fillSquare(s.lastMove!.to, alpha(SIDE[mover].main, 0.45))
    })
  }

  const kingSq =
    s.status === 'check' || s.status === 'mate' ? findKing(s.fen, colorOf(s.turn)) : null
  const pulse = 0.5 + 0.5 * Math.sin(now * 8)
  if (kingSq) {
    const k = at(kingSq)
    g.alpha(0.6 + 0.4 * pulse, () =>
      g.circle(
        k.x,
        k.y,
        u * 0.7,
        g.rad(k.x, k.y, u * 0.1, u * 0.7, [
          [0, alpha(C.red, 0.95)],
          [0.6, alpha(C.red, 0.45)],
          [1, alpha(C.red, 0)],
        ]),
      ),
    )
  }
  // The selected piece: the one yellow thing, with its moves.
  if (sel && live) {
    const { c, r } = coordsOf(sel)
    fillSquare(sel, alpha(C.yellow, 0.55))
    g.rrect(geo.x + c * u + 4, geo.y + r * u + 4, u - 8, u - 8, 10, undefined, C.yellow, 8)
  }

  // Pieces, leaving out the ones sliding in.
  const mated = s.status === 'mate' && s.endedAt >= 0 ? s.turn : null
  const lie = mated !== null ? outBack(prog(now - s.endedAt, SLIDE + 0.15, SLIDE + 0.75)) : 0
  const winner: Side | null = mated === null ? null : mated === 0 ? 1 : 0
  const kingAt = winner !== null ? (findKing(s.fen, colorOf(winner)) ?? 'e1') : 'e1'
  board.forEach((p, i) => {
    if (!p) return
    const sq = squareAt(i % 8, Math.floor(i / 8))
    if (moving && sq === moving.to) return
    if (rookMoving && sq === rookMoving.to) return
    // The dragged piece is drawn under the finger, last.
    if (drag && sq === drag.sq) return
    const c = at(sq)
    const picked = sq === sel && live
    const side = sideOf(p.color)
    let angle = g.orient(side)
    let lift = picked ? u * 0.1 + Math.sin(now * 6) * u * 0.02 : 0
    let squash = 0
    // Landing: a short squash once the slide ends.
    if (s.lastMove && sq === s.lastMove.to && sinceMove >= SLIDE && sinceMove < SLIDE + 0.2) {
      squash = 0.18 * Math.sin(Math.PI * prog(sinceMove, SLIDE, SLIDE + 0.2))
    }
    if (mated !== null && p.type === 'k' && colorOf(mated) === p.color) {
      angle += lie * (Math.PI / 2) * (side === 0 ? 1 : -1)
    }
    // The winners jump for joy, in a wave from their king.
    if (winner !== null && side === winner) {
      const k = coordsOf(kingAt)
      const d = Math.hypot((i % 8) - k.c, Math.floor(i / 8) - k.r)
      const t = (now - s.endedAt - SLIDE - 0.5 - d * 0.06) % 1.1
      if (now - s.endedAt > SLIDE + 0.5 + d * 0.06 && t < 0.4) {
        lift = Math.sin((Math.PI * t) / 0.4) * u * 0.22
        squash = -0.1 * Math.sin((Math.PI * t) / 0.4)
      }
    }
    drawPiece(g, p, c.x, c.y, u, {
      angle,
      scale: picked ? 1.1 : 1,
      lift,
      squash,
    })
  })

  // Where the selected piece may go: dots on empty squares, rings round the pieces it can take.
  if (live) {
    for (const to of targets) {
      const p = at(to)
      if (board[coordsOf(to).r * 8 + coordsOf(to).c]) {
        g.ring(p.x, p.y, u * 0.44, alpha(INK, 0.5), 14)
        g.ring(p.x, p.y, u * 0.44, C.yellow, 8)
      } else {
        g.circle(p.x, p.y + 3, u * 0.14, alpha(INK, 0.45))
        g.circle(p.x, p.y, u * 0.13, C.yellow, alpha(INK, 0.7), 4)
      }
    }
  }

  // A dragged piece rides under the finger, lifted, with its shadow left on the board.
  if (drag) {
    const { c, r } = coordsOf(drag.sq)
    const p = board[r * 8 + c]
    if (p) {
      const hover = cellAt(geo, drag.x, drag.y)
      if (hover) {
        const sq = squareAt(hover.c, hover.r)
        if (targets.includes(sq)) fillSquare(sq, alpha(C.yellow, 0.35))
      }
      drawPiece(g, p, drag.x, drag.y - u * 0.15, u, {
        angle: g.orient(sideOf(p.color)),
        lift: u * 0.18,
        scale: 1.2,
      })
    }
  }

  // The piece that just moved slides (with a hop) to its square; a castling rook follows.
  const slide = (m: { from: string; to: string }, p: Piece, hopK: number) => {
    const t = prog(sinceMove, 0, SLIDE)
    const e = outCubic(t)
    const a = at(m.from)
    const b = at(m.to)
    drawPiece(g, p, a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, u, {
      angle: g.orient(sideOf(p.color)),
      lift: Math.sin(Math.PI * t) * u * hopK,
      scale: 1 + 0.1 * Math.sin(Math.PI * t),
    })
  }
  if (moving) {
    const p = board[coordsOf(moving.to).r * 8 + coordsOf(moving.to).c]
    // A knight leaps; everything else glides with a small hop.
    if (p) slide(moving, p, p.type === 'n' ? 0.6 : 0.28)
  }
  if (rookMoving) {
    const p = board[coordsOf(rookMoving.to).r * 8 + coordsOf(rookMoving.to).c]
    if (p) slide(rookMoving, p, 0.18)
  }

  // The taken piece stands until the attacker arrives, then flies, spinning, to the taker's tray.
  let flying: string | null = null
  if (s.taken && sinceMove < SLIDE + FLY) {
    const code = s.taken.code
    const piece = { color: code[0] as 'w' | 'b', type: code[1] as PieceSymbol }
    const from = at(s.taken.sq)
    const taker = mover
    flying = code
    if (sinceMove < SLIDE) {
      drawPiece(g, piece, from.x, from.y, u, {
        angle: g.orient(sideOf(piece.color)),
        squash: 0.1 * prog(sinceMove, SLIDE * 0.6, SLIDE),
      })
    } else {
      const slot = slotAt(g, geo, taker, trophies(s.lost, taker).lastIndexOf(code))
      const t = prog(sinceMove, SLIDE, SLIDE + FLY)
      const e = outCubic(t)
      const arc = Math.sin(Math.PI * t) * 260
      const x = from.x + (slot.x - from.x) * e
      const y = from.y + (slot.y - from.y) * e - arc
      const size = u + (TRAY_U - u) * e
      const spin = (1 - e) * Math.PI * 2 * (taker === 0 ? 1 : -1)
      drawPiece(g, piece, x, y, size, {
        angle: slot.a + spin,
        scale: 1 + 0.25 * Math.sin(Math.PI * t),
      })
    }
  }

  if (kingSq && s.status === 'check' && live) {
    const k = at(kingSq)
    g.ring(k.x, k.y, u * 0.46 + pulse * u * 0.05, C.red, 10)
  }

  for (const side of [0, 1] as Side[]) drawTray(g, geo, s, side, flying)
}
