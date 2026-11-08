# Frontier architecture

The browser owns presentation and input. Simulation modules contain no DOM, Canvas, network or storage dependencies and can be imported directly into Node tests.

## Simulation

`src/sim/rules.mjs` preserves the foundation's immutable costs, resource validation, atomic spending, placement primitive, clamped damage, seeded randomness and bounded fixed-step clock. `src/sim/config.mjs` supplies skirmish balancing: training times, construction times, movement speeds, ranges and AI timing.

`src/sim/world.mjs` creates the seeded map and settlements, validates player commands and advances the match. Entity IDs, events, unit orders, training queues and match status belong to the state. The caller supplies fixed simulation steps; wall-clock frame duration and render animation never create resources or damage.

`src/sim/economy.mjs` moves workers through gather/carry/deliver behavior, deducts finite deposits and farm food, applies on-site construction work and completes training queues. Costs are charged when the simulation accepts construction or recruitment. Population includes queued recruits.

`src/sim/movement.mjs` uses deterministic eight-neighbor A* over water, rocky ridges, resource deposits and building footprints. Diagonal paths cannot cut blocked corners. Paths are refreshed when targets or obstacles change. Units currently share space: richer formations, collision avoidance and congestion remain future work.

`src/sim/combat.mjs` handles individual target acquisition, movement into range, attack cooldowns, hit points, ranged line of sight and defensive fire. `src/sim/ai.mjs` reinforces surviving enemy barracks, warns before scheduled raids and sends troops from the enemy settlement. Destroying all enemy barracks stops reinforcements. Defenders acquire threats locally; raids have the predefined player settlement as their scenario objective.

`src/sim/geometry.mjs` centralizes entity centers, distances, live ID lookup and bounded event history. Buildings use an integer top-left tile footprint; unit and resource coordinates represent world centers.

## Presentation and controls

`src/render/` draws the original procedural 2.5D battlefield with Canvas 2D. World coordinates are converted through the camera; the renderer reads simulation state and never spends resources, resolves combat or controls AI. Visible effects derive from simulation events and animation time.

The browser entry module connects the fixed-step clock, rendering, UI and player input. Player interactions become validated simulation commands. Desktop selection/order behavior and touch pan/pinch/order modes operate through the same command API. HUD inventory, queues and health reflect simulation state.

## Runtime and testing

The game needs no runtime dependencies. `scripts/server.mjs` is a small local static server; Netlify can serve the same source files directly. `scripts/check.mjs` syntax-checks JavaScript modules. Node's built-in runner validates rules and simulation integration. Playwright is development-only browser automation, with desktop and mobile viewport projects.

There is no backend, account requirement, hidden economy, monetization or persistence. Restart creates fresh state from the scenario seed. Physical-device performance, long-session profiling and wider balance trials are not implied by automated functional tests.
