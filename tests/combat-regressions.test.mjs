import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../src/sim/world.mjs";
import { BUILDING_TYPES, UNIT_TYPES } from "../src/sim/config.mjs";
import { makeUnit } from "../src/sim/economy.mjs";
import { updateCombatUnit, updateDefenses } from "../src/sim/combat.mjs";
import { blocked, clearPath, moveToward } from "../src/sim/movement.mjs";

function arena(width = 18, height = 12) {
  const state = createGame(5280);
  state.map = {
    width,
    height,
    terrain: Array.from({ length: height }, () => Array(width).fill("grass")),
  };
  state.units = [];
  state.buildings = [];
  state.nodes = [];
  state.events = [];
  return state;
}

function tower(state, x, y) {
  const def = BUILDING_TYPES.tower;
  const building = {
    id: "test-tower",
    type: "tower",
    faction: "player",
    x,
    y,
    width: def.width,
    height: def.height,
    hp: def.hp,
    maxHp: def.hp,
    progress: 1,
    cooldown: 0,
    queue: [],
  };
  state.buildings.push(building);
  return building;
}

test("a tower cannot shoot a soldier through a ridge", () => {
  const state = arena();
  tower(state, 2, 4);
  const hidden = makeUnit(state, "infantry", "enemy", 5.5, 4.5);
  state.map.terrain[4][4] = "ridge";

  updateDefenses(state, 0.05);

  assert.equal(hidden.hp, hidden.maxHp);
  assert.equal(
    state.events.filter((event) => event.type === "attack").length,
    0,
  );
});

test("an occluded soldier does not suppress tower fire at a visible lower-priority target", () => {
  const state = arena();
  tower(state, 2, 4);
  const hidden = makeUnit(state, "infantry", "enemy", 5.5, 4.5);
  const visible = makeUnit(state, "worker", "enemy", 2.5, 7.5);
  state.map.terrain[4][4] = "ridge";

  updateDefenses(state, 0.05);

  assert.equal(hidden.hp, hidden.maxHp, "ridge still shields the soldier");
  assert.equal(
    visible.hp,
    visible.maxHp - BUILDING_TYPES.tower.damage,
    "visible target receives actual tower damage",
  );
  const attacks = state.events.filter((event) => event.type === "attack");
  assert.equal(attacks.length, 1);
  assert.equal(attacks[0].targetId, visible.id);
});

test("an archer must gain a clear line of sight before dealing ranged damage", () => {
  const state = arena();
  const archer = makeUnit(state, "archer", "player", 1.5, 4.5);
  const target = makeUnit(state, "infantry", "enemy", 5.5, 4.5);
  archer.order = { type: "attack", targetId: target.id };
  state.map.terrain[4][3] = "ridge";

  updateCombatUnit(state, archer, 0.05);
  assert.equal(
    target.hp,
    target.maxHp,
    "being in weapon range does not bypass the ridge",
  );

  state.map.terrain[4][3] = "grass";
  state.obstacleVersion++;
  updateCombatUnit(state, archer, 0.05);
  assert.equal(target.hp, target.maxHp - UNIT_TYPES.archer.damage);
});

test("settlement defenders reject distant bait while committed raiders can pursue it", () => {
  const state = arena();
  const guard = makeUnit(state, "infantry", "enemy", 8.5, 4.5);
  guard.home = { x: 2.5, y: 4.5 };
  const bait = makeUnit(state, "worker", "player", 13.5, 4.5);

  updateCombatUnit(state, guard, 0.05);
  assert.ok(
    guard.x < 8.5,
    "garrison returns toward home rather than pursuing beyond its tether",
  );
  assert.equal(bait.hp, bait.maxHp);

  guard.x = 8.5;
  guard.y = 4.5;
  guard.raiding = true;
  clearPath(guard);
  updateCombatUnit(state, guard, 0.05);
  assert.ok(
    guard.x > 8.5,
    "a committed raid is allowed to advance on the same nearby target",
  );
});

test("movement routes through a ridge opening and never crosses blocked ridge tiles", () => {
  const state = arena(12, 10);
  for (let y = 0; y < 9; y++) state.map.terrain[y][5] = "ridge";
  const unit = makeUnit(state, "worker", "player", 1.5, 4.5);
  const destination = { x: 9.5, y: 4.5 };
  let arrived = false,
    usedOpening = false;

  for (let step = 0; step < 500 && !arrived; step++) {
    arrived = moveToward(
      state,
      unit,
      destination,
      0.2,
      0.05,
      UNIT_TYPES.worker.speed,
    );
    assert.equal(
      blocked(state, Math.floor(unit.x), Math.floor(unit.y)),
      false,
      "every sampled physical position is passable",
    );
    if (Math.floor(unit.x) === 5) {
      usedOpening = true;
      assert.equal(
        Math.floor(unit.y),
        9,
        "the wall is crossed only at its opening",
      );
    }
  }

  assert.ok(arrived, "a longer legal route reaches the destination");
  assert.ok(usedOpening, "the unit actually traversed the ridge opening");
  assert.ok(
    Math.hypot(unit.x - destination.x, unit.y - destination.y) <= 0.205,
  );
});
