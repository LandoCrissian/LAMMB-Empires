import test from "node:test";
import assert from "node:assert/strict";
import { createGame, command, stepGame } from "../src/sim/world.mjs";
import { makeUnit } from "../src/sim/economy.mjs";
import {
  updateCombatUnit,
  updateDefenses,
  siegeContact,
} from "../src/sim/combat.mjs";
import { updateAI } from "../src/sim/ai.mjs";
import { BUILDING_TYPES, UNIT_TYPES } from "../src/sim/config.mjs";
import {
  blocked,
  enableMovementDiagnostics,
  resetMovementDiagnostics,
  getMovementDiagnostics,
} from "../src/sim/movement.mjs";
import { distanceTo } from "../src/sim/geometry.mjs";
import { playSiegeSkirmish } from "../scripts/siege-balance-check.mjs";

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
  state.ai.nextRaid = state.ai.nextReinforcement = 1e6;
  state.obstacleVersion++;
  return state;
}
function building(state, type, faction, x, y) {
  const def = BUILDING_TYPES[type];
  const result = {
    id: `siege-b${state.nextId++}`,
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
    cooldown: 0,
  };
  state.buildings.push(result);
  state.obstacleVersion++;
  return result;
}
function combatFor(state, seconds) {
  for (let i = 0; i < seconds * 20; i++) {
    state.time += 0.05;
    for (const u of state.units) if (u.hp > 0) updateCombatUnit(state, u, 0.05);
    updateDefenses(state, 0.05);
  }
}

test("siege production is a paid optional slow specialist rather than another infantry unit", () => {
  assert.equal(UNIT_TYPES.ram.producer, "workshop");
  assert.equal(BUILDING_TYPES.workshop.width, 3);
  assert.ok(
    BUILDING_TYPES.workshop.cost.wood > BUILDING_TYPES.barracks.cost.wood,
  );
  assert.ok(UNIT_TYPES.ram.speed < UNIT_TYPES.swordsman.speed);
  assert.ok(UNIT_TYPES.ram.structureDamage > UNIT_TYPES.ram.damage * 6);
  assert.ok(UNIT_TYPES.ram.cost.gold > UNIT_TYPES.swordsman.cost.gold);
});

test("ram deals actual specialized structure damage and much less damage to troops", () => {
  for (const structure of [true, false]) {
    const state = arena(),
      ram = makeUnit(state, "ram", "player", 5.5, 5.5);
    const target = structure
      ? building(state, "tower", "enemy", 6, 5)
      : makeUnit(state, "infantry", "enemy", 6.2, 5.5);
    const before = target.hp;
    ram.order = { type: "attack", targetId: target.id };
    updateCombatUnit(state, ram, 0.05);
    const expected = structure
      ? UNIT_TYPES.ram.structureDamage
      : UNIT_TYPES.ram.damage;
    assert.equal(before - target.hp, expected);
    const hit = state.events.find((e) => e.type === "attack");
    assert.equal(hit.damage, expected);
    assert.equal(hit.siege, true);
    assert.equal(hit.structureHit, structure);
  }
});

test("a ram walks into wall contact before it can damage a building", () => {
  const state = arena(),
    ram = makeUnit(state, "ram", "player", 3.5, 6.5),
    tower = building(state, "tower", "enemy", 8, 6);
  ram.order = { type: "attack", targetId: tower.id };
  let struck = false;
  for (let i = 0; i < 150; i++) {
    const before = { x: ram.x, y: ram.y };
    state.time += 0.05;
    updateCombatUnit(state, ram, 0.05);
    assert.ok(
      Math.hypot(ram.x - before.x, ram.y - before.y) <=
        UNIT_TYPES.ram.speed * 0.05 + 0.00001,
      "siege cannot teleport into contact",
    );
    assert.equal(blocked(state, Math.floor(ram.x), Math.floor(ram.y)), false);
    if (tower.hp < tower.maxHp) {
      struck = true;
      assert.ok(distanceTo(ram, tower) <= UNIT_TYPES.ram.range + 0.05);
      break;
    }
  }
  assert.ok(struck, "the ram eventually reaches and attacks its target");
});

