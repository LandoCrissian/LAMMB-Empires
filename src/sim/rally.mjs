import { blocked, clearPath } from "./movement.mjs";
import { byId, distanceTo, entityCenter, event } from "./geometry.mjs";

const PRODUCERS = new Set(["townCenter", "barracks", "workshop"]);
const regionCache = new WeakMap();
const directions = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/** Production and rally reachability uses the same static terrain/corner rules as A*. */
function regions(state) {
  const cached = regionCache.get(state);
  if (cached?.map === state.map && cached.version === state.obstacleVersion)
    return cached;
  const { width, height } = state.map;
  const open = new Uint8Array(width * height),
    labels = new Int32Array(width * height),
    queue = new Int32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      open[y * width + x] = blocked(state, x, y) ? 0 : 1;
  let label = 0;
  for (let start = 0; start < open.length; start++) {
    if (!open[start] || labels[start]) continue;
    label++;
    let head = 0,
      tail = 1;
    queue[0] = start;
    labels[start] = label;
    while (head < tail) {
      const i = queue[head++],
        x = i % width,
        y = Math.floor(i / width);
      for (const [dx, dy] of directions) {
        const nx = x + dx,
          ny = y + dy,
          next = ny * width + nx;
        if (
          nx < 0 ||
          ny < 0 ||
          nx >= width ||
          ny >= height ||
          !open[next] ||
          labels[next]
        )
          continue;
        if (dx && dy && (!open[y * width + nx] || !open[ny * width + x]))
          continue;
        labels[next] = label;
        queue[tail++] = next;
      }
    }
  }
  const result = {
    map: state.map,
    version: state.obstacleVersion,
    labels,
    width,
    height,
  };
  regionCache.set(state, result);
  return result;
}

function labelAt(info, x, y) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  return ix >= 0 && iy >= 0 && ix < info.width && iy < info.height
    ? info.labels[iy * info.width + ix]
    : 0;
}

function exitRegions(state, building) {
  const info = regions(state),
    labels = new Set();
  for (let x = building.x; x < building.x + building.width; x++) {
    for (const y of [building.y - 1, building.y + building.height]) {
      const label = labelAt(info, x + 0.5, y + 0.5);
      if (label) labels.add(label);
    }
  }
  for (let y = building.y; y < building.y + building.height; y++) {
    for (const x of [building.x - 1, building.x + building.width]) {
      const label = labelAt(info, x + 0.5, y + 0.5);
      if (label) labels.add(label);
    }
  }
  return labels;
}

export function isProductionBuilding(building) {
  return (
    !!building &&
    PRODUCERS.has(building.type) &&
    building.hp > 0 &&
    building.progress === 1
  );
}

function gatherTarget(state, id, faction = "player") {
  const target = byId(state, id);
  return target &&
    (target.amount > 0 ||
      (target.type === "farm" &&
        target.faction === faction &&
        target.progress === 1 &&
        target.foodRemaining > 0))
    ? target
    : null;
}

function interactionReachable(state, labels, target) {
  const info = regions(state),
    range = target.width ? 0.8 : 1.15;
  const center = entityCenter(target),
    half = (target.width || 0) + 2;
  for (
    let y = Math.max(0, Math.floor(center.y - half));
    y < Math.min(info.height, Math.ceil(center.y + half));
    y++
  ) {
    for (
      let x = Math.max(0, Math.floor(center.x - half));
      x < Math.min(info.width, Math.ceil(center.x + half));
      x++
    ) {
      if (
        labels.has(info.labels[y * info.width + x]) &&
        distanceTo({ x: x + 0.5, y: y + 0.5 }, target) <= range + 0.001
      )
        return true;
    }
  }
  return false;
}

function nearestInRegions(state, labels, destination) {
  const info = regions(state);
  let best = null,
    bestDistance = Infinity;
  for (let i = 0; i < info.labels.length; i++) {
    if (!labels.has(info.labels[i]) || !info.labels[i]) continue;
    const point = {
      x: (i % info.width) + 0.5,
      y: Math.floor(i / info.width) + 0.5,
    };
    const d = Math.hypot(point.x - destination.x, point.y - destination.y);
    if (d < bestDistance - 1e-9) {
      bestDistance = d;
      best = point;
    }
  }
  return best;
}

