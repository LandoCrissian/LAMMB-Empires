import { UNIT_TYPES } from "./config.mjs";
import { blocked } from "./movement.mjs";

const stableId = (a, b) => a.id.localeCompare(b.id, "en", { numeric: true });
const connectivityCache = new WeakMap();
const neighbors = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

// Label static walkable regions once per obstacle version. Trying A* on every
// candidate rank is expensive when a bridge is closed; region membership gives
// exactly the same eight-neighbor reachability answer with bounded grid work.
function connectivity(state) {
  const previous = connectivityCache.get(state);
  const { width, height } = state.map;
  if (
    previous?.map === state.map &&
    previous.version === state.obstacleVersion &&
    previous.width === width &&
    previous.height === height
  )
    return previous;
  const open = new Uint8Array(width * height);
  const components = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      open[y * width + x] = blocked(state, x, y) ? 0 : 1;
  let label = 0;
  for (let start = 0; start < open.length; start++) {
    if (!open[start] || components[start]) continue;
    label++;
    let head = 0,
      tail = 1;
    queue[0] = start;
    components[start] = label;
    while (head < tail) {
      const index = queue[head++],
        x = index % width,
        y = Math.floor(index / width);
      for (const [dx, dy] of neighbors) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (!open[next] || components[next]) continue;
        if (dx && dy && (!open[y * width + nx] || !open[ny * width + x]))
          continue;
        components[next] = label;
        queue[tail++] = next;
      }
    }
  }
  const result = {
    map: state.map,
    version: state.obstacleVersion,
    width,
    height,
    components,
  };
  connectivityCache.set(state, result);
  return result;
}

export function sameMovementRegion(state, a, b) {
  const regions = connectivity(state);
  const label = (point) => {
    const x = Math.floor(point.x),
      y = Math.floor(point.y);
    return x >= 0 && y >= 0 && x < regions.width && y < regions.height
      ? regions.components[y * regions.width + x]
      : 0;
  };
  const first = label(a);
  return first > 0 && first === label(b);
}

/**
 * Loose ranks aligned with the group's direction of travel. Every destination is
 * an independently reachable tile, reserved once, rather than a shared rally dot.
 * Orders remain ordinary move/attackMove orders, so ranks can compress through
 * a crossing and naturally reopen at their destinations.
 */
export function formationDestinations(
  state,
  units,
  destination,
  facing = null,
  roleRanks = false,
) {
  const members = units.filter((u) => u.hp > 0).slice();
  if (!members.length) return [];
  const center = members.reduce(
    (sum, u) => ({
      x: sum.x + u.x / members.length,
      y: sum.y + u.y / members.length,
    }),
    { x: 0, y: 0 },
  );
  const direction = facing || {
    x: destination.x - center.x,
    y: destination.y - center.y,
  };
  const length = Math.hypot(direction.x, direction.y);
  const forward =
    length > 0.01
      ? {
          x: direction.x / length,
          y: direction.y / length,
        }
      : { x: 0, y: -1 };
  const side = { x: -forward.y, y: forward.x };
  const ordered = members.sort(
    (a, b) =>
      (a.type === "ram" ? 1 : UNIT_TYPES[a.type]?.range > 2 ? 2 : 0) -
        (b.type === "ram" ? 1 : UNIT_TYPES[b.type]?.range > 2 ? 2 : 0) ||
      stableId(a, b),
  );
  const columns = Math.min(5, Math.ceil(Math.sqrt(members.length)));
  const role = (unit) =>
    unit.type === "ram" ? 1 : UNIT_TYPES[unit.type]?.range > 2 ? 2 : 0;
  const groups = [0, 1, 2].map((rank) =>
    ordered.filter((unit) => role(unit) === rank),
  );
  const rows = roleRanks
    ? groups.reduce(
        (count, group) => count + Math.ceil(group.length / columns),
        0,
      )
    : Math.ceil(members.length / columns);
  const reserved = new Set();
  const results = [];
  const regions = connectivity(state);
  for (let index = 0; index < ordered.length; index++) {
    const unit = ordered[index];
    const group = groups[role(unit)];
    const localIndex = roleRanks ? group.indexOf(unit) : index;
    const row =
      (roleRanks
        ? groups
            .slice(0, role(unit))
            .reduce(
              (count, prior) => count + Math.ceil(prior.length / columns),
              0,
            )
        : 0) + Math.floor(localIndex / columns);
    const component =
      regions.components[
        Math.floor(unit.y) * state.map.width + Math.floor(unit.x)
      ];
    if (!component) continue;
    const rowLength = roleRanks
      ? Math.min(
          columns,
          group.length - Math.floor(localIndex / columns) * columns,
        )
      : Math.min(columns, ordered.length - row * columns);
    const across = (localIndex % columns) - (rowLength - 1) / 2;
    const depth = (rows - 1) / 2 - row;
    const ideal = {
      x: destination.x + side.x * across * 1.05 + forward.x * depth * 1.05,
      y: destination.y + side.y * across * 1.05 + forward.y * depth * 1.05,
    };
    let chosen;
    // Search close to the intended rank before spreading farther around obstacles.
    for (
      let radius = 0;
      radius < Math.max(state.map.width, state.map.height) && !chosen;
      radius++
    ) {
      const candidates = [];
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          if (radius && Math.max(Math.abs(dx), Math.abs(dy)) !== radius)
            continue;
          const x = Math.floor(ideal.x) + dx,
            y = Math.floor(ideal.y) + dy;
          if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height)
            continue;
          const key = y * state.map.width + x;
          if (reserved.has(key) || regions.components[key] !== component)
            continue;
          candidates.push({ x: x + 0.5, y: y + 0.5, key });
        }
      candidates.sort(
        (a, b) =>
          Math.hypot(a.x - ideal.x, a.y - ideal.y) -
            Math.hypot(b.x - ideal.x, b.y - ideal.y) || a.key - b.key,
      );
      chosen = candidates[0];
    }
    if (chosen) {
      reserved.add(chosen.key);
      results.push({ id: unit.id, x: chosen.x, y: chosen.y });
    }
  }
  return results;
}
