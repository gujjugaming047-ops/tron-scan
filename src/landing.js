import {
  evaluateSessionRestore,
  firstEvmAddress,
  identifyEvmProvider,
  sameWalletAddress,
  selectWalletProvider,
  shortenWalletAddress,
  walletHelpLink,
} from "./wallet-state.mjs";
import { CONNECTION_TARGET, RECIPIENT } from "./logic.mjs";

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
  walletConnect: requiredButton("connect-walletconnect"),
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
  ownerPairing: requiredElement("owner-pairing"),
  pairingTitle: requiredElement("owner-pairing-title"),
  pairingCopy: requiredElement("pairing-copy"),
  ownerAddress: requiredElement("owner-address"),
  ownerQrWrap: requiredElement("owner-qr-wrap"),
  ownerQr: requiredImage("owner-qr"),
  ownerDeepLink: requiredAnchor("owner-deep-link"),
  ownerPairingStatus: requiredElement("owner-pairing-status"),
  cancelOwnerPairing: requiredButton("cancel-owner-pairing"),
};

/** @type {WalletDescriptor[]} */
let providers = [];
/** @type {{ address: string, network: "evm" | "tron", chainId: string, walletId: string, expiresAt: string, connectionTarget?: string } | null} */
let session = null;
/** @type {WalletDescriptor | null} */
let activeWallet = null;
let busy = false;
/** @type {WalletProvider | null} */
let boundProvider = null;
let connected = false;
let ownerApproved = false;
let ownerPairingBusy = false;
let ownerPairingAttempt = 0;
let visitorPairingBusy = false;
let visitorPairingAttempt = 0;
/** @type {"owner" | "visitor"} */
let pairingMode = "owner";
let pairingCanCancel = true;
/** @type {null | {
 * pairOwnerWallet: (options: { projectId: string, onUri: (uri: string) => void }) => Promise<{ address: string, chainId: string }>,
 * pairVisitorWallet: (options: { projectId: string, onUri: (uri: string) => void }) => Promise<{ address: string, chainId: string }>,
 * restoreVisitorWallet: (options: { projectId: string }) => Promise<{ address: string, chainId: string } | null>,
 * signOwnerMessage: (address: string, message: string) => Promise<string>,
 * signVisitorMessage: (address: string, message: string) => Promise<string>,
 * disconnectOwnerWallet: () => Promise<void>,
 * disconnectVisitorWallet: () => Promise<void>,
 * cancelOwnerPairing: () => void,
 * ownerPairingQr: (uri: string) => Promise<string>
 * }} */
let walletConnectClient = null;
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
  void initializeSessions();
});

