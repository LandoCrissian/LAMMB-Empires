import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const snap = (page) => page.evaluate(() => window.frontierDebug.snapshot());
const camera = (page) => page.evaluate(() => window.frontierDebug.camera());
const selection = (page) =>
  page.evaluate(() => window.frontierDebug.selected());
const project = (page, x, y) =>
  page.evaluate(([x, y]) => window.frontierDebug.worldToScreen(x, y), [x, y]);
const button = (page, name) => page.getByRole("button", { name, exact: true });

async function start(page) {
  await page.goto("/?test=1");
  await button(page, "Play LAMMB Empires").tap();
  await expect(button(page, "Pause")).toBeVisible();
}

async function fieldTap(page, x, y) {
  const p = await project(page, x, y);
  const canvas = await page.locator("#battlefield").boundingBox();
  expect(
    p.x,
    `field destination ${x},${y} stays inside canvas`,
  ).toBeGreaterThanOrEqual(canvas.x);
  expect(p.x).toBeLessThan(canvas.x + canvas.width);
  expect(p.y).toBeGreaterThanOrEqual(canvas.y);
  expect(p.y).toBeLessThan(canvas.y + canvas.height);
  expect(
    await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, p),
    "battlefield destination is not covered by HUD",
  ).toBe("battlefield");
  await page.touchscreen.tap(p.x, p.y);
}

async function navigateMap(page, x, y) {
  if (!(await page.locator("#minimap").isVisible()))
    await button(page, "Minimap").tap();
  const map = page.locator("#minimap");
  await expect(button(page, "Minimap")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(map).toBeVisible();
  const state = await snap(page),
    bounds = await map.boundingBox();
  expect(
    bounds,
    "visible minimap exposes a measurable interaction surface",
  ).not.toBeNull();
  await map.tap({
    position: {
      x: (bounds.width * x) / state.map.width,
      y: (bounds.height * y) / state.map.height,
    },
  });
  // Map popovers close explicitly; tapping the field must not be needed to dismiss.
  if (
    await page
      .locator("body")
      .evaluate((el) => el.classList.contains("compact-landscape"))
  ) {
    if (await map.isVisible()) await button(page, "Minimap").tap();
    await expect(button(page, "Minimap")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(map).toBeHidden();
  }
}

async function reachable(locator, { minimum = 0 } = {}) {
  await expect(locator).toBeVisible();
  // WebKit waits for animation frames even when a scroll request has nothing to
  // scroll. Only request scrolling for a clipped/covered control; native taps
  // still perform their own actionability checks, and every geometry/hit assertion
  // below is retained. This matters on software-rendered high-DPI CI viewports.
  const alreadyReachable = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    return (
      r.left >= 0 &&
      r.top >= 0 &&
      r.right <= innerWidth &&
      r.bottom <= innerHeight &&
      !!hit &&
      (hit === el || el.contains(hit))
    );
  });
  if (!alreadyReachable) await locator.scrollIntoViewIfNeeded();
  const result = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2,
      y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      hit: !!hit && (hit === el || el.contains(hit)),
    };
  });
  expect(result.left).toBeGreaterThanOrEqual(-0.5);
  expect(result.top).toBeGreaterThanOrEqual(-0.5);
  expect(result.right).toBeLessThanOrEqual(result.viewportWidth + 0.5);
  expect(result.bottom).toBeLessThanOrEqual(result.viewportHeight + 0.5);
  expect(result.hit, "control center is not obscured by another panel").toBe(
    true,
  );
  if (minimum) {
    expect(result.width).toBeGreaterThanOrEqual(minimum - 0.5);
    expect(result.height).toBeGreaterThanOrEqual(minimum - 0.5);
  }
}

async function checkCommands(page) {
  for (const name of [
    "Pause",
    "Controls",
    "Workers",
    "Army",
    "Command",
    "Build",
    "Recruit",
    "Select Area",
    "Pan",
  ])
    await reachable(button(page, name), { minimum: 44 });
  await button(page, "Army").tap();
  await button(page, "Command").tap();
  for (const name of [
    "Move",
    "Attack",
    "Hold Position",
    "Assault",
    "Retreat",
    "Stop",
    "Deselect",
  ])
    await reachable(button(page, name), { minimum: 44 });
  await button(page, "Workers").tap();
  for (const name of ["Gather", "Construct", "Move", "Stop"])
    await reachable(button(page, name), { minimum: 44 });
  await expect(button(page, "Assault")).toHaveCount(0);
  await expect(button(page, "Hold Position")).toHaveCount(0);
  await button(page, "Build").tap();
  for (const name of ["Farm", "Barracks", "Watchtower", "Siege Workshop"])
    await reachable(button(page, name), { minimum: 44 });
  await button(page, "Recruit").tap();
  for (const name of ["Worker", "Swordsman", "Archer", "Siege Ram"])
    await reachable(button(page, name), { minimum: 44 });
  await button(page, "Command").tap();
  await fieldTap(page, 9.5, 25.5);
  for (const name of ["Set Rally Point", "Clear Rally"])
    await reachable(button(page, name), { minimum: 44 });
  await reachable(button(page, "Worker"), { minimum: 44 });
  await expect(button(page, "Swordsman")).toHaveCount(0);
  await button(page, "Army").tap();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on("pageerror", (error) => page.errors.push(error.message));
});
test.afterEach(async ({ page }) => expect(page.errors).toEqual([]));

