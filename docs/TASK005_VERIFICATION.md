# Task005 — The Command Experience

This milestone continues `6ef72257d1016d4b907f2aaab558fbd22476dc6c` on the existing feature branch and draft PR #1. Verification used Node 22.23.2, Playwright 1.65.0, Chromium 158.0.8127.18 and Playwright WebKit 27.2 on Windows on 2026-11-09. The simulation, original Canvas battlefield and static browser architecture are retained.

## Player commands

On touch, select a friendly unit and tap open ground to move. Selected soldiers attack a tapped enemy; selected workers gather from a valid tapped resource. Group ground movement receives distinct formation destinations. Desktop retains left selection, drag boxes, Shift add/remove, contextual right-click, wheel zoom and WASD/arrows. **Move** and **Attack** remain available for explicit orders.

An immediate touch drag pans. Holding still for **320 ms** displays an armed selection cue; dragging then draws a visible selection rectangle. Releasing selects living friendly units without issuing an order. Gesture intent stays fixed once movement begins. **Area** and **Deselect** are stable controls outside the changing action strip. Double-click/double-tap selects visible friendly units of the same type; Shift clicks remain individual additions/removals.

A second finger cancels a pending rectangle and enables camera gestures. Pinch zoom preserves the world point under its midpoint away from map-boundary clamping. Pointer cancellation, lost capture, blur and viewport changes clear incomplete gestures. Cross-surface touches between the field and HUD cancel stale field input and suppress paid/military clicks until a fresh primary tap. Minimap navigation remains available, and gesture cancellation preserves held camera keys.

The main command panel follows selection:

| Selection                     | Commands                                                                 |
| ----------------------------- | ------------------------------------------------------------------------ |
| Worker                        | Gather, Construct, Assist when construction exists, Move, Stop           |
| Military or mixed army        | Move, Attack/Attack-Move, Hold Position, Assault, Retreat, Stop          |
| Completed production building | Its own recruitable units, actual training queue, Set Rally, Clear Rally |

Global Build/Recruit tabs and Army/Workers shortcuts remain available. Mixed resource orders apply only to workers; military units keep their assignments. Mixed Assault orders use the selected military units. Assist targets unfinished friendly buildings, including unfinished farms, without charging construction a second time. Completed friendly farms remain economic targets.

## Coordinated combat

Choose **Assault** (`K`), then choose ground or an enemy to create a deterministic cohort. Units assemble briefly, advance along a shared route with spaced slots, regroup at crossings and stage near fortified targets. Infantry lead, archers stay behind the front line and rams receive support positions. Cohesion checks, route replanning and blocked-route retries are bounded. A cut-off member is not silently treated as having arrived. Nearby threats still resolve through ordinary combat. Hold, Stop and direct orders remain available to override the cohort.

Choose **Retreat** (`R`), then choose reachable ground to cancel attack/cohort assignments and use spaced movement destinations. Retreat has normal movement speed and ordinary hit points, damage and death. It grants no healing, invulnerability, teleportation or speed bonus, and a new player order takes effect immediately.

Enemy guards retain local detection and home tethers, assign bounded siege interception teams, protect useful surviving structures, disengage from excessive pursuit and reposition through normal movement when a defended structure falls. Existing raid warnings and reinforcement rules remain. No new hidden resources, stat bonuses or instant counter-units were introduced.

## Starting failures and regressions

The starting commit's GitHub Actions run failed six browser cases. The causes were addressed before expanding the command feature set:

- The rectangle helper subtracted padding from an array before spreading it into `Math.min`/`Math.max`; it now computes coordinate bounds before applying padding.
- WebKit touch emulation reported `navigator.maxTouchPoints === 0` despite supporting touch input and coarse-pointer media queries. Accessible selection controls no longer depend on that single property.
- Two existing Hold/Stop expectations assumed that a later touch on empty ground did nothing. The new explicit interaction contract requires that deliberate touch to move. The tests retain immediate Hold/Idle and cleared-mode assertions, then verify the fresh touch produces Move rather than a stale Attack/Attack-Move order.

All original economy, construction, recruitment, combat, rally, rotation and layout assertions remain. Historical Task002–Task004 screenshots and Task004 performance data are preserved. Browser workers are capped at two; failed-run DOM/source traces and explicit evidence/failure screenshots remain, with continuous animated-canvas trace filmstrips disabled. No unrelated files were removed for disk space.

