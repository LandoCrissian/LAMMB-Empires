import { UNIT_TYPES } from "./config.mjs";
import {
  byId,
  distance,
  distanceTo,
  entityCenter,
  event,
} from "./geometry.mjs";
import { blocked, clearPath, nearestOpen, plannedRoute } from "./movement.mjs";
import { formationDestinations, sameMovementRegion } from "./formations.mjs";

const PLAN_INTERVAL = 0.5;
const memberUnits = (state, cohort) =>
  cohort.ids
    .map((id) => state.units.find((unit) => unit.id === id && unit.hp > 0))
    .filter(
      (unit) =>
        unit?.order.type === "assault" && unit.order.squadId === cohort.id,
    );
const centerOf = (units) =>
  units.reduce(
    (point, unit) => ({
      x: point.x + unit.x / units.length,
      y: point.y + unit.y / units.length,
    }),
    { x: 0, y: 0 },
  );

/** Plan before changing any orders, preserving atomic command rejection. */
export function prepareAssault(state, units, order) {
  if (units.some((unit) => unit.type === "worker"))
    return {
      ok: false,
      reason: "Select military units for a coordinated assault.",
    };
  let target;
  if (order.targetId !== undefined) {
    target = byId(state, order.targetId);
    if (!target?.faction || target.faction === "player")
      return { ok: false, reason: "Choose an enemy target or open ground." };
  }
  const requested = target ? entityCenter(target) : order;
  if (
    ![requested.x, requested.y].every(Number.isFinite) ||
    requested.x < 0 ||
    requested.y < 0 ||
    requested.x >= state.map.width ||
    requested.y >= state.map.height
  )
    return {
      ok: false,
      reason: "Choose an assault destination on the battlefield.",
    };
  const center = centerOf(units);
  let goal = { x: requested.x, y: requested.y };
  if (target?.width) {
    const from = distance(center, requested) > 0.01 ? center : units[0];
    const length = distance(from, requested);
    const forward =
      length > 0.01
        ? {
            x: (requested.x - from.x) / length,
            y: (requested.y - from.y) / length,
          }
        : { x: 0, y: -1 };
    const edge = Math.min(
      Math.abs(forward.x) > 1e-6
        ? target.width / 2 / Math.abs(forward.x)
        : Infinity,
      Math.abs(forward.y) > 1e-6
        ? target.height / 2 / Math.abs(forward.y)
        : Infinity,
    );
    goal = {
      x: requested.x - forward.x * (edge + 2.25),
      y: requested.y - forward.y * (edge + 2.25),
    };
  }
  goal = nearestOpen(state, goal.x, goal.y);
  if (!goal) return { ok: false, reason: "No open assault approach." };
  const leader = units
    .slice()
    .sort(
      (a, b) =>
        UNIT_TYPES[a.type].speed - UNIT_TYPES[b.type].speed ||
        a.id.localeCompare(b.id),
    )[0];
  if (units.some((unit) => !sameMovementRegion(state, unit, goal)))
    return {
      ok: false,
      reason: "Regroup the army on the same side of the crossing first.",
    };
  const route = plannedRoute(state, leader, goal);
  if (!route.length && distance(leader, goal) > 0.205)
    return {
      ok: false,
      reason: "The army cannot reach that assault approach.",
    };
  const slots = formationDestinations(
    state,
    units,
    goal,
    {
      x: goal.x - center.x,
      y: goal.y - center.y,
    },
    true,
  );
  if (
    slots.length !== units.length ||
    slots.some(
      (slot) => distance(slot, goal) > Math.max(4, Math.sqrt(units.length) + 1),
    )
  )
    return {
      ok: false,
      reason: "The selected army cannot reach one assault approach.",
    };
  return {
    ok: true,
    plan: {
      goal,
      targetId: target?.id || null,
      anchor: { x: leader.x, y: leader.y },
      route,
    },
  };
}

/** New commands always take precedence, including partial army selections. */
export function detachAssault(state, units) {
  if (!state.assaults?.length) return;
  const ids = new Set(units.map((unit) => unit.id));
  for (const cohort of state.assaults)
    cohort.ids = cohort.ids.filter((id) => !ids.has(id));
  state.assaults = state.assaults.filter((cohort) => cohort.ids.length);
}

