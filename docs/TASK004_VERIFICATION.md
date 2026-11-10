# Task004 — rally points and siege warfare verification

Verified on **2026-11-08** with Node **22.23.2**, Playwright **1.65.0**, Chromium **158.0.8127.18** and Playwright WebKit **27.2**, on Windows. WebKit automation exercises that engine; it does not establish compatibility with a physical iPhone or installed iOS Safari.

## Gameplay delivered

Completed Town Centers, Barracks and Siege Workshops each store an independent rally instruction. Select the producer, choose **Set Rally Point**, choose a destination and **Confirm Rally**. A preview cannot spend supplies or change a rally. **Clear Rally** restores idle-at-exit behavior. Flags and connecting lines appear only for selected producers. Production details show actual queue time and blocked exits.

Military recruits physically leave a connected, unoccupied production apron and walk toward their rally using existing terrain paths and local separation. If the exit is congested, a completed recruit remains queued until there is room. Workers can rally to finite deposits or friendly completed, stocked farms; gathering still requires travel, collection, carrying and delivery. Invalidated destinations use validated reachable fallback ground. Explicit orders take precedence over automatic rally recovery.

The **Siege Workshop** is a worker-built 3×2 structure with 800 HP, a 45-second base construction time and a cost of **120 wood, 70 stone and 30 gold**. A **Siege Ram** costs **80 wood, 60 gold and 30 food**, takes 45 seconds to train, has 360 HP and travels at 1.1 tiles/second. Its attacks deal **135 damage to structures**, versus **9 to units**, every 2.4 seconds. Melee infantry deal 1.5× damage to a ram. These are simulation rules, not displayed power scores.

Rams use real paths, attack cooldowns, damage and death. Contact checks reject attacks through water, ridges, intervening structures and blocked diagonal corners. A ram at geometric range without valid contact seeks another reachable approach instead of remaining stuck. Failed approach searches are cached and retried on a bounded cadence or obstacle change. Guards can locally identify an exposed ram, assign a limited interception group and retain settlement defenders and home tethers. Existing raid warnings and reinforcement rules remain intact.

Original Canvas artwork adds a timber workshop, wheeled covered ram, attack lunge, structure impacts, selection/health feedback and rally flags. Initial terrain drawing now prepares the complete playable base immediately and adds nonessential grain and pebbles in bounded later frames. Simulation behavior is independent of that visual work.

## Simulation and legal balance

**82/82 simulation tests passed.** The original tests remain, with deterministic rally ownership/destination validation, replacement/clearing, training completion, worker delivery, congested spawn exits, invalidated destinations, workshop costs/construction/recruitment, ram movement/contact, structure-versus-unit damage, death, interception, defense, victory/defeat/restart and replay coverage added.

The balance drivers use normal validated commands. No inventory, units, HP, construction progress, training time or combat outcome is injected. Resource/deposit bounds and the 24-unit population limit are checked throughout.

| Legal strategy | Seed 5280 | Seed 5281 | Seed 5282 |
| --- | --- | --- | --- |
| Original conventional driver | Victory **10:54.65** | Victory **11:35.20** | Victory **11:37.65** |
| Siege-assisted driver | Victory **8:03.05** | Victory **8:15.90** | Victory **8:17.50** |

The siege driver physically gathers stone, builds the workshop, pays for two rams, rallies them and escorts them into combat. The original conventional outcomes and timing are preserved. The siege strategy attacks earlier and uses a different assault policy, so its shorter matches are **not evidence that siege alone saves three minutes**. An equal-population conventional control using that same assault policy wins seed 5280 in **6:43.30**, without a workshop. Siege remains optional; broad human balance testing is still needed. The aggressive scenarios finish sooner than the 10–15-minute pacing target, and this pacing difference is an open balance finding.

Focused combat checks prove that one infantry soldier beats an unescorted ram; three infantry plus a tower kill a ram while the tower survives; and a ram can breach an unsupported tower but survives with less than 40% of its HP. Rams have useful structural damage but require protection.

## Browser coverage and rotation

**52 cases passed and one unsupported native-gesture case was explicitly skipped in a single fresh 7.5-minute run** using two workers. There were no failed cases or browser runtime errors. Syntax checks passed for 34 modules and the static build passed.

`npx playwright test --list` enumerates **53 cases**: the preserved 44-case Task003 suite plus nine new rally/siege cases across desktop Chromium, mobile Chromium and mobile WebKit. No existing gameplay assertion was weakened or removed.