The first full Linux run on the command milestone passed 98 simulation tests, all legal balance/build checks and 85 browser cases, with three documented skips. Its single failure was the existing worker-rally case's 25-second wall wait. [Decoded trace evidence](performance/task005-ci-training-timing.json) shows payment at simulation **6.85**, a **14-second** queue due at **20.85**, and the final poll at **20.45** with **0.40 seconds still training**, five workers and `spawnBlocked: false`. Simulation advanced 13.60 seconds during 24.879 wall seconds; production had not yet reached its valid deadline.

The harness now allows bounded 45-second production and delivery waits inside a 120-second complete journey, and strengthens verification by requiring the actual trained event within 0.1 simulation seconds of `paid.time + queue.remaining`. Worker count, paid resources, rally order, travel, delivery and extraction/bank/cargo conservation assertions remain. Browser concurrency now reserves four available CPUs per worker, capped at two: this 16-CPU development host uses two; small 2–4 CPU CI hosts use one. No game clock, training rate, resource rule, forced action or retry was changed.

The revised worker journey passes all three original desktop/mobile Chromium and mobile WebKit projects, in **38.3/39.3/37.3 seconds**. Two concurrent Chromium repeats at **4× CPU slowdown** also pass, in **58.2/59.3 seconds**. Both derive a training deadline of **29.85 simulation seconds** from the observed paid queue and record the actual trained event at **29.85**; physical resource delivery is observed later at **48.10/49.25**. These focused diagnostic runs retain every original assertion and the stronger timing checks; they do not change game speed or represent physical-device measurements. Their recorded observations are included with the trace analysis above.

## Automated verification

**Simulation:** 98 tests pass: the 82 prior tests and 16 tactical regressions. Coverage includes cohort spacing and roles, crossing/blocked-route behavior, order replacement, retreat speed and vulnerability, defensive pursuit/disengagement, victory/defeat/restart and deterministic replay.

**Browser final run: 86 passed / 3 explicitly documented skips, 89 cases, 10.6 minutes.** The fresh run covers desktop Chromium, portrait/landscape Chromium and portrait/landscape WebKit contexts. Two explicit WebKit skips identify unavailable native gesture injection in the new gesture case; the prior native WebKit pinch skip remains. Desktop does not enumerate irrelevant native-touch cases. All seven viewport audits passed within their prior 60-second total budgets. Their final CI budget is 90 seconds to account for the added worker/production/selection checks and two high-DPI captures; individual assertions, actionability waits, retries and input checks are unchanged.

Real browser input covers soldier selection and physical direct movement, army formation destinations, contextual enemy attacks, worker gathering, visible Area selection, same-type selection, rapid Shift add/remove, mixed worker-only resource assignment, real worker construction/Assist, paid production queues, Assault, Retreat, immediate replacement orders and restart.

The native Chromium gesture case records delivered pointer timestamps for requested 0/100/250/400 ms hold intervals. In the final run, the portrait movements arrived at **0.8/103.1/254.1/437.5 ms** and the landscape movements at **0.4/102.7/247.1/464.5 ms**, giving Pan/Pan/Pan/Select in both. The visible armed cue arrived at **351.2/341.1 ms**, reflecting scheduling beyond the configured 320 ms. The case also verifies a pan cannot become selection after a later pause, cancellation/rotation cannot finish an old rectangle, and a second finger cancels selection while preserving a pinch midpoint. [Portrait timing data](performance/task005-gestures-mobile-chromium.json) and [landscape timing data](performance/task005-gestures-rally-siege-mobile-chromium.json) retain the measurements. Protocol acknowledgement time is measured rather than mistaken for the player's requested hold. These are emulated native-input checks, not physical-device or human usability trials.

The cross-surface case exercises native Chromium Canvas→Minimap handoff with primary release before 320 ms, unchanged orders/selection/resources, real camera navigation and continued held-key panning. Native Canvas→paid Worker button and paid Worker button→Canvas sequences cannot spend supplies or queue a recruit; the next deliberate primary Worker tap does pay and queue. WebKit/desktop use a clearly identified real-mouse plus DOM UI-pointer-interruption variant because native multiple-touch injection is unavailable there.

