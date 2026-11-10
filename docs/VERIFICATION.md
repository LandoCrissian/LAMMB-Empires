# Frontier verification

This records the Task002 baseline. See [Task003 landscape and tactical warfare verification](TASK003_VERIFICATION.md) for the current milestone.

## Reproduce

```sh
npm ci
npm run check
npm test
npm run test:balance
npm run build
npx playwright install chromium
npm run test:browser
```

The browser runner starts the local server automatically. Projects use 1440×900 desktop Chromium and 390×844 touch-enabled mobile Chromium. Screenshots are stored in `docs/screenshots/`; failures retain screenshots and traces in `test-results/`. GitHub Actions uploads those directories as browser-verification artifacts.

## Coverage

- Pure rules: valid inventory, atomic spending, population gates, placement bounds/occupancy, damage, random seeds and fixed-step clock bounds.
- Skirmish integration: physical gathering and delivery conservation for all four resources and finite farms; depleted resources; valid and rejected construction; builder presence; timed training; queued population reservations; unit orders; enemy raid scheduling; individual melee/ranged combat; ridge pathing and line of sight; local defender response; victory/defeat; deterministic replay and restart.
- Full legal matches: economy, worker/army production, defense against raids, repeated assaults and Town Center destruction. The driver uses only the public command API and simulation steps, with no injected resources, HP, completed buildings or units. A separate untouched-settlement run proves actual enemy raids can defeat the player.
- Browser interaction: entry/start, desktop drag selection, mobile group selection, gathering and delivered inventory, friendly farm taps, invalid and valid construction, completed barracks and timed archer training, real enemy target selection through minimap navigation, move/attack-move/stop, camera controls, real touch drag/pinch, pause/resume/restart and responsive layout.

The simulation integration suite uses deliberately controlled fixtures for combat edge cases and population-cap checks. Browser tests interact with the actual controls; an optional read-only `?test=1` snapshot hook exposes state for assertions and projects world locations to screen coordinates. Browser tests do not directly alter simulation state.

## Recorded run

Local verification completed on **2026-11-08**, Windows, Node **22.23.2**, Playwright **1.65.0**, Chromium. Both browser projects completed without uncaught page errors.

| Check | Actual result |
| --- | --- |
| `npm run check` | Passed; 23 JavaScript modules checked |
| `npm test` | **38/38 passed**, including complete legal victory, actual raid-driven defeat, and exact resource delivery at a purchase threshold |
| `npm run test:balance` | **3/3 legal-command skirmishes won**; results below |
| `npm run build` | Passed; static `dist/` contains only game source and original assets |
| `npm run test:browser` | **20/20 passed** across desktop and touch-enabled mobile Chromium; about 1.8 minutes total |
| Final entry/battlefield screenshot refresh | **2/2 passed** with the latest touch-specific hints and responsive styling |

| Scenario seed | Legal driver victory time |
| --- | --- |
| 5280 | 11:24.75 (684.75 seconds) |
| 5281 | 11:24.25 (684.25 seconds) |
| 5282 | 11:32.10 (692.10 seconds) |

These timings measure a scripted strategy in simulation time. They establish an achievable complete skirmish within the target pacing window; human matches can vary with player choices and skill.

Screenshots were captured from the running game:

| Viewport | Entry | Battlefield | Construction | Recruited military |
| --- | --- | --- | --- | --- |
| Desktop 1440×900 | [Entry](screenshots/desktop-chromium-entry.png) | [Battlefield](screenshots/desktop-chromium-battlefield.png) | [Construction](screenshots/desktop-chromium-construction.png) | [Military](screenshots/desktop-chromium-military.png) |
| Mobile 390×844, DPR 2 | [Entry](screenshots/mobile-chromium-entry.png) | [Battlefield](screenshots/mobile-chromium-battlefield.png) | [Construction](screenshots/mobile-chromium-construction.png) | [Military](screenshots/mobile-chromium-military.png) |

GitHub Actions is configured to repeat syntax, Node, balance, build and browser checks for pull requests and pushes to main, and to upload browser evidence. Local results above do not assert a remote Actions run status.

## Remaining verification limits

Viewport emulation is not a physical iPhone, Safari or Android test. No measured frame-rate guarantee, long-session performance claim, accessibility certification or broad gameplay-balance claim is made. Human playtesting of difficulty and pacing remains useful follow-up work.

The current game has one visible map, scheduled AI reinforcements, overlapping unit movement, no fog of war, no saved progression and no audio. The next useful improvements are local unit separation and formations, tactical AI responses, additional map/strategy testing, audio feedback and physical-device profiling.
