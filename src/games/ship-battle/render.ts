import type { Side } from '../../core/game.ts'
import { banner, namePill, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { drawControl } from '../../engines/arena/index.ts'
import { H, MID, W } from '../../core/stage.ts'
import { lerp, outBack } from '../../core/fx/ease.ts'
import { angleTo } from '../../engines/arena/index.ts'
import type { State } from './index.ts'
import {
  BALL_LIFE,
  BALL_R,
  type Ball,
  HP,
  HULL_HALF,
  type Isle,
  RANGE,
  SEA,
  SINK_T,
  type Ship,
  WAKE_T,
} from './rules.ts'

/** Cosmetic extras from the game (never in the state). */
export interface Look {
  alpha: number
  /** Last step's pose of each ship (by index), for interpolation. */
  prev: readonly { x: number; y: number; a: number }[]
  ballPrev: ReadonlyMap<number, { x: number; y: number }>
  /** Roll of each ship (by id): + heels to starboard. */
  heel: [number, number]
  /** Wake points of each ship (by id), sampled from frames. */
  wakes: readonly (readonly { x: number; y: number; t: number }[])[]
}

/** Where a ship is drawn this frame: blended between the last two steps. */
function pose(s: Ship, look: Look): { x: number; y: number; a: number } {
  const p = look.prev[s.id]
  if (!p) return { x: s.x, y: s.y, a: s.a }
  const k = look.alpha
  return { x: lerp(p.x, s.x, k), y: lerp(p.y, s.y, k), a: p.a + angleTo(p.a, s.a) * k }
}

const DEEP = '#0a3a5c'
const WATER = '#14689a'
const SAND = '#f5d98f'
const SAND_EDGE = '#e0b46a'
const GRASS = '#58c26a'
const WOOD = '#b57a43'
const WOOD_DARK = '#7d4f25'
const ROCK = '#3b4254'
const CREAM = '#fff8ef'
/** Hulls are drawn larger than their collision size so they read on a phone. */
const HULL_SCALE = 1.45

const clamp01 = (k: number): number => Math.max(0, Math.min(1, k))

/** Open sea under the floodlights: deep gradient, team tint toward each dock, drifting swell. */
function sea(g: Draw, now: number): void {
  g.fillView(DEEP)
  g.fillView(
    g.rad(W / 2, MID, 100, H * 0.6, [
      [0, shade(WATER, 0.12)],
      [0.65, WATER],
      [1, DEEP],
    ]),
  )
  g.fillView(
    g.lin(0, SEA.top, 0, SEA.bottom, [
      [0, alpha(C.blue, 0.16)],
      [0.35, alpha(C.blue, 0)],
      [0.65, alpha(C.red, 0)],
      [1, alpha(C.red, 0.16)],
    ]),
  )
  for (let r = 0; r < 16; r++) {
    const y = SEA.top + 30 + r * 74
    const dir = r % 2 === 0 ? 1 : -0.7
    const off = ((now * 16 * dir + r * 57) % 140) - 140
    for (let c = -1; c < 9; c++)
      g.arc(c * 140 + off, y, 26, 0.35, Math.PI - 0.35, alpha('#d8f1ff', 0.08), 4)
  }
}

/** Rocky shores on the two long sides (the pause button sits over the left one). */
function shores(g: Draw, now: number): void {
  const v = g.stage.view
  for (const [x0, x1, dir] of [
    [v.x - 4, SEA.left, 1],
    [SEA.right, v.x + v.w + 4, -1],
  ] as const) {
    const edge = dir === 1 ? x1 : x0
    g.rect(x0, SEA.top, x1 - x0, SEA.bottom - SEA.top, ROCK)
    // Boulders along the water's edge, then a foam line that breathes.
    for (let y = SEA.top + 10, k = 0; y < SEA.bottom; y += 46, k++) {
      const r = 26 + ((k * 13) % 14)
      const bx = edge - dir * (8 + ((k * 7) % 12))
      g.circle(bx + 4, y + 6, r, alpha('#000000', 0.25))
      g.circle(bx, y, r, shade(ROCK, 0.12 + ((k * 5) % 3) * 0.05))
      g.circle(bx - 6, y - 8, r * 0.4, alpha('#ffffff', 0.08))
    }
    const foam = 0.35 + 0.15 * Math.sin(now * 2)
    g.line(edge + dir * 14, SEA.top, edge + dir * 14, SEA.bottom, alpha('#ffffff', foam * 0.5), 6)
  }
}

/** Each player's dock: team-stained planks, a rail at the water's edge, bollards and rope. */
function dock(g: Draw, side: Side): void {
  const v = g.stage.view
  const col = SIDE[side]
  const y0 = side === 0 ? SEA.bottom : v.y - 2
  const y1 = side === 0 ? v.y + v.h + 2 : SEA.top
  // Blue stain over brown wood turns grey, so blue's planks take more of the team colour.
  const wood = mix(WOOD_DARK, col.dark, side === 0 ? 0.45 : 0.68)
  g.rect(v.x - 2, y0, v.w + 4, y1 - y0, shade(wood, -0.25))
  for (let x = v.x, k = 0; x < v.x + v.w; x += 48, k++) {
    g.rect(x + 2, y0, 44, y1 - y0, shade(wood, (k % 3) * 0.04 - 0.1))
    g.rect(x, y0, 3, y1 - y0, alpha('#000000', 0.3))
  }
  g.fillView(
    g.lin(0, side === 0 ? y0 : y1, 0, side === 0 ? y1 : y0, [
      [0, alpha('#000000', 0)],
      [1, alpha('#000000', 0.35)],
    ]),
  )
  const edge = side === 0 ? SEA.bottom : SEA.top
  const out = side === 0 ? 1 : -1
  g.rect(v.x - 2, edge - (side === 0 ? 0 : 14), v.w + 4, 14, col.main)
  g.rect(v.x - 2, edge + out * 14 - (side === 0 ? 0 : 6), v.w + 4, 6, alpha('#000000', 0.25))
  for (let x = 60; x < W; x += 220) {
    g.circle(x, edge + out * 30, 16, '#2b2733')
    g.circle(x - 3, edge + out * 30 - 4, 6, alpha('#ffffff', 0.2))
  }
}

/** Islands: shadow, breathing foam, sand beach, grass, a palm on the big ones. */
function isles(g: Draw, list: readonly Isle[], now: number): void {
  for (const i of list) g.circle(i.x + 8, i.y + 14, i.r + 8, alpha('#001a2e', 0.35))
  for (const i of list)
    g.circle(i.x, i.y, i.r + 12 + Math.sin(now * 1.6 + i.x) * 3, alpha('#ffffff', 0.32))
  for (const i of list) g.circle(i.x, i.y, i.r + 4, SAND_EDGE)
  for (const i of list) g.circle(i.x, i.y, i.r, SAND)
  for (const i of list)
    g.circle(
      i.x,
      i.y - 3,
      i.r * 0.74,
      g.rad(
        i.x,
        i.y,
        2,
        i.r * 0.74,
        [
          [0, shade(GRASS, 0.2)],
          [1, shade(GRASS, -0.08)],
        ],
        i.x - i.r * 0.25,
        i.y - i.r * 0.3,
      ),
    )
  for (const i of list) if (i.r >= 55) g.emoji('🌴', i.x + 4, i.y - 8, i.r * 1.1)
}

function hull(p: CanvasRenderingContext2D): void {
  p.moveTo(52, 0)
  p.bezierCurveTo(42, -22, 16, -28, -14, -27)
  p.lineTo(-33, -23)
  p.quadraticCurveTo(-44, 0, -33, 23)
  p.lineTo(-14, 27)
  p.bezierCurveTo(16, 28, 42, 22, 52, 0)
}

/** Foam trail behind a moving ship: a wide fading V of white water. */
function wake(g: Draw, list: readonly { x: number; y: number; t: number }[], now: number): void {
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1]
    const b = list[i]
    if (!a || !b) continue
    const k = 1 - clamp01((now - b.t) / WAKE_T)
    g.line(a.x, a.y, b.x, b.y, alpha('#ffffff', 0.12 * k), 14 + 46 * (1 - k))
    g.line(a.x, a.y, b.x, b.y, alpha('#ffffff', 0.45 * k), 4 + 16 * k)
  }
}

