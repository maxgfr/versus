import type { Draw } from '../../core/render/draw.ts'
import { EMOJI_FONT } from '../../core/render/palette.ts'
import { OPT, PANEL, type OptionLabel } from '../math-quiz/render.ts'
import { COUNTRIES } from './countries.ts'

/** The scoreboard is taller than Math Quiz's: a flag needs the room to be told from its lookalike. */
export const FLAG_PANEL = { ...PANEL, h2p: 540, h1p: 400 }
export const FLAG_GAP = 134
const FLAG_SIZE = { shared: 260, alone: 340 }

const NAME_WIDTH = OPT.w - 56
const NAME_SIZES = [64, 58, 52, 46, 40] as const
const MAX_LINES = 3

/** Words packed into as few lines as fit `width`, or null if a single word is too wide. */
function wrap(g: Draw, name: string, size: number, width: number): string[] | null {
  const lines: string[] = []
  for (const word of name.split(' ')) {
    if (g.measure(word, size, 700) > width) return null
    const last = lines[lines.length - 1]
    if (last !== undefined && g.measure(`${last} ${word}`, size, 700) <= width)
      lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  return lines
}

/** A country name on its button, on up to three lines at the largest size that fits. */
export const nameLabel: OptionLabel = (g, v, color, drop) => {
  const name = COUNTRIES[v]?.name ?? ''
  let size: number = NAME_SIZES[NAME_SIZES.length - 1] ?? 40
  let lines = [name]
  for (const s of NAME_SIZES) {
    const fit = wrap(g, name, s, NAME_WIDTH)
    if (fit && fit.length <= MAX_LINES) {
      size = s
      lines = fit
      break
    }
  }
  const lead = size * 1.08
  lines.forEach((line, i) =>
    g.text(line, 0, (i - (lines.length - 1) / 2) * lead, {
      size,
      weight: 700,
      color,
      drop,
      maxWidth: NAME_WIDTH,
    }),
  )
}

/** A flag is drawn this many bitmap pixels to its `FLAG_SIZE`, like the largest emoji sprite. */
const FLAG_EM = 256
const GLYPH_PX = FLAG_EM * 0.86
/** Room for a glyph drawn a whole flag-width off its mark. */
const PROBE_PX = 640

const bitmaps = new Map<number, HTMLCanvasElement>()

/**
 * The flag cropped to what was actually painted. Safari on iOS draws flag glyphs
 * well to the right of the point `textAlign` asks for, so the font can't be trusted to centre them.
 */
function flagBitmap(country: number): HTMLCanvasElement {
  const known = bitmaps.get(country)
  if (known) return known
  const out = document.createElement('canvas')
  bitmaps.set(country, out)
  const probe = document.createElement('canvas')
  probe.width = probe.height = PROBE_PX
  const x = probe.getContext('2d', { willReadFrequently: true })
  if (!x) return out
  x.font = `${GLYPH_PX}px ${EMOJI_FONT}`
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  x.fillText(COUNTRIES[country]?.flag ?? '', PROBE_PX / 2, PROBE_PX / 2)
  const { data } = x.getImageData(0, 0, PROBE_PX, PROBE_PX)
  let [left, top, right, bottom] = [PROBE_PX, PROBE_PX, -1, -1]
  for (let py = 0; py < PROBE_PX; py++) {
    for (let px = 0; px < PROBE_PX; px++) {
      if ((data[(py * PROBE_PX + px) * 4 + 3] ?? 0) < 16) continue
      left = Math.min(left, px)
      right = Math.max(right, px)
      top = Math.min(top, py)
      bottom = Math.max(bottom, py)
    }
  }
  if (right < 0) return out
  out.width = right - left + 1
  out.height = bottom - top + 1
  out.getContext('2d')?.drawImage(probe, -left, -top)
  return out
}

export function drawFlag(g: Draw, country: number): void {
  const img = flagBitmap(country)
  const k = (g.flipTop ? FLAG_SIZE.shared : FLAG_SIZE.alone) / FLAG_EM
  g.ctx.drawImage(img, (-img.width * k) / 2, (-img.height * k) / 2, img.width * k, img.height * k)
}
