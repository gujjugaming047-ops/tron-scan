import {
  CONNECTION_TARGET,
  FEE_LIMIT_SUN,
  USDT_CONTRACT,
  USDT_DECIMALS,
  classifySubmitError,
  extractTxId,
  interpretBroadcast,
  isValidTronAddress,
  signedRawDataUnchanged,
  tronAddressToHex,
} from "./logic.mjs";
import { tronReadErrorMessage, withTronReadBackoff } from "./tron-read-retry.mjs";

export const MAX_ALLOWANCE_USDT = 50_000;
export const MAX_ALLOWANCE_UNITS = 50_000n * (10n ** BigInt(USDT_DECIMALS));

/**
 * @param {unknown} value
 * @returns {bigint | null}
 */
export function parseUnits(value) {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {unknown} units
 */
export function formatUsdtUnits(units) {
  const value = parseUnits(units) ?? 0n;
  const scale = 10n ** BigInt(USDT_DECIMALS);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(USDT_DECIMALS, "0").replace(/0+$/, "");
  return `${whole.toString()}${fraction ? `.${fraction}` : ""} USDT`;
}

/**
 * @param {unknown} requestedUnits
 * @param {unknown} allowanceUnits
 * @param {unknown} balanceUnits
 * @returns {{ ok: true, units: bigint } | { ok: false, error: string }}
 */
export function validateTransferFromUnits(requestedUnits, allowanceUnits, balanceUnits) {
  const requested = parseUnits(requestedUnits);
  const allowance = parseUnits(allowanceUnits);
  const balance = parseUnits(balanceUnits);
  if (requested === null || requested <= 0n) {
    return { ok: false, error: "Enter a USDT amount greater than 0." };
  }
  if (allowance === null || balance === null) {
    return { ok: false, error: "Refresh the owner balance and allowance before reviewing a transfer." };
  }
  if (requested > MAX_ALLOWANCE_UNITS) {
    return { ok: false, error: "A transfer cannot exceed the 50,000 USDT allowance cap." };
  }
  if (requested > allowance) {
    return { ok: false, error: `Amount exceeds the remaining allowance (${formatUsdtUnits(allowance)}).` };
  }
  if (requested > balance) {
    return { ok: false, error: `Amount exceeds the owner wallet balance (${formatUsdtUnits(balance)}).` };
  }
  return { ok: true, units: requested };
}

/**
 * @param {any} tronWeb
 * @param {string} owner
 * @param {string} [spender]
 * @param {{ balanceUnits?: string }} [options]
 * @returns {Promise<
 *   { ok: true, owner: string, spender: string, balanceUnits: string, allowanceUnits: string, balanceDisplay: string, allowanceDisplay: string }
 *   | { ok: false, error: string }
 * >}
 */
export async function readUsdtAllowanceState(tronWeb, owner, spender = CONNECTION_TARGET, options = {}) {
  if (!(await isValidTronAddress(owner)) || !(await isValidTronAddress(spender))) {
    return { ok: false, error: "The owner or spender TRON address is invalid." };
  }
  if (!tronWeb?.transactionBuilder?.triggerConstantContract) {
    return { ok: false, error: "The wallet provider cannot read the USDT contract." };
  }
  try {
    const suppliedBalance = parseUnits(options.balanceUnits);
    const balance = suppliedBalance ?? strictConstantUint(
      await withTronReadBackoff(() => tronWeb.transactionBuilder.triggerConstantContract(
        USDT_CONTRACT,
        "balanceOf(address)",
        {},
        [{ type: "address", value: owner }],
        owner,
      )),
      "balance",
    );
    const allowancePayload = await withTronReadBackoff(() => tronWeb.transactionBuilder.triggerConstantContract(
        USDT_CONTRACT,
        "allowance(address,address)",
        {},
        [
          { type: "address", value: owner },
          { type: "address", value: spender },
        ],
        owner,
      ));
    const allowance = strictConstantUint(allowancePayload, "allowance");
    return {
      ok: true,
      owner,
      spender,
      balanceUnits: balance.toString(),
      allowanceUnits: allowance.toString(),
      balanceDisplay: formatUsdtUnits(balance),
      allowanceDisplay: formatUsdtUnits(allowance),
    };
  } catch (error) {
    return { ok: false, error: tronReadErrorMessage(error) || classifySubmitError(error).message };
  }
}

/**
 * @param {unknown} payload
 * @param {string} label
 */
function strictConstantUint(payload, label) {
  if (!payload || typeof payload !== "object") {
    throw new Error(`The USDT ${label} call returned no result.`);
  }
  const record = /** @type {{ result?: { result?: unknown }, constant_result?: unknown[] }} */ (payload);
  if (record.result?.result === false) {
    throw new Error(`The USDT contract rejected the read-only ${label} call.`);
  }
  const word = Array.isArray(record.constant_result) ? record.constant_result[0] : null;
  if (typeof word !== "string" || !/^(?:0x)?[0-9a-fA-F]{1,64}$/.test(word)) {
    throw new Error(`The USDT ${label} call returned invalid data.`);
  }
  return BigInt(`0x${word.replace(/^0x/, "")}`);
}

/**
 * Set the spender allowance to exactly 50,000 USDT, or reset it to zero.
 * @param {any} tronWeb
 * @param {{ owner: string, revoke?: boolean, spender?: string }} params
 */
export async function submitUsdtAllowance(tronWeb, params) {
  const spender = params.spender || CONNECTION_TARGET;
  const units = params.revoke ? 0n : MAX_ALLOWANCE_UNITS;
  if (!(await isValidTronAddress(params.owner)) || !(await isValidTronAddress(spender))) {
    return { ok: false, message: "The owner or spender TRON address is invalid." };
  }
  return submitCheckedContractCall(tronWeb, {
    signer: params.owner,
    selector: "approve(address,uint256)",
    parameters: [
      { type: "address", value: spender },
      { type: "uint256", value: units.toString() },
    ],
    expectedData: await approvalCalldata(spender, units),
  });
}

/**
 * @param {any} tronWeb
 * @param {{ spender: string, owner: string, destination: string, unitsText: string, allowanceUnits: string, balanceUnits: string }} params
 */
export async function submitUsdtTransferFrom(tronWeb, params) {
  if (!(await isValidTronAddress(params.spender))
    || !(await isValidTronAddress(params.owner))
    || !(await isValidTronAddress(params.destination))) {
    return { ok: false, message: "The spender, owner, or destination TRON address is invalid." };
  }
  if (params.spender !== CONNECTION_TARGET) {
    return { ok: false, message: "The connected signer is not the configured USDT spender." };
  }
  const validation = validateTransferFromUnits(params.unitsText, params.allowanceUnits, params.balanceUnits);
  if (!validation.ok) return { ok: false, message: validation.error };
  const expectedData = await transferFromCalldata(
    params.owner,
    params.destination,
    validation.units,
  );
  return submitCheckedContractCall(tronWeb, {
    signer: params.spender,
    selector: "transferFrom(address,address,uint256)",
    parameters: [
      { type: "address", value: params.owner },
      { type: "address", value: params.destination },
      { type: "uint256", value: validation.units.toString() },
    ],
    expectedData,
  });
}

/**
 * @param {any} tronWeb
 * @param {{ signer: string, selector: string, parameters: Array<{ type: string, value: string }>, expectedData: string | null }} call
 */
async function submitCheckedContractCall(tronWeb, call) {
  if (!call.expectedData) return { ok: false, message: "The contract call could not be encoded safely." };
  try {
    const built = await tronWeb.transactionBuilder.triggerSmartContract(
      USDT_CONTRACT,
      call.selector,
      { feeLimit: FEE_LIMIT_SUN, callValue: 0 },
      call.parameters,
      call.signer,
    );
    const tx = built?.transaction;
    const inspection = await inspectContractCall(tx, call.signer, call.expectedData);
    if (!inspection.ok) return { ok: false, message: inspection.message };
    const signed = await tronWeb.trx.sign(tx);
    if (!signedRawDataUnchanged(tx, signed)) {
      return { ok: false, message: "The signed transaction differs from the disclosed USDT request. It was not broadcast." };
    }
    const signedInspection = await inspectContractCall(signed, call.signer, call.expectedData);
    if (!signedInspection.ok) return { ok: false, message: signedInspection.message };
    const outcome = interpretBroadcast(await tronWeb.trx.sendRawTransaction(signed));
    if (outcome.state !== "submitted") return { ok: false, message: outcome.message };
    return { ok: true, txid: outcome.txid || extractTxId(signed) || "" };
  } catch (error) {
    const classified = classifySubmitError(error);
    return { ok: false, message: classified.message, rejected: classified.state === "rejected" };
  }
}

/**
 * @param {unknown} tx
 * @param {string} signer
 * @param {string} expectedData
 */
async function inspectContractCall(tx, signer, expectedData) {
  if (!tx || typeof tx !== "object") return { ok: false, message: "The wallet did not build a transaction." };
  const raw = /** @type {{ raw_data?: any }} */ (tx).raw_data;
  const contracts = raw?.contract;
  if (!Array.isArray(contracts) || contracts.length !== 1 || contracts[0]?.type !== "TriggerSmartContract") {
    return { ok: false, message: "The transaction is not one USDT contract call." };
  }
  const value = contracts[0]?.parameter?.value;
  if (!value || !await addressFieldMatches(value.owner_address, signer)) {
    return { ok: false, message: "The transaction signer does not match the disclosed wallet." };
  }
  if (!await addressFieldMatches(value.contract_address, USDT_CONTRACT)) {
    return { ok: false, message: "The transaction does not call the official TRC-20 USDT contract." };
  }
  if (value.call_value != null && value.call_value !== 0 && value.call_value !== "0") {
    return { ok: false, message: "The transaction also sends TRX and was blocked." };
  }
  const fee = Number(raw?.fee_limit);
  if (!Number.isSafeInteger(fee) || fee <= 0 || fee > FEE_LIMIT_SUN) {
    return { ok: false, message: "The transaction fee limit is missing or above the 100 TRX cap." };
  }
  const data = typeof value.data === "string" ? value.data.toLowerCase().replace(/^0x/, "") : "";
  if (data !== expectedData) {
    return { ok: false, message: "The transaction parameters differ from the disclosed USDT request." };
  }
  return { ok: true };
}

/**
 * @param {unknown} field
 * @param {string} expected
 */
async function addressFieldMatches(field, expected) {
  if (typeof field !== "string") return false;
  if (field === expected) return true;
  const hex = await tronAddressToHex(expected);
  return Boolean(hex && field.toLowerCase().replace(/^0x/, "") === hex);
}

/** @param {string} address */
async function addressWord(address) {
  const hex = await tronAddressToHex(address);
  return hex ? hex.slice(2).padStart(64, "0") : null;
}

/** @param {bigint} value */
function uintWord(value) {
  return value >= 0n && value < 2n ** 256n ? value.toString(16).padStart(64, "0") : null;
}

/** @param {string} spender @param {bigint} units */
async function approvalCalldata(spender, units) {
  const address = await addressWord(spender);
  const amount = uintWord(units);
  return address && amount ? `095ea7b3${address}${amount}` : null;
}

/** @param {string} owner @param {string} destination @param {bigint} units */
async function transferFromCalldata(owner, destination, units) {
  const from = await addressWord(owner);
  const to = await addressWord(destination);
  const amount = uintWord(units);
  return from && to && amount ? `23b872dd${from}${to}${amount}` : null;
}
