import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  command,
  stepGame,
  placement,
  rallyPlacement,
} from "../src/sim/world.mjs";
import { BUILDING_TYPES, UNIT_TYPES } from "../src/sim/config.mjs";
import { makeUnit, updateBuildings } from "../src/sim/economy.mjs";
import { blocked } from "../src/sim/movement.mjs";
import { updateRallyOrders } from "../src/sim/rally.mjs";

const home = (state) =>
  state.buildings.find(
    (b) => b.type === "townCenter" && b.faction === "player",
  );
const advance = (state, seconds) => {
  for (let i = 0; i < Math.round(seconds * 20); i++) stepGame(state);
};
const recruit = (state, unitType, building) =>
  command(state, { type: "recruit", unitType, buildingId: building.id });
const set = (state, building, x, y, targetId) =>
  command(state, {
    type: "setRally",
    buildingId: building.id,
    x,
    y,
    ...(targetId ? { targetId } : {}),
  });
function build(state, type) {
  for (let y = 18; y <= 30; y++)
    for (let x = 3; x < 18; x++) {
      if (!placement(state, type, x, y).ok) continue;
      const result = command(state, {
        type: "build",
        buildingType: type,
        x,
        y,
        workerIds: state.units
          .filter((u) => u.type === "worker" && u.faction === "player")
          .slice(0, 3)
          .map((u) => u.id),
      });
      assert.equal(result.ok, true);
      const b = state.buildings.find((b) => b.id === result.id);
      advance(state, 40);
      assert.equal(b.progress, 1);
      return b;
    }
  assert.fail(`No legal ${type} construction site`);
}
function arena() {
  const state = createGame(5280);
  state.map = {
    width: 16,
    height: 14,
    terrain: Array.from({ length: 14 }, () => Array(16).fill("grass")),
  };
  state.nodes = [];
  state.units = [];
  state.buildings = state.buildings.filter((b) => b.type === "townCenter");
  Object.assign(home(state), { x: 2, y: 8 });
  Object.assign(
    state.buildings.find((b) => b.faction === "enemy"),
    { x: 12, y: 0 },
  );
  state.ai.nextRaid = state.ai.nextReinforcement = 1e9;
  state.obstacleVersion++;
  return state;
}

test("production rallies set, replace, and clear without spending supplies or ordering existing units", () => {
  const state = createGame(),
    building = home(state);
  const resources = { ...state.resources },
    orders = state.units.map((u) => ({ ...u.order }));
  assert.equal(set(state, building, 12.5, 24.5).ok, true);
  assert.deepEqual(building.rally, { type: "move", x: 12.5, y: 24.5 });
  assert.equal(set(state, building, 15.5, 25.5).ok, true);
  assert.equal(building.rally.x, 15.5);
  assert.equal(
    command(state, { type: "clearRally", buildingId: building.id }).ok,
    true,
  );
  assert.equal(building.rally, null);
  assert.deepEqual(state.resources, resources);
  assert.deepEqual(
    state.units.map((u) => u.order),
    orders,
  );
});

test("rally preview and command share ownership, producer, finite-coordinate and terrain validation", () => {
  const state = createGame(),
    building = home(state),
    before = structuredClone(state);
  const foreign = state.buildings.find(
    (b) => b.faction === "enemy" && b.type === "townCenter",
  );
  const farm = state.buildings.find((b) => b.type === "farm");
  for (const action of [
    { buildingId: foreign.id, x: 12.5, y: 24.5 },
    { buildingId: farm.id, x: 12.5, y: 24.5 },
    { buildingId: building.id, x: NaN, y: 4 },
    { buildingId: building.id, x: Infinity, y: 4 },
    { buildingId: building.id, x: -1, y: 4 },
    { buildingId: building.id, x: 44, y: 4 },
    { buildingId: building.id, x: building.x, y: building.y },
    { buildingId: building.id, x: 21.5, y: 0.5 },
  ]) {
    assert.equal(rallyPlacement(state, action.buildingId, action).ok, false);
    assert.equal(command(state, { type: "setRally", ...action }).ok, false);
  }
  assert.equal(
    command(state, { type: "clearRally", buildingId: foreign.id }).ok,
    false,
  );
  assert.deepEqual(
    state,
    before,
    "rejected rallies mutate neither economy, queues, state nor existing orders",
  );
});

