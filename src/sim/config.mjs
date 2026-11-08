import { BUILDINGS, UNITS, POPULATION_CAP } from "./rules.mjs";

export { POPULATION_CAP };
export const STEP = 0.05;
export const BUILDING_TYPES = Object.freeze({
  townCenter: {
    label: "Town Center",
    width: 3,
    height: 3,
    hp: 2600,
    cost: {},
    buildTime: 0,
    range: 5,
    damage: 14,
    period: 1.5,
  },
  farm: { ...BUILDINGS.farm, label: "Farm", buildTime: 22, food: 650 },
  barracks: {
    ...BUILDINGS.barracks,
    label: "Barracks",
    hp: 650,
    buildTime: 35,
  },
  tower: {
    ...BUILDINGS.tower,
    label: "Watchtower",
    hp: 700,
    buildTime: 30,
    range: 6,
    damage: 28,
    period: 1.4,
  },
});
export const UNIT_TYPES = Object.freeze({
  worker: {
    ...UNITS.worker,
    label: "Worker",
    speed: 2.35,
    trainTime: 14,
    capacity: 18,
    gatherRate: 1.8,
    sight: 5,
  },
  swordsman: {
    ...UNITS.swordsman,
    label: "Swordsman",
    speed: 2.25,
    trainTime: 28,
    sight: 6,
  },
  archer: {
    ...UNITS.archer,
    label: "Archer",
    speed: 2.35,
    trainTime: 32,
    sight: 7,
  },
  infantry: {
    label: "Ember infantry",
    hp: 110,
    damage: 18,
    range: 1,
    period: 1.1,
    speed: 1.9,
    sight: 6,
    cost: {},
    trainTime: 20,
  },
});
export const INITIAL_RESOURCES = Object.freeze({
  wood: 230,
  stone: 150,
  food: 240,
  gold: 100,
});
export const AI_CONFIG = Object.freeze({
  firstRaid: 180,
  raidInterval: 125,
  reinforcementInterval: 38,
  maximumArmy: 20,
});