export function rallyPlacement(state, buildingId, destination = {}) {
  const building = state.buildings.find(
    (b) => b.id === buildingId && b.faction === "player",
  );
  const fail = (reason) => ({ ok: false, reason });
  if (state.status !== "playing") return fail("This match has ended.");
  if (!isProductionBuilding(building))
    return fail(
      "Select your completed Town Center, Barracks, or Siege Workshop.",
    );
  if (!destination || typeof destination !== "object")
    return fail("Choose a rally destination on the battlefield.");
  const { x, y, targetId } = destination;
  if (
    ![x, y].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    x >= state.map.width ||
    y >= state.map.height
  )
    return fail("Choose a rally destination on the battlefield.");
  const exits = exitRegions(state, building);
  if (!exits.size) return fail("The production building has no walkable exit.");
  if (targetId !== undefined && targetId !== null) {
    if (building.type !== "townCenter")
      return fail("Military production rallies need a ground destination.");
    const target = gatherTarget(state, targetId, building.faction);
    if (!target)
      return fail("Choose a live deposit or your completed, stocked Farm.");
    if (!interactionReachable(state, exits, target))
      return fail("New workers cannot reach that resource.");
    return {
      ok: true,
      rally: { type: "gather", ...entityCenter(target), targetId: target.id },
    };
  }
  const info = regions(state),
    label = labelAt(info, x, y);
  if (!label) return fail("Choose open walkable ground for the rally point.");
  if (!exits.has(label))
    return fail("New units cannot reach that rally point.");
  return {
    ok: true,
    rally: { type: "move", x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 },
  };
}

function resolveRally(state, rally, labels, faction) {
  if (rally.type === "gather") {
    const target = gatherTarget(state, rally.targetId, faction);
    if (target && interactionReachable(state, labels, target))
      return { type: "gather", ...entityCenter(target), targetId: target.id };
  } else if (labels.has(labelAt(regions(state), rally.x, rally.y)))
    return { ...rally };
  const fallback = nearestInRegions(state, labels, rally);
  return fallback ? { type: "move", ...fallback, fallback: true } : null;
}

