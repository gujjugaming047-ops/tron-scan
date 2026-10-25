import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createQrArtifacts } from "../scripts/make-qr.mjs";
import { createLocalReceiveQr } from "../scripts/make-local-receive-qr.mjs";

const root = path.resolve(import.meta.dirname, "..");
const url = "https://payments.contoso.com/usdt";

describe("QR generator", () => {
  it("writes a high-contrast QR for the exact URL and refuses a local URL", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "tron-qr-"));
    try {
      const created = await createQrArtifacts(url, directory);
      assert.equal(created.url, url);
      const png = readFileSync(created.pngPath);
      assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(png.readUInt32BE(16), 1024);
      assert.equal(png.readUInt32BE(20), 1024);
      const svg = readFileSync(created.svgPath, "utf8");
      assert.match(svg, /Opens the website only/);
      assert.match(svg, /Not a wallet connection or payment/);
      assert.match(svg, /https:\/\/payments\.contoso\.com\/usdt/);
      await assert.rejects(() => createQrArtifacts("https://localhost/pay", directory), /localhost/i);
      await assert.rejects(() => createQrArtifacts("https://127.0.0.1:4174/", directory), /127\.0\.0\.1|loopback/i);
      await assert.rejects(() => createQrArtifacts("http://payments.contoso.com/usdt", directory), /https/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("writes the local preview QR without accepting it as a production QR", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "tron-local-qr-"));
    try {
      const created = await createLocalReceiveQr("https://127.0.0.1:4174/index.html", directory);
      assert.equal(created.url, "https://127.0.0.1:4174/");
      const png = readFileSync(created.pngPath);
      assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      const svg = readFileSync(created.svgPath, "utf8");
      assert.match(svg, /https:\/\/127\.0\.0\.1:4174\//);
      assert.match(svg, /Opens the website only/);
      assert.match(svg, /Not a wallet connection or payment/);
      assert.equal(svg.includes("TG94XL9N1uVHPM4U4zcpYGc6w1i7nUBuiq"), false);
      await assert.rejects(() => createLocalReceiveQr("https://payments.contoso.com/", directory), /npm run qr/i);
      await assert.rejects(() => createLocalReceiveQr("http://127.0.0.1:4174/", directory), /https/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("prints the encoded URL from the CLI and rejects placeholders", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "tron-qr-cli-"));
    try {
      const good = spawnSync(process.execPath, [path.join(root, "scripts", "make-qr.mjs"), url], {
        cwd: directory,
        encoding: "utf8",
      });
      assert.equal(good.status, 0, good.stderr);
      assert.match(good.stdout, /Scanning does not connect a wallet or send funds/);
      assert.match(good.stdout, /Encoded URL:\r?\nhttps:\/\/payments\.contoso\.com\/usdt/);
      const bad = spawnSync(process.execPath, [path.join(root, "scripts", "make-qr.mjs"), "https://example.com"], {
        cwd: directory,
        encoding: "utf8",
      });
      assert.notEqual(bad.status, 0);
      assert.match(bad.stderr, /example/i);
      const python = spawnSync("python", ["make_qr.py", "http://127.0.0.1"], {
        cwd: root,
        encoding: "utf8",
      });
      assert.notEqual(python.status, 0);
      assert.equal(existsSync(path.join(root, "dapp_qr.png")), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
