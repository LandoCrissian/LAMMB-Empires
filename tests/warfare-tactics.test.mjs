import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../src/sim/world.mjs";
import { makeUnit } from "../src/sim/economy.mjs";
import { updateCombatUnit } from "../src/sim/combat.mjs";
import { updateAI } from "../src/sim/ai.mjs";
import { BUILDING_TYPES } from "../src/sim/config.mjs";

function arena() {
  const state = createGame(5280);
  state.map = {
    width: 30,
    height: 24,
    terrain: Array.from({ length: 24 }, () => Array(30).fill("grass")),
  };
  state.units = [];
  state.nodes = [];
  state.buildings = [];
  state.events = [];
  state.ai.nextRaid = 1e6;
  state.ai.nextReinforcement = 1e6;
  return state;
}
function building(state, type, faction, x, y) {
  const def = BUILDING_TYPES[type];
  const result = {
    id: `test-b${state.nextId++}`,
    type,
    faction,
    x,
    y,
    width: def.width,
    height: def.height,
    hp: def.hp,
    maxHp: def.hp,
    progress: 1,
    queue: [],
  };
  state.buildings.push(result);
  return result;
}

test("Hold Position fires at enemies in reach but never pursues enemies outside weapon range", () => {
  const state = arena(),
    archer = makeUnit(state, "archer", "player", 3.5, 5.5);
  const opponent = makeUnit(state, "infantry", "enemy", 6.5, 5.5);
  archer.order = { type: "hold", x: archer.x, y: archer.y };
  const position = { x: archer.x, y: archer.y };
  updateCombatUnit(state, archer, 0.05);
  assert.ok(opponent.hp < opponent.maxHp);
  opponent.x = 12.5;
  for (let i = 0; i < 60; i++) updateCombatUnit(state, archer, 0.05);
  assert.deepEqual({ x: archer.x, y: archer.y }, position);
  assert.equal(archer.order.type, "hold");
  assert.equal(archer.combatTargetId, null);
});

test("Hold Position respects ridge line of sight and melee reach", () => {
  const state = arena(),
    sword = makeUnit(state, "swordsman", "player", 3.5, 4.5);
  const opponent = makeUnit(state, "infantry", "enemy", 5.5, 4.5);
  sword.order = { type: "hold", x: sword.x, y: sword.y };
  updateCombatUnit(state, sword, 0.05);
  assert.equal(opponent.hp, opponent.maxHp);
  assert.equal(sword.x, 3.5);
  sword.type = "archer";
  state.map.terrain[4][4] = "ridge";
  updateCombatUnit(state, sword, 0.05);
  assert.equal(opponent.hp, opponent.maxHp);
});

test("nearby guards share a visible barracks threat and unrelated distant attackers remain unknown", () => {
  const state = arena(),
    barracks = building(state, "barracks", "enemy", 12, 8);
  const guardA = makeUnit(state, "infantry", "enemy", 16.5, 9.5);
  const guardB = makeUnit(state, "archer", "enemy", 15.5, 11.5);
  const attacker = makeUnit(state, "swordsman", "player", 10.5, 9.5);
  attacker.order = { type: "attack", targetId: barracks.id };
  updateAI(state);
  assert.equal(guardA.defenseTargetId, attacker.id);
  assert.equal(guardB.defenseTargetId, attacker.id);
  assert.equal(guardA.defendingId, barracks.id);
  attacker.x = 1.5;
  attacker.y = 1.5;
  state.time = 1;
  updateAI(state);
  assert.equal(guardA.defenseTargetId, null);
  assert.equal(guardB.defenseTargetId, null);
});

test("a ridge-hidden attacker is not a shared defensive observation", () => {
  const state = arena(),
    barracks = building(state, "barracks", "enemy", 12, 8);
  const guard = makeUnit(state, "infantry", "enemy", 15.5, 9.5);
  const attacker = makeUnit(state, "swordsman", "player", 9.5, 9.5);
  attacker.order = { type: "attack", targetId: barracks.id };
  for (let y = 0; y < 24; y++) state.map.terrain[y][11] = "ridge";
  updateAI(state);
  assert.equal(guard.defenseTargetId, null);
});

test("warned raids rally before departure and receive one coordinated spaced attack-move", () => {
  const state = createGame(5280);
  state.time = 150;
  state.ai.nextReinforcement = 1e6;
  updateAI(state);
  assert.equal(state.ai.wave, 0);
  assert.ok(state.events.some((event) => event.type === "warning"));
  const ids = state.ai.rally.ids;
  assert.ok(ids.length >= 3);
  assert.ok(
    ids.every(
      (id) => state.units.find((unit) => unit.id === id).aiRole === "rally",
    ),
  );
  state.time = 180;
  updateAI(state);
  const raiders = state.units.filter((unit) => unit.raiding);
  assert.equal(raiders.length, 4);
  assert.ok(
    raiders.every(
      (unit) => unit.raidSquadId === 1 && unit.order.type === "attackMove",
    ),
  );
  assert.equal(
    new Set(raiders.map((unit) => `${unit.order.x},${unit.order.y}`)).size,
    raiders.length,
  );
});

test("an attacked military settlement retains defenders instead of sending them into a raid", () => {
  const state = arena(),
    barracks = building(state, "barracks", "enemy", 12, 8);
  building(state, "townCenter", "player", 22, 18);
  const guards = [
    makeUnit(state, "infantry", "enemy", 15.5, 9.5),
    makeUnit(state, "archer", "enemy", 14.5, 11.5),
  ];
  const attacker = makeUnit(state, "swordsman", "player", 10.5, 9.5);
  attacker.order = { type: "attack", targetId: barracks.id };
  state.time = 180;
  state.ai.nextRaid = 180;
  updateAI(state);
  assert.equal(state.ai.wave, 1);
  assert.ok(
    guards.every(
      (unit) => unit.defenseTargetId === attacker.id && !unit.raiding,
    ),
  );
  assert.ok(state.events.some((event) => event.type === "defense"));
});

test("raiders coordinate against observed military structures without discovering a remote building", () => {
  const state = arena(),
    raider = makeUnit(state, "archer", "enemy", 6.5, 8.5);
  raider.raiding = true;
  raider.raidSquadId = 1;
  raider.order = { type: "attackMove", x: 25.5, y: 20.5 };
  const visible = building(state, "barracks", "player", 8, 8);
  building(state, "townCenter", "player", 23, 18);
  updateAI(state);
  assert.equal(raider.raidTargetId, visible.id);
  visible.hp = 0;
  state.time = 1;
  updateAI(state);
  assert.equal(
    raider.raidTargetId,
    null,
    "remote Town Center is not silently revealed as a new tactical target",
  );
});

test("combat exposes actual recent hit and attack metadata for readable feedback", () => {
  const state = arena(),
    sword = makeUnit(state, "swordsman", "player", 3.5, 4.5);
  const opponent = makeUnit(state, "infantry", "enemy", 4.2, 4.5);
  sword.order = { type: "attack", targetId: opponent.id };
  state.time = 8.5;
  updateCombatUnit(state, sword, 0.05);
  assert.equal(opponent.lastHitAt, 8.5);
  assert.equal(sword.lastAttackAt, 8.5);
  assert.equal(sword.combatTargetId, opponent.id);
  const event = state.events.find((item) => item.type === "attack");
  assert.equal(event.attackerId, sword.id);
  assert.equal(event.targetId, opponent.id);
  assert.equal(event.damage, opponent.maxHp - opponent.hp);
});
