# The Frontier — Foundation 001

This is the first **tested simulation module**, not a complete playable deployment.

The original standalone browser prototype is available as a separately supplied source ZIP; it must be imported, reviewed, and wired into these shared rules in a subsequent PR. These tests do **not** imply the current game already uses this module.

## Integration plan
1. Import the original HTML/CSS/Canvas game into a clean `web/` directory and verify the source hashes.
2. Replace duplicated costs, recruitment gates, placement checks, and damage logic with `src/sim/rules.mjs`.
3. Move state updates into a deterministic simulation step; use the fixed-step clock and seeded PRNG for simulation randomness.
4. Add automated browser tests for build/recruit/attack/restart, then playtest the full encounter on desktop and mobile.
5. Deploy a separate Netlify preview only. Do not alter lammb.fun until the owner approves the cutover.

## Architecture boundaries
- No dependencies, wallet, payment, analytics or third-party game art in this foundation.
- Tests cover deterministic primitives and economy invariants, **not** full pathfinding, AI, browser interactions or multiplayer.
- Multiplayer requires a server-authoritative simulation and separate threat modeling; client-side state cannot be trusted.
