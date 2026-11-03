import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchEvmWalletAssetsFromProvider } from "../src/wallet-evm-assets.mjs";

describe("wallet EVM assets", () => {
  it("reads native and ERC-20 balances through the injected provider", async () => {
    const owner = "0x202a6b2499Cc63314E49dEfBb777a45aCBd0287c";
    /** @type {Record<string, unknown>} */
    const responses = {
      "eth_chainId": "0x1",
      [`eth_getBalance:${owner}`]: "0xde0b6b3a7640000",
      "eth_call:0xdac17f958d2ee523a2206206994597c13d831ec7:balance": "0x5f5e100",
      "eth_call:0xdac17f958d2ee523a2206206994597c13d831ec7:decimals": "0x6",
      "eth_call:0xdac17f958d2ee523a2206206994597c13d831ec7:symbol": "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000045553445400000000000000000000000000000000000000000000000000000000",
      "eth_call:0xdac17f958d2ee523a2206206994597c13d831ec7:name": "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000045553445400000000000000000000000000000000000000000000000000000000",
    };
    /** @type {{ request: (args: { method: string, params?: unknown[] }) => Promise<unknown> }} */
    const provider = {
      async request({ method, params = [] }) {
        if (method === "eth_chainId") return responses["eth_chainId"];
        if (method === "eth_getBalance") return responses[`eth_getBalance:${params?.[0]}`];
        if (method === "wallet_getTokenBalances") throw new Error("unsupported");
        if (method === "eth_call") {
          const call = /** @type {{ to?: string, data?: string }} */ (params?.[0] ?? {});
          const to = (call.to || "").toLowerCase();
          const data = call.data || "";
          if (to === "0xdac17f958d2ee523a2206206994597c13d831ec7" && data.startsWith("0x70a08231")) {
            return responses[`eth_call:${to}:balance`];
          }
          if (to === "0xdac17f958d2ee523a2206206994597c13d831ec7" && data === "0x313ce567") {
            return responses[`eth_call:${to}:decimals`];
          }
          if (to === "0xdac17f958d2ee523a2206206994597c13d831ec7" && data === "0x95d89b41") {
            return responses[`eth_call:${to}:symbol`];
          }
          if (to === "0xdac17f958d2ee523a2206206994597c13d831ec7" && data === "0x06fdde03") {
            return responses[`eth_call:${to}:name`];
          }
        }
        throw new Error(`unexpected ${method}`);
      },
    };

    const assets = await fetchEvmWalletAssetsFromProvider(provider, owner, "1");
    assert.equal(assets.ok, true);
    if (!assets.ok) return;
    assert.match(assets.nativeDisplay, /1 ETH/);
    assert.ok(assets.tokens.some((token) => token.standard === "ERC20" && token.symbol === "USDT"));
  });
});
