// Regenerates the game list in README.md from the registry (built games only).
//   node scripts/readme-games.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const reg = readFileSync('src/registry.ts', 'utf8')
const families = [...reg.matchAll(/\{ id: '([a-z]+)', label: '([^']+)'/g)].map((m) => ({
  id: m[1],
  label: m[2],
}))
const lines = []
let total = 0
for (const f of families) {
  const start = reg.search(new RegExp(`^ {2}${f.id}: \\[$`, 'm'))
  const end = reg.indexOf('\n  ],', start)
  const block = reg.slice(start, end)
  const games = [...block.matchAll(/\[\s*'([a-z0-9-]+)',\s*'([^']+)',\s*'([^']+)'/g)]
    .filter((m) => existsSync(`src/games/${m[1]}/index.ts`))
    .map((m) => `${m[3]} ${m[2]}`)
  if (!games.length) continue
  total += games.length
  lines.push(`**${f.label}** (${games.length}): ${games.join(' · ')}`, '')
}
const md = readFileSync('README.md', 'utf8')
const out = md.replace(
  /<!-- games:start -->[\s\S]*<!-- games:end -->/,
  `<!-- games:start -->\n${total} games, all playable two players on one phone.\n\n${lines.join('\n').trim()}\n<!-- games:end -->`,
)
writeFileSync('README.md', out)
console.log(`${total} games listed`)