const viewports = [
  { label: "iphone-portrait", width: 390, height: 844 },
  { label: "iphone-landscape", width: 844, height: 390 },
  { label: "large-iphone-landscape", width: 932, height: 430 },
  { label: "compact-landscape", width: 667, height: 375 },
  { label: "android-landscape", width: 915, height: 412 },
  { label: "tablet", width: 1024, height: 768 },
  { label: "desktop", width: 1440, height: 900 },
];

for (const viewport of viewports) {
  test(`${viewport.width}x${viewport.height} ${viewport.label}: entry and commands remain reachable`, async ({
    page,
  }, info) => {
    // The expanded audit checks military, worker and production contexts plus
    // stable selection controls, then encodes two high-DPI images. Its largest
    // local case takes 43.7 seconds with two workers. Budget this whole sequence
    // for software-rendered CI; native actionability and individual assertion
    // deadlines stay unchanged, with no forced actions or retries.
    test.setTimeout(90_000);
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await mkdir("docs/screenshots/task005", { recursive: true });
    await page.goto("/?test=1");
    await reachable(button(page, "Play LAMMB Empires"), { minimum: 44 });
    await expect(page.locator("#entry a")).toHaveAttribute(
      "href",
      "https://opensea.io/collection/lammbs-59693791",
    );
    await reachable(page.locator("#entry a"));
    await page.screenshot({
      path: `docs/screenshots/task005/${info.project.name}-${viewport.label}-entry.png`,
    });
    await button(page, "Play LAMMB Empires").tap();
    await checkCommands(page);
    const readResources = () =>
      page.locator("[data-resource]").evaluateAll((elements) =>
        elements.map((el) => {
          const r = el.getBoundingClientRect();
          return {
            name: el.dataset.resource,
            text: el.textContent,
            visible:
              el.isConnected &&
              r.width > 0 &&
              r.height > 0 &&
              r.left >= 0 &&
              r.top >= 0 &&
              r.right <= innerWidth &&
              r.bottom <= innerHeight,
          };
        }),
      );
    await expect
      .poll(async () => (await readResources()).every((item) => item.visible))
      .toBe(true);
    const resources = await readResources();
    expect(resources.map((item) => item.name)).toEqual([
      "wood",
      "stone",
      "food",
      "gold",
    ]);
    expect(resources.every((item) => item.visible)).toBe(true);
    const landscape = viewport.width > viewport.height && viewport.height < 550;
    if (landscape) {
      await reachable(button(page, "Objectives"), { minimum: 44 });
      await reachable(button(page, "Minimap"), { minimum: 44 });
      const openShare = await page.evaluate(() => {
        let open = 0,
          total = 0;
        for (let gy = 0; gy < 10; gy++)
          for (let gx = 0; gx < 20; gx++) {
            total++;
            if (
              document.elementFromPoint(
                ((gx + 0.5) * innerWidth) / 20,
                ((gy + 0.5) * innerHeight) / 10,
              )?.id === "battlefield"
            )
              open++;
          }
        return open / total;
      });
      expect(
        openShare,
        "compact HUD leaves at least45% of viewport directly playable",
      ).toBeGreaterThan(0.45);
      await button(page, "Objectives").tap();
      await expect(page.locator(".mission")).toBeVisible();
      await button(page, "Objectives").tap();
      await expect(page.locator(".mission")).toBeHidden();
      await button(page, "Minimap").tap();
      await expect(page.locator("#minimap")).toBeVisible();
      await button(page, "Minimap").tap();
    }
    await expect(page.locator("#toast")).not.toHaveClass(/visible/, {
      timeout: 7000,
    });
    await page.screenshot({
      path: `docs/screenshots/task005/${info.project.name}-${viewport.label}-active.png`,
    });
  });
}

