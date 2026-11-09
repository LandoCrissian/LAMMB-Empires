import { distanceTo, entityCenter } from "./geometry.mjs";

const diagnostics = {
  enabled: false,
  pathCalls: 0,
  expandedNodes: 0,
  totalPathMs: 0,
  maxPathMs: 0,
  separationCalls: 0,
  totalSeparationMs: 0,
  maxSeparationMs: 0,
};
export function enableMovementDiagnostics(enabled = true) {
  diagnostics.enabled = enabled;
}
export function resetMovementDiagnostics() {
  Object.assign(diagnostics, {
    pathCalls: 0,
    expandedNodes: 0,
    totalPathMs: 0,
    maxPathMs: 0,
    separationCalls: 0,
    totalSeparationMs: 0,
    maxSeparationMs: 0,
  });
}
export function getMovementDiagnostics() {
  return { ...diagnostics };
}
function recordPathTime(start) {
  if (!diagnostics.enabled) return;
  const elapsed = performance.now() - start;
  diagnostics.totalPathMs += elapsed;
  diagnostics.maxPathMs = Math.max(diagnostics.maxPathMs, elapsed);
}

export function blocked(state, x, y, ignoreId = null) {
  if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height)
    return true;
  if (["water", "ridge"].includes(state.map.terrain[y][x])) return true;
  if (
    state.buildings.some(
      (b) =>
        b.hp > 0 &&
        b.id !== ignoreId &&
        x >= b.x &&
        x < b.x + b.width &&
        y >= b.y &&
        y < b.y + b.height,
    )
  )
    return true;
  return state.nodes.some(
    (n) => n.amount > 0 && Math.floor(n.x) === x && Math.floor(n.y) === y,
  );
}

// Deterministic eight-neighbour A*: static terrain/deposits/building footprints block movement.
// A target structure can be approached from any open tile within the interaction range.
function pathTo(state, unit, target, range) {
  const diagnosticStart = diagnostics.enabled ? performance.now() : 0;
  if (diagnostics.enabled) diagnostics.pathCalls++;
  const width = state.map.width,
    height = state.map.height;
  const sx = Math.floor(unit.x),
    sy = Math.floor(unit.y),
    start = sy * width + sx;
  const goal = entityCenter(target);
  const cost = new Float64Array(width * height);
  cost.fill(Infinity);
  cost[start] = 0;
  const prev = new Int32Array(width * height);
  prev.fill(-1);
  const closed = new Uint8Array(width * height),
    open = [start];
  const heuristic = (i) =>
    Math.max(
      0,
      Math.hypot(
        (i % width) + 0.5 - goal.x,
        Math.floor(i / width) + 0.5 - goal.y,
      ) - range,
    );
  let end = -1;
  while (open.length) {
    let best = 0;
    for (let j = 1; j < open.length; j++)
      if (
        cost[open[j]] + heuristic(open[j]) <
        cost[open[best]] + heuristic(open[best])
      )
        best = j;
    const i = open.splice(best, 1)[0];
    if (closed[i]) continue;
    closed[i] = 1;
    if (diagnostics.enabled) diagnostics.expandedNodes++;
    const x = i % width,
      y = Math.floor(i / width);
    if (
      distanceTo({ x: x + 0.5, y: y + 0.5 }, target) <= range + 0.001 &&
      !blocked(state, x, y)
    ) {
      end = i;
      break;
    }
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy;
      if (
        nx < 0 ||
        ny < 0 ||
        nx >= width ||
        ny >= height ||
        blocked(state, nx, ny)
      )
        continue;
      if (dx && dy && (blocked(state, x + dx, y) || blocked(state, x, y + dy)))
        continue;
      const ni = ny * width + nx,
        next = cost[i] + (dx && dy ? 1.41421356237 : 1);
      if (!closed[ni] && next < cost[ni]) {
        cost[ni] = next;
        prev[ni] = i;
        open.push(ni);
      }
    }
  }
  if (end < 0) {
    recordPathTime(diagnosticStart);
    return [];
  }
  if (end === start) {
    recordPathTime(diagnosticStart);
    return [{ x: sx + 0.5, y: sy + 0.5 }];
  }
  const path = [];
  while (end !== start && end >= 0) {
    path.push({ x: (end % width) + 0.5, y: Math.floor(end / width) + 0.5 });
    end = prev[end];
  }
  recordPathTime(diagnosticStart);
  return path.reverse();
}

export function clearPath(unit) {
  unit.path = [];
  unit.pathKey = "";
  unit.pathAge = 0;
}
export function reachable(state, unit, target, range = 0.8) {
  return (
    distanceTo(unit, target) <= range ||
    pathTo(state, unit, target, range).length > 0
  );
}
// A cohort may share a strategic route, while every actual soldier still moves
// through moveToward and the same terrain/corner rules.
export function plannedRoute(state, unit, target, range = 0.2) {
  return pathTo(state, unit, target, range);
}
export function moveToward(state, unit, target, range, dt, speed) {
  if (distanceTo(unit, target) <= range + 0.005) {
    clearPath(unit);
    return true;
  }
  const c = entityCenter(target),
    key = `${Math.floor(c.x)},${Math.floor(c.y)},${range},${state.obstacleVersion}`;
  unit.pathAge = (unit.pathAge || 0) + dt;
  if (unit.pathKey !== key || unit.pathAge >= 1.2) {
    unit.path = pathTo(state, unit, target, range);
    unit.pathKey = key;
    unit.pathAge = 0;
  }
  let remaining = speed * dt;
  while (remaining > 0 && unit.path.length) {
    const point = unit.path[0];
    if (blocked(state, Math.floor(point.x), Math.floor(point.y))) {
      clearPath(unit);
      break;
    }
    const dx = point.x - unit.x,
      dy = point.y - unit.y,
      length = Math.hypot(dx, dy);
    if (length < remaining + 0.001) {
      unit.x = point.x;
      unit.y = point.y;
      unit.path.shift();
      remaining -= length;
    } else {
      unit.x += (dx / length) * remaining;
      unit.y += (dy / length) * remaining;
      remaining = 0;
    }
  }
  return distanceTo(unit, target) <= range + 0.005;
}

