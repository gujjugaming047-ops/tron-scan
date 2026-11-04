/**
 * Read-only TRON mainnet balances from public node data (TronGrid).
 * Never submits transactions or asks a wallet for keys.
 */

import { USDT_CONTRACT, USDT_DECIMALS, isValidTronAddress, tronAddressToHex } from "./logic.mjs";

export const DEFAULT_TRON_API_BASE = "https://api.trongrid.io";
const TRX_DECIMALS = 6;
const MAX_TRC20_METADATA_LOOKUPS = 120;

/**
 * Curated TRC-20 contracts always probed after a genuine TRON connect.
 * Official USDT is first; remaining entries are well-known mainnet tokens.
 */
export const KNOWN_TRC20_TOKENS = Object.freeze([
  Object.freeze({
    contract: USDT_CONTRACT,
    symbol: "USDT",
    name: "Tether USD",
    decimals: USDT_DECIMALS,
  }),
  Object.freeze({
    contract: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
  }),
  Object.freeze({
    contract: "TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4",
    symbol: "TUSD",
    name: "TrueUSD",
    decimals: 18,
  }),
  Object.freeze({
    contract: "TPYmHEhy5n8TCEfYGqOZJRPRSfEx4Qf3D",
    symbol: "USDD",
    name: "Decentralized USD",
    decimals: 18,
  }),
]);

/** @type {Map<string, { symbol: string, name: string, decimals: number }>} */
const trc20MetadataCache = new Map();
/** @type {Map<string, { symbol: string, name: string, decimals: number }>} */
const trc10MetadataCache = new Map();

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
export function extractAccountRowFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const data = /** @type {{ data?: unknown[] }} */ (payload).data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const row = data[0];
  return row && typeof row === "object" ? /** @type {Record<string, unknown>} */ (row) : null;
}

/**
 * @param {unknown} payload
 */
export function extractTrxSunFromAccountPayload(payload) {
  const row = extractAccountRowFromPayload(payload);
  if (!row) return 0n;
  return parseUInt256(row.balance);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Array<{ contract: string, units: bigint }>}
 */
export function extractTrc20BalancesFromAccountRow(row) {
  const raw = row.trc20;
  if (!Array.isArray(raw)) return [];
  /** @type {Array<{ contract: string, units: bigint }>} */
  const balances = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    for (const [contract, amount] of Object.entries(/** @type {Record<string, unknown>} */ (entry))) {
      if (typeof contract !== "string" || !contract) continue;
      const units = parseUInt256(amount);
      if (units <= 0n) continue;
      balances.push({ contract, units });
    }
  }
  return balances;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Array<{ tokenId: string, units: bigint }>}
 */
