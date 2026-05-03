import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * End-to-end tests that load the real `webview-表格界面/main.js` into Chromium,
 * driven by actual mouse / keyboard events (not jsdom synthesis). Needed for
 * "did the click really hit the button" kind of regressions.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false, // each spec spins up its own temp HTML; keep deterministic
  reporter: [['list']],
  outputDir: path.resolve(__dirname, 'test-results'),
  use: {
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
