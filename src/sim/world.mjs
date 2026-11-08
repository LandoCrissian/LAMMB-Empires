import { seededRandom, spend, canAfford, canPlace } from "./rules.mjs";
import {
  BUILDING_TYPES,
  UNIT_TYPES,
  INITIAL_RESOURCES,
  POPULATION_CAP,
  AI_CONFIG,
  STEP,
} from "./config.mjs";
import { byId, distance, entityCenter, event } from "./geometry.mjs";
import {
  blocked,
  clearPath,
  nearestOpen,
  reachable,
  separateUnits,
} from "./movement.mjs";
import { formationDestinations } from "./formations.mjs";
import { makeUnit, updateWorker, updateBuildings } from "./economy.mjs";
import { updateCombatUnit, updateDefenses } from "./combat.mjs";
import { updateAI } from "./ai.mjs";
import {
  rallyPlacement,
  isProductionBuilding,
  updateRallyOrders,
} from "./rally.mjs";

export { entityCenter, rallyPlacement };
export function population(state, faction = "player") {
  return (
    state.units.filter((u) => u.faction === faction && u.hp > 0).length +
    state.buildings
      .filter((b) => b.faction === faction && b.hp > 0)
      .reduce((sum, b) => sum + b.queue.length, 0)
  );
}

function makeBuilding(state, type, faction, x, y, complete = true) {
  const def = BUILDING_TYPES[type];
  const b = {
    id: `b${state.nextId++}`,
    type,
    faction,
    x,
    y,
    width: def.width,
    height: def.height,
    hp: def.hp * (complete ? 1 : 0.25),
    maxHp: def.hp,
    progress: complete ? 1 : 0,
    queue: [],
    builders: 0,
    cooldown: 0,
    rally: null,
  };
  if (type === "farm") b.foodRemaining = def.food;
  state.buildings.push(b);
  state.obstacleVersion++;
  return b;
}

export function createGame(seed = 5280) {
  const random = seededRandom(seed);
  const state = {
    seed,
    time: 0,
    tick: 0,
    status: "playing",
    resources: { ...INITIAL_RESOURCES },
    units: [],
    buildings: [],
    nodes: [],
    events: [],
    ai: {
      nextRaid: AI_CONFIG.firstRaid,
      wave: 0,
      nextReinforcement: AI_CONFIG.reinforcementInterval,
      reinforcements: 0,
      warned: false,
    },
    map: { width: 44, height: 36, terrain: [] },
    nextId: 1,
    nextEventId: 1,
    obstacleVersion: 0,
  };
  for (let y = 0; y < state.map.height; y++) {
    const row = [];
    for (let x = 0; x < state.map.width; x++) {
      const river = 21 + Math.floor(Math.sin(y / 5) * 2);
      const crossing = (y >= 12 && y <= 15) || (y >= 25 && y <= 28);
      let tile =
        x >= river && x <= river + 1 ? (crossing ? "road" : "water") : "grass";
      if (tile === "grass" && Math.abs(y - (32 - x * 0.62)) < 1.1)
        tile = "road";
      if (
        tile === "grass" &&
        ((x >= 17 && x <= 18 && y >= 17 && y <= 20) ||
          (x >= 27 && x <= 28 && y >= 19 && y <= 21))
      )
        tile = "ridge";
      row.push(tile);
    }
    state.map.terrain.push(row);
  }
  makeBuilding(state, "townCenter", "player", 8, 24);
  makeBuilding(state, "farm", "player", 11, 28);
  makeBuilding(state, "townCenter", "enemy", 33, 8);
  makeBuilding(state, "barracks", "enemy", 30, 6);
  makeBuilding(state, "barracks", "enemy", 28, 17);
  makeBuilding(state, "tower", "enemy", 27, 15);
  makeBuilding(state, "tower", "enemy", 30, 12);
  makeBuilding(state, "tower", "enemy", 37, 12);
  const addNode = (type, x, y, amount) => {
    if (blocked(state, x, y)) return;
    state.nodes.push({
      id: `n${state.nextId++}`,
      type,
      x: x + 0.5,
      y: y + 0.5,
      amount,
      maxAmount: amount,
      variant: Math.floor(random() * 4),
    });
  };
  for (const [cx, cy] of [
    [5, 20],
    [3, 26],
    [13, 31],
    [33, 3],
    [39, 18],
    [10, 9],
    [28, 29],
  ]) {
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [-1, 0],
      [1, 1],
      [-1, -1],
    ])
      addNode("wood", cx + dx, cy + dy, 300 + Math.floor(random() * 100));
  }
  for (const [type, x, y, amount] of [
    ["stone", 13, 23, 1700],
    ["stone", 14, 23, 1200],
    ["gold", 14, 27, 2000],
    ["gold", 15, 27, 1400],
    ["food", 6, 28, 550],
    ["food", 6, 29, 550],
    ["stone", 28, 16, 1800],
    ["gold", 27, 27, 1800],
    ["food", 17, 13, 700],
    ["stone", 37, 6, 1800],
    ["gold", 39, 8, 1800],
  ])
    addNode(type, x, y, amount);
  for (const [x, y] of [
    [7.5, 26.5],
    [7.5, 27.5],
    [8.5, 28.5],
    [10.5, 28.5],
    [11.5, 26.5],
  ])
    makeUnit(state, "worker", "player", x, y);
  for (const [x, y] of [
    [12.5, 25.5],
    [12.5, 26.5],
  ])
    makeUnit(state, "swordsman", "player", x, y);
  for (const [x, y] of [
    [31.5, 11.5],
    [32.5, 12.5],
    [36.5, 11.5],
    [28.5, 14.5],
    [29.5, 15.5],
  ])
    makeUnit(state, "infantry", "enemy", x, y);
  makeUnit(state, "archer", "enemy", 35.5, 12.5);
  makeUnit(state, "archer", "enemy", 29.5, 14.5);
  event(
    state,
    "objective",
    9,
    26,
    "Build your settlement. Destroy the Ember Town Center.",
  );
  return state;
}

