import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_ADMIN_BASE_URL ?? 'https://5174.blyss.co.ke'
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
if (baseURL !== 'https://5174.blyss.co.ke') throw new Error('Control-surface browser acceptance must use https://5174.blyss.co.ke')

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  retries: 0,
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  reporter: [['list']],
})
