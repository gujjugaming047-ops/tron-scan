import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { CONNECTION_TARGET, USDT_CONTRACT } from "../src/logic.mjs";

const root = path.resolve(import.meta.dirname, "..");

describe("source safety", () => {
  it("does not collect secrets or build a hidden token approval", () => {
    const files = ["index.html", "src/app.js", "src/auth.mjs", "src/landing.js", "src/logic.mjs", "src/styles.css", "src/wallet-state.mjs", "src/walletconnect-client.js", "scripts/build-walletconnect.mjs", "scripts/make-qr.mjs", "scripts/make-local-receive-qr.mjs"];
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
    const landing = readFileSync(path.join(root, "src/landing.js"), "utf8");
    const walletConnect = readFileSync(path.join(root, "src/walletconnect-client.js"), "utf8");
    const server = readFileSync(path.join(root, "scripts/serve.mjs"), "utf8");
    const html = readFileSync(path.join(root, "index.html"), "utf8");
    assert.equal(app.match(/eth_requestAccounts/g)?.length, 1);
    assert.equal(app.match(/wallet_switchEthereumChain/g)?.length, 1);
    assert.equal(app.match(/triggerSmartContract/g)?.length, 1);
    assert.equal(app.match(/sendRawTransaction/g)?.length, 1);
    assert.equal(app.match(/\.sign\(/g)?.length, 1);
    assert.match(app, /receivePageUrl\(window\.location\.href\)/);
    assert.equal(landing.match(/eth_requestAccounts/g)?.length, 2);
    assert.equal(landing.match(/tron_requestAccounts/g)?.length, 1);
    assert.equal(landing.match(/personal_sign/g)?.length, 1);
    assert.equal(landing.match(/signMessageV2/g)?.length, 3);
    assert.equal(/triggerSmartContract|sendRawTransaction|\.sign\(/.test(landing), false);
    assert.match(landing, /\/api\/auth\/session/);
    assert.match(landing, /\/api\/public\/wallet-assets\?address=/);
    assert.match(landing, /\/api\/public\/evm-wallet-assets\?/);
    assert.match(landing, /loadVerifiedWalletAssets\(session, \{ scrollIntoView: true \}\)/);
    assert.match(html, /id="test-tron-address"/);
    assert.match(html, /id="tron-balance-check-form"/);
    assert.match(html, /id="dialog-wallet-assets"/);
    assert.match(html, /id="linked-assets-heading"/);
    assert.match(html, /id="linked-asset-error"/);
    assert.match(landing, /accountsChanged/);
    assert.match(landing, /chainChanged/);
    assert.match(landing, /WALLETCONNECT_PROJECT_ID/);
    assert.match(walletConnect, /tron:0x2b6653dc/);
    assert.match(walletConnect, /name: "Flash-USDT-traker by binance"/);
    assert.match(walletConnect, /tron_signMessage/);
    assert.match(walletConnect, /pairVisitorWallet/);
    assert.match(walletConnect, /session_event/);
    assert.match(walletConnect, /accountsChanged/);
    assert.equal(/tron_signTransaction|eth_sendTransaction|sendRawTransaction/.test(walletConnect), false);
    assert.match(server, /rememberWallet\(verified\.identity\.address, CONNECTION_TARGET\)/);
    assert.match(server, /connectionTarget: CONNECTION_TARGET/);
    assert.equal(server.match(/response\.writeHead/g)?.length, 1);
    assert.equal(server.match(/response\.end\(/g)?.length, 1);
    assert.match(server, /finish\(response, 500,/);
    assert.match(server, /"Content-Length": String\(payload\.byteLength\)/);
    assert.match(server, /Connection: "close"/);
    assert.match(html, /Flash USDT Check/);
    assert.match(html, /“Flash USDT” is not an official Tether token type/);
    assert.match(html, /Never enter a seed phrase or private key/);
    assert.match(html, /https:\/\/tronscan\.org\/#\/token20\//);
    assert.equal(html.includes("tron:"), false);
    assert.equal(html.includes(CONNECTION_TARGET), true);
    assert.equal(logic.includes(CONNECTION_TARGET), true);
    assert.equal(html.includes(USDT_CONTRACT), true);
    assert.equal(/<script(?![^>]+src="\.\/src\/landing\.js")[^>]*>/i.test(html), false);
  });
});
