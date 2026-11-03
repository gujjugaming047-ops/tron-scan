/**
 * @typedef {object} TronProvider
 * @property {(args: { method: string, params?: unknown }) => Promise<unknown>} request
 * @property {any} [tronWeb]
 * @property {(event: string, listener: (...args: any[]) => void) => void} [on]
 * @property {boolean} [__flashCheckBound]
 */

const dialog = requiredDialog("wallet-dialog");
const openButton = requiredButton("open-wallet-flow");
const closeButton = requiredButton("close-wallet-flow");
const tronLinkButton = requiredButton("connect-tronlink");
const trustButton = requiredButton("connect-trust");
const retryButton = requiredButton("retry-wallets");
const continueReadOnly = requiredAnchor("continue-read-only");
const options = requiredElement("wallet-options");
const status = requiredElement("wallet-status");
const statusMark = requiredElement("status-mark");
const statusTitle = requiredElement("status-title");
const statusMessage = requiredElement("status-message");
const connectedAddress = requiredElement("connected-address");
const walletHelp = requiredAnchor("wallet-help");

let busy = false;
/** @type {TronProvider | null} */
let activeProvider = null;

openButton.addEventListener("click", () => {
  showOptions();
  dialog.showModal();
});

closeButton.addEventListener("click", () => dialog.close());
retryButton.addEventListener("click", showOptions);
continueReadOnly.addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

tronLinkButton.addEventListener("click", () => {
  void connectWallet("tronlink");
});

trustButton.addEventListener("click", () => {
  void connectWallet("trust");
});

window.addEventListener("tronLink#initialized", () => {
  if (dialog.open && !busy) showOptions();
});

/**
 * @param {"tronlink" | "trust"} wallet
 */
async function connectWallet(wallet) {
  if (busy) return;
  const provider = wallet === "trust" ? readTrustProvider() : readTronLinkProvider();
  if (!provider) {
    showState({
      kind: "error",
      title: `${wallet === "trust" ? "Trust Wallet" : "TronLink"} was not detected`,
      message: wallet === "trust"
        ? "Open this page in Trust Wallet’s browser and select a TRON account, then try again."
        : "Install or unlock the official TronLink extension, or open this page in the TronLink mobile browser.",
      helpHref: wallet === "trust" ? "https://trustwallet.com/" : "https://www.tronlink.org/",
    });
    return;
  }

  busy = true;
  setButtonsDisabled(true);
  showState({
    kind: "pending",
    title: "Waiting for your wallet",
    message: "Approve the read-only connection request in your wallet. No signature or transaction is requested.",
  });

  try {
    const method = wallet === "trust" ? "tron_requestAccounts" : "eth_requestAccounts";
    const result = await provider.request({ method });
    if (isRejected(result)) {
      showRejected();
      return;
    }
    const address = await findAddress(provider, result);
    if (!address) {
      showState({
        kind: "error",
        title: "No TRON account was returned",
        message: "Unlock the wallet, select a TRON account, and try connecting again.",
      });
      return;
    }
    activeProvider = provider;
    bindProviderEvents(provider);
    showState({
      kind: "success",
      title: "Wallet connected",
      message: "Your public TRON address is ready for the checker. No signature or transaction was requested.",
      address,
    });
  } catch (error) {
    if (isRejected(error)) {
      showRejected();
    } else {
      showState({
        kind: "error",
        title: "Connection did not finish",
        message: "Unlock your wallet and try again. The checker did not request a signature or transaction.",
      });
    }
  } finally {
    busy = false;
    setButtonsDisabled(false);
  }
}

function showRejected() {
  showState({
    kind: "error",
    title: "Connection cancelled",
    message: "The wallet connection was declined. Nothing was signed or submitted.",
  });
}

function showOptions() {
  options.hidden = false;
  status.hidden = true;
  retryButton.hidden = true;
  walletHelp.hidden = true;
  connectedAddress.hidden = true;
  setButtonsDisabled(false);
}

/**
 * @param {{ kind: "pending" | "success" | "error", title: string, message: string, address?: string, helpHref?: string }} next
 */
function showState(next) {
  options.hidden = true;
  status.hidden = false;
  status.dataset.kind = next.kind;
  statusMark.textContent = next.kind === "success" ? "✓" : next.kind === "error" ? "!" : "";
  statusTitle.textContent = next.title;
  statusMessage.textContent = next.message;
  connectedAddress.textContent = next.address || "";
  connectedAddress.hidden = !next.address;
  walletHelp.hidden = !next.helpHref;
  if (next.helpHref) walletHelp.href = next.helpHref;
  retryButton.hidden = next.kind === "pending";
}

/**
 * @param {TronProvider} provider
 * @param {unknown} result
 */
async function findAddress(provider, result) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidates = [
      provider.tronWeb?.defaultAddress?.base58,
      provider.tronWeb?.defaultAddress,
      ...collectStrings(result),
    ];
    const address = candidates.find((candidate) => typeof candidate === "string" && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(candidate));
    if (typeof address === "string") return address;
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }
  return "";
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
  return Object.entries(value).flatMap(([key, item]) => {
    if (["message", "signature", "stack"].includes(key)) return [];
    return collectStrings(item, depth + 1);
  });
}

/**
 * @param {TronProvider} provider
 */
function bindProviderEvents(provider) {
  if (typeof provider.on !== "function" || provider === activeProvider && provider.__flashCheckBound) return;
  try {
    provider.__flashCheckBound = true;
  } catch {
    // Read-only provider objects can reject custom properties; event binding still works.
  }
  provider.on("accountsChanged", (accounts) => {
    const address = collectStrings(accounts).find((item) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(item));
    if (address) {
      showState({
        kind: "success",
        title: "Connected account changed",
        message: "The checker will use this public TRON address. No signature was requested.",
        address,
      });
    } else {
      showState({
        kind: "error",
        title: "Wallet disconnected",
        message: "Unlock or reconnect your wallet to continue.",
      });
    }
  });
  provider.on("disconnect", () => {
    showState({
      kind: "error",
      title: "Wallet disconnected",
      message: "Reconnect your wallet to continue. Nothing was signed or submitted.",
    });
  });
}

function readTronLinkProvider() {
  const view = /** @type {Window & { tronLink?: TronProvider, tron?: TronProvider }} */ (window);
  const candidate = view.tronLink || view.tron;
  return candidate && typeof candidate.request === "function" ? candidate : null;
}

function readTrustProvider() {
  const view = /** @type {Window & { trustwallet?: { tronLink?: TronProvider } }} */ (window);
  const candidate = view.trustwallet?.tronLink;
  return candidate && typeof candidate.request === "function" ? candidate : null;
}

/**
 * @param {unknown} value
 */
function isRejected(value) {
  if (!value || typeof value !== "object" || !("code" in value)) return false;
  const code = /** @type {{ code?: unknown }} */ (value).code;
  return code === 4000 || code === 4001;
}

/**
 * @param {boolean} disabled
 */
function setButtonsDisabled(disabled) {
  tronLinkButton.disabled = disabled;
  trustButton.disabled = disabled;
  closeButton.disabled = disabled;
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
