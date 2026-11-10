import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  stepGame,
  command,
  placement,
  population,
  entityCenter,
} from "../src/sim/world.mjs";
import {
  BUILDING_TYPES,
  UNIT_TYPES,
  POPULATION_CAP,
} from "../src/sim/config.mjs";

const advance = (state, seconds) => {
  for (let i = 0; i < Math.round(seconds / 0.05); i++) stepGame(state, 0.05);
};
const playerUnits = (state) =>
  state.units.filter((unit) => unit.faction === "player");
const worker = (state) =>
  playerUnits(state).find((unit) => unit.type === "worker");
const town = (state, faction = "player") =>
  state.buildings.find(
    (building) =>
      building.type === "townCenter" && building.faction === faction,
  );
function openSite(state, type = "farm") {
  const center = entityCenter(town(state));
  for (let radius = 3; radius < 12; radius++) {
    for (let y = Math.floor(center.y) - radius; y <= center.y + radius; y++)
      for (let x = Math.floor(center.x) - radius; x <= center.x + radius; x++) {
        if (placement(state, type, x, y).ok) return { x, y };
      }
  }
  assert.fail(`No valid ${type} site near settlement`);
}
function build(state, type) {
  const point = openSite(state, type);
  assert.equal(
    command(state, {
      type: "build",
      buildingType: type,
      ...point,
      workerIds: [worker(state).id],
    }).ok,
    true,
  );
  return state.buildings.find(
    (building) =>
      building.type === type &&
      building.x === point.x &&
      building.y === point.y &&
      building.faction === "player",
  );
}

test("a new skirmish has two settlements, usable resources and an unplayed clock", () => {
  const state = createGame(5280);
  assert.equal(state.status, "playing");
  assert.equal(state.time, 0);
  assert.equal(state.tick, 0);
  assert.equal(
    playerUnits(state).filter((unit) => unit.type === "worker").length,
    5,
  );
  assert.ok(town(state).hp > 0 && town(state, "enemy").hp > 0);
  for (const type of ["wood", "stone", "food", "gold"]) {
    assert.ok(
      state.nodes.some((node) => node.type === type && node.amount > 0),
    );
    assert.ok(state.resources[type] >= 0);
  }
});

test("gathering requires movement, depletes its finite source and only banks delivered cargo", () => {
  const state = createGame(5280),
    unit = worker(state);
  const node = state.nodes
    .filter((node) => node.type === "wood")
    .sort(
      (a, b) =>
        Math.hypot(a.x - unit.x, a.y - unit.y) -
        Math.hypot(b.x - unit.x, b.y - unit.y),
    )[0];
  const original = {
    amount: node.amount,
    wood: state.resources.wood,
    x: unit.x,
    y: unit.y,
  };
  assert.equal(
    command(state, {
      type: "order",
      ids: [unit.id],
      order: { type: "gather", targetId: node.id },
    }).ok,
    true,
  );
  advance(state, 0.05);
  assert.equal(
    state.resources.wood,
    original.wood,
    "orders do not create instant inventory",
  );
  advance(state, 75);
  assert.ok(
    Math.hypot(unit.x - original.x, unit.y - original.y) > 0.1,
    "worker physically travels",
  );
  assert.ok(node.amount < original.amount, "deposit is actually consumed");
  assert.ok(
    state.resources.wood > original.wood,
    "worker delivers gathered wood",
  );
  const inCargo = playerUnits(state).reduce(
    (sum, item) => sum + (item.carry?.type === "wood" ? item.carry.amount : 0),
    0,
  );
  assert.ok(
    Math.abs(
      original.amount -
        node.amount -
        (state.resources.wood - original.wood) -
        inCargo,
    ) < 0.001,
    "bank and cargo conserve resources",
  );
  assert.ok(node.amount >= 0);
});

for (const resource of ["stone", "food", "gold"])
  test(`${resource} deposits physically deliver the correct inventory without creating supplies`, () => {
    const state = createGame(5280),
      unit = worker(state);
    const node = state.nodes
      .filter((item) => item.type === resource)
      .sort(
        (a, b) =>
          Math.hypot(a.x - unit.x, a.y - unit.y) -
          Math.hypot(b.x - unit.x, b.y - unit.y),
      )[0];
    const before = { ...state.resources },
      remaining = node.amount;
    assert.equal(
      command(state, {
        type: "order",
        ids: [unit.id],
        order: { type: "gather", targetId: node.id },
      }).ok,
      true,
    );
    advance(state, 60);
    assert.ok(state.resources[resource] > before[resource]);
    const cargo = unit.carry?.type === resource ? unit.carry.amount : 0;
    assert.ok(
      Math.abs(
        remaining -
          node.amount -
          (state.resources[resource] - before[resource]) -
          cargo,
      ) < 0.001,
    );
    for (const other of Object.keys(before).filter((key) => key !== resource))
      assert.equal(state.resources[other], before[other]);
  });

