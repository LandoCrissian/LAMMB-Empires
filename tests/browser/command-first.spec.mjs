import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const selected = (page) => page.evaluate(() => window.frontierDebug.selected());
const point = (page, x, y) =>
  page.evaluate(([x, y]) => window.frontierDebug.worldToScreen(x, y), [x, y]);
const snapshot = (page) => page.evaluate(() => window.frontierDebug.snapshot());
const camera = (page) => page.evaluate(() => window.frontierDebug.camera());
const button = (page, name) => page.getByRole("button", { name, exact: true });
const activate = (locator, touch) => (touch ? locator.tap() : locator.click());

async function start(page, touch = false) {
  await page.goto("/?test=1");
  await activate(button(page, "Play LAMMB Empires"), touch);
  await expect(
    page.getByRole("button", { name: "Army", exact: true }),
  ).toBeVisible();
  if (await page.locator(".mission").isVisible())
    await activate(button(page, "Objectives"), touch);
  if (await page.locator("#minimap").isVisible())
    await activate(button(page, "Minimap"), touch);
}

async function unobscured(page, p) {
  expect(
    await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, p),
    "real input reaches the battlefield",
  ).toBe("battlefield");
}
async function field(page, x, y, touch, contextual = false) {
  const p = await point(page, x, y);
  await unobscured(page, p);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else
    await page.mouse.click(p.x, p.y, { button: contextual ? "right" : "left" });
}
async function navigate(page, x, y, touch) {
  const map = page.locator("#minimap");
  if (!(await map.isVisible())) await activate(button(page, "Minimap"), touch);
  await expect(button(page, "Minimap")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(map).toBeVisible();
  const state = await snapshot(page);
  const bounds = await map.boundingBox();
  expect(
    bounds,
    "visible minimap exposes a measurable interaction surface",
  ).not.toBeNull();
  const position = {
    x: (bounds.width * x) / state.map.width,
    y: (bounds.height * y) / state.map.height,
  };
  if (touch) await map.tap({ position });
  else await map.click({ position });
  if (await map.isVisible()) await activate(button(page, "Minimap"), touch);
  await expect(button(page, "Minimap")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(map).toBeHidden();
}
async function selectUnit(page, unit, touch) {
  const p = await point(page, unit.x, unit.y);
  const zoom = (await camera(page)).zoom;
  p.y -= (unit.type === "ram" ? 24 : 16) * zoom;
  await unobscured(page, p);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  expect(await selected(page)).toEqual([unit.id]);
}
async function selectBuilding(page, building, touch) {
  await navigate(
    page,
    building.x + building.width / 2,
    building.y + building.height / 2,
    touch,
  );
  const p = await point(
    page,
    building.x + building.width / 2,
    building.y + building.height / 2,
  );
  p.y -= 45 * (await camera(page)).zoom;
  await unobscured(page, p);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  expect(await selected(page)).toEqual([building.id]);
}
async function rectangle(page, from, to) {
  await unobscured(page, from);
  await unobscured(page, to);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(page.locator("#selection-box")).toBeVisible();
  await page.mouse.up();
}
function ownOrders(state) {
  return state.units
    .filter((u) => u.faction === "player" && u.hp > 0)
    .map((u) => ({ id: u.id, order: u.order, carrying: u.carrying }));
}
async function dispatchTouch(cdp, type, points = []) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
}
async function dragTouch(cdp, from, to, steps = 6) {
  for (let i = 1; i <= steps; i++)
    await dispatchTouch(cdp, "touchMove", [
      {
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
        id: 1,
      },
    ]);
}

test.beforeEach(async ({ page }) => {
  page.commandErrors = [];
  page.on("pageerror", (error) => page.commandErrors.push(error.message));
  await mkdir("docs/screenshots/task005", { recursive: true });
});
test.afterEach(async ({ page }) => expect(page.commandErrors).toEqual([]));

async function swordsmanRectangle(page) {
  return page.evaluate(() => {
    const state = window.frontierDebug.snapshot();
    const positions = state.units
      .filter(
        (unit) =>
          unit.faction === "player" && unit.type === "swordsman" && unit.hp > 0,
      )
      .map((unit) => ({
        id: unit.id,
        ...window.frontierDebug.worldToScreen(unit.x, unit.y),
      }));
    if (positions.length < 2) throw new Error("Expected two initial swordsmen");
    return {
      ids: positions.map((p) => p.id).sort(),
      start: {
        x: Math.min(...positions.map((p) => p.x)) - 18,
        y: Math.min(...positions.map((p) => p.y)) - 18,
      },
      end: {
        x: Math.max(...positions.map((p) => p.x)) + 18,
        y: Math.max(...positions.map((p) => p.y)) + 18,
      },
    };
  });
}

test("a selected soldier and army receive direct contextual ground movement", async ({
  page,
  isMobile,
}, info) => {
  await start(page, isMobile);
  const soldier = (await snapshot(page)).units.find(
    (u) => u.faction === "player" && u.type === "swordsman",
  );
  await selectUnit(page, soldier, isMobile);
  await field(page, 9.5, 20.5, isMobile, true);
  expect(
    (await snapshot(page)).units.find((u) => u.id === soldier.id).order.type,
  ).toBe("move");
  expect(await page.evaluate(() => window.frontierDebug.mode())).toBe("select");
  await expect
    .poll(async () => {
      const u = (await snapshot(page)).units.find((u) => u.id === soldier.id);
      return Math.hypot(u.x - soldier.x, u.y - soldier.y);
    })
    .toBeGreaterThan(0.15);
  await activate(button(page, "Army"), isMobile);
  const ids = await selected(page);
  expect(ids).toHaveLength(2);
  // Navigate to clear ground away from the first soldier's travel path; this
  // also keeps the same intended destination reachable in portrait layouts.
  await navigate(page, 14.5, 20.5, isMobile);
  await field(page, 14.5, 20.5, isMobile, true);
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() => window.frontierDebug.snapshot())
        ).units.filter(
          (unit) => ids.includes(unit.id) && unit.order.type === "move",
        ).length,
    )
    .toBe(2);
  const orders = (await snapshot(page)).units
    .filter((u) => ids.includes(u.id))
    .map((u) => u.order);
  expect(new Set(orders.map((o) => `${o.x},${o.y}`)).size).toBe(2);
  expect((await selected(page)).sort()).toEqual(ids.sort());
  await page.screenshot({
    path: `docs/screenshots/task005/${info.project.name}-direct-command.png`,
  });
  await activate(button(page, "Deselect"), isMobile);
  expect(await selected(page)).toHaveLength(0);
});

