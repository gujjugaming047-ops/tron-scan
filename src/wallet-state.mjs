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
    // Never fall back to EVM when TRON was requested — Trust mobile often
    // injects ethereum first while the DApp browser is still on Ethereum.
    return matches.find((provider) => provider.network === preferredNetwork) || null;
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

/** Trust Wallet coin id for TRON (not Ethereum 60). */
export const TRUST_WALLET_TRON_COIN_ID = 195;

export const TRON_IN_APP_BROWSER_HINT =
  "Open this page in TronLink or Trust Wallet’s TRON in-app browser, approve the connection, then return here.";

/**
 * Trust Wallet mobile often opens the DApp browser on Ethereum. Tell the user
 * to reopen this page in the TRON browser (coin_id=195, never Ethereum 60).
 */
export function trustWalletSwitchToTronMessage() {
  return "Trust Wallet opened this page on an EVM network, so TRON assets cannot load. Tap Open in Trust Wallet on TRON to reopen this same page in the TRON DApp browser (coin_id=195 only), then connect again.";
}

/**
 * Canonical page URL embedded inside the Trust TRON deep link.
 * Strips hash and unrelated query noise so WhatsApp/share wrappers cannot change coin/network.
 * @param {string} pageHref
 */
export function trustWalletTronReturnPageUrl(pageHref) {
  let target;
  try {
    target = new URL(pageHref);
  } catch {
    throw new Error("A valid page URL is required for the Trust TRON deep link.");
  }
  const clean = new URL(target.pathname || "/", target.origin);
  clean.search = "";
  clean.hash = "";
  clean.searchParams.set("connect", "1");
  clean.searchParams.set("trust_tron", "1");
  return clean.toString();
}

/**
 * Build a Trust Wallet deep link that reopens this page in the TRON DApp browser.
 * Always uses https://link.trustwallet.com/open_url with coin_id=195. Never coin 60.
 * @param {string} pageHref absolute page URL
 */
export function trustWalletTronDeepLink(pageHref) {
  const pageUrl = trustWalletTronReturnPageUrl(pageHref);
  return `https://link.trustwallet.com/open_url?coin_id=${TRUST_WALLET_TRON_COIN_ID}&url=${encodeURIComponent(pageUrl)}`;
}

/**
 * Verify a Trust TRON deep link is correctly hosted, coin-scoped, and encoded.
 * @param {string} link
 * @returns {{ ok: true, coinId: string, pageUrl: string } | { ok: false, error: string }}
 */
export function verifyTrustTronDeepLink(link) {
  let parsed;
  try {
    parsed = new URL(link);
  } catch {
    return { ok: false, error: "The Trust deep link is not a valid URL." };
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "link.trustwallet.com") {
    return { ok: false, error: "The Trust deep link must use https://link.trustwallet.com." };
  }
  if (parsed.pathname !== "/open_url") {
    return { ok: false, error: "The Trust deep link path must be /open_url." };
  }
  const coinId = parsed.searchParams.get("coin_id");
  if (coinId !== String(TRUST_WALLET_TRON_COIN_ID)) {
    return { ok: false, error: `The Trust deep link must use coin_id=${TRUST_WALLET_TRON_COIN_ID}.` };
  }
  if (parsed.searchParams.get("coin_id") === "60") {
    return { ok: false, error: "Ethereum coin_id=60 is not allowed." };
  }
  const embedded = parsed.searchParams.get("url");
  if (!embedded) return { ok: false, error: "The Trust deep link is missing the encoded page url." };
  let page;
  try {
    page = new URL(embedded);
  } catch {
    return { ok: false, error: "The embedded page URL is not correctly encoded." };
  }
  if (page.searchParams.get("trust_tron") !== "1" || page.searchParams.get("connect") !== "1") {
    return { ok: false, error: "The embedded page must include connect=1 and trust_tron=1." };
  }
  return { ok: true, coinId, pageUrl: page.toString() };
}

/**
 * True when the Trust TRON deep link should be the primary action (mobile, or
 * Trust is present but only the EVM provider is injected).
 * @param {{ mobile: boolean, trustTronReady: boolean, insideTrust: boolean, trustEvmOnly: boolean }} state
 */
