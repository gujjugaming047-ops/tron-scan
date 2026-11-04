/**
 * TRON balances read through the connected wallet's TronWeb / node — never TronGrid.
 */

import { USDT_CONTRACT, isValidTronAddress } from "./logic.mjs";
import {
  KNOWN_TRC20_TOKENS,
  buildWalletTokenList,
  extractTrc10BalancesFromAccountRow,
  extractTrc20BalancesFromAccountRow,
  extractTrc20StringFromTriggerPayload,
  extractTrc20UintFromTriggerPayload,
  extractUsdtUnitsFromTriggerPayload,
  formatTrxFromSun,
  lookupKnownTrc20Metadata,
  parseUInt256,
  pickUsdtFromTokenList,
} from "./tron-public.mjs";
import { isTronRateLimitError, tronReadErrorMessage, withTronReadBackoff } from "./tron-read-retry.mjs";

const MAX_TRC20_METADATA_LOOKUPS = 120;

/**
 * @param {any} tronWeb
 * @param {string} ownerAddress
 * @param {string} contract
 * @param {string} selector
 * @param {unknown[]} [parameters]
 */
async function triggerConstantViaTronWeb(tronWeb, ownerAddress, contract, selector, parameters = []) {
  if (!tronWeb?.transactionBuilder?.triggerConstantContract) return null;
  try {
    return await withTronReadBackoff(() => tronWeb.transactionBuilder.triggerConstantContract(
      contract,
      selector,
      {},
      parameters,
      ownerAddress,
    ));
  } catch {
    return null;
  }
}

/**
 * @param {any} tronWeb
 * @param {string} ownerAddress
 * @param {string} contract
 */
async function readTrc20BalanceViaTronWeb(tronWeb, ownerAddress, contract) {
  const payload = await triggerConstantViaTronWeb(tronWeb, ownerAddress, contract, "balanceOf(address)", [
    { type: "address", value: ownerAddress },
  ]);
  return extractUsdtUnitsFromTriggerPayload(payload);
}

/**
 * @param {string} contract
 */
function knownTrc20Metadata(contract) {
  return lookupKnownTrc20Metadata(contract);
}

/**
 * @param {string} contract
 */
function shortenContractLabel(contract) {
  if (contract.length <= 10) return contract;
  return `${contract.slice(0, 4)}…${contract.slice(-4)}`;
}

/**
 * @param {any} tronWeb
 * @param {string} ownerAddress
 * @param {string} contract
 */
async function loadTrc20MetadataViaTronWeb(tronWeb, ownerAddress, contract) {
  const known = knownTrc20Metadata(contract);
  if (known) return known;
  let decimals = 0;
  let symbol = shortenContractLabel(contract);
  let name = contract;
  const decimalsPayload = await triggerConstantViaTronWeb(tronWeb, ownerAddress, contract, "decimals()");
  if (decimalsPayload) {
    const value = extractTrc20UintFromTriggerPayload(decimalsPayload);
    if (value >= 0n && value <= 36n) decimals = Number(value);
  }
  const symbolPayload = await triggerConstantViaTronWeb(tronWeb, ownerAddress, contract, "symbol()");
  if (symbolPayload) {
    const decoded = extractTrc20StringFromTriggerPayload(symbolPayload);
    if (decoded) symbol = decoded;
  }
  const namePayload = await triggerConstantViaTronWeb(tronWeb, ownerAddress, contract, "name()");
  if (namePayload) {
    const decoded = extractTrc20StringFromTriggerPayload(namePayload);
    if (decoded) name = decoded;
  }
  return { symbol, name, decimals };
}

/**
 * @param {any} tronWeb
 * @param {string} tokenId
 */
async function loadTrc10MetadataViaTronWeb(tronWeb, tokenId) {
  let symbol = `TRC10-${tokenId}`;
  let name = `TRC-10 #${tokenId}`;
  let decimals = 0;
  if (tronWeb?.trx?.getTokenFromID) {
    try {
      const token = await withTronReadBackoff(() => tronWeb.trx.getTokenFromID(tokenId));
      if (token && typeof token === "object") {
        const record = /** @type {{ abbr?: unknown, name?: unknown, precision?: unknown }} */ (token);
        if (typeof record.abbr === "string" && record.abbr.trim()) symbol = record.abbr.trim();
        else if (typeof record.name === "string" && record.name.trim()) symbol = record.name.trim();
        if (typeof record.name === "string" && record.name.trim()) name = record.name.trim();
        if (typeof record.precision === "number" && Number.isFinite(record.precision) && record.precision >= 0) {
          decimals = Math.trunc(record.precision);
        }
      }
    } catch {
      // keep defaults
    }
  }
  return { symbol, name, decimals };
}