/** Starboard (+1) or port (-1): the side a salvo would leave from, toward the rival. */
function firingSide(s: Ship, foe: Ship): 1 | -1 {
  const fx = Math.cos(s.a)
  const fy = Math.sin(s.a)
  return (foe.x - s.x) * -fy + (foe.y - s.y) * fx >= 0 ? 1 : -1
}

/** A faint band on the side a loaded broadside would fire, out to its range, for the human players. */
function aimGuide(g: Draw, s: Ship, foe: Ship | undefined, now: number): void {
  if (!foe || !s.alive || s.cd > 0) return
  const side = firingSide(s, foe)
  const pulse = 0.5 + 0.5 * Math.sin(now * 4)
  g.at(s.x, s.y, s.a, () => {
    const y0 = side * (HULL_HALF + 14)
    const y1 = side * (RANGE * 0.96)
    g.path(
      (c) => {
        c.moveTo(-40, y0)
        c.lineTo(40, y0)
        c.lineTo(40 + Math.abs(y1) * 0.3, y1)
        c.lineTo(-40 - Math.abs(y1) * 0.3, y1)
        c.closePath()
      },
      g.lin(0, y0, 0, y1, [
        [0, alpha(C.yellow, 0.16 + 0.08 * pulse)],
        [1, alpha(C.yellow, 0)],
      ]),
    )
  })
}

