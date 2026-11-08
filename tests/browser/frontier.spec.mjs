import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const snapshot = (page) => page.evaluate(() => window.frontierDebug.snapshot());
const point = (page, x, y) =>
  page.evaluate(([x, y]) => window.frontierDebug.worldToScreen(x, y), [x, y]);
async function fieldClick(page, x, y, touch = false, button = "left") {
  const p = await point(page, x, y);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y, { button });
}
async function start(page) {
  await page.goto("/?test=1");
  await page.getByRole("button", { name: "Play LAMMB Empires" }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on("pageerror", (error) => page.errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
});

test("entry and playable battlefield render without layout overflow", async ({
  page,
}, info) => {
  await mkdir("docs/screenshots/task003", { recursive: true });
  await page.goto("/?test=1");
  await expect(
    page.getByRole("button", { name: "Play LAMMB Empires" }),
  ).toBeVisible();
  await expect(page.locator("#entry a")).toHaveCount(1);
  await expect(page.locator("#entry a")).toHaveAttribute(
    "href",
    "https://opensea.io/collection/lammbs-59693791",
  );
  await page.screenshot({
    path: `docs/screenshots/task003/baseline-${info.project.name}-entry.png`,
  });
  await page.getByRole("button", { name: "Play LAMMB Empires" }).click();
  await expect(page.locator('[data-resource="wood"]')).toContainText("230");
  await expect(
    page.getByRole("button", { name: "Army", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Workers", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("#toast")).not.toHaveClass(/visible/, {
    timeout: 7000,
  });
  await page.screenshot({
    path: `docs/screenshots/task003/baseline-${info.project.name}-battlefield.png`,
  });
});

test("workers receive a gathering order and physically deliver supplies", async ({
  page,
  isMobile,
}) => {
  test.setTimeout(45_000);
  await start(page);
  await page.getByRole("button", { name: "Workers", exact: true }).click();
  await expect(page.locator("#selection-info")).toContainText(
    "5 units selected",
  );
  const before = (await snapshot(page)).resources.wood;
  await fieldClick(page, 5.5, 20.5, isMobile);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).units.filter(
          (u) => u.faction === "player" && u.order.type === "gather",
        ).length,
    )
    .toBe(5);
  await expect
    .poll(async () => (await snapshot(page)).resources.wood, {
      timeout: 30_000,
    })
    .toBeGreaterThan(before);
  const state = await snapshot(page);
  expect(
    state.nodes.find((node) => node.x === 5.5 && node.y === 20.5).amount,
  ).toBeLessThan(
    state.nodes.find((node) => node.x === 5.5 && node.y === 20.5).maxAmount,
  );
  expect(state.events.some((event) => event.type === "delivery")).toBe(true);
});

test("tapping a friendly farm with selected workers assigns food gathering", async ({
  page,
  isMobile,
}) => {
  await start(page);
  const farm = (await snapshot(page)).buildings.find(
    (b) => b.type === "farm" && b.faction === "player",
  );
  await page.getByRole("button", { name: "Workers", exact: true }).click();
  await fieldClick(
    page,
    farm.x + farm.width / 2,
    farm.y + farm.height / 2,
    isMobile,
  );
  await expect
    .poll(
      async () =>
        (await snapshot(page)).units.filter(
          (u) =>
            u.faction === "player" &&
            u.order.type === "gather" &&
            u.order.targetId === farm.id,
        ).length,
    )
    .toBe(5);
});

