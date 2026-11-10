import { UNIT_TYPES, BUILDING_TYPES } from "./config.mjs";
import { byId, distance, event, entityCenter } from "./geometry.mjs";
import { moveToward, clearPath } from "./movement.mjs";
import { productionSpawnPoint, applyProductionRally } from "./rally.mjs";

// Keep resource transfers at a shared precision so repeated fractional gathers
// cannot leave a full load just below its capacity or an integer purchase cost.
const resourceAmount = (value) => Math.round(value * 1e6) / 1e6;

export function makeUnit(state, type, faction, x, y) {
  const def = UNIT_TYPES[type];
  const unit = {
    id: `u${state.nextId++}`,
    type,
    faction,
    x,
    y,
    hp: def.hp,
    maxHp: def.hp,
    order: { type: "idle" },
    cooldown: 0,
    path: [],
    pathKey: "",
    pathAge: 0,
    carry: null,
  };
  if (faction === "enemy") unit.home = { x, y };
  state.units.push(unit);
  return unit;
}

function dropOff(state, worker, dt) {
  const center = state.buildings
    .filter(
      (b) =>
        b.hp > 0 &&
        b.faction === worker.faction &&
        b.type === "townCenter" &&
        b.progress === 1,
    )
    .sort((a, b) => distance(worker, a) - distance(worker, b))[0];
  if (!center) return;
  if (moveToward(state, worker, center, 0.8, dt, UNIT_TYPES.worker.speed)) {
    state.resources[worker.carry.type] = resourceAmount(
      state.resources[worker.carry.type] + worker.carry.amount,
    );
    event(
      state,
      "delivery",
      worker.x,
      worker.y,
      `+${Math.round(worker.carry.amount)} ${worker.carry.type}`,
      { resource: worker.carry.type, amount: worker.carry.amount },
    );
    worker.carry = null;
    worker.delivering = false;
  }
}

export function updateWorker(state, worker, dt) {
  const order = worker.order,
    def = UNIT_TYPES.worker;
  if (worker.carry?.amount > 0 && worker.delivering) {
    dropOff(state, worker, dt);
    return true;
  }
  if (order.type === "gather") {
    let target = byId(state, order.targetId);
    const available =
      target &&
      (target.amount > 0 ||
        (target.type === "farm" &&
          target.progress === 1 &&
          target.foodRemaining > 0));
    if (!available) {
      if (worker.carry?.amount > 0) {
        worker.delivering = true;
        dropOff(state, worker, dt);
        return true;
      }
      const resource = worker.gatherResource;
      const candidates = [
        ...state.nodes.filter((n) => n.type === resource && n.amount > 0),
        ...state.buildings.filter(
          (b) =>
            resource === "food" &&
            b.type === "farm" &&
            b.faction === worker.faction &&
            b.hp > 0 &&
            b.progress === 1 &&
            b.foodRemaining > 0,
        ),
      ];
      target = candidates.sort(
        (a, b) => distance(worker, a) - distance(worker, b),
      )[0];
      if (!target) {
        worker.order = { type: "idle" };
        clearPath(worker);
        return true;
      }
      order.targetId = target.id;
    }
    const resource = target.type === "farm" ? "food" : target.type;
    if (
      worker.carry &&
      worker.carry.type !== resource &&
      worker.carry.amount > 0
    ) {
      worker.delivering = true;
      dropOff(state, worker, dt);
      return true;
    }
    const range = target.width ? 0.8 : 1.15;
    if (moveToward(state, worker, target, range, dt, def.speed)) {
      worker.gatherResource = resource;
      const remaining =
        target.type === "farm" ? target.foodRemaining : target.amount;
      const amount = resourceAmount(
        Math.min(
          def.gatherRate * dt,
          remaining,
          def.capacity - (worker.carry?.amount || 0),
        ),
      );
      worker.carry ??= { type: resource, amount: 0 };
      worker.carry.amount = resourceAmount(worker.carry.amount + amount);
      if (target.type === "farm")
        target.foodRemaining = Math.max(
          0,
          resourceAmount(target.foodRemaining - amount),
        );
      else {
        target.amount = Math.max(0, resourceAmount(target.amount - amount));
        if (target.amount === 0) state.obstacleVersion++;
      }
      if (worker.carry.amount >= def.capacity - 0.0001 || remaining <= amount)
        worker.delivering = true;
    }
    return true;
  }
  if (order.type === "build") {
    const target = byId(state, order.targetId);
    if (!target || target.faction !== worker.faction || target.progress === 1) {
      worker.order =
        target?.type === "farm" && target.foodRemaining > 0
          ? { type: "gather", targetId: target.id }
          : { type: "idle" };
      clearPath(worker);
      return true;
    }
    if (moveToward(state, worker, target, 0.8, dt, def.speed))
      target.builders = (target.builders || 0) + 1;
    return true;
  }
  return false;
}

export function updateBuildings(state, dt) {
  for (const b of state.buildings) {
    if (b.hp <= 0) continue;
    const def = BUILDING_TYPES[b.type];
    if (b.progress < 1 && b.builders > 0) {
      const increase = Math.min(
        1 - b.progress,
        (dt * Math.min(3, b.builders)) / def.buildTime,
      );
      b.progress = Math.min(1, b.progress + increase);
      b.hp = Math.min(b.maxHp, b.hp + increase * b.maxHp * 0.75);
      if (b.progress >= 1 - 1e-8) {
        b.progress = 1;
        event(
          state,
          "built",
          ...Object.values(entityCenter(b)),
          `${def.label} complete`,
        );
      }
    }
    b.builders = 0;
    if (b.progress !== 1 || !b.queue.length) continue;
    const item = b.queue[0];
    item.remaining = Math.max(0, item.remaining - dt);
    if (item.remaining <= 1e-8) {
      const point = productionSpawnPoint(state, b, item.unitType);
      if (point) {
        const unit = makeUnit(
          state,
          item.unitType,
          b.faction,
          point.x,
          point.y,
        );
        b.queue.shift();
        b.spawnBlocked = false;
        applyProductionRally(state, b, unit);
        event(
          state,
          "trained",
          unit.x,
          unit.y,
          `${UNIT_TYPES[unit.type].label} ready`,
          { unitId: unit.id, unitType: unit.type, buildingId: b.id },
        );
      } else if (!b.spawnBlocked) {
        b.spawnBlocked = true;
        event(
          state,
          "productionBlocked",
          b.x,
          b.y,
          "Production exit crowded or blocked. Clear space near the building.",
        );
      }
    }
  }
}
