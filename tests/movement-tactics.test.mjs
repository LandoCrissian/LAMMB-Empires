import test from "node:test";
import assert from "node:assert/strict";
import { createGame, command, stepGame } from "../src/sim/world.mjs";
import { makeUnit } from "../src/sim/economy.mjs";
import { formationDestinations } from "../src/sim/formations.mjs";
import {
  blocked,
  reachable,
  separateUnits,
  enableMovementDiagnostics,
  resetMovementDiagnostics,
  getMovementDiagnostics,
} from "../src/sim/movement.mjs";

function arena(width = 24, height = 18) {
  const state = createGame(5280);
  state.map = {
    width,
    height,
    terrain: Array.from({ length: height }, () => Array(width).fill("grass")),
  };
  state.nodes = [];
  state.units = [];
  state.events = [];
  state.buildings = state.buildings.filter((b) => b.type === "townCenter");
  Object.assign(state.buildings[0], { x: 1, y: height - 4 });
  Object.assign(state.buildings[1], { x: width - 4, y: 1 });
  state.ai.nextRaid = state.ai.nextReinforcement = 1e9;
  state.obstacleVersion++;
  return state;
}

function advance(state, seconds) {
  for (let step = 0; step < seconds * 20; step++) stepGame(state);
}

test("group ranks reserve distinct reachable destinations and put archers behind melee", () => {
  const state = arena();
  const units = Array.from({ length: 8 }, (_, i) =>
    makeUnit(
      state,
      i < 4 ? "swordsman" : "archer",
      "player",
      3.5 + (i % 2),
      5.5 + Math.floor(i / 2),
    ),
  );
  const destination = { x: 15.5, y: 7.5 };
  const slots = formationDestinations(state, units, destination);
  assert.equal(slots.length, units.length);
  assert.equal(new Set(slots.map((p) => `${p.x},${p.y}`)).size, units.length);
  for (const slot of slots) {
    assert.equal(blocked(state, Math.floor(slot.x), Math.floor(slot.y)), false);
    assert.equal(
      reachable(
        state,
        units.find((u) => u.id === slot.id),
        slot,
        0.2,
      ),
      true,
    );
  }
  const forwardAverage = (types) =>
    slots
      .filter((p) => types.includes(units.find((u) => u.id === p.id).type))
      .reduce((sum, p) => sum + p.x / 4, 0);
  assert.ok(
    forwardAverage(["swordsman"]) > forwardAverage(["archer"]) + 0.8,
    "melee ranks screen the archers in the direction of travel",
  );
});

test("group move and attack-move retain their own spaced destinations", () => {
  for (const type of ["move", "attackMove"]) {
    const state = arena(32, 24);
    const units = Array.from({ length: 6 }, (_, i) =>
      makeUnit(
        state,
        i < 3 ? "swordsman" : "archer",
        "player",
        3.5 + (i % 2),
        5.5 + Math.floor(i / 2),
      ),
    );
    assert.equal(
      command(state, {
        type: "order",
        ids: units.map((u) => u.id),
        order: { type, x: 15.5, y: 8.5 },
      }).ok,
      true,
    );
    const destinations = units.map((u) => ({ ...u.order }));
    assert.equal(
      new Set(destinations.map((p) => `${p.x},${p.y}`)).size,
      units.length,
    );
    advance(state, 2);
    for (let index = 0; index < units.length; index++) {
      assert.deepEqual(units[index].order, destinations[index]);
      assert.ok(
        units[index].x > 3.5,
        "physical movement progresses while the formation order remains intact",
      );
    }
    advance(state, 15);
    assert.ok(units.every((u) => u.order.type === "idle"));
    for (let i = 0; i < units.length; i++)
      for (let j = i + 1; j < units.length; j++)
        assert.ok(
          Math.hypot(units[i].x - units[j].x, units[i].y - units[j].y) > 0.55,
          "completed ranks do not become one overlapping point",
        );
  }
});

