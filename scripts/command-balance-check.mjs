// Full legal economy/workshop opening, coordinated assault, vulnerable retreat,
// reinforcement and renewed assault. It never injects supplies, units or damage.
import assert from "node:assert/strict";
import { playSiegeSkirmish } from "./siege-balance-check.mjs";

export const playCommandSkirmish = (seed = 5280, maximumSeconds = 1200) =>
  playSiegeSkirmish(seed, maximumSeconds, { commandExperience: true });

if (
  process.argv[1]?.replaceAll("\\", "/").endsWith("/command-balance-check.mjs")
) {
  const { state, ...result } = playCommandSkirmish();
  console.log(JSON.stringify(result));
  assert.equal(
    result.status,
    "victory",
    "the legal coordinated assault/retreat scenario must remain winnable",
  );
  assert.ok(
    result.metrics.coordinatedOrders >= 2,
    "normal cohort commands must cause renewed assaults",
  );
  assert.ok(
    result.metrics.retreatCount > 0 && result.metrics.retreatDistance > 2,
    "survivors must physically withdraw under normal orders",
  );
  assert.ok(
    result.metrics.assaultDamageTaken > 0,
    "the army must participate in actual opposition combat",
  );
  assert.ok(
    result.metrics.stagingObserved,
    "the army must execute actual assault staging",
  );
  assert.ok(
    result.metrics.trainedRams > 0 && result.metrics.ramStructureDamage > 0,
    "paid siege must actually participate",
  );
}
