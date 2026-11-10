// Reproducible legal-command skirmish: no injected resources, HP, production, or units.
// This deliberately simple script measures whether the complete economy-to-assault loop works.
import {
  createGame,
  command,
  stepGame,
  population,
} from "../src/sim/world.mjs";
import assert from "node:assert/strict";

export function playSkirmish(seed = 5280, maximumSeconds = 1200) {
  const state = createGame(seed),
    milestones = [];
  let acceptedCommands = 0,
    rejectedCommands = 0;
  const issue = (action) => {
    const resources = { ...state.resources },
      units = state.units.length,
      buildings = state.buildings.length;
    const queues = state.buildings.reduce((sum, b) => sum + b.queue.length, 0);
    const result = command(state, action);
    if (result.ok) acceptedCommands++;
    else {
      rejectedCommands++;
      assert.deepEqual(
        state.resources,
        resources,
        "Rejected command cannot spend any resource.",
      );
      assert.equal(
        state.units.length,
        units,
        "Rejected command cannot create units.",
      );
      assert.equal(
        state.buildings.length,
        buildings,
        "Rejected command cannot create foundations.",
      );
      assert.equal(
        state.buildings.reduce((sum, b) => sum + b.queue.length, 0),
        queues,
        "Rejected command cannot reserve a recruit.",
      );
    }
    return result;
  };
  const player = () => state.units.filter((u) => u.faction === "player");
  const buildings = () => state.buildings.filter((b) => b.faction === "player");
  const gather = (u, resource) => {
    const sources = [
      ...state.nodes.filter((n) => n.type === resource && n.amount > 0),
      ...buildings().filter(
        (b) =>
          resource === "food" &&
          b.type === "farm" &&
          b.progress === 1 &&
          b.foodRemaining > 0,
      ),
    ];
    sources.sort(
      (a, b) =>
        Math.hypot(u.x - a.x, u.y - a.y) - Math.hypot(u.x - b.x, u.y - b.y),
    );
    if (sources[0])
      issue({
        type: "order",
        ids: [u.id],
        order: { type: "gather", targetId: sources[0].id },
      });
  };
  issue({
    type: "build",
    buildingType: "barracks",
    x: 12,
    y: 19,
    workerIds: [player()[0].id],
  });
  issue({
    type: "build",
    buildingType: "tower",
    x: 14,
    y: 21,
    workerIds: [player()[4].id],
  });
  let assault = false;
  for (
    let tick = 0;
    tick < maximumSeconds * 20 && state.status === "playing";
    tick++
  ) {
    if (tick % 20 === 0) {
      const workers = player().filter((u) => u.type === "worker"),
        tc = buildings().find((b) => b.type === "townCenter");
      for (let i = 0; i < workers.length; i++)
        if (workers[i].order.type === "idle")
          gather(
            workers[i],
            ["wood", "food", "food", "gold", "wood", "food", "wood", "gold"][
              i % 8
            ],
          );
      if (workers.length + tc.queue.length < 8 && tc.queue.length < 1)
        issue({ type: "recruit", unitType: "worker", buildingId: tc.id });
      if (
        state.time > 60 &&
        !buildings().some((b) => b.type === "barracks" && b.x === 16) &&
        state.resources.wood > 130
      )
        issue({
          type: "build",
          buildingType: "barracks",
          x: 16,
          y: 24,
          workerIds: [workers[0]?.id].filter(Boolean),
        });
      if (
        state.time > 120 &&
        buildings().filter((b) => b.type === "farm").length < 2 &&
        state.resources.wood > 80
      )
        issue({
          type: "build",
          buildingType: "farm",
          x: 13,
          y: 29,
          workerIds: [workers[0]?.id].filter(Boolean),
        });
      for (const b of buildings().filter(
        (b) => b.type === "barracks" && b.progress === 1 && b.queue.length < 2,
      )) {
        const sword = player().filter((u) => u.type === "swordsman").length,
          arch = player().filter((u) => u.type === "archer").length;
        issue({
          type: "recruit",
          unitType: sword > arch ? "archer" : "swordsman",
          buildingId: b.id,
        });
      }
      const army = player().filter((u) => u.type !== "worker");
      if (!assault && army.length >= 13) {
        assault = true;
        milestones.push({
          type: "assault",
          time: state.time,
          army: army.length,
        });
      }
      if (assault && army.length < 5) {
        assault = false;
        milestones.push({
          type: "regroup",
          time: state.time,
          army: army.length,
        });
        if (army.length)
          issue({
            type: "order",
            ids: army.map((u) => u.id),
            order: { type: "move", x: 15.5, y: 25.5 },
          });
      }
      if (assault && state.time % 10 === 0) {
        const target =
          state.buildings.find(
            (b) => b.faction === "enemy" && b.type === "tower" && b.x === 27,
          ) ||
          state.buildings.find(
            (b) => b.faction === "enemy" && b.type === "tower" && b.x === 30,
          ) ||
          state.buildings.find(
            (b) => b.faction === "enemy" && b.type === "townCenter",
          );
        if (target)
          issue({
            type: "order",
            ids: army.map((u) => u.id),
            order: { type: "attack", targetId: target.id },
          });
      }
      if (state.time % 60 === 0)
        milestones.push({
          type: "economy",
          time: state.time,
          resources: { ...state.resources },
          workers: workers.length,
          army: army.length,
        });
    }
    stepGame(state);
    assert.ok(
      Object.values(state.resources).every((v) => Number.isFinite(v) && v >= 0),
      "Inventory stays finite and nonnegative for the entire match.",
    );
    assert.ok(
      state.nodes.every(
        (n) =>
          Number.isFinite(n.amount) && n.amount >= 0 && n.amount <= n.maxAmount,
      ),
      "Deposits never regenerate or become negative.",
    );
  }
  return {
    seed,
    status: state.status,
    time: state.time,
    population: population(state),
    acceptedCommands,
    rejectedCommands,
    milestones,
    state,
  };
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/balance-check.mjs")) {
  for (const seed of [5280, 5281, 5282]) {
    const { state, ...result } = playSkirmish(seed);
    assert.equal(
      result.status,
      "victory",
      `Seed ${seed} must be winnable using ordinary commands.`,
    );
    assert.ok(
      result.time >= 600 && result.time <= 900,
      `Seed ${seed} scripted match pacing must stay within 10–15 minutes.`,
    );
    assert.ok(
      state.events.some(
        (e) =>
          e.type === "death" &&
          e.entityType === "townCenter" &&
          e.faction === "enemy",
      ),
      "Victory follows physical combat damage to the enemy Town Center.",
    );
    console.log(JSON.stringify(result));
  }
}
