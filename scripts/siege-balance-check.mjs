// A legal continuation of the conventional opening: every supply, structure,
// recruit and casualty comes from ordinary commands and fixed simulation steps.
import assert from "node:assert/strict";
import { playSkirmish } from "./balance-check.mjs";
import { command, stepGame, population } from "../src/sim/world.mjs";

export function playSiegeSkirmish(
  seed = 5280,
  maximumSeconds = 1200,
  options = {},
) {
  const useSiege = options.useSiege !== false,
    commandExperience = options.commandExperience === true,
    troopLimit = useSiege ? 12 : 14;
  const opening = playSkirmish(seed, 190);
  const state = opening.state,
    milestones = [{ type: "legalOpening", time: state.time }];
  const metrics = {
    trainedRams: 0,
    lostRams: 0,
    ramStructureDamage: 0,
    ramTroopDamage: 0,
    ramStructureKills: 0,
    gathered: { wood: 0, stone: 0, food: 0, gold: 0 },
    spent: { wood: 0, stone: 0, food: 0, gold: 0 },
    acceptedCommands: 0,
    rejectedCommands: 0,
    workshopCompletedAt: null,
  };
  if (commandExperience)
    Object.assign(metrics, {
      coordinatedOrders: 0,
      retreatCount: 0,
      retreatDistance: 0,
      retreatDamage: 0,
      assaultDamageTaken: 0,
      crossingRegroups: 0,
      stagingObserved: false,
    });
  let eventId = state.nextEventId - 1,
    assault = false,
    staged = false,
    retreatUntil = 0,
    retreatIssued = false,
    nextFormationCommandAt = 0;
  const player = () =>
    state.units.filter((u) => u.faction === "player" && u.hp > 0);
  const buildings = () =>
    state.buildings.filter((b) => b.faction === "player" && b.hp > 0);
  const issue = (action) => {
    const before = { ...state.resources },
      beforeQueues = state.buildings.reduce((n, b) => n + b.queue.length, 0),
      beforeUnits = state.units.length,
      beforeBuildings = state.buildings.length;
    const result = command(state, action);
    if (result.ok) {
      metrics.acceptedCommands++;
      for (const key of Object.keys(before))
        metrics.spent[key] += Math.max(0, before[key] - state.resources[key]);
    } else {
      metrics.rejectedCommands++;
      assert.deepEqual(
        state.resources,
        before,
        "failed siege commands cannot spend supplies",
      );
      assert.equal(
        state.buildings.reduce((n, b) => n + b.queue.length, 0),
        beforeQueues,
      );
      assert.equal(state.units.length, beforeUnits);
      assert.equal(state.buildings.length, beforeBuildings);
    }
    return result;
  };
  const gather = (unit, type) => {
    const sources = [
      ...state.nodes.filter((n) => n.type === type && n.amount > 0),
      ...buildings().filter(
        (b) =>
          type === "food" &&
          b.type === "farm" &&
          b.progress === 1 &&
          b.foodRemaining > 0,
      ),
    ];
    sources.sort(
      (a, b) =>
        Math.hypot(a.x - unit.x, a.y - unit.y) -
        Math.hypot(b.x - unit.x, b.y - unit.y),
    );
    if (sources[0])
      issue({
        type: "order",
        ids: [unit.id],
        order: { type: "gather", targetId: sources[0].id },
      });
  };
  const workers = player().filter((u) => u.type === "worker");
  if (useSiege) for (const unit of workers.slice(2, 4)) gather(unit, "stone");
  const assembly = { x: 18.5, y: 25.5 };
  for (const b of buildings().filter((b) => b.type === "barracks"))
    issue({ type: "setRally", buildingId: b.id, ...assembly });
  const tc = buildings().find((b) => b.type === "townCenter"),
    food = buildings().find((b) => b.type === "farm");
  issue({
    type: "setRally",
    buildingId: tc.id,
    x: food.x + 1,
    y: food.y + 1,
    targetId: food.id,
  });

  for (
    let tick = 0;
    state.time < maximumSeconds && state.status === "playing";
    tick++
  ) {
    if (tick % 20 === 0) {
      const workers = player().filter((u) => u.type === "worker"),
        tc = buildings().find((b) => b.type === "townCenter");
      if (!tc) break;
      for (let i = 0; i < workers.length; i++)
        if (workers[i].order.type === "idle")
          gather(
            workers[i],
            ["wood", "food", "stone", "gold", "wood", "food", "wood", "food"][
              i % 8
            ],
          );
      if (workers.length + tc.queue.length < 8 && tc.queue.length < 1)
        issue({ type: "recruit", unitType: "worker", buildingId: tc.id });
      let workshop = buildings().find((b) => b.type === "workshop");
      if (useSiege && !workshop && state.resources.stone >= 70) {
        const result = issue({
          type: "build",
          buildingType: "workshop",
          x: 10,
          y: 16,
          workerIds: workers.slice(0, 2).map((u) => u.id),
        });
        if (result.ok)
          milestones.push({ type: "workshopFoundation", time: state.time });
        workshop = buildings().find((b) => b.type === "workshop");
      }
      const troops = player().filter(
          (u) => u.type !== "worker" && u.type !== "ram",
        ),
        rams = player().filter((u) => u.type === "ram");
      if (workshop?.progress === 1) {
        if (metrics.workshopCompletedAt === null) {
          metrics.workshopCompletedAt = state.time;
          milestones.push({ type: "workshopComplete", time: state.time });
          issue({ type: "setRally", buildingId: workshop.id, ...assembly });
        }
        if (rams.length + workshop.queue.length < 2)
          issue({ type: "recruit", unitType: "ram", buildingId: workshop.id });
      }
      const troopQueues = buildings()
        .filter((b) => b.type === "barracks")
        .reduce((n, b) => n + b.queue.length, 0);
      if (troops.length + troopQueues < troopLimit)
        for (const barracks of buildings().filter(
          (b) =>
            b.type === "barracks" && b.progress === 1 && b.queue.length < 1,
        )) {
          const total =
            player().filter((u) => u.type !== "worker" && u.type !== "ram")
              .length +
            buildings()
              .filter((b) => b.type === "barracks")
              .reduce((n, b) => n + b.queue.length, 0);
          if (total >= troopLimit) break;
          const swords = troops.filter((u) => u.type === "swordsman").length,
            archers = troops.filter((u) => u.type === "archer").length;
          issue({
            type: "recruit",
            unitType: swords > archers ? "archer" : "swordsman",
            buildingId: barracks.id,
          });
        }
      if (
        (workshop?.progress === 1 || !useSiege) &&
        !staged &&
        state.time >= retreatUntil &&
        troops.length >= 10
      ) {
        staged = true;
        issue({
          type: "order",
          ids: troops.map((u) => u.id),
          order: { type: "move", ...assembly },
        });
      }
      if (
        !assault &&
        troops.length >= (useSiege ? 10 : 12) &&
        (!useSiege || rams.length >= 1) &&
        state.time >= retreatUntil &&
        state.time > 340
      ) {
        assault = true;
        milestones.push({
          type: "siegeAssault",
          time: state.time,
          troops: troops.length,
          rams: rams.length,
        });
      }
      const withdrawUnderFire =
        commandExperience &&
        !retreatIssued &&
        state.time >= 365 &&
        metrics.assaultDamageTaken > 0;
      if (assault && (troops.length < 4 || withdrawUnderFire)) {
        assault = false;
        staged = false;
        milestones.push({
          type: "regroup",
          time: state.time,
          troops: troops.length,
          rams: rams.length,
        });
        const survivors = [...troops, ...rams];
        if (survivors.length) {
          const result = issue({
            type: "order",
            ids: survivors.map((u) => u.id),
            order: {
              type: commandExperience ? "retreat" : "move",
              x: 15.5,
              y: 25.5,
            },
          });
          if (commandExperience && result.ok) {
            metrics.retreatCount++;
            retreatIssued = true;
            retreatUntil = state.time + 32;
          }
        }
      }
      if (assault && tick % 100 === 0) {
        const target =
          state.buildings.find(
            (b) => b.faction === "enemy" && b.type === "tower" && b.x === 27,
          ) ||
          state.buildings.find(
            (b) => b.faction === "enemy" && b.type === "barracks" && b.x === 28,
          ) ||
          state.buildings.find(
            (b) => b.faction === "enemy" && b.type === "tower" && b.x === 30,
          ) ||
          state.buildings.find(
            (b) => b.faction === "enemy" && b.type === "townCenter",
          );
        if (target) {
          if (commandExperience) {
            const military = [...troops, ...rams];
            const active = state.assaults.find(
              (cohort) => cohort.targetId === target.id,
            );
            const freshTroops = military.some(
              (unit) => unit.order.squadId !== active?.id,
            );
            if (
              !active ||
              (freshTroops && state.time >= nextFormationCommandAt)
            ) {
              const result = issue({
                type: "order",
                ids: military.map((unit) => unit.id),
                order: { type: "assault", targetId: target.id },
              });
              if (result.ok) {
                metrics.coordinatedOrders++;
                nextFormationCommandAt = state.time + 30;
              }
            }
          } else {
            if (troops.length)
              issue({
                type: "order",
                ids: troops.map((u) => u.id),
                order: {
                  type: "attackMove",
                  x: target.x - 1.5,
                  y: target.y + 1.5,
                },
              });
            if (rams.length)
              issue({
                type: "order",
                ids: rams.map((u) => u.id),
                order: { type: "attack", targetId: target.id },
              });
          }
        }
      }
    }
    const retreating = commandExperience
      ? new Map(
          player()
            .filter((unit) => unit.order.type === "retreat")
            .map((unit) => [unit.id, { unit, x: unit.x, y: unit.y }]),
        )
      : null;
    const assaulting = commandExperience
      ? new Set(
          player()
            .filter((unit) => unit.order.type === "assault")
            .map((unit) => unit.id),
        )
      : null;
    stepGame(state);
    if (commandExperience) {
      for (const { unit, x, y } of retreating.values())
        metrics.retreatDistance += Math.hypot(unit.x - x, unit.y - y);
      metrics.stagingObserved ||= state.assaults.some(
        (cohort) => cohort.phase === "staging",
      );
    }
    for (const e of state.events)
      if (e.id > eventId) {
        if (e.type === "delivery") metrics.gathered[e.resource] += e.amount;
        if (e.type === "trained" && e.unitType === "ram") metrics.trainedRams++;
        if (
          e.type === "death" &&
          e.entityType === "ram" &&
          e.faction === "player"
        )
          metrics.lostRams++;
        if (e.type === "attack" && e.siege && e.faction === "player") {
          if (e.structureHit)
            metrics.ramStructureDamage += e.actualDamage ?? e.damage;
          else metrics.ramTroopDamage += e.actualDamage ?? e.damage;
        }
        if (e.type === "siege" && e.faction === "player")
          metrics.ramStructureKills++;
        if (commandExperience && e.type === "regroup")
          metrics.crossingRegroups++;
        if (commandExperience && e.type === "attack" && e.faction === "enemy") {
          if (retreating.has(e.targetId))
            metrics.retreatDamage += e.actualDamage ?? e.damage;
          if (assaulting.has(e.targetId))
            metrics.assaultDamageTaken += e.actualDamage ?? e.damage;
        }
      }
    eventId = state.nextEventId - 1;
    assert.ok(
      Object.values(state.resources).every((n) => Number.isFinite(n) && n >= 0),
    );
    assert.ok(
      state.nodes.every(
        (n) =>
          Number.isFinite(n.amount) && n.amount >= 0 && n.amount <= n.maxAmount,
      ),
    );
    assert.ok(population(state) <= 24);
  }
  return {
    seed,
    strategy: commandExperience
      ? "coordinated-assault-and-retreat"
      : useSiege
        ? "siege"
        : "conventional-control",
    status: state.status,
    time: state.time,
    metrics,
    milestones,
    state,
  };
}

if (
  process.argv[1]?.replaceAll("\\", "/").endsWith("/siege-balance-check.mjs")
) {
  for (const seed of [5280, 5281, 5282]) {
    const { state, ...result } = playSiegeSkirmish(seed);
    console.log(JSON.stringify(result));
    assert.equal(
      result.status,
      "victory",
      `legal siege scenario seed${seed} must win`,
    );
    assert.ok(
      result.metrics.trainedRams > 0 &&
        result.metrics.ramStructureDamage > 0 &&
        result.metrics.ramStructureKills > 0,
      "siege must be physically produced and damage fortifications",
    );
    assert.ok(
      result.metrics.gathered.stone >= 50 && result.metrics.spent.stone >= 70,
      "workshop supplies must be physically gathered and spent",
    );
  }
  const { state, ...control } = playSiegeSkirmish(5280, 1200, {
    useSiege: false,
  });
  console.log(JSON.stringify(control));
  assert.equal(
    control.status,
    "victory",
    "equal-population conventional control remains viable without a workshop",
  );
}
