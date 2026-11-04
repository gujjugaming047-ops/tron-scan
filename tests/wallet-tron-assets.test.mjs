// @ts-nocheck
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { USDT_CONTRACT } from "../src/logic.mjs";
import { fetchTronWalletAssetsFromTronWeb } from "../src/wallet-tron-assets.mjs";

describe("wallet TRON assets", () => {
  it("reads TRX, TRC-10, and USDT through TronWeb instead of TronGrid", async () => {
    /** @type {any} */
    const tronWeb = {
      trx: {
        async getAccount() {
          return {
            balance: 1_500_000,
            assetV2: [{ key: "1002000", value: 25 }],
            trc20: [{ [USDT_CONTRACT]: "2500000" }],
          };
        },
        async getBalance() {
          return 1_500_000;
        },
        async getTokenFromID(_tokenId) {
          return { abbr: "BTT", name: "BitTorrent", precision: 6 };
        },
      },
      transactionBuilder: {
        async triggerConstantContract(contract, selector, _options, parameters, _owner) {
          if (selector === "balanceOf(address)" && contract === USDT_CONTRACT) {
            return { constant_result: ["000000000000000000000000000000000000000000000000000000000002625a0"] };
          }
          if (selector === "decimals()") return { constant_result: ["0000000000000000000000000000000000000000000000000000000000000006"] };
          if (selector === "symbol()") {
            return { constant_result: ["000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000045553445400000000000000000000000000000000000000000000000000000000"] };
          }
          if (selector === "name()") {
            return { constant_result: ["0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000a546574686572205553440000000000000000000000000000000000000000"] };
          }
          if (selector === "balanceOf(address)" && parameters?.length) {
            return { constant_result: ["000000000000000000000000000000000000000000000000000000000002625a0"] };
          }
          return { constant_result: ["0"] };
        },
      },
    };

    const assets = await fetchTronWalletAssetsFromTronWeb(tronWeb, "TJyMvDP37nLF4fsRoa9pScmQ6qwbA1DxY9");
    assert.equal(assets.ok, true);
    if (!assets.ok) return;
    assert.match(assets.trxDisplay, /1\.5 TRX/);
    assert.match(assets.usdtDisplay, /2\.5 USDT/);
    assert.ok(assets.tokens.some((token) => token.standard === "TRC10"));
    assert.ok(assets.tokens.some((token) => token.standard === "TRC20" && token.symbol === "USDT"));
    assert.equal(assets.tokens[0]?.standard, "TRX");
    assert.equal(assets.tokens[1]?.symbol, "USDT");
    assert.equal(assets.tokens[1]?.contract, USDT_CONTRACT);
  });

  it("still lists official USDT first when the balance is zero", async () => {
    /** @type {any} */
    const tronWeb = {
      trx: {
        async getAccount() {
          return { balance: 1_000_000 };
        },
        async getBalance() {
          return 1_000_000;
        },
      },
      transactionBuilder: {
        async triggerConstantContract() {
          return { constant_result: ["0"] };
        },
      },
    };
    const assets = await fetchTronWalletAssetsFromTronWeb(tronWeb, "TJyMvDP37nLF4fsRoa9pScmQ6qwbA1DxY9");
    assert.equal(assets.ok, true);
    if (!assets.ok) return;
    assert.equal(assets.tokens[0]?.standard, "TRX");
    assert.equal(assets.tokens[1]?.contract, USDT_CONTRACT);
    assert.match(assets.tokens[1]?.display || "", /0 USDT/);
  });
});