test("a completed farm supplies finite food through actual workers", () => {
  const state = createGame(5280),
    unit = worker(state),
    farm = state.buildings.find(
      (b) => b.type === "farm" && b.faction === "player",
    );
  const food = state.resources.food,
    remaining = farm.foodRemaining;
  assert.equal(
    command(state, {
      type: "order",
      ids: [unit.id],
      order: { type: "gather", targetId: farm.id },
    }).ok,
    true,
  );
  advance(state, 60);
  assert.ok(state.resources.food > food);
  assert.ok(farm.foodRemaining < remaining);
  assert.ok(
    Math.abs(
      remaining -
        farm.foodRemaining -
        (state.resources.food - food) -
        (unit.carry?.amount || 0),
    ) < 0.001,
  );
});

test("invalid construction never spends resources, and duplicate placement cannot double-spend", () => {
  const state = createGame(5280),
    before = { ...state.resources },
    home = town(state);
  const rejected = command(state, {
    type: "build",
    buildingType: "farm",
    x: home.x,
    y: home.y,
    workerIds: [worker(state).id],
  });
  assert.equal(rejected.ok, false);
  assert.deepEqual(state.resources, before);
  const building = build(state, "farm"),
    after = { ...state.resources };
  assert.equal(before.wood - after.wood, BUILDING_TYPES.farm.cost.wood);
  assert.equal(
    command(state, {
      type: "build",
      buildingType: "farm",
      x: building.x,
      y: building.y,
      workerIds: [worker(state).id],
    }).ok,
    false,
  );
  assert.deepEqual(state.resources, after);
});

test("building placement validates bounds, integer coordinates, terrain, deposits and enemy territory", () => {
  const state = createGame(5280),
    node = state.nodes[0],
    enemy = town(state, "enemy");
  for (const [x, y] of [
    [-1, 1],
    [44, 36],
    [2.1, 3],
    [NaN, 3],
    [Math.floor(node.x), Math.floor(node.y)],
    [enemy.x, enemy.y],
  ]) {
    assert.equal(
      placement(state, "farm", x, y).ok,
      false,
      `site ${x},${y} must reject`,
    );
  }
  assert.equal(placement(state, "dragon", 4, 4).ok, false);
  for (let y = 0; y < state.map.height; y++)
    for (let x = 0; x < state.map.width; x++) {
      if (state.map.terrain[y][x] === "water")
        assert.equal(placement(state, "tower", x, y).ok, false);
    }
  assert.equal(
    placement(state, "farm", openSite(state).x, openSite(state).y).ok,
    true,
  );
});

test("construction is unfinished until a worker reaches and builds it", () => {
  const state = createGame(5280),
    building = build(state, "farm"),
    unit = worker(state);
  assert.ok(building.progress < 1);
  command(state, { type: "stop", ids: [unit.id] });
  advance(state, 25);
  assert.ok(
    building.progress < 1,
    "an unattended foundation cannot build itself",
  );
  assert.equal(
    command(state, {
      type: "order",
      ids: [unit.id],
      order: { type: "build", targetId: building.id },
    }).ok,
    true,
  );
  advance(state, 55);
  assert.equal(building.progress, 1);
});

test("insufficient stock rejects construction and recruitment atomically", () => {
  const state = createGame(5280),
    point = openSite(state, "barracks");
  state.resources = { wood: 0, stone: 0, food: 0, gold: 0 };
  const before = JSON.stringify(state.resources),
    count = state.buildings.length;
  assert.equal(
    command(state, {
      type: "build",
      buildingType: "barracks",
      ...point,
      workerIds: [worker(state).id],
    }).ok,
    false,
  );
  assert.equal(
    command(state, {
      type: "recruit",
      unitType: "worker",
      buildingId: town(state).id,
    }).ok,
    false,
  );
  assert.equal(JSON.stringify(state.resources), before);
  assert.equal(state.buildings.length, count);
});

test("recruitment spends once, waits for training and creates the requested unit", () => {
  const state = createGame(5280),
    initial = population(state),
    before = state.resources.food;
  const home = town(state);
  assert.equal(
    command(state, { type: "recruit", unitType: "worker", buildingId: home.id })
      .ok,
    true,
  );
  assert.equal(state.resources.food, before - UNIT_TYPES.worker.cost.food);
  assert.equal(playerUnits(state).length, initial);
  assert.equal(home.queue.length, 1);
  advance(state, UNIT_TYPES.worker.trainTime + 1);
  assert.equal(playerUnits(state).length, initial + 1);
  assert.equal(home.queue.length, 0);
});

