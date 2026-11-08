import test from "node:test";
import assert from "node:assert/strict";
import { playSkirmish } from "../scripts/balance-check.mjs";
import { createGame, stepGame } from "../src/sim/world.mjs";
import { POPULATION_CAP } from "../src/sim/config.mjs";

test("a complete legal economy, defense and assault wins a paced skirmish", () => {
  // The driver uses only public commands and simulation steps. It never injects
  // resources, units, HP or completed structures; see scripts/balance-check.mjs.
  const result = playSkirmish(5280);
  assert.equal(result.status, "victory");
  assert.ok(
    result.time >= 600 && result.time <= 900,
    `scenario pacing: ${result.time}s`,
  );
  assert.ok(
    result.milestones.some(
      (item) => item.type === "assault" && item.army >= 13,
    ),
  );
  assert.ok(
    result.state.ai.wave >= 4,
    "the expedition survives multiple actual raids",
  );
  assert.ok(result.population <= POPULATION_CAP);
  assert.ok(
    Object.values(result.state.resources).every((amount) => amount >= 0),
  );
  assert.equal(
    result.state.buildings.some(
      (building) =>
        building.faction === "enemy" && building.type === "townCenter",
    ),
    false,
  );
  assert.ok(
    result.state.events.some((event) => event.type === "death"),
    "real combat resolved casualties",
  );
});

test("an undefended settlement eventually loses to actual enemy raids", () => {
  const state = createGame(5280);
  for (let tick = 0; tick < 1800 * 20 && state.status === "playing"; tick++)
    stepGame(state);
  assert.equal(state.status, "defeat");
  assert.ok(state.time > 180, "defeat does not skip the preparation period");
  assert.ok(state.ai.wave > 1);
  assert.equal(
    state.buildings.some(
      (building) =>
        building.faction === "player" && building.type === "townCenter",
    ),
    false,
  );
});