test("ram contact cannot cut through blocked rock corners or an intervening structure", () => {
  const state = arena(),
    ram = makeUnit(state, "ram", "player", 3.5, 3.5),
    tower = building(state, "tower", "enemy", 4, 4);
  state.map.terrain[3][4] = "ridge";
  state.map.terrain[4][3] = "water";
  assert.equal(siegeContact(state, ram, tower), false);
  ram.order = { type: "hold", x: ram.x, y: ram.y };
  updateCombatUnit(state, ram, 0.05);
  assert.equal(tower.hp, tower.maxHp);
  const fresh = arena(),
    otherRam = makeUnit(fresh, "ram", "player", 5.5, 5.5),
    target = building(fresh, "barracks", "enemy", 7, 5);
  building(fresh, "tower", "enemy", 6, 5);
  assert.equal(siegeContact(fresh, otherRam, target), false);
});

test("a ram walks around blocked diagonal contact instead of stalling at geometric range", () => {
  const state = arena(),
    ram = makeUnit(state, "ram", "player", 4.9, 4.9),
    tower = building(state, "tower", "enemy", 5, 5);
  state.map.terrain[4][5] = "water";
  state.map.terrain[5][4] = "ridge";
  ram.order = { type: "attack", targetId: tower.id };
  for (let i = 0; i < 240 && tower.hp === tower.maxHp; i++) {
    state.time += 0.05;
    updateCombatUnit(state, ram, 0.05);
    assert.equal(blocked(state, Math.floor(ram.x), Math.floor(ram.y)), false);
  }
  assert.ok(
    tower.hp < tower.maxHp,
    "valid contact is reached through the open route around the corner",
  );
  assert.ok(siegeContact(state, ram, tower));
});

test("unreachable ram contact uses bounded retries and reacts immediately when a route opens", () => {
  const state = arena();
  for (const row of state.map.terrain) row.fill("ridge");
  for (const [x, y] of [
    [4, 4],
    [5, 5],
    [6, 5],
    [5, 6],
  ])
    state.map.terrain[y][x] = "grass";
  const tower = building(state, "tower", "enemy", 5, 5),
    ram = makeUnit(state, "ram", "player", 4.9, 4.9);
  ram.order = { type: "attack", targetId: tower.id };
  enableMovementDiagnostics(true);
  resetMovementDiagnostics();
  try {
    for (let i = 0; i < 20; i++) {
      state.time += 0.05;
      updateCombatUnit(state, ram, 0.05);
    }
    assert.equal(tower.hp, tower.maxHp);
    assert.ok(
      getMovementDiagnostics().pathCalls <= 3,
      "a sealed contact position cannot launch fresh candidate searches every tick",
    );
    state.map.terrain[4][5] = state.map.terrain[4][6] = "grass";
    state.obstacleVersion++;
    for (let i = 0; i < 160 && tower.hp === tower.maxHp; i++) {
      state.time += 0.05;
      updateCombatUnit(state, ram, 0.05);
    }
    assert.ok(
      tower.hp < tower.maxHp,
      "opening terrain invalidates the failed approach and allows a real strike",
    );
  } finally {
    enableMovementDiagnostics(false);
  }
});

test("ordinary infantry can destroy an exposed ram while the defensive tower survives", () => {
  const state = arena(),
    ram = makeUnit(state, "ram", "player", 5.5, 6.5),
    tower = building(state, "tower", "enemy", 8, 6);
  ram.order = { type: "attack", targetId: tower.id };
  for (const [x, y] of [
    [6.1, 6.5],
    [5.5, 7.1],
    [4.9, 6.5],
  ]) {
    const guard = makeUnit(state, "infantry", "enemy", x, y);
    guard.order = { type: "attack", targetId: ram.id };
  }
  combatFor(state, 12);
  assert.equal(ram.hp, 0);
  assert.ok(tower.hp > 0);
  assert.ok(
    state.events.some((e) => e.type === "death" && e.entityType === "ram"),
  );
});

test("one ordinary infantry unit beats an unescorted ram in a direct melee fight", () => {
  const state = arena(),
    ram = makeUnit(state, "ram", "player", 5.5, 6.5),
    guard = makeUnit(state, "infantry", "enemy", 6.2, 6.5);
  ram.order = { type: "attack", targetId: guard.id };
  guard.order = { type: "attack", targetId: ram.id };
  combatFor(state, 30);
  assert.equal(ram.hp, 0);
  assert.ok(guard.hp > 0);
});

test("a ram can breach one unsupported tower but loses most of its health doing so", () => {
  const state = arena(),
    ram = makeUnit(state, "ram", "player", 5.5, 6.5),
    tower = building(state, "tower", "enemy", 8, 6);
  ram.order = { type: "attack", targetId: tower.id };
  combatFor(state, 50);
  assert.equal(tower.hp, 0);
  assert.ok(
    ram.hp > 0 && ram.hp < ram.maxHp * 0.4,
    "tower fire remains dangerous even to a structural specialist",
  );
});

