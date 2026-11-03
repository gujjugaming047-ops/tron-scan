/**
 * EVM balances read through the connected EIP-1193 provider — never Blockscout/public RPC fetch.
 */

import {
  buildEvmWalletTokenList,
  extractWeiFromRpcResult,
  formatFixedUnits,
  looksLikeEvmAddress,
  normalizeEvmChainId,
  parseUInt256,
  resolveEvmChainConfig,
} from "./evm-public.mjs";

const BALANCE_OF_SELECTOR = "0x70a08231";
const DECIMALS_SELECTOR = "0x313ce567";
const SYMBOL_SELECTOR = "0x95d89b41";
const NAME_SELECTOR = "0x06fdde03";

/** @type {Record<string, string>} */
const KNOWN_USDT_BY_CHAIN = Object.freeze({
  "1": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  "137": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  "56": "0x55d398326f99059fF775485246999027B3197955",
  "42161": "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  "10": "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
  "8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
});

/**
 * @param {string} owner
 */
function encodeAddressParameter(owner) {
  return owner.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/**
 * @param {{ request: (args: { method: string, params?: unknown[] }) => Promise<unknown> }} provider
 * @param {string} to
 * @param {string} data
 */
async function providerEthCall(provider, to, data) {
  const result = await provider.request({
    method: "eth_call",
    params: [{ to, data }, "latest"],
  });
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]*$/.test(result)) return 0n;
  try {
    return BigInt(result);
  } catch {
    return 0n;
  }
}

/**
 * @param {unknown} hex
 */
function decodeAbiString(hex) {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) return "";
  const body = hex.replace(/^0x/, "");
  if (body.length < 128) return "";
  try {
    const length = Number(BigInt(`0x${body.slice(64, 128)}`));
    if (!Number.isFinite(length) || length <= 0 || length > 64) return "";
    return Buffer.from(body.slice(128, 128 + length * 2), "hex").toString("utf8").replace(/\0+$/, "").trim();
  } catch {
    return "";
  }
}

/**
 * @param {{ request: (args: { method: string, params?: unknown[] }) => Promise<unknown> }} provider
 * @param {string} contract
 */
async function readErc20MetadataViaProvider(provider, contract) {
  let decimals = 18;
  let symbol = `${contract.slice(0, 6)}…${contract.slice(-4)}`;
  let name = contract;
  try {
    const decimalsHex = await provider.request({
      method: "eth_call",
      params: [{ to: contract, data: DECIMALS_SELECTOR }, "latest"],
    });
    const parsed = parseUInt256(decimalsHex);
    if (parsed >= 0n && parsed <= 36n) decimals = Number(parsed);
  } catch {
    // keep default
  }
  try {
    const symbolHex = await provider.request({
      method: "eth_call",
      params: [{ to: contract, data: SYMBOL_SELECTOR }, "latest"],
    });
    const decoded = decodeAbiString(typeof symbolHex === "string" ? symbolHex : "");
    if (decoded) symbol = decoded;
  } catch {
    // keep default
  }
  try {
    const nameHex = await provider.request({
      method: "eth_call",
      params: [{ to: contract, data: NAME_SELECTOR }, "latest"],
    });
    const decoded = decodeAbiString(typeof nameHex === "string" ? nameHex : "");
    if (decoded) name = decoded;
  } catch {
    // keep default
  }
  return { symbol, name, decimals };
}

/**
 * @param {{ request: (args: { method: string, params?: unknown[] }) => Promise<unknown> }} provider
 * @param {string} owner
 * @param {string} contract
 */
async function readErc20BalanceViaProvider(provider, owner, contract) {
  const data = `${BALANCE_OF_SELECTOR}${encodeAddressParameter(owner)}`;
  return providerEthCall(provider, contract, data);
}

/**
 * @param {unknown} entry
 * @returns {{ contract: string, units: bigint } | null}
 */
function normalizeWalletTokenEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const record = /** @type {{ address?: unknown, contractAddress?: unknown, tokenAddress?: unknown, balance?: unknown, amount?: unknown, value?: unknown }} */ (entry);
  const contract = [record.address, record.contractAddress, record.tokenAddress]
    .find((value) => typeof value === "string" && looksLikeEvmAddress(value));
  if (typeof contract !== "string") return null;
  const units = parseUInt256(record.balance ?? record.amount ?? record.value);
  if (units <= 0n) return null;
  return { contract, units };
}

