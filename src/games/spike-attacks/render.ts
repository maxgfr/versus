import { hudY, namePill, pips } from '../../core/hud.ts'
import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { clamp, outBack } from '../../core/fx/ease.ts'
import { drawStrip } from '../../engines/arena/index.ts'
import { MID, W } from '../../core/stage.ts'
import type { State } from './index.ts'
import {
  BLOB_R,
  COLS,
  cellX,
  cellY,
  type Fighter,
  type Floor,
  HP,
  INVULN,
  levelAt,
  ROWS,
  spikeAt,
  TILE,
  X0,
  Y0,
} from './rules.ts'

/** A stick as the online guest needs to draw it. */
export interface StickLook {
  side: Side
  bx: number
  by: number
  kx: number
  ky: number
  r: number
  on: boolean
}

const SPIKE_H = 70
const STEEL = '#59607e'

/** Each tile's spike height and telegraph (0..1), worked out once per frame. */
function tileStates(f: Floor): { h: Float32Array; warn: Float32Array } {
  const h = new Float32Array(COLS * ROWS)
  const warn = new Float32Array(COLS * ROWS)
  for (const p of f.pats)
    for (const i of p.cells) {
      const st = spikeAt([p], i, f.t)
      h[i] = Math.max(h[i] ?? 0, st.h)
      warn[i] = Math.max(warn[i] ?? 0, st.warn)
    }
  return { h, warn }
}

function floor(g: Draw, warn: Float32Array, h: Float32Array, now: number): void {
  const w = COLS * TILE
  const ht = ROWS * TILE
  g.fillView('#14101f')
  drawStrip(g, Y0, Y0 + ht)
  // Bezel round the floor.
  g.rrect(X0 - 14, Y0 - 14, w + 28, ht + 34, 28, '#0b0814')
  g.rrect(X0 - 14, Y0 - 14, w + 28, ht + 28, 28, undefined, alpha(C.white, 0.08), 4)
  for (let i = 0; i < COLS * ROWS; i++) {
    const x = cellX(i)
    const y = cellY(i)
    const c = i % COLS
    const r = Math.floor(i / COLS)
    const tint = r < ROWS / 2 ? SIDE[1].main : SIDE[0].main
    const wv = warn[i] ?? 0
    const up = (h[i] ?? 0) > 0.02
    const face = (c + r) % 2 === 0 ? '#353c63' : '#2f3558'
    // Grout, then a raised stone slab; spiked slabs are steel plates.
    g.rect(x, y, TILE, TILE, '#191629')
    if (up || wv > 0) {
      g.rrect(x + 4, y + 4, TILE - 8, TILE - 8, 12, shade(STEEL, -0.35))
      g.rrect(x + 4, y + 2, TILE - 8, TILE - 10, 12, STEEL)
      // The holes the spikes come out of.
      for (const [dx, dy] of HOLES) g.ellipse(x + 50 + dx, y + 52 + dy, 8, 4, '#1b1d2b')
    } else {
      g.rrect(x + 4, y + 6, TILE - 8, TILE - 8, 12, shade(face, -0.35))
      g.rrect(x + 4, y + 3, TILE - 8, TILE - 10, 12, face)
      g.rrect(x + 4, y + 3, TILE - 8, TILE - 10, 12, alpha(tint, 0.07))
      g.rrect(x + 10, y + 7, TILE - 20, 8, 4, alpha(C.white, 0.06))
    }
    // Telegraph: the slab glows red and quickens as the spikes near.
    if (wv > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(now * (8 + wv * 26))
      g.rrect(
        x + 4,
        y + 2,
        TILE - 8,
        TILE - 10,
        12,
        alpha(C.red, 0.18 + wv * 0.3 + pulse * 0.2 * wv),
      )
      g.rrect(
        x + 6,
        y + 4,
        TILE - 12,
        TILE - 14,
        10,
        undefined,
        alpha('#ff8f8f', 0.45 + 0.5 * wv * pulse),
        5,
      )
      // Tips peek out of the holes just before they fire.
      if (wv > 0.6) {
        const k = (wv - 0.6) / 0.4
        for (const [dx, dy] of HOLES)
          g.poly(
            [
              x + 50 + dx - 6,
              y + 52 + dy,
              x + 50 + dx + 6,
              y + 52 + dy,
              x + 50 + dx,
              y + 52 + dy - 12 * k,
            ],
            '#dfe3f2',
          )
      }
    }
  }
}

/** Spike positions on a tile (back row first so the front row overlaps it). */
const HOLES: [number, number][] = [
  [-26, -18],
  [0, -18],
  [26, -18],
  [-13, 12],
  [13, 12],
]