function assignSlots(state, cohort, units) {
  const next = cohort.route[cohort.routeIndex] || cohort.goal;
  const facing = { x: next.x - cohort.anchor.x, y: next.y - cohort.anchor.y };
  if (Math.hypot(facing.x, facing.y) < 0.01) {
    facing.x = cohort.goal.x - cohort.anchor.x;
    facing.y = cohort.goal.y - cohort.anchor.y;
  }
  cohort.slots = formationDestinations(
    state,
    units,
    cohort.anchor,
    facing,
    true,
  );
  for (const slot of cohort.slots) {
    const unit = units.find((member) => member.id === slot.id);
    unit.order.x = slot.x;
    unit.order.y = slot.y;
  }
  cohort.nextPlanAt = state.time + PLAN_INTERVAL;
}

export function beginAssault(state, units, plan) {
  detachAssault(state, units);
  const id = `assault-${state.nextAssaultId++}`;
  const cohort = {
    id,
    ids: units.map((unit) => unit.id),
    ...plan,
    routeIndex: 0,
    routeVersion: state.obstacleVersion,
    phase: "regroup",
    until: state.time + 0.6,
    staged: false,
    reached: false,
    nextPlanAt: state.time,
    nextCohesionAt: state.time + 3,
    nextReplanAt: 0,
    slots: [],
    crossings: [],
    regroupReason: "assemble",
  };
  state.assaults.push(cohort);
  for (const unit of units) {
    unit.order = {
      type: "assault",
      squadId: id,
      phase: cohort.phase,
      targetId: plan.targetId,
      x: unit.x,
      y: unit.y,
    };
    unit.rallyAssignment = null;
    unit.delivering = false;
    clearPath(unit);
  }
  assignSlots(state, cohort, units);
  event(
    state,
    "assault",
    plan.goal.x,
    plan.goal.y,
    `${units.length} troops coordinate an assault. Infantry screen the archers and siege.`,
    { squadId: id, targetId: plan.targetId },
  );
  return { ok: true, squadId: id };
}

function advanceAnchor(cohort, dt, speed) {
  let remaining = dt * speed;
  while (remaining > 0 && cohort.routeIndex < cohort.route.length) {
    const next = cohort.route[cohort.routeIndex];
    const length = distance(cohort.anchor, next);
    if (length <= remaining + 1e-8) {
      cohort.anchor = { ...next };
      cohort.routeIndex++;
      remaining -= length;
    } else {
      cohort.anchor.x += ((next.x - cohort.anchor.x) / length) * remaining;
      cohort.anchor.y += ((next.y - cohort.anchor.y) / length) * remaining;
      remaining = 0;
    }
  }
  cohort.reached = cohort.routeIndex >= cohort.route.length;
}

function narrowCell(state, point) {
  const x = Math.floor(point.x),
    y = Math.floor(point.y);
  return (
    (blocked(state, x - 1, y) && blocked(state, x + 1, y)) ||
    (blocked(state, x, y - 1) && blocked(state, x, y + 1))
  );
}