test("locally detected exposed siege draws a bounded intercept team while other guards retain positions", () => {
  const state = arena(),
    fort = building(state, "workshop", "enemy", 12, 8);
  const guards = Array.from({ length: 6 }, (_, i) =>
    makeUnit(
      state,
      "infantry",
      "enemy",
      15.5 + (i % 2),
      8.5 + Math.floor(i / 2),
    ),
  );
  const ram = makeUnit(state, "ram", "player", 10.5, 9.5);
  ram.order = { type: "attack", targetId: fort.id };
  const before = {
    resources: { ...state.resources },
    units: state.units.length,
  };
  updateAI(state);
  const interceptors = guards.filter((u) => u.aiRole === "intercept");
  assert.ok(interceptors.length > 0 && interceptors.length <= 3);
  assert.ok(interceptors.every((u) => u.defenseTargetId === ram.id));
  assert.ok(
    guards.some((u) => u.siegeStandGround && !u.defenseTargetId),
    "some troops continue guarding the settlement",
  );
  assert.deepEqual(state.resources, before.resources);
  assert.equal(
    state.units.length,
    before.units,
    "interception does not grant or teleport a counter army",
  );
  ram.hp = 0;
  state.time = 1;
  updateAI(state);
  assert.ok(
    guards.every((u) => u.aiRole !== "intercept" && !u.defenseTargetId),
  );
  const guard = interceptors[0];
  guard.x += 2;
  const old = guard.x;
  updateCombatUnit(state, guard, 0.05);
  assert.ok(guard.x < old, "released interceptors return toward their home");
});

test("hidden or escorted siege is not treated as an omniscient exposed target", () => {
  for (const hidden of [false, true]) {
    const state = arena();
    building(state, "barracks", "enemy", 12, 8);
    const guards = [
      makeUnit(state, "infantry", "enemy", 15.5, 9.5),
      makeUnit(state, "infantry", "enemy", 16.5, 10.5),
      makeUnit(state, "archer", "enemy", 14.5, 11.5),
    ];
    const ram = makeUnit(state, "ram", "player", 9.5, 9.5);
    if (hidden) for (let y = 0; y < 24; y++) state.map.terrain[y][11] = "ridge";
    else {
      makeUnit(state, "swordsman", "player", 9.5, 8.5);
      makeUnit(state, "swordsman", "player", 9.5, 10.5);
    }
    updateAI(state);
    assert.ok(guards.every((u) => u.aiRole !== "intercept"));
    if (hidden) assert.ok(guards.every((u) => u.defenseTargetId !== ram.id));
  }
});

test("siege damage destroys structures, ends a real match and restart removes siege state", () => {
  const state = arena(),
    playerTown = building(state, "townCenter", "player", 1, 18),
    enemyTown = building(state, "townCenter", "enemy", 10, 5);
  const ram = makeUnit(state, "ram", "player", 9.5, 6.5);
  ram.order = { type: "attack", targetId: enemyTown.id };
  enemyTown.hp = UNIT_TYPES.ram.structureDamage;
  stepGame(state, 0.05);
  assert.equal(state.status, "victory");
  assert.ok(playerTown.hp > 0);
  assert.ok(
    state.events.some(
      (e) => e.type === "death" && e.entityType === "townCenter",
    ),
  );
  const restarted = createGame(5280);
  assert.equal(restarted.status, "playing");
  assert.equal(restarted.time, 0);
  assert.ok(!restarted.units.some((u) => u.type === "ram"));
  assert.ok(!restarted.buildings.some((b) => b.type === "workshop"));
});

test("legal siege gathering, production, rally and combat wins and replays deterministically", () => {
  const first = playSiegeSkirmish(5280),
    second = playSiegeSkirmish(5280);
  assert.equal(first.status, "victory");
  assert.ok(
    first.metrics.trainedRams >= 1 &&
      first.metrics.ramStructureDamage > 700 &&
      first.metrics.ramStructureKills > 0,
  );
  assert.ok(
    first.metrics.gathered.stone >= 50 &&
      first.metrics.spent.stone >= BUILDING_TYPES.workshop.cost.stone,
  );
  assert.ok(
    first.metrics.spent.wood >=
      BUILDING_TYPES.workshop.cost.wood + UNIT_TYPES.ram.cost.wood,
  );
  assert.ok(first.metrics.workshopCompletedAt > 190);
  assert.deepEqual(first.state, second.state);
  assert.deepEqual(first.metrics, second.metrics);
});
