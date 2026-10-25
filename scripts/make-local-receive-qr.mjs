import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { labelQrSvg, receivePageUrl } from "../src/logic.mjs";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * Write a PNG and SVG for the local HTTPS preview only.
 * This is not `npm run qr`. Public hosts stay on the production command.
 * @param {string} pageHref
 * @param {string} directory
 */
export async function createLocalReceiveQr(pageHref, directory) {
  const url = receivePageUrl(pageHref);
  if (!url) throw new Error("The local receive QR only accepts an https:// page URL.");
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error("The local receive QR is only for the loopback preview. Use npm run qr for a public host.");
  }
  mkdirSync(directory, { recursive: true });
  const pngPath = path.join(directory, "receive-usdt-qr.png");
  const svgPath = path.join(directory, "receive-usdt-qr.svg");
  await QRCode.toFile(pngPath, url, {
    errorCorrectionLevel: "H",
    type: "png",
    width: 1024,
    margin: 4,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
  const svg = await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 4,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
  writeFileSync(svgPath, labelQrSvg(svg, url), "utf8");
  return { url, pngPath, svgPath };
}

async function main() {
  const pageHref = process.argv[2] || "https://127.0.0.1:4174/";
  try {
    const created = await createLocalReceiveQr(pageHref, process.cwd());
    console.log("Local receive QR opens this page only. Scanning does not connect a wallet or send funds.");
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
if (entry.endsWith(`${path.sep}make-local-receive-qr.mjs`)) {
  await main();
}
