import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const files = ["index.html", "src/app.js", "src/logic.mjs", "src/styles.css"];

rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, "src"), { recursive: true });
for (const file of files) {
  cpSync(path.join(root, file), path.join(dist, file));
}
console.log("Built static site in dist/.");
