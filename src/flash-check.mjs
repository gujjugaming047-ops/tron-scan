/**
 * Pure helpers for the Flash USDT check page.
 * No wallet calls and no network I/O.
 */

import { USDT_CONTRACT, USDT_DECIMALS, isValidTronAddress } from "./logic.mjs";

export const OFFICIAL_USDT_CONTRACT = USDT_CONTRACT;
export const OFFICIAL_USDT_DECIMALS = USDT_DECIMALS;
export const OFFICIAL_USDT_SYMBOL = "USDT";

const USDT_LIKE = /^(usd[t₮]|tether|usdt\.|f-?usdt|flash[\s_-]*usdt|usdt[\s_-]*flash)$/i;
const FLASH_HINT = /\bflash\b/i;
const TXID = /^[0-9a-fA-F]{64}$/;

/**
 * @param {unknown} text
 * @returns {Promise<{ kind: "address", value: string } | { kind: "txid", value: string } | { kind: "invalid", error: string }>}
 */
export async function classifyCheckInput(text) {
  if (typeof text !== "string") {
    return { kind: "invalid", error: "Enter a TRON address or a 64-character transaction id." };
  }
  const value = text.trim();
  if (!value) {
    return { kind: "invalid", error: "Enter a TRON address or a 64-character transaction id." };
  }
  if (/\s/.test(value)) {
    return { kind: "invalid", error: "Remove spaces from the address or transaction id." };
  }
  if (TXID.test(value)) {
    return { kind: "txid", value: value.toLowerCase() };
  }
  if (await isValidTronAddress(value)) {
    return { kind: "address", value };
  }
  return {
    kind: "invalid",
    error: "That value is not a valid TRON address or transaction id.",
  };
}

/**
 * @param {unknown} symbol
 * @param {unknown} name
 */
export function looksLikeUsdtToken(symbol, name) {
  const symbolText = cleanLabel(symbol);
  const nameText = cleanLabel(name);
  if (!symbolText && !nameText) return false;
  if (symbolText && USDT_LIKE.test(symbolText.replace(/\s+/g, ""))) return true;
  if (nameText && USDT_LIKE.test(nameText.replace(/\s+/g, ""))) return true;
  if (symbolText === "USDT" || symbolText === "USD₮") return true;
  if (/tether/i.test(nameText) && /usd/i.test(nameText)) return true;
  return false;
}

/**
 * @param {unknown} symbol
 * @param {unknown} name
 */
export function looksLikeFlashLabel(symbol, name) {
  return FLASH_HINT.test(cleanLabel(symbol)) || FLASH_HINT.test(cleanLabel(name));
}

/**
 * @param {{
 *   contract?: unknown,
 *   symbol?: unknown,
 *   name?: unknown,
 *   balance?: unknown,
 *   decimals?: unknown,
 * }} token
 * @returns {{
 *   status: "genuine" | "flash" | "other",
 *   contract: string,
 *   symbol: string,
 *   name: string,
 *   balanceText: string,
 *   reason: string,
 * }}
 */
export function classifyToken(token) {
  const contract = typeof token?.contract === "string" ? token.contract.trim() : "";
  const symbol = cleanLabel(token?.symbol) || "—";
  const name = cleanLabel(token?.name) || "—";
  const decimals = readDecimals(token?.decimals);
  const balanceText = formatTokenAmount(token?.balance, decimals);
  const usdtLike = looksLikeUsdtToken(symbol, name);
  const flashLabel = looksLikeFlashLabel(symbol, name);
  const official = contract === OFFICIAL_USDT_CONTRACT;

  if (official) {
    return {
      status: "genuine",
      contract,
      symbol: symbol === "—" ? OFFICIAL_USDT_SYMBOL : symbol,
      name: name === "—" ? "Tether USD" : name,
      balanceText,
      reason: "Matches the official TRON USDT contract.",
    };
  }
  if (usdtLike || flashLabel) {
    return {
      status: "flash",
      contract: contract || "unknown",
      symbol,
      name,
      balanceText,
      reason: flashLabel
        ? "Label mentions Flash and is not the official USDT contract."
        : "USDT-like token on a contract that is not official Tether USDT.",
    };
  }
  return {
    status: "other",
    contract: contract || "unknown",
    symbol,
    name,
    balanceText,
    reason: "Not treated as a USDT lookalike.",
  };
}