test("coincident units separate deterministically without changing tactical orders", () => {
  const a = arena(),
    b = arena();
  for (const state of [a, b]) {
    for (let i = 0; i < 7; i++)
      makeUnit(state, "swordsman", "player", 8.5, 8.5);
    for (let step = 0; step < 100; step++) separateUnits(state, 0.05);
  }
  assert.deepEqual(a.units, b.units);
  let closest = Infinity;
  for (let i = 0; i < a.units.length; i++)
    for (let j = i + 1; j < a.units.length; j++)
      closest = Math.min(
        closest,
        Math.hypot(a.units[i].x - a.units[j].x, a.units[i].y - a.units[j].y),
      );
  assert.ok(
    closest > 0.62,
    `coincident troops resolve to practical spacing (${closest})`,
  );
  assert.ok(a.units.every((u) => u.order.type === "idle"));
  const settled = a.units.map((u) => ({ x: u.x, y: u.y }));
  for (let step = 0; step < 80; step++) separateUnits(a, 0.05);
  assert.ok(
    a.units.every(
      (u, index) =>
        Math.hypot(u.x - settled[index].x, u.y - settled[index].y) < 0.01,
    ),
    "settled neighbors do not oscillate or drift indefinitely",
  );
});

test("separation respects impassable banks and anchored hold positions", () => {
  const state = arena();
  for (let y = 0; y < state.map.height; y++)
    state.map.terrain[y][10] = y % 2 ? "ridge" : "water";
  const held = makeUnit(state, "swordsman", "player", 9.7, 8.5);
  const other = makeUnit(state, "swordsman", "player", 9.8, 8.5);
  assert.equal(
    command(state, { type: "order", ids: [held.id], order: { type: "hold" } })
      .ok,
    true,
  );
  const original = { x: held.x, y: held.y };
  for (let step = 0; step < 60; step++) {
    separateUnits(state, 0.05);
    for (const u of state.units)
      assert.equal(blocked(state, Math.floor(u.x), Math.floor(u.y)), false);
  }
  assert.deepEqual(
    { x: held.x, y: held.y },
    original,
    "holding soldiers are not shoved out of their firing position",
  );
  assert.equal(held.order.type, "hold");
  assert.equal(other.order.type, "idle");
  assert.ok(
    Math.hypot(held.x - other.x, held.y - other.y) > 0.6,
    "neighbors slide along the bank instead of piling against the held soldier",
  );
});

test("a formation compresses through a one-tile crossing and reorganizes beyond it", () => {
  const state = arena();
  for (let y = 0; y < state.map.height; y++)
    if (y !== 8) state.map.terrain[y][10] = "ridge";
  const units = Array.from({ length: 8 }, (_, i) =>
    makeUnit(
      state,
      i % 2 ? "archer" : "swordsman",
      "player",
      3.5 + (i % 2),
      5.5 + Math.floor(i / 2),
    ),
  );
  assert.equal(
    command(state, {
      type: "order",
      ids: units.map((u) => u.id),
      order: { type: "move", x: 16.5, y: 8.5 },
    }).ok,
    true,
  );
  let traversed = false;
  for (let step = 0; step < 900; step++) {
    stepGame(state);
    for (const u of units) {
      assert.equal(
        blocked(state, Math.floor(u.x), Math.floor(u.y)),
        false,
        "orders and separation never move a unit through the ridge",
      );
      if (Math.floor(u.x) === 10) {
        traversed = true;
        assert.equal(Math.floor(u.y), 8);
      }
    }
  }
  assert.ok(traversed);
  assert.ok(
    units.every((u) => u.x > 10 && u.order.type === "idle"),
    "every soldier exits the choke without permanently blocking followers",
  );
  assert.equal(
    new Set(units.map((u) => `${Math.floor(u.x)},${Math.floor(u.y)}`)).size,
    units.length,
    "the army reopens into distinct ranks",
  );
});

test("formation, hold and separation replay identically with diagnostics enabled or disabled", () => {
  const states = [arena(32, 24), arena(32, 24)];
  for (let index = 0; index < states.length; index++) {
    const state = states[index];
    const units = Array.from({ length: 8 }, (_, i) =>
      makeUnit(
        state,
        i % 2 ? "archer" : "swordsman",
        "player",
        4.5 + (i % 2),
        5.5 + Math.floor(i / 2),
      ),
    );
    enableMovementDiagnostics(index === 0);
    resetMovementDiagnostics();
    command(state, {
      type: "order",
      ids: units.map((u) => u.id),
      order: { type: "attackMove", x: 15.5, y: 8.5 },
    });
    advance(state, 8);
    command(state, {
      type: "order",
      ids: units.map((u) => u.id),
      order: { type: "hold" },
    });
    advance(state, 2);
    if (index === 0)
      assert.ok(
        getMovementDiagnostics().pathCalls > 0 &&
          getMovementDiagnostics().separationCalls > 0,
      );
  }
  enableMovementDiagnostics(false);
  assert.deepEqual(
    states[0],
    states[1],
    "profiling clocks never enter simulation state or influence deterministic movement",
  );
});
