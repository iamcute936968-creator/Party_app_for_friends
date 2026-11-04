import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({ ...base, testDir: './tests/rtc', workers: 1,
  outputDir: join(tmpdir(), 'watch-party-real-rtc'),
  projects: [{ name: 'rtc-chromium', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--mute-audio'] } } }],
});