/**
 * @param {readonly unknown[]} tokens
 */
export function summarizeAddressTokens(tokens) {
  const list = Array.isArray(tokens) ? tokens : [];
  /** @type {ReturnType<typeof classifyToken>[]} */
  const classified = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    classified.push(classifyToken(/** @type {any} */ (item)));
  }
  const genuine = classified.filter((item) => item.status === "genuine");
  const flash = classified.filter((item) => item.status === "flash");
  const other = classified.filter((item) => item.status === "other");

  if (flash.length > 0 && genuine.length > 0) {
    return {
      verdict: /** @type {const} */ ("mixed"),
      headline: "Mixed: official USDT and Flash-like tokens",
      detail: "This address holds official USDT and at least one USDT lookalike on another contract. Treat lookalikes as Flash risk.",
      genuine,
      flash,
      other,
    };
  }
  if (flash.length > 0) {
    return {
      verdict: /** @type {const} */ ("flash"),
      headline: "Likely Flash USDT detected",
      detail: "One or more USDT-like tokens use a contract that is not official Tether USDT on TRON.",
      genuine,
      flash,
      other,
    };
  }
  if (genuine.length > 0) {
    return {
      verdict: /** @type {const} */ ("genuine"),
      headline: "Official USDT only",
      detail: "USDT-like holdings on this address match the official TRON USDT contract.",
      genuine,
      flash,
      other,
    };
  }
  return {
    verdict: /** @type {const} */ ("none"),
    headline: "No USDT-like tokens found",
    detail: "No official USDT or USDT lookalike balances were returned for this address.",
    genuine,
    flash,
    other,
  };
}

/**
 * @param {{
 *   contract?: unknown,
 *   symbol?: unknown,
 *   name?: unknown,
 *   transfers?: readonly unknown[],
 * }} input
 */
export function summarizeTransactionCheck(input) {
  const transfers = Array.isArray(input?.transfers) ? input.transfers : [];
  /** @type {ReturnType<typeof classifyToken>[]} */
  const classified = [];
  if (transfers.length > 0) {
    for (const item of transfers) {
      if (!item || typeof item !== "object") continue;
      classified.push(classifyToken(/** @type {any} */ (item)));
    }
  } else {
    classified.push(classifyToken({
      contract: input?.contract,
      symbol: input?.symbol,
      name: input?.name,
      balance: null,
      decimals: OFFICIAL_USDT_DECIMALS,
    }));
  }

  const genuine = classified.filter((item) => item.status === "genuine");
  const flash = classified.filter((item) => item.status === "flash");
  const other = classified.filter((item) => item.status === "other");
  const relevant = [...genuine, ...flash];

  if (flash.length > 0 && genuine.length === 0) {
    return {
      verdict: /** @type {const} */ ("flash"),
      headline: "Transaction looks like Flash USDT",
      detail: "Token activity points at a USDT lookalike contract, not official Tether USDT.",
      genuine,
      flash,
      other,
      relevant,
    };
  }
  if (flash.length > 0) {
    return {
      verdict: /** @type {const} */ ("mixed"),
      headline: "Transaction mixes official and lookalike USDT",
      detail: "This transaction involves both the official USDT contract and at least one lookalike.",
      genuine,
      flash,
      other,
      relevant,
    };
  }
  if (genuine.length > 0) {
    return {
      verdict: /** @type {const} */ ("genuine"),
      headline: "Official USDT transaction",
      detail: "Token activity matches the official TRON USDT contract.",
      genuine,
      flash,
      other,
      relevant,
    };
  }
  return {
    verdict: /** @type {const} */ ("none"),
    headline: "No USDT-like activity found",
    detail: "This transaction did not show official USDT or a USDT lookalike transfer.",
    genuine,
    flash,
    other,
    relevant,
  };
}

/**
 * Normalize explorer / wallet style token rows into the classifier shape.
 * @param {unknown} row
 * @returns {{ contract: string, symbol: string, name: string, balance: string | null, decimals: number } | null}
 */
