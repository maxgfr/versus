import { defineConfig, devices } from '@playwright/test'

// BASE=http://localhost:<port>/versus/ points the tests at an already running
// dev server (parallel agents each run their own); otherwise build + preview.
const base = process.env.BASE

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: base ?? 'http://localhost:4173/versus/',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'iphone', use: { ...devices['iPhone 15'] } }],
  ...(base
    ? {}
    : {
        webServer: {
          command: 'pnpm build && pnpm preview --port 4173 --strictPort',
          url: 'http://localhost:4173/versus/',
          reuseExistingServer: true,
          timeout: 180_000,
        },
      }),
})
