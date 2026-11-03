import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainAssetListHtml, tokenSymbolAndAmount } from "../src/wallet-asset-display.mjs";

describe("wallet-asset-display", () => {
  it("splits symbol and exact amount for plain lists", () => {
    const parsed = tokenSymbolAndAmount({ symbol: "USDT", display: "12.345678 USDT", standard: "TRC20" });
    assert.equal(parsed.symbol, "USDT");
    assert.equal(parsed.amount, "12.345678");
  });

  it("renders visible plain list markup", () => {
    const html = plainAssetListHtml([
      { symbol: "TRX", display: "1.5 TRX", standard: "TRX" },
      { symbol: "USDT", display: "0.001 USDT", standard: "TRC20" },
    ]);
    assert.match(html, /wallet-asset-plain-list/);
    assert.match(html, /wallet-asset-symbol">TRX/);
    assert.match(html, /wallet-asset-amount">1\.5/);
  });
});