/** Fixed-step strategic coordination; it never moves or heals a real unit. */
export function updateAssaults(state, dt) {
  if (!state.assaults?.length) return;
  for (const cohort of state.assaults) {
    const units = memberUnits(state, cohort);
    cohort.ids = units.map((unit) => unit.id);
    if (!units.length) continue;
    const obstacleChanged = cohort.routeVersion !== state.obstacleVersion;
    if (
      obstacleChanged ||
      (cohort.phase === "blocked" && state.time >= cohort.nextReplanAt)
    ) {
      if (
        blocked(state, Math.floor(cohort.anchor.x), Math.floor(cohort.anchor.y))
      ) {
        const leader = units
          .slice()
          .sort(
            (a, b) =>
              distance(a, cohort.anchor) - distance(b, cohort.anchor) ||
              a.id.localeCompare(b.id),
          )[0];
        cohort.anchor = { x: leader.x, y: leader.y };
      }
      const connected = units.every((unit) =>
        sameMovementRegion(state, unit, cohort.goal),
      );
      cohort.route = connected
        ? plannedRoute(state, cohort.anchor, cohort.goal)
        : [];
      cohort.routeIndex = 0;
      cohort.routeVersion = state.obstacleVersion;
      cohort.nextReplanAt = state.time + 1.2;
      const failed =
        !connected ||
        (!cohort.route.length && distance(cohort.anchor, cohort.goal) > 0.205);
      if (failed && cohort.phase !== "blocked")
        event(
          state,
          "assaultBlocked",
          cohort.anchor.x,
          cohort.anchor.y,
          "Assault route blocked. Troops regroup on reachable ground; reopen the route or give a new order.",
        );
      cohort.phase = failed ? "blocked" : "advance";
      cohort.nextPlanAt = state.time;
      cohort.reached = !failed && !cohort.route.length;
    }
    if (cohort.phase !== "blocked") {
      const target = byId(state, cohort.targetId);
      if (
        target?.width &&
        !cohort.staged &&
        distanceTo(cohort.anchor, target) <= 7
      ) {
        cohort.staged = true;
        cohort.phase = "staging";
        cohort.until = state.time + 0.9;
        cohort.nextPlanAt = state.time;
      }
      const alreadyPaused =
        ["regroup", "staging"].includes(cohort.phase) &&
        state.time < cohort.until;
      if (!alreadyPaused && units.length > 2) {
        for (
          let i = cohort.routeIndex;
          i < Math.min(cohort.route.length, cohort.routeIndex + 3);
          i++
        ) {
          const point = cohort.route[i],
            previous = i ? cohort.route[i - 1] : cohort.anchor;
          const key = `${Math.floor(point.x)},${Math.floor(point.y)}`;
          if (
            !narrowCell(state, point) ||
            narrowCell(state, previous) ||
            cohort.crossings.includes(key)
          )
            continue;
          cohort.crossings.push(key);
          cohort.phase = "regroup";
          cohort.regroupReason = "crossing";
          cohort.until = state.time + 0.8;
          cohort.nextCohesionAt = state.time + 4;
          cohort.nextPlanAt = state.time;
          event(
            state,
            "regroup",
            point.x,
            point.y,
            "Army regrouping at a narrow crossing.",
            { squadId: cohort.id },
          );
          break;
        }
      }
      const timedPause =
        ["regroup", "staging"].includes(cohort.phase) &&
        state.time < cohort.until;
      const fighting = units.some((unit) => {
        const enemy = byId(state, unit.combatTargetId);
        return enemy && distanceTo(cohort.anchor, enemy) <= 6;
      });
      if (!timedPause) {
        const radius = Math.max(3.5, Math.sqrt(units.length) * 0.75 + 1);
        if (
          !fighting &&
          !cohort.reached &&
          state.time >= cohort.nextCohesionAt &&
          units.some((unit) => distance(unit, cohort.anchor) > radius)
        ) {
          cohort.phase = "regroup";
          cohort.regroupReason = "support";
          cohort.until = state.time + 1.2;
          cohort.nextCohesionAt = state.time + 4;
        } else {
          cohort.phase = fighting || cohort.reached ? "engage" : "advance";
          cohort.regroupReason = null;
          if (!fighting && !cohort.reached) {
            const speed = Math.min(
              ...units.map((unit) => UNIT_TYPES[unit.type].speed),
            );
            advanceAnchor(cohort, dt, speed);
          }
        }
      }
    }
    if (state.time >= cohort.nextPlanAt || obstacleChanged)
      assignSlots(state, cohort, units);
    for (const unit of units) unit.order.phase = cohort.phase;
    const objective = byId(state, cohort.targetId);
    const noTarget = !objective || distanceTo(cohort.anchor, objective) > 6;
    if (
      cohort.reached &&
      noTarget &&
      units.every(
        (unit) => !unit.combatTargetId && distance(unit, unit.order) < 0.8,
      )
    ) {
      for (const unit of units) {
        unit.order = { type: "idle" };
        clearPath(unit);
      }
      cohort.ids = [];
    }
  }
  state.assaults = state.assaults.filter((cohort) => cohort.ids.length);
}

export function assaultCohort(state, unit) {
  return (
    state.assaults?.find(
      (cohort) =>
        cohort.id === unit.order.squadId && cohort.ids.includes(unit.id),
    ) || null
  );
}