test("valid placement spends inventory and workers finish a functional farm", async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(45_000);
  await start(page);
  await page.getByRole("button", { name: "Workers", exact: true }).click();
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("button", { name: "Farm", exact: true }).click();
  const before = (await snapshot(page)).resources.wood;
  await fieldClick(page, 8.2, 24.2, isMobile);
  await expect(
    page.getByRole("button", { name: "Place building" }),
  ).toBeDisabled();
  expect((await snapshot(page)).resources.wood).toBe(before);
  await fieldClick(page, 5.2, 23.2, isMobile);
  if (isMobile) {
    await expect(
      page.getByRole("button", { name: "Place building" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Place building" }).click();
  }
  await expect
    .poll(
      async () =>
        (await snapshot(page)).buildings.filter(
          (b) => b.faction === "player" && b.type === "farm",
        ).length,
    )
    .toBe(2);
  expect((await snapshot(page)).resources.wood).toBe(before - 40);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).buildings.find((b) => b.x === 5 && b.y === 23)
          ?.progress,
      { timeout: 25_000 },
    )
    .toBe(1);
  const state = await snapshot(page);
  const farm = state.buildings.find((b) => b.x === 5 && b.y === 23);
  expect(
    state.units.some(
      (unit) =>
        unit.type === "worker" &&
        unit.order.type === "gather" &&
        unit.order.targetId === farm.id,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/screenshots/task003/baseline-${info.project.name}-construction.png`,
  });
});

test("recruitment spends food, queues training and adds a worker", async ({
  page,
}) => {
  test.setTimeout(40_000);
  await start(page);
  await page.getByRole("button", { name: "Recruit", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Archer", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Worker", exact: true }).click();
  const state = await snapshot(page);
  expect(state.resources.food).toBe(205);
  expect(
    state.buildings.find(
      (b) => b.type === "townCenter" && b.faction === "player",
    ).queue,
  ).toHaveLength(1);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).units.filter(
          (u) => u.faction === "player" && u.type === "worker",
        ).length,
      { timeout: 25_000 },
    )
    .toBe(6);
});

test("a constructed barracks unlocks timed archer recruitment", async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(75_000);
  await start(page);
  await page.getByRole("button", { name: "Workers", exact: true }).click();
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("button", { name: "Barracks", exact: true }).click();
  await fieldClick(page, 5.2, 23.2, isMobile);
  if (isMobile)
    await page.getByRole("button", { name: "Place building" }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).buildings.find(
          (b) => b.type === "barracks" && b.faction === "player",
        )?.progress,
      { timeout: 30_000 },
    )
    .toBe(1);
  await page.getByRole("button", { name: "Recruit", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Archer", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Archer", exact: true }).click();
  expect((await snapshot(page)).resources.food).toBe(205);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).units.some(
          (u) => u.type === "archer" && u.faction === "player",
        ),
      { timeout: 45_000 },
    )
    .toBe(true);
  await page.getByRole("button", { name: "Army", exact: true }).click();
  await page.screenshot({
    path: `docs/screenshots/task003/baseline-${info.project.name}-military.png`,
  });
});

test("minimap navigation and an attack command target the actual enemy settlement", async ({
  page,
  isMobile,
}) => {
  await start(page);
  const state = await snapshot(page);
  const enemy = state.buildings.find(
    (b) => b.faction === "enemy" && b.type === "townCenter",
  );
  const x = enemy.x + enemy.width / 2,
    y = enemy.y + enemy.height / 2;
  await page.getByRole("button", { name: "Army", exact: true }).click();
  const minimap = page.locator("#minimap"),
    bounds = await minimap.boundingBox();
  await minimap.click({
    position: {
      x: (bounds.width * x) / state.map.width,
      y: (bounds.height * y) / state.map.height,
    },
  });
  await page.getByRole("button", { name: "Attack", exact: true }).click();
  await fieldClick(page, x, y, isMobile);
  await expect
    .poll(
      async () =>
        (await snapshot(page)).units.filter(
          (u) =>
            u.faction === "player" &&
            u.order.type === "attack" &&
            u.order.targetId === enemy.id,
        ).length,
    )
    .toBe(2);
});

test("selection, move, attack-move and stop issue real unit orders", async ({
  page,
  isMobile,
}) => {
  await start(page);
  if (isMobile) {
    await page.getByRole("button", { name: "Army", exact: true }).click();
    await expect(page.locator("#selection-info")).toContainText(
      "2 units selected",
    );
  } else {
    const coordinates = await page.evaluate(() =>
      window.frontierDebug
        .snapshot()
        .units.filter((u) => u.faction === "player")
        .map((u) => window.frontierDebug.worldToScreen(u.x, u.y)),
    );
    const x0 = Math.min(...coordinates.map((p) => p.x)) - 12,
      x1 = Math.max(...coordinates.map((p) => p.x)) + 12;
    const y0 = Math.min(...coordinates.map((p) => p.y)) - 12,
      y1 = Math.max(...coordinates.map((p) => p.y)) + 12;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator("#selection-info")).toContainText(
      "7 units selected",
    );
  }
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await fieldClick(page, 11.5, 23.5, isMobile);
  await expect
    .poll(async () =>
      (await snapshot(page)).units.some(
        (u) => u.faction === "player" && u.order.type === "move",
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Attack", exact: true }).click();
  await fieldClick(page, 11.5, 23.5, isMobile);
  await expect
    .poll(async () =>
      (await snapshot(page)).units.some(
        (u) => u.faction === "player" && u.order.type === "attackMove",
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect(
    (await snapshot(page)).units
      .filter((u) => u.faction === "player")
      .every((u) => u.order.type === "idle"),
  ).toBe(true);
});

test("camera pan and pinch or wheel zoom do not order the selected army", async ({
  page,
  context,
  isMobile,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Army", exact: true }).click();
  const before = await page.evaluate(() => window.frontierDebug.camera());
  if (isMobile) {
    const cdp = await context.newCDPSession(page);
    const send = (type, touchPoints) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
    await send("touchStart", [{ x: 170, y: 400, id: 1 }]);
    await send("touchMove", [{ x: 210, y: 420, id: 1 }]);
    await send("touchEnd", []);
    const panned = await page.evaluate(() => window.frontierDebug.camera());
    expect(
      Math.hypot(panned.x - before.x, panned.y - before.y),
    ).toBeGreaterThan(0.1);
    await send("touchStart", [
      { x: 140, y: 390, id: 1 },
      { x: 240, y: 390, id: 2 },
    ]);
    await send("touchMove", [
      { x: 110, y: 390, id: 1 },
      { x: 270, y: 390, id: 2 },
    ]);
    await send("touchEnd", []);
    await cdp.detach();
  } else {
    await page.keyboard.down("d");
    await page.waitForTimeout(150);
    await page.keyboard.up("d");
    const panned = await page.evaluate(() => window.frontierDebug.camera());
    expect(
      Math.hypot(panned.x - before.x, panned.y - before.y),
    ).toBeGreaterThan(0.1);
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, -200);
  }
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.frontierDebug.camera())).zoom,
    )
    .toBeGreaterThan(before.zoom);
  expect(
    (await snapshot(page)).units
      .filter((u) => u.faction === "player")
      .every((u) => u.order.type === "idle"),
  ).toBe(true);
});

test("pause freezes simulation and restart restores the starting settlement", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Recruit", exact: true }).click();
  await page.getByRole("button", { name: "Worker", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Expedition paused" }),
  ).toBeVisible();
  const frozen = (await snapshot(page)).time;
  await page.waitForTimeout(250);
  expect((await snapshot(page)).time).toBe(frozen);
  await page.locator("#restart-paused").click();
  const state = await snapshot(page);
  expect(state.resources).toEqual({
    wood: 230,
    stone: 150,
    food: 240,
    gold: 100,
  });
  expect(state.time).toBeLessThan(1);
  expect(state.units.filter((u) => u.faction === "player")).toHaveLength(7);
  expect(
    state.buildings.find(
      (b) => b.type === "townCenter" && b.faction === "player",
    ).queue,
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect
    .poll(async () => (await snapshot(page)).time)
    .toBeGreaterThan(state.time);
});