/** A toy galleon: team-coloured hull, deck, cannons on both rails, a sail that fills with speed, a flag. */
function ship(g: Draw, s: Ship, now: number, cheer: boolean, look: Look): void {
  const col = SIDE[s.side]
  const at = pose(s, look)
  const heel = look.heel[s.id] ?? 0
  const sunk = !s.alive
  const p = sunk ? clamp01((now - s.sunkT) / SINK_T) : 0
  if (sunk && p >= 1) return
  const fire = clamp01(1 - (now - s.fireT) / 0.25)
  const hurt = clamp01(1 - (now - s.hitT) / 0.2)
  const bob = Math.sin(now * 2.4 + s.id * 2) * 0.03
  const fill = clamp01(s.v / 170)
  g.shadow(at.x + 5, at.y + 10, 70 * (1 - p * 0.4), 36, sunk ? 0.25 * (1 - p) : 0.3)
  g.alpha(1 - p * 0.9, () => {
    g.at(at.x, at.y, at.a + bob + p * 0.6 + (cheer ? Math.sin(now * 6) * 0.08 : 0), () => {
      const sc = (1 - p * 0.5) * HULL_SCALE
      g.save()
      // Roll seen from above: the hull slides toward the low rail and its beam narrows;
      // it also pitches gently in the swell.
      const pitch = 1 + Math.sin(now * 2.1 + s.id * 1.3) * 0.02
      g.ctx.translate(0, heel * 26)
      g.ctx.scale(sc * pitch, sc * (1 - Math.min(0.35, Math.abs(heel) * 0.8)))
      // Cannons: three per rail, the firing side kicks back.
      for (const side of [1, -1] as const) {
        const kick = s.fireSide === side ? fire * 5 : 0
        for (const x of [-14, 4, 22]) {
          const y0 = side * (HULL_HALF + 2 - kick)
          g.rrect(x - 6, Math.min(y0, y0 + side * 12), 12, 12, 3, '#2b2733')
          g.circle(x, y0 + side * 10, 4, '#4a4555')
        }
      }
      g.path(hull, shade(col.main, -0.4))
      g.ctx.translate(0, -2)
      g.path(
        hull,
        g.lin(0, -28, 0, 28, [
          [0, shade(col.main, 0.2)],
          [1, shade(col.main, -0.25)],
        ]),
      )
      g.ctx.translate(0, 2)
      // Deck planks between cream rails.
      g.rrect(-28, -17, 62, 34, 16, WOOD)
      for (const x of [-18, -4, 10, 24]) g.line(x, -15, x, 15, alpha(WOOD_DARK, 0.5), 3)
      g.rrect(-30, -20, 64, 5, 3, CREAM)
      g.rrect(-30, 15, 64, 5, 3, CREAM)
      // Damage: small deck fires, one per lost hit point.
      for (let k = 0; k < HP - s.hp && !sunk; k++) {
        const fx = [-16, 18][k] ?? 0
        const fl = 1 + 0.25 * Math.sin(now * 25 + k * 3)
        g.circle(fx, (k ? 6 : -6) * 1, 8 * fl, C.orange)
        g.circle(fx, (k ? 6 : -6) * 1, 4 * fl, C.yellow)
      }
      // Mainsail across the mast, bellied forward by speed; foresail ahead.
      const belly = 8 + fill * 12
      g.path(
        (c) => {
          c.moveTo(-10, -30)
          c.quadraticCurveTo(-2 + belly * 1.6, 2, -10, 32)
          c.closePath()
        },
        alpha('#000000', 0.18),
      )
      g.path(
        (c) => {
          c.moveTo(-8, -31)
          c.quadraticCurveTo(belly * 1.6, -1, -8, 29)
          c.closePath()
        },
        g.lin(-8, 0, belly, 0, [
          [0, '#e6d8c0'],
          [1, CREAM],
        ]),
        alpha(WOOD_DARK, 0.35),
        2,
      )
      g.line(-8, -31, -8, 29, WOOD_DARK, 3)
      g.path((c) => {
        c.moveTo(24, -15)
        c.quadraticCurveTo(26 + belly, -1, 24, 13)
        c.closePath()
      }, '#ffeedb')
      g.circle(-8, 0, 5, WOOD_DARK)
      // Pennant at the masthead in team colour, streaming aft.
      const wave = Math.sin(now * 10 + s.id) * 3
      g.poly([-10, -2, -32, -6 + wave, -30, 2 + wave], col.light)
      // Stern mark: the side's shape (red circle, blue square).
      g.sideMark(s.side, -26, 12, 5, alpha(C.white, 0.9))
      if (hurt > 0) g.alpha(0.8 * hurt, () => g.path(hull, '#ffffff'))
      if (fire > 0)
        g.circle(4, s.fireSide * (HULL_HALF + 18), 14 * fire, alpha('#ffffff', 0.7 * fire))
      g.restore()
    })
  })
  if (sunk) {
    // Rings of foam where it went down.
    g.ring(at.x, at.y, 40 + p * 90, alpha('#ffffff', 0.5 * (1 - p)), 6)
    g.ring(at.x, at.y, 20 + p * 50, alpha('#ffffff', 0.4 * (1 - p)), 4)
    return
  }
  // Hull points, upright for the player who owns the ship; the one just lost pops away.
  const lost = (now - s.hitT) / 0.4
  g.forSide(s.side, at.x, at.y, () => {
    g.rrect(-44, -100, 88, 26, 13, alpha(C.ink, 0.7))
    for (let i = 0; i < HP; i++) {
      const x = (i - (HP - 1) / 2) * 26
      g.sideMark(s.side, x, -87, 8, i < s.hp ? col.light : alpha('#ffffff', 0.15))
      if (i === s.hp && lost < 1)
        g.alpha(1 - lost, () => g.sideMark(s.side, x, -87 - lost * 30, 8 + lost * 10, C.yellow))
    }
  })
}