The new cases use actual mouse/touch interactions and read-only diagnostics. They set, preview, cancel, replace and clear rallies without spending resources; train a worker that physically gathers and delivers finite wood; construct a workshop with workers; spend supplies to queue a ram; observe physical spawn and movement to its rally; and restart. Paused portrait→landscape snapshots check exact preservation of simulation state, resources, construction, queue, rally, orders, selection and camera. Unpaused rotation checks continued training and retained rally, selection and tactical camera. Existing landscape cases issue actual move, attack, attack-move, construction, recruitment, pause/resume and minimap commands after rotation.

The seven viewport cases include Workshop, Ram, Set Rally Point and Clear Rally reachability. Command targets are checked at 44 CSS pixels, fully inside the viewport with an unobscured center. Extra coverage includes 844×350 reduced available height and simulated 44-pixel side insets with a 21-pixel home-indicator inset. These simulations do not reproduce native Safari browser chrome.

Chromium CDP injects native pan and multi-touch pinch while army, placement or rally modes are armed; gestures cannot save a rally or issue unintended orders. The corresponding WebKit native multi-touch injection remains **explicitly unsupported**; WebKit native taps and rotation are exercised separately.

An initial seven-worker browser run failed because the host disk filled while recording continuous animated-canvas trace filmstrips (`ENOSPC`), before the suite completed. A two-worker attempt was then stopped proactively. The final trace configuration retains failed-run DOM snapshots and source traces while disabling continuous diagnostic screenshots. Explicit evidence PNGs, failure screenshots, all assertions, native actionability checks and case budgets remain enabled. Normal Playwright output cleanup removed the disposable interrupted-run artifacts. This changes diagnostic recording only, not gameplay verification.

## Screenshots

The rally captures below come from the real UI tests, with paid recruitment and worker-built structures.

| Capture | Desktop | Mobile landscape |
| --- | --- | --- |
| Worker gathering rally | [1440×900](screenshots/task004/rally-siege-desktop-chromium-worker-rally.png) | [844×390 Chromium](screenshots/task004/rally-siege-mobile-chromium-worker-rally.png), [WebKit](screenshots/task004/rally-siege-mobile-webkit-worker-rally.png) |
| Workshop rally and trained ram | [1440×900](screenshots/task004/rally-siege-desktop-chromium-ram-rally.png) | [844×390 Chromium](screenshots/task004/rally-siege-mobile-chromium-ram-rally.png), [WebKit](screenshots/task004/rally-siege-mobile-webkit-ram-rally.png) |

Siege combat: [desktop](screenshots/task004/siege-combat-legal-desktop.png), [mobile landscape](screenshots/task004/siege-combat-legal-mobile-landscape.png). These two images use the unchanged game renderer with the legal seed-5280 match state at **375 seconds**, two paid, living rams and an actual structure hit at **374.95 seconds**. They are explicitly labeled renderer captures, separate from the actual UI screenshots and balance results. No units, resources, HP or combat events were injected into that match state. All **48 Task004 screenshots** are in [the milestone directory](screenshots/task004/).

| Tested size | Chromium active game | WebKit active game |
| --- | --- | --- |
| 390×844 portrait | [Screenshot](screenshots/task004/landscape-chromium-iphone-portrait-active.png) | [Screenshot](screenshots/task004/landscape-webkit-iphone-portrait-active.png) |
| 844×390 landscape | [Screenshot](screenshots/task004/landscape-chromium-iphone-landscape-active.png) | [Screenshot](screenshots/task004/landscape-webkit-iphone-landscape-active.png) |
| 932×430 landscape | [Screenshot](screenshots/task004/landscape-chromium-large-iphone-landscape-active.png) | [Screenshot](screenshots/task004/landscape-webkit-large-iphone-landscape-active.png) |
| 667×375 compact landscape | [Screenshot](screenshots/task004/landscape-chromium-compact-landscape-active.png) | [Screenshot](screenshots/task004/landscape-webkit-compact-landscape-active.png) |
| 915×412 Android-sized landscape | [Screenshot](screenshots/task004/landscape-chromium-android-landscape-active.png) | [Screenshot](screenshots/task004/landscape-webkit-android-landscape-active.png) |
| 1024×768 tablet | [Screenshot](screenshots/task004/landscape-chromium-tablet-active.png) | [Screenshot](screenshots/task004/landscape-webkit-tablet-active.png) |
| 1440×900 desktop | [Screenshot](screenshots/task004/landscape-chromium-desktop-active.png) | [Screenshot](screenshots/task004/landscape-webkit-desktop-active.png) |

