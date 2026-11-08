import { AI_CONFIG, UNIT_TYPES } from "./config.mjs";
import { makeUnit } from "./economy.mjs";
import { nearestOpen, spawnPoint, clearPath } from "./movement.mjs";
import { formationDestinations } from "./formations.mjs";
import { event, entityCenter, distance, distanceTo } from "./geometry.mjs";
import { lineOfSight } from "./combat.mjs";

const DECISION_INTERVAL = 0.75;
const military = (unit) => unit.type !== "worker" && unit.hp > 0;
const importance = (building) =>
  ["barracks", "workshop"].includes(building.type)
    ? 3
    : building.type === "townCenter"
      ? 2
      : 1;

function groupOrder(state, units, destination) {
  for (const point of formationDestinations(state, units, destination)) {
    const unit = units.find((candidate) => candidate.id === point.id);
    if (!unit) continue;
    unit.order = { type: "attackMove", x: point.x, y: point.y };
    clearPath(unit);
  }
}

// Structures report only attackers inside their local sight. Nearby guards
// share that observation, rather than inspecting the player's entire army.
function coordinateDefense(state, guards, structures) {
  const reports = [];
  for (const building of structures) {
    for (const opponent of state.units) {
      if (
        opponent.faction !== "player" ||
        opponent.type === "ram" ||
        opponent.hp <= 0 ||
        distanceTo(opponent, building) > 6 ||
        !lineOfSight(state, building, opponent)
      )
        continue;
      const attacking =
        opponent.order.type === "attack" &&
        opponent.order.targetId === building.id;
      reports.push({
        building,
        opponent,
        score: importance(building) + (attacking ? 4 : 0),
      });
    }
  }
  reports.sort(
    (a, b) => b.score - a.score || a.opponent.id.localeCompare(b.opponent.id),
  );
  for (const guard of guards) {
    guard.defenseTargetId = null;
    guard.siegeStandGround = false;
    if (guard.raiding) continue;
    const report = reports.find(
      ({ building, opponent }) =>
        distance(guard, building) <= 9 &&
        distance(guard, opponent) <= 8 &&
        (!guard.home || distance(guard.home, opponent) <= 10),
    );
    if (report) {
      guard.defenseTargetId = report.opponent.id;
      guard.aiRole = "defend";
      guard.defendingId = report.building.id;
    } else if (guard.aiRole !== "rally") {
      guard.aiRole = "guard";
      guard.defendingId = null;
    }
  }
}

// Siege information is shared only after a local guard or structure sees it.
// A small melee detachment can punish exposed equipment without dragging every
// defender out of the settlement or generating a new counter army.
function coordinateSiegeDefense(state, guards, structures) {
  const defenders = guards.filter((unit) => !unit.raiding);
  const interceptBudget = Math.min(
    3,
    Math.max(1, Math.floor(defenders.length / 2)),
  );
  const visibleToDefense = (target) =>
    structures.some(
      (building) =>
        distanceTo(target, building) <= 6 &&
        lineOfSight(state, building, target),
    ) ||
    defenders.some(
      (guard) =>
        distance(guard, target) <= UNIT_TYPES[guard.type].sight &&
        lineOfSight(state, guard, target),
    );
  const threats = state.units.filter(
    (unit) =>
      unit.faction === "player" &&
      unit.type === "ram" &&
      unit.hp > 0 &&
      visibleToDefense(unit),
  );
  threats.sort((a, b) => {
    const nearest = (ram) =>
      Math.min(
        ...structures.map((building) => distanceTo(ram, building)),
        Infinity,
      );
    return nearest(a) - nearest(b) || a.id.localeCompare(b.id);
  });
  let assigned = 0;
  for (const ram of threats) {
    const escorts = state.units.filter(
      (unit) =>
        unit.faction === "player" &&
        unit.type !== "worker" &&
        unit.type !== "ram" &&
        unit.hp > 0 &&
        distance(unit, ram) <= 2.6 &&
        visibleToDefense(unit),
    );
    if (escorts.length >= 2) continue;
    const available = defenders.filter(
      (guard) =>
        UNIT_TYPES[guard.type].range < 2 &&
        guard.aiRole !== "intercept" &&
        distance(guard, ram) <= 8 &&
        (!guard.home || distance(guard.home, ram) <= 10),
    );
    available.sort(
      (a, b) => distance(a, ram) - distance(b, ram) || a.id.localeCompare(b.id),
    );
    const count = Math.min(interceptBudget - assigned, available.length);
    for (const guard of available.slice(0, count)) {
      guard.defenseTargetId = ram.id;
      guard.aiRole = "intercept";
      guard.defendingId =
        structures
          .slice()
          .sort((a, b) => distance(ram, a) - distance(ram, b))[0]?.id || null;
      assigned++;
    }
  }
  if (assigned)
    for (const guard of defenders)
      if (guard.aiRole !== "intercept") guard.siegeStandGround = true;
  if (assigned && state.time >= (state.ai.nextSiegeNotice || 0)) {
    state.ai.nextSiegeNotice = state.time + 15;
    event(
      state,
      "siegeWarning",
      threats[0].x,
      threats[0].y,
      "Ember infantry are intercepting exposed siege equipment.",
    );
  }
}

