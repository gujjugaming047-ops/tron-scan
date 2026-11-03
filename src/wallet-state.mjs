/**
 * Pure wallet-selection and session-state helpers shared by the browser flow
 * and its automated tests.
 */

import { chainIdFromGenesisBlockId, MAINNET_CHAIN_ID } from "./logic.mjs";

/**
 * @param {{ isMetaMask?: boolean, isTrust?: boolean }} provider
 * @param {string} [announcedName]
 * @param {string} [rdns]
 * @returns {{ id: "metamask" | "trust" | "injected", name: string }}
 */
export function identifyEvmProvider(provider, announcedName = "", rdns = "") {
  const trust = provider.isTrust || /trust/i.test(announcedName) || /trust/i.test(rdns);
  const metaMask = !trust && (provider.isMetaMask || /metamask/i.test(announcedName) || /metamask/i.test(rdns));
  return {
    id: trust ? "trust" : metaMask ? "metamask" : "injected",
    name: announcedName || (trust ? "Trust Wallet" : metaMask ? "MetaMask" : "Browser wallet"),
  };
}

/**
 * @template {{ id: string, network: string }} T
 * @param {T[]} providers
 * @param {string} id
 * @param {"evm" | "tron" | null} [preferredNetwork]
 * @returns {T | null}
 */
export function selectWalletProvider(providers, id, preferredNetwork = null) {
  const matches = providers.filter((provider) => provider.id === id);
  if (!matches.length) return null;
  if (preferredNetwork) {
    return matches.find((provider) => provider.network === preferredNetwork) || matches[0];
  }
  return matches[0];
}

/**
 * @param {{ address: string, chainId: string } | null} session
 * @param {unknown} wallet
 * @param {string} currentAddress
 * @param {string} currentChainId
 * @returns {"no-session" | "missing-provider" | "locked" | "changed" | "connected"}
 */
export function evaluateSessionRestore(session, wallet, currentAddress, currentChainId) {
  if (!session) return "no-session";
  if (!wallet) return "missing-provider";
  if (!currentAddress) return "locked";
  if (!sameWalletAddress(currentAddress, session.address) || currentChainId !== session.chainId) return "changed";
  return "connected";
}

/**
 * @param {unknown} value
 */
export function firstEvmAddress(value) {
  if (!Array.isArray(value)) return "";
  const address = value.find((item) => typeof item === "string" && /^0x[0-9a-f]{40}$/i.test(item));
  return typeof address === "string" ? address : "";
}

/**
 * @param {string} first
 * @param {string} second
 */
