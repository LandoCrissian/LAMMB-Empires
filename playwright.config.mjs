import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:4173",
    // Keep DOM/source traces without continuously recording the animated canvas.
    // Explicit evidence screenshots and every gameplay assertion remain enabled.
    trace: {
      mode: "retain-on-failure",
      screenshots: false,
      snapshots: true,
      sources: true,
    },
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      testMatch: "**/frontier.spec.mjs",
      use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-chromium",
      testMatch: "**/frontier.spec.mjs",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "landscape-chromium",
      testMatch: "**/landscape.spec.mjs",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "landscape-webkit",
      testMatch: "**/landscape.spec.mjs",
      use: {
        browserName: "webkit",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "rally-siege-desktop-chromium",
      testMatch: "**/rally-siege.spec.mjs",
      use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
    },
    {
      name: "rally-siege-mobile-chromium",
      testMatch: "**/rally-siege.spec.mjs",
      use: {
        browserName: "chromium",
        viewport: { width: 844, height: 390 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "rally-siege-mobile-webkit",
      testMatch: "**/rally-siege.spec.mjs",
      use: {
        browserName: "webkit",
        viewport: { width: 844, height: 390 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
