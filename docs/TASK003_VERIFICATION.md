# Task003 — landscape and tactical warfare verification

Verified locally on **2026-11-08** with Node **22.23.2**, Playwright **1.65.0**, Chromium **158.0.8127.18** and Playwright WebKit **27.2**, on Windows. WebKit engine emulation is not a physical iPhone or an installed iOS Safari test.

## Results

| Check | Actual result |
| --- | --- |
| Syntax | **29 JavaScript modules passed** |
| Simulation | **55/55 passed**; the original 38 tests remain, with formation, separation, chokepoint, Hold, local-defense, coordinated-raid, connectivity/query-bound and diagnostic determinism regressions added |
| Legal balance matches | **3/3 victories** without injected supplies, units, HP or production: seed 5280 **10:54.65**, seed 5281 **11:35.20**, seed 5282 **11:37.65** |
| Static build | Passed; only game source and original assets are copied to `dist/` |
| Browser cases | **43 distinct cases passed, 1 explicitly skipped** across Chromium and WebKit; the preserved 20-case baseline and 22 new cases passed together, then the two added live-rotation cases passed separately |
| Native touch injection | Chromium CDP pan, pinch and placement-drag checks passed; the equivalent native WebKit multi-touch injection is unavailable and is the single explicit skip |
| Performance | Local simulation, A*, separation, live browser and controlled Canvas measurements saved in [task003.json](performance/task003.json) |

`npx playwright test --list` enumerates **44 cases**. GitHub Actions is configured to run all 44 in one fresh run, plus syntax, simulation, three legal balance matches and build checks. The report above records local results; the PR's Checks tab records the remote result.

No existing simulation or browser assertion was weakened or removed. The baseline browser screenshot output paths changed so Task002 evidence remains intact.

A Linux WebKit CI run exposed a test-harness budget problem: the desktop case exhausted its 30-second total budget before the Recruit tap could complete. Trace inspection and repeated native taps showed stable control geometry. The helper had unconditionally requested scrolling even for fully visible controls; software-rendered high-DPI WebKit spent substantial animation-frame waits on these no-op requests. The helper now scrolls only when the control is clipped or its center is occluded, while retaining every full-rectangle, hit-test and minimum-target-size assertion. Native taps retain normal Playwright actionability checks. That fix used no timeout increase, and three concurrent local WebKit desktop repetitions then passed in **7.5, 7.6 and 7.9 seconds** under the same budget.

The next Linux CI run passed that WebKit case and all Chromium desktop control/resource assertions, but the Chromium desktop case exhausted its remaining total budget while capturing its final high-DPI screenshot. The seven comprehensive viewport cases therefore have a **60-second total case budget** for command coverage and two image captures, including 5-megapixel desktop artifacts on a two-CPU runner. Native actionability and individual assertion deadlines remain unchanged. The original 20-case baseline is unaffected. No force clicks, retries, runtime pixel reduction or assertion removal was used.

## Viewports and screenshots

Every row passed entry-screen layout, resource visibility, command reachability and screenshot checks in both engines. Essential command targets were checked at 44 CSS pixels or greater, inside the viewport, and with an unobscured center. Compact landscape retained more than 45% of the viewport as a directly playable battlefield while the objective and minimap remained available through 44-pixel toggles.

| Emulated size | Chromium active game | WebKit active game |
| --- | --- | --- |
| 390×844 phone portrait | [Screenshot](screenshots/task003/landscape-chromium-iphone-portrait-active.png) | [Screenshot](screenshots/task003/landscape-webkit-iphone-portrait-active.png) |
| 844×390 phone landscape | [Screenshot](screenshots/task003/landscape-chromium-iphone-landscape-active.png) | [Screenshot](screenshots/task003/landscape-webkit-iphone-landscape-active.png) |
| 932×430 larger phone landscape | [Screenshot](screenshots/task003/landscape-chromium-large-iphone-landscape-active.png) | [Screenshot](screenshots/task003/landscape-webkit-large-iphone-landscape-active.png) |
| 667×375 compact landscape | [Screenshot](screenshots/task003/landscape-chromium-compact-landscape-active.png) | [Screenshot](screenshots/task003/landscape-webkit-compact-landscape-active.png) |
| 915×412 Android-sized landscape | [Screenshot](screenshots/task003/landscape-chromium-android-landscape-active.png) | [Screenshot](screenshots/task003/landscape-webkit-android-landscape-active.png) |
| 1024×768 tablet | [Screenshot](screenshots/task003/landscape-chromium-tablet-active.png) | [Screenshot](screenshots/task003/landscape-webkit-tablet-active.png) |
| 1440×900 desktop | [Screenshot](screenshots/task003/landscape-chromium-desktop-active.png) | [Screenshot](screenshots/task003/landscape-webkit-desktop-active.png) |

