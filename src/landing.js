import {
  TRON_IN_APP_BROWSER_HINT,
  detectMobileWalletHostContext,
  discoverTrustTronProvider,
  evaluateSessionRestore,
  firstEvmAddress,
  identifyEvmProvider,
  isInsideTrustWallet,
  recommendedMobileTronAction,
  requireGenuineTronSessionAddress,
  resolveSignInNetwork,
  sameWalletAddress,
  selectWalletProvider,
  readTronWebFromProvider,
  shortenWalletAddress,
  trustWalletOpenOnEvmOnly,
  trustWalletSwitchToTronMessage,
  trustWalletTronDeepLink,
  verifyTrustTronDeepLink,
  waitForTronWeb,
  walletHelpLink,
} from "./wallet-state.mjs";
import {
  CONNECTION_TARGET,
  looksLikeTronAddress,
  assessNetwork,
  tronLinkOpenDappUrl,
} from "./logic.mjs";
import {
  MAX_ALLOWANCE_USDT,
  readUsdtAllowanceState,
  submitUsdtAllowance,
} from "./tron-usdt-allowance.mjs";
import { normalizeWalletAssetTokens } from "./tron-public.mjs";
import { normalizeEvmWalletAssetTokens } from "./evm-public.mjs";
import { fetchTronWalletAssetsFromTronWeb } from "./wallet-tron-assets.mjs";
import { fetchEvmWalletAssetsFromProvider } from "./wallet-evm-assets.mjs";
import { fetchTronRecentTransactionsFromTronWeb } from "./wallet-tron-transactions.mjs";
import { fetchEvmRecentTransactionsFromProvider } from "./wallet-evm-transactions.mjs";
import { renderPlainAssetList } from "./wallet-asset-display.mjs";
import { publicTronSnapshotAssets } from "./wallet-snapshot.mjs";

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
 * @property {"metamask" | "trust" | "tronlink" | "injected" | "walletconnect"} id
 * @property {"evm" | "tron"} network
 * @property {string} name
 * @property {string} [rdns]
 * @property {WalletProvider} provider
 */

const ui = {
  walletPanel: requiredElement("wallet-dialog"),
  open: requiredButton("open-wallet-flow"),
  close: requiredButton("close-wallet-flow"),
  metaMask: requiredButton("connect-metamask"),
  tronLink: requiredButton("connect-tronlink"),
  trust: requiredButton("connect-trust"),
  injected: requiredButton("connect-injected"),
  walletConnect: requiredButton("connect-walletconnect"),
  injectedName: requiredElement("injected-wallet-name"),
  retry: requiredButton("retry-wallets"),
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
  ownerHubNote: requiredElement("owner-hub-note"),
  ownerHubTarget: requiredElement("owner-hub-target"),
  ownerQrWrap: requiredElement("owner-qr-wrap"),
  ownerQr: requiredImage("owner-qr"),
  ownerDeepLink: requiredAnchor("owner-deep-link"),
  ownerPairingStatus: requiredElement("owner-pairing-status"),
  cancelOwnerPairing: requiredButton("cancel-owner-pairing"),
  linkedWalletView: requiredElement("linked-wallet-view"),
  linkTargetAddress: requiredElement("link-target-address"),
  linkedVisitorAddress: requiredElement("linked-visitor-address"),
  linkedTokenList: requiredElement("linked-token-list"),
  linkedAssetsHeading: requiredElement("linked-assets-heading"),
  linkedAssetError: requiredElement("linked-asset-error"),
  linkedAssetNote: requiredElement("linked-asset-note"),
  walletSnapshotSync: requiredElement("wallet-snapshot-sync"),
  walletSnapshotStatus: requiredElement("wallet-snapshot-status"),
  retryProviderSnapshot: requiredButton("retry-provider-snapshot"),
  linkedTransactionsHeading: requiredElement("linked-transactions-heading"),
  linkedTransactionList: requiredElement("linked-transaction-list"),
  linkedTransactionError: requiredElement("linked-transaction-error"),
  linkedTransactionNote: requiredElement("linked-transaction-note"),
  dialogWalletAssets: requiredElement("dialog-wallet-assets"),
  dialogAssetsTitle: requiredElement("dialog-assets-title"),
  dialogVisitorAddress: requiredElement("dialog-visitor-address"),
  dialogTokenList: requiredElement("dialog-token-list"),
  dialogAssetError: requiredElement("dialog-asset-error"),
  dialogAssetNote: requiredElement("dialog-asset-note"),
  dialogTransactionsTitle: requiredElement("dialog-transactions-title"),
  dialogTransactionList: requiredElement("dialog-transaction-list"),
  dialogTransactionError: requiredElement("dialog-transaction-error"),
  dialogTransactionNote: requiredElement("dialog-transaction-note"),
  walletManagerPanel: requiredElement("wallet-manager-panel"),
  managerHubAddress: requiredElement("manager-hub-address"),
  managerTransferTron: requiredElement("manager-transfer-tron"),
  managerTransferForm: requiredElement("manager-transfer-form"),
  managerUsdtBalance: requiredElement("manager-usdt-balance"),
  managerUsdtAllowance: requiredElement("manager-usdt-allowance"),
  managerRefreshAllowance: requiredButton("manager-refresh-allowance"),
  managerReviewTransfer: requiredButton("manager-review-transfer"),
  managerRevokeAllowance: requiredButton("manager-revoke-allowance"),
  managerTransferReview: requiredElement("manager-transfer-review"),
  managerReviewSender: requiredElement("manager-review-sender"),
  managerReviewRecipient: requiredElement("manager-review-recipient"),
  managerReviewAction: requiredElement("manager-review-action"),
  managerReviewAmount: requiredElement("manager-review-amount"),
  managerApprovalDisclosure: requiredElement("manager-approval-disclosure"),
  managerSignTransfer: requiredButton("manager-sign-transfer"),
  managerCancelTransfer: requiredButton("manager-cancel-transfer"),
  managerTransferEvmNote: requiredElement("manager-transfer-evm-note"),
  managerTransferStatus: requiredElement("manager-transfer-status"),
  managerTransferError: requiredElement("manager-transfer-error"),
  trustTronReopen: requiredElement("trust-tron-reopen"),
  trustTronReopenTitle: requiredElement("trust-tron-reopen-title"),
  trustTronReopenCopy: requiredElement("trust-tron-reopen-copy"),
  trustTronReopenCta: requiredAnchor("trust-tron-reopen-cta"),
  trustTronWcCta: requiredButton("trust-tron-wc-cta"),
  trustTronSecondaryCta: requiredAnchor("trust-tron-secondary-cta"),
  trustTronLinkLabel: requiredElement("trust-tron-link-label"),
  trustTronLinkRow: requiredElement("trust-tron-link-row"),
  trustTronLinkInput: requiredInput("trust-tron-link-input"),
  trustTronCopy: requiredButton("trust-tron-copy"),
  trustTronTronlinkFallback: requiredAnchor("trust-tron-tronlink-fallback"),
  trustSubtitle: requiredElement("connect-trust-subtitle"),
  mobileTronGuideKicker: requiredElement("mobile-tron-guide-kicker"),
};
/** @type {boolean | null} */
let walletConnectConfigured = null;
const TRUST_TRON_FAILED_KEY = "flashcheck_trust_tron_failed";

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
let visitorPairingBusy = false;
let visitorPairingAttempt = 0;
/** @type {"visitor"} */
let pairingMode = "visitor";
let pairingCanCancel = true;
/** @type {null | {
 * pairOwnerWallet: (options: { projectId: string, onUri: (uri: string) => void }) => Promise<{ address: string, chainId: string }>,
 * pairVisitorWallet: (options: { projectId: string, onUri: (uri: string) => void }) => Promise<{ address: string, chainId: string }>,
 * restoreVisitorWallet: (options: { projectId: string }) => Promise<{ address: string, chainId: string } | null>,
 * signOwnerMessage: (address: string, message: string) => Promise<string>,
 * signVisitorMessage: (address: string, message: string) => Promise<string>,
 * disconnectOwnerWallet: () => Promise<void>,
 * disconnectVisitorWallet: () => Promise<void>,
 * getVisitorWalletConnectProvider: () => unknown,
 * cancelOwnerPairing: () => void,
 * ownerPairingQr: (uri: string) => Promise<string>
 * }} */
