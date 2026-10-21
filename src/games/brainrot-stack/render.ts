import { outBack, outCubic } from '../../core/fx/ease.ts'
import type { Mode, Side } from '../../core/game.ts'
import { namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { type BodySnap, drawShape, extent, type Shape } from '../../engines/ragdoll/index.ts'
import { ISLAND, PIECES, shapeOf, towerTop } from './rules.ts'

/** Rotate button per side, in fixed world coords (the host hit-tests the guest's touches against these). */
export const ROTATE_BTN: [
  { x: number; y: number; r: number },
  { x: number; y: number; r: number },
] = [
  { x: W - 120, y: 1630, r: 66 },
  { x: 120, y: 170, r: 66 },
]
const NEXT_AT: [{ x: number; y: number }, { x: number; y: number }] = [
  { x: 120, y: 1630 },
  { x: W - 120, y: 170 },
]

export interface SceneView {
  bodies: BodySnap[]
  piece: number
  next: number
  hx: number
  ha: number
  hoverY: number
  showHover: boolean
  cam: number
  rot: number
  turn: Side
  n: number
  time: number
  names: [string, string]
  bots: [boolean, boolean]
  mode: Mode
  over: boolean
  loading: boolean
  aiming: boolean
  glyph: string
  /** Game time the current piece was let go (-1 while hovering): drives the hook's release. */
  dropAt: number
  dropY: number
  /** Game time the tower fell (-1 while it stands) and who toppled it. */
  fellAt: number
  loser: Side | null
}

const SEA_Y = ISLAND.top + 330
const SLIME = '#9dff5e'
/** Little floating props that drift past the tower: pure brain-rot wallpaper. */
const PROPS = ['🧠', '🌀', '🫧', '✨', '🌈', '🫠', '💫', '🧃'] as const

// ---------- the world (scene coordinates, turning with the camera) ----------

/** Neon dusk at the foot of the tower, deep space higher up: the table stays dark. */
function sky(g: Draw, cam: number, time: number): void {
  const alt = Math.min(1.6, cam / 1400)
  const pick = (low: string, high: string) => mix(low, high, Math.min(1, alt / 1.2))
  g.rect(
    -1000,
    -1000,
    W + 2000,
    1800 + 2000,
    g.lin(0, 0, 0, 1800, [
      [0, pick('#2a1260', '#0b0820')],
      [0.6, pick('#5a1f7a', '#1c0f45')],
      [1, pick('#c2407e', '#3b1c6b')],
    ]),
  )
  // A slow sunburst from a hazy disc behind the tower.
  const cx = W / 2
  const cy = ISLAND.top - 820 + cam * 0.2
  g.alpha(0.07, () => {
    for (let i = 0; i < 16; i++) {
      const a0 = time * 0.08 + (i * Math.PI * 2) / 16
      const a1 = a0 + Math.PI / 16
      g.poly(
        [
          cx,
          cy,
          cx + Math.cos(a0) * 2400,
          cy + Math.sin(a0) * 2400,
          cx + Math.cos(a1) * 2400,
          cy + Math.sin(a1) * 2400,
        ],
        '#ffd1f0',
      )
    }
  })
  g.circle(
    cx,
    cy,
    420,
    g.rad(cx, cy, 60, 420, [
      [0, alpha('#ffb3e1', 0.55)],
      [0.45, alpha('#ff6fb5', 0.18)],
      [1, alpha('#ff6fb5', 0)],
    ]),
  )
  g.circle(
    cx,
    cy,
    130,
    g.lin(0, cy - 130, 0, cy + 130, [
      [0, alpha('#ffe9a8', 0.55)],
      [1, alpha('#ff6fb5', 0.45)],
    ]),
  )
  for (let i = 0; i < 4; i++)
    g.rect(cx - 140, cy + 24 + i * 28, 280, 8 + i * 3, alpha('#4a1a6e', 0.8))
  // Stars, brighter the higher the tower gets.
  g.alpha(0.35 + Math.min(0.65, alt), () => {
    for (let i = 0; i < 60; i++) {
      const x = ((i * 157) % (W + 400)) - 200
      const y = ((i * 271) % 1300) - 150
      const tw = 0.5 + 0.5 * Math.sin(time * 2 + i)
      g.circle(x, y, 2.5 + (i % 3), alpha('#ffffff', 0.3 + tw * 0.6))
    }
  })
}

/** Floating props, parallax slower than the tower. */
function props(g: Draw, cam: number, time: number): void {
  for (let i = 0; i < PROPS.length; i++) {
    const glyph = PROPS[i] ?? '✨'
    const y = ISLAND.top - 300 - i * 430 + cam * 0.45 + Math.sin(time * 0.9 + i) * 18
    const x = ((i * 389) % 820) + 90 + Math.sin(time * 0.5 + i * 2) * 26
    g.alpha(0.55, () => g.emoji(glyph, x, y, 84 + (i % 3) * 14, Math.sin(time + i) * 0.25))
  }
}

/** Slime sea: glowing lime at the top, deep green below, blobs breaking the surface. */
function sea(g: Draw, time: number): void {
  g.rect(
    -1000,
    SEA_Y - 40,
    W + 2000,
    80,
    g.lin(0, SEA_Y - 40, 0, SEA_Y + 40, [
      [0, alpha(SLIME, 0)],
      [1, alpha(SLIME, 0.35)],
    ]),
  )
  g.path(
    (c) => {
      c.moveTo(-1000, SEA_Y + 3000)
      c.lineTo(-1000, SEA_Y)
      for (let x = -200; x <= W + 200; x += 40)
        c.lineTo(x, SEA_Y + Math.sin(time * 2 + x * 0.015) * 10)
      c.lineTo(W + 1000, SEA_Y)
      c.lineTo(W + 1000, SEA_Y + 3000)
      c.closePath()
    },
    g.lin(0, SEA_Y, 0, SEA_Y + 700, [
      [0, SLIME],
      [0.25, '#3fcf5a'],
      [1, '#0f4a2a'],
    ]),
  )
  for (let row = 0; row < 4; row++) {
    const y = SEA_Y + 40 + row * 70
    const off = Math.sin(time * 1.5 + row) * 30
    for (let x = -200 + off + (row % 2) * 60; x < W + 200; x += 120) {
      g.arc(x, y, 24, Math.PI * 1.15, Math.PI * 1.85, alpha('#ffffff', 0.45 - row * 0.09), 6)
    }
  }
  // Slime bubbles popping.
  for (let i = 0; i < 6; i++) {
    const t = (time * 0.6 + i * 0.37) % 1
    const x = ((i * 233) % 900) + 50
    g.alpha(1 - t, () =>
      g.circle(x, SEA_Y + 20 - t * 30, 8 + t * 14, undefined, alpha('#eaffd6', 0.8), 4),
    )
  }
}

/** A lumpy violet plinth with a slime cap. */
function island(g: Draw): void {
  const { x, top, w } = ISLAND
  g.poly(
    [
      x - w / 2,
      top + 20,
      x + w / 2,
      top + 20,
      x + w / 2 - 70,
      top + 170,
      x + 60,
      top + 360,
      x - 90,
      top + 330,
      x - w / 2 + 60,
      top + 160,
    ],
    '#3a1f66',
  )
  g.poly(
    [
      x - w / 2 + 30,
      top + 60,
      x + w / 2 - 30,
      top + 60,
      x + w / 2 - 90,
      top + 150,
      x - w / 2 + 80,
      top + 140,
    ],
    '#5a33a0',
  )
  // Crystals sticking out of the rock.
  for (const [cx, cy, s] of [
    [x - 150, top + 150, 1],
    [x + 120, top + 200, 0.8],
    [x - 20, top + 280, 0.7],
  ] as const) {
    g.poly([cx - 18 * s, cy, cx, cy - 46 * s, cx + 18 * s, cy, cx, cy + 20 * s], '#c6a6ff')
    g.poly([cx, cy - 46 * s, cx + 18 * s, cy, cx, cy + 20 * s], '#9d6bff')
  }
  g.rrect(x - w / 2, top, w, ISLAND.h, 18, '#24123f')
  g.rrect(x - w / 2, top - 6, w, 40, 18, SLIME)
  g.rrect(x - w / 2 + 10, top - 2, w - 20, 10, 5, alpha('#ffffff', 0.45))
  // Slime drips over the rim.
  for (const [dx, len] of [
    [-230, 40],
    [-120, 26],
    [40, 52],
    [190, 30],
  ] as const) {
    g.rrect(x + dx - 10, top + 20, 20, len, 10, SLIME)
    g.circle(x + dx, top + 20 + len, 12, SLIME)
  }
}

/**
 * A cast member: the glossy block (its hitbox) with the emoji printed big on it,
 * stretched along the block for the long and the tall ones.
 */
export function drawPiece(
  g: Draw,
  k: number,
  x: number,
  y: number,
  a: number,
  o: { ghost?: boolean; glow?: string } = {},
): void {
  const p = PIECES[k]
  if (!p) return
  const s: Shape = p.shape
  const { hw, hh } = extent(s)
  if (o.glow) {
    g.at(x, y, a, () => {
      g.alpha(0.35, () =>
        g.rrect(-hw - 14, -hh - 14, hw * 2 + 28, hh * 2 + 28, Math.min(hw, hh), o.glow),
      )
    })
  }
  drawShape(g, s, x, y, a, p.color, undefined, o.ghost ? { ghost: true } : {})
  const base = Math.min(hw, hh) * 1.7
  const sx = Math.min(2.1, Math.max(1, hw / hh))
  const sy = Math.min(1.8, Math.max(1, hh / hw))
  g.alpha(o.ghost ? 0.5 : 1, () => g.emoji(p.glyph, x, y, base, a, sx, sy))
}

function hover(g: Draw, v: SceneView): void {
  const k = v.piece
  const bob = v.aiming ? 0 : Math.sin(v.time * 3) * 8
  const y = v.hoverY + bob
  const { hh } = extent(shapeOf(k))
  const col = SIDE[v.turn]
  // Drop guide down to the tower.
  g.dashed(v.hx, y + hh + 16, v.hx, towerTop(v.bodies) - 6, alpha(C.yellow, 0.6), 6, [18, 16])
  // The team's claw holding the piece.
  g.line(v.hx, y - hh - 260, v.hx, y - hh - 24, alpha('#ffffff', 0.35), 8)
  g.rrect(v.hx - 34, y - hh - 34, 68, 24, 12, col.main)
  g.line(v.hx - 28, y - hh - 16, v.hx - 36, y - hh + 8, col.dark, 10)
  g.line(v.hx + 28, y - hh - 16, v.hx + 36, y - hh + 8, col.dark, 10)
  drawPiece(g, k, v.hx, y, v.ha, { glow: C.yellow })
}

/** Just after a drop the empty claw springs open and swings back up. */
function claw(g: Draw, v: SceneView): void {
  if (v.dropAt < 0) return
  const t = v.time - v.dropAt
  if (t > 0.8) return
  const col = SIDE[v.turn]
  const y = v.dropY - extent(shapeOf(v.piece)).hh - 34 - outCubic(t / 0.8) * 200
  const open = 10 + 26 * outBack(Math.min(1, t / 0.2))
  g.alpha(1 - t / 0.8, () => {
    g.rrect(v.hx - 34, y, 68, 24, 12, col.main)
    g.line(v.hx - 28, y + 18, v.hx - 28 - open, y + 40, col.dark, 10)
    g.line(v.hx + 28, y + 18, v.hx + 28 + open, y + 40, col.dark, 10)
  })
}

/** The tower's height: a measuring pole beside the island with a flag at the top piece. */
function pennant(g: Draw, v: SceneView): void {
  if (v.n < 1 || v.fellAt >= 0) return
  const top = Math.min(ISLAND.top - 60, towerTop(v.bodies) + 20)
  const x = ISLAND.x + ISLAND.w / 2 + 70
  g.rrect(x - 5, top, 10, ISLAND.top + 20 - top, 5, alpha('#ffffff', 0.25))
  for (let y = ISLAND.top - 100; y > top; y -= 100)
    g.rect(x - 12, y - 2, 24, 4, alpha('#ffffff', 0.3))
  g.poly([x, top - 6, x + 104, top + 22, x, top + 50], SIDE[v.turn].main)
  g.text(`×${v.n}`, x + 40, top + 22, { size: 36, weight: 700, color: C.white })
}

// ---------- HUD (world coordinates, at the players' edges) ----------

function rotateButton(g: Draw, side: Side, at: { x: number; y: number; r: number }): void {
  const col = SIDE[side]
  g.circle(at.x, at.y + 12, at.r, col.dark)
  g.circle(
    at.x,
    at.y,
    at.r,
    g.rad(
      at.x,
      at.y,
      at.r * 0.1,
      at.r,
      [
        [0, shade(col.main, 0.3)],
        [1, col.main],
      ],
      at.x - at.r * 0.3,
      at.y - at.r * 0.4,
    ),
  )
  g.forSide(side, at.x, at.y, () => {
    g.arc(0, 0, at.r * 0.45, -Math.PI * 0.2, Math.PI * 1.35, '#ffffff', 10)
    const a = Math.PI * 1.35
    const ex = Math.cos(a) * at.r * 0.45
    const ey = Math.sin(a) * at.r * 0.45
    g.poly([ex - 16, ey + 2, ex + 14, ey - 10, ex + 6, ey + 18], '#ffffff')
  })
}

function nextPreview(g: Draw, side: Side, k: number, at: { x: number; y: number }): void {
  const p = PIECES[k]
  if (!p) return
  g.forSide(side, at.x, at.y, () => {
    g.rrect(-74, -74, 148, 148, 34, alpha(C.ink, 0.72))
    g.rrect(-74, -74, 148, 148, 34, undefined, alpha('#ffffff', 0.15), 3)
    g.text('next', 0, -46, { size: 34, weight: 600, color: alpha('#ffffff', 0.8) })
    g.emoji(p.glyph, 0, 16, 64)
  })
}

/** The fall: a "Toppled!" stamp for whoever knocked it over, upright for them. */
function toppled(g: Draw, v: SceneView): void {
  if (v.fellAt < 0 || v.loser === null) return
  const t = v.time - v.fellAt
  const s = outBack(Math.min(1, t / 0.35))
  const a = Math.min(1, t * 6)
  const draw = (side: Side | undefined, y: number) =>
    g.forSide(side, W / 2, y, () =>
      g.alpha(a, () =>
        g.at(
          0,
          0,
          -0.1,
          () => {
            const label = 'Toppled!'
            const w = g.measure(label, 84, 700) + 200
            g.rrect(-w / 2, -72, w, 144, 48, shade(SIDE[v.loser ?? 0].main, -0.45))
            g.rrect(-w / 2, -72, w, 144, 48, undefined, C.yellow, 8)
            g.emoji('🫠', -w / 2 + 80, 0, 92)
            g.text(label, 60, 4, {
              size: 84,
              weight: 700,
              color: C.white,
              drop: alpha('#000', 0.35),
            })
          },
          s,
        ),
      ),
    )
  if (v.mode === '2p') draw(v.loser, v.loser === 0 ? MID + 280 : MID - 280)
  else draw(undefined, MID - 280)
}

export function drawScene(g: Draw, v: SceneView): void {
  const c = g.ctx
  c.save()
  c.translate(W / 2, MID)
  c.rotate(v.rot)
  c.translate(-W / 2, -MID)
  sky(g, v.cam, v.time)
  c.translate(0, v.cam)
  props(g, v.cam, v.time)
  sea(g, v.time)
  island(g)
  for (const b of v.bodies) drawPiece(g, b.k, b.x, b.y, b.a)
  pennant(g, v)
  if (v.showHover) hover(g, v)
  else claw(g, v)
  c.restore()

  // HUD at the players' edges, outside the turning scene.
  for (const side of [0, 1] as Side[]) {
    const active = !v.over && v.fellAt < 0 && v.showHover && v.turn === side
    const bot = v.bots[side]
    const text = active
      ? bot
        ? 'Thinking…'
        : v.mode === 'online' || v.mode === '1p'
          ? 'Your turn'
          : 'Drag, then let go'
      : undefined
    namePill(g, side, v.names[side], text ? { active, text } : { active })
  }
  const side = v.mode === '1p' ? 0 : v.turn
  if (!v.over && v.showHover && !v.bots[v.turn]) {
    rotateButton(g, side, ROTATE_BTN[side])
    nextPreview(g, side, v.next, NEXT_AT[side])
  }
  toppled(g, v)
  if (v.loading) g.both('Loading…', { size: 48, color: shade(C.white, -0.2) })
}