Entry screens: [Chromium portrait](screenshots/task003/landscape-chromium-iphone-portrait-entry.png), [Chromium landscape](screenshots/task003/landscape-chromium-iphone-landscape-entry.png), [WebKit portrait](screenshots/task003/landscape-webkit-iphone-portrait-entry.png), [WebKit landscape](screenshots/task003/landscape-webkit-iphone-landscape-entry.png). [All milestone screenshots](screenshots/task003/) include fresh baseline construction/recruitment captures and a [legal army/combat fixture](screenshots/task003/tactics-legal-fixture.png).

## Rotation and actual gameplay

Both engines passed a portrait→landscape→portrait expedition that physically gathered wood, placed an unfinished barracks, queued a worker, selected troops and moved the camera away from home. Paused snapshots proved exact preservation of simulation state, inventory, buildings/construction, training queues, unit orders, selection and camera coordinates/zoom. Projection round trips remained accurate after resize. The resumed landscape match accepted actual Move, Hold, Attack-Move, enemy Town Center attack, minimap, farm placement, recruitment and restart interactions.

A second, **unpaused** portrait→844×390→844×350→portrait test proved that military formation destinations, selected IDs, resources and tactical camera were retained while the simulation, movement and training continued automatically. The 844×350 step simulates reduced available browser height; it does not reproduce native Safari browser chrome.

Chromium native gestures proved that panning/pinching with selected troops cannot issue army orders and that dragging while construction is armed cannot spend supplies or place a foundation. Both engines passed Hold/Stop cancellation of armed Move/Attack modes and the **J** keyboard Hold shortcut. Both also passed 667×375 with simulated 44-pixel left/right notches and a 21-pixel home-indicator inset.

## Measured performance

Host: **Intel Core i7-11800H**, 16 logical CPUs, Windows 10.0.26200. Measurements use headless Chromium with no concurrent browser suite. These are host/emulator timings, not physical-device FPS. Canvas durations measure CPU draw submission, not completed GPU presentation.

The legal 240-second simulation fixture contained 29 units. Over 4,000 fixed steps, step time was **0.155 ms median, 0.610 ms p95, 12.513 ms maximum**. Forty group-order assignments measured **3.218 ms p95, 5.007 ms maximum**. The largest measured A* search was **2.319 ms**; largest separation pass pair **1.037 ms**. A separate regression proves that an unreachable split-map formation uses zero A* queries instead of the reproduced 542-query scan.

| Scenario | Live draw p95 | Warm 29-unit draw p95 | Controlled 64-event effects draw p95 | Cold terrain draw |
| --- | --- | --- | --- | --- |
| Desktop 1440×900, DPR 1 | 1.3 ms | 2.2 ms | 2.5 ms | 67.1 ms |
| Landscape 844×390, DPR 2 | 1.2 ms | 1.8 ms | 1.9 ms | 65.9 ms |
| Same landscape, diagnostic 4× CPU slowdown | 7.0 ms | 9.4 ms | 9.6 ms | 294.2 ms |

The normal ten-second live samples had no frame interval over 50 ms. Cold terrain initialization caused one 83.4 ms desktop and one 66.7 ms landscape interval in the isolated army harness. Under 4× CPU slowdown, the live sample had 101 intervals over 50 ms, a 66.7 ms p95 and 183.4 ms maximum. The controlled 64-event stress fixture deliberately injects visual events in a separate renderer harness; it is not presented as a legal battle or a gameplay balance result.

An additional headless WebKit desktop diagnostic at DPR 2 was substantially slower: an 8.9-second wall-clock sample recorded a 158 ms frame-interval p95 despite a 2 ms Canvas JavaScript draw p95. Removing panel backdrop blur did not improve that sample. These software-rendering observations explain costly native actionability waits in that engine, and are not treated as physical Safari measurements. The quantitative table above applies to Chromium only.

## Reproduce and limits

```sh
npm ci
npx playwright install chromium webkit
npm run check
npm test
npm run test:balance
npm run build
npm run test:browser
npm run test:performance
```

Physical iPhone, Android and tablet devices, native Safari gestures/browser chrome, thermal limits and long-session memory use remain untested. Soft separation can temporarily compress ranks at obstacles; it is not hard physical collision or full formation-level route planning. The game still has one visible map, no fog of war, saves or audio. Cold terrain setup and the CPU-throttled long-frame results are measured performance limits, not hidden by an FPS claim.

The next useful work is physical-device profiling and reducing first-render terrain stalls, followed by stronger formation-level approach/retreat behavior and wider human tactical balance trials. Deployment remains an isolated preview; production cutover and merging require owner authorization.