test("rally resource targets require a live deposit or own completed stocked farm", () => {
  const state = createGame(),
    building = home(state),
    farm = state.buildings.find((b) => b.type === "farm");
  assert.equal(set(state, building, farm.x, farm.y, farm.id).ok, true);
  assert.equal(building.rally.type, "gather");
  for (const fields of [
    { faction: "enemy", progress: 1, foodRemaining: 650 },
    { faction: "player", progress: 0.5 },
    { progress: 1, foodRemaining: 0 },
  ]) {
    Object.assign(farm, fields);
    assert.equal(set(state, building, farm.x, farm.y, farm.id).ok, false);
  }
  assert.equal(set(state, building, 4, 4, "missing-resource").ok, false);
});

test("training applies the latest rally only after a physical exterior spawn", () => {
  const state = createGame(),
    building = home(state),
    original = new Set(state.units.map((u) => u.id));
  assert.equal(set(state, building, 12.5, 24.5).ok, true);
  assert.equal(recruit(state, "worker", building).ok, true);
  advance(state, 5);
  assert.equal(state.units.filter((u) => !original.has(u.id)).length, 0);
  assert.equal(set(state, building, 15.5, 25.5).ok, true);
  advance(state, UNIT_TYPES.worker.trainTime - 5 + 0.05);
  const unit = state.units.find((u) => !original.has(u.id));
  assert.ok(unit);
  assert.equal(blocked(state, Math.floor(unit.x), Math.floor(unit.y)), false);
  assert.ok(
    Math.hypot(unit.x - 15.5, unit.y - 25.5) > 2,
    "training does not teleport the recruit to its destination",
  );
  assert.deepEqual(unit.order, { type: "move", x: 15.5, y: 25.5 });
  assert.equal(
    command(state, { type: "clearRally", buildingId: building.id }).ok,
    true,
  );
  assert.equal(
    unit.order.type,
    "move",
    "clearing affects future recruits, not orders already issued",
  );
  advance(state, 15);
  assert.ok(Math.hypot(unit.x - 15.5, unit.y - 25.5) < 0.25);
});

test("no rally and a cleared pending rally keep the original idle-recruit behavior", () => {
  for (const clear of [false, true]) {
    const state = createGame(),
      building = home(state),
      original = new Set(state.units.map((u) => u.id));
    if (clear) assert.equal(set(state, building, 15.5, 25.5).ok, true);
    assert.equal(recruit(state, "worker", building).ok, true);
    if (clear) command(state, { type: "clearRally", buildingId: building.id });
    advance(state, UNIT_TYPES.worker.trainTime + 0.05);
    assert.equal(
      state.units.find((u) => !original.has(u.id)).order.type,
      "idle",
    );
  }
});

test("worker resource rallies physically gather and deliver only finite extracted supplies", () => {
  const state = createGame(),
    building = home(state),
    node = state.nodes.find(
      (n) => n.type === "wood" && n.x === 5.5 && n.y === 20.5,
    );
  node.amount = 3;
  const wood = state.resources.wood;
  assert.equal(set(state, building, node.x, node.y, node.id).ok, true);
  assert.equal(recruit(state, "worker", building).ok, true);
  advance(state, UNIT_TYPES.worker.trainTime + 0.05);
  const unit = state.units.at(-1),
    start = { x: unit.x, y: unit.y };
  assert.deepEqual(unit.order, { type: "gather", targetId: node.id });
  assert.equal(
    state.resources.wood,
    wood,
    "rally assignment creates no instant supplies",
  );
  advance(state, 60);
  assert.equal(node.amount, 0);
  assert.equal(state.resources.wood, wood + 3);
  assert.ok(Math.hypot(unit.x - start.x, unit.y - start.y) > 1);
  assert.equal(
    building.rally.type,
    "move",
    "exhausted economic rally visibly falls back to reachable ground",
  );
  advance(state, 20);
  assert.equal(
    state.resources.wood,
    wood + 3,
    "a depleted rally target cannot create extra resources",
  );
});

test("a farm rally trains a worker that consumes farm stock and banks food", () => {
  const state = createGame(),
    building = home(state),
    farm = state.buildings.find((b) => b.type === "farm");
  const original = farm.foodRemaining,
    before = state.resources.food;
  assert.equal(set(state, building, farm.x, farm.y, farm.id).ok, true);
  assert.equal(recruit(state, "worker", building).ok, true);
  advance(state, 60);
  const unit = state.units
    .filter((u) => u.faction === "player" && u.type === "worker")
    .at(-1);
  const banked = state.resources.food - (before - UNIT_TYPES.worker.cost.food);
  assert.ok(banked > 0);
  assert.ok(
    Math.abs(
      original - farm.foodRemaining - banked - (unit.carry?.amount || 0),
    ) < 0.0001,
  );
});

