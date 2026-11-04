import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { MASTER_SPENDER, RECIPIENT, USDT_CONTRACT } from "../src/logic.mjs";

const root = path.resolve(import.meta.dirname, "..");

const secretForbidden = [
  /\bprivateKey\s*[:=]/,
  /shouldPollResponse/,
  /<(?:input|textarea)[^>]*(?:seed|mnemonic|private|password)/i,
];

const paymentForbidden = [
  /\.approve\s*\(/,
  /\btransferFrom\s*\(/,
  /\bsetApprovalForAll\s*\(/,
  /\bincreaseAllowance\s*\(/,
  /approve\(address,uint256\)/,
];

describe("source safety", () => {
  it("keeps the payment page free of approve and transferFrom", () => {
    const paymentFiles = ["index.html", "src/app.js", "src/styles.css", "scripts/make-qr.mjs", "scripts/make-local-receive-qr.mjs"];
    for (const file of paymentFiles) {
      const source = readFileSync(path.join(root, file), "utf8");
      for (const pattern of [...paymentForbidden, ...secretForbidden]) {
        assert.equal(pattern.test(source), false, `${file} matched ${pattern}`);
      }
    }
    const logic = readFileSync(path.join(root, "src/logic.mjs"), "utf8");
    assert.match(logic, /private key\|seed phrase\|mnemonic\|secret phrase/);
    assert.match(logic, /MASTER_SPENDER/);
    assert.match(logic, /inspectApproveTransaction/);
    assert.equal(/\btransferFrom\s*\(/.test(logic), false);
    assert.equal(/\bsetApprovalForAll\s*\(/.test(logic), false);
    assert.equal(/\bincreaseAllowance\s*\(/.test(logic), false);
    for (const pattern of secretForbidden) {
      assert.equal(pattern.test(logic), false, `logic.mjs matched ${pattern}`);
    }
    const app = readFileSync(path.join(root, "src/app.js"), "utf8");
    const html = readFileSync(path.join(root, "index.html"), "utf8");
    assert.equal(app.match(/eth_requestAccounts/g)?.length, 1);
    assert.equal(app.match(/wallet_switchEthereumChain/g)?.length, 1);
    assert.equal(app.match(/triggerSmartContract/g)?.length, 1);
    assert.equal(app.match(/sendRawTransaction/g)?.length, 1);
    assert.equal(app.match(/\.sign\(/g)?.length, 1);
    assert.match(app, /receivePageUrl\(window\.location\.href\)/);
    assert.match(html, /Receive USDT/);
    assert.match(html, /id="receive-qr"/);
    assert.match(html, /id="receipt-sender"/);
    assert.match(html, /approve\.html/);
    assert.equal(html.includes("tron:"), false);
    assert.equal(html.includes(RECIPIENT), true);
    assert.equal(html.includes(USDT_CONTRACT), true);
    assert.equal(/<script(?![^>]+src="\.\/src\/app\.js(?:\?[^"]*)?")[^>]*>/i.test(html), false);
  });

  it("limits the master approve desk to capped approve only", () => {
    const approveFiles = ["approve.html", "src/approve-app.js"];
    for (const file of approveFiles) {
      const source = readFileSync(path.join(root, file), "utf8");
      for (const pattern of secretForbidden) {
        assert.equal(pattern.test(source), false, `${file} matched ${pattern}`);
      }
      assert.equal(/\btransferFrom\s*\(/.test(source), false, `${file} must not call transferFrom`);
      assert.equal(/\bsetApprovalForAll\s*\(/.test(source), false, `${file} must not call setApprovalForAll`);
      assert.equal(/\bincreaseAllowance\s*\(/.test(source), false, `${file} must not call increaseAllowance`);
      assert.equal(/uint256\s*max|type\(uint256\)\.max|2\s*\*\*\s*256|ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff/i.test(source), false, `${file} must not hardcode unlimited approve`);
    }
    const approveApp = readFileSync(path.join(root, "src/approve-app.js"), "utf8");
    const approveHtml = readFileSync(path.join(root, "approve.html"), "utf8");
    assert.match(approveApp, /approve\(address,uint256\)/);
    assert.match(approveApp, /inspectApproveTransaction/);
    assert.match(approveApp, /MASTER_SPENDER/);
    assert.match(approveApp, /parseApproveCap/);
    assert.equal(approveApp.match(/triggerSmartContract/g)?.length, 1);
    assert.equal(approveApp.match(/sendRawTransaction/g)?.length, 1);
    assert.equal(approveApp.match(/\.sign\(/g)?.length, 1);
    assert.equal(approveHtml.includes(MASTER_SPENDER) || approveApp.includes("MASTER_SPENDER"), true);
    assert.equal(approveHtml.includes(USDT_CONTRACT), true);
    assert.match(approveHtml, /index\.html/);
    assert.equal(/<script(?![^>]+src="\.\/src\/approve-app\.js(?:\?[^"]*)?")[^>]*>/i.test(approveHtml), false);
  });
});
