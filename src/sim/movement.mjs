import { distanceTo, entityCenter } from "./geometry.mjs";

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
  if (end < 0) return [];
  if (end === start) return [{ x: sx + 0.5, y: sy + 0.5 }];
  const path = [];
  while (end !== start && end >= 0) {
    path.push({ x: (end % width) + 0.5, y: Math.floor(end / width) + 0.5 });
    end = prev[end];
  }
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