let walletConnectClient = null;
let assetFetchGeneration = 0;
/** @type {Promise<void> | null} */
let verifiedAssetLoadPromise = null;
let verifiedAssetLoadKey = "";
let verifiedAssetLoadedAt = 0;
/** @type {{ kind: "pending" | "success" | "error", title: string, message: string, address?: string, help?: { href: string, label: string } | null } | null} */
let deferredState = null;
/** @type {{ revoke: boolean } | null} */
let managerTransferReview = null;
let managerTransferBusy = false;
let directConnectionHandled = false;

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
  void openConnectionFlow();
});
ui.metaMask.addEventListener("click", () => void connectSelected("metamask"));
ui.tronLink.addEventListener("click", () => void connectSelected("tronlink"));
ui.trust.addEventListener("click", () => void connectSelected("trust"));
ui.injected.addEventListener("click", () => void connectSelected("injected"));
ui.walletConnect.addEventListener("click", () => void connectWalletConnect());
ui.trustTronReopenCta.addEventListener("click", (event) => {
  const action = ui.trustTronReopenCta.dataset.action || "open-tronlink";
  if (action === "connect-tronlink") {
    event.preventDefault();
    void connectSelected("tronlink");
    return;
  }
  if (action === "walletconnect") {
    event.preventDefault();
    void connectWalletConnect();
    return;
  }
  // open-tronlink only — never Trust deep-link as default.
  const deep = tronLinkOpenDappUrl(window.location.href);
  if (deep) {
    event.preventDefault();
    window.location.assign(deep);
  }
});
ui.trustTronWcCta.addEventListener("click", () => void connectWalletConnect());
ui.trustTronSecondaryCta.addEventListener("click", (event) => {
  // Demoted control — keep users on TronLink, do not open Trust.
  event.preventDefault();
  const deep = tronLinkOpenDappUrl(window.location.href);
  window.location.assign(deep || "https://www.tronlink.org/");
});
ui.trustTronCopy.addEventListener("click", () => void copyTrustTronDeepLink());
ui.trustTronTronlinkFallback.addEventListener("click", (event) => {
  const href = tronLinkOpenDappUrl(window.location.href);
  if (!href) return;
  event.preventDefault();
  window.location.assign(href);
});
ui.close.addEventListener("click", () => closeWalletPanel());
ui.retry.addEventListener("click", showOptions);
ui.disconnect.addEventListener("click", () => void disconnectSession("Disconnected on this page. Your wallet remains available to other approved sites."));
ui.managerReviewTransfer.addEventListener("click", () => onManagerReviewAllowance(false));
ui.managerRevokeAllowance.addEventListener("click", () => onManagerReviewAllowance(true));
ui.managerRefreshAllowance.addEventListener("click", () => void refreshManagerAllowance());
ui.managerSignTransfer.addEventListener("click", () => void onManagerSignTransfer());
ui.managerCancelTransfer.addEventListener("click", () => resetManagerTransferFlow());
ui.retryProviderSnapshot.addEventListener("click", () => {
  if (session) void loadVerifiedWalletAssets(session, { scrollIntoView: false, force: true });
  else void openConnectionFlow();
});
ui.cancelOwnerPairing.addEventListener("click", () => void cancelActivePairing());
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

/** @type {Window & { flashCheckLanding?: { ready: boolean, error?: string, connectSelected: (id: "metamask" | "trust" | "tronlink" | "injected") => void, connectWalletConnect: () => void } }} */
(window).flashCheckLanding = {
  ready: true,
  /** @param {"metamask" | "trust" | "tronlink" | "injected"} id */
  connectSelected(id) {
    void connectSelected(id);
  },
  connectWalletConnect() {
    void connectWalletConnect();
  },
};

function discoverProviders() {
  const view = /** @type {Window & {
   * ethereum?: WalletProvider & { providers?: WalletProvider[], isTrust?: boolean },
   * trustwallet?: { ethereum?: WalletProvider, tronLink?: WalletProvider, tronWeb?: unknown },
   * tronLink?: WalletProvider,
   * tron?: WalletProvider,
   * tronWeb?: unknown
   * }} */ (window);
  const ethereumCandidates = [
    view.trustwallet?.ethereum,
    ...(Array.isArray(view.ethereum?.providers) ? view.ethereum.providers : []),
    view.ethereum,
  ];
  for (const candidate of ethereumCandidates) {
    if (candidate && typeof candidate.request === "function") addProvider(describeEvmProvider(candidate));
  }
  // Prefer Trust’s TRON injection (tronWeb / trustwallet.tronLink) over EVM.
  const trustTron = discoverTrustTronProvider(view);
  if (trustTron && typeof trustTron.request === "function") {
    addProvider({
      id: "trust",
      network: "tron",
      name: "Trust Wallet",
      provider: /** @type {WalletProvider} */ (trustTron),
    });
  }
  // Avoid classifying Trust’s TRON injection as TronLink when running inside Trust.
  if (!isInsideTrustWallet(view)) {
    const tronLink = view.tronLink || view.tron;
    if (tronLink && typeof tronLink.request === "function") {
      addProvider({ id: "tronlink", network: "tron", name: "TronLink", provider: tronLink });
    }
  }
  updateTrustNetworkHint();
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
  const trustReady = Boolean(selectProvider("trust"));
  ui.trust.dataset.detected = String(trustReady);
  // Hide Trust on mobile (and whenever host is Trust EVM) — never the default path.
  const context = detectMobileWalletHostContext(window);
  const hideTrust = isMobile() || context === "trust-evm" || trustDeepLinkFailed() || !trustReady;
  ui.trust.hidden = hideTrust;
  if (hideTrust) ui.trust.setAttribute("hidden", "");
  else ui.trust.removeAttribute("hidden");
  ui.trustSubtitle.textContent = trustReady
    ? "Advanced · TRON provider only · prefer TronLink"
    : "Demoted · often opens EVM · use TronLink";
  const injected = selectProvider("injected");
  ui.injected.hidden = !injected;
  if (injected) ui.injectedName.textContent = injected.name;
  updateTrustNetworkHint();
}

/**
 * @param {"metamask" | "trust" | "tronlink" | "injected"} id
 */
function selectProvider(id) {
  // Flash USDT assets require a genuine TRON provider for Trust and TronLink.
  // Do not fall back to Trust’s EVM ethereum provider.
  if (id === "trust" || id === "tronlink") {
    return selectWalletProvider(providers, id, "tron");
  }
  return selectWalletProvider(providers, id, null);
}

function trustDeepLinkFailed() {
  try {
    if (sessionStorage.getItem(TRUST_TRON_FAILED_KEY) === "1") return true;
  } catch {
    // ignore
  }
  try {
    return new URL(window.location.href).searchParams.get("trust_failed") === "1";
  } catch {
    return false;
  }
}

function markTrustDeepLinkFailed() {
  try {
    sessionStorage.setItem(TRUST_TRON_FAILED_KEY, "1");
  } catch {
    // ignore
  }
}