test("queued recruits reserve population and cannot exceed the cap", () => {
  const state = createGame(5280);
  state.ai.nextRaid = 1e9;
  state.ai.nextReinforcement = 1e9;
  state.resources = { wood: 100000, stone: 100000, food: 100000, gold: 100000 };
  const home = town(state);
  for (let attempts = 0; attempts < POPULATION_CAP * 3; attempts++) {
    command(state, {
      type: "recruit",
      unitType: "worker",
      buildingId: home.id,
    });
    advance(state, UNIT_TYPES.worker.trainTime + 0.1);
    if (population(state) === POPULATION_CAP) break;
  }
  assert.equal(population(state), POPULATION_CAP);
  const before = { ...state.resources };
  assert.equal(
    command(state, { type: "recruit", unitType: "worker", buildingId: home.id })
      .ok,
    false,
  );
  assert.deepEqual(state.resources, before);
  assert.equal(playerUnits(state).length, POPULATION_CAP);
});

test("military recruitment requires a finished friendly barracks", () => {
  const state = createGame(5280),
    building = build(state, "barracks");
  const recruit = {
    type: "recruit",
    unitType: "archer",
    buildingId: building.id,
  };
  assert.equal(command(state, recruit).ok, false);
  advance(state, 65);
  assert.equal(building.progress, 1);
  assert.equal(command(state, recruit).ok, true);
  assert.equal(
    command(state, {
      type: "recruit",
      unitType: "swordsman",
      buildingId: town(state).id,
    }).ok,
    false,
  );
  advance(state, UNIT_TYPES.archer.trainTime + 1);
  assert.ok(playerUnits(state).some((unit) => unit.type === "archer"));
});

test("foreign units, non-finite destinations and invalid targets reject orders", () => {
  const state = createGame(5280),
    enemy = state.units.find((unit) => unit.faction === "enemy");
  const before = structuredClone(enemy.order);
  assert.equal(
    command(state, {
      type: "order",
      ids: [enemy.id],
      order: { type: "move", x: 2, y: 2 },
    }).ok,
    false,
  );
  assert.deepEqual(enemy.order, before);
  assert.equal(
    command(state, {
      type: "order",
      ids: [worker(state).id],
      order: { type: "move", x: Infinity, y: 2 },
    }).ok,
    false,
  );
  assert.equal(
    command(state, {
      type: "order",
      ids: [worker(state).id],
      order: { type: "attack", targetId: town(state).id },
    }).ok,
    false,
  );
});

test("move and stop commands alter physical position and halt movement", () => {
  const state = createGame(5280),
    unit = worker(state),
    start = { x: unit.x, y: unit.y };
  const target = openSite(state, "tower");
  assert.equal(
    command(state, {
      type: "order",
      ids: [unit.id],
      order: { type: "move", x: target.x + 0.5, y: target.y + 0.5 },
    }).ok,
    true,
  );
  advance(state, 2);
  assert.ok(Math.hypot(unit.x - start.x, unit.y - start.y) > 1);
  assert.equal(command(state, { type: "stop", ids: [unit.id] }).ok, true);
  const stopped = { x: unit.x, y: unit.y };
  advance(state, 3);
  assert.deepEqual({ x: unit.x, y: unit.y }, stopped);
});

test("scheduled enemy raids originate at the settlement and issue attack orders", () => {
  const state = createGame(5280),
    firstRaid = state.ai.nextRaid;
  assert.ok(firstRaid >= 120, "player gets a preparation window");
  assert.equal(state.ai.wave, 0);
  advance(state, firstRaid - 1);
  assert.equal(state.ai.wave, 0);
  advance(state, 2);
  assert.equal(state.ai.wave, 1);
  assert.ok(state.ai.nextRaid > state.time);
  const raiders = state.units.filter(
    (unit) =>
      unit.faction === "enemy" &&
      ["attackMove", "attack"].includes(unit.order.type),
  );
  assert.ok(raiders.length > 0);
  assert.ok(
    raiders.every(
      (unit) => Math.hypot(unit.x - town(state).x, unit.y - town(state).y) > 10,
    ),
    "raid does not appear inside player base",
  );
});

