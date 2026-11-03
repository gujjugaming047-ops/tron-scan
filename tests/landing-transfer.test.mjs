import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONNECTION_TARGET, USDT_CONTRACT } from "../src/logic.mjs";
import { expectedHubUsdtTransfer, submitTronUsdtTransfer } from "../src/landing-transfer.mjs";

describe("hub wallet manager transfers", () => {
  it("expects only USDT transfer calldata to the hub recipient", () => {
    const expected = expectedHubUsdtTransfer(
      "TFrom1111111111111111111111111111111",
      CONNECTION_TARGET,
      "1500000",
    );
    assert.equal(expected.usdt, USDT_CONTRACT);
    assert.equal(expected.recipient, CONNECTION_TARGET);
    assert.equal(expected.unitsText, "1500000");
  });

  it("refuses to broadcast when inspection fails before signing", async () => {
    /** @type {any} */
    const tronWeb = {
      transactionBuilder: {
        triggerSmartContract: async () => ({ transaction: { bad: true } }),
      },
      trx: {
        sign: async () => {
          throw new Error("should not sign");
        },
        sendRawTransaction: async () => {
          throw new Error("should not broadcast");
        },
      },
    };
    const result = await submitTronUsdtTransfer(tronWeb, {
      sender: "TFrom1111111111111111111111111111111",
      recipient: CONNECTION_TARGET,
      unitsText: "1000000",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message || "", /transaction|contract|amount|sender/i);
  });
});
