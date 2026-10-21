// Dev helper: screenshot a route on an iPhone-sized WebKit page.
// node scripts/shot.mjs <hash-route> <out.png> [--ready] [--tap x,y] [--click css] [--wait ms] [--shot file]
// --ready presses both READY buttons of the pre-game screen (and waits for the countdown to start).
import { webkit, devices } from '@playwright/test'

const [route = '/', out = 'shot.png', ...rest] = process.argv.slice(2)
const base = process.env.BASE ?? 'http://localhost:4173/versus/'
const browser = await webkit.launch()
const ctx = await browser.newContext({ ...devices['iPhone 15'] })
const page = await ctx.newPage()
const logs = []
page.on(
  'console',
  (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(`${m.type()}: ${m.text()}`),
)
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
await page.goto(base + '#' + route)
await page.waitForTimeout(900)
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]
  if (a === '--tap') {
    const [x, y] = rest[++i].split(',').map(Number)
    await page.touchscreen.tap(x, y)
    await page.waitForTimeout(250)
  } else if (a === '--ready') {
    await page.waitForSelector('.ready-btn')
    for (const b of await page.locator('.ready-btn').all()) await b.click()
    await page.waitForFunction(() => !document.querySelector('.ready-btn'), null, { timeout: 5000 })
  } else if (a === '--click') {
    await page.locator(rest[++i]).first().click()
    await page.waitForTimeout(250)
  } else if (a === '--wait') {
    await page.waitForTimeout(Number(rest[++i]))
  } else if (a === '--shot') {
    await page.screenshot({ path: rest[++i] })
  }
}
await page.screenshot({ path: out })
if (logs.length) console.log(logs.join('\n'))
await browser.close()
