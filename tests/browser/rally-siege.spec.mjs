import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const snapshot = (page) => page.evaluate(() => window.frontierDebug.snapshot());
const selected = (page) => page.evaluate(() => window.frontierDebug.selected());
const camera = (page) => page.evaluate(() => window.frontierDebug.camera());
const button = (page, name) => page.getByRole("button", { name, exact: true });

async function activate(locator, touch) {
  if (touch) await locator.tap();
  else await locator.click();
}
async function start(page, touch) {
  await page.goto("/?test=1");
  await activate(button(page, "Play LAMMB Empires"), touch);
  await expect(button(page, "Pause")).toBeVisible();
}
async function closePanels(page, touch) {
  if (await page.locator(".mission").isVisible())
    await activate(button(page, "Objectives"), touch);
  if (await page.locator("#minimap").isVisible())
    await activate(button(page, "Minimap"), touch);
}
async function navigate(page, x, y, touch) {
  if (!(await page.locator("#minimap").isVisible()))
    await activate(button(page, "Minimap"), touch);
  const state = await snapshot(page),
    bounds = await page.locator("#minimap").boundingBox();
  const position = {
    x: (bounds.width * x) / state.map.width,
    y: (bounds.height * y) / state.map.height,
  };
  if (touch) await page.locator("#minimap").tap({ position });
  else await page.locator("#minimap").click({ position });
  await closePanels(page, touch);
}
async function field(page, x, y, touch) {
  const p = await page.evaluate(
    ([x, y]) => window.frontierDebug.worldToScreen(x, y),
    [x, y],
  );
  const target = await page.evaluate(
    ({ x, y }) => ({
      id: document.elementFromPoint(x, y)?.id,
      width: innerWidth,
      height: innerHeight,
    }),
    p,
  );
  expect(p.x).toBeGreaterThanOrEqual(0);
  expect(p.x).toBeLessThan(target.width);
  expect(p.y).toBeGreaterThanOrEqual(0);
  expect(p.y).toBeLessThan(target.height);
  expect(target.id, "destination is actual unobscured battlefield").toBe(
    "battlefield",
  );
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}
async function selectBuilding(page, entity, touch) {
  await navigate(
    page,
    entity.x + entity.width / 2,
    entity.y + entity.height / 2,
    touch,
  );
  // Tap the visible roof, not a foreground builder standing over the floor pixel.
  const roof = await page.evaluate(
    ([x, y]) => {
      const p = window.frontierDebug.worldToScreen(x, y);
      return { x: p.x, y: p.y - 45 * window.frontierDebug.camera().zoom };
    },
    [entity.x + entity.width / 2, entity.y + entity.height / 2],
  );
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.id,
      roof,
    ),
  ).toBe("battlefield");
  if (touch) await page.touchscreen.tap(roof.x, roof.y);
  else await page.mouse.click(roof.x, roof.y);
  expect(await selected(page)).toContain(entity.id);
  await activate(button(page, "Command"), touch);
}
async function rally(page, producer, destination, touch) {
  await selectBuilding(page, producer, touch);
  await activate(button(page, "Set Rally Point"), touch);
  expect(await page.evaluate(() => window.frontierDebug.mode())).toBe("rally");
  await navigate(page, destination.x, destination.y, touch);
  await field(page, destination.x, destination.y, touch);
  await expect(button(page, "Confirm Rally")).toBeEnabled();
  await activate(button(page, "Confirm Rally"), touch);
  return (await snapshot(page)).buildings.find((b) => b.id === producer.id)
    .rally;
}
async function reachable(locator) {
  await expect(locator).toBeVisible();
  const before = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect(),
      h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return (
      r.x >= 0 &&
      r.y >= 0 &&
      r.right <= innerWidth &&
      r.bottom <= innerHeight &&
      !!h &&
      (h === el || el.contains(h))
    );
  });
  if (!before) await locator.scrollIntoViewIfNeeded();
  const r = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect(),
      h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      x: r.x,
      y: r.y,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      w: innerWidth,
      h: innerHeight,
      hit: !!h && (h === el || el.contains(h)),
    };
  });
  expect(r.x).toBeGreaterThanOrEqual(-0.5);
  expect(r.y).toBeGreaterThanOrEqual(-0.5);
  expect(r.right).toBeLessThanOrEqual(r.w + 0.5);
  expect(r.bottom).toBeLessThanOrEqual(r.h + 0.5);
  expect(r.width).toBeGreaterThanOrEqual(43.5);
  expect(r.height).toBeGreaterThanOrEqual(43.5);
  expect(r.hit).toBe(true);
}

