import test from "node:test";
import assert from "node:assert/strict";
import { createGame, command } from "../src/sim/world.mjs";
import { makeUnit } from "../src/sim/economy.mjs";
import {
  enableMovementDiagnostics,
  resetMovementDiagnostics,
  getMovementDiagnostics,
} from "../src/sim/movement.mjs";

function splitMap() {
  const state = createGame(5280);
  state.map = {
    width: 20,
    height: 16,
    terrain: Array.from({ length: 16 }, () => Array(20).fill("grass")),
  };
  state.units = [];
  state.buildings = [];
  state.nodes = [];
  for (let y = 0; y < state.map.height; y++) state.map.terrain[y][9] = "water";
  for (let index = 0; index < 4; index++)
    makeUnit(state, "swordsman", "player", 3.5, 5.5 + index);
  return state;
}
const move = (state) =>
  command(state, {
    type: "order",
    ids: state.units.map((unit) => unit.id),
    order: { type: "move", x: 15.5, y: 8.5 },
  });

test("unreachable formation destinations fall back without unbounded A* candidate searches", () => {
  const state = splitMap();
  enableMovementDiagnostics(true);
  resetMovementDiagnostics();
  try {
    assert.equal(move(state).ok, true);
    assert.ok(
      state.units.every((unit) => unit.order.x < 9),
      "fallback ranks stay on the units' reachable side of the river",
    );
    assert.equal(
      new Set(state.units.map((unit) => `${unit.order.x},${unit.order.y}`))
        .size,
      state.units.length,
    );
    assert.ok(
      getMovementDiagnostics().pathCalls <= state.units.length,
      "candidate filtering must not launch hundreds of searches per unit",
    );
  } finally {
    enableMovementDiagnostics(false);
  }
});

test("formation connectivity invalidates when a crossing opens or closes", () => {
  const state = splitMap();
  assert.equal(move(state).ok, true);
  assert.ok(state.units.every((unit) => unit.order.x < 9));
  state.map.terrain[8][9] = "road";
  state.obstacleVersion++;
  assert.equal(move(state).ok, true);
  assert.ok(
    state.units.every((unit) => unit.order.x > 9),
    "opening a crossing allows ranks at the actual destination",
  );
  state.map.terrain[8][9] = "water";
  state.obstacleVersion++;
  assert.equal(move(state).ok, true);
  assert.ok(
    state.units.every((unit) => unit.order.x < 9),
    "closing the crossing cannot reuse a stale connected-region cache",
  );
});

test("connectivity filtering obeys diagonal corner restrictions", () => {
  const state = splitMap();
  state.map = {
    width: 6,
    height: 6,
    terrain: Array.from({ length: 6 }, () => Array(6).fill("ridge")),
  };
  for (const [x, y] of [
    [1, 1],
    [1, 2],
    [2, 3],
    [3, 3],
  ])
    state.map.terrain[y][x] = "grass";
  state.units = [];
  makeUnit(state, "swordsman", "player", 1.5, 1.5);
  makeUnit(state, "archer", "player", 1.5, 2.5);
  assert.equal(
    command(state, {
      type: "order",
      ids: state.units.map((unit) => unit.id),
      order: { type: "attackMove", x: 3.5, y: 3.5 },
    }).ok,
    true,
  );
  assert.ok(
    state.units.every((unit) => unit.order.x === 1.5 && unit.order.y < 3),
    "diagonally touching floor tiles remain disconnected when both corner tiles are blocked",
  );
});
