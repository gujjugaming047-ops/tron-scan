import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { labelQrSvg, validateProductionQrUrl } from "../src/logic.mjs";

/**
 * @param {string} url
 * @param {string} directory
 */
export async function createQrArtifacts(url, directory) {
  const check = validateProductionQrUrl(url);
  if (!check.ok) throw new Error(check.error);
  mkdirSync(directory, { recursive: true });
  const pngPath = path.join(directory, "dapp_qr.png");
  const svgPath = path.join(directory, "dapp_qr.svg");
  await QRCode.toFile(pngPath, check.url, {
    errorCorrectionLevel: "H",
    type: "png",
    width: 1024,
    margin: 4,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
  const svg = await QRCode.toString(check.url, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 4,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
  writeFileSync(svgPath, labelQrSvg(svg, check.url), "utf8");
  return { url: check.url, pngPath, svgPath };
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npm run qr -- https://your-deployed-host/");
    process.exit(1);
  }
  try {
    const created = await createQrArtifacts(url, process.cwd());
    console.log("QR opens this website only. Scanning does not connect a wallet or send funds.");
    console.log("Encoded URL:");
    console.log(created.url);
    console.log("Saved:");
    console.log(created.pngPath);
    console.log(created.svgPath);
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error ? error.message : "QR generation failed.";
    console.error(message);
    process.exit(1);
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry.endsWith(`${path.sep}make-qr.mjs`)) {
  await main();
}