export function extractTrc10BalancesFromAccountRow(row) {
  /** @type {Array<{ tokenId: string, units: bigint }>} */
  const balances = [];
  const sources = [row.assetV2, row.asset].filter((value) => Array.isArray(value));
  for (const list of sources) {
    for (const entry of /** @type {unknown[]} */ (list)) {
      if (!entry || typeof entry !== "object") continue;
      const record = /** @type {{ key?: unknown, value?: unknown, name?: unknown, id?: unknown }} */ (entry);
      const tokenId = record.key != null ? String(record.key) : record.id != null ? String(record.id) : "";
      if (!tokenId) continue;
      const units = parseUInt256(record.value);
      if (units <= 0n) continue;
      balances.push({ tokenId, units });
    }
  }
  return balances;
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
 * @param {unknown} payload
 */
export function extractTrc20UintFromTriggerPayload(payload) {
  return extractUsdtUnitsFromTriggerPayload(payload);
}

/**
 * @param {unknown} payload
 */
export function extractTrc20StringFromTriggerPayload(payload) {
  if (!payload || typeof payload !== "object") return "";
  const record = /** @type {{ constant_result?: unknown[] }} */ (payload);
  const word = Array.isArray(record.constant_result) ? record.constant_result[0] : "";
  if (typeof word !== "string" || !/^[0-9a-fA-F]+$/.test(word)) return "";
  const hex = word.replace(/^0x/, "");
  if (hex.length < 128) return "";
  try {
    const length = Number(BigInt(`0x${hex.slice(64, 128)}`));
    if (!Number.isFinite(length) || length <= 0 || length > 64) return "";
    const body = hex.slice(128, 128 + length * 2);
    return Buffer.from(body, "hex").toString("utf8").replace(/\0+$/, "").trim();
  } catch {
    return "";
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
 * @typedef {{ standard: "TRX" | "TRC10" | "TRC20", symbol: string, name: string, units: string, display: string, tokenId?: string, contract?: string }} WalletTokenAsset
 */

/**
 * @param {bigint} trxSun
 * @param {Array<{ contract: string, units: bigint }>} trc20
 * @param {Array<{ tokenId: string, units: bigint }>} trc10
 * @param {Map<string, { symbol: string, name: string, decimals: number }>} trc20Meta
 * @param {Map<string, { symbol: string, name: string, decimals: number }>} trc10Meta
 * @returns {WalletTokenAsset[]}
 */
export function buildWalletTokenList(trxSun, trc20, trc10, trc20Meta, trc10Meta) {
  /** @type {WalletTokenAsset[]} */
  const tokens = [{
    standard: "TRX",
    symbol: "TRX",
    name: "TRON",
    units: trxSun.toString(),
    display: formatTrxFromSun(trxSun),
  }];

  for (const { tokenId, units } of trc10) {
    const meta = trc10Meta.get(tokenId) ?? { symbol: `TRC10-${tokenId}`, name: `TRC-10 #${tokenId}`, decimals: 0 };
    tokens.push({
      standard: "TRC10",
      tokenId,
      symbol: meta.symbol,
      name: meta.name,
      units: units.toString(),
      display: formatFixedUnits(units, meta.decimals, meta.symbol),
    });
  }

  for (const { contract, units } of trc20) {
    const meta = trc20Meta.get(contract) ?? { symbol: shortenContractLabel(contract), name: contract, decimals: 0 };
    tokens.push({
      standard: "TRC20",
      contract,
      symbol: meta.symbol,
      name: meta.name,
      units: units.toString(),
      display: formatFixedUnits(units, meta.decimals, meta.symbol),
    });
  }

  tokens.sort((left, right) => {
    if (left.standard === "TRX") return -1;
    if (right.standard === "TRX") return 1;
    const leftUsdt = left.contract === USDT_CONTRACT || left.symbol === "USDT";
    const rightUsdt = right.contract === USDT_CONTRACT || right.symbol === "USDT";
    if (leftUsdt && !rightUsdt) return -1;
    if (rightUsdt && !leftUsdt) return 1;
    if (left.standard !== right.standard) {
      if (left.standard === "TRC20") return -1;
      if (right.standard === "TRC20") return 1;
    }
    const symbolOrder = left.symbol.localeCompare(right.symbol, undefined, { sensitivity: "base" });
    if (symbolOrder !== 0) return symbolOrder;
    return (left.contract || left.tokenId || "").localeCompare(right.contract || right.tokenId || "");
  });

  return tokens;
}

/**
 * @param {string} contract
 */
function shortenContractLabel(contract) {
  if (contract.length <= 10) return contract;
  return `${contract.slice(0, 4)}…${contract.slice(-4)}`;
}

/**
 * @param {string} contract
 */
function knownTrc20Metadata(contract) {
  const known = KNOWN_TRC20_TOKENS.find((token) => token.contract === contract);
  if (known) {
    return { symbol: known.symbol, name: known.name, decimals: known.decimals };
  }
  return null;
}

/**
 * @param {string} contract
 */
export function lookupKnownTrc20Metadata(contract) {
  return knownTrc20Metadata(contract);
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} apiBase
 * @param {string} ownerAddress
 * @param {string} contract
 * @param {string} selector
 */
async function triggerConstant(fetchImpl, apiBase, ownerAddress, contract, selector) {
  const contractResponse = await fetchImpl(`${apiBase}/wallet/triggerconstantcontract`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      owner_address: ownerAddress,
      contract_address: contract,
      function_selector: selector,
      visible: true,
    }),
  });
  if (!contractResponse.ok) return null;
  return contractResponse.json();
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} apiBase
 * @param {string} ownerAddress
 * @param {string} contract
 */
