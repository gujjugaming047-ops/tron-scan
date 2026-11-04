/**
 * Manual chain catalog for FlashCheck: TRON + major EVM networks.
 * Trust Wallet open_url coin IDs are chain-specific (195 = TRON, 60 = Ethereum, …).
 */

/** @typedef {{
 *   id: string,
 *   network: "tron" | "evm",
 *   label: string,
 *   shortLabel: string,
 *   chainId: string,
 *   evmHexChainId?: string,
 *   trustCoinId: number,
 *   nativeSymbol: string,
 *   rpcUrls?: string[],
 *   blockExplorerUrls?: string[],
 *   decimals: number
 * }} ChainOption */

/** @type {readonly ChainOption[]} */
export const CHAIN_OPTIONS = Object.freeze([
  {
    id: "tron",
    network: "tron",
    label: "TRON",
    shortLabel: "TRON",
    chainId: "0x2b6653dc",
    trustCoinId: 195,
    nativeSymbol: "TRX",
    decimals: 6,
  },
  {
    id: "ethereum",
    network: "evm",
    label: "Ethereum",
    shortLabel: "ETH",
    chainId: "1",
    evmHexChainId: "0x1",
    trustCoinId: 60,
    nativeSymbol: "ETH",
    rpcUrls: ["https://cloudflare-eth.com"],
    blockExplorerUrls: ["https://etherscan.io"],
    decimals: 18,
  },
  {
    id: "bnb",
    network: "evm",
    label: "BNB Smart Chain",
    shortLabel: "BNB",
    chainId: "56",
    evmHexChainId: "0x38",
    trustCoinId: 20000714,
    nativeSymbol: "BNB",
    rpcUrls: ["https://bsc-dataseed.binance.org"],
    blockExplorerUrls: ["https://bscscan.com"],
    decimals: 18,
  },
  {
    id: "polygon",
    network: "evm",
    label: "Polygon",
    shortLabel: "POL",
    chainId: "137",
    evmHexChainId: "0x89",
    trustCoinId: 966,
    nativeSymbol: "POL",
    rpcUrls: ["https://polygon-rpc.com"],
    blockExplorerUrls: ["https://polygonscan.com"],
    decimals: 18,
  },
  {
    id: "arbitrum",
    network: "evm",
    label: "Arbitrum One",
    shortLabel: "ARB",
    chainId: "42161",
    evmHexChainId: "0xa4b1",
    trustCoinId: 10042221,
    nativeSymbol: "ETH",
    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
    blockExplorerUrls: ["https://arbiscan.io"],
    decimals: 18,
  },
  {
    id: "optimism",
    network: "evm",
    label: "Optimism",
    shortLabel: "OP",
    chainId: "10",
    evmHexChainId: "0xa",
    trustCoinId: 10000070,
    nativeSymbol: "ETH",
    rpcUrls: ["https://mainnet.optimism.io"],
    blockExplorerUrls: ["https://optimistic.etherscan.io"],
    decimals: 18,
  },
  {
    id: "base",
    network: "evm",
    label: "Base",
    shortLabel: "Base",
    chainId: "8453",
    evmHexChainId: "0x2105",
    trustCoinId: 8453,
    nativeSymbol: "ETH",
    rpcUrls: ["https://mainnet.base.org"],
    blockExplorerUrls: ["https://basescan.org"],
    decimals: 18,
  },
]);

export const DEFAULT_CHAIN_ID = "tron";

/**
 * @param {unknown} id
 * @returns {ChainOption}
 */
export function getChainOption(id) {
  const key = typeof id === "string" ? id.trim().toLowerCase() : "";
  return CHAIN_OPTIONS.find((item) => item.id === key) || CHAIN_OPTIONS[0];
}

/**
 * @param {unknown} chainId decimal or hex EVM id, or TRON genesis hex
 * @returns {ChainOption | null}
 */