/** A completed recruit stays queued if no unoccupied, statically connected apron is available. */
export function productionSpawnPoint(state, building, unitType) {
  const info = regions(state),
    exits = exitRegions(state, building);
  if (!exits.size) return null;
  const preferred = {
    x: building.x + building.width / 2,
    y: building.y + building.height + 1,
  };
  const desired =
    building.rally &&
    resolveRally(state, building.rally, exits, building.faction);
  const targetLabels = new Set(exits);
  if (desired?.type === "move") {
    const label = labelAt(info, desired.x, desired.y);
    targetLabels.clear();
    if (label) targetLabels.add(label);
  } else if (desired?.type === "gather") {
    const target = gatherTarget(state, desired.targetId, building.faction);
    for (const label of targetLabels)
      if (!interactionReachable(state, new Set([label]), target))
        targetLabels.delete(label);
  }
  const spacing = unitType === "ram" ? 0.95 : 0.85;
  for (let r = 0; r < 8; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (r && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const point = {
          x: Math.floor(preferred.x) + dx + 0.5,
          y: Math.floor(preferred.y) + dy + 0.5,
        };
        if (
          !targetLabels.has(labelAt(info, point.x, point.y)) ||
          distanceTo(point, building) > 3
        )
          continue;
        if (
          state.units.some(
            (u) =>
              u.hp > 0 &&
              Math.hypot(u.x - point.x, u.y - point.y) <
                (u.type === "ram" ? 0.95 : spacing),
          )
        )
          continue;
        return point;
      }
  return null;
}

export function applyProductionRally(state, building, unit) {
  if (!building.rally) return;
  const labels = new Set([labelAt(regions(state), unit.x, unit.y)]);
  const rally = resolveRally(state, building.rally, labels, unit.faction);
  if (!rally) return;
  unit.order =
    rally.type === "gather"
      ? { type: "gather", targetId: rally.targetId }
      : { type: "move", x: rally.x, y: rally.y };
  if (rally.type === "gather")
    unit.gatherResource =
      gatherTarget(state, rally.targetId)?.type === "farm"
        ? "food"
        : gatherTarget(state, rally.targetId)?.type;
  unit.rallyAssignment = {
    buildingId: building.id,
    version: state.obstacleVersion,
    destination: { x: rally.x, y: rally.y },
    order: { ...unit.order },
  };
  clearPath(unit);
}

/** Only untouched rally-origin orders may be rerouted. Explicit player commands clear this marker. */
export function updateRallyOrders(state) {
  for (const building of state.buildings) {
    if (!building.rally || !isProductionBuilding(building)) continue;
    const targetInvalid =
      building.rally.type === "gather" &&
      !gatherTarget(state, building.rally.targetId, building.faction);
    if (building.rallyVersion === state.obstacleVersion && !targetInvalid)
      continue;
    building.rallyVersion = state.obstacleVersion;
    const resolved = resolveRally(
      state,
      building.rally,
      exitRegions(state, building),
      building.faction,
    );
    if (
      resolved &&
      (resolved.type !== building.rally.type ||
        resolved.x !== building.rally.x ||
        resolved.y !== building.rally.y)
    ) {
      building.rally = resolved;
      event(
        state,
        "rally",
        building.x,
        building.y,
        `${building.type === "townCenter" ? "Worker" : "Military"} rally rerouted to reachable ground.`,
      );
    }
  }
  for (const unit of state.units) {
    const assignment = unit.rallyAssignment;
    if (!assignment) continue;
    const order = unit.order,
      expected = assignment.order;
    if (
      order.type !== expected.type ||
      order.targetId !== expected.targetId ||
      order.x !== expected.x ||
      order.y !== expected.y
    ) {
      unit.rallyAssignment = null;
      continue;
    }
    const targetInvalid =
      order.type === "gather" &&
      !gatherTarget(state, order.targetId, unit.faction);
    if (assignment.version === state.obstacleVersion && !targetInvalid)
      continue;
    assignment.version = state.obstacleVersion;
    const labels = new Set([labelAt(regions(state), unit.x, unit.y)]);
    if (order.type === "gather") {
      const centers = state.buildings.filter(
        (b) =>
          b.type === "townCenter" &&
          b.faction === unit.faction &&
          b.hp > 0 &&
          b.progress === 1,
      );
      const canDeliver = centers.some((b) =>
        [...exitRegions(state, b)].some((label) => labels.has(label)),
      );
      if (!canDeliver) {
        const center = centers.sort(
          (a, b) => distanceTo(unit, a) - distanceTo(unit, b),
        )[0];
        const fallback = nearestInRegions(
          state,
          labels,
          center ? entityCenter(center) : unit,
        );
        unit.order = fallback
          ? { type: "move", ...fallback }
          : { type: "idle" };
        unit.delivering = false;
        unit.rallyAssignment = null;
        clearPath(unit);
        event(
          state,
          "rally",
          unit.x,
          unit.y,
          "Worker delivery route cut off. Supplies are held safely; reopen the route and assign gathering again.",
        );
        continue;
      }
    }
    const original =
      order.type === "gather"
        ? {
            type: "gather",
            x: assignment.destination?.x ?? unit.x,
            y: assignment.destination?.y ?? unit.y,
            targetId: order.targetId,
          }
        : order;
    const target = order.type === "gather" ? byId(state, order.targetId) : null;
    if (target) Object.assign(original, entityCenter(target));
    const resolved = resolveRally(state, original, labels, unit.faction);
    if (!resolved) {
      unit.order = { type: "idle" };
      unit.rallyAssignment = null;
      clearPath(unit);
      continue;
    }
    unit.order =
      resolved.type === "gather"
        ? { type: "gather", targetId: resolved.targetId }
        : { type: "move", x: resolved.x, y: resolved.y };
    assignment.order = { ...unit.order };
    clearPath(unit);
  }
}
