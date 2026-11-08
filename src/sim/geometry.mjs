export function entityCenter(e) {
  return e.width
    ? { x: e.x + e.width / 2, y: e.y + e.height / 2 }
    : { x: e.x, y: e.y };
}
export function distance(a, b) {
  const p = entityCenter(a),
    q = entityCenter(b);
  return Math.hypot(p.x - q.x, p.y - q.y);
}
export function distanceTo(a, b) {
  if (!b.width) return distance(a, b);
  return Math.hypot(
    Math.max(b.x - a.x, 0, a.x - b.x - b.width),
    Math.max(b.y - a.y, 0, a.y - b.y - b.height),
  );
}
export function byId(state, id) {
  return (
    state.units.find((e) => e.id === id && e.hp > 0) ||
    state.buildings.find((e) => e.id === id && e.hp > 0) ||
    state.nodes.find((e) => e.id === id && e.amount > 0)
  );
}
export function event(state, type, x, y, text, extra = {}) {
  const e = { id: state.nextEventId++, time: state.time, type, x, y, ...extra };
  if (text) e.text = text;
  state.events.push(e);
  if (state.events.length > 64)
    state.events.splice(0, state.events.length - 64);
}