test("Select Area offers a visible accessible pointer rectangle", async ({
  page,
  isMobile,
}, info) => {
  await start(page, isMobile);
  const before = ownOrders(await snapshot(page));
  const oldCamera = await camera(page);
  await activate(button(page, "Select Area"), isMobile);
  await expect
    .poll(() => page.evaluate(() => window.frontierDebug.mode()))
    .toBe("box");
  const { ids, start: from, end: to } = await swordsmanRectangle(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(page.locator("#selection-box")).toBeVisible();
  expect(
    (await page.locator("#selection-box").boundingBox()).width,
  ).toBeGreaterThan(25);
  await page.screenshot({
    path: `docs/screenshots/task005/${info.project.name}-selection-box.png`,
  });
  await page.mouse.up();
  const current = await selected(page);
  expect(current.sort()).toEqual(ids);
  expect(ownOrders(await snapshot(page))).toEqual(before);
  expect(await camera(page)).toEqual(oldCamera);
  await expect
    .poll(() => page.evaluate(() => window.frontierDebug.mode()))
    .toBe("select");
});

test("native touch holds distinguish selection from immediate pan", async ({
  page,
  context,
  browserName,
  isMobile,
}, info) => {
  test.skip(
    !isMobile || browserName !== "chromium",
    "Native touch movement injection is Chromium-only",
  );
  test.setTimeout(60_000);
  const cdp = await context.newCDPSession(page);
  const observations = [];
  try {
    for (const holdMs of [0, 100, 250, 400]) {
      await start(page, true);
      const { ids, start: from, end: to } = await swordsmanRectangle(page);
      const cameraBefore = await camera(page),
        before = await snapshot(page);
      await unobscured(page, from);
      await unobscured(page, to);
      // Observe delivered browser event timing. Protocol round trips can add
      // tens of milliseconds to a requested wait near the hold boundary.
      await page.evaluate(() => {
        window.commandPointerTimes = [];
        for (const type of ["pointerdown", "pointermove"])
          document.querySelector("#battlefield").addEventListener(
            type,
            () => {
              window.commandPointerTimes.push({
                type,
                time: performance.now(),
              });
            },
            { capture: true },
          );
        new MutationObserver(() => {
          if (
            document.querySelector("#battlefield").dataset.gesture ===
              "selection-ready" &&
            !window.commandPointerTimes.some((e) => e.type === "armed")
          )
            window.commandPointerTimes.push({
              type: "armed",
              time: performance.now(),
            });
        }).observe(document.querySelector("#battlefield"), {
          attributes: true,
          attributeFilter: ["data-gesture"],
        });
      });
      // Send timing-critical input without waiting for the touchStart ACK;
      // compositor/protocol round trips are not a player's deliberate hold.
      const down = dispatchTouch(cdp, "touchStart", [{ ...from, id: 1 }]);
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      if (holdMs > 320)
        await expect(page.locator("#selection-box.armed")).toBeVisible();
      const move = dispatchTouch(cdp, "touchMove", [{ ...to, id: 1 }]);
      await Promise.all([down, move]);
      const intent = await page
        .locator("#battlefield")
        .getAttribute("data-gesture");
      const delivered = await page.evaluate(() => {
        const events = window.commandPointerTimes;
        const down = events.find((e) => e.type === "pointerdown").time;
        return {
          moveMs: events.find((e) => e.type === "pointermove").time - down,
          cueMs: events.find((e) => e.type === "armed")?.time - down,
        };
      });
      const deliveredMs = delivered.moveMs;
      const expectedSelection = deliveredMs >= 320;
      observations.push({
        requestedHoldMs: holdMs,
        deliveredMs,
        cueMs: delivered.cueMs,
        intent,
      });
      expect(intent).toBe(expectedSelection ? "select" : "pan");
      if (expectedSelection)
        await expect(page.locator("#selection-box")).toBeVisible();
      await dispatchTouch(cdp, "touchEnd");
      if (expectedSelection) {
        expect((await selected(page)).sort()).toEqual(ids);
        expect(await camera(page)).toEqual(cameraBefore);
      } else {
        expect(await selected(page)).toEqual([]);
        expect(await camera(page)).not.toEqual(cameraBefore);
      }
      expect(ownOrders(await snapshot(page))).toEqual(ownOrders(before));
      expect((await snapshot(page)).resources).toEqual(before.resources);
    }
    expect(
      observations.some((o) => o.deliveredMs < 320 && o.intent === "pan"),
    ).toBe(true);
    expect(
      observations.some((o) => o.deliveredMs >= 320 && o.intent === "select"),
    ).toBe(true);
    // Once a quick drag becomes pan, waiting beyond the hold threshold may not
    // turn it into selection or issue an order on release.
    await start(page, true);
    await activate(button(page, "Army"), true);
    const before = await snapshot(page),
      ids = await selected(page),
      oldCamera = await camera(page);
    const { start: from, end: to } = await swordsmanRectangle(page);
    await dispatchTouch(cdp, "touchStart", [{ ...from, id: 1 }]);
    await dragTouch(cdp, from, { x: from.x + 20, y: from.y + 10 }, 2);
    await page.waitForTimeout(400);
    await dragTouch(cdp, { x: from.x + 20, y: from.y + 10 }, to);
    expect(
      await page.locator("#battlefield").getAttribute("data-gesture"),
    ).toBe("pan");
    await dispatchTouch(cdp, "touchEnd");
    expect(await selected(page)).toEqual(ids);
    expect(ownOrders(await snapshot(page))).toEqual(ownOrders(before));
    expect((await snapshot(page)).resources).toEqual(before.resources);
    expect(await camera(page)).not.toEqual(oldCamera);

    // A cancellation or viewport rotation cannot complete a pending rectangle.
    for (const interruption of ["cancel", "rotate"]) {
      await start(page, true);
      await activate(button(page, "Army"), true);
      const frozen = {
        orders: ownOrders(await snapshot(page)),
        ids: await selected(page),
        camera: await camera(page),
        resources: (await snapshot(page)).resources,
      };
      const { start: anchor, end } = await swordsmanRectangle(page);
      await dispatchTouch(cdp, "touchStart", [{ ...anchor, id: 1 }]);
      await expect(page.locator("#selection-box.armed")).toBeVisible();
      if (interruption === "cancel") await dispatchTouch(cdp, "touchCancel");
      else {
        const viewport = page.viewportSize();
        await page.setViewportSize({
          width: viewport.height,
          height: viewport.width,
        });
        await expect(page.locator("#selection-box")).toBeHidden();
        await dispatchTouch(cdp, "touchMove", [{ ...end, id: 1 }]);
        await dispatchTouch(cdp, "touchEnd");
      }
      await expect(page.locator("#selection-box")).toBeHidden();
      expect(
        await page.locator("#battlefield").getAttribute("data-gesture"),
      ).toBeNull();
      expect(await selected(page)).toEqual(frozen.ids);
      expect(ownOrders(await snapshot(page))).toEqual(frozen.orders);
      expect((await snapshot(page)).resources).toEqual(frozen.resources);
      expect(await camera(page)).toEqual(frozen.camera);
    }

    // A second finger cancels an armed selection and zooms around its midpoint.
    await start(page, true);
    await activate(button(page, "Army"), true);
    await navigate(page, 22, 18, true);
    const stateBefore = await snapshot(page),
      selectedBefore = await selected(page);
    const center = await page.evaluate(() => {
      const top = document
        .querySelector(".topbar")
        .getBoundingClientRect().bottom;
      const bottom = document
        .querySelector(".command-dock")
        .getBoundingClientRect().top;
      return { x: innerWidth / 2, y: (top + bottom) / 2 };
    });
    const a = { x: center.x - 40, y: center.y, id: 1 },
      b = { x: center.x + 40, y: center.y, id: 2 };
    await unobscured(page, a);
    await unobscured(page, b);
    await dispatchTouch(cdp, "touchStart", [a]);
    await expect(page.locator("#selection-box.armed")).toBeVisible();
    await dispatchTouch(cdp, "touchStart", [a, b]);
    await expect(page.locator("#selection-box")).toBeHidden();
    const anchorBefore = await page.evaluate(
      (p) => window.frontierDebug.screenToWorld(p.x, p.y),
      center,
    );
    const oldZoom = (await camera(page)).zoom;
    await dispatchTouch(cdp, "touchMove", [
      { ...a, x: a.x - 35 },
      { ...b, x: b.x + 35 },
    ]);
    expect((await camera(page)).zoom).toBeGreaterThan(oldZoom);
    const anchorAfter = await page.evaluate(
      (p) => window.frontierDebug.screenToWorld(p.x, p.y),
      center,
    );
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 5);
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 5);
    await dispatchTouch(cdp, "touchEnd");
    await expect(page.locator("#selection-box")).toBeHidden();
    expect(await selected(page)).toEqual(selectedBefore);
    expect(ownOrders(await snapshot(page))).toEqual(ownOrders(stateBefore));
    expect((await snapshot(page)).resources).toEqual(stateBefore.resources);
  } finally {
    await cdp.detach();
  }
  info.annotations.push({
    type: "hold-probes",
    description: JSON.stringify(observations),
  });
  await mkdir("docs/performance", { recursive: true });
  await writeFile(
    `docs/performance/task005-gestures-${info.project.name}.json`,
    JSON.stringify(
      {
        configuredHoldMs: 320,
        observations,
        nativeAutomation:
          "Chromium CDP, emulated viewport; not physical-device usability",
      },
      null,
      2,
    ) + "\n",
  );
});

