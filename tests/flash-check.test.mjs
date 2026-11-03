import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OFFICIAL_USDT_CONTRACT,
  classifyCheckInput,
  classifyToken,
  decodeAbiStringResult,
  extractTransactionTransfers,
  formatTokenAmount,
  normalizeTokenRow,
  parseTronGridTrc20Balances,
  parseTronGridTrc20History,
  summarizeAddressTokens,
  summarizeTransactionCheck,
} from "../src/flash-check.mjs";

describe("flash USDT check helpers", () => {
  it("classifies address and transaction inputs", async () => {
    const address = await classifyCheckInput("TG94XL9N1uVHPM4U4zcpYGc6w1i7nUBuiq");
    assert.equal(address.kind, "address");
    const txid = await classifyCheckInput("a".repeat(64));
    assert.equal(txid.kind, "txid");
    const bad = await classifyCheckInput("not-valid");
    assert.equal(bad.kind, "invalid");
  });

  it("marks official USDT as genuine and lookalikes as flash", () => {
    const genuine = classifyToken({
      contract: OFFICIAL_USDT_CONTRACT,
      symbol: "USDT",
      name: "Tether USD",
      balance: "1500000",
      decimals: 6,
    });
    assert.equal(genuine.status, "genuine");
    assert.equal(genuine.balanceText, "1.5");

    const flash = classifyToken({
      contract: "TXYZoaTyA8Q2dnkF8ZK9XpqDK6ka26Q17v",
      symbol: "USDT",
      name: "Flash USDT",
      balance: "999000000",
      decimals: 6,
    });
    assert.equal(flash.status, "flash");
  });

  it("summarizes address token sets", () => {
    const mixed = summarizeAddressTokens([
      {
        contract: OFFICIAL_USDT_CONTRACT,
        symbol: "USDT",
        name: "Tether USD",
        balance: "1000000",
        decimals: 6,
      },
      {
        contract: "TXYZoaTyA8Q2dnkF8ZK9XpqDK6ka26Q17v",
        symbol: "USDT",
        name: "Fake Tether",
        balance: "5000000",
        decimals: 6,
      },
    ]);
    assert.equal(mixed.verdict, "mixed");
    assert.equal(mixed.flash.length, 1);
    assert.equal(mixed.genuine.length, 1);
  });

  it("normalizes TronGrid rows, balances, history, and transfers", () => {
    const row = normalizeTokenRow({
      token_info: {
        address: OFFICIAL_USDT_CONTRACT,
        symbol: "USDT",
        name: "Tether USD",
        decimals: 6,
      },
      value: "2500000",
    });
    assert.ok(row);
    assert.equal(row.contract, OFFICIAL_USDT_CONTRACT);
    assert.equal(formatTokenAmount(row.balance, row.decimals), "2.5");

    const balances = parseTronGridTrc20Balances({
      data: [{ trc20: [{ [OFFICIAL_USDT_CONTRACT]: "1500000" }] }],
    });
    assert.equal(balances.length, 1);
    assert.equal(balances[0].balance, "1500000");

    const history = parseTronGridTrc20History({
      data: [
        {
          token_info: {
            address: "TXYZoaTyA8Q2dnkF8ZK9XpqDK6ka26Q17v",
            symbol: "USDT",
            name: "Flash USDT",
            decimals: 6,
          },
          value: "1000000",
        },
      ],
    });
    assert.equal(history.length, 1);

    const transfers = extractTransactionTransfers({
      data: [
        {
          contract_address: "TXYZoaTyA8Q2dnkF8ZK9XpqDK6ka26Q17v",
          token_info: {
            address: "TXYZoaTyA8Q2dnkF8ZK9XpqDK6ka26Q17v",
            symbol: "USDT",
            name: "Flash USDT",
            decimals: 6,
          },
          value: "1000000",
        },
      ],
    });
    const summary = summarizeTransactionCheck({ transfers });
    assert.equal(summary.verdict, "flash");
    assert.equal(decodeAbiStringResult(["000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000045553445400000000000000000000000000000000000000000000000000000000"]), "USDT");
  });
});