The required combat journey passes in both landscape engines. Chromium uses native held touch selection; WebKit uses real mouse input through the explicit Area control, followed by native touch commands. Both journeys select a soldier, move it physically, select the army, tap an enemy, wait for real combat injury, retreat living units through the map and issue a fresh Move order. **Both initial swordsmen survive both journeys.** Chromium records 51/125 HP at retreat and the same HP after 1.31/1.22 tiles of withdrawal. WebKit records 97/125 HP at retreat and 69/125 HP after 1.13/1.24 tiles: the injured soldier takes another **28 legitimate damage while retreating**. There is no healing or invulnerability. [Chromium journey](performance/task005-journey-rally-siege-mobile-chromium.json) and [WebKit journey](performance/task005-journey-rally-siege-mobile-webkit.json) retain the observations.

## Legal balance

All balance drivers use validated commands, finite gathering, paid construction/training and real movement/combat. They do not inject inventory, units, HP, construction progress or combat results.

| Strategy       | Seed 5280    | Seed 5281    | Seed 5282    |
| -------------- | ------------ | ------------ | ------------ |
| Conventional   | **10:52.85** | **12:36.10** | **13:06.00** |
| Siege-assisted | **8:03.05**  | **8:15.90**  | **8:17.50**  |

The conventional matches remain within the 10–15-minute target, with meaningful timing changes from more useful enemy defensive positions. The siege driver and its **6:43.30** conventional control remain viable. Different assault policies make these scenarios unsuitable for attributing the whole time difference to one unit or command.

The new legal command scenario wins in **7:32.75** after real gathering, workshop construction and two paid rams. It issues four Assault orders and one Retreat, walks **203.00 aggregate unit tiles** while retreating, takes **51 actual HP damage during retreat**, then re-assaults. The army takes 1,414 damage during Assault and deals 2,457 ram structure damage with two breaches, two rams trained and no rejected commands. This aggressive driver finishes below the pacing target; broad human balance trials remain necessary. Assault itself supplies coordination rather than statistical combat advantages.

## Screenshots and viewports

All **77 screenshots** are in [task005](screenshots/task005). Command/context captures come from real UI tests; the combat-retreat captures show the real legal browser journey.

| Viewport                        | Chromium active game                                                                   | WebKit active game                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 390×844 portrait                | [Screenshot](screenshots/task005/landscape-chromium-iphone-portrait-active.png)        | [Screenshot](screenshots/task005/landscape-webkit-iphone-portrait-active.png)        |
| 844×390 landscape               | [Screenshot](screenshots/task005/landscape-chromium-iphone-landscape-active.png)       | [Screenshot](screenshots/task005/landscape-webkit-iphone-landscape-active.png)       |
| 932×430 landscape               | [Screenshot](screenshots/task005/landscape-chromium-large-iphone-landscape-active.png) | [Screenshot](screenshots/task005/landscape-webkit-large-iphone-landscape-active.png) |
| 667×375 compact                 | [Screenshot](screenshots/task005/landscape-chromium-compact-landscape-active.png)      | [Screenshot](screenshots/task005/landscape-webkit-compact-landscape-active.png)      |
| 915×412 Android-sized landscape | [Screenshot](screenshots/task005/landscape-chromium-android-landscape-active.png)      | [Screenshot](screenshots/task005/landscape-webkit-android-landscape-active.png)      |
| 1024×768 tablet                 | [Screenshot](screenshots/task005/landscape-chromium-tablet-active.png)                 | [Screenshot](screenshots/task005/landscape-webkit-tablet-active.png)                 |
| 1440×900 desktop                | [Screenshot](screenshots/task005/landscape-chromium-desktop-active.png)                | [Screenshot](screenshots/task005/landscape-webkit-desktop-active.png)                |

