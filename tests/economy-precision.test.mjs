import test from "node:test";
import assert from "node:assert/strict";
import { createGame, command, stepGame } from "../src/sim/world.mjs";
import { UNIT_TYPES } from "../src/sim/config.mjs";
import { canAfford } from "../src/sim/rules.mjs";

test("fractional gathering delivers an exact full load at a purchase threshold", () => {
  const state = createGame(5280);
  const worker = state.units.find((unit) => unit.type === "worker");
  const source = state.nodes.find((node) => node.type === "wood");
  const stock = state.resources.wood;
  const initial = source.amount;
  assert.equal(
    command(state, {
      type: "order",
      ids: [worker.id],
      order: { type: "gather", targetId: source.id },
    }).ok,
    true,
  );
  for (let tick = 0; tick < 1200 && state.resources.wood === stock; tick++)
    stepGame(state);
  assert.equal(state.resources.wood, stock + UNIT_TYPES.worker.capacity);
  assert.equal(initial - source.amount, UNIT_TYPES.worker.capacity);
  assert.equal(worker.carry, null);
  assert.equal(
    canAfford(state.resources, { wood: stock + UNIT_TYPES.worker.capacity }),
    true,
  );
});
