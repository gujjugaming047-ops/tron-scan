import {
  evaluateSessionRestore,
  firstEvmAddress,
  identifyEvmProvider,
  sameWalletAddress,
  selectWalletProvider,
  shortenWalletAddress,
  walletHelpLink,
} from "./wallet-state.mjs";

/**
 * @typedef {object} WalletProvider
 * @property {(args: { method: string, params?: unknown[] }) => Promise<any>} request
 * @property {any} [tronWeb]
 * @property {(event: string, listener: (...args: any[]) => void) => void} [on]
 * @property {boolean} [isMetaMask]
 * @property {boolean} [isTrust]
 */

/**
 * @typedef {object} WalletDescriptor
 * @property {"metamask" | "trust" | "tronlink" | "injected"} id
 * @property {"evm" | "tron"} network
 * @property {string} name
 * @property {string} [rdns]
 * @property {WalletProvider} provider
 */

const ui = {
  dialog: requiredDialog("wallet-dialog"),
  open: requiredButton("open-wallet-flow"),
  close: requiredButton("close-wallet-flow"),
  metaMask: requiredButton("connect-metamask"),
  tronLink: requiredButton("connect-tronlink"),
  trust: requiredButton("connect-trust"),
  injected: requiredButton("connect-injected"),
  injectedName: requiredElement("injected-wallet-name"),
  retry: requiredButton("retry-wallets"),
  continueReadOnly: requiredAnchor("continue-read-only"),
  options: requiredElement("wallet-options"),
  status: requiredElement("wallet-status"),
  statusMark: requiredElement("status-mark"),
  statusTitle: requiredElement("status-title"),
  statusMessage: requiredElement("status-message"),
  address: requiredElement("connected-address"),
  help: requiredAnchor("wallet-help"),
  chip: requiredElement("connected-chip"),
  headerAddress: requiredElement("header-address"),
  disconnect: requiredButton("disconnect-wallet"),
};

/** @type {WalletDescriptor[]} */
let providers = [];
/** @type {{ address: string, network: "evm" | "tron", chainId: string, walletId: string, expiresAt: string } | null} */
let session = null;
/** @type {WalletDescriptor | null} */
let activeWallet = null;
let busy = false;
/** @type {WalletProvider | null} */
let boundProvider = null;
let connected = false;
/** @type {{ kind: "pending" | "success" | "error", title: string, message: string, address?: string, help?: { href: string, label: string } | null } | null} */
let deferredState = null;

