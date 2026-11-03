/**
 * Recent TRON activity via the connected wallet's TronWeb node — not TronGrid REST.
 */

import { isValidTronAddress } from "./logic.mjs";
import { formatFixedUnits, parseUInt256 } from "./tron-public.mjs";

/** @typedef {{ txid: string, when: string, direction: string, summary: string, token?: string }} WalletTransactionRow */

/**
 * @param {unknown} value
 */
function readTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const numeric = Number(value);
    return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  }
  return 0;
}

/**
 * @param {number} ms
 */
function formatWhen(ms) {
  if (!ms) return "Unknown time";
  try {
    return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "Unknown time";
  }
}

/**
 * @param {unknown} payload
 * @returns {unknown[]}
 */
function extractTransactionRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const record = /** @type {{ data?: unknown[], transactions?: unknown[] }} */ (payload);
    if (Array.isArray(record.data)) return record.data;
    if (Array.isArray(record.transactions)) return record.transactions;
  }
  return [];
}

/**
 * @param {unknown} entry
 * @param {string} walletAddress
 * @returns {WalletTransactionRow | null}
 */
function normalizeTronTransaction(entry, walletAddress) {
  if (!entry || typeof entry !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (entry);
  const raw = record.raw_data && typeof record.raw_data === "object"
    ? /** @type {Record<string, unknown>} */ (record.raw_data)
    : record;
  const contractList = Array.isArray(raw.contract) ? raw.contract : [];
  const first = contractList[0] && typeof contractList[0] === "object"
    ? /** @type {{ type?: unknown, parameter?: { value?: Record<string, unknown> } }} */ (contractList[0])
    : null;
  const value = first?.parameter?.value ?? {};
  const txid = typeof record.txID === "string"
    ? record.txID
    : typeof record.transaction_id === "string"
      ? record.transaction_id
      : typeof record.hash === "string"
        ? record.hash
        : "";
  if (!txid) return null;

  const whenMs = readTimestamp(record.block_timestamp ?? record.timestamp ?? raw.timestamp);
  const type = typeof first?.type === "string" ? first.type : "Unknown";
  let direction = "Activity";
  let summary = type.replace(/Contract/g, " contract").replace(/_/g, " ");
  let token = "";

  if (type === "TransferContract") {
    const owner = typeof value.owner_address === "string" ? value.owner_address : "";
    const to = typeof value.to_address === "string" ? value.to_address : "";
    const sun = parseUInt256(value.amount);
    const trx = formatFixedUnits(sun, 6, "TRX");
    if (owner && owner === walletAddress) direction = "Sent";
    else if (to && to === walletAddress) direction = "Received";
    else direction = "Transfer";
    summary = `${trx} TRX`;
    token = "TRX";
  } else if (type === "TriggerSmartContract") {
    direction = "Contract call";
    const contract = typeof value.contract_address === "string" ? value.contract_address : "";
    summary = contract ? `Smart contract ${contract.slice(0, 6)}…${contract.slice(-4)}` : "Smart contract interaction";
  }

  return {
    txid,
    when: formatWhen(whenMs),
    direction,
    summary,
    token,
  };
}

/**
 * @param {any} tronWeb
 * @param {string} address
 * @param {number} [limit]
 * @returns {Promise<{ ok: true, transactions: WalletTransactionRow[] } | { ok: false, error: string }>}
 */
export async function fetchTronRecentTransactionsFromTronWeb(tronWeb, address, limit = 12) {
  const trimmed = address.trim();
  if (!(await isValidTronAddress(trimmed))) {
    return { ok: false, error: "The TRON address is invalid." };
  }
  if (!tronWeb?.trx) {
    return { ok: false, error: "TronWeb is not available from your connected wallet." };
  }

  /** @type {unknown[]} */
  let rows = [];
  const trxApi = tronWeb.trx;
  try {
    if (typeof trxApi.getTransactionsRelated === "function") {
      rows = extractTransactionRows(await trxApi.getTransactionsRelated(trimmed, "all", limit, 0));
    }
  } catch {
    rows = [];
  }
  if (!rows.length && typeof trxApi.getTransactionsFromAddress === "function") {
    try {
      rows = extractTransactionRows(await trxApi.getTransactionsFromAddress(trimmed, limit));
    } catch {
      rows = [];
    }
  }

  const transactions = rows
    .map((entry) => normalizeTronTransaction(entry, trimmed))
    .filter((row) => row !== null)
    .slice(0, limit);

  return { ok: true, transactions };
}
