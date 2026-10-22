import type { Side } from '../../core/game.ts'
import { banner, hudY, namePill, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { type ControlLook, drawStrip } from '../../engines/arena/index.ts'
import { MID, W } from '../../core/stage.ts'
import type { State } from './index.ts'
import {
  BOARD,
  BOARD_BOTTOM,
  BOMB_T,
  blastCells,
  CRATE,
  FLAME_T,
  hurryNext,
  ITEM_ICON,
  PILLAR,
  type Player,
  type World,
} from './rules.ts'

const STONE = '#6f6a86'
const WOOD = '#c98a4b'
const FLOOR_A = '#2d2a48'
const FLOOR_B = '#28253f'
/** Centre of the HUD column between red's stick and bomb button (mirrored for blue). */
const HUD_X = 540
const FLAGS = [C.red, C.yellow, C.blue, C.green, C.pink, C.orange]

const clamp01 = (k: number): number => Math.max(0, Math.min(1, k))

function cellXY(i: number): { x: number; y: number; c: number; r: number } {
  const c = i % BOARD.cols
  const r = (i - c) / BOARD.cols
  return { x: BOARD.x0 + c * BOARD.cell, y: BOARD.y0 + r * BOARD.cell, c, r }
}

/** Festival ground: checkered dance floor with a warm floodlight in the middle and a chunky rim. */
function ground(g: Draw): void {
  const { x0, y0, cell, cols, rows } = BOARD
  const w = cols * cell
  const h = rows * cell
  g.rrect(x0 - 22, y0 - 14, w + 44, h + 44, 34, alpha('#000000', 0.4))
  g.rrect(x0 - 20, y0 - 20, w + 40, h + 40, 32, shade(C.ink, 0.2))
  g.rrect(x0 - 20, y0 - 20, w + 40, h + 40, 32, undefined, alpha(C.white, 0.08), 3)
  g.rect(x0, y0, w, h, FLOOR_A)
  for (let r = 0; r < rows; r++)
    for (let c = r % 2; c < cols; c += 2) g.rect(x0 + c * cell, y0 + r * cell, cell, cell, FLOOR_B)
  g.rect(
    x0,
    y0,
    w,
    h,
    g.lin(0, y0, 0, y0 + h, [
      [0, alpha(C.blue, 0.14)],
      [0.5, alpha(C.blue, 0)],
      [0.5, alpha(C.red, 0)],
      [1, alpha(C.red, 0.14)],
    ]),
  )
  g.rect(
    x0,
    y0,
    w,
    h,
    g.rad(W / 2, MID, 40, h * 0.6, [
      [0, alpha('#ffd9a0', 0.1)],
      [1, alpha('#ffd9a0', 0)],
    ]),
  )
}

/** A string of festival flags sagging along a board edge. */
function bunting(g: Draw, y: number, now: number, flip: boolean): void {
  const x0 = BOARD.x0 - 24
  const x1 = BOARD.x0 + BOARD.cols * BOARD.cell + 24
  const n = 14
  const sag = flip ? -22 : 22
  const at = (t: number) => ({ x: x0 + (x1 - x0) * t, y: y + Math.sin(Math.PI * t) * sag })
  g.path(
    (c) => {
      c.moveTo(x0, y)
      c.quadraticCurveTo((x0 + x1) / 2, y + sag * 2, x1, y)
    },
    undefined,
    alpha(C.white, 0.35),
    3,
  )
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n
    const p = at(t)
    const sway = Math.sin(now * 2.2 + k) * 0.12
    const d = flip ? -1 : 1
    g.at(p.x, p.y, sway, () =>
      g.poly([-13, 0, 13, 0, 0, d * 28], FLAGS[k % FLAGS.length] ?? C.yellow),
    )
  }
}

