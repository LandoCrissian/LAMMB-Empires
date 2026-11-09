import { defineConfig } from "@playwright/test";
import { availableParallelism } from "node:os";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  fullyParallel: false,
  // Leave CPU capacity for high-DPI software rasterization and the fixed-step
  // clock. Small 2–4 CPU CI hosts use one browser; this 16-CPU dev host uses two.
  // Every case still runs, with unchanged assertions and no retries.
  workers: Math.max(1, Math.min(2, Math.floor(availableParallelism() / 4))),
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
      testMatch: ["**/frontier.spec.mjs", "**/command-first.spec.mjs"],
      // Native-touch capability is exercised in the two mobile Chromium contexts.
      grepInvert: /native touch|battlefield journey/,
      use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-chromium",
      testMatch: ["**/frontier.spec.mjs", "**/command-first.spec.mjs"],
      grepInvert: /battlefield journey/,
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
      testMatch: ["**/landscape.spec.mjs", "**/command-first.spec.mjs"],
      grepInvert: /battlefield journey/,
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
      testMatch: ["**/rally-siege.spec.mjs", "**/command-first.spec.mjs"],
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
      testMatch: ["**/rally-siege.spec.mjs", "**/command-first.spec.mjs"],
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
