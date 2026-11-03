/**
 * TRON balances read through the connected wallet's TronWeb / node — never TronGrid.
 */

import { USDT_CONTRACT, USDT_DECIMALS, isValidTronAddress } from "./logic.mjs";
import {
  buildWalletTokenList,
  extractTrc10BalancesFromAccountRow,
  extractTrc20BalancesFromAccountRow,
  extractTrc20StringFromTriggerPayload,
  extractTrc20UintFromTriggerPayload,
  extractUsdtUnitsFromTriggerPayload,
  formatTrxFromSun,
  parseUInt256,
  pickUsdtFromTokenList,
} from "./tron-public.mjs";

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
    return await tronWeb.transactionBuilder.triggerConstantContract(
      contract,
      selector,
      {},
      parameters,
      ownerAddress,
    );
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
  if (contract === USDT_CONTRACT) {
    return { symbol: "USDT", name: "Tether USD", decimals: USDT_DECIMALS };
  }
  return null;
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
      const token = await tronWeb.trx.getTokenFromID(tokenId);
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
 */
function upsertTrc20Balance(balances, contract, units) {
  if (units <= 0n) {
    const index = balances.findIndex((entry) => entry.contract === contract);
    if (index >= 0) balances.splice(index, 1);
    return;
  }
  const existing = balances.find((entry) => entry.contract === contract);
  if (existing) {
    existing.units = units;
    return;
  }
  balances.push({ contract, units });
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
  try {
    const account = await tronWeb.trx.getAccount(trimmed);
    accountRow = normalizeTronAccountRow(account);
  } catch {
    accountRow = null;
  }

  let trxSun = 0n;
  try {
    const balance = await tronWeb.trx.getBalance(trimmed);
    trxSun = parseUInt256(balance);
  } catch {
    if (accountRow) trxSun = parseUInt256(accountRow.balance);
  }

  /** @type {Array<{ contract: string, units: bigint }>} */
  const trc20Balances = accountRow ? extractTrc20BalancesFromAccountRow(accountRow) : [];
  const trc10Balances = accountRow ? extractTrc10BalancesFromAccountRow(accountRow) : [];

  try {
    const usdtUnits = await readTrc20BalanceViaTronWeb(tronWeb, trimmed, USDT_CONTRACT);
    upsertTrc20Balance(trc20Balances, USDT_CONTRACT, usdtUnits);
  } catch {
    // ignore single-token probe failures
  }

  /** @type {Map<string, { symbol: string, name: string, decimals: number }>} */
  const trc20Meta = new Map();
  /** @type {Map<string, { symbol: string, name: string, decimals: number }>} */
  const trc10Meta = new Map();

  await Promise.all(trc10Balances.map(async ({ tokenId }) => {
    trc10Meta.set(tokenId, await loadTrc10MetadataViaTronWeb(tronWeb, tokenId));
  }));

  const trc20Lookups = trc20Balances.slice(0, MAX_TRC20_METADATA_LOOKUPS);
  await Promise.all(trc20Lookups.map(async ({ contract }) => {
    trc20Meta.set(contract, await loadTrc20MetadataViaTronWeb(tronWeb, trimmed, contract));
  }));
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