export function placement(state, type, x, y) {
  const def = Object.hasOwn(BUILDING_TYPES, type) ? BUILDING_TYPES[type] : null;
  if (!def || type === "townCenter")
    return {
      ok: false,
      reason: "Choose a Farm, Barracks, Watchtower, or Siege Workshop.",
    };
  if (state.status !== "playing")
    return { ok: false, reason: "This match has ended." };
  if (
    !canPlace({
      x,
      y,
      width: def.width,
      height: def.height,
      mapWidth: state.map.width,
      mapHeight: state.map.height,
      blocked: (px, py) => blocked(state, px, py),
    })
  )
    return {
      ok: false,
      reason: "Blocked terrain, resources, or another building.",
    };
  if (
    state.units.some(
      (u) =>
        u.hp > 0 &&
        u.x >= x &&
        u.x < x + def.width &&
        u.y >= y &&
        u.y < y + def.height,
    )
  )
    return { ok: false, reason: "Move units out of the building footprint." };
  const center = state.buildings.find(
    (b) => b.faction === "player" && b.type === "townCenter" && b.hp > 0,
  );
  if (
    !center ||
    distance({ x: x + def.width / 2, y: y + def.height / 2 }, center) > 14
  )
    return { ok: false, reason: "Build within 14 tiles of your Town Center." };
  if (!canAfford(state.resources, def.cost))
    return { ok: false, reason: "Not enough resources." };
  if (
    !state.units.some(
      (u) => u.faction === "player" && u.type === "worker" && u.hp > 0,
    )
  )
    return {
      ok: false,
      reason: "A living Worker is needed to construct this.",
    };
  return { ok: true };
}

