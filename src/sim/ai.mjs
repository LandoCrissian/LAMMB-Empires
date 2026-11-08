import { AI_CONFIG } from "./config.mjs";
import { makeUnit } from "./economy.mjs";
import { nearestOpen, spawnPoint, clearPath } from "./movement.mjs";
import { event, entityCenter } from "./geometry.mjs";

export function updateAI(state) {
  const ai = state.ai;
  const barracksList = state.buildings.filter(
    (b) =>
      b.faction === "enemy" &&
      b.type === "barracks" &&
      b.hp > 0 &&
      b.progress === 1,
  );
  const barracks =
    barracksList[ai.reinforcements % Math.max(1, barracksList.length)];
  if (state.time >= ai.nextReinforcement) {
    ai.nextReinforcement += AI_CONFIG.reinforcementInterval;
    if (
      barracks &&
      state.units.filter((u) => u.faction === "enemy" && u.hp > 0).length <
        AI_CONFIG.maximumArmy
    ) {
      const p = spawnPoint(
        state,
        barracks.x + 1,
        barracks.y + barracks.height + 1,
      );
      if (p)
        makeUnit(
          state,
          ai.reinforcements++ % 4 === 3 ? "archer" : "infantry",
          "enemy",
          p.x,
          p.y,
        );
    }
  }
  if (!ai.warned && state.time >= ai.nextRaid - 30) {
    ai.warned = true;
    event(
      state,
      "warning",
      33,
      9,
      "Enemy raid assembling. Prepare your defenses.",
    );
  }
  if (state.time >= ai.nextRaid) {
    ai.wave++;
    ai.nextRaid += AI_CONFIG.raidInterval;
    ai.warned = false;
    const objective = state.buildings.find(
      (b) => b.type === "townCenter" && b.faction === "player" && b.hp > 0,
    );
    if (!objective) return;
    const troops = state.units
      .filter((u) => u.faction === "enemy" && u.hp > 0 && !u.raiding)
      .slice(0, Math.min(3 + ai.wave, 9));
    const center = entityCenter(objective);
    const p = nearestOpen(state, center.x, center.y);
    if (!p) return;
    for (const unit of troops) {
      unit.order = { type: "attackMove", x: p.x, y: p.y };
      unit.raiding = true;
      clearPath(unit);
    }
    if (troops.length)
      event(
        state,
        "raid",
        33,
        9,
        `Raid ${ai.wave}: ${troops.length} enemies march on the Frontier.`,
      );
  }
}
