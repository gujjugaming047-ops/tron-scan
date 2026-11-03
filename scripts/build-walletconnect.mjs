import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir(new URL("../generated/", import.meta.url), { recursive: true });
await build({
  entryPoints: [new URL("../src/walletconnect-client.js", import.meta.url).pathname],
  outfile: new URL("../generated/walletconnect-client.js", import.meta.url).pathname,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "none",
  define: {
    "process.env.NODE_ENV": "\"production\"",
  },
});
console.log("Built WalletConnect browser module.");