test("same-type selection, mixed units and group shortcuts remain precise", async ({
  page,
  isMobile,
}) => {
  await start(page, isMobile);
  const initial = await snapshot(page);
  const workers = initial.units.filter(
    (u) => u.faction === "player" && u.type === "worker",
  );
  const soldier = initial.units.find(
    (u) => u.faction === "player" && u.type === "swordsman",
  );
  await selectUnit(page, workers.at(-1), isMobile);
  const p = await point(page, workers.at(-1).x, workers.at(-1).y);
  p.y -= 16 * (await camera(page)).zoom;
  // Begin a new deliberate double gesture, then issue its two inputs without
  // waiting on diagnostic RPCs between them.
  await page.waitForTimeout(400);
  if (isMobile) {
    await page.touchscreen.tap(p.x, p.y);
    await page.touchscreen.tap(p.x, p.y);
  } else await page.mouse.dblclick(p.x, p.y);
  expect((await selected(page)).sort()).toEqual(
    workers.map((u) => u.id).sort(),
  );
  await expect(page.locator("#selection-info h3")).toHaveText(
    /^5 (units )?selected$/,
  );
  await expect(page.locator("#selection-info")).toContainText("5 workers");
  await activate(button(page, "Deselect"), isMobile);
  await selectUnit(page, soldier, isMobile);
  if (!isMobile) {
    const worker = workers.at(-1),
      q = await point(page, worker.x, worker.y);
    q.y -= 16 * (await camera(page)).zoom;
    await page.keyboard.down("Shift");
    await page.mouse.click(q.x, q.y);
    await page.keyboard.up("Shift");
    expect(new Set(await selected(page))).toEqual(
      new Set([worker.id, soldier.id]),
    );
    await page.keyboard.down("Shift");
    await page.mouse.click(q.x, q.y);
    await page.keyboard.up("Shift");
    expect(await selected(page)).toEqual([soldier.id]);
    await page.keyboard.down("Shift");
    await page.mouse.click(q.x, q.y);
    await page.keyboard.up("Shift");
    expect(new Set(await selected(page))).toEqual(
      new Set([worker.id, soldier.id]),
    );
  } else {
    // Center the cluster before drawing so portrait HUD panels do not cover
    // the rectangle's lower corner. The camera change is real minimap input.
    await navigate(page, 11.5, 25.5, true);
    await activate(button(page, "Select Area"), true);
    const units = [
      workers.at(-1),
      soldier,
      initial.units.find(
        (u) =>
          u.faction === "player" &&
          u.type === "swordsman" &&
          u.id !== soldier.id,
      ),
    ];
    const bounds = await page.evaluate(
      (ids) => {
        const points = window.frontierDebug
          .snapshot()
          .units.filter((u) => ids.includes(u.id))
          .map((u) => window.frontierDebug.worldToScreen(u.x, u.y));
        return {
          from: {
            x: Math.min(...points.map((p) => p.x)) - 12,
            y: Math.min(...points.map((p) => p.y)) - 12,
          },
          to: {
            x: Math.max(...points.map((p) => p.x)) + 12,
            y: Math.max(...points.map((p) => p.y)) + 12,
          },
        };
      },
      units.map((u) => u.id),
    );
    await rectangle(page, bounds.from, bounds.to);
    const chosen = new Set(await selected(page));
    const selectedUnits = (await snapshot(page)).units.filter((u) =>
      chosen.has(u.id),
    );
    expect(selectedUnits.some((u) => u.type === "worker")).toBe(true);
    expect(selectedUnits.some((u) => u.type === "swordsman")).toBe(true);
    expect(selectedUnits.every((u) => u.faction === "player" && u.hp > 0)).toBe(
      true,
    );
  }
  await expect(button(page, "Assault")).toBeVisible();
  const mixed = await selected(page);
  await navigate(page, 5.5, 20.5, isMobile);
  await field(page, 5.5, 20.5, isMobile, true);
  const assigned = (await snapshot(page)).units.filter((u) =>
    mixed.includes(u.id),
  );
  expect(
    assigned
      .filter((u) => u.type === "worker")
      .every((u) => u.order.type === "gather"),
  ).toBe(true);
  expect(
    assigned
      .filter((u) => u.type !== "worker")
      .every((u) => u.order.type === "idle"),
  ).toBe(true);
  await activate(button(page, "Stop"), isMobile);
  await activate(button(page, "Workers"), isMobile);
  expect((await selected(page)).sort()).toEqual(
    workers.map((u) => u.id).sort(),
  );
  await activate(button(page, "Army"), isMobile);
  expect(await selected(page)).toHaveLength(2);
  expect(ownOrders(await snapshot(page))).toEqual(ownOrders(initial));
  await activate(button(page, "Deselect"), isMobile);
  expect(await selected(page)).toEqual([]);
});