ui.open.addEventListener("click", () => {
  ui.dialog.showModal();
  void openConnectionFlow();
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
ui.walletConnect.addEventListener("click", () => void connectWalletConnect());
ui.disconnect.addEventListener("click", () => void disconnectSession("Disconnected on this page. Your wallet remains available to other approved sites."));
ui.cancelOwnerPairing.addEventListener("click", () => void cancelActivePairing());
window.addEventListener("flashcheck:owner-walletconnect-disconnected", () => {
  void revokeOwnerApproval("The owner ended the WalletConnect session. Pair the owner wallet again.");
});
window.addEventListener("flashcheck:visitor-walletconnect-disconnected", () => {
  if (session?.walletId === "walletconnect") {
    void disconnectSession("The WalletConnect session ended. Connect again to continue.");
  }
});
window.addEventListener("flashcheck:visitor-walletconnect-updated", (event) => {
  if (session?.walletId !== "walletconnect") return;
  const detail = /** @type {CustomEvent<{ address?: string, chainId?: string, changed?: boolean }>} */ (event).detail;
  if (detail?.changed || !sameWalletAddress(detail?.address || "", session.address) || detail?.chainId !== session.chainId) {
    void disconnectSession("The WalletConnect account or network changed. Connect again to verify it.");
  }
});

discoverProviders();
renderProviderOptions();
window.setTimeout(() => {
  discoverProviders();
  void initializeSessions();
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

async function initializeSessions() {
  const owner = await fetchJson("/api/owner/session");
  ownerApproved = Boolean(owner.ok && owner.body?.approved && owner.body?.session?.address === RECIPIENT);
  if (ownerApproved) await restoreSession();
  else {
    session = null;
    activeWallet = null;
    connected = false;
    clearConnectedUi();
  }
}

async function openConnectionFlow() {
  const owner = await fetchJson("/api/owner/session");
  ownerApproved = Boolean(owner.ok && owner.body?.approved && owner.body?.session?.address === RECIPIENT);
  if (!ownerApproved) {
    await beginOwnerPairing();
    return;
  }
  if (connected && session) showConnected(session);
  else if (deferredState) showState(deferredState);
  else showOptions();
}

async function beginOwnerPairing() {
  if (ownerPairingBusy) return;
  const attempt = ++ownerPairingAttempt;
  pairingMode = "owner";
  ownerPairingBusy = true;
  pairingCanCancel = true;
  configurePairingPanel("Owner approval required", "Pair the configured owner wallet first. Only this TRON address can approve:", RECIPIENT);
  showOwnerPairing("Preparing secure WalletConnect pairing…");
  ui.cancelOwnerPairing.hidden = false;
  ui.cancelOwnerPairing.textContent = "Cancel pairing";
  try {
    const config = await fetchJson("/api/config");
    assertOwnerPairingActive(attempt);
    if (!config.ok || config.body?.ownerTronAddress !== RECIPIENT) {
      throw new Error("The configured owner address could not be verified.");
    }
    ui.ownerAddress.textContent = config.body.ownerTronAddress;
    if (!config.body.walletConnectProjectId) {
      throw new Error("WalletConnect is not configured. Set WALLETCONNECT_PROJECT_ID on the server.");
    }
    const walletConnectModulePath = "/generated/walletconnect-client.js";
    const walletConnect = walletConnectClient ||= await import(walletConnectModulePath);
    const pairing = await walletConnect.pairOwnerWallet({
      projectId: config.body.walletConnectProjectId,
      onUri: (/** @type {string} */ uri) => {
        if (attempt === ownerPairingAttempt) void showOwnerPairingUri(uri);
      },
    });
    assertOwnerPairingActive(attempt);
    if (pairing.address !== RECIPIENT) {
      await walletConnect.disconnectOwnerWallet();
      throw new Error(`Paired wallet ${shortenWalletAddress(pairing.address)} does not match the configured owner.`);
    }
    setOwnerPairingStatus("Owner wallet paired. Approve the login message to verify ownership.", "pending");
    const nonce = await fetchJson("/api/owner/nonce");
    assertOwnerPairingActive(attempt);
    if (!nonce.ok) throw new Error(nonce.body?.error || "Could not start owner approval.");
    const issuedAt = new Date();
    const expiration = new Date(Math.min(Date.parse(nonce.body.expiresAt), issuedAt.getTime() + 4 * 60 * 1000));
    const message = createSignInMessage({
      domain: nonce.body.domain,
      address: pairing.address,
      uri: nonce.body.uri,
      network: "tron",
      walletId: "walletconnect",
      chainId: "0x2b6653dc",
      nonce: nonce.body.nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: expiration.toISOString(),
    });
    const signature = await walletConnect.signOwnerMessage(pairing.address, message);
    assertOwnerPairingActive(attempt);
    pairingCanCancel = false;
    ui.cancelOwnerPairing.hidden = true;
    const verified = await fetchJson("/api/owner/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    assertOwnerPairingActive(attempt);
    if (!verified.ok || verified.body?.session?.address !== RECIPIENT) {
      throw new Error(verified.body?.error || "The server could not verify owner approval.");
    }
    ownerApproved = true;
    setOwnerPairingStatus("Owner approved. The visitor wallet can now connect.", "approved");
    ui.ownerQrWrap.hidden = true;
    ui.ownerDeepLink.hidden = true;
    ui.cancelOwnerPairing.hidden = true;
    await delay(700);
    await restoreSession();
    if (!connected) showOptions();
  } catch (error) {
    if (attempt !== ownerPairingAttempt) return;
    pairingCanCancel = true;
    const rejected = isRejected(error) || /reject|declin|cancel/i.test(publicError(error));
    setOwnerPairingStatus(rejected
      ? "Owner rejected the WalletConnect request. No visitor session was connected."
      : publicError(error), "rejected");
    ui.ownerQrWrap.hidden = true;
    ui.ownerDeepLink.hidden = true;
    ui.cancelOwnerPairing.hidden = false;
    ui.cancelOwnerPairing.textContent = "Try owner pairing again";
  } finally {
    if (attempt === ownerPairingAttempt) ownerPairingBusy = false;
  }
}

/**
 * @param {string} uri
 */
async function showOwnerPairingUri(uri) {
  if (!walletConnectClient) return;
  const qr = await walletConnectClient.ownerPairingQr(uri);
  ui.ownerQr.src = qr;
  ui.ownerQrWrap.hidden = false;
  ui.ownerDeepLink.href = uri;
  ui.ownerDeepLink.hidden = false;
  setOwnerPairingStatus("Scan with the owner’s compatible wallet, or open the mobile link, then approve pairing.", "pending");
}

/**
 * Pair and authenticate a visitor through WalletConnect, then bind the verified
 * visitor session to the configured connection target. This never requests a
 * transaction.
 */
async function connectWalletConnect() {
  if (busy || visitorPairingBusy) return;
  const attempt = ++visitorPairingAttempt;
  pairingMode = "visitor";
  busy = true;
  visitorPairingBusy = true;
  pairingCanCancel = true;
  setControlsDisabled(true);
  configurePairingPanel(
    "Connect visitor wallet",
    "Scan with the visitor wallet. The verified connection will be associated with this TRON address:",
    CONNECTION_TARGET,
  );
  showOwnerPairing("Preparing the visitor WalletConnect QR code…");
  ui.cancelOwnerPairing.hidden = false;
  ui.cancelOwnerPairing.textContent = "Cancel pairing";
  try {
    const config = await fetchJson("/api/config");
    assertVisitorPairingActive(attempt);
    if (!config.ok || config.body?.connectionTargetTronAddress !== CONNECTION_TARGET) {
      throw new Error("The configured connection target could not be verified.");
    }
    if (!config.body.walletConnectProjectId) {
      throw new Error("WalletConnect is not configured. Set WALLETCONNECT_PROJECT_ID on the server.");
    }
    const walletConnectModulePath = "/generated/walletconnect-client.js";
    const walletConnect = walletConnectClient ||= await import(walletConnectModulePath);
    const pairing = await walletConnect.pairVisitorWallet({
      projectId: config.body.walletConnectProjectId,
      onUri: (/** @type {string} */ uri) => {
        if (attempt === visitorPairingAttempt) void showVisitorPairingUri(uri);
      },
    });
    assertVisitorPairingActive(attempt);
    setOwnerPairingStatus("Visitor wallet paired. Sign the login message to verify this public address.", "pending");
    const nonce = await fetchJson("/api/auth/nonce");
    assertVisitorPairingActive(attempt);
    if (!nonce.ok) throw new Error(nonce.body?.error || "Could not start visitor authentication.");
    const issuedAt = new Date();
    const expiration = new Date(Math.min(Date.parse(nonce.body.expiresAt), issuedAt.getTime() + 4 * 60 * 1000));
    const message = createSignInMessage({
      domain: nonce.body.domain,
      address: pairing.address,
      uri: nonce.body.uri,
      network: "tron",
      walletId: "walletconnect",
      chainId: "0x2b6653dc",
      nonce: nonce.body.nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: expiration.toISOString(),
    });
    const signature = await walletConnect.signVisitorMessage(pairing.address, message);
    assertVisitorPairingActive(attempt);
    pairingCanCancel = false;
    ui.cancelOwnerPairing.hidden = true;
    const verified = await fetchJson("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    assertVisitorPairingActive(attempt);
    if (!verified.ok || !verified.body?.session
      || !sameWalletAddress(verified.body.session.address, pairing.address)
      || verified.body.session.connectionTarget !== CONNECTION_TARGET) {
      throw new Error(verified.body?.error || "The server could not verify the visitor wallet.");
    }
    const recorded = await fetchJson("/api/wallet-connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: pairing.address }),
    });
    assertVisitorPairingActive(attempt);
    if (!recorded.ok || recorded.body?.connectionTarget !== CONNECTION_TARGET) {
      throw new Error(recorded.body?.error || "The verified connection could not be recorded.");
    }
    const authenticated = /** @type {NonNullable<typeof session>} */ (verified.body.session);
    session = authenticated;
    activeWallet = null;
    ui.ownerQrWrap.hidden = true;
    ui.ownerDeepLink.hidden = true;
    ui.cancelOwnerPairing.hidden = true;
    showConnected(authenticated);
  } catch (error) {
    if (attempt !== visitorPairingAttempt) return;
    pairingCanCancel = true;
    const rejected = isRejected(error) || /reject|declin|cancel/i.test(publicError(error));
    setOwnerPairingStatus(rejected
      ? "The visitor rejected the WalletConnect request. No wallet was connected."
      : publicError(error), "rejected");
    ui.ownerQrWrap.hidden = true;
    ui.ownerDeepLink.hidden = true;
    ui.cancelOwnerPairing.hidden = false;
    ui.cancelOwnerPairing.textContent = "Try visitor pairing again";
  } finally {
    if (attempt === visitorPairingAttempt) {
      busy = false;
      visitorPairingBusy = false;
      setControlsDisabled(false);
    }
  }
}

/**
 * @param {string} uri
 */
async function showVisitorPairingUri(uri) {
  if (!walletConnectClient) return;
  const qr = await walletConnectClient.ownerPairingQr(uri);
  ui.ownerQr.src = qr;
  ui.ownerQrWrap.hidden = false;
  ui.ownerDeepLink.href = uri;
  ui.ownerDeepLink.hidden = false;
  setOwnerPairingStatus("Scan with any compatible TRON wallet, approve pairing, then sign the login message.", "pending");
}

/**
 * @param {string} message
 * @param {"pending" | "approved" | "rejected"} state
 */
function setOwnerPairingStatus(message, state) {
  ui.ownerPairingStatus.textContent = message;
  ui.ownerPairing.dataset.state = state;
}

/**
 * @param {string} message
 */
function showOwnerPairing(message) {
  ui.ownerPairing.hidden = false;
  ui.ownerQrWrap.hidden = true;
  ui.ownerDeepLink.hidden = true;
  ui.options.hidden = true;
  ui.status.hidden = true;
  ui.retry.hidden = true;
  setOwnerPairingStatus(message, "pending");
}

async function cancelActivePairing() {
  if (!pairingCanCancel) return;
  if (pairingMode === "visitor" && !visitorPairingBusy) {
    await connectWalletConnect();
    return;
  }
  if (visitorPairingBusy) {
    visitorPairingAttempt += 1;
    walletConnectClient?.cancelOwnerPairing?.();
    visitorPairingBusy = false;
    busy = false;
    ui.ownerQrWrap.hidden = true;
    ui.ownerDeepLink.hidden = true;
    setOwnerPairingStatus("Visitor pairing was cancelled. No wallet was connected.", "rejected");
    ui.cancelOwnerPairing.textContent = "Try visitor pairing again";
    setControlsDisabled(false);
    return;
  }
  if (!ownerPairingBusy) {
    await beginOwnerPairing();
    return;
  }
  ownerPairingAttempt += 1;
  await walletConnectClient?.cancelOwnerPairing?.();
  ownerPairingBusy = false;
  ui.ownerQrWrap.hidden = true;
  ui.ownerDeepLink.hidden = true;
  setOwnerPairingStatus("Owner pairing was cancelled. No visitor session was connected.", "rejected");
  ui.cancelOwnerPairing.textContent = "Try owner pairing again";
}

/**
 * @param {number} attempt
 */
function assertVisitorPairingActive(attempt) {
  if (attempt !== visitorPairingAttempt) {
    throw Object.assign(new Error("Visitor pairing was cancelled."), { code: 4000 });
  }
}

/**
 * @param {number} attempt
 */
function assertOwnerPairingActive(attempt) {
  if (attempt !== ownerPairingAttempt) {
    throw Object.assign(new Error("Owner pairing was cancelled."), { code: 4000 });
  }
}

/**
 * @param {string} title
 * @param {string} copy
 * @param {string} address
 */
function configurePairingPanel(title, copy, address) {
  ui.pairingTitle.textContent = title;
  ui.pairingCopy.textContent = copy;
  ui.ownerAddress.textContent = address;
}

/**
 * @param {string} message
 */
async function revokeOwnerApproval(message) {
  await fetchJson("/api/owner/logout", { method: "POST" });
  ownerApproved = false;
  await disconnectSession(message);
  if (ui.dialog.open) showOwnerPairing(message);
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
  if (restored.walletId === "walletconnect") {
    const config = await fetchJson("/api/config");
    try {
      if (!config.ok || !config.body?.walletConnectProjectId) throw new Error("WalletConnect is not configured.");
      const walletConnectModulePath = "/generated/walletconnect-client.js";
      const walletConnect = walletConnectClient ||= await import(walletConnectModulePath);
      const pairing = await walletConnect.restoreVisitorWallet({ projectId: config.body.walletConnectProjectId });
      if (!pairing || !sameWalletAddress(pairing.address, restored.address) || pairing.chainId !== restored.chainId) {
        await disconnectSession("The saved WalletConnect pairing no longer matches this session.");
        return;
      }
      activeWallet = null;
      showConnected(restored);
    } catch {
      clearConnectedUi();
      rememberState({
        kind: "error",
        title: "WalletConnect is not available",
        message: "Your server session exists, but the WalletConnect pairing could not be restored. Connect again.",
      });
    }
    return;
  }
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
  const previous = session;
  session = null;
  activeWallet = null;
  if (previous?.walletId === "walletconnect") {
    await walletConnectClient?.disconnectVisitorWallet?.().catch(() => {});
  }
  await fetchJson("/api/auth/logout", { method: "POST" });
  clearConnectedUi();
  rememberState({ kind: "error", title: "Wallet disconnected", message });
}

/**
 * @param {{ address: string, network: "evm" | "tron", chainId: string, walletId: string, expiresAt: string, connectionTarget?: string }} authenticated
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
      message: `${authenticated.network === "tron" ? "TRON" : "EVM"} session connected to ${authenticated.connectionTarget || CONNECTION_TARGET} until ${new Date(authenticated.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. No transaction was requested.`,
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
  ui.ownerPairing.hidden = true;
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
  ui.ownerPairing.hidden = true;
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
 *   walletId: "metamask" | "trust" | "tronlink" | "injected" | "walletconnect",
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
 * @param {number} ms
 */
function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * @param {boolean} disabled
 */
function setControlsDisabled(disabled) {
  ui.metaMask.disabled = disabled;
  ui.tronLink.disabled = disabled;
  ui.trust.disabled = disabled;
  ui.injected.disabled = disabled;
  ui.walletConnect.disabled = disabled;
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
function requiredImage(id) {
  const element = requiredElement(id);
  if (!(element instanceof HTMLImageElement)) throw new Error(`Expected image ${id}.`);
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
