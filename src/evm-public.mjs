/**
 * Read-only EVM native and ERC-20 balances via public JSON-RPC and explorers.
 * Never submits transactions.
 */

/** @type {Record<string, { rpc: string, explorer: string, symbol: string, name: string, decimals: number }>} */
export const KNOWN_EVM_CHAINS = Object.freeze({
  "1": {
    rpc: "https://cloudflare-eth.com",
    explorer: "https://eth.blockscout.com",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
  },
  "137": {
    rpc: "https://polygon-rpc.com",
    explorer: "https://polygon.blockscout.com",
    symbol: "MATIC",
    name: "MATIC",
    decimals: 18,
  },
  "56": {
    rpc: "https://bsc-dataseed.binance.org",
    explorer: "https://bsc.blockscout.com",
    symbol: "BNB",
    name: "BNB",
    decimals: 18,
  },
  "42161": {
    rpc: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbitrum.blockscout.com",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
  },
  "10": {
    rpc: "https://mainnet.optimism.io",
    explorer: "https://optimism.blockscout.com",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
  },
  "8453": {
    rpc: "https://mainnet.base.org",
    explorer: "https://base.blockscout.com",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
  },
});

/**
 * @param {unknown} address
 */
export function looksLikeEvmAddress(address) {
  return typeof address === "string" && /^0x[0-9a-fA-F]{40}$/.test(address.trim());
}

/**
 * @param {unknown} chainId
 */
export function normalizeEvmChainId(chainId) {
  if (typeof chainId !== "string" && typeof chainId !== "number") return "";
  const raw = String(chainId).trim();
  if (!raw) return "";
  if (/^0x[0-9a-fA-F]+$/i.test(raw)) {
    try {
      return BigInt(raw).toString(10);
    } catch {
      return "";
    }
  }
  if (/^[0-9]+$/.test(raw)) return raw.replace(/^0+/, "") || "0";
  return "";
}

/**
 * @param {string} chainId
 * @param {string | undefined} overrideRpc
 * @param {string | undefined} overrideExplorer
 */
export function resolveEvmChainConfig(chainId, overrideRpc, overrideExplorer) {
  const normalized = normalizeEvmChainId(chainId);
  if (!normalized) return null;
  const known = KNOWN_EVM_CHAINS[normalized];
  if (!known) return null;
  const rpc = overrideRpc?.trim() || known.rpc;
  const explorer = overrideExplorer?.trim() || known.explorer;
  return { chainId: normalized, ...known, rpc, explorer };
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
 * @param {bigint} wei
 * @param {number} decimals
 * @param {string} symbol
 */
export function formatNativeFromWei(wei, decimals, symbol) {
  return formatFixedUnits(wei, decimals, symbol);
}

/**
 * @param {unknown} payload
 */
export function extractWeiFromRpcResult(payload) {
  if (!payload || typeof payload !== "object") return 0n;
  const result = /** @type {{ result?: unknown }} */ (payload).result;
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]*$/.test(result)) return 0n;
  try {
    return BigInt(result);
  } catch {
    return 0n;
  }
}

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
 * @typedef {{ standard: "EVM" | "ERC20", symbol: string, name: string, units: string, display: string, contract?: string }} EvmWalletTokenAsset
 */

/**
 * @param {unknown} payload
 * @returns {Array<{ contract: string, symbol: string, name: string, decimals: number, units: bigint }>}
 */
export function extractErc20BalancesFromBlockscoutPayload(payload) {
  if (!Array.isArray(payload)) return [];
  /** @type {Array<{ contract: string, symbol: string, name: string, decimals: number, units: bigint }>} */
  const balances = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const record = /** @type {{ token?: Record<string, unknown>, value?: unknown }} */ (entry);
    const token = record.token;
    if (!token || typeof token !== "object") continue;
    const type = typeof token.type === "string" ? token.type : "";
    if (type && type !== "ERC-20") continue;
    const contract = typeof token.address_hash === "string" ? token.address_hash.trim() : "";
    if (!looksLikeEvmAddress(contract)) continue;
    const units = parseUInt256(record.value);
    if (units <= 0n) continue;
    const decimalsRaw = token.decimals;
    const decimals = typeof decimalsRaw === "string" && /^[0-9]+$/.test(decimalsRaw)
      ? Math.min(36, Number(decimalsRaw))
      : typeof decimalsRaw === "number" && Number.isFinite(decimalsRaw) && decimalsRaw >= 0
        ? Math.min(36, Math.trunc(decimalsRaw))
        : 18;
    const symbol = typeof token.symbol === "string" && token.symbol.trim() ? token.symbol.trim() : shortenContractLabel(contract);
    const name = typeof token.name === "string" && token.name.trim() ? token.name.trim() : contract;
    balances.push({ contract, symbol, name, decimals, units });
  }
  return balances;
}

/**
 * @param {string} contract
 */