/** Pillars (stone posts with a lantern stud) and crates (planked, studded, breakable). */
function blocks(g: Draw, w: World, now: number): void {
  const cs = BOARD.cell
  for (let i = 0; i < w.tiles.length; i++) {
    const t = w.tiles[i]
    if (t !== PILLAR && t !== CRATE) continue
    const { x, y } = cellXY(i)
    g.rrect(x + 10, y + 14, cs - 8, cs - 8, 14, alpha('#000000', 0.32))
  }
  for (let i = 0; i < w.tiles.length; i++) {
    const t = w.tiles[i]
    const { x, y, c, r } = cellXY(i)
    if (t === PILLAR) {
      g.tile(x + 4, y - 4, cs - 8, cs + 2, 18, STONE, 16)
      g.rrect(x + 14, y + 4, cs - 28, cs - 42, 10, alpha('#ffffff', 0.1))
      // A small festival lantern on each post, glowing in turn.
      const glow = 0.55 + 0.45 * Math.sin(now * 2.5 + c * 1.3 + r * 0.7)
      const lx = x + cs / 2
      const ly = y + cs / 2 - 14
      g.circle(lx, ly, 16 + glow * 6, alpha('#ffb648', 0.16 * glow))
      g.ball(lx, ly, 10, mix('#ffb648', '#fff3c4', glow * 0.5), 0.8)
    } else if (t === CRATE) {
      g.tile(x + 5, y - 2, cs - 10, cs - 2, 14, WOOD, 14)
      const plank = alpha(shade(WOOD, -0.45), 0.55)
      for (const k of [0.28, 0.5])
        g.line(x + 12, y + (cs - 14) * k + 2, x + cs - 12, y + (cs - 14) * k + 2, plank, 4)
      g.line(x + 14, y + 8, x + cs - 14, y + cs - 30, alpha(shade(WOOD, -0.5), 0.35), 6)
      for (const [sx, sy] of [
        [14, 8],
        [cs - 14, 8],
        [14, cs - 28],
        [cs - 14, cs - 28],
      ] as const)
        g.circle(x + sx, y + sy, 4, alpha('#3b2a1a', 0.55))
    }
  }
}

/** Power-ups: a floating cream bubble with its glyph, bobbing and twinkling. */
function item(g: Draw, i: number, k: number, now: number): void {
  const { x, y } = cellXY(i)
  const cx = x + BOARD.cell / 2
  const bob = Math.sin(now * 3 + i) * 4
  const cy = y + BOARD.cell / 2 + bob - 4
  g.shadow(cx, y + BOARD.cell - 14, 24 - bob, 8, 0.3)
  g.circle(cx, cy, 34, alpha(C.cream, 0.18 + 0.1 * Math.sin(now * 5 + i)))
  g.ball(cx, cy, 28, C.cream, 0.9)
  g.emoji(ITEM_ICON[k] ?? '⭐', cx, cy + 1, 38)
  const tw = (now * 1.3 + i * 0.37) % 1
  g.star(cx + 22, cy - 22, 9 * Math.sin(Math.PI * tw), '#ffffff', 4, 0.35)
}

/**
 * A cartoon bomb: it swells and flashes faster as the fuse burns down. The
 * ring under it is its owner's colour; its blast cross is previewed on the floor.
 */