| New interaction    | Desktop                                                                 | Portrait                                                                                                                                      | Landscape                                                                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct commands    | [Chromium](screenshots/task005/desktop-chromium-direct-command.png)     | [Chromium](screenshots/task005/mobile-chromium-direct-command.png), [WebKit](screenshots/task005/landscape-webkit-direct-command.png)         | [Chromium](screenshots/task005/rally-siege-mobile-chromium-direct-command.png), [WebKit](screenshots/task005/rally-siege-mobile-webkit-direct-command.png)                                               |
| Visible rectangle  | [Chromium](screenshots/task005/desktop-chromium-selection-box.png)      | [Chromium](screenshots/task005/mobile-chromium-selection-box.png), [WebKit](screenshots/task005/landscape-webkit-selection-box.png)           | [Chromium](screenshots/task005/rally-siege-mobile-chromium-selection-box.png), [WebKit](screenshots/task005/rally-siege-mobile-webkit-selection-box.png)                                                 |
| Production context | [Chromium](screenshots/task005/desktop-chromium-context-production.png) | [Chromium](screenshots/task005/mobile-chromium-context-production.png), [WebKit](screenshots/task005/landscape-webkit-context-production.png) | [Chromium](screenshots/task005/rally-siege-mobile-chromium-context-production.png), [WebKit](screenshots/task005/rally-siege-mobile-webkit-context-production.png)                                       |
| Assault            | [Chromium](screenshots/task005/desktop-chromium-assault.png)            | [Chromium](screenshots/task005/mobile-chromium-assault.png), [WebKit](screenshots/task005/landscape-webkit-assault.png)                       | [Chromium](screenshots/task005/rally-siege-mobile-chromium-assault.png), [WebKit](screenshots/task005/rally-siege-mobile-webkit-assault.png)                                                             |
| Combat retreat     | —                                                                       | —                                                                                                                                             | [Chromium native held selection](screenshots/task005/rally-siege-mobile-chromium-combat-retreat.png), [WebKit explicit Area selection](screenshots/task005/rally-siege-mobile-webkit-combat-retreat.png) |

Mixed-cohort presentation: legal **355-second Assault** state ([desktop](screenshots/task005/cohort-assault-legal-desktop.png), [landscape](screenshots/task005/cohort-assault-legal-mobile-landscape.png)) and legal **375-second withdrawal** state ([desktop](screenshots/task005/cohort-retreat-legal-desktop.png), [landscape](screenshots/task005/cohort-retreat-legal-mobile-landscape.png)). These four separate renderer captures are explicitly labeled and use unchanged normal-command states: eight swordsmen, four archers and two rams during the advance; seven swordsmen, four archers and two rams after withdrawal, with six still returning and others already regrouped. No troops, supplies, HP or events were injected. [Fixture metadata](performance/task005-presentation-fixtures.json) records composition, active orders, phase and camera. These captures complement the real UI journey; they are not substituted for browser interaction or legal balance results.

The seven layout cases verify unobscured control centers, practical 44-pixel targets, visible resources and no page overflow. They include military Assault/Retreat, worker Gather/Construct and producer recruitment/rally actions. Existing paused exact-state and live portrait→landscape→portrait checks preserve resources, orders, construction, queues, rally points, selection, camera and zoom. Extra reduced-height and simulated notch/home-inset cases remain.

## Performance

The benchmark completed after the full browser suite, without concurrent browser or CPU-heavy verification. Host: Intel Core i7-11800H, 16 logical CPUs, Windows 10.0.26200, Node 22.23.2, Chromium 158.0.8127.18. [task005.json](performance/task005.json) preserves raw measurements and the exact Task004 baseline. Timings are single-run CPU submission/host-emulation measurements, not physical-device FPS or GPU completion.

The preserved legal 240-second, 29-unit workload takes **0.191 ms median / 0.743 ms p95 / 15.151 ms maximum** over 4,000 fixed steps, versus **0.179/0.676/13.453 ms** before. This is a roughly 10% p95 increase. Its **3,610 path calls and 47,060 expanded nodes are identical** to Task004, so the measured increase does not come from an explosion in path searches. The largest A\* search is **2.419 ms**, and separation pass pair **1.049 ms**, versus 2.291/0.534 ms. These sampled maximums are not universal guarantees.

The unchanged 40-attempt group-order workload measures **2.465 ms p95 / 3.007 ms maximum**, versus 1.232/2.816 ms. It again has **20 accepted and 20 rejected orders**, because the benchmark retains original army IDs after combat deaths and the normal living-unit validator rejects later attempts. It is a comparable mixed workload, not a claim of 40 successful formation assignments.

