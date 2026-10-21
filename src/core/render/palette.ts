/** Design tokens shared by the shell CSS and every canvas game. */
export const C = {
  ink: '#14101f',
  ink2: '#1d1730',
  ink3: '#2a2243',
  ink4: '#3a3159',
  line: '#4b4170',
  mute: '#8f86b3',
  white: '#fff8ef',
  cream: '#ffefd6',
  red: '#ff4b5c',
  redDark: '#c22a42',
  redLight: '#ff98a2',
  blue: '#3b8cff',
  blueDark: '#1f56c9',
  blueLight: '#93c1ff',
  yellow: '#ffcd3c',
  orange: '#ff8b3d',
  green: '#3edc8a',
  teal: '#22c3b0',
  cyan: '#46dcf0',
  purple: '#9d6bff',
  pink: '#ff6fb5',
  wood: '#c98a4b',
  woodDark: '#8c5a2b',
  grass: '#47b960',
  grassDark: '#2f8f47',
  sand: '#f1d394',
  water: '#2fa7e8',
  felt: '#1f8f5f',
} as const

export interface SideColors {
  main: string
  dark: string
  light: string
  name: string
}

export const SIDE: [SideColors, SideColors] = [
  { main: C.red, dark: C.redDark, light: C.redLight, name: 'Red' },
  { main: C.blue, dark: C.blueDark, light: C.blueLight, name: 'Blue' },
]

const cache = new Map<string, string>()

/** Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour by mixing with white / black. */
export function shade(hex: string, amt: number): string {
  const key = hex + amt
  const hit = cache.get(key)
  if (hit) return hit
  const n = parseInt(hex.slice(1), 16)
  let r = (n >> 16) & 255
  let g = (n >> 8) & 255
  let b = n & 255
  const t = amt < 0 ? 0 : 255
  const p = Math.abs(amt)
  r = Math.round((t - r) * p + r)
  g = Math.round((t - g) * p + g)
  b = Math.round((t - b) * p + b)
  const out = '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)
  cache.set(key, out)
  return out
}

/** #rrggbb + alpha → rgba(). */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** Linear blend of two #rrggbb colours. */
export function mix(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16)
  const y = parseInt(b.slice(1), 16)
  const l = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t)
  return '#' + ((1 << 24) | (l(16) << 16) | (l(8) << 8) | l(0)).toString(16).slice(1)
}

export const FONT = '"Fredoka", ui-rounded, "SF Pro Rounded", system-ui, sans-serif'
export const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
