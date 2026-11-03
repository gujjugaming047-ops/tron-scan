import UniversalProvider from "@walletconnect/universal-provider";
import { toDataURL } from "qrcode";
import { tronAddressFromWalletConnectSession } from "./wallet-state.mjs";

const TRON_CHAIN = "tron:0x2b6653dc";
/** @type {UniversalProvider | null} */
let provider = null;
/** @type {"owner" | "visitor" | null} */
let activeRole = null;
let suppressNextDelete = false;
/** @type {((uri: string) => void) | null} */
let displayUriHandler = null;

/**
 * Start or restore the owner's WalletConnect v2 TRON session.
 * @param {{ projectId: string, onUri: (uri: string) => void }} options
 */
export async function pairOwnerWallet(options) {
  const client = await initializeProvider(options.projectId, options.onUri);
  activeRole = "owner";
  const existing = client.session;
  const session = existing || await client.connect({
    namespaces: tronNamespace(),
  });
  return pairingResult(session, Boolean(existing));
}

/**
 * Pair a visitor wallet after owner approval. The owner link is intentionally
 * closed first; owner approval remains represented by its HTTP-only cookie.
 * @param {{ projectId: string, onUri: (uri: string) => void }} options
 */
export async function pairVisitorWallet(options) {
  const client = await initializeProvider(options.projectId, options.onUri);
  if (client.session && activeRole !== "visitor") {
    suppressNextDelete = true;
    await client.disconnect();
  }
  activeRole = "visitor";
  const existing = client.session;
  const session = existing || await client.connect({
    namespaces: tronNamespace(),
  });
  return pairingResult(session, Boolean(existing));
}

/**
 * Restore a previously approved visitor pairing without displaying a QR code.
 * @param {{ projectId: string }} options
 */
export async function restoreVisitorWallet(options) {
  const client = await initializeProvider(options.projectId, () => {});
  if (!client.session) return null;
  activeRole = "visitor";
  return pairingResult(client.session, true);
}

/**
 * Ask the paired owner wallet to sign an authentication message.
 * This is not a transaction.
 * @param {string} address
 * @param {string} message
 */
export async function signOwnerMessage(address, message) {
  return signMessage("owner", address, message);
}

/**
 * @param {string} address
 * @param {string} message
 */
export async function signVisitorMessage(address, message) {
  return signMessage("visitor", address, message);
}

/**
 * @param {"owner" | "visitor"} role
 * @param {string} address
 * @param {string} message
 */
async function signMessage(role, address, message) {
  if (!provider?.session || activeRole !== role) {
    throw new Error(`The WalletConnect ${role} session is not ready.`);
  }
  const result = await provider.request({
    method: "tron_signMessage",
    params: { address, message },
  }, TRON_CHAIN);
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "signature" in result && typeof result.signature === "string") {
    return result.signature;
  }
  throw new Error("The paired wallet did not return a message signature.");
}

export async function disconnectOwnerWallet() {
  if (provider?.session) await provider.disconnect();
  provider = null;
  activeRole = null;
}

export async function disconnectVisitorWallet() {
  if (provider?.session && activeRole === "visitor") await provider.disconnect();
  provider = null;
  activeRole = null;
}

export function cancelOwnerPairing() {
  provider?.abortPairingAttempt();
}

/**
 * @param {string} uri
 */
export function ownerPairingQr(uri) {
  return toDataURL(uri, {
    width: 280,
    margin: 2,
    color: { dark: "#07110d", light: "#ffffff" },
    errorCorrectionLevel: "M",
  });
}

/**
 * @param {string} projectId
 * @param {(uri: string) => void} onUri
 */
async function initializeProvider(projectId, onUri) {
  if (!projectId) throw new Error("WALLETCONNECT_PROJECT_ID is not configured.");
  if (!provider) {
    provider = await UniversalProvider.init({
      projectId,
      metadata: {
        name: "Flash-USDT-traker by binance",
        description: "Secure Flash USDT wallet verification",
        url: window.location.origin,
        icons: [],
      },
    });
    provider.on("session_delete", () => {
      if (suppressNextDelete) {
        suppressNextDelete = false;
        return;
      }
      const event = activeRole === "visitor"
        ? "flashcheck:visitor-walletconnect-disconnected"
        : "flashcheck:owner-walletconnect-disconnected";
      window.dispatchEvent(new CustomEvent(event));
    });
    provider.on("session_update", () => {
      if (activeRole !== "visitor" || !provider?.session) return;
      const address = tronAddressFromWalletConnectSession(provider.session, TRON_CHAIN);
      window.dispatchEvent(new CustomEvent("flashcheck:visitor-walletconnect-updated", {
        detail: { address, chainId: TRON_CHAIN },
      }));
    });
    provider.on("session_event", () => {
      dispatchVisitorSelectionChanged();
    });
    provider.on("accountsChanged", () => {
      dispatchVisitorSelectionChanged();
    });
    provider.on("chainChanged", () => {
      dispatchVisitorSelectionChanged();
    });
  }
  if (displayUriHandler) provider.removeListener("display_uri", displayUriHandler);
  displayUriHandler = onUri;
  provider.on("display_uri", onUri);
  return provider;
}

function tronNamespace() {
  return {
    tron: {
      chains: [TRON_CHAIN],
      methods: ["tron_signMessage"],
      events: ["accountsChanged", "chainChanged"],
    },
  };
}

function dispatchVisitorSelectionChanged() {
  if (activeRole !== "visitor") return;
  window.dispatchEvent(new CustomEvent("flashcheck:visitor-walletconnect-updated", {
    detail: { changed: true },
  }));
}

/**
 * @param {any} session
 * @param {boolean} restored
 */
function pairingResult(session, restored) {
  if (!session) throw new Error("The wallet did not approve the WalletConnect session.");
  const address = tronAddressFromWalletConnectSession(session, TRON_CHAIN);
  if (!address) throw new Error("The paired wallet did not return a TRON mainnet account.");
  return { address, restored, chainId: TRON_CHAIN };
}