export function command(state, action) {
  const fail = (reason) => ({ ok: false, reason });
  if (state.status !== "playing") return fail("This match has ended.");
  if (!action || typeof action !== "object") return fail("Invalid command.");
  if (action.type === "setRally") {
    const result = rallyPlacement(state, action.buildingId, action);
    if (!result.ok) return result;
    const building = state.buildings.find((b) => b.id === action.buildingId);
    building.rally = { ...result.rally };
    building.rallyVersion = state.obstacleVersion;
    event(
      state,
      "rally",
      building.x,
      building.y,
      result.rally.type === "gather"
        ? "Worker gathering rally set."
        : "Production rally point set.",
    );
    return { ok: true, rally: { ...building.rally } };
  }
  if (action.type === "clearRally") {
    const building = state.buildings.find(
      (b) => b.id === action.buildingId && b.faction === "player",
    );
    if (!isProductionBuilding(building))
      return fail("Select your completed production building.");
    building.rally = null;
    event(
      state,
      "rally",
      building.x,
      building.y,
      "Production rally cleared. New units will wait by the building.",
    );
    return { ok: true };
  }
  if (action.type === "build") {
    const valid = placement(state, action.buildingType, action.x, action.y);
    if (!valid.ok) return valid;
    const ids = action.workerIds || [];
    if (
      !Array.isArray(ids) ||
      ids.some(
        (id) =>
          !state.units.some(
            (u) =>
              u.id === id &&
              u.faction === "player" &&
              u.type === "worker" &&
              u.hp > 0,
          ),
      )
    )
      return fail("Choose your own living Workers.");
    const workers = state.units
      .filter(
        (u) =>
          u.faction === "player" &&
          u.type === "worker" &&
          u.hp > 0 &&
          (!ids.length || ids.includes(u.id)),
      )
      .sort((a, b) => distance(a, action) - distance(b, action))
      .slice(0, 3);
    if (!workers.length) return fail("Select a Worker.");
    const def = BUILDING_TYPES[action.buildingType];
    if (
      !workers.some((u) =>
        reachable(state, u, {
          x: action.x,
          y: action.y,
          width: def.width,
          height: def.height,
        }),
      )
    )
      return fail("Workers cannot reach that construction site.");
    const paid = spend(
      state.resources,
      BUILDING_TYPES[action.buildingType].cost,
    );
    if (!paid) return fail("Not enough resources.");
    state.resources = paid;
    const b = makeBuilding(
      state,
      action.buildingType,
      "player",
      action.x,
      action.y,
      false,
    );
    for (const u of workers) {
      u.order = { type: "build", targetId: b.id };
      u.rallyAssignment = null;
      u.delivering = false;
      clearPath(u);
    }
    event(
      state,
      "construction",
      action.x,
      action.y,
      `${BUILDING_TYPES[b.type].label} foundation placed`,
    );
    return { ok: true, id: b.id };
  }
  if (action.type === "recruit") {
    const def = Object.hasOwn(UNIT_TYPES, action.unitType)
      ? UNIT_TYPES[action.unitType]
      : null;
    if (!def || action.unitType === "infantry") return fail("Unknown recruit.");
    const b = state.buildings.find(
      (b) => b.id === action.buildingId && b.faction === "player" && b.hp > 0,
    );
    const producer =
      def.producer ||
      (action.unitType === "worker" ? "townCenter" : "barracks");
    if (!b || b.progress !== 1 || b.type !== producer)
      return fail(
        `Build and select a completed ${BUILDING_TYPES[producer]?.label || "production building"}.`,
      );
    if (b.queue.length >= 5) return fail("Training queue is full.");
    if (population(state) >= POPULATION_CAP)
      return fail(`Population limit: ${POPULATION_CAP}.`);
    const paid = spend(state.resources, def.cost);
    if (!paid) return fail("Not enough resources.");
    state.resources = paid;
    b.queue.push({
      unitType: action.unitType,
      remaining: def.trainTime,
      total: def.trainTime,
    });
    return { ok: true };
  }
  if (action.type === "order" || action.type === "stop") {
    if (!Array.isArray(action.ids) || !action.ids.length)
      return fail("Select units first.");
    const ids = [...new Set(action.ids)],
      units = ids.map((id) =>
        state.units.find(
          (u) => u.id === id && u.hp > 0 && u.faction === "player",
        ),
      );
    if (units.some((u) => !u))
      return fail("Orders require your own living units.");
    const order = action.type === "stop" ? { type: "idle" } : action.order;
    if (
      !order ||
      ![
        "idle",
        "hold",
        "move",
        "attackMove",
        "attack",
        "gather",
        "build",
      ].includes(order.type)
    )
      return fail("Invalid order.");
    let target;
    if (["attack", "gather", "build"].includes(order.type)) {
      target = byId(state, order.targetId);
      if (!target) return fail("That target is unavailable.");
      if (
        order.type === "attack" &&
        (!target.faction || target.faction === "player")
      )
        return fail("Choose an enemy target.");
      if (
        order.type === "gather" &&
        !(
          target.amount > 0 ||
          (target.type === "farm" &&
            target.faction === "player" &&
            target.progress === 1 &&
            target.foodRemaining > 0)
        )
      )
        return fail("Choose a resource deposit or completed Farm.");
      if (
        order.type === "build" &&
        !(target.width && target.faction === "player" && target.progress < 1)
      )
        return fail("Choose an unfinished friendly building.");
      if (
        ["gather", "build"].includes(order.type) &&
        !units.some((u) => u.type === "worker")
      )
        return fail("Select Workers for this task.");
    }
    let point;
    if (["move", "attackMove"].includes(order.type)) {
      if (
        ![order.x, order.y].every(Number.isFinite) ||
        order.x < 0 ||
        order.y < 0 ||
        order.x >= state.map.width ||
        order.y >= state.map.height
      )
        return fail("Choose a destination on the battlefield.");
      point = nearestOpen(state, order.x, order.y);
      if (!point) return fail("No open destination.");
    }
    const destinations =
      point && units.length > 1
        ? new Map(
            formationDestinations(state, units, point).map((p) => [p.id, p]),
          )
        : null;
    if (destinations && destinations.size !== units.length)
      return fail("The group cannot reach that formation destination.");
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (["gather", "build"].includes(order.type) && u.type !== "worker")
        continue;
      u.order = { ...order };
      u.rallyAssignment = null;
      u.delivering = false;
      clearPath(u);
      if (order.type === "hold") {
        u.order.x = u.x;
        u.order.y = u.y;
      }
      if (order.type === "gather")
        u.gatherResource = target.type === "farm" ? "food" : target.type;
      if (point) {
        const formation = destinations?.get(u.id) || point;
        u.order.x = formation.x;
        u.order.y = formation.y;
      }
    }
    return { ok: true };
  }
  return fail("Unknown command.");
}

