import { expect, test, type Page } from '@playwright/test'

// Real P2P through public Nostr relays: opt in with ONLINE=1.
test.skip(!process.env.ONLINE, 'set ONLINE=1 to run the peer-to-peer test')

test('two phones join a room and play tic tac toe to a result', async ({ browser }) => {
  test.setTimeout(120_000)
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
  for (let i = 0; i < 60 && !(await host.locator('.overlay.result').isVisible()); i++) {
    await tapAll(host, i)
    await tapAll(guest, i)
    await host.waitForTimeout(250)
  }
  await expect(host.locator('.overlay.result')).toBeVisible()
  await expect(guest.locator('.overlay.result')).toBeVisible({ timeout: 5000 })
})
