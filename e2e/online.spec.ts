import { expect, test, type Page } from '@playwright/test'

// Real P2P through public Nostr relays: opt in with ONLINE=1.
test.skip(!process.env.ONLINE, 'set ONLINE=1 to run the peer-to-peer test')
// Headless WebKit has no working WebRTC data channel; real iPhones do.
test.use({ browserName: 'chromium', isMobile: false })

test('two phones join a room and play tic tac toe to a result', async ({ browser }) => {
  test.setTimeout(240_000)
  const open = async () =>
    (await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 760 } })).newPage()
  const host = await open()
  const guest = await open()
  await host.goto('./#/online')
  await host.getByRole('button', { name: 'Create a room' }).click()
  const code = (await host.locator('.code span').allTextContents()).join('')
  await guest.goto(`./#/online/${code}`)
  await expect(host.locator('.online-banner:not(.waiting)')).toBeVisible({ timeout: 60_000 })
  await host.locator('.card[data-id="tic-tac-toe"]').click()
  await guest.waitForURL(/play\/tic-tac-toe/)
  await host.locator('.ready-btn').click()
  await guest.locator('.ready-btn').click()
  await host.waitForTimeout(4000)
  const cells: [number, number][] = [
    [0.5, 0.5],
    [0.22, 0.38],
    [0.78, 0.62],
    [0.22, 0.62],
    [0.78, 0.38],
    [0.5, 0.38],
    [0.5, 0.62],
    [0.22, 0.5],
    [0.78, 0.5],
  ]
  const tapAll = async (p: Page, i: number) => {
    const vp = p.viewportSize() ?? { width: 390, height: 760 }
    const c = cells[i % cells.length] as [number, number]
    await p.mouse.click(vp.width * c[0], vp.height * c[1])
  }
  for (let i = 0; i < 200 && !(await host.locator('.overlay.result').isVisible()); i++) {
    await tapAll(host, i)
    await tapAll(guest, i)
    await host.waitForTimeout(250)
  }
  await expect(host.locator('.overlay.result')).toBeVisible()
  await expect(guest.locator('.overlay.result')).toBeVisible({ timeout: 5000 })
})

test('two phones play a real-time game (pull the rope) to a result', async ({ browser }) => {
  test.setTimeout(240_000)
  const open = async () =>
    (await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 760 } })).newPage()
  const host = await open()
  const guest = await open()
  await host.goto('./#/online')
  await host.getByRole('button', { name: 'Create a room' }).click()
  const code = (await host.locator('.code span').allTextContents()).join('')
  await guest.goto(`./#/online/${code}`)
  await expect(host.locator('.online-banner:not(.waiting)')).toBeVisible({ timeout: 60_000 })
  await host.locator('.card[data-id="pull-the-rope"]').click()
  await guest.waitForURL(/play\/pull-the-rope/)
  await host.locator('.ready-btn').click()
  await guest.locator('.ready-btn').click()
  await host.waitForTimeout(4000)
  // Each phone mashes its own (bottom) half; the host mashes faster, so it should win.
  const until = Date.now() + 150_000
  for (let i = 0; Date.now() < until && !(await host.locator('.overlay.result').isVisible()); i++) {
    await host.mouse.click(195, 600)
    await host.waitForTimeout(40)
    if (i % 3 === 0) await guest.mouse.click(195, 600)
  }
  await expect(host.locator('.overlay.result')).toBeVisible()
  await expect(guest.locator('.overlay.result')).toBeVisible({ timeout: 5000 })
  await expect(host.locator('.result-title').first()).toHaveText('You win!')
})
