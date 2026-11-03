// @ts-nocheck
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchTronRecentTransactionsFromTronWeb } from "../src/wallet-tron-transactions.mjs";

describe("wallet TRON transactions", () => {
  it("reads recent activity through TronWeb instead of TronGrid REST", async () => {
    const tronWeb = {
      trx: {
        async getTransactionsRelated() {
          return {
            data: [{
              txID: "abc123",
              block_timestamp: 1_700_000_000_000,
              raw_data: {
                contract: [{
                  type: "TransferContract",
                  parameter: {
                    value: {
                      owner_address: "TJyMvDP37nLF4fsRoa9pScmQ6qwbA1DxY9",
                      to_address: "TRecipient123456789012345678901234",
                      amount: 2_000_000,
                    },
                  },
                }],
              },
            }],
          };
        },
      },
    };
    const result = await fetchTronRecentTransactionsFromTronWeb(tronWeb, "TJyMvDP37nLF4fsRoa9pScmQ6qwbA1DxY9");
    assert.equal(result.ok, true);
    assert.equal(result.transactions[0]?.txid, "abc123");
    assert.match(result.transactions[0]?.summary || "", /TRX/);
  });
});
