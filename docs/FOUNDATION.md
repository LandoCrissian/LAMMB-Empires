# The Frontier — Foundation 001

This document records the original Foundation 001 milestone. Its dependency-free simulation primitives are now integrated into the playable Frontier skirmish on the same working branch and PR.

Neither `LAMMB_Empires_The_Frontier.html` nor `LAMMB_Empires_Prototype_001.zip` was available in the task workspace. The browser game was implemented from the approved specifications, preserving the existing rules and original eight tests.

## Integrated implementation

The game imports resource spending, placement validation, damage, the seeded PRNG and the fixed-step clock from `src/sim/rules.mjs`. Simulation state, economy, pathfinding, combat and AI live in separate modules; Canvas rendering, input gestures and HUD controls read that state and issue validated commands. See [architecture](ARCHITECTURE.md) and [verification](VERIFICATION.md) for the current implementation and evidence.

Deployment remains preview-only. Production lammb.fun and DNS require separate owner authorization.

## Architecture boundaries
- No dependencies, wallet, payment, analytics or third-party game art in this foundation.
- The original eight tests cover deterministic primitives and economy invariants. New integration, complete legal-playthrough and browser suites cover the playable skirmish.
- Multiplayer requires a server-authoritative simulation and separate threat modeling; client-side state cannot be trusted.
