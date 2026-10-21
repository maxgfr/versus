import { readdirSync, existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// Every built game: computer vs computer at 8× speed must reach the result
// screen with no console error. Optional GAMES=id1,id2 narrows the run.
const only = process.env.GAMES?.split(',')
const games = readdirSync('src/games').filter(
  (id) => existsSync(`src/games/${id}/index.ts`) && (!only || only.includes(id)),
)

for (const id of games) {
  test(`${id}: bot vs bot reaches a result`, async ({ page }) => {
    test.setTimeout(150_000)
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    await page.goto(`./#/play/${id}?demo&speed=8`)
    await expect(page.locator('.stage')).toBeVisible()
    await expect(page.locator('.overlay.result')).toBeVisible({ timeout: 140_000 })
    expect(errors).toEqual([])
    // Menu goes back home and frees the canvas.
    await page.getByRole('button', { name: 'Games' }).first().click()
    await expect(page.locator('.stage')).toHaveCount(0)
  })
}
