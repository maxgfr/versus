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

/** Stone faces per half: cool slate toward blue's end, warm plum toward red's. */
const FACE: [[string, string], [string, string]] = [
  ['#47304f', '#3f2a47'],
  ['#2c3a66', '#27345c'],
]

function floor(g: Draw, warn: Float32Array, h: Float32Array, now: number): void {
  const w = COLS * TILE
  const ht = ROWS * TILE
  g.fillView('#14101f')
  drawStrip(g, Y0, Y0 + ht)
  // The floor is a sunken pit: a dark bezel, then an inner shadow along its top edge.
  g.rrect(X0 - 14, Y0 - 14, w + 28, ht + 34, 28, '#0b0814')
  g.rect(X0, Y0, w, ht, '#100c1c')
  g.rrect(X0 - 14, Y0 - 14, w + 28, ht + 28, 28, undefined, alpha(C.white, 0.1), 4)
  for (let i = 0; i < COLS * ROWS; i++) {
    const x = cellX(i)
    const y = cellY(i)
    const c = i % COLS
    const r = Math.floor(i / COLS)
    const half = r < ROWS / 2 ? 1 : 0
    const wv = warn[i] ?? 0
    const hv = h[i] ?? 0
    const up = hv > 0.02
    const face = FACE[half][(c + r) % 2] as string
    if (up || wv > 0) {
      // A steel trap plate, heating up as the spikes near and glowing hot while they are out.
      const heat = up ? Math.min(1, hv) : 0.35 + 0.65 * wv
      const pulse = 0.5 + 0.5 * Math.sin(now * (8 + wv * 26))
      if (heat > 0.3)
        g.rrect(x - 4, y - 4, TILE + 8, TILE + 8, 20, alpha(C.red, 0.18 * heat + 0.12 * pulse * wv))
      g.rrect(x + 4, y + 6, TILE - 8, TILE - 8, 12, shade(STEEL, -0.5))
      g.rrect(
        x + 4,
        y + 2,
        TILE - 8,
        TILE - 10,
        12,
        g.lin(0, y + 2, 0, y + TILE - 8, [
          [0, shade(STEEL, 0.15)],
          [1, shade(STEEL, -0.2)],
        ]),
      )
      g.rrect(
        x + 4,
        y + 2,
        TILE - 8,
        TILE - 10,
        12,
        alpha(up ? '#ff3b30' : C.red, 0.25 + 0.45 * heat),
      )
      // Hazard chevrons scored into the plate while it is armed.
      g.clip(x + 4, y + 2, TILE - 8, TILE - 10, 12, () => {
        for (let k = -1; k < 4; k++) {
          const sx = x + k * 34 + ((now * 60) % 34)
          g.poly(
            [sx, y, sx + 16, y, sx - 34 + 16, y + TILE, sx - 34, y + TILE],
            alpha('#000000', 0.16),
          )
        }
      })
      // The holes the spikes come out of glow from below.
      for (const [dx, dy] of HOLES) {
        g.ellipse(x + 50 + dx, y + 52 + dy, 9, 5, '#14070a')
        g.ellipse(
          x + 50 + dx,
          y + 52 + dy,
          6,
          3,
          alpha(C.orange, 0.35 + 0.6 * heat * (up ? 1 : pulse)),
        )
      }
      g.rrect(
        x + 5,
        y + 3,
        TILE - 10,
        TILE - 12,
        11,
        undefined,
        alpha(up ? '#ff6b5e' : '#ffb199', 0.5 + 0.5 * (up ? 1 : wv * pulse)),
        up ? 6 : 5,
      )
    } else {
      // A raised stone slab: dark lip, lit face, a soft top sheen and a team tint.
      g.rrect(x + 4, y + 8, TILE - 8, TILE - 8, 12, shade(face, -0.5))
      g.rrect(
        x + 4,
        y + 3,
        TILE - 8,
        TILE - 10,
        12,
        g.lin(0, y + 3, 0, y + TILE - 7, [
          [0, shade(face, 0.14)],
          [1, shade(face, -0.12)],
        ]),
      )
      g.rrect(x + 10, y + 7, TILE - 20, 10, 5, alpha(C.white, 0.1))
      // A few worn chips so the floor is not a flat grid.
      if ((i * 7) % 5 === 0)
        g.ellipse(x + 28 + ((i * 13) % 40), y + 60, 7, 4, alpha('#000000', 0.22))
      if ((i * 11) % 7 === 0) g.line(x + 62, y + 34, x + 74, y + 52, alpha('#000000', 0.2), 3)
    }
    // Telegraph: tips peek out of the holes just before they fire.
    if (wv > 0.6) {
      const k = (wv - 0.6) / 0.4
      for (const [dx, dy] of HOLES)
        g.poly(
          [
            x + 50 + dx - 7,
            y + 52 + dy,
            x + 50 + dx + 7,
            y + 52 + dy,
            x + 50 + dx,
            y + 52 + dy - 16 * k,
          ],
          '#eef1fa',
        )
    }
  }
  // Floodlight from above the middle of the table, dark toward the corners.
  g.rect(
    X0,
    Y0,
    w,
    ht,
    g.rad(W / 2, MID, 120, ht * 0.62, [
      [0, 'rgba(255,240,210,0.06)'],
      [1, 'rgba(0,0,0,0.3)'],
    ]),
  )
  g.rect(
    X0,
    Y0,
    w,
    26,
    g.lin(0, Y0, 0, Y0 + 26, [
      [0, 'rgba(0,0,0,0.45)'],
      [1, 'rgba(0,0,0,0)'],
    ]),
  )
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
      g.ellipse(sx + 5, base + 2, 13, 5, alpha('#000000', 0.45))
      g.poly(
        [sx - 12, base, sx + 12, base, sx, top],
        g.lin(sx - 12, base, sx + 12, base, [
          [0, '#6b7396'],
          [0.42, '#ffffff'],
          [1, '#4b5274'],
        ]),
        alpha('#000000', 0.55),
        2,
      )
      // Blood-red tips while they hurt.
      if (hurt) g.poly([sx - 5, top + 14, sx + 5, top + 14, sx, top], '#ff3b4a')
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
  // Compact and tucked into the corner, clear of the stick that floats above it.
  const x = side === 0 ? 108 : W - 108
  const y = hudY(g, side)
  const lost = t - p.hit
  g.forSide(side, x, y, () => {
    g.rrect(-88, -31, 176, 62, 31, alpha(C.ink, 0.8))
    for (let i = 0; i < HP; i++) {
      const hx = (i - (HP - 1) / 2) * 50
      if (i < p.hp) {
        const beat = 1 + 0.08 * Math.sin(t * 6 + i)
        g.at(hx, 0, 0, () => heart(g, 0, 0, 18, SIDE[side].main), beat)
        g.ellipse(hx - 7, -8, 5, 3, alpha('#ffffff', 0.6), -0.5)
      } else {
        heart(g, hx, 0, 18, alpha('#ffffff', 0.08), alpha('#ffffff', 0.25))
        if (i === p.hp && lost >= 0 && lost < 0.45) {
          const k = lost / 0.45
          g.alpha(1 - k, () => g.at(hx, -k * 30, 0, () => heart(g, 0, 0, 18, C.white), 1 + k * 0.8))
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
    g.rrect(-124, -27, 248, 54, 27, alpha(C.ink, 0.72))
    g.text(`Wave ${lv}`, -50, 2, { size: 34, weight: 700, color: alpha(C.white, 0.9) })
    const sec = Math.floor(t)
    g.text(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, 64, 2, {
      size: 34,
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