export function normalizeTokenRow(row) {
  if (!row || typeof row !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (row);
  const tokenInfo = record.token_info && typeof record.token_info === "object"
    ? /** @type {Record<string, unknown>} */ (record.token_info)
    : record.tokenInfo && typeof record.tokenInfo === "object"
      ? /** @type {Record<string, unknown>} */ (record.tokenInfo)
      : null;
  const contract = firstString(
    record.tokenId,
    record.contract_address,
    record.contractAddress,
    record.token_address,
    tokenInfo?.tokenId,
    tokenInfo?.address,
  );
  if (!contract || !contract.startsWith("T")) return null;
  const symbol = firstString(record.tokenAbbr, record.symbol, tokenInfo?.tokenAbbr, tokenInfo?.symbol) || "";
  const name = firstString(record.tokenName, record.name, tokenInfo?.tokenName, tokenInfo?.name) || "";
  const balance = firstString(record.balance, record.quantity, record.amount, record.value);
  const decimals = readDecimals(
    record.tokenDecimal
      ?? record.decimals
      ?? record.decimal
      ?? tokenInfo?.tokenDecimal
      ?? tokenInfo?.decimals
      ?? OFFICIAL_USDT_DECIMALS,
  ) ?? OFFICIAL_USDT_DECIMALS;
  return { contract, symbol, name, balance, decimals };
}

/**
 * Flatten TronGrid account `trc20` objects into contract/balance pairs.
 * @param {unknown} accountPayload
 * @returns {{ contract: string, balance: string }[]}
 */
export function parseTronGridTrc20Balances(accountPayload) {
  if (!accountPayload || typeof accountPayload !== "object") return [];
  const data = /** @type {{ data?: unknown }} */ (accountPayload).data;
  const account = Array.isArray(data) ? data[0] : null;
  if (!account || typeof account !== "object") return [];
  const trc20 = /** @type {{ trc20?: unknown }} */ (account).trc20;
  if (!Array.isArray(trc20)) return [];
  /** @type {{ contract: string, balance: string }[]} */
  const out = [];
  for (const item of trc20) {
    if (!item || typeof item !== "object") continue;
    for (const [contract, balance] of Object.entries(item)) {
      if (!contract.startsWith("T")) continue;
      if (typeof balance !== "string" && typeof balance !== "number") continue;
      out.push({ contract, balance: String(balance) });
    }
  }
  return out;
}

/**
 * Collect unique token metadata rows from TronGrid TRC-20 transfer history.
 * @param {unknown} historyPayload
 */
export function parseTronGridTrc20History(historyPayload) {
  if (!historyPayload || typeof historyPayload !== "object") return [];
  const rows = /** @type {{ data?: unknown }} */ (historyPayload).data;
  if (!Array.isArray(rows)) return [];
  /** @type {Map<string, { contract: string, symbol: string, name: string, balance: string | null, decimals: number }>} */
  const byContract = new Map();
  for (const row of rows) {
    const normalized = normalizeTokenRow(row);
    if (!normalized) continue;
    if (!byContract.has(normalized.contract)) byContract.set(normalized.contract, normalized);
  }
  return [...byContract.values()];
}

/**
 * Pull TRC-20 style transfers from explorer or event payloads.
 * @param {unknown} payload
 */
export function extractTransactionTransfers(payload) {
  if (!payload || typeof payload !== "object") return [];
  const record = /** @type {Record<string, unknown>} */ (payload);
  /** @type {unknown[]} */
  const buckets = [];
  if (Array.isArray(record.data)) buckets.push(...record.data);
  if (Array.isArray(record.trc20TransferInfo)) buckets.push(...record.trc20TransferInfo);
  if (Array.isArray(record.tokenTransferInfo)) buckets.push(...record.tokenTransferInfo);
  if (Array.isArray(record.transfersAllList)) buckets.push(...record.transfersAllList);
  if (record.contractData && typeof record.contractData === "object") {
    buckets.push(record.contractData);
  }

  /** @type {NonNullable<ReturnType<typeof normalizeTokenRow>>[]} */
  const out = [];
  for (const item of buckets) {
    if (!item || typeof item !== "object") continue;
    const row = /** @type {Record<string, unknown>} */ (item);
    const eventContract = firstString(
      row.contract_address,
      row.caller_contract_address,
      row.contractAddress,
    );
    const normalized = normalizeTokenRow({
      tokenId: eventContract || row.token_address || row.tokenId,
      tokenAbbr: row.symbol || row.tokenAbbr || row.token_abbr || (row.result && typeof row.result === "object" ? null : null),
      tokenName: row.name || row.tokenName || row.token_name,
      balance: row.amount_str || row.amountStr || row.amount || row.quant || row.balance || row.value,
      tokenDecimal: row.decimals ?? row.tokenDecimal ?? row.decimal,
      token_info: row.token_info || row.tokenInfo,
    });
    if (normalized) out.push(normalized);
  }
  return out;
}

/**
 * Decode a solidity string or bytes32 return from triggerconstantcontract.
 * @param {unknown} constantResult
 * @returns {string}
 */
export function decodeAbiStringResult(constantResult) {
  if (!Array.isArray(constantResult) || typeof constantResult[0] !== "string") return "";
  const hex = constantResult[0].replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]*$/.test(hex) || hex.length < 64) return "";
  if (hex.length === 64) {
    const bytes = hexToBytesLocal(hex);
    const end = bytes.indexOf(0);
    const text = new TextDecoder().decode(end === -1 ? bytes : bytes.slice(0, end)).replace(/\0/g, "").trim();
    return /^[\x20-\x7E]{1,32}$/.test(text) ? text : "";
  }
  try {
    const offset = Number(BigInt(`0x${hex.slice(0, 64)}`));
    if (!Number.isInteger(offset) || offset < 0) return "";
    const start = offset * 2;
    if (start + 64 > hex.length) return "";
    const length = Number(BigInt(`0x${hex.slice(start, start + 64)}`));
    if (!Number.isInteger(length) || length < 0 || length > 64) return "";
    const data = hex.slice(start + 64, start + 64 + length * 2);
    if (data.length !== length * 2) return "";
    return new TextDecoder().decode(hexToBytesLocal(data)).replace(/\0/g, "").trim();
  } catch {
    return "";
  }
}