test("portrait landscape portrait preserves a live expedition and accepts tactical commands", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await button(page, "Workers").tap();
  const originalWood = (await snap(page)).resources.wood;
  await fieldTap(page, 5.5, 20.5);
  await expect
    .poll(async () => (await snap(page)).resources.wood, { timeout: 30_000 })
    .toBeGreaterThan(originalWood);
  await button(page, "Build").tap();
  await button(page, "Barracks").tap();
  await fieldTap(page, 5.2, 23.2);
  await button(page, "Place building").tap();
  await button(page, "Recruit").tap();
  await button(page, "Worker").tap();
  await button(page, "Army").tap();
  await navigateMap(page, 17, 23);
  await button(page, "Pause").tap();
  const before = {
    state: await snap(page),
    selected: await selection(page),
    camera: await camera(page),
  };
  expect(
    before.state.buildings.some(
      (b) => b.type === "barracks" && b.faction === "player" && b.progress < 1,
    ),
  ).toBe(true);
  expect(
    before.state.buildings.some(
      (b) => b.faction === "player" && b.queue.length > 0,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(button(page, "Resume")).toBeVisible();
  expect(await snap(page)).toEqual(before.state);
  expect(await selection(page)).toEqual(before.selected);
  expect(await camera(page)).toEqual(before.camera);
  const roundtrip = await page.evaluate(() => {
    const p = window.frontierDebug.worldToScreen(17, 23);
    return window.frontierDebug.screenToWorld(p.x, p.y);
  });
  expect(roundtrip.x).toBeCloseTo(17, 8);
  expect(roundtrip.y).toBeCloseTo(23, 8);
  await button(page, "Resume").tap();
  await button(page, "Command").tap();
  await button(page, "Move").tap();
  await fieldTap(page, 17, 23);
  await expect
    .poll(
      async () =>
        (await snap(page)).units.filter(
          (u) => before.selected.includes(u.id) && u.order.type === "move",
        ).length,
    )
    .toBe(2);
  await button(page, "Hold Position").tap();
  await expect
    .poll(
      async () =>
        (await snap(page)).units.filter(
          (u) => before.selected.includes(u.id) && u.order.type === "hold",
        ).length,
    )
    .toBe(2);
  await button(page, "Attack").tap();
  await fieldTap(page, 17.5, 22.5);
  await expect
    .poll(async () =>
      (await snap(page)).units.some(
        (u) => before.selected.includes(u.id) && u.order.type === "attackMove",
      ),
    )
    .toBe(true);
  await navigateMap(page, 34.5, 9.5);
  await button(page, "Attack").tap();
  await fieldTap(page, 34.5, 9.5);
  const enemy = (await snap(page)).buildings.find(
    (b) => b.type === "townCenter" && b.faction === "enemy",
  );
  await expect
    .poll(
      async () =>
        (await snap(page)).units.filter(
          (u) =>
            before.selected.includes(u.id) &&
            u.order.type === "attack" &&
            u.order.targetId === enemy.id,
        ).length,
    )
    .toBe(2);
  await navigateMap(page, 13, 29);
  await button(page, "Workers").tap();
  await button(page, "Build").tap();
  await button(page, "Farm").tap();
  await fieldTap(page, 13.2, 29.2);
  await reachable(button(page, "Place building"), { minimum: 44 });
  await button(page, "Place building").tap();
  await expect
    .poll(async () =>
      (await snap(page)).buildings.some(
        (b) =>
          b.faction === "player" &&
          b.type === "farm" &&
          b.x === 13 &&
          b.y === 29,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: `docs/screenshots/task005/${info.project.name}-rotation-landscape.png`,
  });
  await button(page, "Pause").tap();
  const landscape = {
    state: await snap(page),
    selected: await selection(page),
    camera: await camera(page),
  };
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await snap(page)).toEqual(landscape.state);
  expect(await selection(page)).toEqual(landscape.selected);
  expect(await camera(page)).toEqual(landscape.camera);
  await button(page, "Resume").tap();
  await expect
    .poll(async () => (await snap(page)).time)
    .toBeGreaterThan(landscape.state.time);
  await page.screenshot({
    path: `docs/screenshots/task005/${info.project.name}-rotation-portrait.png`,
  });
  await button(page, "Pause").tap();
  await page.locator("#restart-paused").tap();
  expect((await snap(page)).time).toBeLessThan(1);
  expect(
    (await snap(page)).units.filter((u) => u.faction === "player"),
  ).toHaveLength(7);
});

