# LAMMB Empires

**Build. Command. Conquer. Earn your victories.**

LAMMB Empires is an original, browser-first real-time strategy game for desktop and mobile. The product direction is locked: LAMMB Empires is the flagship game, and [LAMMB Genesis on OpenSea](https://opensea.io/collection/lammbs-59693791) is the only collection link on the website.

## Product principles

- **Strategy over spending.** No paid unit stats, premium research speedups, or wallet-gated competitive power.
- **Play first.** Deliver genuinely playable base-building and combat before expanding into persistence or multiplayer.
- **Respect players' time.** Long-term development should not punish a player for missing a weekend.
- **Mobile and desktop.** Purpose-built touch controls and precise desktop unit orders.
- **Original and independently owned.** No borrowed Age of Empires, Command & Conquer, Last War, or Call of Dragons artwork or code.
- **One game.** No LAMMB World, partner gateways, community-support features, or legacy site routes.

## Development

The first milestone is **The Frontier**, a solo skirmish prototype covering workers, finite resources, construction, recruiting, tactical unit orders, raids, and a win/lose condition. It is **not** a live multiplayer or persistent game.

Active changes belong in reviewed branches and pull requests. Production at **lammb.fun** must not change until a build is actually verified and the owner authorizes a cutover.

## Roadmap

1. **Foundation:** import and verify the playable vertical slice; define shared economy/pathfinding rules; establish automated checks.
2. **Fun and readability:** combat feedback, unit formations, viable AI behavior, pathing and balance tests, mobile usability.
3. **Strong architecture:** deterministic fixed-step simulation separated from rendering and input; reproducible replays and performance budgets.
4. **Multiplayer groundwork:** server-authoritative matches and fair PvP; only then consider persistent cities, seasons, and alliances.

No NFTs or payments are required to play the first milestone.

See the [source repository](https://github.com/LandoCrissian/LAMMB-Empires).