/**
 * @param {unknown} constantResult
 * @returns {number | null}
 */
export function decodeAbiUintResult(constantResult) {
  if (!Array.isArray(constantResult) || typeof constantResult[0] !== "string") return null;
  const hex = constantResult[0].replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  try {
    const value = Number(BigInt(`0x${hex.slice(-64)}`));
    return Number.isSafeInteger(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} balance
 * @param {number | null} decimals
 */
export function formatTokenAmount(balance, decimals) {
  if (balance == null || balance === "") return "—";
  const places = decimals == null ? OFFICIAL_USDT_DECIMALS : decimals;
  if (typeof balance === "number" && Number.isFinite(balance)) {
    if (Number.isInteger(balance) && Math.abs(balance) >= 10 ** places) {
      return formatUnits(BigInt(balance), places);
    }
    return String(balance);
  }
  if (typeof balance === "string") {
    const trimmed = balance.trim();
    if (!trimmed) return "—";
    if (/^[0-9]+$/.test(trimmed)) return formatUnits(BigInt(trimmed), places);
    if (/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) return trimmed;
  }
  return "—";
}

/**
 * @param {string} address
 */
export function explorerAccountUrl(address) {
  return `https://tronscan.org/#/address/${address}`;
}

/**
 * @param {string} txid
 */
export function explorerTransactionUrl(txid) {
  return `https://tronscan.org/#/transaction/${txid}`;
}

/**
 * @param {string} contract
 */
export function explorerTokenUrl(contract) {
  return `https://tronscan.org/#/token20/${contract}`;
}

/**
 * @param {unknown} value
 */
function cleanLabel(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\0/g, "").trim();
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function readDecimals(value) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 36) return value;
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 36 ? parsed : null;
  }
  return null;
}

/**
 * @param {...unknown} values
 * @returns {string}
 */
function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * @param {bigint} units
 * @param {number} decimals
 */
function formatUnits(units, decimals) {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const text = fraction ? `${whole.toString()}.${fraction}` : whole.toString();
  return negative ? `-${text}` : text;
}

/**
 * @param {string} hex
 */
function hexToBytesLocal(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