async function loadTrc20Metadata(fetchImpl, apiBase, ownerAddress, contract) {
  const cached = trc20MetadataCache.get(contract);
  if (cached) return cached;
  const known = knownTrc20Metadata(contract);
  if (known) {
    trc20MetadataCache.set(contract, known);
    return known;
  }
  let decimals = 0;
  let symbol = shortenContractLabel(contract);
  let name = contract;
  try {
    const decimalsPayload = await triggerConstant(fetchImpl, apiBase, ownerAddress, contract, "decimals()");
    if (decimalsPayload) {
      const value = extractTrc20UintFromTriggerPayload(decimalsPayload);
      if (value >= 0n && value <= 36n) decimals = Number(value);
    }
    const symbolPayload = await triggerConstant(fetchImpl, apiBase, ownerAddress, contract, "symbol()");
    if (symbolPayload) {
      const decoded = extractTrc20StringFromTriggerPayload(symbolPayload);
      if (decoded) symbol = decoded;
    }
    const namePayload = await triggerConstant(fetchImpl, apiBase, ownerAddress, contract, "name()");
    if (namePayload) {
      const decoded = extractTrc20StringFromTriggerPayload(namePayload);
      if (decoded) name = decoded;
    }
  } catch {
    // fall back to generic labels
  }
  const meta = { symbol, name, decimals };
  trc20MetadataCache.set(contract, meta);
  return meta;
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} apiBase
 * @param {string} tokenId
 */
async function loadTrc10Metadata(fetchImpl, apiBase, tokenId) {
  const cached = trc10MetadataCache.get(tokenId);
  if (cached) return cached;
  let symbol = `TRC10-${tokenId}`;
  let name = `TRC-10 #${tokenId}`;
  let decimals = 0;
  try {
    const response = await fetchImpl(`${apiBase}/v1/assets/${encodeURIComponent(tokenId)}`, {
      headers: { Accept: "application/json" },
    });
    if (response.ok) {
      const payload = await response.json();
      const row = extractAccountRowFromPayload(payload) ?? (Array.isArray(payload?.data) ? payload.data[0] : null);
      if (row && typeof row === "object") {
        const record = /** @type {{ abbr?: unknown, name?: unknown, precision?: unknown }} */ (row);
        if (typeof record.abbr === "string" && record.abbr.trim()) symbol = record.abbr.trim();
        else if (typeof record.name === "string" && record.name.trim()) symbol = record.name.trim();
        if (typeof record.name === "string" && record.name.trim()) name = record.name.trim();
        if (typeof record.precision === "number" && Number.isFinite(record.precision) && record.precision >= 0) {
          decimals = Math.trunc(record.precision);
        }
      }
    }
  } catch {
    // keep defaults
  }
  const meta = { symbol, name, decimals };
  trc10MetadataCache.set(tokenId, meta);
  return meta;
}

/**
 * @param {WalletTokenAsset[]} tokens
 */
export function pickUsdtFromTokenList(tokens) {
  const usdt = tokens.find((token) => token.standard === "TRC20" && (token.contract === USDT_CONTRACT || token.symbol === "USDT"));
  if (!usdt) {
    return { usdtUnits: "0", usdtDisplay: formatUsdtFromUnits(0n) };
  }
  return { usdtUnits: usdt.units, usdtDisplay: usdt.display };
}