export function shouldOfferTrustTronDeepLink(state) {
  if (state.trustTronReady) return false;
  return state.mobile || state.insideTrust || state.trustEvmOnly;
}

/**
 * Classify where the page is running so the UI can show one correct TRON action.
 * @param {unknown} view
 * @returns {"trust-tron" | "trust-evm" | "tronlink" | "whatsapp" | "safari-mobile" | "mobile-browser" | "desktop"}
 */
export function detectMobileWalletHostContext(view = typeof globalThis !== "undefined" ? globalThis : undefined) {
  const record = view && typeof view === "object"
    ? /** @type {{ navigator?: { userAgent?: string }, tronLink?: unknown, tron?: unknown, tronWeb?: unknown }} */ (view)
    : {};
  const ua = record.navigator?.userAgent || "";
  if (discoverTrustTronProvider(view)) return "trust-tron";
  if (isInsideTrustWallet(view) && trustWalletOpenOnEvmOnly(view)) return "trust-evm";
  if (isInsideTrustWallet(view)) return "trust-evm";
  if (/TronLink/i.test(ua) || record.tronLink || record.tron || looksLikeInjectedTronWeb(record.tronWeb)) {
    return "tronlink";
  }
  if (/WhatsApp/i.test(ua)) return "whatsapp";
  if (/iPhone|iPad|iPod/i.test(ua) && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)) {
    return "safari-mobile";
  }
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return "mobile-browser";
  return "desktop";
}

/**
 * Mobile TRON path: TronLink is always the primary CTA; WalletConnect TRON is
 * the only secondary. Trust is never the default open path (no deep-link CTA).
 * @param {ReturnType<typeof detectMobileWalletHostContext>} context
 * @param {{ trustDeepLinkFailed?: boolean, walletConnectConfigured?: boolean }} [options]
 * @returns {{ primary: "connect-tronlink" | "open-tronlink" | "walletconnect" | "none", secondary: Array<"walletconnect">, message: string, blockTrust: boolean }}
 */
export function recommendedMobileTronAction(context, options = {}) {
  const trustFailed = options.trustDeepLinkFailed === true;
  const wcReady = options.walletConnectConfigured !== false;
  /** @type {Array<"walletconnect">} */
  const secondary = wcReady ? ["walletconnect"] : [];

  if (context === "tronlink") {
    return {
      primary: "connect-tronlink",
      secondary,
      blockTrust: true,
      message: "TronLink detected. Connect here for TRON — do not use Trust/MetaMask/Ethereum.",
    };
  }
  if (context === "trust-evm" || trustFailed) {
    return {
      primary: "open-tronlink",
      secondary,
      blockTrust: true,
      message: "Trust is on EVM (or stayed on EVM). Trust connect is blocked here — open TronLink or pair WalletConnect (TRON).",
    };
  }
  if (context === "trust-tron") {
    // Even inside Trust TRON, do not make Trust the default open path.
    return {
      primary: "open-tronlink",
      secondary,
      blockTrust: false,
      message: "Prefer TronLink or WalletConnect TRON. Trust is demoted because it often opens on EVM.",
    };
  }
  if (context === "whatsapp" || context === "safari-mobile" || context === "mobile-browser") {
    return {
      primary: "open-tronlink",
      secondary,
      blockTrust: true,
      message: context === "whatsapp"
        ? "Opened in WhatsApp. Do not connect Trust here. Open this page in TronLink (primary) or pair WalletConnect TRON."
        : "Primary: Open in TronLink. Secondary: WalletConnect TRON. Trust is hidden on mobile to avoid EVM opens.",
    };
  }
  return {
    primary: "none",
    secondary: [],
    blockTrust: false,
    message: "Choose TronLink or WalletConnect TRON to verify a T… address.",
  };
}

/**
 * Clear copy when a WalletConnect session has EVM accounts but no TRON `T...` account.
 */
export function rejectEvmOnlyWalletConnectMessage() {
  return `This WalletConnect session is EVM-only and cannot read TRON assets. Disconnect it, then ${TRON_IN_APP_BROWSER_HINT}`;
}

/**
 * @param {unknown} view
 */
