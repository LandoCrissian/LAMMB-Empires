import test from "node:test";
import assert from "node:assert/strict";
import { createGame, command, stepGame } from "../src/sim/world.mjs";
import { makeUnit } from "../src/sim/economy.mjs";
import { BUILDING_TYPES, UNIT_TYPES } from "../src/sim/config.mjs";
import { distance, distanceTo } from "../src/sim/geometry.mjs";
import { updateAI } from "../src/sim/ai.mjs";
import { updateCombatUnit } from "../src/sim/combat.mjs";
import { playCommandSkirmish } from "../scripts/command-balance-check.mjs";
import {
  blocked,
  enableMovementDiagnostics,
  resetMovementDiagnostics,
  getMovementDiagnostics,
} from "../src/sim/movement.mjs";

function arena() {
  const state = createGame(5280);
  state.map = {
    width: 40,
    height: 26,
    terrain: Array.from({ length: 26 }, () => Array(40).fill("grass")),
  };
  state.units = [];
  state.nodes = [];
  state.events = [];
  state.buildings = state.buildings.filter(
    (building) => building.type === "townCenter",
  );
  Object.assign(state.buildings[0], { x: 1, y: 21 });
  Object.assign(state.buildings[1], { x: 35, y: 1 });
  state.ai.nextRaid = state.ai.nextReinforcement = 1e9;
  state.obstacleVersion++;
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
    cooldown: 0,
  };
  state.buildings.push(result);
  state.obstacleVersion++;
  return result;
}
function army(state) {
  return ["swordsman", "swordsman", "ram", "archer", "archer"].map((type, i) =>
    makeUnit(state, type, "player", 5.5 - (i > 2 ? 1 : 0), 10.5 + i),
  );
}
const order = (state, units, type, extra = {}) =>
  command(state, {
    type: "order",
    ids: units.map((unit) => unit.id),
    order: { type, ...extra },
  });
function advance(state, seconds, inspect = () => {}) {
  for (
    let tick = 0;
    tick < seconds * 20 && state.status === "playing";
    tick++
  ) {
    stepGame(state);
    inspect();
  }
}

test("assault and retreat reject invalid, foreign, worker assault and disconnected orders atomically", () => {
  const state = arena(),
    troops = army(state);
  const worker = makeUnit(state, "worker", "player", 3.5, 10.5);
  const opponent = makeUnit(state, "infantry", "enemy", 20.5, 10.5);
  const invalid = [
    () => order(state, troops, "assault", { x: NaN, y: 10 }),
    () => order(state, troops, "retreat", { x: -1, y: 10 }),
    () => order(state, [worker], "assault", { x: 15, y: 10 }),
    () => order(state, [opponent], "retreat", { x: 15, y: 10 }),
    () => order(state, troops, "assault", { targetId: worker.id }),
  ];
  for (const issue of invalid) {
    const before = structuredClone(state);
    assert.equal(issue().ok, false);
    assert.deepEqual(state, before);
  }
  for (let y = 0; y < state.map.height; y++) state.map.terrain[y][14] = "water";
  state.obstacleVersion++;
  for (const type of ["assault", "retreat"]) {
    const before = structuredClone(state);
    assert.equal(order(state, troops, type, { x: 25.5, y: 12.5 }).ok, false);
    assert.deepEqual(state, before);
  }
});

test("coordinated assault has distinct infantry, siege and archer ranks paced to the slowest member", () => {
  const state = arena(),
    troops = army(state);
  assert.equal(order(state, troops, "assault", { x: 26.5, y: 13.5 }).ok, true);
  const cohort = state.assaults[0],
    initial = { ...cohort.anchor };
  assert.equal(cohort.phase, "regroup");
  assert.equal(
    new Set(cohort.slots.map((slot) => `${slot.x},${slot.y}`)).size,
    troops.length,
  );
  const average = (type) =>
    cohort.slots
      .filter(
        (slot) => troops.find((unit) => unit.id === slot.id).type === type,
      )
      .reduce((sum, slot, _, all) => sum + slot.x / all.length, 0);
  assert.ok(
    average("swordsman") > average("ram") && average("ram") > average("archer"),
  );
  advance(state, 4);
  assert.ok(distance(initial, cohort.anchor) > 0.5);
  assert.ok(
    distance(initial, cohort.anchor) <= UNIT_TYPES.ram.speed * 4 + 0.01,
    "the planning anchor never gives a ram a speed bonus",
  );
  assert.ok(troops.every((unit) => unit.order.type === "assault"));
  advance(state, 65);
  assert.ok(
    troops.every((unit) => unit.x > 22),
    "all actual units reach the destination area",
  );
  assert.equal(state.assaults.length, 0);
});

