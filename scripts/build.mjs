import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
if (relative(root, output) !== "dist") throw new Error("Invalid build output");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const path of ["index.html", "src", "assets"])
  await cp(resolve(root, path), resolve(output, path), { recursive: true });
await writeFile(
  resolve(output, "_headers"),
  "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Robots-Tag: noindex\n",
);
await writeFile(resolve(output, "robots.txt"), "User-agent: *\nDisallow: /\n");
console.log(
  "Built Frontier static preview in dist/ (game source and original assets only).",
);