function currentTrustTronDeepLink() {
  const href = trustWalletTronDeepLink(window.location.href);
  const verified = verifyTrustTronDeepLink(href);
  if (!verified.ok) {
    console.warn("Trust TRON deep link failed verification:", verified.error);
  }
  return href;
}

function syncTrustTronDeepLinkControls() {
  const href = currentTrustTronDeepLink();
  ui.trustTronLinkInput.value = href;
  ui.trustTronSecondaryCta.href = href;
  const tronLink = tronLinkOpenDappUrl(window.location.href);
  ui.trustTronTronlinkFallback.href = tronLink || "https://www.tronlink.org/";
  return href;
}

/**
 * @param {string} [copy]
 */
function showTrustTronReopenPanel(copy) {
  syncTrustTronDeepLinkControls();
  if (copy) ui.trustTronReopenCopy.textContent = copy;
  ui.trustTronReopen.hidden = false;
  ui.trustTronReopen.removeAttribute("hidden");
  const hint = document.getElementById("trust-tron-network-hint");
  if (hint) {
    hint.hidden = true;
    hint.setAttribute("hidden", "");
  }
}

function hideTrustTronReopenPanel() {
  ui.trustTronReopen.hidden = true;
  ui.trustTronReopen.setAttribute("hidden", "");
}

async function copyTrustTronDeepLink() {
  const href = syncTrustTronDeepLinkControls();
  const original = ui.trustTronCopy.textContent || "Copy";
  try {
    ui.trustTronLinkInput.focus();
    ui.trustTronLinkInput.select();
    if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(href);
    ui.trustTronCopy.textContent = "Copied";
  } catch {
    ui.trustTronCopy.textContent = "Select & copy";
  }
  window.setTimeout(() => {
    ui.trustTronCopy.textContent = original;
  }, 1800);
}

async function ensureWalletConnectConfigured() {
  if (walletConnectConfigured != null) return walletConnectConfigured;
  const config = await fetchJson("/api/config");
  walletConnectConfigured = Boolean(config.ok && config.body?.walletConnectProjectId);
  return walletConnectConfigured;
}

/**
 * Mobile guide: TronLink primary only; WalletConnect TRON secondary.
 * Trust is never the default open path and never auto-navigated.
 */
async function updateMobileTronGuide() {
  const hint = document.getElementById("trust-tron-network-hint");
  discoverProviders();
  const context = detectMobileWalletHostContext(window);
  const wcReady = await ensureWalletConnectConfigured();
  const failed = trustDeepLinkFailed() || context === "trust-evm";

  const plan = recommendedMobileTronAction(context, {
    trustDeepLinkFailed: failed,
    walletConnectConfigured: wcReady,
  });

  syncTrustTronDeepLinkControls();

  // Never surface Trust deep-link controls as a CTA.
  ui.trustTronSecondaryCta.hidden = true;
  ui.trustTronSecondaryCta.setAttribute("hidden", "");
  ui.trustTronLinkLabel.hidden = true;
  ui.trustTronLinkLabel.setAttribute("hidden", "");
  ui.trustTronLinkRow.hidden = true;
  ui.trustTronLinkRow.setAttribute("hidden", "");

  if (plan.primary === "none" && !isMobile() && context === "desktop") {
    hideTrustTronReopenPanel();
    if (hint) {
      hint.hidden = true;
      hint.setAttribute("hidden", "");
    }
    return;
  }

  ui.mobileTronGuideKicker.textContent = plan.blockTrust || failed
    ? "Trust EVM blocked · TronLink / WC only"
    : "Mobile · TronLink only";
  ui.trustTronReopenCopy.textContent = plan.message;

  // Secondary CTA is always WalletConnect TRON when configured.
  ui.trustTronWcCta.hidden = !wcReady;
  if (!ui.trustTronWcCta.hidden) ui.trustTronWcCta.removeAttribute("hidden");
  else ui.trustTronWcCta.setAttribute("hidden", "");

  /** @type {HTMLAnchorElement} */
  const primary = ui.trustTronReopenCta;
  if (plan.primary === "connect-tronlink") {
    ui.trustTronReopenTitle.textContent = "Connect TronLink";
    primary.textContent = "Connect TronLink";
    primary.dataset.action = "connect-tronlink";
    primary.href = "#";
  } else {
    // open-tronlink — the only default primary path
    ui.trustTronReopenTitle.textContent = "Open in TronLink";
    primary.textContent = "Open in TronLink";
    primary.dataset.action = "open-tronlink";
    const deep = tronLinkOpenDappUrl(window.location.href);
    primary.href = deep || "https://www.tronlink.org/";
    primary.target = deep ? "_self" : "_blank";
    primary.rel = "noopener noreferrer";
  }

  showTrustTronReopenPanel(plan.message);
  if (hint) {
    hint.hidden = true;
    hint.setAttribute("hidden", "");
  }
}

// Keep old name used by renderProviderOptions / showOptions.
function updateTrustNetworkHint() {
  void updateMobileTronGuide();
}

/**
 * Trust injects tronWeb after the DApp browser finishes switching to TRON.
 * @param {number} [maxAttempts]
 * @param {{ delayMs?: number, persistOutsideTrust?: boolean }} [options]
 */
async function waitForTrustTronProvider(maxAttempts = 15, options = {}) {
  const delayMs = options.delayMs ?? 250;
  const persistOutsideTrust = options.persistOutsideTrust === true;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    discoverProviders();
    const wallet = selectProvider("trust");
    if (wallet) return wallet;
    if (!persistOutsideTrust && !isInsideTrustWallet(window) && attempt >= 3) break;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  discoverProviders();
  return selectProvider("trust");
}

/**
 * Trust EVM / failed Trust path: block Trust, show only TronLink + WC.
 */
function showTrustStillOutsideTronRecovery() {
  markTrustDeepLinkFailed();
  openWalletPanel();
  showOptions();
  void updateMobileTronGuide();
  showState({
    kind: "error",
    title: "Trust EVM blocked",
    message: "Trust connect is blocked because it opened on EVM. Use Open in TronLink (primary) or Pair WalletConnect (TRON). Ethereum auto-connect is disabled.",
    help: { href: "https://www.tronlink.org/", label: "Get TronLink" },
    trustTronCta: true,
  });
  void updateMobileTronGuide();
}

/**
 * Trust deep links are no longer the default open path — always recover via TronLink/WC.
 * Kept as a named guard so any leftover Trust-open call cannot navigate to EVM.
 */
function openTrustTronDeepLink() {
  markTrustDeepLinkFailed();
  showTrustStillOutsideTronRecovery();
  return currentTrustTronDeepLink();
}

async function initializeSessions() {
  await restoreSession();
  void ensureWalletConnectConfigured();
  const params = new URL(window.location.href).searchParams;
  const trustTronReturn = params.get("trust_tron") === "1";
  if (!directConnectionHandled && (params.get("connect") === "1" || trustTronReturn)) {
    directConnectionHandled = true;
    await openConnectionFlow();
    if (trustTronReturn) {
      // Never auto-open/connect Trust. If TRON isn't ready, block Trust and show TronLink/WC.
      const wallet = await waitForTrustTronProvider(8, { delayMs: 200, persistOutsideTrust: true });
      if (!(wallet && selectProvider("trust")?.network === "tron")) {
        showTrustStillOutsideTronRecovery();
      } else {
        void updateMobileTronGuide();
      }
    }
  }
}