function prepareRaid(state, guards, barracksList) {
  const staging = barracksList
    .slice()
    .sort((a, b) => b.y - a.y || a.id.localeCompare(b.id))[0];
  if (!staging) return;
  const rally = nearestOpen(state, staging.x - 1, staging.y - 2);
  if (!rally) return;
  const available = guards.filter(
    (unit) => !unit.raiding && !unit.defenseTargetId,
  );
  available.sort(
    (a, b) =>
      distance(a, rally) - distance(b, rally) || a.id.localeCompare(b.id),
  );
  const selected = available.slice(0, Math.min(4 + state.ai.wave, 9));
  state.ai.rally = {
    x: rally.x,
    y: rally.y,
    ids: selected.map((unit) => unit.id),
  };
  for (const unit of selected) unit.aiRole = "rally";
  groupOrder(state, selected, rally);
}

// The original Town Center is the scenario objective. A new player building
// becomes a tactical raid target only when a squad member actually sees it.
function coordinateRaid(state, guards) {
  const squads = new Map();
  for (const unit of guards) {
    if (!unit.raiding) continue;
    const key = unit.raidSquadId || 0;
    if (!squads.has(key)) squads.set(key, []);
    squads.get(key).push(unit);
  }
  for (const squad of squads.values()) {
    const visible = state.buildings.filter(
      (building) =>
        building.faction === "player" &&
        building.hp > 0 &&
        squad.some(
          (unit) =>
            distanceTo(unit, building) <= UNIT_TYPES[unit.type].sight &&
            lineOfSight(state, unit, building),
        ),
    );
    visible.sort(
      (a, b) => importance(b) - importance(a) || a.id.localeCompare(b.id),
    );
    for (const unit of squad) {
      unit.raidTargetId =
        visible.find((building) => distanceTo(unit, building) <= 8)?.id || null;
    }
  }
}

export function updateAI(state) {
  const ai = state.ai;
  const guards = state.units.filter(
    (unit) => unit.faction === "enemy" && military(unit),
  );
  const structures = state.buildings.filter(
    (building) =>
      building.faction === "enemy" &&
      building.hp > 0 &&
      building.progress === 1,
  );
  const barracksList = state.buildings.filter(
    (b) =>
      b.faction === "enemy" &&
      b.type === "barracks" &&
      b.hp > 0 &&
      b.progress === 1,
  );
  const barracks =
    barracksList[ai.reinforcements % Math.max(1, barracksList.length)];
  if (state.time >= ai.nextReinforcement) {
    ai.nextReinforcement += AI_CONFIG.reinforcementInterval;
    if (
      barracks &&
      state.units.filter((u) => u.faction === "enemy" && u.hp > 0).length <
        AI_CONFIG.maximumArmy
    ) {
      const p = spawnPoint(
        state,
        barracks.x + 1,
        barracks.y + barracks.height + 1,
      );
      if (p)
        makeUnit(
          state,
          ai.reinforcements++ % 4 === 3 ? "archer" : "infantry",
          "enemy",
          p.x,
          p.y,
        );
    }
  }
  if (state.time >= (ai.nextDecision || 0)) {
    ai.nextDecision = state.time + DECISION_INTERVAL;
    coordinateDefense(state, guards, structures);
    coordinateSiegeDefense(state, guards, structures);
    coordinateRaid(state, guards);
  }
  if (!ai.warned && state.time >= ai.nextRaid - 30) {
    ai.warned = true;
    prepareRaid(state, guards, barracksList);
    event(
      state,
      "warning",
      33,
      9,
      "Enemy raid assembling. Prepare your defenses.",
    );
  }
  if (state.time >= ai.nextRaid) {
    ai.wave++;
    ai.nextRaid += AI_CONFIG.raidInterval;
    ai.warned = false;
    const objective = state.buildings.find(
      (b) => b.type === "townCenter" && b.faction === "player" && b.hp > 0,
    );
    if (!objective) return;
    const rallied = new Set(ai.rally?.ids || []);
    const troops = guards
      .filter((u) => !u.raiding && !u.defenseTargetId)
      .sort(
        (a, b) =>
          Number(rallied.has(b.id)) - Number(rallied.has(a.id)) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, Math.min(3 + ai.wave, 9));
    const center = entityCenter(objective);
    const p = nearestOpen(state, center.x, center.y);
    if (!p) return;
    for (const unit of troops) {
      unit.raiding = true;
      unit.aiRole = "raid";
      unit.raidSquadId = ai.wave;
      unit.defenseTargetId = null;
    }
    groupOrder(state, troops, p);
    ai.rally = null;
    if (troops.length)
      event(
        state,
        "raid",
        33,
        9,
        `Raid ${ai.wave}: ${troops.length} enemies advance together.`,
      );
    else if (guards.some((unit) => unit.defenseTargetId))
      event(
        state,
        "defense",
        33,
        9,
        "Ember troops hold their settlement against your assault.",
      );
  }
}