function shortenContractLabel(contract) {
  if (contract.length <= 10) return contract;
  return `${contract.slice(0, 6)}…${contract.slice(-4)}`;
}

/**
 * @param {bigint} nativeWei
 * @param {{ symbol: string, name: string, decimals: number }} nativeConfig
 * @param {Array<{ contract: string, symbol: string, name: string, decimals: number, units: bigint }>} erc20
 * @returns {EvmWalletTokenAsset[]}
 */
export function buildEvmWalletTokenList(nativeWei, nativeConfig, erc20) {
  /** @type {EvmWalletTokenAsset[]} */
  const tokens = [{
    standard: "EVM",
    symbol: nativeConfig.symbol,
    name: nativeConfig.name,
    units: nativeWei.toString(),
    display: formatNativeFromWei(nativeWei, nativeConfig.decimals, nativeConfig.symbol),
  }];

  for (const token of erc20) {
    tokens.push({
      standard: "ERC20",
      contract: token.contract,
      symbol: token.symbol,
      name: token.name,
      units: token.units.toString(),
      display: formatFixedUnits(token.units, token.decimals, token.symbol),
    });
  }

  tokens.sort((left, right) => {
    if (left.standard === "EVM") return -1;
    if (right.standard === "EVM") return 1;
    const symbolOrder = left.symbol.localeCompare(right.symbol, undefined, { sensitivity: "base" });
    if (symbolOrder !== 0) return symbolOrder;
    return (left.contract || "").localeCompare(right.contract || "");
  });

  return tokens;
}

/**
 * @param {string} address
 * @param {string} explorerBase
 * @param {typeof fetch} fetchImpl
 */
export async function fetchBlockscoutErc20Balances(address, explorerBase, fetchImpl) {
  const base = explorerBase.replace(/\/$/, "");
  const url = `${base}/api/v2/addresses/${encodeURIComponent(address)}/token-balances`;
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      return { ok: false, error: "Public ERC-20 token data is unavailable." };
    }
    const payload = await response.json();
    return { ok: true, tokens: extractErc20BalancesFromBlockscoutPayload(payload) };
  } catch {
    return { ok: false, error: "Public ERC-20 token data could not be loaded." };
  }
}

/**
 * @param {string} address
 * @param {string} chainId
 * @param {{ fetch?: typeof fetch, rpcUrl?: string, explorerUrl?: string }} [options]
 */
export async function fetchEvmWalletAssets(address, chainId, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { ok: false, error: "Public EVM data is unavailable in this runtime." };
  }
  const trimmed = address.trim();
  if (!looksLikeEvmAddress(trimmed)) {
    return { ok: false, error: "The EVM address is invalid." };
  }
  const config = resolveEvmChainConfig(chainId, options.rpcUrl, options.explorerUrl);
  if (!config) {
    const normalized = normalizeEvmChainId(chainId) || String(chainId);
    return { ok: false, error: `Public balance lookup is not configured for EVM chain ${normalized}.` };
  }

  let wei = 0n;
  try {
    const response = await fetchImpl(config.rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [trimmed, "latest"],
      }),
    });
    if (!response.ok) {
      return { ok: false, error: "Public EVM balance data is unavailable." };
    }
    wei = extractWeiFromRpcResult(await response.json());
  } catch {
    return { ok: false, error: "Public EVM balance data could not be loaded." };
  }

  /** @type {Array<{ contract: string, symbol: string, name: string, decimals: number, units: bigint }>} */
  let erc20 = [];
  let erc20Warning = "";
  if (config.explorer) {
    const erc20Result = await fetchBlockscoutErc20Balances(trimmed, config.explorer, fetchImpl);
    if (erc20Result.ok) {
      erc20 = erc20Result.tokens ?? [];
    } else {
      erc20Warning = erc20Result.error || "Public ERC-20 token data is unavailable.";
    }
  }

  const display = formatNativeFromWei(wei, config.decimals, config.symbol);
  const tokens = buildEvmWalletTokenList(wei, config, erc20);
  return {
    ok: true,
    chainId: config.chainId,
    nativeSymbol: config.symbol,
    nativeUnits: wei.toString(),
    nativeDisplay: display,
    erc20Warning: erc20Warning || undefined,
    tokens,
  };
}

/**
 * @param {unknown} assets
 */
export function normalizeEvmWalletAssetTokens(assets) {
  if (!assets || typeof assets !== "object") {
    return [{ standard: "EVM", symbol: "ETH", name: "Ether", display: "0 ETH" }];
  }
  const record = /** @type {{ tokens?: EvmWalletTokenAsset[], nativeDisplay?: string, nativeSymbol?: string }} */ (assets);
  if (Array.isArray(record.tokens) && record.tokens.length > 0) {
    return record.tokens;
  }
  const symbol = record.nativeSymbol || "ETH";
  const display = record.nativeDisplay || `0 ${symbol}`;
  return [{ standard: "EVM", symbol, name: symbol, display }];
}