export function isInsideTrustWallet(view = typeof globalThis !== "undefined" ? globalThis : undefined) {
  if (!view || typeof view !== "object") return false;
  const record = /** @type {{ trustwallet?: unknown, ethereum?: { isTrust?: boolean }, navigator?: { userAgent?: string } }} */ (view);
  if (record.trustwallet) return true;
  if (record.ethereum?.isTrust) return true;
  const ua = record.navigator?.userAgent || "";
  return /Trust/i.test(ua);
}

/**
 * @param {unknown} value
 */
export function looksLikeInjectedTronWeb(value) {
  if (!value || typeof value !== "object") return false;
  const tronWeb = /** @type {{ trx?: { getBalance?: unknown, getBlockByNumber?: unknown }, defaultAddress?: { base58?: unknown } }} */ (value);
  return typeof tronWeb.trx?.getBalance === "function"
    || typeof tronWeb.trx?.getBlockByNumber === "function"
    || typeof tronWeb.defaultAddress?.base58 === "string";
}

/**
 * @param {unknown} view
 * @returns {object | null}
 */
export function readGlobalTronWeb(view = typeof globalThis !== "undefined" ? globalThis : undefined) {
  if (!view || typeof view !== "object") return null;
  const record = /** @type {{
   * tronWeb?: unknown,
   * tron?: { tronWeb?: unknown },
   * tronLink?: { tronWeb?: unknown },
   * trustwallet?: { tronLink?: { tronWeb?: unknown }, tronWeb?: unknown }
   * }} */ (view);
  const candidates = [
    record.trustwallet?.tronLink?.tronWeb,
    record.trustwallet?.tronWeb,
    record.tronWeb,
    record.tronLink?.tronWeb,
    record.tron?.tronWeb,
  ];
  for (const candidate of candidates) {
    if (looksLikeInjectedTronWeb(candidate)) return /** @type {object} */ (candidate);
  }
  return null;
}

/**
 * Wrap a bare Trust/TronLink `tronWeb` object as a requestable TRON provider.
 * Trust mobile often injects `window.tronWeb` without `tronLink.request`.
 * @param {object} tronWeb
 * @param {{ isTrust?: boolean }} [options]
 */
export function wrapTronWebAsProvider(tronWeb, options = {}) {
  return {
    tronWeb,
    isTrust: options.isTrust === true,
    /**
     * @param {{ method: string, params?: unknown[] }} args
     */
    async request(args) {
      const method = args?.method || "";
      const address = /** @type {{ defaultAddress?: { base58?: unknown } }} */ (tronWeb).defaultAddress?.base58;
      if (method === "tron_requestAccounts" || method === "eth_requestAccounts") {
        if (typeof address === "string" && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
          return { code: 200, address };
        }
        throw new Error(trustWalletSwitchToTronMessage());
      }
      throw new Error(`Unsupported Trust TRON method: ${method || "(missing)"}`);
    },
  };
}

/**
 * Discover Trust Wallet’s TRON injection across the shapes Trust uses on mobile.
 * Prefer tronWeb / trustwallet.tronLink over the EVM ethereum provider.
 * @param {unknown} view
 * @returns {ReturnType<typeof wrapTronWebAsProvider> | { request: Function, tronWeb?: unknown, isTrust?: boolean } | null}
 */
