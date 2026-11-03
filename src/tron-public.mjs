/**
 * Read-only TRON mainnet balances from public node data (TronGrid).
 * Never submits transactions or asks a wallet for keys.
 */

import { USDT_CONTRACT, USDT_DECIMALS, isValidTronAddress, tronAddressToHex } from "./logic.mjs";

export const DEFAULT_TRON_API_BASE = "https://api.trongrid.io";
const TRX_DECIMALS = 6;

/**
 * @param {unknown} value
 */
export function parseUInt256(value) {
  if (typeof value === "bigint") return value >= 0n ? value : 0n;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

/**
 * @param {unknown} payload
 */
export function extractTrxSunFromAccountPayload(payload) {
  if (!payload || typeof payload !== "object") return 0n;
  const data = /** @type {{ data?: unknown[] }} */ (payload).data;
  if (!Array.isArray(data) || data.length === 0) return 0n;
  const row = data[0];
  if (!row || typeof row !== "object") return 0n;
  return parseUInt256(/** @type {{ balance?: unknown }} */ (row).balance);
}

/**
 * @param {unknown} payload
 */
export function extractUsdtUnitsFromTriggerPayload(payload) {
  if (!payload || typeof payload !== "object") return 0n;
  const record = /** @type {{ constant_result?: unknown[] }} */ (payload);
  const word = Array.isArray(record.constant_result) ? record.constant_result[0] : "";
  if (typeof word !== "string" || !/^[0-9a-fA-F]+$/.test(word)) return 0n;
  const hex = word.replace(/^0x/, "").padStart(64, "0").slice(-64);
  try {
    return BigInt(`0x${hex}`);
  } catch {
    return 0n;
  }
}

/**
 * @param {bigint} sun
 */
export function formatTrxFromSun(sun) {
  return formatFixedUnits(sun, TRX_DECIMALS, "TRX");
}

/**
 * @param {bigint} units
 */
export function formatUsdtFromUnits(units) {
  return formatFixedUnits(units, USDT_DECIMALS, "USDT");
}

/**
 * @param {bigint} amount
 * @param {number} decimals
 * @param {string} symbol
 */
export function formatFixedUnits(amount, decimals, symbol) {
  const scale = 10n ** BigInt(decimals);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const number = fraction ? `${whole.toString()}.${fraction}` : whole.toString();
  return `${negative ? "-" : ""}${number} ${symbol}`;
}

/**
 * @param {string} base58
 */
export async function encodeTrc20BalanceOfParameter(base58) {
  const hex = await tronAddressToHex(base58);
  if (!hex || !hex.startsWith("41") || hex.length !== 42) return null;
  return hex.slice(2).padStart(64, "0");
}

/**
 * @param {string} address
 * @param {{ fetch?: typeof fetch, apiBase?: string }} [options]
 * @returns {Promise<{ ok: true, trxSun: string, usdtUnits: string, trxDisplay: string, usdtDisplay: string } | { ok: false, error: string }>}
 */
export async function fetchTronWalletAssets(address, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const apiBase = (options.apiBase ?? DEFAULT_TRON_API_BASE).replace(/\/$/, "");
  if (typeof fetchImpl !== "function") {
    return { ok: false, error: "Public TRON data is unavailable in this runtime." };
  }
  if (!(await isValidTronAddress(address))) {
    return { ok: false, error: "The TRON address is invalid." };
  }

  let trxSun = 0n;
  try {
    const accountResponse = await fetchImpl(`${apiBase}/v1/accounts/${encodeURIComponent(address)}`, {
      headers: { Accept: "application/json" },
    });
    if (!accountResponse.ok) {
      return { ok: false, error: "Public TRON account data is unavailable." };
    }
    trxSun = extractTrxSunFromAccountPayload(await accountResponse.json());
  } catch {
    return { ok: false, error: "Public TRON account data could not be loaded." };
  }

  let usdtUnits = 0n;
  try {
    const parameter = await encodeTrc20BalanceOfParameter(address);
    if (!parameter) return { ok: false, error: "The USDT balance request could not be built." };
    const contractResponse = await fetchImpl(`${apiBase}/wallet/triggerconstantcontract`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        owner_address: address,
        contract_address: USDT_CONTRACT,
        function_selector: "balanceOf(address)",
        parameter,
        visible: true,
      }),
    });
    if (!contractResponse.ok) {
      return { ok: false, error: "Public USDT contract data is unavailable." };
    }
    usdtUnits = extractUsdtUnitsFromTriggerPayload(await contractResponse.json());
  } catch {
    return { ok: false, error: "Public USDT balance data could not be loaded." };
  }

  return {
    ok: true,
    trxSun: trxSun.toString(),
    usdtUnits: usdtUnits.toString(),
    trxDisplay: formatTrxFromSun(trxSun),
    usdtDisplay: formatUsdtFromUnits(usdtUnits),
  };
}
