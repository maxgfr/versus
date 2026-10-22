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
  await expect(host.locator('.code span')).toHaveCount(4)
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
  await expect(host.locator('.code span')).toHaveCount(4)
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

test('the invite still works after the host tab reloads, and a reloaded guest lands back in the game', async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const open = async () =>
    (await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 760 } })).newPage()
  const host = await open()
  const guest = await open()
  await host.addInitScript(() => {
    navigator.share = async (d) => {
      ;(window as unknown as { shared?: ShareData }).shared = d
    }
  })
  await host.goto('./#/online')
  await host.getByRole('button', { name: 'Create a room' }).click()
  await expect(host.locator('.code span')).toHaveCount(4)
  const code = (await host.locator('.code span').allTextContents()).join('')
  // iOS often reloads Safari behind the share sheet: the room must survive it.
  await host.reload()
  await expect(host.locator('.code')).toHaveText(code)
  // The guest opens exactly the link the share sheet got, minus its #fragment
  // (which some messaging apps drop): the room is in the query.
  await host.getByRole('button', { name: 'Send invite' }).click()
  const url = await host.evaluate(() => (window as unknown as { shared?: ShareData }).shared?.url)
  expect(url).toMatch(new RegExp(`/versus/\\?r=${code}$`))
  await guest.goto((url ?? '').split('#')[0] ?? '')
  await expect(guest).toHaveURL(new RegExp(`#/online/${code}$`))
  await expect(host.locator('.online-banner:not(.waiting)')).toBeVisible({ timeout: 60_000 })
  await expect(guest.locator('.online-banner:not(.waiting)')).toBeVisible({ timeout: 30_000 })
  await host.locator('.card[data-id="tic-tac-toe"]').click()
  await guest.waitForURL(/play\/tic-tac-toe/)
  await host.locator('.ready-btn').click()
  await guest.reload()
  await expect(guest.locator('.ready-btn')).toBeVisible({ timeout: 60_000 })
  await expect(guest.locator('.ready .status')).toHaveText('Ready!')
  await guest.locator('.ready-btn').click()
  await expect(guest.locator('.overlay.ready')).toBeHidden({ timeout: 10_000 })
})

test('without a direct connection, the phones play through the relay', async ({ browser }) => {
  test.setTimeout(240_000)
  const open = async () => {
    const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 760 } })
    // Like two iPhones whose Wi-Fi blocks WebRTC: no direct channel ever opens.
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'RTCPeerConnection', { value: undefined })
    })
    return ctx.newPage()
  }
  const host = await open()
  const guest = await open()
  await host.goto('./#/online')
  await host.getByRole('button', { name: 'Create a room' }).click()
  await expect(host.locator('.code span')).toHaveCount(4)
  const code = (await host.locator('.code span').allTextContents()).join('')
  await guest.goto(`./#/online/${code}`)
  await expect(host.locator('.online-banner:not(.waiting)')).toBeVisible({ timeout: 60_000 })
  await host.locator('.card[data-id="pull-the-rope"]').click()
  await guest.waitForURL(/play\/pull-the-rope/)
  await host.locator('.ready-btn').click()
  await guest.locator('.ready-btn').click()
  await host.waitForTimeout(4000)
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

test('online has its own address, and leaving it leaves the room', async ({ browser }) => {
  test.setTimeout(120_000)
  const open = async () =>
    (await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 760 } })).newPage()
  const host = await open()
  const guest = await open()
  await host.goto('./#/')
  await host.getByRole('button', { name: 'Online' }).click()
  await expect(host).toHaveURL(/#\/online$/)
  await host.getByRole('button', { name: 'Create a room' }).click()
  await expect(host).toHaveURL(/#\/online\/[A-Z]{4}$/)
  await expect(host.locator('.code span')).toHaveCount(4)
  const code = (await host.locator('.code span').allTextContents()).join('')
  expect(host.url()).toContain(`#/online/${code}`)
  // The address bar is the invite.
  await guest.goto(`./#/online/${code}`)
  await expect(host.locator('.online-banner')).toBeVisible({ timeout: 60_000 })
  await expect(host.locator('.card')).toHaveCount(114)
  // A game opens under the room's address on both phones.
  await host.locator('.card[data-id="air-hockey"]').click()
  await expect(host).toHaveURL(new RegExp(`#/online/${code}/play/air-hockey$`))
  await guest.waitForURL(new RegExp(`#/online/${code}/play/air-hockey$`))
  await host.getByRole('button', { name: 'Back to games' }).click()
  await expect(host).toHaveURL(new RegExp(`#/online/${code}$`))
  await expect(guest).toHaveURL(new RegExp(`#/online/${code}$`))
  // The guest switches to 2P: back to a local address, out of the room.
  await guest.getByRole('button', { name: '2P' }).click()
  await expect(guest).toHaveURL(/#\/$/)
  await expect(guest.locator('.toast')).toContainText(`You left room ${code}`)
  await expect(host.locator('.status')).toContainText('Waiting for your friend', {
    timeout: 20_000,
  })
  // Rejoin puts them back in the same seat.
  await guest.locator('.toast button').click()
  await expect(guest).toHaveURL(new RegExp(`#/online/${code}$`))
  await expect(guest.locator('.online-banner')).toContainText('you are Blue', { timeout: 60_000 })
  // Local games keep working while out of the room.
  await host.getByRole('button', { name: '1P' }).click()
  await expect(host).toHaveURL(/#\/$/)
  await host.locator('.card[data-id="tic-tac-toe"]').click()
  await expect(host).toHaveURL(/#\/play\/tic-tac-toe$/)
  await expect(host.locator('.ready-btn')).toHaveText('Play')
})
