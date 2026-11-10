/** Reproducible development benchmark; timings are measurements, never gameplay state. */
import { performance } from "node:perf_hooks";
import os from "node:os";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { playSkirmish } from "./balance-check.mjs";
import { playSiegeSkirmish } from "./siege-balance-check.mjs";
import { playCommandSkirmish } from "./command-balance-check.mjs";
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
// A legal ram hit at 374.95 seconds keeps the new structure-impact effect visible.
const siegeFixture = playSiegeSkirmish(5280, 375).state;
if (!siegeFixture.units.some((u) => u.faction === "player" && u.type === "ram"))
  throw new Error(
    "The legal siege performance fixture must contain a live trained ram.",
  );
if (fixture.status !== "playing")
  throw new Error(
    "The legal240-second performance fixture must be a live match.",
  );
enableMovementDiagnostics(true);
resetMovementDiagnostics();
const stepTimes = [],
  orderTimes = [];
let maximumUnits = 0;
let acceptedOrders = 0,
  rejectedOrders = 0;
for (let repeat = 0; repeat < 10; repeat++) {
  const state = structuredClone(fixture);
  const army = state.units
    .filter((u) => u.faction === "player" && u.type !== "worker")
    .map((u) => u.id);
  for (let tick = 0; tick < 400; tick++) {
    if (tick % 100 === 0) {
      const started = performance.now();
      const issued = command(state, {
        type: "order",
        ids: army,
        order: { type: tick % 200 ? "attackMove" : "move", x: 26.5, y: 13.5 },
      });
      if (issued.ok) acceptedOrders++;
      else rejectedOrders++;
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

enableMovementDiagnostics(true);
resetMovementDiagnostics();
const siegeStepTimes = [],
  siegeOrderTimes = [];
let siegeMaximumUnits = 0;
let siegeAcceptedOrders = 0,
  siegeRejectedOrders = 0;
for (let repeat = 0; repeat < 10; repeat++) {
  const state = structuredClone(siegeFixture);
  for (let tick = 0; tick < 400 && state.status === "playing"; tick++) {
    if (tick % 100 === 0) {
      const start = performance.now();
      const army = state.units
        .filter(
          (u) => u.faction === "player" && u.type !== "worker" && u.hp > 0,
        )
        .map((u) => u.id);
      const issued = command(state, {
        type: "order",
        ids: army,
        order: { type: tick % 200 ? "attackMove" : "move", x: 26.5, y: 13.5 },
      });
      if (issued.ok) siegeAcceptedOrders++;
      else siegeRejectedOrders++;
      siegeOrderTimes.push(performance.now() - start);
    }
    const start = performance.now();
    stepGame(state);
    siegeStepTimes.push(performance.now() - start);
    siegeMaximumUnits = Math.max(siegeMaximumUnits, state.units.length);
  }
}
const siegeMovement = getMovementDiagnostics();
enableMovementDiagnostics(false);

// Keep the Task004 comparison above unchanged. These separate legal fixtures
// retain their existing orders throughout each sample, so benchmarking does not
// silently cancel the new cohort/retreat behavior with legacy movement orders.
const commandFixtures = [
  { name: "assault", state: playCommandSkirmish(5280, 355).state },
  { name: "retreat", state: playCommandSkirmish(5280, 375).state },
];
for (const item of commandFixtures)
  if (
    !item.state.units.some(
      (u) => u.faction === "player" && u.order.type === item.name,
    )
  )
    throw new Error(
      `The legal ${item.name} fixture must contain its active order.`,
    );
const tacticalSimulation = commandFixtures.map((item) => {
  const times = [];
  let maximumUnits = 0;
  enableMovementDiagnostics(true);
  resetMovementDiagnostics();
  for (let repeat = 0; repeat < 10; repeat++) {
    const state = structuredClone(item.state);
    for (let tick = 0; tick < 400 && state.status === "playing"; tick++) {
      const begin = performance.now();
      stepGame(state);
      times.push(performance.now() - begin);
      maximumUnits = Math.max(maximumUnits, state.units.length);
    }
  }
  const movement = getMovementDiagnostics();
  enableMovementDiagnostics(false);
  return {
    name: item.name,
    fixtureTime: item.state.time,
    fixtureUnits: item.state.units.length,
    activeUnits: item.state.units.filter(
      (u) => u.faction === "player" && u.order.type === item.name,
    ).length,
    maximumUnits,
    steps: summary(times),
    movement,
    ordersReplacedDuringSteps: false,
  };
});
const assaultCommandTimes = [],
  retreatCommandTimes = [];
enableMovementDiagnostics(true);
resetMovementDiagnostics();
for (let repeat = 0; repeat < 10; repeat++) {
  const state = structuredClone(commandFixtures[0].state);
  const ids = state.units
    .filter((u) => u.faction === "player" && u.type !== "worker" && u.hp > 0)
    .map((u) => u.id);
  const target = state.buildings.find(
    (b) => b.faction === "enemy" && b.type === "townCenter",
  );
  let begin = performance.now();
  const assault = command(state, {
    type: "order",
    ids,
    order: { type: "assault", targetId: target.id },
  });
  assaultCommandTimes.push(performance.now() - begin);
  if (!assault.ok)
    throw new Error(`Assault benchmark rejected: ${assault.reason}`);
  begin = performance.now();
  const retreat = command(state, {
    type: "order",
    ids,
    order: { type: "retreat", x: 18.5, y: 25.5 },
  });
  retreatCommandTimes.push(performance.now() - begin);
  if (!retreat.ok)
    throw new Error(`Retreat benchmark rejected: ${retreat.reason}`);
}
const tacticalCommandCosts = {
  assault: summary(assaultCommandTimes),
  retreat: summary(retreatCommandTimes),
  acceptedAssault: 10,
  acceptedRetreat: 10,
  movement: getMovementDiagnostics(),
};
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
    groupOrderResults: { accepted: acceptedOrders, rejected: rejectedOrders },
    movement,
  },
  browser: [],
  baselineTask004: JSON.parse(
    await readFile("docs/performance/task004.json", "utf8"),
  ),
  siegeFixture: {
    time: siegeFixture.time,
    units: siegeFixture.units.length,
    rams: siegeFixture.units.filter((u) => u.type === "ram").length,
    maximumUnits: siegeMaximumUnits,
    steps: summary(siegeStepTimes),
    groupOrders: summary(siegeOrderTimes),
    groupOrderResults: {
      accepted: siegeAcceptedOrders,
      rejected: siegeRejectedOrders,
    },
    movement: siegeMovement,
  },
  tacticalSimulation,
  tacticalCommandCosts,
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
    const render = await page.evaluate(
      async ({ state, siegeState, tacticalStates }) => {
        const { Battlefield } = await import("/src/render/battlefield.mjs");
        const renderer = new Battlefield(document.querySelector("canvas"));
        const view = { x: 20, y: 19, zoom: innerWidth < 1000 ? 0.8 : 1.1 };
        const firstStart = performance.now();
        renderer.draw(state, view, new Set(), null, 0);
        const coldDrawMs = performance.now() - firstStart;
        const terrainFrameCosts = [];
        const preparationStart = performance.now();
        if (renderer.terrainStatus && !renderer.terrainStatus().ready)
          await new Promise((resolve) => {
            const frame = (now) => {
              const start = performance.now();
              renderer.draw(state, view, new Set(), null, now / 1000);
              terrainFrameCosts.push(performance.now() - start);
              if (renderer.terrainStatus().ready) resolve();
              else requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
          });
        const terrainPreparation = {
          ...(renderer.terrainStatus?.() || { ready: true, phased: false }),
          wallAfterFirstDrawMs: performance.now() - preparationStart,
          frameCosts: terrainFrameCosts,
        };
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
        const siegeSamples = [];
        const siegeView = { x: 25, y: 16, zoom: innerWidth < 1000 ? 0.8 : 1.1 };
        renderer.draw(siegeState, siegeView, new Set(), null, 0);
        if (renderer.terrainStatus && !renderer.terrainStatus().ready)
          await new Promise((resolve) => {
            const frame = (now) => {
              renderer.draw(siegeState, siegeView, new Set(), null, now / 1000);
              if (renderer.terrainStatus().ready) resolve();
              else requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
          });
        await new Promise((resolve) => {
          const frame = (now) => {
            const start = performance.now();
            renderer.draw(
              siegeState,
              siegeView,
              new Set(
                siegeState.units
                  .filter((u) => u.faction === "player")
                  .map((u) => u.id),
              ),
              null,
              now / 1000,
            );
            siegeSamples.push(performance.now() - start);
            if (siegeSamples.length < 120) requestAnimationFrame(frame);
            else resolve();
          };
          requestAnimationFrame(frame);
        });
        const tacticalRenders = [];
        for (const item of tacticalStates) {
          const tacticalView = {
            x: 25,
            y: 20,
            zoom: innerWidth < 1000 ? 0.8 : 1.1,
          };
          renderer.draw(item.state, tacticalView, new Set(), null, 0);
          if (!renderer.terrainStatus().ready)
            await new Promise((resolve) => {
              const frame = (now) => {
                renderer.draw(
                  item.state,
                  tacticalView,
                  new Set(),
                  null,
                  now / 1000,
                );
                if (renderer.terrainStatus().ready) resolve();
                else requestAnimationFrame(frame);
              };
              requestAnimationFrame(frame);
            });
          const durations = [],
            gaps = [];
          let prior;
          const selected = new Set(
            item.state.units
              .filter((u) => u.faction === "player")
              .map((u) => u.id),
          );
          await new Promise((resolve) => {
            const frame = (now) => {
              if (prior !== undefined) gaps.push(now - prior);
              prior = now;
              const begin = performance.now();
              renderer.draw(
                item.state,
                tacticalView,
                selected,
                null,
                now / 1000,
              );
              durations.push(performance.now() - begin);
              if (durations.length < 120) requestAnimationFrame(frame);
              else resolve();
            };
            requestAnimationFrame(frame);
          });
          tacticalRenders.push({
            name: item.name,
            units: item.state.units.length,
            activeUnits: item.state.units.filter(
              (u) => u.faction === "player" && u.order.type === item.name,
            ).length,
            durations,
            gaps,
          });
        }
        return {
          coldDrawMs,
          terrainPreparation,
          samples,
          intervals,
          denseSamples,
          denseIntervals,
          siegeSamples,
          tacticalRenders,
        };
      },
      {
        state: fixture,
        siegeState: siegeFixture,
        tacticalStates: commandFixtures,
      },
    );
    report.browser.push({
      ...config,
      live,
      armyFixture: {
        units: fixture.units.length,
        coldDrawMs: render.coldDrawMs,
        terrainPreparation: {
          ...render.terrainPreparation,
          frameCosts: summary(render.terrainPreparation.frameCosts),
        },
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
      siegeArmyFixture: {
        units: siegeFixture.units.length,
        rams: siegeFixture.units.filter((u) => u.type === "ram").length,
        draw: summary(render.siegeSamples),
      },
      tacticalArmyFixtures: render.tacticalRenders.map((item) => ({
        name: item.name,
        units: item.units,
        activeUnits: item.activeUnits,
        draw: summary(item.durations),
        frameInterval: summary(item.gaps),
        intervalsOver50Ms: item.gaps.filter((n) => n > 50).length,
      })),
    });
    await context.close();
  }
} finally {
  await browser.close();
  if (server) server.kill();
}
await mkdir("docs/performance", { recursive: true });
report.comparisonToTask004 = {
  note: "Same host and equivalent conventional240-second/29-unit scenario. Timings are single-run measurements and can vary; siege375-second fixture is a different workload and reported separately.",
  simulationStepP95Ms: {
    task004: report.baselineTask004.simulation.steps.p95Ms,
    task005: report.simulation.steps.p95Ms,
  },
  groupOrderP95Ms: {
    task004: report.baselineTask004.simulation.groupOrders.p95Ms,
    task005: report.simulation.groupOrders.p95Ms,
  },
  browser: report.browser.map((current) => {
    const prior = report.baselineTask004.browser.find(
      (b) => b.name === current.name,
    );
    return {
      name: current.name,
      liveDrawP95Ms: {
        task004: prior?.live.metrics.renderMs.p95,
        task005: current.live.metrics.renderMs.p95,
      },
      warmArmyDrawP95Ms: {
        task004: prior?.armyFixture.draw.p95Ms,
        task005: current.armyFixture.draw.p95Ms,
      },
      coldDrawMs: {
        task004: prior?.armyFixture.coldDrawMs,
        task005: current.armyFixture.coldDrawMs,
      },
    };
  }),
};
await writeFile(
  "docs/performance/task005.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