test("assault compresses through a one-tile crossing, regroups and reforms without crossing terrain", () => {
  const state = arena(),
    troops = army(state);
  for (let y = 0; y < state.map.height; y++) state.map.terrain[y][14] = "water";
  state.map.terrain[12][14] = "road";
  state.obstacleVersion++;
  assert.equal(order(state, troops, "assault", { x: 26.5, y: 12.5 }).ok, true);
  let regroupObserved = false;
  advance(state, 80, () => {
    if (state.assaults[0]?.phase === "regroup" && state.time > 3)
      regroupObserved = true;
    for (const unit of troops)
      assert.equal(
        blocked(state, Math.floor(unit.x), Math.floor(unit.y)),
        false,
      );
  });
  assert.ok(troops.every((unit) => unit.x > 20));
  assert.ok(
    regroupObserved,
    "crossing congestion produces a bounded cohesion pause",
  );
  assert.ok(
    new Set(troops.map((unit) => `${unit.x.toFixed(1)},${unit.y.toFixed(1)}`))
      .size >= 4,
  );
});

test("an escorted ram stages outside a fort and deals real structure damage during an assault", () => {
  const state = arena(),
    troops = army(state),
    tower = building(state, "tower", "enemy", 24, 12);
  assert.equal(
    order(state, troops, "assault", { targetId: tower.id }).ok,
    true,
  );
  let staging = false,
    shots = 0;
  advance(state, 90, () => {
    staging ||= state.assaults[0]?.phase === "staging";
    shots = Math.max(
      shots,
      state.events.filter(
        (event) =>
          event.type === "attack" && event.siege && event.targetId === tower.id,
      ).length,
    );
  });
  assert.ok(staging);
  assert.equal(tower.hp, 0);
  assert.ok(
    shots > 0,
    "the ram physically reaches contact and strikes, not a power calculation",
  );
});

test("assault reacts to nearby soldiers without chasing a retreating target across the map", () => {
  const state = arena(),
    troops = army(state),
    enemy = makeUnit(state, "infantry", "enemy", 9.5, 12.5);
  assert.equal(order(state, troops, "assault", { x: 26.5, y: 13.5 }).ok, true);
  advance(state, 4);
  assert.ok(enemy.hp < enemy.maxHp || enemy.hp === 0);
  enemy.hp = enemy.maxHp;
  enemy.x = 32.5;
  enemy.y = 22.5;
  advance(state, 3);
  assert.ok(troops.every((unit) => unit.combatTargetId !== enemy.id));
  assert.ok(
    state.assaults[0].anchor.x < 20,
    "a distant fleeing soldier cannot drag the cohort away",
  );
});

test("retreat disengages without attacking, healing, teleporting or changing normal speed", () => {
  const state = arena(),
    troop = makeUnit(state, "swordsman", "player", 5.5, 10.5),
    enemy = makeUnit(state, "archer", "enemy", 8.5, 10.5);
  troop.order = { type: "attack", targetId: enemy.id };
  const start = { x: troop.x, y: troop.y },
    bank = { ...state.resources },
    enemyHp = enemy.hp;
  assert.equal(order(state, [troop], "retreat", { x: 1.5, y: 10.5 }).ok, true);
  advance(state, 1);
  assert.equal(troop.order.type, "retreat");
  assert.ok(
    distance(troop, start) > 1.5 &&
      distance(troop, start) <= UNIT_TYPES.swordsman.speed + 0.01,
  );
  assert.ok(
    troop.hp < troop.maxHp,
    "legitimate ranged attacks still hurt retreating units",
  );
  assert.equal(
    enemy.hp,
    enemyHp,
    "retreat does not acquire or damage an enemy",
  );
  assert.deepEqual(state.resources, bank);
  assert.equal(order(state, [troop], "hold").ok, true);
  assert.equal(troop.order.type, "hold");
});

test("retreat assigns reachable unique spacing and new orders immediately detach assault members", () => {
  const state = arena(),
    troops = army(state);
  assert.equal(order(state, troops, "assault", { x: 26.5, y: 13.5 }).ok, true);
  assert.equal(order(state, [troops[0]], "hold").ok, true);
  assert.ok(!state.assaults[0].ids.includes(troops[0].id));
  const survivors = troops.slice(1);
  assert.equal(
    order(state, survivors, "retreat", { x: 4.5, y: 19.5 }).ok,
    true,
  );
  assert.equal(state.assaults.length, 0);
  assert.equal(
    new Set(survivors.map((unit) => `${unit.order.x},${unit.order.y}`)).size,
    survivors.length,
  );
  advance(state, 5);
  assert.equal(troops[0].order.type, "hold");
  assert.ok(survivors.every((unit) => unit.y > 17));
});