/** Spikes on risen tiles: shiny steel cones, red-tipped while they hurt. */
function spikes(g: Draw, h: Float32Array): void {
  for (let i = 0; i < COLS * ROWS; i++) {
    const hgt = h[i] ?? 0
    if (hgt < 0.02) continue
    const cx = cellX(i) + TILE / 2
    const cy = cellY(i) + 52
    const hurt = hgt >= 0.6
    // Overshoot as they slam up.
    const k = hgt >= 1 ? 1 : outBack(hgt)
    for (const [dx, dy] of HOLES) {
      const sx = cx + dx
      const base = cy + dy
      const top = base - SPIKE_H * k * (dy < 0 ? 0.8 : 1)
      g.ellipse(sx + 4, base + 2, 12, 5, alpha('#000000', 0.35))
      g.poly(
        [sx - 11, base, sx + 11, base, sx, top],
        g.lin(sx - 11, base, sx + 11, base, [
          [0, '#7d86a8'],
          [0.45, '#ffffff'],
          [1, '#5f6788'],
        ]),
        alpha('#000000', 0.45),
        2,
      )
      if (hurt) g.circle(sx, top + 2, 3.5, C.red)
    }
  }
}

function heart(
  g: Draw,
  x: number,
  y: number,
  s: number,
  fill: string,
  edge = shade(fill, -0.5),
): void {
  g.path(
    (c) => {
      c.moveTo(x, y + s * 0.75)
      c.bezierCurveTo(x - s * 1.25, y + s * 0.05, x - s * 0.7, y - s * 0.95, x, y - s * 0.35)
      c.bezierCurveTo(x + s * 0.7, y - s * 0.95, x + s * 1.25, y + s * 0.05, x, y + s * 0.75)
    },
    fill,
    edge,
    3,
  )
}

/** A player's hearts by their name pill; the one just lost bursts and fades. */
function hearts(g: Draw, side: Side, p: Fighter, t: number): void {
  const x = side === 0 ? 128 : W - 128
  const y = hudY(g, side)
  const lost = t - p.hit
  g.forSide(side, x, y, () => {
    g.rrect(-100, -36, 200, 72, 36, alpha(C.ink, 0.75))
    for (let i = 0; i < HP; i++) {
      const hx = (i - (HP - 1) / 2) * 58
      if (i < p.hp) {
        const beat = 1 + 0.08 * Math.sin(t * 6 + i)
        g.at(hx, 0, 0, () => heart(g, 0, 0, 20, SIDE[side].main), beat)
        g.ellipse(hx - 7, -8, 5, 3, alpha('#ffffff', 0.6), -0.5)
      } else {
        heart(g, hx, 0, 20, alpha('#ffffff', 0.08), alpha('#ffffff', 0.25))
        if (i === p.hp && lost >= 0 && lost < 0.45) {
          const k = lost / 0.45
          g.alpha(1 - k, () => g.at(hx, -k * 30, 0, () => heart(g, 0, 0, 20, C.white), 1 + k * 0.8))
        }
      }
    }
  })
}

/** Survival clock and the current wave, above the name pill. */
function wave(g: Draw, side: Side, t: number): void {
  const lv = levelAt(t) + 1
  const y = hudY(g, side, 150)
  g.forSide(side, W / 2, y, () => {
    g.rrect(-110, -24, 220, 48, 24, alpha(C.ink, 0.7))
    g.text(`Wave ${lv}`, -46, 2, { size: 34, weight: 700, color: alpha(C.white, 0.9) })
    const sec = Math.floor(t)
    g.text(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, 56, 2, {
      size: 30,
      weight: 600,
      color: alpha(C.white, 0.6),
    })
  })
}

function blob(g: Draw, p: Fighter, side: Side, f: Floor, now: number, won: boolean): void {
  const col = SIDE[side]
  const r = BLOB_R * 1.25
  const dead = p.died >= 0
  const k = dead ? Math.min(1, (f.t - p.died) / 0.6) : 0
  const hurtNow = !dead && f.t - p.hit < 0.3
  const blink = !dead && f.t - p.hit < INVULN && Math.floor(now * 12) % 2 === 0
  const sp = Math.hypot(p.vx, p.vy) || 1
  const look: [number, number] = sp > 20 ? [p.vx / sp, p.vy / sp] : [0, 0.2]
  const squash = 1 + Math.sin(p.walk * 0.2) * 0.06
  const hop = won ? Math.abs(Math.sin(now * 7)) * 24 : 0
  // Jolt upwards when hit.
  const jolt = hurtNow ? Math.sin(((f.t - p.hit) / 0.3) * Math.PI) * 26 : 0
  g.shadow(p.x + 5, p.y + 14, r * 1.0, r * 0.45, 0.4 * (dead ? 0.5 : 1))
  g.alpha(dead ? 1 - k * 0.85 : blink ? 0.4 : 1, () => {
    g.blob(p.x, p.y - k * 40 - jolt - hop, r, col.main, {
      mood: dead ? 'dizzy' : hurtNow ? 'wow' : won ? 'grin' : 'happy',
      look: dead ? [0, 0] : look,
      sx: dead ? 1 + 0.5 * k : hurtNow ? 1.15 : squash,
      sy: dead ? 1 - 0.6 * k : hurtNow ? 0.85 : 1 / squash,
    })
  })
  if (!dead)
    g.forSide(side, p.x, p.y - jolt - hop, () => g.sideMark(side, 0, -r * 1.55, 9, col.light))
  if (hurtNow) g.ring(p.x, p.y, r * 1.3, alpha(C.red, 0.8), 6)
}

