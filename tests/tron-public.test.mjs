import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { USDT_CONTRACT } from "../src/logic.mjs";
import {
  buildWalletTokenList,
  extractTrc10BalancesFromAccountRow,
  extractTrc20BalancesFromAccountRow,
  extractTrc20StringFromTriggerPayload,
  extractTrxSunFromAccountPayload,
  extractUsdtUnitsFromTriggerPayload,
  fetchTronWalletAssets,
  formatTrxFromSun,
  formatUsdtFromUnits,
  pickUsdtFromTokenList,
} from "../src/tron-public.mjs";

describe("public TRON wallet assets", () => {
  it("reads TRX sun from account payloads, including inactive accounts", () => {
    assert.equal(extractTrxSunFromAccountPayload({ data: [] }), 0n);
    assert.equal(extractTrxSunFromAccountPayload({ data: [{ balance: 1500000 }] }), 1500000n);
  });

  it("parses TRC-20 and TRC-10 balances from account rows", () => {
    const row = {
      balance: 1000000,
      trc20: [{ [USDT_CONTRACT]: "2500000" }, { TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR: "10" }],
      assetV2: [{ key: "1002000", value: 5000000 }],
    };
    assert.deepEqual(extractTrc20BalancesFromAccountRow(row), [
      { contract: USDT_CONTRACT, units: 2500000n },
      { contract: "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR", units: 10n },
    ]);
    assert.deepEqual(extractTrc10BalancesFromAccountRow(row), [{ tokenId: "1002000", units: 5000000n }]);
  });

  it("reads USDT units from triggerconstantcontract results", () => {
    assert.equal(
      extractUsdtUnitsFromTriggerPayload({ constant_result: ["00000000000000000000000000000000000000000000000000000000000f4240"] }),
      1000000n,
    );
    assert.equal(extractUsdtUnitsFromTriggerPayload({ constant_result: ["00"] }), 0n);
  });

  it("decodes TRC-20 string results from triggerconstantcontract payloads", () => {
    assert.equal(
      extractTrc20StringFromTriggerPayload({
        constant_result: ["000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000045553445400000000000000000000000000000000000000000000000000000000"],
      }),
      "USDT",
    );
  });

  it("formats TRX and USDT for display", () => {
    assert.equal(formatTrxFromSun(2500000n), "2.5 TRX");
    assert.equal(formatUsdtFromUnits(1250000n), "1.25 USDT");
  });

  it("builds a token list with TRX first and picks USDT for legacy fields", () => {
    const trc20Meta = new Map([[USDT_CONTRACT, { symbol: "USDT", name: "Tether USD", decimals: 6 }]]);
    const trc10Meta = new Map([["1002000", { symbol: "BTTOLD", name: "BitTorrent Old", decimals: 6 }]]);
    const tokens = buildWalletTokenList(
      1000000n,
      [{ contract: USDT_CONTRACT, units: 2500000n }],
      [{ tokenId: "1002000", units: 5000000n }],
      trc20Meta,
      trc10Meta,
    );
    assert.equal(tokens[0].standard, "TRX");
    assert.equal(tokens.some((token) => token.symbol === "USDT"), true);
    assert.equal(tokens.some((token) => token.standard === "TRC10"), true);
    const usdt = pickUsdtFromTokenList(tokens);
    assert.equal(usdt.usdtDisplay, "2.5 USDT");
  });

  it("loads balances through the public TronGrid account and metadata endpoints", async () => {
    /** @type {Array<{ url: string, method: string }>} */
    const calls = [];
    const fetchImpl = /** @type {typeof fetch} */ (async (input, init = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, method: init.method || "GET" });
      if (url.endsWith("/v1/accounts/TJyMvDP37nLF4fsRoa9pScmQ6qwbA1DxY9")) {
        return new Response(JSON.stringify({
          data: [{
            balance: 1000000,
            trc20: [{ [USDT_CONTRACT]: "1000000" }],
            assetV2: [{ key: "1002000", value: 6000000 }],
          }],
        }), { status: 200 });
      }
      if (url.endsWith("/v1/assets/1002000")) {
        return new Response(JSON.stringify({
          data: [{ id: 1002000, abbr: "BTTOLD", name: "BitTorrent Old", precision: 6 }],
        }), { status: 200 });
      }
      if (url.endsWith("/wallet/triggerconstantcontract")) {
        const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
        if (body.function_selector === "decimals()") {
          return new Response(JSON.stringify({
            constant_result: ["0000000000000000000000000000000000000000000000000000000000000006"],
            result: { result: true },
          }), { status: 200 });
        }
        if (body.function_selector === "symbol()") {
          return new Response(JSON.stringify({
            constant_result: ["000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000045553445400000000000000000000000000000000000000000000000000000000"],
            result: { result: true },
          }), { status: 200 });
        }
        if (body.function_selector === "name()") {
          return new Response(JSON.stringify({
            constant_result: ["000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000045553445400000000000000000000000000000000000000000000000000000000"],
            result: { result: true },
          }), { status: 200 });
        }
      }
      return new Response("missing", { status: 404 });
    });
    const assets = await fetchTronWalletAssets("TJyMvDP37nLF4fsRoa9pScmQ6qwbA1DxY9", { fetch: fetchImpl });
    assert.equal(assets.ok, true);
    if (!assets.ok) return;
    assert.equal(assets.trxDisplay, "1 TRX");
    assert.equal(assets.usdtDisplay, "1 USDT");
    assert.ok(Array.isArray(assets.tokens));
    assert.equal(assets.tokens.length, 3);
    assert.match(calls.map((call) => call.url).join("\n"), /\/v1\/accounts\//);
    assert.match(calls.map((call) => call.url).join("\n"), /\/v1\/assets\/1002000/);
  });
});