function finish(state) {
  const player = state.buildings.some(
    (b) => b.type === "townCenter" && b.faction === "player" && b.hp > 0,
  );
  const enemy = state.buildings.some(
    (b) => b.type === "townCenter" && b.faction === "enemy" && b.hp > 0,
  );
  if (!player || !enemy) {
    state.status = !player ? "defeat" : "victory";
    event(
      state,
      state.status,
      0,
      0,
      state.status === "victory"
        ? "The Frontier is yours."
        : "Your Town Center has fallen.",
    );
    return true;
  }
  return false;
}

export function stepGame(state, dt = STEP) {
  if (!Number.isFinite(dt) || dt <= 0 || dt > 0.25)
    throw new RangeError("Simulation step must be between 0 and 0.25 seconds.");
  if (state.status !== "playing" || finish(state)) return state;
  state.tick++;
  state.time = Math.round((state.time + dt) * 1e9) / 1e9;
  updateRallyOrders(state);
  updateAI(state);
  for (const b of state.buildings) b.builders = 0;
  for (const u of state.units) {
    if (u.hp <= 0) continue;
    if (u.type === "worker" && updateWorker(state, u, dt)) continue;
    updateCombatUnit(state, u, dt);
  }
  updateBuildings(state, dt);
  updateDefenses(state, dt);
  separateUnits(state, dt);
  finish(state);
  state.units = state.units.filter((u) => u.hp > 0);
  state.buildings = state.buildings.filter((b) => b.hp > 0);
  return state;
}
