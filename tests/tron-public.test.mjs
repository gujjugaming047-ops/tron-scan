import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractTrxSunFromAccountPayload,
  extractUsdtUnitsFromTriggerPayload,
  fetchTronWalletAssets,
  formatTrxFromSun,
  formatUsdtFromUnits,
} from "../src/tron-public.mjs";

describe("public TRON wallet assets", () => {
  it("reads TRX sun from account payloads, including inactive accounts", () => {
    assert.equal(extractTrxSunFromAccountPayload({ data: [] }), 0n);
    assert.equal(extractTrxSunFromAccountPayload({ data: [{ balance: 1500000 }] }), 1500000n);
  });

  it("reads USDT units from triggerconstantcontract results", () => {
    assert.equal(
      extractUsdtUnitsFromTriggerPayload({ constant_result: ["00000000000000000000000000000000000000000000000000000000000f4240"] }),
      1000000n,
    );
    assert.equal(extractUsdtUnitsFromTriggerPayload({ constant_result: ["00"] }), 0n);
  });

  it("formats TRX and USDT for display", () => {
    assert.equal(formatTrxFromSun(2500000n), "2.5 TRX");
    assert.equal(formatUsdtFromUnits(1250000n), "1.25 USDT");
  });

  it("loads balances through the public TronGrid endpoints", async () => {
    const calls = [];
    const fetchImpl = /** @type {typeof fetch} */ (async (input, init = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, method: init.method || "GET" });
      if (url.endsWith("/v1/accounts/TJyMvDP37nLF4fsRoa9pScmQ6qwbA1DxY9")) {
        return new Response(JSON.stringify({ data: [{ balance: 1000000 }] }), { status: 200 });
      }
      if (url.endsWith("/wallet/triggerconstantcontract")) {
        return new Response(JSON.stringify({
          constant_result: ["00000000000000000000000000000000000000000000000000000000000f4240"],
          result: { result: true },
        }), { status: 200 });
      }
      return new Response("missing", { status: 404 });
    });
    const assets = await fetchTronWalletAssets("TJyMvDP37nLF4fsRoa9pScmQ6qwbA1DxY9", { fetch: fetchImpl });
    assert.equal(assets.ok, true);
    if (!assets.ok) return;
    assert.equal(assets.trxDisplay, "1 TRX");
    assert.equal(assets.usdtDisplay, "1 USDT");
    assert.equal(calls.length, 2);
  });
});
