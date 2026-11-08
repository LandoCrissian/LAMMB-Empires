import { UNIT_TYPES, BUILDING_TYPES } from "./config.mjs";
import { applyDamage } from "./rules.mjs";
import {
  byId,
  distanceTo,
  distance,
  entityCenter,
  event,
} from "./geometry.mjs";
import { clearPath, moveToward } from "./movement.mjs";

export function enemies(state, faction) {
  return [...state.units, ...state.buildings].filter(
    (e) => e.faction !== faction && e.hp > 0,
  );
}

// Structures cannot shoot through the river banks. Ground units can fire across water,
// but ridges occlude arrows and create useful firing corridors.
function lineOfSight(state, source, target) {
  const a = entityCenter(source),
    b = entityCenter(target),
    steps = Math.ceil(distance(a, b) * 3);
  for (let i = 1; i < steps; i++) {
    const t = i / steps,
      x = Math.floor(a.x + (b.x - a.x) * t),
      y = Math.floor(a.y + (b.y - a.y) * t);
    if (state.map.terrain[y]?.[x] === "ridge") return false;
  }
  return true;
}

export function findTarget(state, unit, sight, predicate = () => true) {
  return enemies(state, unit.faction)
    .filter((e) => distanceTo(unit, e) <= sight && predicate(e))
    .sort((a, b) => {
      // Nearby soldiers are a threat; workers and structures are secondary targets.
      const priority = (e) => (e.width ? 2 : e.type === "worker" ? 1 : 0);
      return (
        priority(a) - priority(b) ||
        distanceTo(unit, a) - distanceTo(unit, b) ||
        a.id.localeCompare(b.id)
      );
    })[0];
}

function strike(state, attacker, target, def) {
  const a = entityCenter(attacker),
    b = entityCenter(target);
  target.hp = applyDamage(target.hp, def.damage);
  attacker.cooldown = def.period;
  event(state, "attack", a.x, a.y, undefined, {
    targetX: b.x,
    targetY: b.y,
    targetId: target.id,
    ranged: def.range > 2,
    faction: attacker.faction,
    damage: def.damage,
  });
  if (target.hp === 0) {
    event(state, "death", b.x, b.y, undefined, {
      faction: target.faction,
      entityType: target.type,
    });
    if (target.width) state.obstacleVersion++;
  }
}

export function updateCombatUnit(state, unit, dt) {
  const def = UNIT_TYPES[unit.type],
    order = unit.order;
  unit.cooldown = Math.max(0, unit.cooldown - dt);
  if (order.type === "move") {
    if (moveToward(state, unit, order, 0.2, dt, def.speed))
      unit.order = { type: "idle" };
    return;
  }
  if (order.type === "stop") {
    unit.order = { type: "idle" };
    return;
  }
  let target;
  if (order.type === "attack") target = byId(state, order.targetId);
  if (
    target &&
    (target.faction === unit.faction || target.amount !== undefined)
  )
    target = null;
  if (order.type === "attack" && !target) {
    unit.order = { type: "idle" };
    clearPath(unit);
  }
  if (
    !target &&
    unit.type !== "worker" &&
    ["idle", "attackMove"].includes(unit.order.type)
  ) {
    // Enemy defenders remain tethered to their own settlement until committed to a raid.
    target = findTarget(state, unit, def.sight);
    if (
      unit.faction === "enemy" &&
      !unit.raiding &&
      target &&
      unit.home &&
      distance(unit.home, target) > 10
    )
      target = null;
  }
  if (target) {
    const inRange = distanceTo(unit, target) <= def.range + 0.05;
    if (inRange && (def.range < 2 || lineOfSight(state, unit, target))) {
      clearPath(unit);
      if (unit.cooldown <= 0) strike(state, unit, target, def);
    } else {
      const range = inRange ? 0.7 : def.range;
      moveToward(state, unit, target, range, dt, def.speed);
    }
    return;
  }
  if (order.type === "attackMove") {
    if (moveToward(state, unit, order, 0.2, dt, def.speed))
      unit.order = { type: "idle" };
  } else if (
    unit.faction === "enemy" &&
    unit.home &&
    !unit.raiding &&
    distance(unit, unit.home) > 1
  )
    moveToward(state, unit, unit.home, 0.75, dt, def.speed);
}

export function updateDefenses(state, dt) {
  for (const b of state.buildings) {
    const def = BUILDING_TYPES[b.type];
    if (b.hp <= 0 || b.progress !== 1 || !def.damage) continue;
    b.cooldown = Math.max(0, (b.cooldown || 0) - dt);
    const center = { ...entityCenter(b), faction: b.faction };
    const target = findTarget(state, center, def.range, (e) =>
      lineOfSight(state, center, e),
    );
    if (target && b.cooldown <= 0) strike(state, b, target, def);
  }
}