| Scenario                                   | Warm 29-unit draw p95, Task004 → Task005 | Cold first draw, Task004 → Task005 | Full terrain ready, Task005 |
| ------------------------------------------ | ---------------------------------------- | ---------------------------------- | --------------------------- |
| Desktop 1440×900, DPR 1                    | 2.3 → **2.6 ms**                         | 35.4 → **40.8 ms**                 | **384.8 ms elapsed**        |
| Landscape 844×390, DPR 2                   | 1.8 → **1.9 ms**                         | 36.8 → **36.9 ms**                 | **316.3 ms elapsed**        |
| Same landscape, diagnostic 4× CPU slowdown | 9.2 → **10.8 ms**                        | 159.3 → **190.6 ms**               | **1626.5 ms elapsed**       |

Terrain base work measures **8.1/8.8/44.8 ms**, and the largest deferred detail chunk **0.6/0.6/3.1 ms**. The full-ready elapsed figure includes later animation frames and is not one blocking stall. Warm samples start after all detail is ready. The primary results show modest normal-host increases and a worse slowed-host sample; they are retained rather than replaced by a more favorable diagnostic.

Normal live samples record no frame intervals above 50 ms. Under 4× slowdown, the long-frame problem remains: **83.4 ms frame-interval p95, 216.6 ms maximum, 147/165 intervals above 50 ms**, compared with Task004's **66.8/199.9 ms and 116/185 intervals**. The high-DPI/software-rendering bottleneck remains open; there is no physical-device FPS claim.

To investigate the rendering difference, a [paired same-host diagnostic](performance/task005-paired-renderer.json) runs the Task004 renderer from commit `d47167643acfb92277a8001cd60f350b0ef4ce01` and the current renderer against the **same frozen 29-unit state and same 844×390/DPR-2 Canvas**, with no HUD. Both terrain caches are fully complete before sampling, both receive ten extra warmup frames, and draw order alternates across 150 paired frames. Old/current p95 is **1.9/1.9 ms normally** and **8.5/8.7 ms under 4× slowdown**; medians are **1.6/1.6 ms** and **7.0/7.1 ms**. This isolates only warm Canvas submission and does not reproduce the full historical slowdown. Host variation, UI work and frame scheduling remain possible contributors; this diagnostic does not establish their cause or erase the primary regressions above. No pathfinding or rendering optimizations were introduced solely to improve a benchmark number.

Separate active-command samples retain their own orders throughout each 4,000-step run; no legacy Move command silently detaches the cohort. The legal **355-second Assault** fixture contains 30 total units and 14 active cohort members: **0.642 ms step p95 / 3.148 ms maximum**, 3,400 path calls. The legal **375-second Retreat** fixture contains 28 total units and six still-retreating members: **0.226 ms step p95 / 1.221 ms maximum**, 580 path calls. These are different battle states and cannot be treated as faster versions of the conventional workload.

Ten accepted Assault preparations and ten accepted Retreat preparations cost **4.045/0.181 ms p95**, respectively; together they make ten path searches, with **1.890 ms maximum** path cost. Warm Assault/Retreat rendering costs **2.7/2.7 ms p95 desktop**, **2.4/1.9 ms landscape**, and **10.4/10.3 ms under slowdown**.

## Reproduce and limits

```sh
npm ci
npx playwright install chromium webkit
npm run check
npm test
npm run test:balance
npm run test:siege
npm run test:command
npm run build
npm run test:browser
npm run test:performance
```

Physical iPhone/Android/tablet hardware, native Safari multi-touch/browser chrome, thermal behavior and long sessions remain untested. WebKit engine automation is not installed iOS Safari verification. Native long-press/pinch/pointer-cancellation injection is available only in the Chromium automation used here; WebKit real taps, mouse-based Area selection, rotation and explicit pointer-interruption fallback are labeled separately.

Local avoidance is soft separation, so troops can still temporarily compress near busy obstacles. Cohorts coordinate a practical shared route; they do not provide rigid formation collision or optimal planning through every terrain arrangement. A cut-off worker keeps cargo and needs a reopened delivery route plus gathering reassignment. The game still has one visible map, no persistent control groups, saved matches, fog, audio or multiplayer.

The next high-value milestone is wider human tactical balance and physical-device profiling, then deeper formation control and clearer scouting decisions. Preview work remains isolated; no merge, production publication, lammb.fun or DNS change is authorized by this milestone.
