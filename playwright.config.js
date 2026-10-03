import { defineConfig } from '@playwright/test';

const command = process.env.E2E_SERVER === 'python'
  ? 'python3 -m http.server 4173 --bind 127.0.0.1 --directory deploy'
  : 'node scripts/serve.mjs deploy 4173';

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 120000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/',
    channel: process.env.PW_CHANNEL || 'chrome',
    acceptDownloads: true,
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command,
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: false,
  },
});
