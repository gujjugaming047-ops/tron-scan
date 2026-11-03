import UniversalProvider from "@walletconnect/universal-provider";
import { toDataURL } from "qrcode";
import { tronAddressFromWalletConnectSession } from "./wallet-state.mjs";

const TRON_CHAIN = "tron:0x2b6653dc";
/** @type {UniversalProvider | null} */
let provider = null;

/**
 * Start or restore a real WalletConnect v2 TRON session.
 * @param {{ projectId: string, onUri: (uri: string) => void }} options
 */
export async function pairOwnerWallet(options) {
  if (!options.projectId) throw new Error("WALLETCONNECT_PROJECT_ID is not configured.");
  provider = await UniversalProvider.init({
    projectId: options.projectId,
    metadata: {
      name: "FlashCheck",
      description: "Owner approval for Flash USDT verification",
      url: window.location.origin,
      icons: [],
    },
  });
  provider.on("display_uri", options.onUri);
  provider.on("session_delete", () => {
    window.dispatchEvent(new CustomEvent("flashcheck:owner-walletconnect-disconnected"));
  });

  const existing = provider.session;
  const session = existing || await provider.connect({
    namespaces: {
      tron: {
        chains: [TRON_CHAIN],
        methods: ["tron_signMessage"],
        events: [],
      },
    },
  });
  if (!session) throw new Error("The wallet did not approve the WalletConnect session.");
  const address = tronAddressFromWalletConnectSession(session, TRON_CHAIN);
  if (!address) throw new Error("The paired wallet did not return a TRON mainnet account.");
  return { address, restored: Boolean(existing), chainId: TRON_CHAIN };
}

/**
 * Ask the paired owner wallet to sign an authentication message.
 * This is not a transaction.
 * @param {string} address
 * @param {string} message
 */
export async function signOwnerMessage(address, message) {
  if (!provider?.session) throw new Error("The WalletConnect owner session is not ready.");
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