Entry screens: [Chromium portrait](screenshots/task004/landscape-chromium-iphone-portrait-entry.png), [Chromium landscape](screenshots/task004/landscape-chromium-iphone-landscape-entry.png), [WebKit portrait](screenshots/task004/landscape-webkit-iphone-portrait-entry.png), [WebKit landscape](screenshots/task004/landscape-webkit-iphone-landscape-entry.png). Historical Task002/Task003 screenshots are preserved.

## Measured performance against Task003

The isolated benchmark ran after the browser suite completed, with no concurrent browser verification. Host: **Intel Core i7-11800H**, 16 logical CPUs, Windows 10.0.26200. [task004.json](performance/task004.json) contains the raw measurements and the preserved Task003 baseline. These are single-run host/emulator timings, not physical-device FPS. Canvas durations measure CPU submission, not completed GPU presentation.

The same legal 240-second, 29-unit conventional fixture completed 4,000 fixed steps: **0.179 ms median, 0.676 ms p95, 13.453 ms maximum**, compared with Task003's **0.155/0.610/12.513 ms**. The largest measured A* search was **2.291 ms** and separation pass pair **0.534 ms**, versus **2.319/1.037 ms** previously. These measurements show a modest simulation increase and no new large movement spike in this sample; they are not a guarantee under every army configuration.

The preserved 40-attempt group-order workload measured **1.232 ms p95, 2.816 ms maximum**, versus **3.218/5.007 ms** previously. It includes **20 accepted and 20 rejected attempts**: the driver retains its original army IDs after combat deaths, and the normal living-unit validator rejects those later orders. This mixed workload remains comparable to Task003, but is not presented as 40 successful formation assignments. The separate siege workload accepted all 40 orders.

| Scenario | Warm 29-unit draw p95, Task003 → Task004 | Cold first draw, Task003 → Task004 | Full terrain cache ready, Task004 |
| --- | --- | --- | --- |
| Desktop 1440×900, DPR 1 | 2.2 → **2.3 ms** | 67.1 → **35.4 ms** | **351.1 ms elapsed** |
| Landscape 844×390, DPR 2 | 1.8 → **1.8 ms** | 65.9 → **36.8 ms** | **311.7 ms elapsed** |
| Same landscape, diagnostic 4× CPU slowdown | 9.4 → **9.2 ms** | 294.2 → **159.3 ms** | **1412.2 ms elapsed** |

The initial terrain base itself took **7.9/8.1/33.3 ms** across those rows. Deferred details consumed **6.7/5.8/29.2 ms total CPU**, with largest detail chunks **0.7/0.6/2.7 ms**. Thus the first synchronous draw is shorter, while complete decorative detail takes longer in elapsed time because it is spread across frames. The full-cache elapsed figure is not a single blocking stall. Warm measurements begin only after the cache is complete.

Normal live samples recorded **zero frame intervals over 50 ms**. Live Canvas draw p95 was **1.6 ms desktop** and **1.2 ms landscape**, versus **1.3/1.2 ms** previously. Under 4× CPU slowdown, long frames remain: **66.8 ms frame-interval p95, 199.9 ms maximum, 116 intervals over 50 ms**, compared with Task003's **66.7/183.4 ms and 101 intervals**. This sample does not establish a long-frame improvement under slowdown; the high-DPI/software-rendering bottleneck remains open. The 159.3 ms throttled cold draw also remains a noticeable stall despite improving from 294.2 ms.

The separate **375-second legal siege fixture** has **16 units, including two rams and a recent real ram structure impact**. It measured **0.126 ms simulation-step p95, 1.466 ms maximum** over 4,000 steps; Canvas draw p95 was **2.1 ms desktop, 1.6 ms landscape and 8.4 ms under 4× slowdown**. Its smaller army and different battle state make direct comparison to the 29-unit conventional fixture inappropriate. The unchanged controlled 64-event rendering stress fixture measured **2.3/1.9/9.7 ms p95**; those deliberately injected visual events are renderer stress inputs, not legal battle or balance results.

## Reproduce and limits

```sh
npm ci
npx playwright install chromium webkit
npm run check
npm test
npm run test:balance
npm run test:siege
npm run build
npm run test:browser -- --workers=2
npm run test:performance
```

Physical iPhone, Android and tablet devices, native Safari pinch/browser controls, thermal limits and long-session memory remain untested. Local avoidance remains soft separation: troops can temporarily compress at crowded obstacles, and large armies do not have formation-level route planning. A worker cut off from its Town Center by a closed crossing keeps its unbanked cargo on reachable ground; the player must reopen a delivery route and reassign gathering. The game still has one visible map, no fog of war, saves, audio or multiplayer.

The next high-value improvement is formation-level assault and retreat behavior, backed by physical-device profiling and wider human balance trials. Preview deployment stays isolated; merging and production cutover require owner authorization.
