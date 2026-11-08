import { UNIT_TYPES, BUILDING_TYPES } from "./config.mjs";
import { applyDamage } from "./rules.mjs";
import {
  byId,
  distanceTo,
  distance,
  entityCenter,
  event,
} from "./geometry.mjs";
import { blocked, clearPath, moveToward, reachable } from "./movement.mjs";

export function enemies(state, faction) {
  return [...state.units, ...state.buildings].filter(
    (e) => e.faction !== faction && e.hp > 0,
  );
}

// Structures cannot shoot through the river banks. Ground units can fire across water,
// but ridges occlude arrows and create useful firing corridors.
export function lineOfSight(state, source, target) {
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

// A ground ram cannot strike through a bank, a rock corner or another structure.
// The target footprint itself is ignored so contact is measured at its wall.
export function siegeContact(state, source, target) {
  const a = entityCenter(source),
    b = entityCenter(target);
  let x = Math.floor(a.x),
    y = Math.floor(a.y);
  const endX = Math.floor(b.x),
    endY = Math.floor(b.y),
    dx = b.x - a.x,
    dy = b.y - a.y;
  const sx = Math.sign(dx),
    sy = Math.sign(dy),
    deltaX = dx ? 1 / Math.abs(dx) : Infinity,
    deltaY = dy ? 1 / Math.abs(dy) : Infinity;
  let nextX = dx ? ((sx > 0 ? x + 1 : x) - a.x) / dx : Infinity,
    nextY = dy ? ((sy > 0 ? y + 1 : y) - a.y) / dy : Infinity;
  if (blocked(state, x, y, target.id)) return false;
  // Exact grid traversal treats a vertex crossing as touching both side cells.
  // Sampled rays can miss that corner when floating-point ties split the steps.
  for (let step = 0; step < state.map.width + state.map.height + 4; step++) {
    if (x === endX && y === endY) return true;
    if (Math.abs(nextX - nextY) < 1e-9) {
      if (
        blocked(state, x + sx, y, target.id) ||
        blocked(state, x, y + sy, target.id)
      )
        return false;
      x += sx;
      y += sy;
      nextX += deltaX;
      nextY += deltaY;
    } else if (nextX < nextY) {
      x += sx;
      nextX += deltaX;
    } else {
      y += sy;
      nextY += deltaY;
    }
    if (blocked(state, x, y, target.id)) return false;
  }
  return false;
}

function approachSiegeContact(state, unit, target, dt, speed, range) {
  const center = entityCenter(target);
  const key = `${target.id}:${Math.floor(center.x)},${Math.floor(center.y)}:${state.obstacleVersion}`;
  if (
    unit.contactKey !== key ||
    (unit.contactGoal &&
      (!siegeContact(state, unit.contactGoal, target) ||
        distanceTo(unit.contactGoal, target) > range + 0.005)) ||
    (!unit.contactGoal && state.time >= (unit.contactRetryAt || 0))
  ) {
    unit.contactKey = key;
    unit.contactGoal = null;
    const radius = Math.ceil((target.width || 1) + range + 1),
      candidates = [];
    for (
      let y = Math.max(0, Math.floor(center.y - radius));
      y < Math.min(state.map.height, Math.ceil(center.y + radius));
      y++
    ) {
      for (
        let x = Math.max(0, Math.floor(center.x - radius));
        x < Math.min(state.map.width, Math.ceil(center.x + radius));
        x++
      ) {
        const point = { x: x + 0.5, y: y + 0.5 };
        if (
          blocked(state, x, y) ||
          distanceTo(point, target) > range + 0.005 ||
          !siegeContact(state, point, target)
        )
          continue;
        candidates.push(point);
      }
    }
    candidates.sort(
      (a, b) => distance(unit, a) - distance(unit, b) || a.y - b.y || a.x - b.x,
    );
    unit.contactGoal =
      candidates.find((point) => reachable(state, unit, point, 0.12)) || null;
    unit.contactRetryAt = state.time + 1.2;
    clearPath(unit);
  }
  if (unit.contactGoal)
    moveToward(state, unit, unit.contactGoal, 0.12, dt, speed);
}

export function findTarget(state, unit, sight, predicate = () => true) {
  return enemies(state, unit.faction)
    .filter((e) => distanceTo(unit, e) <= sight && predicate(e))
    .sort((a, b) => {
      // Nearby soldiers are a threat; workers and structures are secondary targets.
      const priority = (e) =>
        unit.type === "ram"
          ? e.width
            ? 0
            : e.type === "worker"
              ? 2
              : 1
          : e.width
            ? 2
            : e.type === "worker"
              ? 1
              : 0;
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
  const structureHit = !!target.width;
  const siege = attacker.type === "ram";
  // Rams trade general-purpose damage for a slow, committed structural blow.
  // Melee troops can dismantle an unescorted ram; defensive arrows remain useful.
  const baseDamage =
    structureHit && def.structureDamage
      ? def.structureDamage
      : def.damage *
        (target.type === "ram" &&
        !attacker.width &&
        def.range < 2 &&
        attacker.type !== "ram"
          ? 1.5
          : 1);
  const damage = Math.round(baseDamage * 100) / 100;
  const beforeHp = target.hp;
  target.hp = applyDamage(target.hp, damage);
  attacker.cooldown = def.period;
  attacker.lastAttackAt = state.time;
  attacker.lastTargetId = target.id;
  target.lastHitAt = state.time;
  target.lastHitDamage = damage;
  event(state, "attack", a.x, a.y, undefined, {
    attackerId: attacker.id,
    attackerType: attacker.type,
    targetX: b.x,
    targetY: b.y,
    targetId: target.id,
    ranged: def.range > 2,
    faction: attacker.faction,
    damage,
    actualDamage: beforeHp - target.hp,
    siege,
    structureHit,
  });
  if (target.hp === 0) {
    const lossText =
      target.type === "ram"
        ? target.faction === "player"
          ? "A Siege Ram was lost. Keep siege equipment escorted."
          : "Enemy Siege Ram destroyed."
        : target.type === "workshop"
          ? target.faction === "player"
            ? "Your Siege Workshop has been destroyed."
            : "Enemy Siege Workshop destroyed."
          : undefined;
    event(state, "death", b.x, b.y, lossText, {
      entityId: target.id,
      faction: target.faction,
      entityType: target.type,
      width: target.width || 0,
      height: target.height || 0,
    });
    if (target.width) state.obstacleVersion++;
    if (siege && target.width)
      event(
        state,
        "siege",
        b.x,
        b.y,
        `Siege Ram breached the ${BUILDING_TYPES[target.type].label}.`,
        { faction: attacker.faction, targetId: target.id },
      );
  }
}

export function updateCombatUnit(state, unit, dt) {
  const def = UNIT_TYPES[unit.type],
    order = unit.order;
  unit.combatTargetId = null;
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
  if (order.type === "hold") {
    target = findTarget(state, unit, def.range + 0.05, (candidate) =>
      unit.type === "ram"
        ? siegeContact(state, unit, candidate)
        : lineOfSight(state, unit, candidate),
    );
    if (target) {
      unit.combatTargetId = target.id;
      if (unit.cooldown <= 0) strike(state, unit, target, def);
    }
    // Hold is an actual firing discipline: do not path toward a target or home.
    clearPath(unit);
    return;
  }
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
    const coordinated =
      unit.faction === "enemy"
        ? byId(state, unit.raiding ? unit.raidTargetId : unit.defenseTargetId)
        : null;
    const nearby = findTarget(
      state,
      unit,
      def.sight,
      (candidate) =>
        (unit.faction !== "enemy" || lineOfSight(state, unit, candidate)) &&
        !(
          unit.siegeStandGround &&
          candidate.type === "ram" &&
          distanceTo(unit, candidate) > def.range + 0.05
        ),
    );
    target =
      coordinated &&
      coordinated.faction === "player" &&
      distance(unit, coordinated) <= 8 &&
      (unit.raiding || !unit.home || distance(unit.home, coordinated) <= 10) &&
      (!unit.raiding || !nearby || nearby.width)
        ? coordinated
        : nearby;
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
    unit.combatTargetId = target.id;
    const inRange = distanceTo(unit, target) <= def.range + 0.05;
    if (
      inRange &&
      (unit.type === "ram"
        ? siegeContact(state, unit, target)
        : def.range < 2 || lineOfSight(state, unit, target))
    ) {
      clearPath(unit);
      if (unit.type === "ram") {
        unit.contactGoal = null;
        unit.contactKey = "";
      }
      if (unit.cooldown <= 0) strike(state, unit, target, def);
    } else {
      if (unit.type === "ram" && (inRange || unit.contactGoal))
        approachSiegeContact(state, unit, target, dt, def.speed, def.range);
      else {
        const range = inRange ? 0.7 : def.range;
        moveToward(state, unit, target, range, dt, def.speed);
      }
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
    unit.aiRole !== "rally" &&
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
