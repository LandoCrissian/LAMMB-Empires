/** Reproducible development benchmark; timings are measurements, never gameplay state. */
import { performance } from "node:perf_hooks";
import os from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { playSkirmish } from "./balance-check.mjs";
import { command, stepGame } from "../src/sim/world.mjs";
import {
  enableMovementDiagnostics,
  resetMovementDiagnostics,
  getMovementDiagnostics,
} from "../src/sim/movement.mjs";

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
  return {
    count: sorted.length,
    meanMs: values.reduce((a, b) => a + b, 0) / Math.max(1, values.length),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted.at(-1) || 0,
  };
}

const fixture = playSkirmish(5280, 240).state;
if (fixture.status !== "playing")
  throw new Error(
    "The legal240-second performance fixture must be a live match.",
  );
enableMovementDiagnostics(true);
resetMovementDiagnostics();
const stepTimes = [],
  orderTimes = [];
let maximumUnits = 0;
for (let repeat = 0; repeat < 10; repeat++) {
  const state = structuredClone(fixture);
  const army = state.units
    .filter((u) => u.faction === "player" && u.type !== "worker")
    .map((u) => u.id);
  for (let tick = 0; tick < 400; tick++) {
    if (tick % 100 === 0) {
      const started = performance.now();
      command(state, {
        type: "order",
        ids: army,
        order: { type: tick % 200 ? "attackMove" : "move", x: 26.5, y: 13.5 },
      });
      orderTimes.push(performance.now() - started);
    }
    const started = performance.now();
    stepGame(state);
    stepTimes.push(performance.now() - started);
    maximumUnits = Math.max(maximumUnits, state.units.length);
  }
}
const movement = getMovementDiagnostics();
enableMovementDiagnostics(false);

const base = process.env.FRONTIER_BASE_URL || "http://127.0.0.1:4173";
let server;
try {
  await fetch(base);
} catch {
  server = spawn(process.execPath, ["scripts/server.mjs"], {
    stdio: "ignore",
    windowsHide: true,
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* server starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const report = {
  measuredAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    release: os.release(),
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    node: process.version,
  },
  caveat:
    "Headless Chromium on this host with desktop/mobile viewport emulation. CPU-throttled results are diagnostics, not physical-device performance or an iPhoneFPS claim. Canvas draw durations measure browser CPU submission cost, not GPU completion.",
  simulation: {
    fixtureSimulationTime: fixture.time,
    fixtureUnits: fixture.units.length,
    maximumUnits,
    fixedStepSeconds: 0.05,
    steps: summary(stepTimes),
    groupOrders: summary(orderTimes),
    movement,
  },
  browser: [],
};
const browser = await chromium.launch();
report.environment.chromium = browser.version();
try {
  for (const config of [
    { name: "desktop", width: 1440, height: 900, scale: 1, cpuRate: 1 },
    { name: "mobile-landscape", width: 844, height: 390, scale: 2, cpuRate: 1 },
    {
      name: "mobile-landscape-cpu4x",
      width: 844,
      height: 390,
      scale: 2,
      cpuRate: 4,
    },
  ]) {
    const context = await browser.newContext({
      viewport: { width: config.width, height: config.height },
      deviceScaleFactor: config.scale,
      isMobile: config.name !== "desktop",
      hasTouch: config.name !== "desktop",
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    if (config.cpuRate !== 1)
      await cdp.send("Emulation.setCPUThrottlingRate", {
        rate: config.cpuRate,
      });
    await page.goto(`${base}/?test=1`);
    await page.getByRole("button", { name: "Play LAMMB Empires" }).click();
    await page.getByRole("button", { name: "Army", exact: true }).click();
    await page.waitForTimeout(10_000);
    const live = await page.evaluate(() => ({
      metrics: window.frontierDebug.performanceMetrics(),
      time: window.frontierDebug.snapshot().time,
      unitCount: window.frontierDebug.snapshot().units.length,
    }));
    await page.route("**/benchmark", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><canvas id="benchmark" style="display:block;width:100vw;height:100vh"></canvas></body></html>',
      }),
    );
    await page.goto(`${base}/benchmark`);
    const render = await page.evaluate(async (state) => {
      const { Battlefield } = await import("/src/render/battlefield.mjs");
      const renderer = new Battlefield(document.querySelector("canvas"));
      const view = { x: 20, y: 19, zoom: innerWidth < 1000 ? 0.8 : 1.1 };
      const firstStart = performance.now();
      renderer.draw(state, view, new Set(), null, 0);
      const coldDrawMs = performance.now() - firstStart;
      const samples = [],
        intervals = [];
      let previous;
      await new Promise((resolve) => {
        const frame = (now) => {
          if (previous !== undefined) intervals.push(now - previous);
          previous = now;
          const start = performance.now();
          renderer.draw(
            state,
            view,
            new Set(
              state.units
                .filter((u) => u.faction === "player")
                .map((u) => u.id),
            ),
            null,
            now / 1000,
          );
          samples.push(performance.now() - start);
          if (samples.length < 240) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      // Deliberately controlled worst-case visual fixture. It is not a legal-match result.
      // Keep the same map reference so this measures warm combat effects separately from terrain setup.
      state.events = Array.from({ length: 64 }, (_, i) => ({
        id: 100000 + i,
        time: state.time - 0.12,
        type: i % 8 === 0 ? "death" : "attack",
        x: 16 + (i % 8),
        y: 15 + Math.floor(i / 8),
        targetX: 17 + (i % 8),
        targetY: 16 + Math.floor(i / 8),
        ranged: true,
        damage: 18,
        faction: i % 2 ? "enemy" : "player",
        entityType: i % 16 === 0 ? "tower" : "infantry",
        width: i % 16 === 0 ? 1 : 0,
      }));
      for (const unit of state.units) unit.lastHitAt = state.time - 0.12;
      const denseSamples = [],
        denseIntervals = [];
      previous = undefined;
      await new Promise((resolve) => {
        const frame = (now) => {
          if (previous !== undefined) denseIntervals.push(now - previous);
          previous = now;
          const start = performance.now();
          renderer.draw(
            state,
            view,
            new Set(
              state.units
                .filter((u) => u.faction === "player")
                .map((u) => u.id),
            ),
            null,
            now / 1000,
          );
          denseSamples.push(performance.now() - start);
          if (denseSamples.length < 120) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      return { coldDrawMs, samples, intervals, denseSamples, denseIntervals };
    }, fixture);
    report.browser.push({
      ...config,
      live,
      armyFixture: {
        units: fixture.units.length,
        coldDrawMs: render.coldDrawMs,
        draw: summary(render.samples),
        frameInterval: summary(render.intervals),
        intervalsOver50Ms: render.intervals.filter((n) => n > 50).length,
      },
      controlledCombatEffects: {
        label:
          "Controlled64-event renderer stress fixture; not a legal battle result",
        events: 64,
        draw: summary(render.denseSamples),
        frameInterval: summary(render.denseIntervals),
        intervalsOver50Ms: render.denseIntervals.filter((n) => n > 50).length,
      },
    });
    await context.close();
  }
} finally {
  await browser.close();
  if (server) server.kill();
}
await mkdir("docs/performance", { recursive: true });
await writeFile(
  "docs/performance/task003.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
