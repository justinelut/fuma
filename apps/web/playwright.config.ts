import { defineConfig, devices } from '@playwright/test'

const publicBaseUrl = process.env.E2E_PUBLIC_BASE_URL ?? 'https://3002.blyss.co.ke'

if (!publicBaseUrl.startsWith('https://3002.blyss.co.ke')) {
  throw new Error('Public Web browser acceptance must use https://3002.blyss.co.ke')
}

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  testIgnore: '**/lawyer-conversion.e2e.ts',
  timeout: 30_000,
  retries: 0,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: publicBaseUrl,
    trace: 'retain-on-failure',
  },
  reporter: [['list']],
})
