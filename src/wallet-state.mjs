/**
 * Pure wallet-selection and session-state helpers shared by the browser flow
 * and its automated tests.
 */

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