test("worker construction assistance and production queues use contextual controls", async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(50_000);
  await start(page, isMobile);
  const initial = await snapshot(page),
    workers = initial.units.filter(
      (u) => u.faction === "player" && u.type === "worker",
    );
  await selectUnit(page, workers[0], isMobile);
  for (const name of ["Gather", "Construct", "Move", "Stop"])
    await expect(button(page, name)).toBeVisible();
  await expect(button(page, "Attack")).toHaveCount(0);
  await activate(button(page, "Gather"), isMobile);
  await navigate(page, 5.5, 20.5, isMobile);
  await field(page, 5.5, 20.5, isMobile);
  let state = await snapshot(page),
    worker = state.units.find((u) => u.id === workers[0].id);
  expect(worker.order.type).toBe("gather");
  expect(state.nodes.find((n) => n.id === worker.order.targetId)?.type).toBe(
    "wood",
  );
  await activate(button(page, "Construct"), isMobile);
  await activate(button(page, "Farm"), isMobile);
  await navigate(page, 5.2, 23.2, isMobile);
  const stock = (await snapshot(page)).resources;
  await field(page, 5.2, 23.2, isMobile);
  if (await button(page, "Place building").isVisible())
    await activate(button(page, "Place building"), isMobile);
  state = await snapshot(page);
  const farm = state.buildings.find(
    (b) =>
      b.faction === "player" && b.type === "farm" && b.x === 5 && b.y === 23,
  );
  expect(farm).toBeTruthy();
  expect(farm.progress).toBeLessThan(1);
  expect(state.resources.wood).toBe(stock.wood - 40);
  await navigate(page, workers[1].x, workers[1].y, isMobile);
  await selectUnit(page, workers[1], isMobile);
  await activate(button(page, "Assist"), isMobile);
  await navigate(page, 6, 24, isMobile);
  const afterCost = (await snapshot(page)).resources;
  await field(page, 6, 24, isMobile);
  state = await snapshot(page);
  const assistant = state.units.find((u) => u.id === workers[1].id);
  expect(assistant.order).toEqual({ type: "build", targetId: farm.id });
  expect(state.resources).toEqual(afterCost);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).buildings.find((b) => b.id === farm.id)
          ?.progress ?? 0,
    )
    .toBeGreaterThan(farm.progress);
  const town = state.buildings.find(
    (b) => b.faction === "player" && b.type === "townCenter",
  );
  await selectBuilding(page, town, isMobile);
  for (const name of ["Worker", "Set Rally Point", "Clear Rally"])
    await expect(button(page, name)).toBeVisible();
  await expect(button(page, "Swordsman")).toHaveCount(0);
  await expect(button(page, "Assault")).toHaveCount(0);
  const food = (await snapshot(page)).resources.food;
  await activate(button(page, "Worker"), isMobile);
  await activate(button(page, "Worker"), isMobile);
  state = await snapshot(page);
  expect(state.resources.food).toBe(food - 70);
  expect(state.buildings.find((b) => b.id === town.id).queue).toHaveLength(2);
  await expect(
    page.getByLabel("Training queue", { exact: true }),
  ).toContainText("1. Worker");
  await expect(
    page.getByLabel("Training queue", { exact: true }),
  ).toContainText("2. Worker");
  await page.screenshot({
    path: `docs/screenshots/task005/${info.project.name}-context-production.png`,
  });
});