export function nearestOpen(state, x, y) {
  for (let r = 0; r < Math.max(state.map.width, state.map.height); r++) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (r && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const px = Math.floor(x) + dx,
          py = Math.floor(y) + dy;
        if (!blocked(state, px, py)) return { x: px + 0.5, y: py + 0.5 };
      }
  }
  return null;
}

export function spawnPoint(state, x, y) {
  for (let r = 0; r < 8; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (r && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const px = Math.floor(x) + dx,
          py = Math.floor(y) + dy;
        if (
          !blocked(state, px, py) &&
          !state.units.some(
            (u) =>
              u.hp > 0 && Math.hypot(u.x - px - 0.5, u.y - py - 0.5) < 0.85,
          )
        )
          return { x: px + 0.5, y: py + 0.5 };
      }
  return nearestOpen(state, x, y);
}

// A short correction is sampled so local separation cannot cross a ridge corner,
// a bank, a resource tile, or a building while trying to avoid another unit.
function canDisplace(state, unit, dx, dy) {
  const samples = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.06));
  for (let i = 1; i <= samples; i++) {
    const x = unit.x + (dx * i) / samples,
      y = unit.y + (dy * i) / samples;
    if (blocked(state, Math.floor(x), Math.floor(y))) return false;
    const px = Math.floor(unit.x),
      py = Math.floor(unit.y),
      nx = Math.floor(x),
      ny = Math.floor(y);
    if (
      px !== nx &&
      py !== ny &&
      (blocked(state, px, ny) || blocked(state, nx, py))
    )
      return false;
  }
  return true;
}

/** Soft, deterministic local collision resolution; it never replaces an order.
 * Two bounded passes provide spacing while allowing busy crossings to yield
 * instead of turning every moving unit into a permanent pathfinding obstacle.
 */
export function separateUnits(state, dt) {
  const diagnosticStart = diagnostics.enabled ? performance.now() : 0;
  if (diagnostics.enabled) diagnostics.separationCalls++;
  const units = state.units.filter((u) => u.hp > 0);
  const cap = Math.min(0.12, dt * 2.2);
  for (let pass = 0; pass < 2; pass++) {
    const offsets = units.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < units.length; i++)
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i],
          b = units[j];
        const desired =
          a.type === "ram" || b.type === "ram"
            ? (a.type === "ram" ? 0.44 : 0.33) +
              (b.type === "ram" ? 0.44 : 0.33)
            : a.type === "worker" && b.type === "worker"
              ? 0.48
              : 0.66;
        let dx = b.x - a.x,
          dy = b.y - a.y,
          length = Math.hypot(dx, dy);
        if (length >= desired - 0.008) continue;
        if (length < 0.00001) {
          // Entity IDs are stable across replay; exact coincidences need a stable
          // escape direction rather than random noise or alternating frame parity.
          const hash = [...`${a.id}:${b.id}`].reduce(
            (n, c) => (n * 31 + c.charCodeAt(0)) >>> 0,
            0,
          );
          const angle = (hash % 6283) / 1000;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          length = 1;
        } else {
          dx /= length;
          dy /= length;
        }
        const overlap = desired - Math.hypot(b.x - a.x, b.y - a.y);
        const aWeight = a.order.type === "hold" ? 0 : 1;
        const bWeight = b.order.type === "hold" ? 0 : 1;
        const total = aWeight + bWeight;
        if (!total) continue;
        offsets[i].x -= ((dx * overlap * aWeight) / total) * 0.6;
        offsets[i].y -= ((dy * overlap * aWeight) / total) * 0.6;
        offsets[j].x += ((dx * overlap * bWeight) / total) * 0.6;
        offsets[j].y += ((dy * overlap * bWeight) / total) * 0.6;
      }
    for (let i = 0; i < units.length; i++) {
      const unit = units[i],
        offset = offsets[i],
        length = Math.hypot(offset.x, offset.y);
      if (length < 0.0001) continue;
      const scale = Math.min(1, cap / length),
        dx = offset.x * scale,
        dy = offset.y * scale;
      if (canDisplace(state, unit, dx, dy)) {
        unit.x += dx;
        unit.y += dy;
      } else if (Math.abs(dx) > 0.0001 && canDisplace(state, unit, dx, 0))
        unit.x += dx;
      else if (Math.abs(dy) > 0.0001 && canDisplace(state, unit, 0, dy))
        unit.y += dy;
      else {
        // Slide along the obstacle rather than pushing forever into its face.
        // Stable handedness prevents a bank-side pair alternating left/right.
        const sign =
          [...unit.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 2 ? 1 : -1;
        if (canDisplace(state, unit, -dy * sign, dx * sign)) {
          unit.x -= dy * sign;
          unit.y += dx * sign;
        }
      }
    }
  }
  if (diagnostics.enabled) {
    const elapsed = performance.now() - diagnosticStart;
    diagnostics.totalSeparationMs += elapsed;
    diagnostics.maxSeparationMs = Math.max(
      diagnostics.maxSeparationMs,
      elapsed,
    );
  }
}
