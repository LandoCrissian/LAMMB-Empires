# Dependencies and artwork provenance

## Shipped game

The shipped game uses browser standards: HTML, CSS, ES modules and Canvas 2D. It has no third-party runtime package, remote font, tracking service or external asset download.

The battlefield terrain, trees, rocks, buildings, troops, effects, interface styling and ram crest are original procedural/vector work created for this repository. No artwork, sounds, code or textures from Age of Empires, Command & Conquer, Last War, Call of Dragons or unrelated legacy LAMMB projects were imported. The skirmish does not currently ship music or sound effects.

The repository does not grant a public license to original LAMMB artwork or source merely by being publicly accessible. Rights remain with the project owner unless a separate owner-approved license is added.

## Development dependencies

| Package | Role | License |
| --- | --- | --- |
| `@playwright/test` | Browser interaction tests and screenshots | Apache-2.0 |
| `playwright` | Transitive browser automation library | Apache-2.0 |
| `playwright-core` | Transitive automation core | Apache-2.0 |

Exact versions and integrity hashes are recorded in `package-lock.json`. Their upstream license texts are supplied with the installed packages. Downloaded test browsers have their own upstream licenses and are not bundled into the game.

Node.js and GitHub Actions are development/test infrastructure. No production user downloads the test dependencies.
