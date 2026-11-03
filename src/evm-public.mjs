/**
 * Read-only EVM native balances via public JSON-RPC. Never submits transactions.
 */

/** @type {Record<string, { rpc: string, symbol: string, name: string, decimals: number }>} */
export const KNOWN_EVM_CHAINS = Object.freeze({
  "1": { rpc: "https://cloudflare-eth.com", symbol: "ETH", name: "Ether", decimals: 18 },
  "137": { rpc: "https://polygon-rpc.com", symbol: "MATIC", name: "MATIC", decimals: 18 },
  "56": { rpc: "https://bsc-dataseed.binance.org", symbol: "BNB", name: "BNB", decimals: 18 },
  "42161": { rpc: "https://arb1.arbitrum.io/rpc", symbol: "ETH", name: "Ether", decimals: 18 },
  "10": { rpc: "https://mainnet.optimism.io", symbol: "ETH", name: "Ether", decimals: 18 },
  "8453": { rpc: "https://mainnet.base.org", symbol: "ETH", name: "Ether", decimals: 18 },
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
 */
export function resolveEvmChainConfig(chainId, overrideRpc) {
  const normalized = normalizeEvmChainId(chainId);
  if (!normalized) return null;
  const known = KNOWN_EVM_CHAINS[normalized];
  if (!known) return null;
  const rpc = overrideRpc?.trim() || known.rpc;
  return { chainId: normalized, ...known, rpc };
}

/**
 * @param {bigint} wei
 * @param {number} decimals
 * @param {string} symbol
 */
export function formatNativeFromWei(wei, decimals, symbol) {
  const scale = 10n ** BigInt(decimals);
  const negative = wei < 0n;
  const absolute = negative ? -wei : wei;
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const number = fraction ? `${whole.toString()}.${fraction}` : whole.toString();
  return `${negative ? "-" : ""}${number} ${symbol}`;
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
 * @param {string} address
 * @param {string} chainId
 * @param {{ fetch?: typeof fetch, rpcUrl?: string }} [options]
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
  const config = resolveEvmChainConfig(chainId, options.rpcUrl);
  if (!config) {
    const normalized = normalizeEvmChainId(chainId) || String(chainId);
    return { ok: false, error: `Public native balance lookup is not configured for EVM chain ${normalized}.` };
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

  const display = formatNativeFromWei(wei, config.decimals, config.symbol);
  return {
    ok: true,
    chainId: config.chainId,
    nativeSymbol: config.symbol,
    nativeUnits: wei.toString(),
    nativeDisplay: display,
    tokens: [{
      standard: "EVM",
      symbol: config.symbol,
      name: config.name,
      units: wei.toString(),
      display,
    }],
  };
}

/**
 * @param {unknown} assets
 */
export function normalizeEvmWalletAssetTokens(assets) {
  if (!assets || typeof assets !== "object") {
    return [{ standard: "EVM", symbol: "ETH", name: "Ether", display: "0 ETH" }];
  }
  const record = /** @type {{ tokens?: Array<{ standard?: string, symbol?: string, name?: string, display?: string }>, nativeDisplay?: string, nativeSymbol?: string }} */ (assets);
  if (Array.isArray(record.tokens) && record.tokens.length > 0) {
    return record.tokens;
  }
  const symbol = record.nativeSymbol || "ETH";
  const display = record.nativeDisplay || `0 ${symbol}`;
  return [{ standard: "EVM", symbol, name: symbol, display }];
}