window.addEventListener("eip6963:announceProvider", (event) => {
  const detail = /** @type {CustomEvent<{ info?: { name?: string, rdns?: string }, provider?: WalletProvider }>} */ (event).detail;
  if (!detail?.provider) return;
  addProvider(describeEvmProvider(detail.provider, detail.info?.name, detail.info?.rdns));
  renderProviderOptions();
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
window.addEventListener("tronLink#initialized", () => {
  discoverProviders();
  void restoreSession();
});

ui.open.addEventListener("click", () => {
  if (connected && session && activeWallet) showConnected(session);
  else if (deferredState) showState(deferredState);
  else showOptions();
  ui.dialog.showModal();
});
ui.close.addEventListener("click", () => ui.dialog.close());
ui.retry.addEventListener("click", showOptions);
ui.continueReadOnly.addEventListener("click", () => ui.dialog.close());
ui.dialog.addEventListener("click", (event) => {
  if (event.target === ui.dialog) ui.dialog.close();
});
ui.metaMask.addEventListener("click", () => void connectSelected("metamask"));
ui.tronLink.addEventListener("click", () => void connectSelected("tronlink"));
ui.trust.addEventListener("click", () => void connectSelected("trust"));
ui.injected.addEventListener("click", () => void connectSelected("injected"));
ui.disconnect.addEventListener("click", () => void disconnectSession("Disconnected on this page. Your wallet remains available to other approved sites."));

discoverProviders();
renderProviderOptions();
window.setTimeout(() => {
  discoverProviders();
  void restoreSession();
}, 350);

function discoverProviders() {
  const view = /** @type {Window & {
   * ethereum?: WalletProvider & { providers?: WalletProvider[] },
   * trustwallet?: { ethereum?: WalletProvider, tronLink?: WalletProvider },
   * tronLink?: WalletProvider,
   * tron?: WalletProvider
   * }} */ (window);
  const ethereumCandidates = [
    view.trustwallet?.ethereum,
    ...(Array.isArray(view.ethereum?.providers) ? view.ethereum.providers : []),
    view.ethereum,
  ];
  for (const candidate of ethereumCandidates) {
    if (candidate && typeof candidate.request === "function") addProvider(describeEvmProvider(candidate));
  }
  const trustTron = view.trustwallet?.tronLink;
  if (trustTron && typeof trustTron.request === "function") {
    addProvider({ id: "trust", network: "tron", name: "Trust Wallet", provider: trustTron });
  }
  const tronLink = view.tronLink || view.tron;
  if (tronLink && typeof tronLink.request === "function") {
    addProvider({ id: "tronlink", network: "tron", name: "TronLink", provider: tronLink });
  }
}

/**
 * @param {WalletProvider} provider
 * @param {string} [announcedName]
 * @param {string} [rdns]
 * @returns {WalletDescriptor}
 */
function describeEvmProvider(provider, announcedName, rdns) {
  const identity = identifyEvmProvider(provider, announcedName, rdns);
  return {
    id: identity.id,
    network: "evm",
    name: identity.name,
    rdns,
    provider,
  };
}

/**
 * @param {WalletDescriptor} descriptor
 */
function addProvider(descriptor) {
  if (providers.some((item) => item.provider === descriptor.provider)) return;
  providers.push(descriptor);
}

function renderProviderOptions() {
  ui.metaMask.dataset.detected = String(Boolean(selectProvider("metamask")));
  ui.tronLink.dataset.detected = String(Boolean(selectProvider("tronlink")));
  ui.trust.dataset.detected = String(Boolean(selectProvider("trust")));
  const injected = selectProvider("injected");
  ui.injected.hidden = !injected;
  if (injected) ui.injectedName.textContent = injected.name;
}

/**
 * @param {"metamask" | "trust" | "tronlink" | "injected"} id
 */
function selectProvider(id) {
  const trustInApp = id === "trust" && /Trust/i.test(navigator.userAgent);
  return selectWalletProvider(providers, id, trustInApp ? "tron" : null);
}

async function restoreSession() {
  const response = await fetchJson("/api/auth/session");
  if (!response.ok || !response.body?.session) {
    session = null;
    activeWallet = null;
    connected = false;
    deferredState = null;
    clearConnectedUi();
    return;
  }
  const restored = /** @type {NonNullable<typeof session>} */ (response.body.session);
  session = restored;
  discoverProviders();
  const wallet = providers.find((item) => item.id === restored.walletId && item.network === restored.network);
  if (!wallet) {
    activeWallet = null;
    clearConnectedUi();
    rememberState({
      kind: "error",
      title: "Wallet is not available",
      message: "Your verified session is still valid, but its wallet provider is not available in this browser.",
      help: mobileHelp(/** @type {any} */ (restored.walletId)),
    });
    return;
  }
  const current = await readAuthorizedAccount(wallet);
  const currentChain = current ? await readChainId(wallet) : "";
  const restoreState = evaluateSessionRestore(restored, wallet, current, currentChain);
  if (restoreState === "locked") {
    activeWallet = wallet;
    clearConnectedUi();
    rememberState({
      kind: "error",
      title: "Wallet is locked",
      message: "Unlock the wallet to restore your verified session. You will not be asked to sign again while the session remains valid.",
    });
    return;
  }
  if (restoreState === "changed") {
    await disconnectSession("The wallet account or network changed. Connect again to verify the new selection.");
    return;
  }
  activeWallet = wallet;
  bindWalletEvents(wallet);
  showConnected(restored);
}

/**
 * @param {"metamask" | "trust" | "tronlink" | "injected"} walletId
 */
async function connectSelected(walletId) {
  if (busy) return;
  discoverProviders();
  const wallet = selectProvider(walletId);
  if (!wallet) {
    const displayName = walletId === "metamask" ? "MetaMask" : walletId === "tronlink" ? "TronLink" : walletId === "trust" ? "Trust Wallet" : "Browser wallet";
    showState({
      kind: "error",
      title: `${displayName} was not detected`,
      message: missingWalletMessage(walletId),
      help: mobileHelp(walletId),
    });
    return;
  }
  busy = true;
  setControlsDisabled(true);
  showState({
    kind: "pending",
    title: "Waiting for your wallet",
    message: "Approve the connection request. If needed, you will then sign a login message—not a transaction.",
  });
  try {
    const address = await requestAccount(wallet);
    if (!address) throw new Error("The wallet did not return an account.");
    const chainId = await readChainId(wallet);
    if (!chainId) throw new Error(wallet.network === "tron" ? "Switch the wallet to TRON mainnet and try again." : "The wallet network could not be read.");

    const existing = await fetchJson("/api/auth/session");
    if (existing.ok && existing.body?.session
      && sameWalletAddress(existing.body.session.address, address)
      && existing.body.session.chainId === chainId
      && existing.body.session.walletId === wallet.id) {
      session = existing.body.session;
    } else {
      session = await authenticate(wallet, address, chainId);
    }
    const authenticated = session;
    if (!authenticated) throw new Error("The verified session could not be restored.");
    activeWallet = wallet;
    bindWalletEvents(wallet);
    showConnected(authenticated);
  } catch (error) {
    const rejected = isRejected(error);
    showState({
      kind: "error",
      title: rejected ? "Connection cancelled" : "Wallet connection failed",
      message: rejected
        ? "You declined the wallet request. Nothing was signed or submitted."
        : publicError(error),
    });
  } finally {
    busy = false;
    setControlsDisabled(false);
  }
}

/**
 * @param {WalletDescriptor} wallet
 * @param {string} address
 * @param {string} chainId
 */
async function authenticate(wallet, address, chainId) {
  const nonceResponse = await fetchJson("/api/auth/nonce");
  if (!nonceResponse.ok) throw new Error(nonceResponse.body?.error || "Could not start secure sign-in.");
  const now = new Date();
  const serverExpiry = Date.parse(nonceResponse.body.expiresAt);
  const expiry = new Date(Math.min(serverExpiry, now.getTime() + 4 * 60 * 1000));
  const message = createSignInMessage({
    domain: nonceResponse.body.domain,
    address,
    uri: nonceResponse.body.uri,
    network: wallet.network,
    walletId: wallet.id,
    chainId,
    nonce: nonceResponse.body.nonce,
    issuedAt: now.toISOString(),
    expirationTime: expiry.toISOString(),
  });
  showState({
    kind: "pending",
    title: "Verify this sign-in",
    message: "Sign the login message in your wallet. This is not a transaction and cannot move funds.",
  });
  const signature = await signLoginMessage(wallet, address, message);
  const verified = await fetchJson("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (!verified.ok || !verified.body?.session) {
    throw new Error(verified.body?.error || "The server could not verify the wallet signature.");
  }
  return verified.body.session;
}

/**
 * @param {WalletDescriptor} wallet
 */
async function requestAccount(wallet) {
  if (wallet.network === "evm") {
    const accounts = await wallet.provider.request({ method: "eth_requestAccounts" });
    return firstEvmAddress(accounts);
  }
  const method = wallet.id === "trust" ? "tron_requestAccounts" : "eth_requestAccounts";
  const result = await wallet.provider.request({ method });
  return findTronAddress(wallet.provider, result);
}

/**
 * @param {WalletDescriptor} wallet
 */
async function readAuthorizedAccount(wallet) {
  try {
    if (wallet.network === "evm") {
      const accounts = await wallet.provider.request({ method: "eth_accounts" });
      return firstEvmAddress(accounts);
    }
    return findTronAddress(wallet.provider, null);
  } catch {
    return "";
  }
}

/**
 * @param {WalletDescriptor} wallet
 */
async function readChainId(wallet) {
  if (wallet.network === "evm") {
    const chainId = await wallet.provider.request({ method: "eth_chainId" });
    if (typeof chainId !== "string" || !/^0x[0-9a-f]+$/i.test(chainId)) return "";
    return BigInt(chainId).toString(10);
  }
  const tronWeb = wallet.provider.tronWeb;
  if (!tronWeb?.trx || typeof tronWeb.trx.getBlockByNumber !== "function") return "";
  const genesis = await tronWeb.trx.getBlockByNumber(0);
  const blockId = typeof genesis?.blockID === "string" ? genesis.blockID.toLowerCase() : "";
  return blockId.endsWith("2b6653dc") ? "0x2b6653dc" : "";
}

/**
 * @param {WalletDescriptor} wallet
 * @param {string} address
 * @param {string} message
 */
async function signLoginMessage(wallet, address, message) {
  if (wallet.network === "evm") {
    return wallet.provider.request({ method: "personal_sign", params: [message, address] });
  }
  const sign = wallet.provider.tronWeb?.trx?.signMessageV2;
  if (typeof sign !== "function") throw new Error("This TRON wallet cannot sign a login message.");
  return sign.call(wallet.provider.tronWeb.trx, message);
}

/**
 * @param {WalletDescriptor} wallet
 */
function bindWalletEvents(wallet) {
  if (boundProvider === wallet.provider || typeof wallet.provider.on !== "function") return;
  boundProvider = wallet.provider;
  wallet.provider.on("accountsChanged", () => void handleWalletChange("The wallet account changed."));
  wallet.provider.on("chainChanged", () => void handleWalletChange("The wallet network changed."));
  wallet.provider.on("disconnect", () => void disconnectSession("The wallet disconnected. Connect again to continue."));
}

/**
 * @param {string} message
 */
async function handleWalletChange(message) {
  if (!activeWallet || !session) return;
  const address = await readAuthorizedAccount(activeWallet);
  const chainId = address ? await readChainId(activeWallet) : "";
  if (address && sameWalletAddress(address, session.address) && chainId === session.chainId) return;
  await disconnectSession(`${message} Connect again to verify the new account and network.`);
  if (ui.dialog.open) showState({ kind: "error", title: "Wallet selection changed", message: `${message} Sign in again to continue.` });
}

/**
 * @param {string} message
 */
async function disconnectSession(message) {
  await fetchJson("/api/auth/logout", { method: "POST" });
  session = null;
  activeWallet = null;
  clearConnectedUi();
  rememberState({ kind: "error", title: "Wallet disconnected", message });
}

/**
 * @param {{ address: string, network: "evm" | "tron", chainId: string, walletId: string, expiresAt: string }} authenticated
 */
function showConnected(authenticated) {
  session = authenticated;
  connected = true;
  deferredState = null;
  ui.chip.hidden = false;
  ui.headerAddress.textContent = shortenWalletAddress(authenticated.address);
  ui.open.textContent = "Continue Flash USDT Check";
  const arrow = document.createElement("span");
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "→";
  ui.open.append(arrow);
  if (ui.dialog.open) {
    showState({
      kind: "success",
      title: "Wallet verified",
      message: `${authenticated.network === "tron" ? "TRON" : "EVM"} session active until ${new Date(authenticated.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. No transaction was requested.`,
      address: authenticated.address,
    });
  }
}

function clearConnectedUi() {
  connected = false;
  ui.chip.hidden = true;
  ui.headerAddress.textContent = "";
  ui.open.replaceChildren("Start Flash USDT Check");
  const arrow = document.createElement("span");
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "→";
  ui.open.append(arrow);
}

function showOptions() {
  deferredState = null;
  discoverProviders();
  renderProviderOptions();
  ui.options.hidden = false;
  ui.status.hidden = true;
  ui.retry.hidden = true;
  ui.help.hidden = true;
  ui.address.hidden = true;
  setControlsDisabled(false);
}

/**
 * @param {{ kind: "pending" | "success" | "error", title: string, message: string, address?: string, help?: { href: string, label: string } | null }} next
 */
function showState(next) {
  deferredState = next;
  ui.options.hidden = true;
  ui.status.hidden = false;
  ui.status.dataset.kind = next.kind;
  ui.statusMark.textContent = next.kind === "success" ? "✓" : next.kind === "error" ? "!" : "";
  ui.statusTitle.textContent = next.title;
  ui.statusMessage.textContent = next.message;
  ui.address.textContent = next.address || "";
  ui.address.hidden = !next.address;
  ui.help.hidden = !next.help;
  if (next.help) {
    ui.help.href = next.help.href;
    ui.help.textContent = `${next.help.label} ↗`;
  }
  ui.retry.hidden = next.kind === "pending";
}

/**
 * @param {{ kind: "pending" | "success" | "error", title: string, message: string, address?: string, help?: { href: string, label: string } | null }} next
 */
function rememberState(next) {
  deferredState = next;
  if (ui.dialog.open) showState(next);
}

/**
 * @param {{
 *   domain: string,
 *   address: string,
 *   uri: string,
 *   network: "evm" | "tron",
 *   walletId: "metamask" | "trust" | "tronlink" | "injected",
 *   chainId: string,
 *   nonce: string,
 *   issuedAt: string,
 *   expirationTime: string
 * }} fields
 */
function createSignInMessage(fields) {
  const accountLabel = fields.network === "tron" ? "TRON" : "Ethereum";
  return `${fields.domain} wants you to sign in with your ${accountLabel} account:
${fields.address}

Sign in to FlashCheck. This request does not authorize a transaction.

URI: ${fields.uri}
Version: 1
Network: ${fields.network}
Wallet ID: ${fields.walletId}
Chain ID: ${fields.chainId}
Nonce: ${fields.nonce}
Issued At: ${fields.issuedAt}
Expiration Time: ${fields.expirationTime}`;
}

/**
 * @param {WalletProvider} provider
 * @param {unknown} result
 */
function findTronAddress(provider, result) {
  const candidates = [provider.tronWeb?.defaultAddress?.base58, ...collectStrings(result)];
  const address = candidates.find((item) => typeof item === "string" && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(item));
  return typeof address === "string" ? address : "";
}

/**
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {string[]}
 */
function collectStrings(value, depth = 0) {
  if (depth > 4) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item, depth + 1));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => ["message", "signature", "stack"].includes(key) ? [] : collectStrings(item, depth + 1));
}