test("coordinated assault and retreat accept immediate new player orders", async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(40_000);
  await start(page, isMobile);
  await activate(button(page, "Army"), isMobile);
  const ids = await selected(page),
    initial = await snapshot(page);
  await navigate(page, 14.5, 20.5, isMobile);
  await activate(button(page, "Assault"), isMobile);
  expect(await page.evaluate(() => window.frontierDebug.mode())).toBe(
    "assault",
  );
  await field(page, 14.5, 20.5, isMobile);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).units.filter(
          (u) => ids.includes(u.id) && u.order.type === "assault",
        ).length,
    )
    .toBe(2);
  let state = await snapshot(page);
  const squad = state.assaults.find((a) => a.ids.includes(ids[0]));
  expect(squad).toBeTruthy();
  expect(
    new Set(
      state.units.filter((u) => ids.includes(u.id)).map((u) => u.order.squadId),
    ).size,
  ).toBe(1);
  await expect
    .poll(async () => {
      const current = await snapshot(page);
      return current.units
        .filter((u) => ids.includes(u.id))
        .some((u) => {
          const old = initial.units.find((v) => v.id === u.id);
          return Math.hypot(u.x - old.x, u.y - old.y) > 0.2;
        });
    })
    .toBe(true);
  await expect(page.locator("#selection-info")).toContainText(
    /regroup|advance|Assault/i,
  );
  await page.screenshot({
    path: `docs/screenshots/task005/${info.project.name}-assault.png`,
  });
  await activate(button(page, "Retreat"), isMobile);
  await navigate(page, 9.5, 20.5, isMobile);
  await field(page, 9.5, 20.5, isMobile);
  state = await snapshot(page);
  expect(
    state.units
      .filter((u) => ids.includes(u.id))
      .every((u) => u.order.type === "retreat"),
  ).toBe(true);
  expect(
    new Set(
      state.units
        .filter((u) => ids.includes(u.id))
        .map((u) => `${u.order.x},${u.order.y}`),
    ).size,
  ).toBe(2);
  expect(state.resources).toEqual(initial.resources);
  await expect(page.locator("#selection-info")).toContainText("Retreating");
  await page.screenshot({
    path: `docs/screenshots/task005/${info.project.name}-retreat.png`,
  });
  await navigate(page, 14.5, 20.5, isMobile);
  await field(page, 14.5, 20.5, isMobile, true);
  expect(
    (await snapshot(page)).units
      .filter((u) => ids.includes(u.id))
      .every((u) => u.order.type === "move"),
  ).toBe(true);
  await expect.poll(async () => (await snapshot(page)).assaults.length).toBe(0);
  await page.keyboard.press("k");
  expect(await page.evaluate(() => window.frontierDebug.mode())).toBe(
    "assault",
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  expect(await page.evaluate(() => window.frontierDebug.mode())).toBe(
    "retreat",
  );
  await page.keyboard.press("Escape");
  await activate(button(page, "Pause"), isMobile);
  await activate(page.locator("#restart-paused"), isMobile);
  state = await snapshot(page);
  expect(state.time).toBeLessThan(1);
  expect(state.assaults).toEqual([]);
  expect(
    state.units
      .filter((u) => u.faction === "player")
      .every((u) => u.order.type === "idle"),
  ).toBe(true);
});