test("Hold and Stop cancel armed pointer modes, and J holds the selected army", async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await start(page);
  await button(page, "Army").tap();
  const ids = await selection(page);
  await button(page, "Move").tap();
  expect(await page.evaluate(() => window.frontierDebug.mode())).toBe("move");
  await button(page, "Hold Position").tap();
  expect(await page.evaluate(() => window.frontierDebug.mode())).toBe("select");
  expect(
    (await snap(page)).units
      .filter((u) => ids.includes(u.id))
      .every((u) => u.order.type === "hold"),
  ).toBe(true);
  // Hold clears the armed Move mode. A subsequent deliberate touch is a new
  // contextual movement order under the command-first interaction contract.
  await fieldTap(page, 11.5, 23.5);
  expect(
    (await snap(page)).units
      .filter((u) => ids.includes(u.id))
      .every((u) => u.order.type === "move"),
  ).toBe(true);
  await button(page, "Army").tap();
  await button(page, "Attack").tap();
  expect(await page.evaluate(() => window.frontierDebug.mode())).toBe("attack");
  await button(page, "Stop").tap();
  expect(await page.evaluate(() => window.frontierDebug.mode())).toBe("select");
  expect(
    (await snap(page)).units
      .filter((u) => ids.includes(u.id))
      .every((u) => u.order.type === "idle"),
  ).toBe(true);
  // Stop cancels armed Attack. The fresh touch must move, never attack-move.
  await fieldTap(page, 9.5, 20.5);
  expect(
    (await snap(page)).units
      .filter((u) => ids.includes(u.id))
      .every((u) => u.order.type === "move"),
  ).toBe(true);
  await button(page, "Army").tap();
  await page.keyboard.press("j");
  expect(
    (await snap(page)).units
      .filter((u) => ids.includes(u.id))
      .every((u) => u.order.type === "hold"),
  ).toBe(true);
});

test("an unpaused rotation keeps training, military destinations and the tactical camera running", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await button(page, "Recruit").tap();
  await button(page, "Worker").tap();
  await button(page, "Army").tap();
  await navigateMap(page, 23, 15);
  await button(page, "Command").tap();
  await button(page, "Move").tap();
  await fieldTap(page, 23, 15);
  const ids = await selection(page),
    before = await snap(page),
    oldCamera = await camera(page);
  const orders = before.units
    .filter((u) => ids.includes(u.id))
    .map((u) => ({ id: u.id, order: u.order }));
  expect(orders.every((u) => u.order.type === "move")).toBe(true);
  const queue = before.buildings.find(
    (b) => b.faction === "player" && b.type === "townCenter",
  ).queue[0];
  for (const viewport of [
    { width: 844, height: 390 },
    { width: 844, height: 350 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await selection(page)).toEqual(ids);
    expect(await camera(page)).toEqual(oldCamera);
    const state = await snap(page);
    expect(state.tick).toBeGreaterThanOrEqual(before.tick);
    expect(state.resources).toEqual(before.resources);
    expect(state.buildings).toHaveLength(before.buildings.length);
    expect(
      state.units
        .filter((u) => ids.includes(u.id))
        .map((u) => ({ id: u.id, order: u.order })),
    ).toEqual(orders);
    const activeQueue = state.buildings.find(
      (b) => b.faction === "player" && b.type === "townCenter",
    ).queue;
    expect(activeQueue).toHaveLength(1);
    expect(activeQueue[0].unitType).toBe(queue.unitType);
    expect(activeQueue[0].remaining).toBeLessThanOrEqual(queue.remaining);
  }
  await page.waitForTimeout(400);
  const after = await snap(page);
  expect(after.time).toBeGreaterThan(before.time);
  expect(after.tick).toBeGreaterThan(before.tick);
  expect(
    after.units
      .filter((u) => ids.includes(u.id))
      .some(
        (u) =>
          Math.hypot(
            u.x - before.units.find((b) => b.id === u.id).x,
            u.y - before.units.find((b) => b.id === u.id).y,
          ) > 0.1,
      ),
  ).toBe(true);
  expect(await page.locator("#pause-dialog").isVisible()).toBe(false);
});

test("compact landscape controls respect simulated notch and home indicator insets", async ({
  page,
}) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await start(page);
  await page.evaluate(() => {
    document.body.style.setProperty("--safe-left", "44px");
    document.body.style.setProperty("--safe-right", "44px");
    document.body.style.setProperty("--safe-bottom", "21px");
  });
  await checkCommands(page);
  for (const name of [
    "Pause",
    "Controls",
    "Objectives",
    "Minimap",
    "Workers",
    "Army",
  ]) {
    const rect = await button(page, name).boundingBox();
    expect(rect.x).toBeGreaterThanOrEqual(44);
    expect(rect.x + rect.width).toBeLessThanOrEqual(667 - 44);
    expect(rect.y + rect.height).toBeLessThanOrEqual(375 - 21);
  }
});