function bomb(g: Draw, i: number, t: number, owner: Side | undefined, now: number): void {
  const { x, y } = cellXY(i)
  const cx = x + BOARD.cell / 2
  const cy = y + BOARD.cell / 2
  const left = clamp01(t / BOMB_T)
  const urgent = 1 - left
  const beat = Math.sin(now * (6 + urgent * 26))
  // Plops down with an overshoot, then swells harder as the fuse runs out.
  const age = BOMB_T - t
  const plop = age < 0.25 ? 0.4 + 0.6 * backOut(age / 0.25) : 1
  const pulse = (1 + urgent * 0.12 * beat) * plop
  const flash = urgent > 0.6 && beat > 0.4
  g.shadow(cx + 4, cy + 26, 28, 9, 0.38)
  if (owner !== undefined) g.ring(cx, cy + 18, 30, alpha(SIDE[owner].main, 0.7), 5)
  g.at(cx, cy, 0, () => {
    g.ball(0, 0, 29 * pulse, flash ? '#c0303f' : '#2b2938', 0.9)
    g.rrect(-9, -36 * pulse, 18, 12, 4, '#54505f')
    // Fuse burns down from its full length.
    const len = 8 + 22 * left
    const fx = 6 + len * 0.55
    const fy = -38 * pulse - len * 0.75
    g.path(
      (c) => {
        c.moveTo(0, -34 * pulse)
        c.quadraticCurveTo(10, -38 * pulse - len * 0.6, fx, fy)
      },
      undefined,
      '#8c5a2b',
      5,
    )
    const spark = 0.5 + 0.5 * Math.sin(now * 40 + i)
    g.star(fx, fy, 12 + spark * 6, C.yellow, 6, 0.4, now * 8)
    g.circle(fx, fy, 4, '#ffffff')
  })
}

const backOut = (k: number): number => 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2

/** Hurry-up: the next cells a block will fall on blink red, the very next one hardest. */
function hurryWarn(g: Draw, w: World): void {
  const cs = BOARD.cell
  const next = hurryNext(w, 4)
  next.forEach((i, k) => {
    const { x, y } = cellXY(i)
    const blink = 0.5 + 0.5 * Math.sin(g.t * 14 - k)
    g.rrect(x + 4, y + 4, cs - 8, cs - 8, 14, alpha('#ff3b2f', (0.35 - k * 0.07) * blink))
    if (k < 2) g.ring(x + cs / 2, y + cs / 2, cs * (0.25 + 0.2 * blink), alpha('#ffffff', 0.4), 4)
  })
}

/** Floor cells inside a ticking bomb's cross, washed in orange that pulses faster as it nears. */
function danger(g: Draw, w: World, now: number): void {
  const cs = BOARD.cell
  for (const b of w.bombs) {
    const urgent = 1 - clamp01(b.t / BOMB_T)
    const a = 0.07 + urgent * 0.16 * (0.6 + 0.4 * Math.sin(now * (6 + urgent * 20)))
    for (const i of blastCells(w, b.i, b.range)) {
      if (w.tiles[i] === CRATE) continue
      const { x, y } = cellXY(i)
      g.rrect(x + 4, y + 4, cs - 8, cs - 8, 14, alpha(C.orange, a))
    }
  }
}

/**
 * The blast: each burning cell reaches toward its burning neighbours, so a
 * cross reads as one beam of fire (orange body, yellow core, white heart).
 */
function flames(g: Draw, w: World, now: number): void {
  const cs = BOARD.cell
  const burning = new Set(w.flames.map((f) => f.i))
  for (const layer of [0, 1, 2]) {
    const col = [C.orange, C.yellow, '#fff8e0'][layer] as string
    for (const f of w.flames) {
      const { x, y, c } = cellXY(f.i)
      const k = clamp01(f.t / FLAME_T)
      // Pops in fast, then thins out.
      const grow = Math.min(1, (1 - k) * 8)
      const thick = (cs * (0.82 - layer * 0.24) * (0.4 + 0.6 * k) * grow) / 2
      if (thick <= 1) continue
      const flick = 1 + 0.08 * Math.sin(now * 40 + f.i * 3 + layer)
      const cx = x + cs / 2
      const cy = y + cs / 2
      const hw = thick * flick
      const has = (dc: number, dr: number) =>
        c + dc >= 0 && c + dc < BOARD.cols && burning.has(f.i + dc + dr * BOARD.cols)
      const l = has(-1, 0) ? cs / 2 + 2 : hw
      const rr = has(1, 0) ? cs / 2 + 2 : hw
      const u = has(0, -1) ? cs / 2 + 2 : hw
      const d = has(0, 1) ? cs / 2 + 2 : hw
      g.rrect(cx - l, cy - hw, l + rr, hw * 2, hw, col)
      g.rrect(cx - hw, cy - u, hw * 2, u + d, hw, col)
      // Billowing puffs so the beam reads as fire, bigger at the heart of the blast.
      if (layer < 2) {
        const puff = hw * (1.25 + 0.15 * Math.sin(now * 23 + f.i * 1.7 + layer))
        g.circle(cx + Math.sin(now * 17 + f.i) * 4, cy + Math.cos(now * 19 + f.i) * 4, puff, col)
      }
    }
  }
}

