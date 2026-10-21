// Size budget: the home screen must stay small, and so must every game chunk.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const dir = process.argv[2] ?? 'dist'
const assets = join(dir, 'assets')
const html = readFileSync(join(dir, 'index.html'), 'utf8')
const gz = (f) => gzipSync(readFileSync(join(assets, f))).length
const kb = (n) => (n / 1024).toFixed(1) + ' KB'

// Shared libraries are budgeted separately: they load once, for the games that need them.
const LIBS = /^(online|matter|chess|trystero|qrcode|workbox|virtual_pwa)/
const HOME_MAX = 300 * 1024
const GAME_MAX = 50 * 1024

const entry = [...html.matchAll(/assets\/([\w.-]+\.(?:js|css))/g)].map((m) => m[1])
const home = entry.reduce((n, f) => n + gz(f), 0)
let failed = home > HOME_MAX
console.log(`home (entry js+css): ${kb(home)} / ${kb(HOME_MAX)}`)

for (const f of readdirSync(assets)) {
  if (!f.endsWith('.js') || entry.includes(f) || LIBS.test(f)) continue
  const n = gz(f)
  if (n > GAME_MAX) {
    failed = true
    console.log(`over budget: ${f} ${kb(n)} / ${kb(GAME_MAX)}`)
  }
}
if (failed) {
  console.error('Size budget exceeded.')
  process.exit(1)
}
console.log('Size budget OK.')