test("battlefield journey selects, moves, attacks and retreats real combat survivors", async ({
  page,
  context,
  browserName,
  isMobile,
}, info) => {
  test.setTimeout(110_000);
  await start(page, isMobile);
  const initial = await snapshot(page),
    soldier = initial.units.find(
      (u) => u.faction === "player" && u.type === "swordsman",
    );
  await selectUnit(page, soldier, isMobile);
  await field(page, 9.5, 20.5, isMobile, true);
  await expect
    .poll(async () => {
      const u = (await snapshot(page)).units.find((u) => u.id === soldier.id);
      return Math.hypot(u.x - soldier.x, u.y - soldier.y);
    })
    .toBeGreaterThan(0.3);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).units.find((u) => u.id === soldier.id)?.order
          .type,
      { timeout: 12_000 },
    )
    .toBe("idle");
  const box = await swordsmanRectangle(page);
  if (browserName === "chromium") {
    const cdp = await context.newCDPSession(page);
    try {
      await dispatchTouch(cdp, "touchStart", [{ ...box.start, id: 1 }]);
      await expect(page.locator("#selection-box.armed")).toBeVisible();
      // Model a finger decelerating into its selection endpoint before lifting.
      // Abrupt constant-velocity CDP streams can suppress Chromium's next HUD
      // tap synthesis on this host. Fast-pan/cancellation probes stay unchanged.
      for (let step = 1; step <= 12; step++) {
        const progress = 1 - Math.pow(1 - step / 12, 3);
        await dispatchTouch(cdp, "touchMove", [
          {
            x: box.start.x + (box.end.x - box.start.x) * progress,
            y: box.start.y + (box.end.y - box.start.y) * progress,
            id: 1,
          },
        ]);
      }
      await expect(page.locator("#selection-box")).toBeVisible();
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            const started = performance.now();
            const frame = () =>
              performance.now() - started >= 120
                ? resolve()
                : requestAnimationFrame(frame);
            requestAnimationFrame(frame);
          }),
      );
      await dispatchTouch(cdp, "touchEnd");
    } finally {
      await cdp.detach();
    }
  } else {
    // Playwright WebKit has native tap support but no native touch-drag
    // injection. Exercise the explicit accessible Area route with real mouse
    // pointer input here; the native gesture limitation remains documented.
    await activate(button(page, "Select Area"), isMobile);
    await rectangle(page, box.start, box.end);
  }
  expect((await selected(page)).sort()).toEqual(box.ids);
  const target = (await snapshot(page)).units.find(
    (u) => u.faction === "enemy" && u.type === "infantry" && u.x < 30,
  );
  await navigate(page, target.x, target.y, isMobile);
  const p = await point(page, target.x, target.y);
  p.y -= 16 * (await camera(page)).zoom;
  await unobscured(page, p);
  if (isMobile) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y, { button: "right" });
  let state = await snapshot(page);
  expect(
    state.units
      .filter((u) => box.ids.includes(u.id))
      .every(
        (u) => u.order.type === "attack" && u.order.targetId === target.id,
      ),
  ).toBe(true);
  expect((await selected(page)).sort()).toEqual(box.ids);
  await expect
    .poll(
      async () =>
        page.evaluate(
          (ids) =>
            window.frontierDebug
              .snapshot()
              .units.some(
                (u) => ids.includes(u.id) && u.hp > 0 && u.hp < u.maxHp,
              ),
          box.ids,
        ),
      { timeout: 65_000, intervals: [100, 100, 100] },
    )
    .toBe(true);
  state = await snapshot(page);
  const injured = state.units.filter((u) => box.ids.includes(u.id) && u.hp > 0);
  expect(injured.length).toBeGreaterThan(0);
  expect(injured.some((u) => u.hp < u.maxHp)).toBe(true);
  await activate(button(page, "Retreat"), isMobile);
  await navigate(page, 21, 22, isMobile);
  await field(page, 18.5, 25.5, isMobile);
  state = await snapshot(page);
  const retreating = state.units.filter(
    (u) => box.ids.includes(u.id) && u.hp > 0,
  );
  expect(retreating.length).toBeGreaterThan(0);
  expect(retreating.every((u) => u.order.type === "retreat")).toBe(true);
  const retreatStart = new Map(
    retreating.map((u) => [
      u.id,
      {
        x: u.x,
        y: u.y,
        hp: u.hp,
        distance: Math.hypot(u.x - 18.5, u.y - 25.5),
      },
    ]),
  );
  await expect
    .poll(
      async () => {
        const current = (await snapshot(page)).units.filter(
          (u) => retreatStart.has(u.id) && u.hp > 0,
        );
        return current.some(
          (u) =>
            Math.hypot(u.x - 18.5, u.y - 25.5) <
            retreatStart.get(u.id).distance - 1,
        );
      },
      { timeout: 12_000, intervals: [100, 100, 100] },
    )
    .toBe(true);
  state = await snapshot(page);
  const survivors = state.units.filter(
    (u) => retreatStart.has(u.id) && u.hp > 0,
  );
  expect(survivors.length).toBeGreaterThan(0);
  expect(survivors.every((u) => u.hp <= retreatStart.get(u.id).hp)).toBe(true);
  expect(
    survivors.every(
      (u) => u.order.type === "retreat" || u.order.type === "idle",
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/screenshots/task005/${info.project.name}-combat-retreat.png`,
  });
  await field(page, 16.5, 25.5, isMobile, true);
  expect(
    (await snapshot(page)).units
      .filter((u) => survivors.some((v) => v.id === u.id) && u.hp > 0)
      .every((u) => u.order.type === "move"),
  ).toBe(true);
  const metrics = {
    initial: box.ids.length,
    aliveAtFirstInjury: injured.length,
    retreating: retreating.length,
    surviving: survivors.length,
    nativeHeldSelection: browserName === "chromium",
    retreatHP: retreating.map((u) => ({ id: u.id, hp: u.hp })),
    survivorHP: survivors.map((u) => ({ id: u.id, hp: u.hp })),
    retreatDistanceProgress: survivors.map((u) => ({
      id: u.id,
      tiles:
        retreatStart.get(u.id).distance - Math.hypot(u.x - 18.5, u.y - 25.5),
    })),
  };
  info.annotations.push({
    type: "real-combat-journey",
    description: JSON.stringify(metrics),
  });
  await mkdir("docs/performance", { recursive: true });
  await writeFile(
    `docs/performance/task005-journey-${info.project.name}.json`,
    JSON.stringify(metrics, null, 2) + "\n",
  );
});

test("a second UI surface cancels pending battlefield input without orders", async ({
  page,
  context,
  browserName,
  isMobile,
}, info) => {
  await start(page, isMobile);
  await activate(button(page, "Army"), isMobile);
  await activate(button(page, "Minimap"), isMobile);
  const frozen = {
    state: await snapshot(page),
    selected: await selected(page),
    camera: await camera(page),
  };
  const from = await point(page, 9.5, 20.5);
  await unobscured(page, from);
  const map = await page.locator("#minimap").boundingBox();
  const to = {
    x: map.x + (map.width * 24) / frozen.state.map.width,
    y: map.y + (map.height * 18) / frozen.state.map.height,
  };
  await page.keyboard.down("d");
  if (browserName === "chromium" && isMobile) {
    const cdp = await context.newCDPSession(page);
    await page.evaluate(() => {
      window.uiHandoffEvents = [];
      for (const type of ["pointerdown", "pointerup"])
        document.addEventListener(
          type,
          (e) =>
            window.uiHandoffEvents.push({
              type,
              id: e.pointerId,
              target: e.target.id,
              time: performance.now(),
            }),
          { capture: true },
        );
    });
    try {
      const pending = [dispatchTouch(cdp, "touchStart", [{ ...from, id: 1 }])];
      await new Promise((resolve) => setTimeout(resolve, 60));
      pending.push(
        dispatchTouch(cdp, "touchStart", [
          { ...from, id: 1 },
          { ...to, id: 2 },
        ]),
      );
      await new Promise((resolve) => setTimeout(resolve, 60));
      pending.push(dispatchTouch(cdp, "touchEnd"));
      await Promise.all(pending);
      const elapsed = await page.evaluate(() => {
        const down = window.uiHandoffEvents.find(
          (e) => e.type === "pointerdown" && e.target === "battlefield",
        );
        const up = window.uiHandoffEvents.find(
          (e) => e.type === "pointerup" && e.id === down.id,
        );
        return up.time - down.time;
      });
      expect(
        elapsed,
        "release occurs before hold-selection can mask the old pending tap bug",
      ).toBeLessThan(320);
      info.annotations.push({
        type: "native-handoff-ms",
        description: String(elapsed),
      });
    } finally {
      await cdp.detach();
    }
  } else {
    // WebKit has no native two-finger injection. This variant starts with real
    // mouse input, delivers a UI pointer interruption, then uses real release.
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.locator("#minimap").dispatchEvent("pointerdown", {
      ...to,
      clientX: to.x,
      clientY: to.y,
      pointerId: 91,
      pointerType: "touch",
      isPrimary: false,
      bubbles: true,
    });
    await page.mouse.up();
    info.annotations.push({
      type: "handoff-coverage",
      description:
        "Real mouse + DOM UI pointer interruption; not native multi-touch",
    });
  }
  expect(await selected(page)).toEqual(frozen.selected);
  expect(ownOrders(await snapshot(page))).toEqual(ownOrders(frozen.state));
  expect((await snapshot(page)).resources).toEqual(frozen.state.resources);
  expect(await camera(page)).not.toEqual(frozen.camera);
  const continued = await camera(page);
  const movementWaitStarted = Date.now();
  try {
    // A rendering stall may outlast a fixed wall sleep. Keep D held and wait
    // for actual further movement; a cleared key still fails this bounded poll.
    await expect
      .poll(
        async () => {
          const next = await camera(page);
          return Math.hypot(next.x - continued.x, next.y - continued.y);
        },
        {
          timeout: 5000,
          message: "held D keeps moving after UI gesture cancellation",
        },
      )
      .toBeGreaterThan(0.05);
    const moved = await camera(page);
    expect(moved.x).toBeGreaterThan(continued.x);
    expect(moved.y).toBeLessThan(continued.y);
    expect(moved.zoom).toBe(continued.zoom);
    info.annotations.push({
      type: "held-camera-movement",
      description: JSON.stringify({
        movementWaitWallMs: Date.now() - movementWaitStarted,
        dx: moved.x - continued.x,
        dy: moved.y - continued.y,
        zoom: moved.zoom,
      }),
    });
  } finally {
    await page.keyboard.up("d");
  }
  expect(await selected(page)).toEqual(frozen.selected);
  expect(ownOrders(await snapshot(page))).toEqual(ownOrders(frozen.state));
  expect((await snapshot(page)).resources).toEqual(frozen.state.resources);
  if (browserName === "chromium" && isMobile) {
    await navigate(page, 14.5, 20.5, true);
    await activate(button(page, "Recruit"), true);
    const fieldPoint = await point(page, 14.5, 20.5);
    await unobscured(page, fieldPoint);
    const paidButton = await button(page, "Worker").boundingBox();
    const paidPoint = {
      x: paidButton.x + paidButton.width / 2,
      y: paidButton.y + paidButton.height / 2,
    };
    const cdp = await context.newCDPSession(page);
    try {
      for (const first of ["field", "paidUI"]) {
        const before = await snapshot(page),
          oldSelected = await selected(page);
        const town = before.buildings.find(
          (b) => b.faction === "player" && b.type === "townCenter",
        );
        const a = first === "field" ? fieldPoint : paidPoint,
          b = first === "field" ? paidPoint : fieldPoint;
        const pending = [dispatchTouch(cdp, "touchStart", [{ ...a, id: 1 }])];
        await new Promise((resolve) => setTimeout(resolve, 60));
        pending.push(
          dispatchTouch(cdp, "touchStart", [
            { ...a, id: 1 },
            { ...b, id: 2 },
          ]),
        );
        await new Promise((resolve) => setTimeout(resolve, 60));
        pending.push(dispatchTouch(cdp, "touchEnd"));
        await Promise.all(pending);
        const after = await snapshot(page);
        expect(after.resources).toEqual(before.resources);
        expect(
          after.buildings
            .find((b) => b.id === town.id)
            .queue.map((q) => q.unitType),
        ).toEqual(town.queue.map((q) => q.unitType));
        expect(await selected(page)).toEqual(oldSelected);
        expect(ownOrders(after)).toEqual(ownOrders(before));
        // Gesture suppression must end at the next deliberate primary tap.
        await button(page, "Worker").tap();
        const legitimate = await snapshot(page);
        expect(legitimate.resources.food).toBe(before.resources.food - 35);
        expect(
          legitimate.buildings.find((b) => b.id === town.id).queue,
        ).toHaveLength(town.queue.length + 1);
      }
    } finally {
      await cdp.detach();
    }
  }
});
