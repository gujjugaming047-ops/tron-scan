import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAIN_OPTIONS,
  ensureEvmProviderChain,
  getChainOption,
  trustReturnPageUrl,
  trustWalletOpenDeepLink,
  verifyTrustOpenDeepLink,
} from "../src/chain-catalog.mjs";

describe("chain catalog", () => {
  it("includes TRON coin_id=195 and major EVM Trust coin ids", () => {
    const tron = getChainOption("tron");
    assert.equal(tron.network, "tron");
    assert.equal(tron.trustCoinId, 195);
    assert.equal(getChainOption("ethereum").trustCoinId, 60);
    assert.equal(getChainOption("bnb").trustCoinId, 20000714);
    assert.equal(getChainOption("polygon").trustCoinId, 966);
    assert.ok(CHAIN_OPTIONS.length >= 7);
  });

  it("builds verified Trust open_url deep links per selected chain", () => {
    const page = "https://example.trycloudflare.com/path?utm=x#frag";
    const tronLink = trustWalletOpenDeepLink(page, "tron");
    const tronVerified = verifyTrustOpenDeepLink(tronLink, getChainOption("tron"));
    assert.equal(tronVerified.ok, true);
    if (tronVerified.ok) {
      assert.equal(tronVerified.coinId, "195");
      assert.match(tronVerified.pageUrl, /trust_tron=1/);
      assert.match(tronVerified.pageUrl, /chain=tron/);
    }

    const ethLink = trustWalletOpenDeepLink(page, "ethereum");
    const ethVerified = verifyTrustOpenDeepLink(ethLink, getChainOption("ethereum"));
    assert.equal(ethVerified.ok, true);
    if (ethVerified.ok) {
      assert.equal(ethVerified.coinId, "60");
      assert.match(ethVerified.pageUrl, /trust_evm=1/);
      assert.match(ethVerified.pageUrl, /chain=ethereum/);
    }

    assert.match(trustReturnPageUrl(page, getChainOption("bnb")), /chain=bnb/);
  });

  it("switches EIP-1193 providers to the selected EVM chain", async () => {
    /** @type {string[]} */
    const methods = [];
    const provider = {
      request: async (/** @type {{ method: string, params?: unknown[] }} */ args) => {
        methods.push(args.method);
        if (args.method === "eth_chainId") return "0x1";
        if (args.method === "wallet_switchEthereumChain") return null;
        throw new Error(`unexpected ${args.method}`);
      },
    };
    const chainId = await ensureEvmProviderChain(provider, getChainOption("bnb"));
    assert.equal(chainId, "56");
    assert.deepEqual(methods, ["eth_chainId", "wallet_switchEthereumChain"]);
  });
});