export function findChainByNetworkChainId(chainId) {
  const raw = typeof chainId === "string" || typeof chainId === "number" ? String(chainId).trim() : "";
  if (!raw) return null;
  const byId = CHAIN_OPTIONS.find((item) => item.chainId === raw || item.evmHexChainId === raw.toLowerCase());
  if (byId) return byId;
  if (/^0x[0-9a-fA-F]+$/i.test(raw)) {
    try {
      const dec = BigInt(raw).toString(10);
      return CHAIN_OPTIONS.find((item) => item.chainId === dec) || null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Canonical return page for Trust open_url, tagged with selected chain.
 * @param {string} pageHref
 * @param {ChainOption} chain
 */
export function trustReturnPageUrl(pageHref, chain) {
  let target;
  try {
    target = new URL(pageHref);
  } catch {
    throw new Error("A valid page URL is required for the Trust deep link.");
  }
  const clean = new URL(target.pathname || "/", target.origin);
  clean.search = "";
  clean.hash = "";
  clean.searchParams.set("connect", "1");
  clean.searchParams.set("chain", chain.id);
  if (chain.network === "tron") clean.searchParams.set("trust_tron", "1");
  else clean.searchParams.set("trust_evm", "1");
  return clean.toString();
}

/**
 * Trust Wallet in-app browser deep link for the selected chain's coin_id.
 * @param {string} pageHref
 * @param {ChainOption | string} chainOrId
 */
export function trustWalletOpenDeepLink(pageHref, chainOrId) {
  const chain = typeof chainOrId === "string" || !chainOrId ? getChainOption(chainOrId) : chainOrId;
  const pageUrl = trustReturnPageUrl(pageHref, chain);
  return `https://link.trustwallet.com/open_url?coin_id=${chain.trustCoinId}&url=${encodeURIComponent(pageUrl)}`;
}

/**
 * @param {string} link
 * @param {ChainOption} [expected]
 * @returns {{ ok: true, coinId: string, pageUrl: string, chainId: string } | { ok: false, error: string }}
 */
export function verifyTrustOpenDeepLink(link, expected) {
  let parsed;
  try {
    parsed = new URL(link);
  } catch {
    return { ok: false, error: "The Trust deep link is not a valid URL." };
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "link.trustwallet.com" || parsed.pathname !== "/open_url") {
    return { ok: false, error: "The Trust deep link must use https://link.trustwallet.com/open_url." };
  }
  const coinId = parsed.searchParams.get("coin_id");
  if (!coinId || !/^[0-9]+$/.test(coinId)) {
    return { ok: false, error: "The Trust deep link is missing a numeric coin_id." };
  }
  if (expected && coinId !== String(expected.trustCoinId)) {
    return { ok: false, error: `Expected coin_id=${expected.trustCoinId} for ${expected.label}.` };
  }
  const embedded = parsed.searchParams.get("url");
  if (!embedded) return { ok: false, error: "The Trust deep link is missing the encoded page url." };
  let page;
  try {
    page = new URL(embedded);
  } catch {
    return { ok: false, error: "The embedded page URL is not correctly encoded." };
  }
  if (page.searchParams.get("connect") !== "1") {
    return { ok: false, error: "The embedded page must include connect=1." };
  }
  const chainKey = page.searchParams.get("chain") || "";
  const chain = getChainOption(chainKey || (expected?.id || "tron"));
  if (expected && chain.id !== expected.id) {
    return { ok: false, error: `Embedded chain=${chainKey || "(missing)"} does not match ${expected.id}.` };
  }
  return { ok: true, coinId, pageUrl: page.toString(), chainId: chain.id };
}

/**
 * Ask an EIP-1193 provider to switch (and add if needed) to the selected EVM chain.
 * @param {{ request: (args: { method: string, params?: unknown[] }) => Promise<unknown> }} provider
 * @param {ChainOption} chain
 */
export async function ensureEvmProviderChain(provider, chain) {
  if (chain.network !== "evm" || !chain.evmHexChainId) {
    throw new Error("Selected network is not an EVM chain.");
  }
  const wanted = chain.evmHexChainId.toLowerCase();
  try {
    const current = await provider.request({ method: "eth_chainId" });
    const cur = typeof current === "string" ? current.toLowerCase() : "";
    if (cur === wanted) return chain.chainId;
  } catch {
    // continue to switch
  }
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: wanted }],
    });
    return chain.chainId;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? Number(/** @type {{ code?: unknown }} */ (error).code)
      : 0;
    // 4902 = unrecognized chain — try wallet_addEthereumChain
    if (code !== 4902 && code !== -32603) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: wanted,
        chainName: chain.label,
        nativeCurrency: { name: chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: chain.decimals },
        rpcUrls: chain.rpcUrls || [],
        blockExplorerUrls: chain.blockExplorerUrls || [],
      }],
    });
    return chain.chainId;
  }
}