function stick(g: Draw, c: StickLook): void {
  const col = SIDE[c.side]
  g.alpha(c.on ? 0.95 : 0.6, () => {
    g.circle(c.bx, c.by, c.r, alpha(col.dark, 0.5), alpha(col.light, 0.55), 5)
    g.circle(c.bx, c.by, c.r * 0.55, undefined, alpha(col.light, 0.18), 4)
    g.ball(c.kx, c.ky, c.r * 0.46, col.main, 0.6)
  })
}

/** A big word that pops in for both players (two copies in local 2P), stamped by state time. */
function stamp(g: Draw, title: string, sub: string, age: number, color: string, y = MID): void {
  if (age < 0) return
  const k = outBack(clamp(age / 0.34, 0, 1))
  const one = (angle: number, cy: number) =>
    g.at(W / 2, cy, angle, () =>
      g.at(
        0,
        0,
        -0.05 * (1 - k),
        () => {
          const tw = Math.max(g.measure(title, 92, 700), g.measure(sub, 38, 600)) + 110
          const h = sub ? 190 : 150
          g.rrect(-tw / 2, -h / 2 + 8, tw, h, 44, alpha('#000000', 0.4))
          g.rrect(-tw / 2, -h / 2, tw, h, 44, alpha(C.ink, 0.92))
          g.rrect(-tw / 2, -h / 2, tw, h, 44, undefined, alpha(color, 0.9), 6)
          g.text(title, 0, sub ? -22 : 4, {
            size: 92,
            weight: 700,
            color,
            drop: alpha('#000000', 0.45),
            maxWidth: 820,
          })
          if (sub)
            g.text(sub, 0, 52, {
              size: 38,
              weight: 600,
              color: alpha(C.white, 0.85),
              maxWidth: 820,
            })
        },
        k,
      ),
    )
  g.alpha(clamp(age * 6, 0, 1), () => {
    if (g.flipTop) {
      one(0, y + 150)
      one(Math.PI, y - 150)
    } else one(g.orient(), y)
  })
}

export function renderSpikes(
  g: Draw,
  s: State,
  now: number,
  names: [string, string],
  over: boolean,
): void {
  const f = s.f
  const r = s.rounds
  const { h, warn } = tileStates(f)
  floor(g, warn, h, now)
  // The blob nearer the bottom is drawn last (it stands in front).
  const order = ([0, 1] as Side[]).sort((a, b) => f.fighters[a].y - f.fighters[b].y)
  const won = (side: Side) => (r.phase === 'between' || over) && r.last === side
  spikes(g, h)
  for (const side of order) blob(g, f.fighters[side], side, f, now, won(side))
  for (const st of s.sticks) stick(g, st)
  for (const side of [0, 1] as Side[]) {
    namePill(g, side, names[side], { active: won(side) })
    hearts(g, side, f.fighters[side], f.t)
    pips(g, side, r.wins[side], r.target, { x: side === 0 ? W - 130 : 130 })
    if (r.phase === 'play') wave(g, side, f.t)
  }
  if (r.phase === 'play') {
    if (now - r.at < 1.3 && f.t < 1.3) {
      const a = 1 - clamp((now - r.at - 0.95) / 0.35, 0, 1)
      g.alpha(a, () =>
        stamp(g, r.round > 1 ? `Round ${r.round}` : 'Dodge!', '', now - r.at, C.white),
      )
    }
    return
  }
  const last = r.last
  const col = last === 0 || last === 1 ? SIDE[last].light : C.white
  const sub =
    last === 'draw' || last === null
      ? 'Both spiked: draw'
      : over
        ? `${names[last]} wins the match`
        : `${names[last]} is still standing`
  stamp(g, 'Spiked!', sub, now - r.at - 0.35, col)
}
