import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const landingPath = path.join(root, "src", "landing.js");

/** @returns {string} */
export function landingModuleCacheQuery() {
  const source = readFileSync(landingPath);
  return createHash("sha256").update(source).digest("hex").slice(0, 12);
}

/**
 * @param {string} html
 * @returns {string}
 */
export function injectLandingModuleCacheBust(html) {
  const query = landingModuleCacheQuery();
  return html.replace(
    /src="\.\/src\/landing\.js(?:\?[^"]*)?"/,
    `src="./src/landing.js?v=${query}"`,
  );
}
