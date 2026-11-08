/**
 * LAMMB Empires — deterministic, dependency-free gameplay rules.
 * This module deliberately has no DOM, canvas, network or wallet dependencies.
 * All costs and combat outcomes are validated on the simulation side.
 */
export const POPULATION_CAP = 24;
export const BUILDINGS = Object.freeze({
  farm: Object.freeze({
    width: 2,
    height: 2,
    hp: 180,
    cost: Object.freeze({ wood: 40 }),
  }),
  barracks: Object.freeze({
    width: 2,
    height: 2,
    hp: 300,
    cost: Object.freeze({ wood: 70, stone: 40 }),
  }),
  tower: Object.freeze({
    width: 1,
    height: 1,
    hp: 210,
    cost: Object.freeze({ wood: 60, stone: 50 }),
  }),
});
export const UNITS = Object.freeze({
  worker: Object.freeze({
    hp: 65,
    damage: 4,
    range: 0.85,
    period: 1.1,
    cost: Object.freeze({ food: 35 }),
  }),
  swordsman: Object.freeze({
    hp: 125,
    damage: 24,
    range: 1,
    period: 0.95,
    cost: Object.freeze({ food: 50, gold: 20 }),
  }),
  archer: Object.freeze({
    hp: 85,
    damage: 18,
    range: 4.3,
    period: 1.35,
    cost: Object.freeze({ food: 35, wood: 30 }),
  }),
});
const RESOURCE_KEYS = ["wood", "stone", "food", "gold"];
export function validResources(resources) {
  return (
    !!resources &&
    RESOURCE_KEYS.every(
      (key) => Number.isFinite(resources[key]) && resources[key] >= 0,
    )
  );
}
export function canAfford(resources, cost) {
  return (
    validResources(resources) &&
    !!cost &&
    typeof cost === "object" &&
    !Array.isArray(cost) &&
    Object.entries(cost).every(
      ([key, amount]) =>
        RESOURCE_KEYS.includes(key) &&
        Number.isFinite(amount) &&
        amount >= 0 &&
        resources[key] >= amount,
    )
  );
}
export function spend(resources, cost) {
  if (!canAfford(resources, cost)) return null;
  return Object.fromEntries(
    RESOURCE_KEYS.map((key) => [key, resources[key] - (cost[key] ?? 0)]),
  );
}
export function canRecruit({ resources, population, hasBarracks }, unitType) {
  const unit = Object.hasOwn(UNITS, unitType) ? UNITS[unitType] : null;
  return (
    !!unit &&
    Number.isInteger(population) &&
    population >= 0 &&
    population < POPULATION_CAP &&
    (unitType === "worker" || hasBarracks === true) &&
    canAfford(resources, unit.cost)
  );
}
export function canPlace({
  x,
  y,
  width,
  height,
  mapWidth,
  mapHeight,
  blocked,
}) {
  if (![x, y, width, height, mapWidth, mapHeight].every(Number.isInteger))
    return false;
  if (
    width <= 0 ||
    height <= 0 ||
    x < 0 ||
    y < 0 ||
    x + width > mapWidth ||
    y + height > mapHeight
  )
    return false;
  if (typeof blocked !== "function") return false;
  for (let ix = x; ix < x + width; ix++)
    for (let iy = y; iy < y + height; iy++) {
      if (blocked(ix, iy)) return false;
    }
  return true;
}
export function applyDamage(hp, amount) {
  if (!Number.isFinite(hp) || !Number.isFinite(amount) || hp < 0 || amount < 0)
    throw new RangeError("Invalid combat values");
  return Math.max(0, hp - amount);
}
export function seededRandom(seed) {
  if (!Number.isInteger(seed)) throw new TypeError("Seed must be an integer");
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
export function fixedStepClock({ step = 1 / 30, maxSteps = 5 } = {}) {
  if (
    !Number.isFinite(step) ||
    step <= 0 ||
    !Number.isInteger(maxSteps) ||
    maxSteps < 1
  )
    throw new RangeError("Invalid clock configuration");
  let accumulator = 0;
  return {
    advance(frameSeconds, update) {
      if (!Number.isFinite(frameSeconds) || frameSeconds < 0)
        throw new RangeError("Invalid frame duration");
      if (typeof update !== "function")
        throw new TypeError("Update must be a function");
      accumulator += Math.min(frameSeconds, step * maxSteps);
      let steps = 0;
      while (accumulator + 1e-10 >= step && steps < maxSteps) {
        update(step);
        accumulator -= step;
        steps++;
      }
      return { steps, alpha: Math.max(0, Math.min(1, accumulator / step)) };
    },
    reset() {
      accumulator = 0;
    },
  };
}