test("rally obstruction reroutes new and already moving recruits without overriding explicit commands", () => {
  const state = arena(),
    building = home(state);
  assert.equal(set(state, building, 10.5, 10.5).ok, true);
  assert.equal(recruit(state, "worker", building).ok, true);
  advance(state, UNIT_TYPES.worker.trainTime + 0.05);
  const rallied = state.units[0];
  const manual = makeUnit(state, "worker", "player", 4.5, 6.5);
  assert.equal(
    command(state, {
      type: "order",
      ids: [manual.id],
      order: { type: "move", x: 5.5, y: 4.5 },
    }).ok,
    true,
  );
  for (let y = 0; y < state.map.height; y++) state.map.terrain[y][7] = "ridge";
  state.obstacleVersion++;
  stepGame(state);
  assert.equal(building.rally.fallback, true);
  assert.ok(building.rally.x < 7 && rallied.order.x < 7);
  assert.deepEqual(manual.order, { type: "move", x: 5.5, y: 4.5 });
  const notices = state.events.filter(
    (e) => e.type === "rally" && e.text?.includes("rerouted"),
  ).length;
  advance(state, 0.5);
  assert.equal(
    state.events.filter(
      (e) => e.type === "rally" && e.text?.includes("rerouted"),
    ).length,
    notices,
    "a fallback alert is not emitted every simulation step",
  );
  advance(state, 20);
  assert.equal(rallied.order.type, "idle");
  assert.ok(rallied.x < 7);
});

test("existing economic recruits retain their original destination when the producer rally is replaced", () => {
  const state = arena(),
    building = home(state),
    node = {
      id: "original-wood",
      type: "wood",
      x: 10.5,
      y: 7.5,
      amount: 100,
      maxAmount: 100,
    };
  state.nodes.push(node);
  state.obstacleVersion++;
  assert.equal(set(state, building, node.x, node.y, node.id).ok, true);
  assert.equal(recruit(state, "worker", building).ok, true);
  advance(state, UNIT_TYPES.worker.trainTime + 0.05);
  const unit = state.units.find((u) => u.faction === "player");
  for (let i = 0; i < 200 && !unit.carry?.amount; i++) stepGame(state);
  assert.ok(unit.carry?.amount > 0, "the worker physically collected supplies");
  const carried = { ...unit.carry },
    resources = { ...state.resources };
  assert.equal(set(state, building, 2.5, 2.5).ok, true);
  state.map.terrain[13][0] = "ridge";
  state.obstacleVersion++;
  updateRallyOrders(state);
  assert.deepEqual(unit.order, { type: "gather", targetId: node.id });
  node.amount = 0;
  state.obstacleVersion++;
  updateRallyOrders(state);
  assert.deepEqual(unit.order, { type: "move", x: node.x, y: node.y });
  assert.deepEqual(building.rally, { type: "move", x: 2.5, y: 2.5 });
  assert.deepEqual(unit.carry, carried, "fallback preserves carried supplies");
  assert.deepEqual(state.resources, resources, "fallback cannot bank supplies remotely");
});

test("congested or sealed production exits wait at zero training time without spending twice", () => {
  const state = arena(),
    building = home(state);
  state.map.terrain = state.map.terrain.map((row) => row.map(() => "ridge"));
  state.map.terrain[11][3] = "grass";
  state.obstacleVersion++;
  const blocker = makeUnit(state, "worker", "player", 3.5, 11.5);
  assert.equal(recruit(state, "worker", building).ok, true);
  const food = state.resources.food;
  for (let i = 0; i < 400; i++) updateBuildings(state, 0.05);
  assert.equal(building.queue.length, 1);
  assert.equal(building.queue[0].remaining, 0);
  assert.equal(state.units.length, 1);
  assert.equal(building.spawnBlocked, true);
  assert.equal(state.resources.food, food);
  state.units = state.units.filter((u) => u.id !== blocker.id);
  updateBuildings(state, 0.05);
  assert.equal(building.queue.length, 0);
  assert.equal(state.units.length, 1);
  assert.deepEqual(
    { x: state.units[0].x, y: state.units[0].y },
    { x: 3.5, y: 11.5 },
  );
  assert.equal(state.resources.food, food);
});

