import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** @type {string[]} */
const files = [];

/**
 * @param {string} directory
 */
function walk(directory) {
  for (const name of readdirSync(directory)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (name.endsWith(".js") || name.endsWith(".mjs")) {
      files.push(full);
    }
  }
}

walk(root);
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    console.error(result.stderr || `Syntax check failed for ${file}`);
  }
}
if (failed) process.exit(1);
console.log(`Syntax check passed for ${files.length} files.`);