test("combat damages individual targets, removes dead units and has a genuine ranged distinction", () => {
  const state = createGame(5280),
    melee = playerUnits(state).find((unit) => unit.type === "swordsman"),
    enemy = state.units.find((unit) => unit.faction === "enemy");
  state.units = [melee, enemy];
  for (let y = 23; y < 29; y++)
    for (let x = 15; x < 21; x++) state.map.terrain[y][x] = "grass";
  state.nodes = state.nodes.filter(
    (node) => node.x < 15 || node.x > 21 || node.y < 23 || node.y > 29,
  );
  melee.x = 17.5;
  melee.y = 25.5;
  enemy.x = 18.2;
  enemy.y = 25.5;
  enemy.home = { x: enemy.x, y: enemy.y };
  enemy.raiding = true;
  const before = enemy.hp;
  assert.equal(
    command(state, {
      type: "order",
      ids: [melee.id],
      order: { type: "attack", targetId: enemy.id },
    }).ok,
    true,
  );
  advance(state, 1.5);
  assert.ok(enemy.hp < before);
  advance(state, 20);
  assert.ok(
    !state.units.some((unit) => unit.id === enemy.id),
    "dead unit leaves simulation",
  );
  assert.ok(UNIT_TYPES.archer.range > UNIT_TYPES.swordsman.range * 3);
});

test("an archer inflicts ranged damage before a melee opponent can strike back", () => {
  const state = createGame(5280),
    archer = playerUnits(state).find((unit) => unit.type === "swordsman"),
    enemy = state.units.find((unit) => unit.faction === "enemy");
  state.units = [archer, enemy];
  for (let y = 23; y < 29; y++)
    for (let x = 14; x < 22; x++) state.map.terrain[y][x] = "grass";
  state.nodes = state.nodes.filter(
    (node) => node.x < 14 || node.x > 22 || node.y < 23 || node.y > 29,
  );
  archer.type = "archer";
  archer.hp = archer.maxHp = UNIT_TYPES.archer.hp;
  archer.x = 16.5;
  archer.y = 25.5;
  enemy.x = 20;
  enemy.y = 25.5;
  const before = enemy.hp;
  assert.equal(
    command(state, {
      type: "order",
      ids: [archer.id],
      order: { type: "attack", targetId: enemy.id },
    }).ok,
    true,
  );
  stepGame(state, 0.05);
  assert.equal(enemy.hp, before - UNIT_TYPES.archer.damage);
  assert.equal(archer.hp, UNIT_TYPES.archer.hp);
});

test("an exhausted deposit cannot supply additional resources", () => {
  const state = createGame(5280),
    unit = worker(state);
  const node = state.nodes
    .filter((node) => node.type === "wood")
    .sort(
      (a, b) =>
        Math.hypot(a.x - unit.x, a.y - unit.y) -
        Math.hypot(b.x - unit.x, b.y - unit.y),
    )[0];
  state.nodes = state.nodes.filter(
    (item) => item.type !== "wood" || item.id === node.id,
  );
  node.amount = 3;
  const before = state.resources.wood;
  command(state, {
    type: "order",
    ids: [unit.id],
    order: { type: "gather", targetId: node.id },
  });
  advance(state, 60);
  assert.equal(node.amount, 0);
  assert.ok(Math.abs(state.resources.wood - before - 3) < 0.0001);
  advance(state, 20);
  assert.ok(Math.abs(state.resources.wood - before - 3) < 0.0001);
});

test("enemy town center destruction wins and player town center destruction loses", () => {
  for (const [faction, expected] of [
    ["enemy", "victory"],
    ["player", "defeat"],
  ]) {
    const state = createGame(5280);
    town(state, faction).hp = 0;
    stepGame(state, 0.05);
    assert.equal(state.status, expected);
    const ended = JSON.stringify(state);
    advance(state, 1);
    assert.equal(
      JSON.stringify(state),
      ended,
      "completed matches stop simulating",
    );
    assert.equal(
      command(state, {
        type: "recruit",
        unitType: "worker",
        buildingId: town(state)?.id,
      }).ok,
      false,
    );
  }
});

test("same seeded state and command sequence replay identically", () => {
  const a = createGame(4663),
    b = createGame(4663);
  for (const state of [a, b]) {
    build(state, "farm");
    command(state, {
      type: "recruit",
      unitType: "worker",
      buildingId: town(state).id,
    });
    advance(state, 90);
  }
  assert.deepEqual(a, b);
  assert.notDeepEqual(createGame(4664).nodes, createGame(4663).nodes);
});

test("restart produces clean initial state without prior orders, casualties or spending", () => {
  const state = createGame(5280);
  build(state, "farm");
  advance(state, 35);
  const restarted = createGame(5280),
    expected = createGame(5280);
  assert.deepEqual(restarted, expected);
  assert.equal(restarted.time, 0);
  assert.ok(restarted.buildings.length < state.buildings.length);
  assert.notEqual(restarted.units[0], state.units[0]);
});
