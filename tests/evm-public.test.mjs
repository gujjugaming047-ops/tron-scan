import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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

  it("normalizes empty payloads to a zero native line", () => {
    assert.deepEqual(normalizeEvmWalletAssetTokens(null), [{
      standard: "EVM",
      symbol: "ETH",
      name: "Ether",
      display: "0 ETH",
    }]);
  });

  it("loads native balance through JSON-RPC", async () => {
    const fetchImpl = /** @type {typeof fetch} */ (async (_input, init = {}) => {
      const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
      assert.equal(body.method, "eth_getBalance");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x0" }), { status: 200 });
    });
    const assets = await fetchEvmWalletAssets(
      "0x202a6b2499Cc63314E49dEfBb777a45aCBd0287c",
      "1",
      { fetch: fetchImpl, rpcUrl: "https://example.invalid" },
    );
    assert.equal(assets.ok, true);
    if (!assets.ok) return;
    assert.equal(assets.nativeDisplay, "0 ETH");
    assert.equal(assets.tokens[0].display, "0 ETH");
  });
});