test("landscape touch pan and pinch cannot become army, placement or rally orders", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "WebKit automation has native tap support but no native multi-touch injection; Chromium CDP verifies pan/pinch.",
  );
  await page.setViewportSize({ width: 844, height: 390 });
  await start(page);
  await button(page, "Army").tap();
  const before = await camera(page),
    original = (await snap(page)).units
      .filter((u) => u.faction === "player")
      .map((u) => ({ id: u.id, order: u.order }));
  const cdp = await context.newCDPSession(page);
  const send = (type, touchPoints) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  await send("touchStart", [{ x: 400, y: 160, id: 1 }]);
  await send("touchMove", [{ x: 450, y: 175, id: 1 }]);
  await send("touchEnd", []);
  await send("touchStart", [
    { x: 340, y: 170, id: 1 },
    { x: 480, y: 170, id: 2 },
  ]);
  await send("touchMove", [
    { x: 300, y: 170, id: 1 },
    { x: 520, y: 170, id: 2 },
  ]);
  await send("touchEnd", []);
  await cdp.detach();
  const after = await camera(page);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(
    0.1,
  );
  expect(after.zoom).toBeGreaterThan(before.zoom);
  expect(
    (await snap(page)).units
      .filter((u) => u.faction === "player")
      .map((u) => ({ id: u.id, order: u.order })),
  ).toEqual(original);
  await button(page, "Build").tap();
  await button(page, "Farm").tap();
  const count = (await snap(page)).buildings.length,
    resources = (await snap(page)).resources;
  const buildGesture = await context.newCDPSession(page);
  await buildGesture.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 390, y: 165, id: 1 }],
  });
  // This pan is immediately followed by a HUD action. Model finger
  // deceleration before lift, rather than an abrupt injected flick; the army
  // pan/pinch above and the independent fast-pan regressions stay unchanged.
  for (let step = 1; step <= 12; step++) {
    const progress = 1 - Math.pow(1 - step / 12, 3);
    await buildGesture.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 390 + 55 * progress, y: 165 + 20 * progress, id: 1 }],
    });
  }
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
  await buildGesture.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await buildGesture.detach();
  expect((await snap(page)).buildings).toHaveLength(count);
  expect((await snap(page)).resources).toEqual(resources);
  await expect(button(page, "Place building")).toBeVisible();
  await button(page, "Cancel").tap();
  await expect(button(page, "Place building")).toBeHidden();
  await expect(button(page, "Cancel")).toBeHidden();
  await expect(page.locator("#hint")).not.toContainText("Farm");
  expect((await snap(page)).buildings).toHaveLength(count);
  expect((await snap(page)).resources).toEqual(resources);
  await button(page, "Center settlement").tap();
  const producer = (await snap(page)).buildings.find(
    (b) => b.type === "townCenter" && b.faction === "player",
  );
  const roof = await project(
    page,
    producer.x + producer.width / 2,
    producer.y + producer.height / 2,
  );
  roof.y -= 45 * (await camera(page)).zoom;
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.id,
      roof,
    ),
  ).toBe("battlefield");
  await page.touchscreen.tap(roof.x, roof.y);
  expect(await selection(page)).toEqual([producer.id]);
  await button(page, "Command").tap();
  await button(page, "Set Rally Point").tap();
  expect(await page.evaluate(() => window.frontierDebug.mode())).toBe("rally");
  const oldRally = producer.rally ?? null;
  const rallyGesture = await context.newCDPSession(page);
  await rallyGesture.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 390, y: 165, id: 1 }],
  });
  await rallyGesture.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 445, y: 180, id: 1 }],
  });
  await rallyGesture.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await rallyGesture.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: 340, y: 170, id: 1 },
      { x: 480, y: 170, id: 2 },
    ],
  });
  await rallyGesture.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: 300, y: 170, id: 1 },
      { x: 520, y: 170, id: 2 },
    ],
  });
  await rallyGesture.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await rallyGesture.detach();
  expect(
    (await snap(page)).buildings.find((b) => b.id === producer.id).rally ??
      null,
  ).toEqual(oldRally);
  await button(page, "Cancel").tap();
  expect(
    await page.evaluate(() => window.frontierDebug.rallyPreview()),
  ).toBeNull();
  expect(await page.evaluate(() => window.frontierDebug.mode())).toBe("select");
  await expect(button(page, "Cancel")).toBeHidden();
  expect((await snap(page)).buildings).toHaveLength(count);
  expect((await snap(page)).resources).toEqual(resources);
});