test("a severed worker delivery route waits safely with cargo instead of retrying an impossible drop-off", () => {
  const state = arena(),
    building = home(state);
  const node = {
    id: "test-wood",
    type: "wood",
    x: 11.5,
    y: 10.5,
    amount: 100,
    maxAmount: 100,
  };
  state.nodes.push(node);
  state.obstacleVersion++;
  assert.equal(set(state, building, node.x, node.y, node.id).ok, true);
  assert.equal(recruit(state, "worker", building).ok, true);
  let unit;
  for (let tick = 0; tick < 1000; tick++) {
    stepGame(state);
    unit = state.units.find((u) => u.faction === "player");
    if (unit?.delivering && unit.x > 7) break;
  }
  assert.equal(unit.carry.amount, 18);
  const bank = state.resources.wood;
  for (let y = 0; y < state.map.height; y++) state.map.terrain[y][7] = "ridge";
  state.obstacleVersion++;
  stepGame(state);
  assert.equal(unit.delivering, false);
  assert.equal(unit.order.type, "move");
  advance(state, 20);
  assert.equal(unit.order.type, "idle");
  assert.equal(unit.carry.amount, 18);
  assert.equal(
    state.resources.wood,
    bank,
    "stranded supplies are never banked remotely",
  );
  assert.equal(
    state.events.filter((e) => e.text?.includes("delivery route cut off"))
      .length,
    1,
  );
  state.map.terrain[10][7] = "road";
  state.obstacleVersion++;
  assert.equal(
    command(state, {
      type: "order",
      ids: [unit.id],
      order: { type: "gather", targetId: node.id },
    }).ok,
    true,
  );
  advance(state, 15);
  assert.ok(
    state.resources.wood >= bank + 18,
    "supplies can be physically delivered after the route is reopened and the worker reassigned",
  );
});

test("production cannot spawn through a sealed perimeter into another open region", () => {
  const state = arena(),
    building = home(state);
  state.map.terrain = state.map.terrain.map((row) => row.map(() => "ridge"));
  state.map.terrain[12][3] = "grass";
  state.obstacleVersion++;
  assert.equal(recruit(state, "worker", building).ok, true);
  for (let i = 0; i < 400; i++) updateBuildings(state, 0.05);
  assert.equal(
    state.units.length,
    0,
    "an open preferred spawn cell beyond a wall is not a legal exit",
  );
  assert.equal(building.queue.length, 1);
  state.map.terrain[11][3] = "grass";
  state.obstacleVersion++;
  updateBuildings(state, 0.05);
  assert.equal(state.units.length, 1);
  assert.equal(building.queue.length, 0);
});

test("Siege Workshop construction, cost, recruitment gate and military rally are functional", () => {
  const state = createGame(),
    before = { ...state.resources };
  const workshop = build(state, "workshop");
  for (const [key, amount] of Object.entries(BUILDING_TYPES.workshop.cost))
    assert.equal(state.resources[key], before[key] - amount);
  assert.equal(workshop.maxHp, BUILDING_TYPES.workshop.hp);
  assert.equal(recruit(state, "ram", home(state)).ok, false);
  assert.equal(set(state, workshop, 15.5, 25.5).ok, true);
  const node = state.nodes.find((n) => n.type === "wood");
  assert.equal(
    set(state, workshop, node.x, node.y, node.id).ok,
    false,
    "military rallies cannot become economic gather orders",
  );
  const original = new Set(state.units.map((u) => u.id));
  assert.equal(recruit(state, "ram", workshop).ok, true);
  advance(state, UNIT_TYPES.ram.trainTime + 0.05);
  const ram = state.units.find(
    (u) => !original.has(u.id) && u.faction === "player",
  );
  assert.equal(ram.type, "ram");
  assert.equal(ram.order.type, "move");
  assert.equal(blocked(state, Math.floor(ram.x), Math.floor(ram.y)), false);
});

test("rally, production and fallback sequences replay deterministically and restart clears them", () => {
  const games = [arena(), arena()];
  for (const state of games) {
    const building = home(state);
    assert.equal(set(state, building, 10.5, 10.5).ok, true);
    assert.equal(recruit(state, "worker", building).ok, true);
    advance(state, 15);
    for (let y = 0; y < state.map.height; y++)
      state.map.terrain[y][7] = "ridge";
    state.obstacleVersion++;
    advance(state, 25);
  }
  assert.deepEqual(games[0], games[1]);
  const restarted = createGame(5280);
  assert.ok(
    restarted.buildings.every((b) => b.rally === null && !b.queue.length),
  );
  assert.equal(restarted.time, 0);
});
