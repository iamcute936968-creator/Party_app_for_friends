import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: join(tmpdir(), 'watch-party-phase8-playwright'),
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5175' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], browserName: 'webkit', viewport: { width: 1440, height: 900 } } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: false,
    env: {
      WATCH_PARTY_TEST_CDN: '1',
      VITE_DRIVE_STREAMING: process.env.VITE_DRIVE_STREAMING || 'true',
      VITE_MEDIA_PROXY_URL: 'http://127.0.0.1:5175/__test/media-proxy',
      VITE_GOOGLE_CLIENT_ID: 'local-test-client',
    },
  },
});