test.beforeEach(async ({ page }) => {
  page.runtimeErrors = [];
  page.on("pageerror", (error) => page.runtimeErrors.push(error.message));
  await mkdir("docs/screenshots/task005", { recursive: true });
});
test.afterEach(async ({ page }) => expect(page.runtimeErrors).toEqual([]));

test("a trained worker follows its resource rally and physically delivers finite supplies", async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(75_000);
  await start(page, isMobile);
  const original = await snapshot(page),
    tc = original.buildings.find(
      (b) => b.faction === "player" && b.type === "townCenter",
    );
  const node = original.nodes.find(
    (n) => n.type === "wood" && n.x === 5.5 && n.y === 20.5,
  );
  const instruction = await rally(page, tc, node, isMobile);
  expect(instruction.type).toBe("gather");
  expect(instruction.targetId).toBe(node.id);
  expect((await snapshot(page)).resources).toEqual(original.resources);
  await activate(button(page, "Recruit"), isMobile);
  await activate(button(page, "Worker"), isMobile);
  expect((await snapshot(page)).resources.food).toBe(
    original.resources.food - 35,
  );
  await expect
    .poll(
      async () =>
        (await snapshot(page)).units.filter(
          (u) => u.faction === "player" && u.type === "worker",
        ).length,
      { timeout: 25_000 },
    )
    .toBe(6);
  const born = (await snapshot(page)).units.find(
    (u) =>
      u.faction === "player" &&
      u.type === "worker" &&
      !original.units.some((v) => v.id === u.id),
  );
  expect(born.order.type).toBe("gather");
  expect(born.order.targetId).toBe(node.id);
  await expect
    .poll(async () => (await snapshot(page)).resources.wood, {
      timeout: 30_000,
    })
    .toBeGreaterThan(original.resources.wood);
  const after = await snapshot(page),
    resource = after.nodes.find((n) => n.id === node.id),
    unit = after.units.find((u) => u.id === born.id);
  expect(resource.amount).toBeLessThan(node.amount);
  expect(Math.hypot(unit.x - born.x, unit.y - born.y)).toBeGreaterThan(0.1);
  const extracted = node.amount - resource.amount,
    banked = after.resources.wood - original.resources.wood,
    cargo = unit.carry?.type === "wood" ? unit.carry.amount : 0;
  expect(Math.abs(extracted - banked - cargo)).toBeLessThan(0.001);
  await selectBuilding(page, tc, isMobile);
  await page.screenshot({
    path: `docs/screenshots/task005/${info.project.name}-worker-rally.png`,
  });
});

test("rally instructions require confirmation, can be replaced and cleared without spending", async ({
  page,
  isMobile,
}) => {
  test.setTimeout(45_000);
  await start(page, isMobile);
  const initial = await snapshot(page),
    tc = initial.buildings.find(
      (b) => b.faction === "player" && b.type === "townCenter",
    );
  await selectBuilding(page, tc, isMobile);
  await reachable(button(page, "Set Rally Point"));
  await activate(button(page, "Set Rally Point"), isMobile);
  await navigate(page, 14.5, 25.5, isMobile);
  await field(page, 14.5, 25.5, isMobile);
  expect(
    (await snapshot(page)).buildings.find((b) => b.id === tc.id).rally ?? null,
  ).toBe(null);
  await reachable(button(page, "Confirm Rally"));
  await activate(button(page, "Cancel"), isMobile);
  expect(
    (await snapshot(page)).buildings.find((b) => b.id === tc.id).rally ?? null,
  ).toBe(null);
  const first = await rally(page, tc, { x: 14.5, y: 25.5 }, isMobile);
  expect(first.type).toBe("move");
  const next = await rally(page, tc, { x: 16.5, y: 24.5 }, isMobile);
  expect({ x: next.x, y: next.y }).not.toEqual({ x: first.x, y: first.y });
  await selectBuilding(page, tc, isMobile);
  await reachable(button(page, "Clear Rally"));
  await activate(button(page, "Clear Rally"), isMobile);
  expect(
    (await snapshot(page)).buildings.find((b) => b.id === tc.id).rally ?? null,
  ).toBe(null);
  expect((await snapshot(page)).resources).toEqual(initial.resources);
});

