import { expect, test } from '@playwright/test'

// The service worker only exists in production builds (preview server).
test.skip(!!process.env.BASE, 'needs the production build')

test('works offline after the first visit', async ({ page, context }) => {
  await page.goto('./')
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active !== null)
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('.wordmark')).toBeVisible()
  await page.locator('.card[data-id="tic-tac-toe"]').click()
  await expect(page.locator('.ready-btn').first()).toBeVisible()
})