/** A festival-goer: a blob in team colour with a party hat; when caught it chars, spins and shrinks. */
function player(g: Draw, p: Player, now: number, cheer: boolean): void {
  const col = SIDE[p.side]
  const dead = !p.alive
  const k = dead ? clamp01(1 - (now - p.deadT) / 0.9) : 1
  if (dead && k <= 0) {
    // A scorch mark where they stood.
    g.ellipse(p.x, p.y + 18, 30, 14, alpha('#000000', 0.35))
    return
  }
  const look: [number, number] = [Math.cos(p.a), Math.sin(p.a)]
  const fresh = clamp01(1 - (now - p.placeT) / 0.25)
  const hop = cheer ? Math.abs(Math.sin(now * 8)) * 26 : 0
  const step = dead ? 0 : Math.abs(Math.sin(now * 12 + p.id)) * 2
  const body = dead ? mix(col.main, '#2a2530', 1 - k) : col.main
  g.alpha(dead ? k : 1, () => {
    g.shadow(p.x + 4, p.y + 26, 28, 10, 0.35)
    g.blob(p.x, p.y - 6 - hop - step, 30, body, {
      mood: dead ? 'dizzy' : cheer ? 'grin' : fresh > 0 ? 'wow' : 'happy',
      look,
      sx: (1 + fresh * 0.15) * (dead ? 0.6 + 0.4 * k : 1),
      sy: (1 - fresh * 0.15) * (dead ? 0.6 + 0.4 * k : 1),
      angle: dead ? (1 - k) * Math.PI * 3 : 0,
      outline: true,
    })
    if (!dead) {
      // Party hat in the side's shape: red's cone has a round pompom, blue's a square one.
      const hx = p.x + 6
      const hy = p.y - 36 - hop - step
      g.poly([hx - 14, hy + 6, hx + 14, hy + 6, hx + 4, hy - 28], col.light)
      g.line(hx - 8, hy - 4, hx + 9, hy - 2, alpha(col.dark, 0.6), 4)
      g.sideMark(p.side, hx + 4, hy - 30, 7, C.white)
    }
  })
}

/** Joystick, then the bomb button: lit while a bomb is in hand, dimmed while all are out. */
function controls(g: Draw, c: ControlLook): void {
  const col = SIDE[c.side]
  g.alpha(c.on ? 0.95 : 0.6, () => {
    g.circle(c.bx, c.by, c.r, alpha(col.dark, 0.45), alpha(col.light, 0.45), 5)
    g.ball(c.kx, c.ky, c.r * 0.46, col.main, 0.6)
  })
  const ready = c.ready >= 1
  const depth = c.fr * 0.16
  const p = c.pressed ? depth : 0
  const face = ready ? col.main : mix(col.main, C.ink3, 0.6)
  if (ready) g.circle(c.fx, c.fy, c.fr + 10 + Math.sin(g.t * 6) * 3, alpha(col.light, 0.16))
  g.circle(c.fx, c.fy + depth, c.fr, shade(face, -0.45))
  g.circle(
    c.fx,
    c.fy + p,
    c.fr,
    g.rad(
      c.fx,
      c.fy,
      c.fr * 0.1,
      c.fr,
      [
        [0, shade(face, 0.3)],
        [1, face],
      ],
      c.fx - c.fr * 0.3,
      c.fy - c.fr * 0.4,
    ),
  )
  g.alpha(ready ? 1 : 0.45, () => g.emoji('💣', c.fx, c.fy + p, c.fr * 1.15, g.orient(c.side)))
}