test("dead assault members are removed and a blocked route retries at a bounded cadence", () => {
  const state = arena(),
    troops = army(state);
  assert.equal(order(state, troops, "assault", { x: 26.5, y: 13.5 }).ok, true);
  troops[0].hp = 0;
  stepGame(state);
  assert.ok(!state.assaults[0].ids.includes(troops[0].id));
  for (let y = 0; y < state.map.height; y++) state.map.terrain[y][14] = "water";
  state.obstacleVersion++;
  enableMovementDiagnostics(true);
  resetMovementDiagnostics();
  try {
    advance(state, 2);
    assert.equal(state.assaults[0].phase, "blocked");
    assert.ok(
      getMovementDiagnostics().pathCalls < 25,
      "failed strategic and ordinary path work is bounded",
    );
    state.map.terrain[12][14] = "road";
    state.obstacleVersion++;
    stepGame(state);
    assert.notEqual(state.assaults[0].phase, "blocked");
    for (const unit of troops.filter((unit) => unit.hp > 0))
      assert.equal(
        blocked(state, Math.floor(unit.x), Math.floor(unit.y)),
        false,
      );
  } finally {
    enableMovementDiagnostics(false);
  }
});

test("enemy guards retain bounded pursuit and return while committed raiders can pursue", () => {
  const state = arena(),
    guard = makeUnit(state, "infantry", "enemy", 14.5, 10.5),
    target = makeUnit(state, "swordsman", "player", 9.5, 10.5);
  guard.home = { x: 20.5, y: 10.5 };
  guard.defenseTargetId = target.id;
  const start = guard.x;
  updateCombatUnit(state, guard, 0.05);
  assert.equal(guard.combatTargetId, null);
  assert.ok(
    guard.x > start,
    "a disengaged guard walks home rather than being baited farther out",
  );
  guard.raiding = true;
  guard.raidTargetId = target.id;
  const committed = guard.x;
  updateCombatUnit(state, guard, 0.05);
  assert.equal(guard.combatTargetId, target.id);
  assert.ok(guard.x < committed);
});

test("guards walk to surviving defensive structures after their protected barracks is destroyed", () => {
  const state = arena(),
    fort = building(state, "barracks", "enemy", 22, 12),
    guard = makeUnit(state, "infantry", "enemy", 24.5, 15.5);
  updateAI(state);
  assert.equal(guard.homeStructureId, fort.id);
  const start = { x: guard.x, y: guard.y },
    oldHome = { ...guard.home },
    resources = { ...state.resources };
  fort.hp = 0;
  state.obstacleVersion++;
  state.time = 1;
  updateAI(state);
  assert.notEqual(guard.homeStructureId, fort.id);
  assert.notDeepEqual(guard.home, oldHome);
  assert.deepEqual(
    { x: guard.x, y: guard.y },
    start,
    "repositioning cannot teleport a defender",
  );
  updateCombatUnit(state, guard, 0.05);
  assert.ok(
    distance(guard, start) > 0 &&
      distance(guard, start) <= UNIT_TYPES.infantry.speed * 0.05 + 0.001,
  );
  assert.deepEqual(state.resources, resources);
});

test("assault, combat, retreat and restart replay deterministically with fresh tactical state", () => {
  const run = () => {
    const state = arena(),
      troops = army(state);
    order(state, troops, "assault", { x: 26.5, y: 13.5 });
    advance(state, 6);
    order(state, troops.slice(1), "retreat", { x: 3.5, y: 18.5 });
    advance(state, 5);
    order(state, [troops[0]], "stop");
    advance(state, 2);
    return state;
  };
  assert.deepEqual(run(), run());
  const fresh = createGame(5280);
  assert.deepEqual(fresh.assaults, []);
  assert.equal(fresh.nextAssaultId, 1);
  assert.ok(fresh.units.every((unit) => unit.order.type === "idle"));
});

test("siege assault can finish a match and retreat does not prevent a legitimate defeat", () => {
  const victory = arena(),
    town = victory.buildings.find((building) => building.faction === "enemy"),
    ram = makeUnit(victory, "ram", "player", 33.5, 3.5);
  town.hp = UNIT_TYPES.ram.structureDamage;
  assert.equal(
    order(victory, [ram], "assault", { targetId: town.id }).ok,
    true,
  );
  advance(victory, 25);
  assert.equal(victory.status, "victory");
  const defeat = arena(),
    home = defeat.buildings.find((building) => building.faction === "player"),
    troop = makeUnit(defeat, "swordsman", "player", 6.5, 20.5),
    enemy = makeUnit(defeat, "infantry", "enemy", 4.5, 22.5);
  home.hp = UNIT_TYPES.infantry.damage;
  enemy.order = { type: "attack", targetId: home.id };
  assert.equal(
    order(defeat, [troop], "retreat", { x: 10.5, y: 20.5 }).ok,
    true,
  );
  advance(defeat, 2);
  assert.equal(defeat.status, "defeat");
});

