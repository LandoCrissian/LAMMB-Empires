import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? files(`${directory}/${entry.name}`)
          : [`${directory}/${entry.name}`],
      ),
    )
  ).flat();
}
const targets = [
  ...(await files("src")),
  ...(await files("tests")),
  ...(await files("scripts")),
  "playwright.config.mjs",
].filter((name) => /\.m?js$/.test(name));
for (const file of targets) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked ${targets.length} JavaScript modules.`);
