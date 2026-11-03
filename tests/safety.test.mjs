import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { RECIPIENT, USDT_CONTRACT } from "../src/logic.mjs";

const root = path.resolve(import.meta.dirname, "..");

describe("source safety", () => {
  it("does not collect secrets or build a hidden token approval", () => {
    const files = ["index.html", "src/app.js", "src/logic.mjs", "src/styles.css", "scripts/make-qr.mjs", "scripts/make-local-receive-qr.mjs"];
    const forbidden = [
      /\.approve\s*\(/,
      /\btransferFrom\s*\(/,
      /\bsetApprovalForAll\s*\(/,
      /\bincreaseAllowance\s*\(/,
      /\bprivateKey\s*[:=]/,
      /shouldPollResponse/,
      /<(?:input|textarea)[^>]*(?:seed|mnemonic|private|password)/i,
    ];
    for (const file of files) {
      const source = readFileSync(path.join(root, file), "utf8");
      for (const pattern of forbidden) {
        assert.equal(pattern.test(source), false, `${file} matched ${pattern}`);
      }
    }
    const logic = readFileSync(path.join(root, "src/logic.mjs"), "utf8");
    assert.match(logic, /private key\|seed phrase\|mnemonic\|secret phrase/);
    const app = readFileSync(path.join(root, "src/app.js"), "utf8");
    const html = readFileSync(path.join(root, "index.html"), "utf8");
    assert.equal(app.match(/eth_requestAccounts/g)?.length, 1);
    assert.equal(app.match(/wallet_switchEthereumChain/g)?.length, 1);
    assert.equal(app.match(/triggerSmartContract/g)?.length, 1);
    assert.equal(app.match(/sendRawTransaction/g)?.length, 1);
    assert.equal(app.match(/\.sign\(/g)?.length, 1);
    assert.match(app, /receivePageUrl\(window\.location\.href\)/);
    assert.match(html, /Flash USDT Check/);
    assert.match(html, /“Flash USDT” is not an official Tether token type/);
    assert.match(html, /Never enter a seed phrase or private key/);
    assert.match(html, /https:\/\/tronscan\.org\/#\/token20\//);
    assert.equal(html.includes("tron:"), false);
    assert.equal(html.includes(RECIPIENT), false);
    assert.equal(html.includes(USDT_CONTRACT), true);
    assert.equal(/<script/i.test(html), false);
  });
});