/**
 * @param {{ request: (args: { method: string, params?: unknown[] }) => Promise<unknown> }} provider
 * @param {string} address
 * @returns {Promise<Array<{ contract: string, units: bigint }>>}
 */
async function discoverWalletReportedErc20(provider, address) {
  const attempts = [
    { method: "wallet_getTokenBalances", params: [address] },
    { method: "metamask_getTokenBalances", params: [address] },
    { method: "trustwallet_getTokenBalances", params: [address] },
  ];
  for (const attempt of attempts) {
    try {
      const payload = await provider.request(attempt);
      const list = Array.isArray(payload)
        ? payload
        : payload && typeof payload === "object" && Array.isArray(/** @type {{ tokens?: unknown[] }} */ (payload).tokens)
          ? /** @type {{ tokens: unknown[] }} */ (payload).tokens
          : [];
      /** @type {Map<string, bigint>} */
      const merged = new Map();
      for (const entry of list) {
        const normalized = normalizeWalletTokenEntry(entry);
        if (!normalized) continue;
        merged.set(normalized.contract.toLowerCase(), normalized.units);
      }
      if (merged.size > 0) {
        return [...merged.entries()].map(([contract, units]) => ({
          contract: `0x${contract.replace(/^0x/, "")}`,
          units,
        }));
      }
    } catch {
      // wallet does not implement this method
    }
  }
  return [];
}

/**
 * @param {{ request: (args: { method: string, params?: unknown[] }) => Promise<unknown> }} provider
 * @param {string} address
 * @param {string} chainId
 * @returns {Promise<{ ok: true, chainId: string, nativeSymbol: string, nativeUnits: string, nativeDisplay: string, providerNote?: string, tokens: import("./evm-public.mjs").EvmWalletTokenAsset[] } | { ok: false, error: string }>}
 */
export async function fetchEvmWalletAssetsFromProvider(provider, address, chainId) {
  if (!provider || typeof provider.request !== "function") {
    return { ok: false, error: "Your wallet provider is not available." };
  }
  const trimmed = address.trim();
  if (!looksLikeEvmAddress(trimmed)) {
    return { ok: false, error: "The EVM address is invalid." };
  }
  const normalizedChain = normalizeEvmChainId(chainId) || normalizeEvmChainId(await provider.request({ method: "eth_chainId" })) || "1";
  const config = resolveEvmChainConfig(normalizedChain, undefined, undefined);
  if (!config) {
    return { ok: false, error: `Your wallet network (chain ${normalizedChain}) is not supported for asset display.` };
  }

  let wei = 0n;
  try {
    const balanceHex = await provider.request({
      method: "eth_getBalance",
      params: [trimmed, "latest"],
    });
    wei = extractWeiFromRpcResult({ result: balanceHex });
  } catch {
    return { ok: false, error: "Your wallet could not return the native coin balance." };
  }

  /** @type {Array<{ contract: string, symbol: string, name: string, decimals: number, units: bigint }>} */
  const erc20 = [];
  const reported = await discoverWalletReportedErc20(provider, trimmed);
  /** @type {Map<string, bigint>} */
  const contracts = new Map(reported.map((entry) => [entry.contract.toLowerCase(), entry.units]));
  const usdt = KNOWN_USDT_BY_CHAIN[config.chainId];
  if (usdt && !contracts.has(usdt.toLowerCase())) {
    contracts.set(usdt.toLowerCase(), 0n);
  }

  for (const [contractKey] of contracts) {
    const contract = contractKey.startsWith("0x") ? contractKey : `0x${contractKey}`;
    let units = contracts.get(contractKey) ?? 0n;
    if (units <= 0n) {
      units = await readErc20BalanceViaProvider(provider, trimmed, contract);
    }
    if (units <= 0n) continue;
    const meta = await readErc20MetadataViaProvider(provider, contract);
    erc20.push({ contract, ...meta, units });
  }

  const tokens = buildEvmWalletTokenList(wei, config, erc20);
  const providerNote = reported.length > 0
    ? undefined
    : erc20.length > 0
      ? "Additional ERC-20 tokens appear when your wallet exposes them through wallet token APIs."
      : "Only the native coin was returned by your wallet provider on this network.";

  return {
    ok: true,
    chainId: config.chainId,
    nativeSymbol: config.symbol,
    nativeUnits: wei.toString(),
    nativeDisplay: formatFixedUnits(wei, config.decimals, config.symbol),
    providerNote,
    tokens,
  };
}