/** Bombs, blast and speed beside the name pill, upright for the player. */
function stats(g: Draw, p: Player | undefined, side: Side, y: number): void {
  if (!p) return
  const x = side === 0 ? HUD_X : W - HUD_X
  g.forSide(side, x, y, () => {
    const items: [string, number][] = [
      ['💣', p.bombsMax],
      ['🔥', p.range],
    ]
    items.forEach(([e, n], k) => {
      const ox = k * 96 - 48
      g.emoji(e, ox - 16, 0, 32)
      g.text(n, ox + 16, 2, { size: 34, weight: 700, color: C.white, drop: alpha('#000', 0.4) })
    })
  })
}

export interface View {
  names: [string, string]
  over: boolean
}

/** Cosmetic extras from the game (never in the state). */
export interface Look {
  alpha: number
  /** Last step's position of each player (by id), for interpolation. */
  prev: readonly ({ x: number; y: number } | undefined)[]
}

/** The festival board: strips, ground, bunting, danger wash, blocks, pick-ups, bombs, fire, players, controls and HUD. */
export function renderBoard(g: Draw, s: State, now: number, v: View, look: Look): void {
  const w = s.w
  const r = s.rounds
  const shown = w.players.map((p) => {
    const q = look.prev[p.id]
    return q && p.alive
      ? { ...p, x: q.x + (p.x - q.x) * look.alpha, y: q.y + (p.y - q.y) * look.alpha }
      : p
  })
  g.fillView(C.ink)
  drawStrip(g, BOARD.y0 - 20, BOARD_BOTTOM + 20)
  ground(g)
  danger(g, w, w.t)
  hurryWarn(g, w)
  blocks(g, w, w.t)
  for (const it of w.items) item(g, it.i, it.k, w.t)
  for (const b of w.bombs) bomb(g, b.i, b.t, w.players[b.owner]?.side, w.t)
  const champ = v.over && r.last !== 'draw' ? r.last : null
  for (const p of shown) if (!p.alive) player(g, p, w.t, false)
  flames(g, w, w.t)
  const alive = shown.filter((p) => p.alive).sort((a, b) => a.y - b.y)
  for (const p of alive) player(g, p, w.t, champ === p.side)
  bunting(g, BOARD.y0 - 20, w.t, true)
  bunting(g, BOARD_BOTTOM + 20, w.t, false)
  g.vignette(0.3)
  // Online, each phone shows only its own player's stick and button.
  for (const c of s.ctl) if (g.viewer === null || c.side === g.viewer) controls(g, c)
  // Between stick and button: round pips, pocket stats, then the name pill at the edge.
  namePill(g, 0, v.names[0], { x: HUD_X, inset: 40, active: champ === 0 })
  namePill(g, 1, v.names[1], { x: W - HUD_X, inset: 40, active: champ === 1 })
  stats(g, w.players[0], 0, hudY(g, 0, 116))
  stats(g, w.players[1], 1, hudY(g, 1, 116))
  pips(g, 0, r.wins[0], r.target, { x: HUD_X, inset: 186 })
  pips(g, 1, r.wins[1], r.target, { x: W - HUD_X, inset: 186 })
  if (v.over) return
  if (r.phase === 'between' && r.text) {
    const col =
      r.last === 'draw' || r.last === null ? C.white : mix(C.white, SIDE[r.last].light, 0.4)
    banner(g, undefined, r.text, MID, {
      size: 56,
      alpha: Math.min(1, (now - r.at) * 4),
      color: col,
    })
  } else if (r.phase === 'play' && r.round > 1 && now - r.at < 1.1) {
    // Pops in, then fades as the players set off.
    const k = now - r.at
    const size = 64 * backOut(Math.min(1, k / 0.3))
    banner(g, undefined, `Round ${r.round}`, MID, { size, alpha: Math.min(1, (1.1 - k) / 0.3) })
  }
}