function splitByLegalConstruction() {
  const state = arena();
  Object.assign(
    state.buildings.find((building) => building.faction === "player"),
    { x: 2, y: 14 },
  );
  for (let y = 0; y < state.map.height; y++) state.map.terrain[y][14] = "water";
  state.map.terrain[12][14] = "road";
  state.obstacleVersion++;
  const ram = makeUnit(state, "ram", "player", 16.5, 12.5),
    sword = makeUnit(state, "swordsman", "player", 16.5, 11.5),
    archer = makeUnit(state, "archer", "player", 5.5, 12.5),
    builder = makeUnit(state, "worker", "player", 13.5, 12.5);
  const troops = [ram, sword, archer];
  assert.equal(order(state, troops, "assault", { x: 26.5, y: 12.5 }).ok, true);
  const built = command(state, {
    type: "build",
    buildingType: "tower",
    x: 14,
    y: 12,
    workerIds: [builder.id],
  });
  assert.equal(
    built.ok,
    true,
    "the route is closed by an actual legal paid foundation",
  );
  return {
    state,
    troops,
    archer,
    wall: state.buildings.find((building) => building.id === built.id),
  };
}

test("legal construction cutting off one member blocks the cohort instead of falsely completing", () => {
  const { state, troops, archer, wall } = splitByLegalConstruction();
  advance(state, 80);
  assert.equal(state.assaults.length, 1);
  assert.equal(state.assaults[0].phase, "blocked");
  assert.ok(archer.x < 14 && archer.order.type === "assault");
  assert.equal(
    state.events.filter((event) => event.type === "assaultBlocked").length,
    1,
  );
  // Destruction reopens the very same legal terrain route. This is a focused
  // obstacle fixture; full legal balance never injects HP or removes structures.
  wall.hp = 0;
  state.obstacleVersion++;
  advance(state, 25, () => {
    for (const unit of troops)
      assert.equal(
        blocked(state, Math.floor(unit.x), Math.floor(unit.y)),
        false,
      );
  });
  assert.ok(troops.every((unit) => unit.x > 22));
  assert.equal(state.assaults.length, 0);
});

test("an isolated assault archer can defend within real weapon range without chasing away from its bank", () => {
  const { state, archer } = splitByLegalConstruction();
  const target = makeUnit(state, "infantry", "enemy", 9.5, 12.5);
  stepGame(state);
  assert.equal(state.assaults[0].phase, "blocked");
  assert.ok(
    target.hp < target.maxHp,
    "an anchor on another bank cannot suppress legitimate local self-defense",
  );
  target.x = 11.5;
  target.y = 20.5;
  const before = { x: archer.x, y: archer.y };
  updateCombatUnit(state, archer, 0.05);
  assert.notEqual(archer.combatTargetId, target.id);
  assert.ok(distance(archer, before) <= UNIT_TYPES.archer.speed * 0.05 + 0.001);
});

test("a full legal workshop opening, coordinated assault, retreat and renewed assault wins deterministically", () => {
  const first = playCommandSkirmish(5280),
    second = playCommandSkirmish(5280);
  assert.equal(first.status, "victory");
  assert.ok(
    first.metrics.coordinatedOrders >= 2 && first.metrics.retreatCount > 0,
  );
  assert.ok(
    first.metrics.retreatDistance > 2 && first.metrics.retreatDamage > 0,
  );
  assert.ok(
    first.metrics.trainedRams > 0 && first.metrics.ramStructureDamage > 0,
  );
  assert.ok(
    first.metrics.stagingObserved && first.metrics.assaultDamageTaken > 0,
  );
  assert.equal(first.metrics.rejectedCommands, 0);
  assert.deepEqual(first.state, second.state);
  assert.deepEqual(first.metrics, second.metrics);
});

test("a full 24-unit cohort keeps route and rank pathfinding bounded during sustained movement", () => {
  const state = arena();
  const troops = Array.from({ length: 24 }, (_, index) =>
    makeUnit(
      state,
      index < 12 ? "swordsman" : index < 18 ? "ram" : "archer",
      "player",
      4.5 + (index % 4),
      10.5 + Math.floor(index / 4),
    ),
  );
  enableMovementDiagnostics(true);
  resetMovementDiagnostics();
  try {
    assert.equal(
      order(state, troops, "assault", { x: 30.5, y: 13.5 }).ok,
      true,
    );
    advance(state, 20, () => {
      for (const unit of troops)
        assert.equal(
          blocked(state, Math.floor(unit.x), Math.floor(unit.y)),
          false,
        );
    });
    assert.ok(
      troops.every((unit) => unit.x > 15),
      "real soldiers advance while sharing a strategic route",
    );
    assert.ok(
      getMovementDiagnostics().pathCalls < 1500,
      "rank planning cannot launch candidate A* searches every frame",
    );
  } finally {
    enableMovementDiagnostics(false);
  }
});
