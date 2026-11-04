import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  latestWalletConnections,
  publicTronSnapshotAssets,
} from "../src/wallet-snapshot.mjs";

describe("wallet snapshot recovery", () => {
  it("keeps only the newest record for repeated wallet connections", () => {
    const rows = latestWalletConnections([
      { address: "TWallet", connectedAt: "old", providerSnapshotAt: "old-snapshot" },
      { address: "0xAbC", connectedAt: "evm-old" },
      { address: "TWallet", connectedAt: "new", providerSnapshotAt: "new-snapshot" },
      { address: "0xabc", connectedAt: "evm-new" },
    ]);
    assert.deepEqual(rows, [
      { address: "TWallet", connectedAt: "new", providerSnapshotAt: "new-snapshot" },
      { address: "0xabc", connectedAt: "evm-new" },
    ]);
  });

  it("normalizes a successful read-only TRON balance fallback for publication", () => {
    const result = publicTronSnapshotAssets({
      ok: true,
      body: {
        assets: {
          trxDisplay: "1 TRX",
          usdtDisplay: "2 USDT",
          tokens: [{ symbol: "TRX", display: "1 TRX" }],
        },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.source, "public-tron-mainnet");
    assert.equal(result.usdtDisplay, "2 USDT");
  });

  it("fails with an actionable error when the fallback cannot load", () => {
    const result = publicTronSnapshotAssets({
      ok: false,
      body: { error: "Public TRON account data is unavailable." },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /unavailable/i);
  });
});
