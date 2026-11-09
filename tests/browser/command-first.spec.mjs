import { test, expect } from "@playwright/test";

const selected = (page) => page.evaluate(() => window.frontierDebug.selected());
const point = (page, x, y) =>
  page.evaluate(([x, y]) => window.frontierDebug.worldToScreen(x, y), [x, y]);

async function start(page) {
  await page.goto("/?test=1");
  await page.getByRole("button", { name: "Play LAMMB Empires" }).click();
  await expect(page.getByRole("button", { name: "Army", exact: true })).toBeVisible();
}

async function swordsmanRectangle(page) {
  return page.evaluate(() => {
    const state = window.frontierDebug.snapshot();
    const positions = state.units
      .filter((unit) => unit.faction === "player" && unit.type === "swordsman" && unit.hp > 0)
      .map((unit) => ({ id: unit.id, ...window.frontierDebug.worldToScreen(unit.x, unit.y) }));
    if (positions.length < 2) throw new Error("Expected two initial swordsmen");
    return {
      ids: positions.map((p) => p.id).sort(),
      start: { x: Math.min(...positions.map((p) => p.x)) - 18, y: Math.min(...positions.map((p) => p.y)) - 18 },
      end: { x: Math.max(...positions.map((p) => p.x)) + 18, y: Math.max(...positions.map((p) => p.y)) + 18 },
    };
  });
}

test("touch tap-selected-army then tap-empty-ground issues an immediate move", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Direct tap controls are tested on touch projects");
  await start(page);
  await page.getByRole("button", { name: "Army", exact: true }).click();
  const ids = await selected(page);
  expect(ids).toHaveLength(2);
  const destination = await point(page, 11.5, 23.5);
  await page.touchscreen.tap(destination.x, destination.y);
  await expect.poll(async () =>
    (await page.evaluate(() => window.frontierDebug.snapshot())).units
      .filter((unit) => ids.includes(unit.id) && unit.order.type === "move").length,
  ).toBe(2);
  expect((await selected(page)).sort()).toEqual(ids.sort());
  await page.getByRole("button", { name: "Deselect", exact: true }).click();
  expect(await selected(page)).toHaveLength(0);
});

test("Select Area offers an accessible drag rectangle on touch layouts", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Select Area is provided for touch layouts");
  await start(page);
  await page.getByRole("button", { name: "Select Area", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.frontierDebug.mode())).toBe("box");
  const { ids, start: from, end: to } = await swordsmanRectangle(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  const current = await selected(page);
  expect(current.sort()).toEqual(ids);
  await expect.poll(() => page.evaluate(() => window.frontierDebug.mode())).toBe("select");
});

test("held touch drag selects troops without panning or issuing an order", async ({ page, context, browserName, isMobile }) => {
  test.skip(!isMobile || browserName !== "chromium", "Native touch movement injection is Chromium-only");
  await start(page);
  const { ids, start: from, end: to } = await swordsmanRectangle(page);
  const cameraBefore = await page.evaluate(() => window.frontierDebug.camera());
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
    await page.waitForTimeout(400);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: to.x, y: to.y, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await cdp.detach();
  }
  expect((await selected(page)).sort()).toEqual(ids);
  const cameraAfter = await page.evaluate(() => window.frontierDebug.camera());
  expect(cameraAfter.x).toBeCloseTo(cameraBefore.x, 4);
  expect(cameraAfter.y).toBeCloseTo(cameraBefore.y, 4);
});
