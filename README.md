# LAMMB Empires — The Frontier

**Build a settlement. Command an army. Claim the Frontier.**

An original, browser-first single-player RTS. Gather finite wood, stone, food and gold; build farms, barracks, watchtowers and siege workshops; train swordsmen, archers and siege rams; defend the settlement and destroy the enemy Town Center. Losing your Town Center ends the expedition.

The repository continues the rules foundation from [draft PR #1](https://github.com/LandoCrissian/LAMMB-Empires/pull/1). It does not depend on RMT5280, legacy LAMMB projects, wallets, tokens or multiplayer services.

## Run locally

Use Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open **http://localhost:4173**. The game is static HTML, CSS and JavaScript, with no runtime packages. Stop the development server with Ctrl+C. `npm run build` copies only the shipped game into `dist/` for static hosting; it excludes tests, documentation and development dependencies.

## Play

Select a worker, then a resource deposit to gather. Workers travel to the deposit, fill their pack and return supplies to the Town Center. Completed farms supply food and also require workers. Supplies are finite; build new farms before old ones run dry.

Choose **Build**, pick a structure and place it on a valid footprint near your settlement. Construction needs a living worker at the site. Choose **Recruit** to train workers at the Town Center, swordsmen and archers at a finished Barracks, or rams at a finished Siege Workshop. Queued recruits reserve space in the 24-unit population limit.

Select a completed Town Center, Barracks or Siege Workshop, choose **Set Rally Point**, tap a destination and **Confirm Rally**. Each producer remembers its own instruction. Town Center workers can rally to a resource deposit or a friendly stocked farm and begin gathering after physically leaving the building. Military recruits walk toward their rally flag. **Clear Rally** restores the normal idle-at-exit behavior. Panning, pinching and rotating do not commit a preview.

A **Siege Workshop** produces slow, expensive **Siege Rams**. Rams deliver much greater damage to structures than troops, while infantry can punish an exposed ram. Escort siege equipment with swordsmen and archers; conventional armies remain a viable way to win. Nearby enemy guards can intercept visible siege threats without abandoning the whole settlement.

Use swordsmen to screen archers. Archers and towers fire from range, while rocky ridges obstruct ranged fire. Enemy raids begin after a preparation period and grow stronger. Attack the enemy settlement northeast; destroying all its barracks stops new reinforcements. Destroy its Town Center to win.

Group movement uses loose ranks with melee troops ahead of archers. Units separate locally while keeping their terrain paths and orders. **Hold Position** keeps a soldier at its current location and only fires at targets already in weapon range; **Stop** cancels the current order and restores free defensive response. Enemy guards share nearby sightings, protect threatened structures, and rally raids before advancing.

Phone landscape has a compact command dock, persistent resources and raid countdown, and separate **Objectives** and **Minimap** toggles. Rotating or changing browser viewport size preserves the expedition, selection, camera position and zoom. Fullscreen and orientation locking are not required.

| Desktop                                            | Touch                                                   |
| -------------------------------------------------- | ------------------------------------------------------- |
| Click a unit or structure to select                | Tap a unit or structure to select                       |
| Drag a selection box; Shift adds units             | Use **Workers** or **Army** to select groups            |
| Right-click to move, gather or attack              | Choose **Move** or **Attack**, then tap the battlefield |
| WASD/arrows pan; mouse wheel zooms                 | Drag to pan; two fingers pan and pinch to zoom          |
| V workers · G army · H home · J hold · Space pause | Large dock controls and zoom buttons                    |

The in-game field guide explains these controls. Restart is available when paused and after victory or defeat.

## Verify

```sh
npm run check
npm test
npm run test:balance
npm run test:siege
npx playwright install chromium webkit
npm run test:browser
npm run test:performance
```

The Node suite checks pure rules and complete simulation behavior. Playwright preserves the earlier desktop/mobile suites and adds rally, siege production, rotation and control-reachability coverage in Chromium and WebKit. The performance script records local simulation, pathfinding, separation, Canvas drawing and frame-interval measurements. GitHub Actions runs the applicable suites and uploads browser evidence. See [Task004 verification](docs/TASK004_VERIFICATION.md) for this milestone, [Task003 verification](docs/TASK003_VERIFICATION.md) and [Task002 verification](docs/VERIFICATION.md) for the earlier baselines.

## Architecture and product boundaries

[Architecture](docs/ARCHITECTURE.md) describes simulation, AI, economy, combat, rendering and input boundaries. [Licenses](docs/LICENSES.md) records dependencies and artwork provenance.

This milestone has one skirmish map, a limited roster, scheduled AI waves and no saved progression. The original legal-command balance driver remains within the intended 10–15-minute window for the checked seeds. The more aggressive siege scenario and its conventional control finish sooner; see the verification report for separate results rather than attributing the strategy change to siege alone. Difficulty still needs broad player testing. Browser viewport and WebKit tests do not establish physical iPhone compatibility or physical-device frame rate.

Strategy determines victory. No paid military stats, premium units, purchasable research speedups or wallet-gated advantages are included. Future development deepens tactics, then civilization progression, then server-authoritative multiplayer and alliances.

Production **lammb.fun**, its DNS and existing production assets must remain untouched until owner-approved cutover. Preview work stays isolated. The entry screen has only the game and [the official LAMMB Genesis collection](https://opensea.io/collection/lammbs-59693791).
