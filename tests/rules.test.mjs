import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDINGS, UNITS, POPULATION_CAP, validResources, canAfford, spend,
  canRecruit, canPlace, applyDamage, seededRandom, fixedStepClock,
} from '../src/sim/rules.mjs';

const resources = Object.freeze({ wood: 190, stone: 115, food: 150, gold: 70 });

test('initial resources and definitions are valid', () => {
  assert.equal(validResources(resources), true);
  assert.equal(BUILDINGS.barracks.cost.wood, 70);
  assert.equal(UNITS.archer.range > UNITS.swordsman.range, true);
});
test('spending is atomic, immutable, and never creates debt', () => {
  const after = spend(resources, BUILDINGS.barracks.cost);
  assert.deepEqual(after, { wood: 120, stone: 75, food: 150, gold: 70 });
  assert.equal(resources.wood, 190);
  assert.equal(spend(after, { gold: 999 }), null);
  assert.equal(canAfford(resources, { wood: -5 }), false);
  assert.equal(canAfford(resources, { gems: 1 }), false);
});
test('population and barracks gates prevent illegal recruitment', () => {
  assert.equal(canRecruit({ resources, population: 5, hasBarracks: false }, 'swordsman'), false);
  assert.equal(canRecruit({ resources, population: 5, hasBarracks: true }, 'swordsman'), true);
  assert.equal(canRecruit({ resources, population: POPULATION_CAP, hasBarracks: true }, 'archer'), false);
  assert.equal(canRecruit({ resources, population: 5, hasBarracks: false }, 'worker'), true);
  assert.equal(canRecruit({ resources, population: -1, hasBarracks: true }, 'worker'), false);
  assert.equal(canRecruit({ resources, population: 1, hasBarracks: true }, 'dragon'), false);
});
test('placement checks every occupied tile and world bounds', () => {
  const args = { x: 3, y: 4, width: 2, height: 2, mapWidth: 26, mapHeight: 18, blocked: (x, y) => x === 4 && y === 5 };
  assert.equal(canPlace(args), false);
  assert.equal(canPlace({ ...args, blocked: () => false }), true);
  assert.equal(canPlace({ ...args, x: 25, blocked: () => false }), false);
  assert.equal(canPlace({ ...args, x: 3.5, blocked: () => false }), false);
});
test('combat damage clamps to zero and rejects invalid values', () => {
  assert.equal(applyDamage(125, 24), 101);
  assert.equal(applyDamage(10, 24), 0);
  assert.throws(() => applyDamage(10, -1), RangeError);
});
test('seeded random sequences replay identically', () => {
  const a = seededRandom(4663), b = seededRandom(4663), c = seededRandom(4664);
  const first = Array.from({ length: 16 }, () => a());
  assert.deepEqual(first, Array.from({ length: 16 }, () => b()));
  assert.notDeepEqual(first, Array.from({ length: 16 }, () => c()));
  assert.ok(first.every(n => n >= 0 && n < 1));
});
test('fixed-step updates do not depend on frame grouping', () => {
  let a = 0, b = 0;
  const clockA = fixedStepClock(), clockB = fixedStepClock();
  for (let i = 0; i < 60; i++) clockA.advance(1 / 60, dt => { a += dt; });
  for (let i = 0; i < 30; i++) clockB.advance(1 / 30, dt => { b += dt; });
  assert.equal(a, b);
  assert.ok(Math.abs(a - 1) < 1e-9);
});
test('fixed-step catchup is bounded', () => {
  const clock = fixedStepClock();
  let calls = 0;
  const result = clock.advance(10, () => calls++);
  assert.equal(calls, 5);
  assert.equal(result.steps, 5);
  assert.throws(() => clock.advance(-1, () => {}), RangeError);
});
