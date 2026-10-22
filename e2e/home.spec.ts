import { expect, test } from '@playwright/test'

test('home shows the scoreboard and game cards without errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto('./')
  await expect(page.locator('.wordmark')).toBeVisible()
  await expect(page.locator('.scoreboard')).toBeVisible()
  expect(await page.locator('.card').count()).toBeGreaterThan(0)
  expect(errors).toEqual([])
})

test('swiping across a game card scrolls instead of opening it', async ({ page }) => {
  await page.goto('./')
  const card = page.locator('.card').nth(2)
  await expect(card).toBeVisible()
  // The finger lands on a card, slides 40 px, lifts still on the card.
  await card.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const x = r.x + r.width / 2
    const y = r.y + r.height / 2
    const o = { pointerId: 20, bubbles: true, pointerType: 'touch', clientX: x }
    el.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientY: y + 20 }))
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, clientY: y - 20 }))
  })
  await page.waitForTimeout(300)
  await expect(page).not.toHaveURL(/#\/play\//)
  // A real tap still opens it.
  await card.tap()
  await expect(page).toHaveURL(/#\/play\//)
})

test('landscape asks to rotate the phone', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 380 })
  await page.goto('./')
  await expect(page.locator('.rotate')).toBeVisible()
})

test('two fingers at once both register (air hockey style multi-touch)', async ({ page }) => {
  await page.goto('./#/play/tic-tac-toe')
  await expect(page.locator('.ready-btn').first()).toBeVisible()
  // Both ready buttons pressed by two simultaneous pointers.
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll<HTMLElement>('.ready-btn')]
    btns.forEach((b, i) => {
      const r = b.getBoundingClientRect()
      const o = {
        pointerId: 10 + i,
        bubbles: true,
        clientX: r.x + r.width / 2,
        clientY: r.y + r.height / 2,
        pointerType: 'touch',
      }
      b.dispatchEvent(new PointerEvent('pointerdown', o))
    })
    btns.forEach((b, i) => {
      const r = b.getBoundingClientRect()
      const o = {
        pointerId: 10 + i,
        bubbles: true,
        clientX: r.x + r.width / 2,
        clientY: r.y + r.height / 2,
        pointerType: 'touch',
      }
      b.dispatchEvent(new PointerEvent('pointerup', o))
    })
  })
  await expect(page.locator('.count')).toBeVisible()
})
