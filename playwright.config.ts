import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/versus/',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'iphone', use: { ...devices['iPhone 15'] } }],
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173/versus/',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