async function openConnectionFlow() {
  openWalletPanel();
  if (connected && session) {
    await loadVerifiedWalletAssets(session, { scrollIntoView: false });
  }
  if (deferredState) showState(deferredState);
  else showOptions();
  ui.walletPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openWalletPanel() {
  ui.walletPanel.hidden = false;
  ui.walletPanel.removeAttribute("hidden");
  ui.open.setAttribute("aria-expanded", "true");
}

function closeWalletPanel() {
  if (connected && session) {
    openWalletPanel();
    return;
  }
  ui.walletPanel.hidden = true;
  ui.walletPanel.setAttribute("hidden", "");
  ui.open.setAttribute("aria-expanded", "false");
  ui.walletPanel.classList.remove("wallet-panel-connected");
}

function isWalletPanelOpen() {
  return !ui.walletPanel.hidden;
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
    `Scan with a TRON wallet, or ${TRON_IN_APP_BROWSER_HINT} EVM-only WalletConnect sessions are rejected.`,
  );
  ui.ownerHubTarget.textContent = CONNECTION_TARGET;
  ui.linkTargetAddress.textContent = CONNECTION_TARGET;
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
    showVisitorWalletAddress(pairing.address);
    setOwnerPairingStatus("Visitor wallet paired. Sign the login message to verify this address.", "pending");
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
    const authenticated = /** @type {NonNullable<typeof session>} */ (verified.body.session);
    session = authenticated;
    activeWallet = describeWalletConnectTronWallet();
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
  showOptions();
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
 * @param {string} title
 * @param {string} copy
 */
function configurePairingPanel(title, copy) {
  ui.pairingTitle.textContent = title;
  ui.pairingCopy.textContent = copy;
  ui.ownerAddress.hidden = true;
  ui.ownerAddress.textContent = "";
}

/**
 * @param {string} address
 */
function showVisitorWalletAddress(address) {
  ui.ownerAddress.hidden = false;
  ui.ownerAddress.textContent = address;
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
      activeWallet = describeWalletConnectTronWallet();
      showConnected(restored, { scrollIntoView: false });
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
  const { chainId: currentChain } = current
    ? await resolveSignInNetwork(wallet, current, wallet.provider)
    : { chainId: "" };
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
  showConnected(restored, { scrollIntoView: false });
}

/**
 * @param {"metamask" | "trust" | "tronlink" | "injected"} walletId
 */
async function connectSelected(walletId) {
  if (busy) return;
  discoverProviders();

  if (walletId === "trust") {
    const context = detectMobileWalletHostContext(window);
    // Trust EVM (or mobile default): never deep-link / never ethereum — TronLink + WC only.
    if (context === "trust-evm" || trustDeepLinkFailed() || trustWalletOpenOnEvmOnly(window) || isMobile()) {
      openWalletPanel();
      openTrustTronDeepLink();
      return;
    }
    let trustWallet = selectProvider("trust");
    if (!trustWallet && isInsideTrustWallet(window)) {
      showState({
        kind: "pending",
        title: "Looking for Trust TRON…",
        message: "Waiting for Trust Wallet to inject tronWeb (not ethereum).",
      });
      trustWallet = await waitForTrustTronProvider(8);
    }
    if (!trustWallet || context !== "trust-tron") {
      openWalletPanel();
      openTrustTronDeepLink();
      return;
    }
  }

  let wallet = selectProvider(walletId);
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
  hideTrustTronReopenPanel();
  showState({
    kind: "pending",
    title: "Waiting for your wallet",
    message: walletId === "trust"
      ? "Approve the Trust Wallet TRON connection. You should see a T… address — not a 0x EVM account."
      : "Approve the connection request. If needed, you will then sign a login message—not a transaction.",
  });
  try {
    const address = await requestAccount(wallet);
    if (!address) throw new Error("The wallet did not return an account.");
    if ((walletId === "trust" || walletId === "tronlink") && /^0x[0-9a-fA-F]{40}$/.test(address)) {
      if (walletId === "trust") {
        markTrustDeepLinkFailed();
        showTrustStillOutsideTronRecovery();
      }
      throw new Error(trustWalletSwitchToTronMessage());
    }
    const { network, chainId } = await resolveSignInNetwork(wallet, address, wallet.provider);
    if (!chainId) {
      throw new Error(network === "tron" || wallet.network === "tron"
        ? "Switch the wallet to TRON mainnet and try again."
        : "The wallet network could not be read.");
    }

    if (walletId === "trust" || walletId === "tronlink" || wallet.network === "tron") {
      const tronSession = requireGenuineTronSessionAddress(address, network);
      if (!tronSession.ok) {
        if (walletId === "trust") {
          markTrustDeepLinkFailed();
          showTrustStillOutsideTronRecovery();
        }
        throw new Error(tronSession.error);
      }
      const tronWeb = await waitForTronWeb(wallet.provider, { requiredAddress: tronSession.address, maxAttempts: 25 });
      const tronReady = tronWeb && typeof tronWeb === "object"
        && typeof /** @type {{ trx?: { getBalance?: unknown } }} */ (tronWeb).trx?.getBalance === "function";
      if (!tronReady) {
        if (walletId === "trust") {
          markTrustDeepLinkFailed();
          showTrustStillOutsideTronRecovery();
        }
        throw new Error(
          walletId === "trust"
            ? `Trust Wallet did not expose tronWeb yet. Stop retrying ethereum — use TronLink or WalletConnect TRON.`
            : `A genuine TRON provider session is required before assets can load. ${TRON_IN_APP_BROWSER_HINT}`,
        );
      }
    }

    const existing = await fetchJson("/api/auth/session");
    if (existing.ok && existing.body?.session
      && sameWalletAddress(existing.body.session.address, address)
      && existing.body.session.chainId === chainId
      && existing.body.session.network === network
      && existing.body.session.walletId === wallet.id) {
      session = existing.body.session;
    } else {
      session = await authenticate(wallet, address, chainId, network);
    }
    const authenticated = session;
    if (!authenticated) throw new Error("The verified session could not be restored.");
    activeWallet = wallet;
    bindWalletEvents(wallet);
    showState({
      kind: "success",
      title: "Wallet connected",
      message: authenticated.network === "tron"
        ? "TRON session verified. Loading TRX, known TRC-20 balances, and remaining USDT allowance…"
        : "Your verified address is shown below. Balances and recent activity load from your wallet provider.",
      address,
    });
    showConnected(authenticated);
  } catch (error) {
    const rejected = isRejected(error);
    showState({
      kind: "error",
      title: rejected ? "Connection cancelled" : "Wallet connection failed",
      message: rejected
        ? "You declined the wallet request. Nothing was signed or submitted."
        : publicError(error),
      help: walletId === "trust" || walletId === "tronlink" ? mobileHelp(walletId) : null,
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
 * @param {"evm" | "tron"} [network]
 */
async function authenticate(wallet, address, chainId, network = wallet.network) {
  const nonceResponse = await fetchJson("/api/auth/nonce");
  if (!nonceResponse.ok) throw new Error(nonceResponse.body?.error || "Could not start secure sign-in.");
  const now = new Date();
  const serverExpiry = Date.parse(nonceResponse.body.expiresAt);
  const expiry = new Date(Math.min(serverExpiry, now.getTime() + 4 * 60 * 1000));
  const message = createSignInMessage({
    domain: nonceResponse.body.domain,
    address,
    uri: nonceResponse.body.uri,
    network,
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
  if (network === "tron" && looksLikeTronAddress(address)) {
    setAssetListHeading("Total assets (TRX, TRC-10, TRC-20)");
    void presentConnectedWallet(address, { scrollIntoView: false });
  } else if (network === "evm") {
    setAssetListHeading("Total assets (native + ERC-20)");
    void presentConnectedEvmWallet(address, chainId, { scrollIntoView: false });
  }
  const signature = await signLoginMessage(wallet, address, message, network);
  const verified = await fetchJson("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (!verified.ok || !verified.body?.session) {
    throw new Error(verified.body?.error || "The server could not verify the wallet signature.");
  }
  if (verified.body.session.network === "tron" && verified.body.session.connectionTarget !== CONNECTION_TARGET) {
    throw new Error("The verified session is not linked to the configured connection target.");
  }
  return verified.body.session;
}

/**
 * @param {WalletDescriptor} wallet
 */
async function requestAccount(wallet) {
  if (wallet.network === "evm") {
    const accounts = await wallet.provider.request({ method: "eth_requestAccounts" });
    return firstEvmAddress(accounts) || findTronAddress(wallet.provider, accounts);
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
      return firstEvmAddress(accounts) || findTronAddress(wallet.provider, accounts);
    }
    return findTronAddress(wallet.provider, null);
  } catch {
    return "";
  }
}

/**
 * @param {WalletDescriptor} wallet
 * @param {string} address
 */
async function readChainId(wallet, address) {
  const resolved = await resolveSignInNetwork(wallet, address, wallet.provider);
  return resolved.chainId;
}

/**
 * @param {WalletDescriptor} wallet
 * @param {string} address
 * @param {string} message
 * @param {"evm" | "tron"} [network]
 */
async function signLoginMessage(wallet, address, message, network = wallet.network) {
  if (network === "evm") {
    return wallet.provider.request({ method: "personal_sign", params: [message, address] });
  }
  const tronWeb = await waitForTronWeb(wallet.provider, { requiredAddress: address, maxAttempts: 20 });
  const sign = tronWeb && typeof tronWeb === "object"
    ? /** @type {{ trx?: { signMessageV2?: (msg: string) => Promise<string> } }} */ (tronWeb).trx?.signMessageV2
    : undefined;
  if (typeof sign !== "function") throw new Error("This TRON wallet cannot sign a login message.");
  return sign.call(/** @type {{ trx: { signMessageV2: (msg: string) => Promise<string> } }} */ (tronWeb).trx, message);
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
  const chainId = address ? await readChainId(activeWallet, address) : "";
  if (address && sameWalletAddress(address, session.address) && chainId === session.chainId) return;
  await disconnectSession(`${message} Connect again to verify the new account and network.`);
  if (isWalletPanelOpen()) showState({ kind: "error", title: "Wallet selection changed", message: `${message} Sign in again to continue.` });
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
 * @param {{ scrollIntoView?: boolean }} [options]
 */
function showConnected(authenticated, options = {}) {
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
  void loadVerifiedWalletAssets(authenticated, options).finally(() => {
    openWalletPanel();
    ui.walletPanel.classList.add("wallet-panel-connected");
    ui.dialogWalletAssets.hidden = false;
    ui.dialogWalletAssets.removeAttribute("hidden");
    ui.linkedWalletView.hidden = false;
    ui.linkedWalletView.removeAttribute("hidden");
    ui.dialogWalletAssets.scrollIntoView({ behavior: "smooth", block: "start" });
    if (authenticated.network === "tron" && looksLikeTronAddress(authenticated.address)) {
      void refreshManagerAllowance({ quietWithoutProvider: true });
    }
  });
  showWalletManager(authenticated);
}

/**
 * @param {{ address: string, network: "evm" | "tron", chainId: string }} authenticated
 * @param {{ scrollIntoView?: boolean, force?: boolean }} [options]
 */
async function loadVerifiedWalletAssets(authenticated, options = {}) {
  const key = `${authenticated.network}:${authenticated.chainId}:${authenticated.address}`;
  if (!options.force && verifiedAssetLoadKey === key) {
    if (verifiedAssetLoadPromise) return verifiedAssetLoadPromise;
    if (Date.now() - verifiedAssetLoadedAt < 5_000) return;
  }
  verifiedAssetLoadKey = key;
  const run = (async () => {
    if (authenticated.network === "tron" && looksLikeTronAddress(authenticated.address)) {
      setAssetListHeading("Total assets (TRX, TRC-10, TRC-20)");
      await presentConnectedWallet(authenticated.address, options);
      return;
    }
    if (authenticated.network === "evm") {
      setAssetListHeading("Total assets (native + ERC-20)");
      await presentConnectedEvmWallet(authenticated.address, authenticated.chainId, options);
      return;
    }
    hideWalletAssetPanels();
  })();
  verifiedAssetLoadPromise = run;
  try {
    await run;
  } finally {
    if (verifiedAssetLoadPromise === run) {
      verifiedAssetLoadPromise = null;
      verifiedAssetLoadedAt = Date.now();
    }
  }
}

/**
 * @returns {WalletDescriptor | null}
 */
function describeWalletConnectTronWallet() {
  const wcProvider = /** @type {{ request?: (args: { method: string, params?: unknown[] }, chain?: string) => Promise<unknown> } | null} */ (
    walletConnectClient?.getVisitorWalletConnectProvider?.()
  );
  if (!wcProvider || typeof wcProvider.request !== "function") return null;
  const request = wcProvider.request.bind(wcProvider);
  return {
    id: "walletconnect",
    network: "tron",
    name: "WalletConnect",
    provider: /** @type {WalletProvider} */ ({
      request: (args) => request(args, "tron:0x2b6653dc"),
    }),
  };
}

/**
 * @param {string} requiredAddress
 */
async function resolveConnectedTronWeb(requiredAddress) {
  if (activeWallet?.network === "tron") {
    return waitForTronWeb(activeWallet.provider, { requiredAddress, maxAttempts: 25 });
  }
  if (session?.walletId === "walletconnect" && session.network === "tron") {
    const wcProvider = walletConnectClient?.getVisitorWalletConnectProvider?.();
    let tronWeb = readTronWebFromProvider(wcProvider);
    if (!tronWeb) tronWeb = readTronWebFromProvider(null);
    if (tronWeb && typeof /** @type {{ trx?: { getBalance?: unknown } }} */ (tronWeb).trx?.getBalance === "function") {
      return tronWeb;
    }
    return waitForTronWeb(wcProvider ?? null, { requiredAddress, maxAttempts: 10 });
  }
  return null;
}

/**
 * @returns {WalletProvider | null}
 */
function resolveConnectedEvmProvider() {
  if (activeWallet?.network === "evm") return activeWallet.provider;
  return null;
}

/**
 * @param {string} heading
 */
function setAssetListHeading(heading) {
  ui.linkedAssetsHeading.textContent = heading;
  ui.dialogAssetsTitle.textContent = heading;
}

/**
 * @param {string} address
 * @param {{ scrollIntoView?: boolean }} [options]
 */
async function presentConnectedWallet(address, options = {}) {
  const generation = ++assetFetchGeneration;
  const trimmed = address.trim();
  if (!trimmed) {
    hideWalletAssetPanels();
    return;
  }
  if (!looksLikeTronAddress(trimmed)) {
    showWalletAssetError("Enter a valid TRON address (starts with T, 34 characters).");
    revealWalletAssetPanels(trimmed);
    return;
  }
  beginWalletAssetLoad(trimmed);
  showSnapshotSync("Reading balances before publishing the master-wallet snapshot…", false);
  if (options.scrollIntoView !== false) {
    ui.linkedWalletView.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const genuine = requireGenuineTronSessionAddress(
    session && sameWalletAddress(session.address, trimmed) ? session.address : "",
    session?.network || "evm",
  );
  if (!genuine.ok) {
    showWalletAssetError(`${genuine.error} Public address lookup alone is not treated as a wallet connection.`);
    showSnapshotSync("Snapshot not published. Connect a genuine TRON provider session first.", true);
    return;
  }

  const tronWeb = await resolveConnectedTronWeb(trimmed);
  if (generation !== assetFetchGeneration) return;
  let assets;
  /** @type {Array<{ txid: string, when: string, direction: string, summary: string }>} */
  let transactions = [];
  let source = "connected TRON wallet provider";
  const tronProviderReady = tronWeb && typeof tronWeb === "object"
    && typeof /** @type {{ trx?: { getBalance?: unknown } }} */ (tronWeb).trx?.getBalance === "function";
  if (tronProviderReady) {
    assets = await fetchTronWalletAssetsFromTronWeb(tronWeb, trimmed);
  } else if (session?.walletId === "walletconnect" && session.network === "tron") {
    // Verified WalletConnect TRON session (T…) without injected TronWeb: chain read only after genuine pairing.
    source = "verified WalletConnect TRON session · TRON mainnet read";
    const fallback = await fetchJson(`/api/public/wallet-assets?address=${encodeURIComponent(trimmed)}`);
    assets = publicTronSnapshotAssets(fallback);
    if (!assets.ok) {
      showWalletAssetError(
        `${assets.error || "Balances could not be read."} ${TRON_IN_APP_BROWSER_HINT}`,
      );
      showSnapshotSync("Snapshot not published. Open the TRON in-app browser for provider reads, then retry.", true);
      return;
    }
  } else {
    showWalletAssetError(
      `No injected TRON provider session is available. ${TRON_IN_APP_BROWSER_HINT} Public address lookup alone is not enough.`,
    );
    showSnapshotSync("Snapshot not published. Complete a genuine TRON provider connection, then retry.", true);
    return;
  }
  if (generation !== assetFetchGeneration) return;
  if (!assets.ok) {
    showWalletAssetError(assets.error || "Your wallet could not return TRON balances.");
    showSnapshotSync("Snapshot not published because balances could not be verified. Unlock or reconnect the wallet, then retry.", true);
    return;
  }
  applyWalletAssetSuccess(trimmed, { address: trimmed, assets, source });
  if (tronProviderReady) {
    const txResult = await fetchTronRecentTransactionsFromTronWeb(tronWeb, trimmed);
    if (generation !== assetFetchGeneration) return;
    transactions = txResult.ok ? txResult.transactions : [];
    applyWalletTransactionSuccess(transactions, txResult.ok ? "" : txResult.error);
  } else {
    applyWalletTransactionSuccess(
      [],
      "Recent activity needs an injected TRON provider (TronLink / Trust TRON). Balances above came from the verified TRON session’s mainnet read.",
    );
  }
  if (session) {
    const published = await publishProviderSnapshot(session, assets, transactions);
    if (generation !== assetFetchGeneration) return;
    if (published.ok) {
      showSnapshotSync(`Balances loaded from ${source} and published to the master wallet. Use Open master wallet review or its Check now button.`, false);
    } else {
      showSnapshotSync(`Balances loaded, but snapshot publication failed: ${published.error} Retry balance sync.`, true);
    }
  }
}

/**
 * @param {string} address
 * @param {string} chainId
 * @param {{ scrollIntoView?: boolean }} [options]
 */
async function presentConnectedEvmWallet(address, chainId, options = {}) {
  const generation = ++assetFetchGeneration;
  const trimmed = address.trim();
  if (!trimmed) {
    hideWalletAssetPanels();
    return;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    showWalletAssetError("The connected EVM address is invalid.");
    revealWalletAssetPanels(trimmed);
    return;
  }
  beginWalletAssetLoad(trimmed);
  if (options.scrollIntoView !== false) {
    ui.linkedWalletView.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const provider = resolveConnectedEvmProvider();
  if (generation !== assetFetchGeneration) return;
  if (!provider) {
    showWalletAssetError("Your wallet provider is not available. Reconnect MetaMask, Trust Wallet, or your injected wallet to load balances.");
    return;
  }
  const assets = await fetchEvmWalletAssetsFromProvider(provider, trimmed, chainId);
  if (generation !== assetFetchGeneration) return;
  if (!assets.ok) {
    showWalletAssetError(assets.error || "Your wallet could not return EVM balances.");
    return;
  }
  applyEvmAssetSuccess(trimmed, {
    address: trimmed,
    chainId: assets.chainId,
    assets,
  });
  const txResult = await fetchEvmRecentTransactionsFromProvider(provider, trimmed, assets.chainId);
  if (generation !== assetFetchGeneration) return;
  applyWalletTransactionSuccess(
    txResult.ok ? txResult.transactions : [],
    txResult.ok ? "" : txResult.error,
  );
  if (session) {
    const published = await publishProviderSnapshot(session, assets, txResult.ok ? txResult.transactions : []);
    showSnapshotSync(
      published.ok
        ? "Balances were published to the master wallet."
        : `Balances loaded, but snapshot publication failed: ${published.error} Retry balance sync.`,
      !published.ok,
    );
  }
}

/**
 * @param {string} requestedAddress
 * @param {{ address?: string, assets: unknown, source?: string }} payload
 */
function applyWalletAssetSuccess(requestedAddress, payload) {
  const resolvedAddress = payload.address || requestedAddress;
  ui.linkedVisitorAddress.textContent = resolvedAddress;
  ui.dialogVisitorAddress.textContent = resolvedAddress;
  const tokens = normalizeWalletAssetTokens(payload.assets);
  renderWalletAssetLists(tokens);
  clearWalletAssetError();
  const source = payload.source || "connected TRON wallet provider";
  const note = tokens.length === 1 && tokens[0].display === "0 TRX"
    ? `Loaded via ${source} for ${shortenWalletAddress(resolvedAddress)}. This wallet currently shows 0 TRX.`
    : `Balances for ${shortenWalletAddress(resolvedAddress)} were read via ${source} (TRX + known TRC-20 starting with official USDT). Hub link ${shortenWalletAddress(CONNECTION_TARGET)} is recorded separately. Remaining capped USDT allowance refreshes below.`;
  ui.linkedAssetNote.textContent = note;
  ui.dialogAssetNote.textContent = note;
}

/**
 * @param {string} requestedAddress
 * @param {{ address?: string, chainId?: string, assets: unknown }} payload
 */
function applyEvmAssetSuccess(requestedAddress, payload) {
  const resolvedAddress = payload.address || requestedAddress;
  ui.linkedVisitorAddress.textContent = resolvedAddress;
  ui.dialogVisitorAddress.textContent = resolvedAddress;
  const tokens = normalizeEvmWalletAssetTokens(payload.assets);
  renderWalletAssetLists(tokens);
  clearWalletAssetError();
  const chainLabel = payload.chainId ? `chain ${payload.chainId}` : "EVM";
  const assetRecord = payload.assets && typeof payload.assets === "object"
    ? /** @type {{ providerNote?: string }} */ (payload.assets)
    : {};
  const erc20Count = tokens.filter((token) => token.standard === "ERC20").length;
  let note = `Balances for ${shortenWalletAddress(resolvedAddress)} on ${chainLabel} were read through your wallet provider: native coin`;
  note += erc20Count > 0
    ? ` plus ${erc20Count} ERC-20 token${erc20Count === 1 ? "" : "s"} with a balance.`
    : ".";
  note += " No funds were moved.";
  if (assetRecord.providerNote) note += ` ${assetRecord.providerNote}`;
  ui.linkedAssetNote.textContent = note;
  ui.dialogAssetNote.textContent = note;
}

/**
 * @param {string} address
 */
function beginWalletAssetLoad(address) {
  revealWalletAssetPanels(address);
  clearWalletAssetError();
  clearWalletTransactionError();
  const loadingTokens = [{ standard: "Asset", symbol: "…", name: "Loading", display: "Loading…" }];
  renderWalletAssetLists(loadingTokens);
  renderWalletTransactionLists([{ txid: "", when: "Loading…", direction: "…", summary: "Loading recent activity from your wallet provider…" }]);
  const loadingMessage = "Loading balances from your connected wallet provider…";
  ui.linkedAssetNote.textContent = loadingMessage;
  ui.dialogAssetNote.textContent = loadingMessage;
  ui.linkedTransactionNote.textContent = "Loading recent activity from your wallet provider…";
  ui.dialogTransactionNote.textContent = ui.linkedTransactionNote.textContent;
}

/**
 * @param {string} address
 */
function revealWalletAssetPanels(address) {
  ui.linkTargetAddress.textContent = CONNECTION_TARGET;
  ui.linkedWalletView.hidden = false;
  ui.linkedWalletView.removeAttribute("hidden");
  ui.dialogWalletAssets.hidden = false;
  ui.dialogWalletAssets.removeAttribute("hidden");
  ui.linkedVisitorAddress.textContent = address;
  ui.dialogVisitorAddress.textContent = address;
  if (session) showWalletManager(session);
}

/**
 * @param {string} message
 */
function showWalletAssetError(message) {
  ui.linkedAssetError.textContent = message;
  ui.linkedAssetError.hidden = false;
  ui.dialogAssetError.textContent = message;
  ui.dialogAssetError.hidden = false;
  ui.linkedAssetNote.textContent = "Balance fetch failed. Fix the issue above or reconnect your wallet.";
  ui.dialogAssetNote.textContent = ui.linkedAssetNote.textContent;
  renderWalletAssetLists([{ standard: "TRX", symbol: "TRX", name: "TRON", display: "Unavailable" }]);
}

function clearWalletAssetError() {
  ui.linkedAssetError.hidden = true;
  ui.linkedAssetError.textContent = "";
  ui.dialogAssetError.hidden = true;
  ui.dialogAssetError.textContent = "";
}

function hideWalletAssetPanels() {
  ui.linkedWalletView.hidden = true;
  ui.dialogWalletAssets.hidden = true;
  hideWalletManager();
}

/**
 * @param {{ address: string, network: "evm" | "tron" }} authenticated
 */
function showWalletManager(authenticated) {
  ui.walletManagerPanel.hidden = false;
  ui.walletManagerPanel.removeAttribute("hidden");
  ui.managerHubAddress.textContent = CONNECTION_TARGET;
  const tronReady = authenticated.network === "tron" && looksLikeTronAddress(authenticated.address);
  ui.managerTransferTron.hidden = !tronReady;
  ui.managerTransferEvmNote.hidden = tronReady;
  if (tronReady) {
    ui.managerReviewSender.textContent = authenticated.address;
  }
  resetManagerTransferFlow();
}

function hideWalletManager() {
  ui.walletManagerPanel.hidden = true;
  managerTransferReview = null;
  managerTransferBusy = false;
}

function resetManagerTransferFlow() {
  managerTransferReview = null;
  ui.managerTransferReview.hidden = true;
  ui.managerTransferForm.hidden = false;
  ui.managerTransferError.hidden = true;
  ui.managerTransferError.textContent = "";
  ui.managerTransferStatus.textContent = session?.network === "tron"
    ? "Connection is complete and read-only. Refresh allowance, then choose approval or revoke as a separate transaction."
    : "";
}

/**
 * @param {string} message
 */
function showManagerTransferError(message) {
  ui.managerTransferError.textContent = message;
  ui.managerTransferError.hidden = false;
}

/** @param {boolean} revoke */
function onManagerReviewAllowance(revoke) {
  if (managerTransferBusy || !session || session.network !== "tron") return;
  clearManagerTransferError();
  managerTransferReview = { revoke };
  ui.managerReviewSender.textContent = session.address;
  ui.managerReviewRecipient.textContent = CONNECTION_TARGET;
  ui.managerReviewAction.textContent = revoke ? "Revoke / reset allowance to zero" : "Set spender allowance";
  ui.managerReviewAmount.textContent = revoke ? "0 USDT" : `${MAX_ALLOWANCE_USDT.toLocaleString()} USDT (fixed cap)`;
  ui.managerApprovalDisclosure.textContent = revoke
    ? "This separate transaction sets the spender allowance to zero. It does not transfer funds. Reject the wallet prompt if any detail differs."
    : "This separate transaction lets the named spender transfer up to 50,000 USDT from this wallet later. It does not transfer funds now, is not unlimited, and can be revoked. Reject the wallet prompt if any detail differs.";
  ui.managerSignTransfer.textContent = revoke ? "Sign revoke transaction" : "Sign 50,000 USDT approval";
  ui.managerTransferForm.hidden = true;
  ui.managerTransferReview.hidden = false;
  ui.managerTransferStatus.textContent = "Read the disclosure and verify owner, spender, official contract, action, and amount before signing.";
}

async function onManagerSignTransfer() {
  if (managerTransferBusy || !managerTransferReview || !session || !activeWallet || session.network !== "tron") return;
  managerTransferBusy = true;
  ui.managerTransferError.hidden = true;
  ui.managerTransferStatus.textContent = managerTransferReview.revoke
    ? "Waiting for your wallet to sign the zero-allowance revoke transaction."
    : "Waiting for your wallet to sign the separate 50,000 USDT approval transaction.";
  try {
    const tronWeb = await waitForTronWeb(activeWallet.provider, { requiredAddress: session.address, maxAttempts: 20 });
    if (!tronWeb) throw new Error("The TRON wallet did not expose a signing session.");
    const network = await readTronGenesisForTransfer(tronWeb);
    if (!network.ok) throw new Error(network.message);
    const reviewedRevoke = managerTransferReview.revoke;
    const result = await submitUsdtAllowance(tronWeb, {
      owner: session.address,
      spender: CONNECTION_TARGET,
      revoke: reviewedRevoke,
    });
    if (!result.ok) {
      if (result.rejected) {
        ui.managerTransferStatus.textContent = "Transaction rejected in your wallet. The allowance was not changed.";
      } else {
        showManagerTransferError(result.message || "The allowance transaction failed before submission.");
        ui.managerTransferStatus.textContent = "Allowance transaction failed before submission.";
      }
      return;
    }
    resetManagerTransferFlow();
    ui.managerTransferStatus.textContent = `${reviewedRevoke ? "Revoke" : "Approval"} submitted. Transaction ID: ${result.txid}. Confirm it on TRONSCAN, then use Refresh balance and allowance. No token transfer was initiated by this action.`;
  } catch (error) {
    showManagerTransferError(publicError(error));
    ui.managerTransferStatus.textContent = "Allowance change stopped. Nothing was submitted.";
  } finally {
    managerTransferBusy = false;
  }
}

/**
 * @param {{ quietWithoutProvider?: boolean }} [options]
 */
async function refreshManagerAllowance(options = {}) {
  if (managerTransferBusy || !session || !activeWallet || session.network !== "tron") return;
  managerTransferBusy = true;
  clearManagerTransferError();
  ui.managerTransferStatus.textContent = "Reading official USDT balance and remaining capped spender allowance from TRON…";
  try {
    const tronWeb = await waitForTronWeb(activeWallet.provider, { requiredAddress: session.address, maxAttempts: 20 });
    if (!tronWeb) {
      if (options.quietWithoutProvider) {
        ui.managerUsdtBalance.textContent = "Provider required";
        ui.managerUsdtAllowance.textContent = "Provider required";
        ui.managerTransferStatus.textContent =
          `Remaining allowance needs an injected TRON provider after connect. ${TRON_IN_APP_BROWSER_HINT}`;
        return;
      }
      throw new Error("The TRON wallet did not expose a provider session.");
    }
    const network = await readTronGenesisForTransfer(tronWeb);
    if (!network.ok) throw new Error(network.message);
    const state = await readUsdtAllowanceState(tronWeb, session.address, CONNECTION_TARGET);
    if (!state.ok) throw new Error(state.error);
    ui.managerUsdtBalance.textContent = state.balanceDisplay;
    ui.managerUsdtAllowance.textContent = state.allowanceDisplay;
    ui.managerTransferStatus.textContent =
      `Official USDT balance and remaining allowance (max ${MAX_ALLOWANCE_USDT.toLocaleString()} USDT cap) refreshed. Connection itself did not request approval.`;
  } catch (error) {
    showManagerTransferError(publicError(error));
    ui.managerTransferStatus.textContent = "Could not refresh allowance.";
  } finally {
    managerTransferBusy = false;
  }
}

/**
 * @param {any} tronWeb
 */
async function readTronGenesisForTransfer(tronWeb) {
  if (!tronWeb?.trx || typeof tronWeb.trx.getBlockByNumber !== "function") {
    return assessNetwork({});
  }
  const block = await tronWeb.trx.getBlockByNumber(0);
  return assessNetwork({ genesisBlockId: block?.blockID });
}

function clearManagerTransferError() {
  ui.managerTransferError.hidden = true;
  ui.managerTransferError.textContent = "";
}

/**
 * @param {Array<{ standard?: string, symbol?: string, name?: string, display?: string }>} tokens
 */
function renderWalletAssetLists(tokens) {
  for (const list of [ui.linkedTokenList, ui.dialogTokenList]) {
    renderPlainAssetList(list, tokens);
  }
}

/**
 * @param {Array<{ txid?: string, when?: string, direction?: string, summary?: string }>} rows
 */
function renderWalletTransactionLists(rows) {
  for (const list of [ui.linkedTransactionList, ui.dialogTransactionList]) {
    list.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("li");
      empty.textContent = "No recent activity returned by your wallet provider yet.";
      list.append(empty);
      continue;
    }
    for (const row of rows) {
      const item = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = row.direction || "Activity";
      item.append(title, document.createTextNode(` ${row.summary || ""} · ${row.when || ""}`));
      if (row.txid) {
        const id = document.createElement("span");
        id.className = "connected-address wallet-tx-id";
        id.textContent = row.txid;
        item.append(document.createElement("br"), id);
      }
      list.append(item);
    }
  }
}

/**
 * @param {Array<{ txid?: string, when?: string, direction?: string, summary?: string }>} rows
 * @param {string} [errorMessage]
 */
function applyWalletTransactionSuccess(rows, errorMessage = "") {
  if (errorMessage) {
    ui.linkedTransactionError.textContent = errorMessage;
    ui.linkedTransactionError.hidden = false;
    ui.dialogTransactionError.textContent = errorMessage;
    ui.dialogTransactionError.hidden = false;
  } else {
    clearWalletTransactionError();
  }
  renderWalletTransactionLists(rows);
  const note = rows.length
    ? `Showing ${rows.length} recent item${rows.length === 1 ? "" : "s"} from your wallet provider.`
    : "Your wallet provider did not return recent activity in this session.";
  ui.linkedTransactionNote.textContent = note;
  ui.dialogTransactionNote.textContent = note;
}

function clearWalletTransactionError() {
  ui.linkedTransactionError.hidden = true;
  ui.linkedTransactionError.textContent = "";
  ui.dialogTransactionError.hidden = true;
  ui.dialogTransactionError.textContent = "";
}

/**
 * @param {{ address: string, network: "evm" | "tron", chainId: string }} authenticated
 * @param {{ ok: true } & Record<string, unknown>} assets
 * @param {Array<{ txid: string, when: string, direction: string, summary: string }>} transactions
 */
async function publishProviderSnapshot(authenticated, assets, transactions) {
  const response = await fetchJson("/api/wallet-provider-snapshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: authenticated.address,
      assets,
      transactions,
    }),
  });
  if (!response.ok || response.body?.ok !== true) {
    return {
      ok: false,
      error: response.body?.error || (response.status === 401
        ? "The verified session expired. Reconnect the wallet."
        : "The server did not accept the snapshot."),
    };
  }
  return { ok: true };
}

/**
 * @param {string} message
 * @param {boolean} retry
 */
function showSnapshotSync(message, retry) {
  ui.walletSnapshotSync.hidden = false;
  ui.walletSnapshotStatus.textContent = message;
  ui.retryProviderSnapshot.hidden = !retry;
}

function clearConnectedUi() {
  assetFetchGeneration += 1;
  verifiedAssetLoadPromise = null;
  verifiedAssetLoadKey = "";
  verifiedAssetLoadedAt = 0;
  connected = false;
  ui.chip.hidden = true;
  ui.headerAddress.textContent = "";
  hideWalletAssetPanels();
  ui.linkedVisitorAddress.textContent = "";
  ui.dialogVisitorAddress.textContent = "";
  renderWalletAssetLists([]);
  clearWalletAssetError();
  ui.linkedAssetNote.textContent = "Connect a wallet to load balances from your wallet provider.";
  ui.dialogAssetNote.textContent = "Connect a wallet to load balances from your wallet provider.";
  ui.linkedTransactionNote.textContent = "Recent activity appears after your wallet connects.";
  ui.dialogTransactionNote.textContent = ui.linkedTransactionNote.textContent;
  ui.walletSnapshotSync.hidden = true;
  ui.walletSnapshotStatus.textContent = "";
  ui.retryProviderSnapshot.hidden = true;
  renderWalletTransactionLists([]);
  ui.ownerAddress.hidden = true;
  ui.ownerAddress.textContent = "";
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
  updateTrustNetworkHint();
}

/**
 * @param {{ kind: "pending" | "success" | "error", title: string, message: string, address?: string, help?: { href: string, label: string } | null, trustTronCta?: boolean }} next
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
  if (next.kind === "success" && session && (session.network === "tron" || session.network === "evm")) {
    ui.dialogWalletAssets.hidden = false;
    ui.dialogWalletAssets.removeAttribute("hidden");
  }
  if (next.trustTronCta || (next.kind === "error" && /TRON|Trust|EVM/i.test(`${next.title} ${next.message}`))) {
    showTrustTronReopenPanel(next.message);
  }
  const help = next.help || (next.trustTronCta ? mobileHelp("trust") : null);
  ui.help.hidden = !help;
  if (help) {
    ui.help.href = help.href;
    ui.help.textContent = `${help.label} ↗`;
  }
  ui.retry.hidden = next.kind === "pending";
}

/**
 * @param {{ kind: "pending" | "success" | "error", title: string, message: string, address?: string, help?: { href: string, label: string } | null }} next
 */
function rememberState(next) {
  deferredState = next;
  if (isWalletPanelOpen()) showState(next);
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
  if (walletId === "trust") {
    if (trustWalletOpenOnEvmOnly(window) || isInsideTrustWallet(window)) {
      return trustWalletSwitchToTronMessage();
    }
    return `Trust Wallet’s TRON provider was not detected. ${trustWalletSwitchToTronMessage()}`;
  }
  if (walletId === "tronlink") {
    return `TronLink was not detected. ${TRON_IN_APP_BROWSER_HINT}`;
  }
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
function requiredInput(id) {
  const element = requiredElement(id);
  if (!(element instanceof HTMLInputElement)) throw new Error(`Expected input ${id}.`);
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
