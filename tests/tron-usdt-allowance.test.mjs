// @ts-nocheck
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONNECTION_TARGET,
  RECIPIENT,
  USDT_CONTRACT,
  tronAddressToHex,
} from "../src/logic.mjs";
import {
  MAX_ALLOWANCE_UNITS,
  formatUsdtUnits,
  readUsdtAllowanceState,
  submitUsdtAllowance,
  submitUsdtTransferFrom,
  validateTransferFromUnits,
} from "../src/tron-usdt-allowance.mjs";

const OWNER = CONNECTION_TARGET;
const DESTINATION = RECIPIENT;
const TXID = "ab".repeat(32);

describe("transparent TRON USDT allowance flow", () => {
  it("uses the fixed 50,000 USDT cap and validates balance plus allowance", () => {
    assert.equal(MAX_ALLOWANCE_UNITS, 50_000_000_000n);
    assert.equal(formatUsdtUnits(MAX_ALLOWANCE_UNITS), "50000 USDT");
    assert.equal(validateTransferFromUnits("1000000", "1000000", "2000000").ok, true);
    assert.match(validateTransferFromUnits("1000001", "1000000", "2000000").error, /allowance/i);
    assert.match(validateTransferFromUnits("2000001", "3000000", "2000000").error, /balance/i);
    assert.match(
      validateTransferFromUnits((MAX_ALLOWANCE_UNITS + 1n).toString(), (MAX_ALLOWANCE_UNITS + 1n).toString(), (MAX_ALLOWANCE_UNITS + 1n).toString()).error,
      /50,000/,
    );
  });

  it("reads owner balance and allowance from the official contract", async () => {
    const calls = [];
    const tronWeb = {
      transactionBuilder: {
        async triggerConstantContract(contract, selector, _options, parameters) {
          calls.push({ contract, selector, parameters });
          const units = selector.startsWith("balanceOf") ? 12_000_000n : 7_000_000n;
          return { constant_result: [units.toString(16).padStart(64, "0")] };
        },
      },
    };
    const result = await readUsdtAllowanceState(tronWeb, OWNER, CONNECTION_TARGET);
    assert.equal(result.ok, true);
    assert.deepEqual(calls.map((call) => call.selector), ["balanceOf(address)", "allowance(address,address)"]);
    assert.ok(calls.every((call) => call.contract === USDT_CONTRACT));
    assert.equal(result.balanceDisplay, "12 USDT");
    assert.equal(result.allowanceDisplay, "7 USDT");
  });

  it("fails closed when a contract read has no uint256 result", async () => {
    const result = await readUsdtAllowanceState({
      transactionBuilder: {
        async triggerConstantContract() {
          return { result: { result: false }, constant_result: [] };
        },
      },
    }, OWNER, CONNECTION_TARGET);
    assert.equal(result.ok, false);
    assert.match(result.error, /rejected|invalid|result/i);
  });

  it("reuses an already-read balance instead of issuing a duplicate contract call", async () => {
    const selectors = [];
    const result = await readUsdtAllowanceState({
      transactionBuilder: {
        async triggerConstantContract(_contract, selector) {
          selectors.push(selector);
          return { constant_result: ["1".padStart(64, "0")] };
        },
      },
    }, OWNER, CONNECTION_TARGET, { balanceUnits: "2000000" });
    assert.equal(result.ok, true);
    assert.deepEqual(selectors, ["allowance(address,address)"]);
    assert.equal(result.balanceDisplay, "2 USDT");
  });

  it("builds a separate exact-cap approval and a zero-value revoke", async () => {
    const approval = await runCapturedSubmission((tronWeb) => submitUsdtAllowance(tronWeb, { owner: OWNER }));
    assert.equal(approval.result.ok, true);
    assert.equal(approval.call.selector, "approve(address,uint256)");
    assert.equal(approval.call.parameters[1].value, MAX_ALLOWANCE_UNITS.toString());

    const revoke = await runCapturedSubmission((tronWeb) => submitUsdtAllowance(tronWeb, { owner: OWNER, revoke: true }));
    assert.equal(revoke.result.ok, true);
    assert.equal(revoke.call.selector, "approve(address,uint256)");
    assert.equal(revoke.call.parameters[1].value, "0");
  });

  it("submits transferFrom only as the configured spender and within fresh limits", async () => {
    const captured = await runCapturedSubmission((tronWeb) => submitUsdtTransferFrom(tronWeb, {
      spender: CONNECTION_TARGET,
      owner: OWNER,
      destination: DESTINATION,
      unitsText: "2500000",
      allowanceUnits: "3000000",
      balanceUnits: "4000000",
    }));
    assert.equal(captured.result.ok, true);
    assert.equal(captured.call.selector, "transferFrom(address,address,uint256)");
    assert.deepEqual(captured.call.parameters.map((parameter) => parameter.value), [OWNER, DESTINATION, "2500000"]);

    const blocked = await submitUsdtTransferFrom({}, {
      spender: DESTINATION,
      owner: OWNER,
      destination: DESTINATION,
      unitsText: "1",
      allowanceUnits: "1",
      balanceUnits: "1",
    });
    assert.equal(blocked.ok, false);
    assert.match(blocked.message, /configured.*spender/i);
  });
});

async function runCapturedSubmission(submit) {
  let call;
  const signerHex = await tronAddressToHex(OWNER);
  const contractHex = await tronAddressToHex(USDT_CONTRACT);
  const tronWeb = {
    transactionBuilder: {
      async triggerSmartContract(contract, selector, options, parameters, signer) {
        call = { contract, selector, options, parameters, signer };
        const data = await calldata(selector, parameters);
        return {
          transaction: {
            raw_data_hex: "1234",
            raw_data: {
              fee_limit: 100_000_000,
              contract: [{
                type: "TriggerSmartContract",
                parameter: {
                  value: {
                    owner_address: signerHex,
                    contract_address: contractHex,
                    call_value: 0,
                    data,
                  },
                },
              }],
            },
          },
        };
      },
    },
    trx: {
      async sign(tx) {
        return { ...tx, signature: ["signed"] };
      },
      async sendRawTransaction() {
        return { result: true, txid: TXID };
      },
    },
  };
  const result = await submit(tronWeb);
  return { result, call };
}

async function calldata(selector, parameters) {
  const selectorHex = selector.startsWith("approve") ? "095ea7b3" : "23b872dd";
  const words = [];
  for (const parameter of parameters) {
    if (parameter.type === "address") {
      const hex = await tronAddressToHex(parameter.value);
      words.push(hex.slice(2).padStart(64, "0"));
    } else {
      words.push(BigInt(parameter.value).toString(16).padStart(64, "0"));
    }
  }
  return selectorHex + words.join("");
}
