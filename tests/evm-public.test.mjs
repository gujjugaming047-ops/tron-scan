import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEvmWalletTokenList,
  extractErc20BalancesFromBlockscoutPayload,
  extractWeiFromRpcResult,
  fetchEvmWalletAssets,
  formatNativeFromWei,
  looksLikeEvmAddress,
  normalizeEvmChainId,
  normalizeEvmWalletAssetTokens,
} from "../src/evm-public.mjs";

describe("public EVM wallet assets", () => {
  it("recognizes EVM addresses and chain ids", () => {
    assert.equal(looksLikeEvmAddress("0x202a6b2499Cc63314E49dEfBb777a45aCBd0287c"), true);
    assert.equal(looksLikeEvmAddress("TJyMvDP37nLF4fsRoa9pScmQ6qwbA1DxY9"), false);
    assert.equal(normalizeEvmChainId("0x1"), "1");
    assert.equal(normalizeEvmChainId("137"), "137");
  });

  it("formats wei into native units", () => {
    assert.equal(formatNativeFromWei(1500000000000000000n, 18, "ETH"), "1.5 ETH");
    assert.equal(formatNativeFromWei(0n, 18, "ETH"), "0 ETH");
  });

  it("reads eth_getBalance RPC payloads", () => {
    assert.equal(extractWeiFromRpcResult({ result: "0x0" }), 0n);
    assert.equal(extractWeiFromRpcResult({ result: "0xde0b6b3a7640000" }), 1000000000000000000n);
  });

  it("parses Blockscout ERC-20 token balances", () => {
    const balances = extractErc20BalancesFromBlockscoutPayload([
      {
        token: {
          address_hash: "0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72",
          decimals: "18",
          name: "Ethereum Name Service",
          symbol: "ENS",
          type: "ERC-20",
        },
        value: "1144036076063671431479",
      },
      {
        token: { address_hash: "0x0000000000000000000000000000000000000000", decimals: "18", symbol: "ZERO", type: "ERC-20" },
        value: "0",
      },
    ]);
    assert.equal(balances.length, 1);
    assert.equal(balances[0].symbol, "ENS");
    assert.equal(balances[0].units, 1144036076063671431479n);
  });

  it("builds a token list with native first and every ERC-20 balance", () => {
    const tokens = buildEvmWalletTokenList(
      1000000000000000000n,
      { symbol: "ETH", name: "Ether", decimals: 18 },
      [{ contract: "0xabc0000000000000000000000000000000000001", symbol: "USDT", name: "Tether USD", decimals: 6, units: 2500000n }],
    );
    assert.equal(tokens[0].standard, "EVM");
    assert.equal(tokens[0].display, "1 ETH");
    assert.equal(tokens.some((token) => token.standard === "ERC20" && token.symbol === "USDT"), true);
  });

  it("normalizes empty payloads to a zero native line", () => {
    assert.deepEqual(normalizeEvmWalletAssetTokens(null), [{
      standard: "EVM",
      symbol: "ETH",
      name: "Ether",
      display: "0 ETH",
    }]);
  });

  it("loads native and ERC-20 balances through public endpoints", async () => {
    const fetchImpl = /** @type {typeof fetch} */ (async (input, init = {}) => {
      const url = String(input);
      if (url.includes("token-balances")) {
        return new Response(JSON.stringify([
          {
            token: {
              address_hash: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
              decimals: "6",
              name: "USD Coin",
              symbol: "USDC",
              type: "ERC-20",
            },
            value: "5000000",
          },
        ]), { status: 200 });
      }
      const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
      assert.equal(body.method, "eth_getBalance");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xde0b6b3a7640000" }), { status: 200 });
    });
    const assets = await fetchEvmWalletAssets(
      "0x202a6b2499Cc63314E49dEfBb777a45aCBd0287c",
      "1",
      { fetch: fetchImpl, rpcUrl: "https://example.invalid", explorerUrl: "https://explorer.example" },
    );
    assert.equal(assets.ok, true);
    if (!assets.ok) return;
    assert.equal(assets.nativeDisplay, "1 ETH");
    assert.equal(assets.tokens.length, 2);
    assert.equal(assets.tokens[0].display, "1 ETH");
    assert.equal(assets.tokens[1].symbol, "USDC");
  });
});
