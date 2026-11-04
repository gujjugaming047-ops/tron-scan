import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { injectLandingModuleCacheBust } from "./landing-cache-bust.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const files = ["index.html", "generated/walletconnect-client.js", "src/app.js", "src/landing.js", "src/master-wallet.js", "src/wallet-asset-display.mjs", "src/wallet-snapshot.mjs", "src/wallet-tron-assets.mjs", "src/wallet-evm-assets.mjs", "src/wallet-tron-transactions.mjs", "src/wallet-evm-transactions.mjs", "src/landing-transfer.mjs", "src/tron-usdt-allowance.mjs", "src/tron-read-retry.mjs", "src/logic.mjs", "src/tron-public.mjs", "src/evm-public.mjs", "src/styles.css", "src/wallet-state.mjs", "src/chain-catalog.mjs"];

rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, "src"), { recursive: true });
mkdirSync(path.join(dist, "generated"), { recursive: true });
for (const file of files) {
  if (file === "index.html") {
    const html = readFileSync(path.join(root, file), "utf8");
    writeFileSync(path.join(dist, file), injectLandingModuleCacheBust(html));
    continue;
  }
  cpSync(path.join(root, file), path.join(dist, file));
}
console.log("Built static site in dist/.");
