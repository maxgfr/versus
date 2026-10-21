import { EMOJI_FONT } from './palette.ts'

/**
 * Emoji glyphs rasterised once into offscreen canvases. Drawing text glyphs every
 * frame is slow (and colour emoji especially so on iOS); blitting a cached bitmap
 * is cheap. Sizes are bucketed so a glyph drawn at 40 and 44 shares one bitmap.
 */
const cache = new Map<string, HTMLCanvasElement>()

function bucket(px: number): number {
  if (px <= 32) return 32
  if (px <= 64) return 64
  if (px <= 128) return 128
  return 256
}

export function emojiSprite(ch: string, devicePx: number): HTMLCanvasElement {
  const b = bucket(devicePx)
  const key = ch + '|' + b
  let c = cache.get(key)
  if (c) return c
  c = document.createElement('canvas')
  // Glyphs overhang their em box a little; pad so nothing is clipped.
  const pad = Math.ceil(b * 0.15)
  c.width = c.height = b + pad * 2
  const x = c.getContext('2d')
  if (x) {
    x.font = `${b * 0.86}px ${EMOJI_FONT}`
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    x.fillText(ch, c.width / 2, c.height / 2 + b * 0.06)
  }
  cache.set(key, c)
  return c
}

/** Generic memoised offscreen render, for game sprites built from vector drawing. */
const custom = new Map<string, HTMLCanvasElement>()

export function sprite(
  key: string,
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  let c = custom.get(key)
  if (c) return c
  c = document.createElement('canvas')
  c.width = Math.ceil(w)
  c.height = Math.ceil(h)
  const x = c.getContext('2d')
  if (x) paint(x)
  custom.set(key, c)
  return c
}

export function clearSprites(): void {
  for (const c of custom.values()) {
    c.width = c.height = 1
  }
  custom.clear()
}
