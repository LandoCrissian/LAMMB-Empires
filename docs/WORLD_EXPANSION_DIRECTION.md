# LAMMB Empires — One Expanding World

**Owner direction confirmed: November 10, 2026.**

## Product decision (non-negotiable)

LAMMB Empires is **one contiguous, expandable world**, not a series of disconnected skirmish maps. The Frontier is the player's starting region of that world. Future development expands the same geography: the player can travel outward without choosing another map, abandoning the settlement, or discarding progress.

Take inspiration from the sense of geographic expansion, regional passes and alliance territory in *Call of Dragons*, but **do not copy its seasonal map replacement/reset system, world art, or map layouts**.

The single-player skirmish and its win/loss tests are an interim vertical slice, **not the final persistent-world rules**. Existing gameplay, preview and validations must remain working during the transition.

## Target player experience

1. Enter the world at the Frontier settlement.
2. Move the camera and units across connected terrain; discover nearby resources, camps, settlements and tactical chokepoints.
3. Progressively uncover adjacent regions as game content and progression expand.
4. Keep established settlements, ownership, construction and resource state when leaving a region and returning.
5. Eventually meet other players and alliances across the same connected world, with regional objectives, borders, diplomacy and territorial warfare.

The player should not see "Map 1 / Map 2" menus or have to restart a campaign to access added land. Region names are geographic labels within the same world, not separate simulation instances from a player's perspective.

## Engineering direction

### World coordinates and chunk boundaries
- Refactor the existing fixed `44 × 36` `state.map` assumptions behind a **world/chunk abstraction**. Preserve the exact existing Frontier region as the starting playable area and preserve the existing scenario behavior.
- Use stable, globally unique world coordinates for gameplay entities and stable chunk IDs for terrain/storage; movement, selection, camera, hit tests, minimap and pathfinding must agree on the same coordinate space.
- Introduce chunk loading/generation and unloading of **render/cached data** as the camera travels. Do not unload authoritative simulation state merely because a chunk is off-screen.
- Keep authored critical terrain and strategically planned passes, water and objectives. Deterministic generation may fill less-critical geography; stable seeds and authored overrides prevent changes when revisiting a region.
- Maintain deterministic resource depletion, constructed structures, entity IDs and terrain/occupancy when chunks reload. No repeated free resources, duplicated enemies or building resurrection.
- Stream only nearby detail on mobile; use viewport culling, caching and level-of-detail where justified. Avoid full-world renders and unbounded path searches.
- Plan for hierarchical pathfinding for long-range orders: local A* within chunks and an explicit region/chunk connectivity graph for long-range routes. Do not require solving an unlimited global tile grid.
- Provide an incremental regional minimap/world overview that can scale with explored geography rather than a permanently hard-coded 44 × 36 image.

### Multiplayer and persistence (later milestones)
- Local single-player state first; multiplayer will need server-authoritative world simulation, persistent databases, ownership, interest management and anti-cheat.
- Design stable identifiers and clean separation now; do **not** deploy multiplayer infrastructure as part of the first world-expansion refactor.
- Do not turn the first frontier victory into a destructive reset of a future persistent city. The battle may remain a self-contained tutorial/encounter while the long-term world rules evolve.

## Revised Task 006 — World Expansion Foundation

**Do not build a second standalone map.**

Primary deliverable: make the existing Frontier world **architecturally expandable** while maintaining the verified Task 005 controls, game logic and balance.

1. Inventory current hard-coded map dimensions and coordinate/boundary assumptions across `src/sim`, rendering, input, minimap, UI and tests.
2. Introduce a small, testable chunk/region model and stable global coordinates. Keep the current Frontier terrain and entity positions unchanged initially.
3. Demonstrate camera and units crossing a chunk boundary in **one continuous scene**. An adjacent region can be a modest expansion of the existing world, not a selectable new map.
4. Ensure construction rules, paths, combat, resources, selection, rallies and rotation still behave correctly across boundaries.
5. Stream/cull distant terrain details without changing world state; report memory, frame time and simulation performance including CPU-throttled behavior.
6. Test deterministic regeneration, revisit behavior, resource conservation, boundary crossing and chunk residency. Keep old 98 simulation tests and 86 browser passes intact; do not mask unsupported native WebKit gesture coverage.
7. Produce an isolated Netlify preview and actual portrait, landscape and desktop interaction evidence when possible.

**Release gate:** Frontier still plays correctly; a player can travel into connected adjacent land and back without a screen/map transition, without losing state or duplicating resources. If that gate cannot be safely met, deliver verified architectural groundwork and explicitly report that seamless expansion is incomplete.

## Scope controls

- Stay in `LandoCrissian/LAMMB-Empires`, on existing PR #1 unless there's a concrete reason to branch differently.
- Do not merge, modify `lammb.fun`, DNS or production without owner approval.
- No new disconnected maps, map selector, seasonal reset, pay-to-win system, wallet requirement or old LAMMB World feature.
- No need to invent unlimited terrain at this milestone. Build a world that can **grow intentionally**, region by region, without replacing its history.