/** A cannonball in flight: it arcs up and comes down, its shadow skimming the water. */
function ball(g: Draw, b: Ball, now: number, look: Look): void {
  const p = look.ballPrev.get(b.id)
  const x = p ? lerp(p.x, b.x, look.alpha) : b.x
  const y = p ? lerp(p.y, b.y, look.alpha) : b.y
  const k = clamp01((now - b.born) / BALL_LIFE)
  const h = Math.sin(Math.PI * k) * 34
  const m = Math.hypot(b.vx, b.vy) || 1
  g.circle(x + 3, y + 5, BALL_R * (1 - h / 120), alpha('#001a2e', 0.35))
  g.line(x, y - h, x - (b.vx / m) * 30, y - h * 0.8 - (b.vy / m) * 30, alpha('#ffffff', 0.35), 6)
  g.ball(x, y - h, BALL_R * (1 + h / 100), '#2d2b38', 0.9)
}

export interface View {
  names: [string, string]
  over: boolean
  /** Sides whose broadside guide is shown (the humans). */
  guides: readonly boolean[]
}

/** Sea, shores, islands, wakes, ships and cannonballs, the docks with their controls and HUD, the round banners. */
export function renderShips(g: Draw, s: State, now: number, v: View, look: Look): void {
  const w = s.w
  const r = s.rounds
  sea(g, w.t)
  for (const sh of w.ships) wake(g, look.wakes[sh.id] ?? [], w.t)
  shores(g, w.t)
  isles(g, w.isles, w.t)
  if (r.phase === 'play' && !v.over)
    for (const sh of w.ships)
      if (v.guides[sh.side])
        aimGuide(
          g,
          sh,
          w.ships.find((f) => f.alive && f.side !== sh.side),
          w.t,
        )
  const champ = v.over && r.last !== 'draw' ? r.last : null
  for (const sh of w.ships) if (!sh.alive) ship(g, sh, w.t, false, look)
  for (const sh of w.ships) if (sh.alive) ship(g, sh, w.t, champ === sh.side, look)
  for (const b of w.balls) ball(g, b, w.t, look)
  dock(g, 1)
  dock(g, 0)
  g.vignette(0.3)
  // Online, each phone shows only its own player's stick and button.
  for (const c of s.ctl) if (g.viewer === null || c.side === g.viewer) drawControl(g, c)
  for (const side of [0, 1] as const) {
    namePill(g, side, v.names[side], { inset: 44, active: champ === side })
    // Above the pill, between stick and fire button (the edge corner sits under the button).
    pips(g, side, r.wins[side], r.target, { inset: 122, x: W / 2 })
  }
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
    // Pops in, then fades as the ships get under way.
    const k = now - r.at
    const size = 64 * outBack(Math.min(1, k / 0.3))
    banner(g, undefined, `Round ${r.round}`, MID, { size, alpha: Math.min(1, (1.1 - k) / 0.3) })
  }
}