/**
 * @param {"metamask" | "trust" | "tronlink" | "injected"} walletId
 */
function missingWalletMessage(walletId) {
  if (walletId === "metamask") return "Install or unlock MetaMask, or open this page in its mobile browser.";
  if (walletId === "trust") return "Open this page in Trust Wallet’s browser and choose an EVM or TRON account.";
  if (walletId === "tronlink") return "Install or unlock TronLink, or open this page in the TronLink mobile browser.";
  return "No additional injected wallet provider was found.";
}

/**
 * @param {"metamask" | "trust" | "tronlink" | "injected"} walletId
 */
function mobileHelp(walletId) {
  return walletHelpLink(walletId, {
    mobile: isMobile(),
    href: window.location.href,
    host: window.location.host,
    pathname: window.location.pathname,
  });
}

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * @param {unknown} error
 */
function isRejected(error) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = /** @type {{ code?: unknown }} */ (error).code;
  return code === 4000 || code === 4001;
}

/**
 * @param {unknown} error
 */
function publicError(error) {
  if (error instanceof Error && error.message && !/stack|private|seed|secret/i.test(error.message)) return error.message;
  return "The wallet could not complete secure sign-in. Unlock it and try again.";
}

/**
 * @param {string} url
 * @param {RequestInit} [options]
 */
async function fetchJson(url, options) {
  try {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: { error: "The authentication server is unavailable." } };
  }
}

/**
 * @param {boolean} disabled
 */
function setControlsDisabled(disabled) {
  ui.metaMask.disabled = disabled;
  ui.tronLink.disabled = disabled;
  ui.trust.disabled = disabled;
  ui.injected.disabled = disabled;
  ui.close.disabled = disabled;
}

/**
 * @param {string} id
 */
function requiredElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element ${id}.`);
  return element;
}

/**
 * @param {string} id
 */
function requiredButton(id) {
  const element = requiredElement(id);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Expected button ${id}.`);
  return element;
}

/**
 * @param {string} id
 */
function requiredAnchor(id) {
  const element = requiredElement(id);
  if (!(element instanceof HTMLAnchorElement)) throw new Error(`Expected link ${id}.`);
  return element;
}

/**
 * @param {string} id
 */
function requiredDialog(id) {
  const element = requiredElement(id);
  if (!(element instanceof HTMLDialogElement)) throw new Error(`Expected dialog ${id}.`);
  return element;
}