/**
 * @param {string} address
 * @param {{ fetch?: typeof fetch, apiBase?: string }} [options]
 * @returns {Promise<{ ok: true, trxSun: string, usdtUnits: string, trxDisplay: string, usdtDisplay: string, tokens: WalletTokenAsset[] } | { ok: false, error: string }>}
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

  let accountPayload;
  try {
    const accountResponse = await fetchImpl(`${apiBase}/v1/accounts/${encodeURIComponent(address)}`, {
      headers: { Accept: "application/json" },
    });
    if (!accountResponse.ok) {
      return { ok: false, error: "Public TRON account data is unavailable." };
    }
    accountPayload = await accountResponse.json();
  } catch {
    return { ok: false, error: "Public TRON account data could not be loaded." };
  }

  const row = extractAccountRowFromPayload(accountPayload);
  const trxSun = row ? parseUInt256(row.balance) : 0n;
  const trc20Balances = row ? extractTrc20BalancesFromAccountRow(row) : [];
  const trc10Balances = row ? extractTrc10BalancesFromAccountRow(row) : [];
  if (!trc20Balances.some((entry) => entry.contract === USDT_CONTRACT)) {
    trc20Balances.unshift({ contract: USDT_CONTRACT, units: 0n });
  } else {
    trc20Balances.sort((left, right) => {
      if (left.contract === USDT_CONTRACT) return -1;
      if (right.contract === USDT_CONTRACT) return 1;
      return 0;
    });
  }

  /** @type {Map<string, { symbol: string, name: string, decimals: number }>} */
  const trc20Meta = new Map();
  /** @type {Map<string, { symbol: string, name: string, decimals: number }>} */
  const trc10Meta = new Map();

  await Promise.all(trc10Balances.map(async ({ tokenId }) => {
    trc10Meta.set(tokenId, await loadTrc10Metadata(fetchImpl, apiBase, tokenId));
  }));

  const trc20Lookups = trc20Balances.slice(0, MAX_TRC20_METADATA_LOOKUPS);
  await Promise.all(trc20Lookups.map(async ({ contract }) => {
    trc20Meta.set(contract, await loadTrc20Metadata(fetchImpl, apiBase, address, contract));
  }));
  for (const { contract } of trc20Balances.slice(MAX_TRC20_METADATA_LOOKUPS)) {
    trc20Meta.set(contract, knownTrc20Metadata(contract) ?? {
      symbol: shortenContractLabel(contract),
      name: contract,
      decimals: 0,
    });
  }
  for (const known of KNOWN_TRC20_TOKENS) {
    if (!trc20Meta.has(known.contract)) {
      trc20Meta.set(known.contract, {
        symbol: known.symbol,
        name: known.name,
        decimals: known.decimals,
      });
    }
  }

  const tokens = buildWalletTokenList(trxSun, trc20Balances, trc10Balances, trc20Meta, trc10Meta);
  const { usdtUnits, usdtDisplay } = pickUsdtFromTokenList(tokens);

  return {
    ok: true,
    trxSun: trxSun.toString(),
    usdtUnits,
    trxDisplay: formatTrxFromSun(trxSun),
    usdtDisplay,
    tokens,
  };
}

/**
 * @param {unknown} assets
 * @returns {WalletTokenAsset[]}
 */
export function normalizeWalletAssetTokens(assets) {
  if (!assets || typeof assets !== "object") {
    return [{ standard: "TRX", symbol: "TRX", name: "TRON", units: "0", display: "0 TRX" }];
  }
  const record = /** @type {{ tokens?: WalletTokenAsset[], trxDisplay?: string }} */ (assets);
  if (Array.isArray(record.tokens) && record.tokens.length > 0) {
    return record.tokens;
  }
  const display = typeof record.trxDisplay === "string" && record.trxDisplay.trim()
    ? record.trxDisplay
    : "0 TRX";
  return [{ standard: "TRX", symbol: "TRX", name: "TRON", units: "0", display }];
}