export function discoverTrustTronProvider(view = typeof globalThis !== "undefined" ? globalThis : undefined) {
  if (!view || typeof view !== "object") return null;
  const record = /** @type {{
   * trustwallet?: { tronLink?: { request?: Function, tronWeb?: unknown }, tronWeb?: unknown, ethereum?: unknown },
   * tronLink?: { request?: Function, tronWeb?: unknown, isTrust?: boolean },
   * tron?: { request?: Function, tronWeb?: unknown },
   * tronWeb?: unknown,
   * ethereum?: { isTrust?: boolean },
   * navigator?: { userAgent?: string }
   * }} */ (view);
  const insideTrust = isInsideTrustWallet(view);

  const trustTronLink = record.trustwallet?.tronLink;
  if (trustTronLink && typeof trustTronLink.request === "function") {
    return /** @type {{ request: Function, tronWeb?: unknown, isTrust?: boolean }} */ (trustTronLink);
  }

  const nestedTronWeb = readGlobalTronWeb(view);
  if (nestedTronWeb && (insideTrust || trustTronLink || record.trustwallet?.tronWeb)) {
    return wrapTronWebAsProvider(nestedTronWeb, { isTrust: true });
  }

  // Inside Trust, a top-level tronLink/tron injection is still Trust’s TRON provider.
  if (insideTrust) {
    for (const candidate of [record.tronLink, record.tron]) {
      if (candidate && typeof candidate.request === "function") {
        const nested = /** @type {{ tronWeb?: unknown }} */ (candidate).tronWeb;
        if (looksLikeInjectedTronWeb(nested)) {
          return wrapTronWebAsProvider(/** @type {object} */ (nested), { isTrust: true });
        }
        return /** @type {{ request: Function, tronWeb?: unknown, isTrust?: boolean }} */ (candidate);
      }
      const nested = candidate && typeof candidate === "object"
        ? /** @type {{ tronWeb?: unknown }} */ (candidate).tronWeb
        : null;
      if (looksLikeInjectedTronWeb(nested)) {
        return wrapTronWebAsProvider(/** @type {object} */ (nested), { isTrust: true });
      }
    }
    if (looksLikeInjectedTronWeb(record.tronWeb)) {
      return wrapTronWebAsProvider(/** @type {object} */ (record.tronWeb), { isTrust: true });
    }
  }

  return null;
}

/**
 * True when Trust’s EVM provider is present but no TRON injection is ready yet.
 * @param {unknown} view
 */
export function trustWalletOpenOnEvmOnly(view = typeof globalThis !== "undefined" ? globalThis : undefined) {
  if (!isInsideTrustWallet(view)) return false;
  if (discoverTrustTronProvider(view)) return false;
  const record = /** @type {{ trustwallet?: { ethereum?: { request?: Function } }, ethereum?: { isTrust?: boolean, request?: Function } }} */ (view);
  return Boolean(
    (record.trustwallet?.ethereum && typeof record.trustwallet.ethereum.request === "function")
    || (record.ethereum?.isTrust && typeof record.ethereum.request === "function")
    || record.ethereum,
  );
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
      ? {
        href: trustWalletTronDeepLink(page.href),
        label: "Open in Trust Wallet on TRON",
      }
      : { href: "https://trustwallet.com/browser-extension", label: "Get Trust Wallet" };
  }
  if (walletId === "tronlink") return { href: "https://www.tronlink.org/", label: "Get TronLink" };
  return null;
}

/**
 * @param {{ namespaces?: { tron?: { accounts?: string[] }, eip155?: { accounts?: string[] } } } | null | undefined} session
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
 * True when the pairing exposed EVM accounts but no usable TRON mainnet `T...` account.
 * @param {{ namespaces?: { tron?: { accounts?: string[] }, eip155?: { accounts?: string[] } } } | null | undefined} session
 * @param {string} [chainId]
 */
export function walletConnectSessionIsEvmOnly(session, chainId = "tron:0x2b6653dc") {
  if (!session || typeof session !== "object") return false;
  const tronAddress = tronAddressFromWalletConnectSession(session, chainId);
  if (tronAddress) return false;
  const eip155 = session.namespaces?.eip155?.accounts;
  return Array.isArray(eip155) && eip155.length > 0;
}

/**
 * Require a genuine TRON session address (`T...`). Never treat a public lookup alone as connectivity.
 * @param {string} address
 * @param {"evm" | "tron"} network
 * @returns {{ ok: true, address: string } | { ok: false, error: string }}
 */
export function requireGenuineTronSessionAddress(address, network) {
  const trimmed = typeof address === "string" ? address.trim() : "";
  if (network !== "tron") {
    return {
      ok: false,
      error: `A TRON mainnet wallet session is required. ${trustWalletSwitchToTronMessage()}`,
    };
  }
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trimmed)) {
    return {
      ok: false,
      error: `The connected wallet did not return a TRON address (T…). ${trustWalletSwitchToTronMessage()}`,
    };
  }
  return { ok: true, address: trimmed };
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