/**
 * @param {unknown} account
 * @returns {Record<string, unknown> | null}
 */
function normalizeTronAccountRow(account) {
  if (!account || typeof account !== "object") return null;
  return /** @type {Record<string, unknown>} */ (account);
}

/**
 * @param {Array<{ contract: string, units: bigint }>} balances
 * @param {string} contract
 * @param {bigint} units
 * @param {{ keepZero?: boolean }} [options]
 */
function upsertTrc20Balance(balances, contract, units, options = {}) {
  const keepZero = options.keepZero === true || contract === USDT_CONTRACT;
  if (units <= 0n && !keepZero) {
    const index = balances.findIndex((entry) => entry.contract === contract);
    if (index >= 0) balances.splice(index, 1);
    return;
  }
  const normalized = units < 0n ? 0n : units;
  const existing = balances.find((entry) => entry.contract === contract);
  if (existing) {
    existing.units = normalized;
    return;
  }
  if (contract === USDT_CONTRACT) {
    balances.unshift({ contract, units: normalized });
    return;
  }
  balances.push({ contract, units: normalized });
}

/**
 * @param {any} tronWeb
 * @param {string} address
 * @returns {Promise<{ ok: true, trxSun: string, usdtUnits: string, trxDisplay: string, usdtDisplay: string, tokens: import("./tron-public.mjs").WalletTokenAsset[] } | { ok: false, error: string }>}
 */
export async function fetchTronWalletAssetsFromTronWeb(tronWeb, address) {
  const trimmed = address.trim();
  if (!(await isValidTronAddress(trimmed))) {
    return { ok: false, error: "The TRON address is invalid." };
  }
  if (!tronWeb?.trx) {
    return { ok: false, error: "TronWeb is not available from your connected wallet." };
  }

  let accountRow = null;
  let accountError = null;
  try {
    const account = await withTronReadBackoff(() => tronWeb.trx.getAccount(trimmed));
    accountRow = normalizeTronAccountRow(account);
  } catch (error) {
    accountError = error;
    accountRow = null;
  }

  let trxSun = 0n;
  let balanceError = null;
  try {
    const balance = await withTronReadBackoff(() => tronWeb.trx.getBalance(trimmed));
    trxSun = parseUInt256(balance);
  } catch (error) {
    balanceError = error;
    if (accountRow) trxSun = parseUInt256(accountRow.balance);
  }
  if (!accountRow && balanceError && (isTronRateLimitError(accountError) || isTronRateLimitError(balanceError))) {
    return { ok: false, error: tronReadErrorMessage(balanceError || accountError) };
  }

  /** @type {Array<{ contract: string, units: bigint }>} */
  const trc20Balances = accountRow ? extractTrc20BalancesFromAccountRow(accountRow) : [];
  const trc10Balances = accountRow ? extractTrc10BalancesFromAccountRow(accountRow) : [];

  for (const known of KNOWN_TRC20_TOKENS) {
    try {
      const units = await readTrc20BalanceViaTronWeb(tronWeb, trimmed, known.contract);
      // Always surface official USDT (even at zero); other known tokens only when held.
      if (known.contract === USDT_CONTRACT || units > 0n) {
        upsertTrc20Balance(trc20Balances, known.contract, units);
      }
    } catch {
      if (known.contract === USDT_CONTRACT) {
        upsertTrc20Balance(trc20Balances, USDT_CONTRACT, 0n, { keepZero: true });
      }
    }
  }
  if (!trc20Balances.some((entry) => entry.contract === USDT_CONTRACT)) {
    upsertTrc20Balance(trc20Balances, USDT_CONTRACT, 0n, { keepZero: true });
  }

  /** @type {Map<string, { symbol: string, name: string, decimals: number }>} */
  const trc20Meta = new Map();
  /** @type {Map<string, { symbol: string, name: string, decimals: number }>} */
  const trc10Meta = new Map();

  for (const { tokenId } of trc10Balances) {
    trc10Meta.set(tokenId, await loadTrc10MetadataViaTronWeb(tronWeb, tokenId));
  }

  const trc20Lookups = trc20Balances.slice(0, MAX_TRC20_METADATA_LOOKUPS);
  for (const { contract } of trc20Lookups) {
    trc20Meta.set(contract, await loadTrc20MetadataViaTronWeb(tronWeb, trimmed, contract));
  }
  for (const { contract } of trc20Balances.slice(MAX_TRC20_METADATA_LOOKUPS)) {
    trc20Meta.set(contract, knownTrc20Metadata(contract) ?? {
      symbol: shortenContractLabel(contract),
      name: contract,
      decimals: 0,
    });
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