test("a worker-built workshop trains a physical ram that follows its rally through rotation", async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(150_000);
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
  await start(page, isMobile);
  await closePanels(page, isMobile);
  await activate(button(page, "Workers"), isMobile);
  await activate(button(page, "Build"), isMobile);
  await reachable(button(page, "Siege Workshop"));
  const before = await snapshot(page);
  await activate(button(page, "Siege Workshop"), isMobile);
  await navigate(page, 5.2, 23.2, isMobile);
  await field(page, 5.2, 23.2, isMobile);
  if (await button(page, "Place building").isVisible())
    await activate(button(page, "Place building"), isMobile);
  await expect
    .poll(async () =>
      (await snapshot(page)).buildings.some(
        (b) =>
          b.type === "workshop" &&
          b.faction === "player" &&
          b.x === 5 &&
          b.y === 23,
      ),
    )
    .toBe(true);
  let state = await snapshot(page),
    workshop = state.buildings.find(
      (b) => b.type === "workshop" && b.faction === "player",
    );
  expect(workshop.progress).toBeLessThan(1);
  expect(state.resources.wood).toBeLessThan(before.resources.wood);
  expect(state.resources.stone).toBeLessThan(before.resources.stone);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).buildings.find((b) => b.id === workshop.id)
          ?.progress,
      { timeout: 35_000 },
    )
    .toBe(1);
  workshop = (await snapshot(page)).buildings.find((b) => b.id === workshop.id);
  const instruction = await rally(
    page,
    workshop,
    { x: 16.5, y: 24.5 },
    isMobile,
  );
  expect(instruction.type).toBe("move");
  await activate(button(page, "Recruit"), isMobile);
  await reachable(button(page, "Siege Ram"));
  await expect(button(page, "Siege Ram")).toBeEnabled();
  const stock = (await snapshot(page)).resources;
  await activate(button(page, "Siege Ram"), isMobile);
  state = await snapshot(page);
  expect(state.resources.wood).toBeLessThan(stock.wood);
  expect(state.resources.gold).toBeLessThan(stock.gold);
  expect(
    state.buildings
      .find((b) => b.id === workshop.id)
      .queue.some((q) => q.unitType === "ram"),
  ).toBe(true);
  if (isMobile) {
    await activate(button(page, "Pause"), true);
    const frozen = {
      state: await snapshot(page),
      camera: await camera(page),
      selected: await selected(page),
    };
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(button(page, "Resume")).toBeVisible();
    expect({
      state: await snapshot(page),
      camera: await camera(page),
      selected: await selected(page),
    }).toEqual(frozen);
    await activate(button(page, "Resume"), true);
    await page.setViewportSize({ width: 390, height: 844 });
    const continued = await snapshot(page);
    expect(continued.buildings.find((b) => b.id === workshop.id).rally).toEqual(
      instruction,
    );
    expect(
      continued.buildings.find((b) => b.id === workshop.id).queue[0].remaining,
    ).toBeLessThanOrEqual(
      frozen.state.buildings.find((b) => b.id === workshop.id).queue[0]
        .remaining,
    );
    expect(await camera(page)).toEqual(frozen.camera);
    expect(await selected(page)).toEqual(frozen.selected);
    await page.setViewportSize({ width: 844, height: 390 });
  }
  await expect
    .poll(
      async () =>
        (await snapshot(page)).units.some(
          (u) => u.type === "ram" && u.faction === "player",
        ),
      { timeout: 60_000 },
    )
    .toBe(true);
  state = await snapshot(page);
  const ram = state.units.find(
    (u) => u.type === "ram" && u.faction === "player",
  );
  expect(ram.order.type).toBe("move");
  expect(
    ram.x >= workshop.x &&
      ram.x < workshop.x + workshop.width &&
      ram.y >= workshop.y &&
      ram.y < workshop.y + workshop.height,
  ).toBe(false);
  await expect
    .poll(
      async () => {
        const u = (await snapshot(page)).units.find((u) => u.id === ram.id);
        return Math.hypot(u.x - instruction.x, u.y - instruction.y);
      },
      { timeout: 25_000 },
    )
    .toBeLessThan(1.2);
  const moved = (await snapshot(page)).units.find((u) => u.id === ram.id);
  expect(Math.hypot(moved.x - ram.x, moved.y - ram.y)).toBeGreaterThan(2);
  await selectBuilding(page, workshop, isMobile);
  await navigate(page, 13, 25, isMobile);
  await page.screenshot({
    path: `docs/screenshots/task005/${info.project.name}-ram-rally.png`,
  });
  await activate(button(page, "Pause"), isMobile);
  await activate(page.locator("#restart-paused"), isMobile);
  state = await snapshot(page);
  expect(state.units.some((u) => u.type === "ram")).toBe(false);
  expect(state.buildings.some((b) => b.type === "workshop" || b.rally)).toBe(
    false,
  );
});