export function sameWalletAddress(first, second) {
  return /^0x/i.test(first) && /^0x/i.test(second)
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

/**
 * @param {string} address
 */
export function shortenWalletAddress(address) {
  return address.length > 13 ? `${address.slice(0, 6)}…${address.slice(-5)}` : address;
}

/**
 * @param {"metamask" | "trust" | "tronlink" | "injected"} walletId
 * @param {{ mobile: boolean, href: string, host: string, pathname: string }} page
 */
export function walletHelpLink(walletId, page) {
  if (walletId === "metamask") {
    return page.mobile
      ? { href: `https://metamask.app.link/dapp/${page.host}${page.pathname}`, label: "Open in MetaMask" }
      : { href: "https://metamask.io/download/", label: "Get MetaMask" };
  }
  if (walletId === "trust") {
    return page.mobile
      ? { href: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(page.href)}`, label: "Open in Trust Wallet" }
      : { href: "https://trustwallet.com/browser-extension", label: "Get Trust Wallet" };
  }
  if (walletId === "tronlink") return { href: "https://www.tronlink.org/", label: "Get TronLink" };
  return null;
}

/**
 * @param {{ namespaces?: { tron?: { accounts?: string[] } } } | null | undefined} session
 * @param {string} chainId
 */
export function tronAddressFromWalletConnectSession(session, chainId = "tron:0x2b6653dc") {
  const accounts = session?.namespaces?.tron?.accounts || [];
  for (const account of accounts) {
    if (!account.startsWith(`${chainId}:`)) continue;
    const address = account.slice(chainId.length + 1);
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return address;
  }
  return "";
}

/**
 * @param {unknown} value
 */
export function normalizeEvmChainId(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value).toString(10);
  }
  if (typeof value === "bigint") {
    return value.toString(10);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^0x[0-9a-f]+$/i.test(trimmed)) {
      return BigInt(trimmed).toString(10);
    }
    if (/^[1-9]\d*$/.test(trimmed)) {
      return trimmed;
    }
  }
  return "";
}

/**
 * @param {{ request?: (args: { method: string }) => Promise<unknown> } | null | undefined} provider
 */
export async function requestEvmChainId(provider) {
  if (!provider || typeof provider.request !== "function") return "";
  try {
    const chainId = await provider.request({ method: "eth_chainId" });
    return normalizeEvmChainId(chainId);
  } catch {
    return "";
  }
}

/**
 * @param {unknown} provider
 */
export function readTronWebFromProvider(provider) {
  const view = /** @type {Window | undefined} */ (typeof globalThis !== "undefined" ? globalThis : undefined);
  const candidates = [
    provider && typeof provider === "object" ? /** @type {{ tronWeb?: unknown }} */ (provider).tronWeb : undefined,
    view && "trustwallet" in view ? /** @type {{ trustwallet?: { tronLink?: { tronWeb?: unknown } } }} */ (view).trustwallet?.tronLink?.tronWeb : undefined,
    view && "tronWeb" in view ? /** @type {{ tronWeb?: unknown }} */ (view).tronWeb : undefined,
    view && "tron" in view ? /** @type {{ tron?: { tronWeb?: unknown } }} */ (view).tron?.tronWeb : undefined,
    view && "tronLink" in view ? /** @type {{ tronLink?: { tronWeb?: unknown } }} */ (view).tronLink?.tronWeb : undefined,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") return candidate;
  }
  return null;
}

/**
 * @param {unknown} provider
 * @param {{ requiredAddress?: string, maxAttempts?: number, delayMs?: number }} [options]
 */
export async function waitForTronWeb(provider, options = {}) {
  const { requiredAddress = "", maxAttempts = 20, delayMs = 200 } = options;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const tronWeb = readTronWebFromProvider(provider);
    const base58 = tronWeb && typeof tronWeb === "object"
      ? /** @type {{ defaultAddress?: { base58?: unknown } }} */ (tronWeb).defaultAddress?.base58
      : "";
    const ready = typeof tronWeb === "object"
      && tronWeb
      && typeof /** @type {{ trx?: { getBlockByNumber?: unknown } }} */ (tronWeb).trx?.getBlockByNumber === "function";
    if (ready && (requiredAddress || (typeof base58 === "string" && base58.trim()))) {
      return tronWeb;
    }
    if (attempt + 1 < maxAttempts && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return readTronWebFromProvider(provider);
}

/**
 * @param {unknown} tronWeb
 */
export async function tronChainIdFromProvider(tronWeb) {
  if (!tronWeb || typeof tronWeb !== "object") return "";
  const trx = /** @type {{ trx?: { getBlockByNumber?: (n: number) => Promise<{ blockID?: unknown }> } }} */ (tronWeb).trx;
  if (!trx || typeof trx.getBlockByNumber !== "function") return "";
  try {
    const genesis = await trx.getBlockByNumber(0);
    const chainId = chainIdFromGenesisBlockId(genesis?.blockID);
    return chainId === MAINNET_CHAIN_ID ? MAINNET_CHAIN_ID : "";
  } catch {
    return "";
  }
}

/**
 * @param {{ network: "evm" | "tron" }} wallet
 * @param {string} address
 * @param {unknown} provider
 */
export async function resolveSignInNetwork(wallet, address, provider) {
  const tronAddress = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  if (tronAddress || wallet.network === "tron") {
    const tronWeb = await waitForTronWeb(provider, { requiredAddress: address, maxAttempts: tronAddress ? 20 : 1 });
    const tronChain = await tronChainIdFromProvider(tronWeb);
    if (tronChain) return { network: /** @type {const} */ ("tron"), chainId: tronChain };
  }
  if (wallet.network === "evm" || /^0x[0-9a-f]{40}$/i.test(address)) {
    const evmChain = await requestEvmChainId(/** @type {{ request?: (args: { method: string }) => Promise<unknown> }} */ (provider));
    if (evmChain) return { network: /** @type {const} */ ("evm"), chainId: evmChain };
  }
  return { network: wallet.network, chainId: "" };
}
