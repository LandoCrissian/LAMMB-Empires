# Frontier architecture

The browser owns presentation and input. Simulation modules contain no DOM, Canvas, network or storage dependencies and can be imported directly into Node tests.

## Simulation

`src/sim/rules.mjs` preserves the foundation's immutable costs, resource validation, atomic spending, placement primitive, clamped damage, seeded randomness and bounded fixed-step clock. `src/sim/config.mjs` supplies skirmish balancing: training times, construction times, movement speeds, ranges and AI timing.

`src/sim/world.mjs` creates the seeded map and settlements, validates player commands and advances the match. Entity IDs, events, unit orders, training queues and match status belong to the state. The caller supplies fixed simulation steps; wall-clock frame duration and render animation never create resources or damage.

`src/sim/economy.mjs` moves workers through gather/carry/deliver behavior, deducts finite deposits and farm food, applies on-site construction work and completes training queues. Costs are charged when the simulation accepts construction or recruitment. Population includes queued recruits.

`src/sim/rally.mjs` validates producer ownership, completed production buildings, ground/resource destinations and static connectivity. A producer stores an individual rally instruction. Training uses a connected, unoccupied exit apron; if no safe slot exists, the completed item remains queued rather than teleporting or stacking. Spawned recruits receive ordinary move/gather orders. Obstacle changes and exhausted targets reroute only untouched rally-origin orders to validated reachable ground; explicit player commands remain authoritative.

`src/sim/movement.mjs` uses deterministic eight-neighbor A* over water, rocky ridges, resource deposits and building footprints. Diagonal paths cannot cut blocked corners. Paths are refreshed when targets or obstacles change. Two bounded local separation passes spread living units without replacing their orders; sampled displacement rejects impassable tiles and blocked corners. This is soft local avoidance rather than a rigid body solver, so troops can compress through busy crossings. Hold-position units keep their anchors.

`src/sim/formations.mjs` assigns unique, reachable destinations in loose ranks aligned to the direction of travel, with melee troops ahead of ranged troops. Destination reservations avoid shared endpoints. Terrain paths remain independent so the formation can compress through a chokepoint and reopen at its destination.

The formation search first checks cached static connected regions, using the same terrain and diagonal-corner rules as A*. The cache is invalidated when the map reference or obstacle version changes. Candidates in disconnected regions are rejected before path searches, preventing a blocked crossing from triggering hundreds of futile A* queries.

`src/sim/combat.mjs` handles individual target acquisition, movement into range, attack cooldowns, hit points, ranged line of sight and defensive fire. Hold Position fires only at targets already in weapon range and never initiates pursuit. Stop restores ordinary idle defensive behavior. Recent-hit, recent-attack and current-target fields drive presentation without making the renderer authoritative.

Siege Rams use the same movement, attack cooldown, range, hit-point and death systems. Their configured structure damage differs from anti-unit damage; infantry counters resolve through real individual attacks. Siege Workshop costs, construction time, footprint and production roles live in configuration rather than UI logic. Local siege interception extends the existing guard information and home tether, without creating units or supplies.

`src/sim/ai.mjs` reinforces surviving enemy barracks and coordinates local defense on a 0.75-second decision cadence. Structures report nearby visible threats; guards answer reports within their home tether and prioritize attacks on valuable military structures. Raid warnings rally available troops before a grouped advance. The predefined player Town Center is the scenario objective; new tactical raid targets require local sight and line of sight. Destroying all enemy barracks stops reinforcements.

`src/sim/geometry.mjs` centralizes entity centers, distances, live ID lookup and bounded event history. Buildings use an integer top-left tile footprint; unit and resource coordinates represent world centers.

## Presentation and controls

`src/render/` draws the original procedural 2.5D battlefield with Canvas 2D. World coordinates are converted through the camera; the renderer reads simulation state and never spends resources, resolves combat or controls AI. Visible effects derive from simulation events and animation time.

Terrain setup draws the complete playable base immediately, then adds nonessential grass grain and pebbles in bounded frame chunks. Deferred detail work changes no terrain rules or simulation state. Read-only terrain diagnostics distinguish initial base drawing, total detail CPU work, longest chunk and elapsed time until the entire cache is ready; warm rendering benchmarks wait for completion.

The browser entry module connects the fixed-step clock, rendering, UI and player input. Player interactions become validated simulation commands. Desktop selection/order behavior and touch pan/pinch/order modes operate through the same command API. HUD inventory, queues and health reflect simulation state.

Viewport synchronization sizes the canvas from its displayed bounds and updates compact-landscape layout from the visual viewport. Resizing cancels incomplete pointer gestures and preserves state, selections and world-space camera coordinates instead of calling the initial settlement fit. CSS safe-area insets and dynamic viewport units support changing browser chrome; physical-device behavior still requires device testing.

Diagnostics are opt-in and kept outside deterministic state: movement counters/time samples are module-local, while `?test=1` exposes read-only state/camera/selection/projection snapshots and bounded frame, render and simulation timing summaries. `scripts/performance.mjs` records a legal 240-second army fixture, pathfinding/separation costs, live browser timings and isolated Canvas drawing costs. Timing data never determines gameplay.

Rally previews are presentation state. Only an explicit validated `setRally` command changes a producer; gesture cancellation and viewport synchronization cannot save a rally. The renderer shows committed flags and paths only for selected producers, keeping inactive production instructions from cluttering the battlefield.

## Runtime and testing

The game needs no runtime dependencies. `scripts/server.mjs` is a small local static server; Netlify can serve the same source files directly. `scripts/check.mjs` syntax-checks JavaScript modules. Node's built-in runner validates rules and simulation integration. Playwright is development-only browser automation, with desktop and mobile viewport projects.

There is no backend, account requirement, hidden economy, monetization or persistence. Restart creates fresh state from the scenario seed. Physical-device performance, long-session profiling and wider balance trials are not implied by automated functional tests.
