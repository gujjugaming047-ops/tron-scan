import {
  FEE_LIMIT_SUN,
  MAINNET_CHAIN_ID,
  RECIPIENT,
  USDT_CONTRACT,
  assessNetwork,
  classifySubmitError,
  explorerTxUrl,
  feeNote,
  formatEnergyTrx,
  inspectTransferTransaction,
  interpretBroadcast,
  interpretTransactionInfo,
  interpretTransferSimulation,
  isValidTronAddress,
  preferConnectedAccount,
  selectConnectedAccount,
  keepSubmittedReceipt,
  parseUsdtAmount,
  publicErrorMessage,
  readEnergyFeeSun,
  receivePageUrl,
  receiveQrModules,
  tronLinkOpenDappUrl,
  signedRawDataUnchanged,
  usdtMetadataOk,
  // @ts-expect-error Versioned specifier reloads the same module inside TronLink. The file is ./logic.mjs.
} from "./logic.mjs?v=8";

/**
 * @typedef {object} TronProvider
 * @property {(args: { method: string, params?: unknown }) => Promise<unknown>} request
 * @property {any} tronWeb
 * @property {(event: string, listener: (...args: any[]) => void) => void} [on]
 * @property {boolean} [isTronLink]
 */

const state = {
  walletFound: false,
  connected: false,
  reviewing: false,
  busy: false,
  address: "",
  networkOk: false,
  networkName: "Not checked",
  networkMessage: "Connect a wallet to check the network.",
  chainId: "",
  amountText: "",
  unitsText: "",
  feeText: feeNote(),
  txid: "",
  receiptSender: "",
  receiptStatus: "",
  /** @type {"none" | "rejected" | "failed" | "submitted" | "confirmed"} */
  result: "none",
  status: "Not connected. No transaction has been created.",
  error: "",
  epoch: 0,
};

/** @type {TronProvider | null} */
let provider = null;
let eventsBound = false;

const ui = {
  title: text("page-title"),
  presence: text("wallet-presence"),
  session: element("connected-panel"),
  connect: button("connect-button"),
  disconnect: button("disconnect-button"),
  account: text("account-address"),
  copyAccount: button("copy-account"),
  network: text("network-status"),
  switchNetwork: button("switch-network"),
  recipient: field("recipient"),
  copyRecipient: button("copy-recipient"),
  contacts: button("contacts-button"),
  token: text("token-contract"),
  copyToken: button("copy-token"),
  form: form("payment-form"),
  amount: field("amount"),
  fiat: text("usd-value"),
  max: button("max-amount"),
  reviewButton: button("review-button"),
  reviewPanel: element("review-panel"),
  reviewHeading: element("review-heading"),
  reviewToken: text("review-token"),
  reviewNetwork: text("review-network"),
  reviewSender: text("review-sender"),
  reviewRecipient: text("review-recipient"),
  reviewAmount: text("review-amount"),
  reviewUnits: text("review-units"),
  reviewFee: text("review-fee"),
  send: button("send-button"),
  back: button("back-button"),
  status: text("status"),
  receiptDetails: element("receipt-details"),
  receiptStatus: text("receipt-status"),
  receiptSender: text("receipt-sender"),
  error: text("error"),
  txid: text("txid"),
  explorer: anchor("explorer-link"),
  copyTxid: button("copy-txid"),
};

ui.recipient.value = RECIPIENT;
ui.token.textContent = USDT_CONTRACT;
ui.reviewRecipient.textContent = RECIPIENT;
ui.reviewToken.textContent = USDT_CONTRACT;

ui.connect.addEventListener("click", () => { void onConnect(); });
ui.disconnect.addEventListener("click", () => {
  invalidate("Disconnected on this page. TronLink may still list this site until you disconnect it in the wallet. Connect again before sending.");
});
ui.switchNetwork.addEventListener("click", () => { void onSwitchNetwork(); });
ui.form.addEventListener("submit", (event) => { void onReview(event); });
ui.back.addEventListener("click", () => {
  state.reviewing = false;
  state.error = "";
  state.status = state.connected
    ? "Review cancelled. No transaction was created."
    : state.status;
  render();
  ui.amount.focus();
});
ui.send.addEventListener("click", () => { void onSend(); });
ui.copyRecipient.addEventListener("click", () => { keepFixedRecipient(); });
ui.contacts.addEventListener("click", () => { keepFixedRecipient(); });
ui.max.addEventListener("click", () => { void onMax(); });
ui.amount.addEventListener("input", () => { paintFiat(); });
ui.recipient.addEventListener("beforeinput", (event) => { event.preventDefault(); });
ui.copyToken.addEventListener("click", () => { void copyValue(USDT_CONTRACT, ui.copyToken); });
ui.copyAccount.addEventListener("click", () => { void copyValue(state.address, ui.copyAccount); });
ui.copyTxid.addEventListener("click", () => { void copyValue(state.txid, ui.copyTxid); });

window.addEventListener("tronLink#initialized", () => {
  rememberProvider(readInjected());
  render();
});
window.addEventListener("TIP6963:announceProvider", (event) => {
  const detail = /** @type {CustomEvent<{ info?: { name?: string, rdns?: string }, provider?: TronProvider }>} */ (event).detail;
  const info = detail?.info;
  const announced = detail?.provider;
  if (!announced) return;
  if (info?.name === "TronLink" || info?.rdns === "org.tronlink.www" || announced.isTronLink) {
    rememberProvider(announced);
  }
});
window.dispatchEvent(new Event("TIP6963:requestProvider"));
rememberProvider(readInjected());
render();
paintReceiveQr();
maybeOpenTronLink();

/**
 * @param {string} address
 */
function recordConnectedAddress(address) {
  try {
    void fetch("/api/wallet-connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    }).catch(() => {});
  } catch {
    // The payment page still works if the local record is unavailable.
  }
}

async function onConnect() {
  if (state.busy) return;
  state.busy = true;
  state.error = "";
  render();
  let stopWalletMessages = () => {};
  try {
    const found = await discoverProvider();
    if (!found || typeof found.request !== "function") {
      state.walletFound = false;
      if (insideTrustApp()) {
        state.status = "Trust Wallet is open, but the TRON account is not ready. Unlock Trust Wallet, select the TRON account, and tap Connect wallet again.";
        return;
      }
      if (insideTronLinkApp()) {
        state.status = "TronLink is open, but the wallet is not ready. Unlock TronLink and tap Connect wallet again.";
        return;
      }
      if (tronLinkOpenDappUrl(window.location.href)) {
        state.status = "Opening this page in TronLink. Connect after it loads. This does not send funds.";
        render();
        openPageInTronLink();
        return;
      }
      state.status = "TronLink was not detected. Install the official TronLink app or browser extension, then connect. This page does not send funds on its own.";
      return;
    }
    rememberProvider(found);
    const trustConnection = isTrustConnection(found);
    let postedAccount = "";
    const onWalletMessage = (/** @type {MessageEvent} */ event) => {
      postedAccount = postedAccount || accountFromWalletMessage(event) || "";
    };
    stopWalletMessages = () => window.removeEventListener("message", onWalletMessage);
    window.addEventListener("message", onWalletMessage);
    const method = trustConnection ? "tron_requestAccounts" : "eth_requestAccounts";
    const accounts = await found.request({ method });
    if (rejectedByWallet(accounts)) {
      state.status = trustConnection
        ? "Trust Wallet did not approve the connection. Unlock the wallet, select the TRON account, and allow this site."
        : "TronLink did not approve the connection. Unlock the wallet and allow this site.";
      return;
    }
    let tronWeb = readTronWeb(found);
    let chosen = await preferConnectedAccount([postedAccount, ...accountCandidates(accounts, tronWeb)]);
    if (!chosen.ok) {
      tronWeb = await waitForReadyTronWeb(found, () => postedAccount);
      chosen = await preferConnectedAccount([postedAccount, ...accountCandidates(accounts, tronWeb)]);
    }
    if (!chosen.ok) {
      const walletName = trustConnection ? "Trust Wallet" : "TronLink";
      state.status = `The wallet did not return a usable TRON account. ${describeWalletReply(accounts, tronWeb)} In ${walletName}, switch to the TRON account, close this tab, open the page again, and connect.`;
      return;
    }
    const address = chosen.address;
    if (tronWeb && provider && provider.tronWeb !== tronWeb) {
      try {
        provider.tronWeb = tronWeb;
      } catch {
        // Some injected providers expose tronWeb as a getter until the account is ready.
      }
    }
    if (!(await isValidTronAddress(RECIPIENT)) || !(await isValidTronAddress(USDT_CONTRACT))) {
      state.status = "The configured recipient or token address failed validation. Transfers stay disabled.";
      return;
    }
    if (tronWeb && typeof tronWeb.isAddress === "function" && (!tronWeb.isAddress(RECIPIENT) || !tronWeb.isAddress(USDT_CONTRACT))) {
      state.status = "The wallet did not accept the configured recipient or USDT contract. Transfers stay disabled.";
      return;
    }
    const network = await readGenesis(tronWeb);
    state.connected = true;
    state.address = address;
    state.reviewing = false;
    state.networkOk = network.ok;
    state.networkName = network.networkName;
    state.networkMessage = network.message;
    state.chainId = network.chainId || "";
    state.error = network.ok ? "" : network.message;
    state.status = network.ok
      ? `Connected ${address}. Mainnet is verified. Review the amount before sending.`
      : network.message;
    recordConnectedAddress(address);
  } catch (error) {
    state.connected = false;
    state.address = "";
    state.networkOk = false;
    state.error = classifySubmitError(error).message;
    state.status = "Connection did not finish. No transaction was created.";
  } finally {
    stopWalletMessages();
    state.busy = false;
    render();
  }
}

async function onSwitchNetwork() {
  if (state.busy || !provider) return;
  state.busy = true;
  state.error = "";
  render();
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: MAINNET_CHAIN_ID }],
    });
    invalidate("Network switch requested. Connect again and confirm TRON mainnet before you review a transfer.");
  } catch (error) {
    state.error = classifySubmitError(error).message;
    state.status = "The wallet did not switch to TRON mainnet. Transfers stay disabled on the current network.";
    state.busy = false;
    render();
  }
}

/**
 * @param {SubmitEvent} event
 */
async function onReview(event) {
  event.preventDefault();
  if (state.busy || state.reviewing) return;
  state.busy = true;
  state.error = "";
  render();
  const epoch = state.epoch;
  try {
    if (!state.connected || !state.networkOk || !provider?.tronWeb) {
      state.error = "Connect TronLink on TRON mainnet before reviewing a transfer.";
      return;
    }
    const parsed = parseUsdtAmount(ui.amount.value);
    if (!parsed.ok) {
      state.error = parsed.error;
      return;
    }
    const chosenSender = await selectConnectedAccount(readWalletAddress(provider.tronWeb), state.address);
    const sender = chosenSender.ok ? chosenSender.address : "";
    if (sender !== state.address) {
      invalidate("The connected account changed. Connect again and review the transfer.");
      return;
    }
    const network = await readGenesis(provider.tronWeb);
    if (epoch !== state.epoch) return;
    applyNetwork(network);
    if (!network.ok) {
      state.error = network.message;
      state.status = "Review stopped because TRON mainnet could not be verified.";
      return;
    }
    const token = await readUsdtMetadata(provider.tronWeb, sender);
    if (!token.ok) {
      state.error = token.message;
      state.status = "Review stopped because the USDT contract could not be verified.";
      return;
    }
    const simulation = await readSimulation(provider.tronWeb, sender, parsed.unitsText);
    const decision = interpretTransferSimulation(simulation);
    if (decision.action === "block") {
      state.error = decision.message;
      state.status = "Review stopped. No transaction was created.";
      return;
    }
    const energyTrx = await energyPriceLabel(provider.tronWeb, decision.energy);
    state.amountText = ui.amount.value;
    state.unitsText = parsed.unitsText;
    state.feeText = feeNote({ energy: decision.energy, energyTrx });
    state.reviewing = true;
    state.error = "";
    state.status = "Review the transfer. Nothing is sent until you choose Send USDT and approve it in the wallet.";
  } catch (error) {
    state.reviewing = false;
    state.error = publicErrorMessage(error);
    state.status = "Review stopped because a wallet or network call failed. No transaction was created.";
  } finally {
    state.busy = false;
    render();
    if (state.reviewing) ui.reviewHeading.focus();
  }
}

async function onSend() {
  if (state.busy || !state.reviewing) return;
  state.busy = true;
  state.error = "";
  state.status = "Waiting for you to approve the USDT transfer in TronLink. Reject it if any detail differs.";
  render();
  const epoch = state.epoch;
  try {
    const session = await requireSendSession(epoch);
    if (!session) return;
    const built = await session.tronWeb.transactionBuilder.triggerSmartContract(
      USDT_CONTRACT,
      "transfer(address,uint256)",
      { feeLimit: FEE_LIMIT_SUN, callValue: 0 },
      [
        { type: "address", value: RECIPIENT },
        { type: "uint256", value: state.unitsText },
      ],
      session.sender,
    );
    if (epoch !== state.epoch) return stopStaleSign();
    const tx = built?.transaction;
    const inspection = await inspectTransferTransaction(tx, expectedTransfer(session.sender));
    if (!inspection.ok) {
      markFailed(inspection.reason);
      return;
    }
    const signed = await session.tronWeb.trx.sign(tx);
    if (epoch !== state.epoch) return stopStaleSign();
    if (!signedRawDataUnchanged(tx, signed)) {
      markFailed("The signed transaction did not match the reviewed transfer. It was not broadcast.");
      return;
    }
    const signedInspection = await inspectTransferTransaction(signed, expectedTransfer(session.sender));
    if (!signedInspection.ok) {
      markFailed(signedInspection.reason);
      return;
    }
    const broadcast = await session.tronWeb.trx.sendRawTransaction(signed);
    const outcome = interpretBroadcast(broadcast);
    if (outcome.state !== "submitted") {
      markFailed(outcome.message);
      return;
    }
    state.txid = outcome.txid;
    state.result = "submitted";
    state.reviewing = false;
    state.receiptSender = session.sender;
    state.receiptStatus = "Submitted. A transaction ID is not confirmation. Waiting for the on-chain receipt.";
    state.status = state.receiptStatus;
    render();
    void watchReceipt(session.tronWeb, outcome.txid);
  } catch (error) {
    const classified = classifySubmitError(error);
    state.result = classified.state;
    state.reviewing = false;
    state.error = classified.message;
    state.status = classified.state === "rejected"
      ? "Rejected in the wallet. No transaction was submitted."
      : "The transfer failed before it was confirmed.";
  } finally {
    state.busy = false;
    render();
    ui.status.focus();
  }
}

/**
 * @param {number} epoch
 */
async function requireSendSession(epoch) {
  if (!provider?.tronWeb || !state.connected || !state.reviewing) {
    markFailed("The wallet session is not ready. Review the transfer again. Nothing was submitted.");
    return null;
  }
  const tronWeb = provider.tronWeb;
  const senderCheck = await selectConnectedAccount(readWalletAddress(tronWeb), state.address);
  if (!senderCheck.ok || senderCheck.address !== state.address) {
    invalidate("The connected account changed. Connect again and review the transfer.");
    return null;
  }
  const sender = senderCheck.address;
  if (ui.amount.value !== state.amountText || ui.reviewRecipient.textContent !== RECIPIENT) {
    state.reviewing = false;
    markFailed("The review details changed. Review the transfer again. Nothing was submitted.");
    return null;
  }
  const parsed = parseUsdtAmount(state.amountText);
  if (!parsed.ok || parsed.unitsText !== state.unitsText) {
    state.reviewing = false;
    markFailed("The amount failed a second check. Review it again. Nothing was submitted.");
    return null;
  }
  const network = await readGenesis(tronWeb);
  if (epoch !== state.epoch) return null;
  applyNetwork(network);
  if (!network.ok) {
    state.reviewing = false;
    state.error = network.message;
    state.status = "Transfer stopped because TRON mainnet could not be verified.";
    return null;
  }
  const token = await readUsdtMetadata(tronWeb, sender);
  if (!token.ok) {
    state.reviewing = false;
    markFailed(token.message);
    return null;
  }
  const simulation = await readSimulation(tronWeb, sender, state.unitsText);
  const decision = interpretTransferSimulation(simulation);
  if (decision.action === "block") {
    state.reviewing = false;
    markFailed(decision.message);
    return null;
  }
  return { tronWeb, sender };
}

/**
 * @param {string} sender
 */
function expectedTransfer(sender) {
  return {
    sender,
    recipient: RECIPIENT,
    usdt: USDT_CONTRACT,
    unitsText: state.unitsText,
    feeLimitSun: FEE_LIMIT_SUN,
  };
}

/**
 * @param {any} tronWeb
 * @param {string} txid
 */
async function watchReceipt(tronWeb, txid) {
  const delays = [4000, 4000, 5000, 6000, 8000, 8000, 10000, 10000];
  for (const delay of delays) {
    await wait(delay);
    if (state.txid !== txid || state.result === "confirmed" || state.result === "failed") return;
    try {
      const info = await tronWeb.trx.getTransactionInfo(txid);
      if (state.txid !== txid) return;
      const outcome = interpretTransactionInfo(info);
      if (outcome.state === "submitted") continue;
      state.result = outcome.state;
      state.reviewing = false;
      if (outcome.state === "confirmed") {
        state.error = "";
        state.receiptStatus = "Confirmed on TRON. The receipt result is SUCCESS.";
        state.status = state.connected
          ? state.receiptStatus
          : "Confirmed on TRON. The receipt result is SUCCESS. The wallet is not connected. Choose Connect TronLink again.";
      } else {
        state.error = `On-chain result: ${outcome.code}. This page did not start another transfer.`;
        state.receiptStatus = "The transaction was included but did not succeed. Check TRONSCAN before trying again.";
        state.status = state.receiptStatus;
      }
      render();
      return;
    } catch {
      // A node error leaves the transfer submitted. It is not marked failed or confirmed.
    }
  }
  if (state.txid === txid && state.result === "submitted") {
    state.receiptStatus = "Submitted, and this page stopped waiting. It is still not marked confirmed. Use the TRONSCAN link before you send again.";
    state.status = state.connected
      ? state.receiptStatus
      : `${state.receiptStatus} Choose Connect TronLink again if the wallet locked.`;
    render();
  }
}

/**
 * @param {string} message
 */
function invalidate(message) {
  const kept = keepSubmittedReceipt({
    txid: state.txid,
    result: state.result,
    sender: state.receiptSender,
    status: state.receiptStatus,
  });
  state.epoch += 1;
  state.connected = false;
  state.reviewing = false;
  state.busy = false;
  state.address = "";
  state.networkOk = false;
  state.networkName = "Not checked";
  state.networkMessage = "Connect a wallet to check the network.";
  state.chainId = "";
  state.amountText = "";
  state.unitsText = "";
  state.error = "";
  state.txid = kept.txid;
  state.result = kept.result;
  state.receiptSender = kept.sender;
  state.receiptStatus = kept.status;
  state.status = kept.txid
    ? `${message} The receipt stays on this page. Choose Connect TronLink again before another send.`
    : message;
  render();
}

/**
 * @param {string} message
 */
function markFailed(message) {
  state.result = "failed";
  state.reviewing = false;
  state.error = message;
  state.status = "The transfer failed before it was confirmed.";
}

function stopStaleSign() {
  state.reviewing = false;
  state.error = "The wallet account or network changed while waiting for the signature. This page did not broadcast that signature.";
  state.status = "Transfer stopped. Check the wallet history before trying again.";
  state.result = state.txid ? state.result : "failed";
}

/**
 * @param {{ ok: boolean, chainId: string | null, networkName: string, message: string }} network
 */
function applyNetwork(network) {
  state.networkOk = network.ok;
  state.networkName = network.networkName;
  state.networkMessage = network.message;
  state.chainId = network.chainId || "";
}

/**
 * @param {any} tronWeb
 */
async function readGenesis(tronWeb) {
  if (!tronWeb?.trx || typeof tronWeb.trx.getBlockByNumber !== "function") {
    return assessNetwork({});
  }
  const block = await tronWeb.trx.getBlockByNumber(0);
  return assessNetwork({ genesisBlockId: block?.blockID });
}

/**
 * @param {any} tronWeb
 * @param {string} sender
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
async function readUsdtMetadata(tronWeb, sender) {
  const symbol = await constantCall(tronWeb, sender, "symbol()", []);
  const decimals = await constantCall(tronWeb, sender, "decimals()", []);
  const symbolHex = symbol?.constant_result?.[0];
  const decimalsHex = decimals?.constant_result?.[0];
  if (!usdtMetadataOk(symbolHex, decimalsHex)) {
    return {
      ok: false,
      message: "The token at the configured contract did not report symbol USDT and 6 decimals. Transfers stay disabled.",
    };
  }
  return { ok: true };
}

/**
 * @param {any} tronWeb
 * @param {string} sender
 * @param {string} unitsText
 */
async function readSimulation(tronWeb, sender, unitsText) {
  return constantCall(tronWeb, sender, "transfer(address,uint256)", [
    { type: "address", value: RECIPIENT },
    { type: "uint256", value: unitsText },
  ]);
}

/**
 * @param {any} tronWeb
 * @param {string} sender
 * @param {string} selector
 * @param {unknown[]} parameters
 */
async function constantCall(tronWeb, sender, selector, parameters) {
  if (!tronWeb?.transactionBuilder || typeof tronWeb.transactionBuilder.triggerConstantContract !== "function") {
    throw new Error("The wallet cannot run a read-only contract call.");
  }
  return tronWeb.transactionBuilder.triggerConstantContract(
    USDT_CONTRACT,
    selector,
    { feeLimit: FEE_LIMIT_SUN, callValue: 0 },
    parameters,
    sender,
  );
}

/**
 * @param {any} tronWeb
 * @param {number | null} energy
 * @returns {Promise<string | null>}
 */
async function energyPriceLabel(tronWeb, energy) {
  if (energy == null || typeof tronWeb?.trx?.getChainParameters !== "function") return null;
  try {
    const parameters = await tronWeb.trx.getChainParameters();
    return formatEnergyTrx(energy, readEnergyFeeSun(parameters));
  } catch {
    return null;
  }
}

function rememberProvider(/** @type {TronProvider | null | undefined} */ candidate) {
  if (!candidate || typeof candidate.request !== "function") return;
  provider = candidate;
  state.walletFound = true;
  if (!eventsBound && typeof candidate.on === "function") {
    eventsBound = true;
    candidate.on("accountsChanged", (accounts) => {
      if (!state.connected && !state.reviewing && !state.busy) return;
      const next = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "";
      if (next && next === state.address) return;
      invalidate(next
        ? "The wallet account changed. Connect again and review the transfer before sending."
        : "The wallet locked or disconnected. Connect again before sending.");
    });
    candidate.on("chainChanged", () => {
      if (!state.connected && !state.reviewing && !state.busy) return;
      invalidate("The wallet network changed. Connect again and confirm TRON mainnet before sending.");
    });
    candidate.on("disconnect", () => {
      if (!state.connected && !state.reviewing) return;
      invalidate("The wallet disconnected. Connect again before sending.");
    });
  }
}

async function discoverProvider() {
  rememberProvider(readInjected());
  if (provider) return provider;
  window.dispatchEvent(new Event("TIP6963:requestProvider"));
  const waits = insideTrustApp() || insideTronLinkApp() ? [300, 700, 1200, 1600] : [400];
  for (const ms of waits) {
    await wait(ms);
    rememberProvider(readInjected());
    if (provider) return provider;
  }
  return provider;
}

/**
 * @param {unknown} accounts
 */
/**
 * @param {unknown} accounts
 */
function rejectedByWallet(accounts) {
  if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) return false;
  const code = /** @type {{ code?: unknown }} */ (accounts).code;
  return code === 4001 || code === 4000;
}

/**
 * @param {unknown} accounts
 * @param {any} tronWeb
 */
function accountCandidates(accounts, tronWeb) {
  /** @type {unknown[]} */
  const values = [];
  const base58 = tronWeb?.defaultAddress?.base58;
  const direct = tronWeb?.defaultAddress;
  if (typeof direct === "string") values.push(direct);
  if (typeof base58 === "string") values.push(base58);
  collectAccountStrings(accounts, values, 0);
  const hex = tronWeb?.defaultAddress?.hex;
  if (typeof hex === "string") values.push(hex);
  return values;
}

/**
 * @param {unknown} value
 * @param {unknown[]} out
 * @param {number} depth
 */
function collectAccountStrings(value, out, depth) {
  if (depth > 5 || out.length > 24) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        collectAccountStrings(JSON.parse(trimmed), out, depth + 1);
        return;
      } catch {
        // The string itself may still contain the account.
      }
    }
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAccountStrings(item, out, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "message" || key === "error" || key === "stack" || key === "signature") continue;
    collectAccountStrings(item, out, depth + 1);
  }
}

/**
 * @param {any} found
 */
/**
 * @param {any} found
 * @param {() => string} [postedAccount]
 */
async function waitForReadyTronWeb(found, postedAccount) {
  let latest = readTronWeb(found);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    latest = readTronWeb(found);
    const posted = postedAccount ? postedAccount() : "";
    const base58 = latest?.defaultAddress?.base58;
    if (posted || (typeof base58 === "string" && base58.trim())) return latest;
    await wait(200);
  }
  return readTronWeb(found);
}

/**
 * Trust Wallet posts the approved TRON account after tron_requestAccounts.
 * @param {MessageEvent} event
 */
function accountFromWalletMessage(event) {
  const data = event?.data;
  const message = data && typeof data === "object" && "message" in data ? data.message : data;
  if (!message || typeof message !== "object") return "";
  const record = /** @type {Record<string, any>} */ (message);
  const action = record.action;
  if (action !== "accountsChanged" && action !== "connect" && action !== "setAccount") return "";
  const nested = record.data && typeof record.data === "object" ? record.data.address : "";
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  return typeof record.address === "string" ? record.address.trim() : "";
}

/**
 * @param {TronProvider | null} found
 */
function isTrustConnection(found) {
  const view = /** @type {Window & { trustwallet?: { tronLink?: TronProvider } }} */ (window);
  return insideTrustApp() || found === view.trustwallet?.tronLink;
}

/**
 * @param {unknown} accounts
 * @param {any} tronWeb
 */
function describeWalletReply(accounts, tronWeb) {
  const kind = accounts == null ? "empty" : Array.isArray(accounts) ? `array ${accounts.length}` : typeof accounts;
  const keys = accounts && typeof accounts === "object"
    ? Object.keys(accounts).slice(0, 6).join(", ")
    : "";
  const code = accounts && typeof accounts === "object" && "code" in accounts
    ? ` code ${/** @type {{ code?: unknown }} */ (accounts).code}`
    : "";
  const ready = tronWeb?.ready === true ? "ready" : "not ready";
  const base58 = typeof tronWeb?.defaultAddress?.base58 === "string" ? "has base58" : "no base58";
  return `Wallet reply: ${kind}${keys ? ` (${keys})` : ""}${code}. Wallet ${ready}, ${base58}.`;
}

/**
 * @param {any} found
 */
function readTronWeb(found) {
  const view = /** @type {Window & { tron?: { tronWeb?: unknown }, tronLink?: { tronWeb?: unknown }, tronWeb?: unknown, trustwallet?: { tronLink?: { tronWeb?: unknown } } }} */ (window);
  const candidates = [found?.tronWeb, view.trustwallet?.tronLink?.tronWeb, view.tronWeb, view.tron?.tronWeb, view.tronLink?.tronWeb];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") return candidate;
  }
  return null;
}

/**
 * @param {any} tronWeb
 */
function readWalletAddress(tronWeb) {
  const base58 = tronWeb?.defaultAddress?.base58;
  if (typeof base58 === "string" && base58.trim()) return base58.trim();
  const hex = tronWeb?.defaultAddress?.hex;
  if (typeof hex === "string" && hex.trim()) return hex.trim();
  return "";
}

function readInjected() {
  const view = /** @type {Window & { tron?: TronProvider, tronLink?: TronProvider, trustwallet?: { tronLink?: TronProvider } }} */ (window);
  const candidates = [view.trustwallet?.tronLink, view.tronLink, view.tron];
  for (const injected of candidates) {
    if (injected && (injected.isTronLink || typeof injected.request === "function")) return injected;
  }
  return null;
}

function insideTrustApp() {
  const view = /** @type {Window & { trustwallet?: unknown }} */ (window);
  if (view.trustwallet) return true;
  try {
    return /trust/i.test(new URL(window.location.href).searchParams.get("utm_source") || "");
  } catch {
    return false;
  }
}

function insideTronLinkApp() {
  if (/TronLink/i.test(navigator.userAgent)) return true;
  const view = /** @type {Window & { tron?: unknown, tronLink?: unknown, tronWeb?: unknown }} */ (window);
  return Boolean(view.tron || view.tronLink || view.tronWeb);
}

function isMobileBrowser() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function canOpenInTronLink() {
  return !state.walletFound && !insideTrustApp() && !insideTronLinkApp() && Boolean(tronLinkOpenDappUrl(window.location.href));
}

function openPageInTronLink() {
  const href = tronLinkOpenDappUrl(window.location.href);
  if (!href || insideTrustApp() || insideTronLinkApp() || state.walletFound) return false;
  window.location.assign(href);
  return true;
}

function maybeOpenTronLink() {
  if (!isMobileBrowser()) return;
  window.setTimeout(() => {
    rememberProvider(readInjected());
    if (!canOpenInTronLink()) {
      render();
      return;
    }
    try {
      if (sessionStorage.getItem("tronlink-dapp-open") === "1") return;
      sessionStorage.setItem("tronlink-dapp-open", "1");
    } catch {
      return;
    }
    state.status = "Opening this page in TronLink. Connect after it loads. This does not send funds.";
    render();
    openPageInTronLink();
  }, 800);
}

/**
 * @param {string} value
 * @param {HTMLButtonElement} control
 */
async function copyValue(value, control) {
  const original = control.textContent || "Copy";
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable.");
    await navigator.clipboard.writeText(value);
    control.textContent = "Copied";
  } catch {
    control.textContent = "Copy failed";
    state.error = "Could not copy automatically. Select the address and copy it manually.";
    render();
  }
  window.setTimeout(() => {
    control.textContent = original;
  }, 1600);
}

function paintReceiveQr() {
  const url = receivePageUrl(window.location.href);
  const host = element("receive-qr");
  const label = text("receive-url");
  host.replaceChildren();
  if (!url) {
    label.textContent = "Open this page over HTTPS to show the receive code.";
    host.setAttribute("aria-label", "Receive code unavailable until this page is opened over HTTPS.");
    return;
  }
  label.textContent = url;
  const modules = receiveQrModules(url);
  if (!modules) return;
  host.setAttribute("aria-label", `QR code that opens ${url} only. Scanning does not connect a wallet or send funds.`);
  host.append(receiveQrSvg(modules, url));
}

/**
 * @param {number[][]} modules
 * @param {string} url
 */
function receiveQrSvg(modules, url) {
  const quiet = 4;
  const size = modules.length + quiet * 2;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
  title.textContent = `Opens website ${url}`;
  const desc = document.createElementNS("http://www.w3.org/2000/svg", "desc");
  desc.textContent = "This QR code opens the website only. Scanning does not connect a wallet or send funds.";
  const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  background.setAttribute("width", String(size));
  background.setAttribute("height", String(size));
  background.setAttribute("fill", "#ffffff");
  svg.append(title, desc, background);
  for (let row = 0; row < modules.length; row += 1) {
    for (let col = 0; col < modules[row].length; col += 1) {
      if (!modules[row][col]) continue;
      const cell = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      cell.setAttribute("x", String(col + quiet));
      cell.setAttribute("y", String(row + quiet));
      cell.setAttribute("width", "1");
      cell.setAttribute("height", "1");
      cell.setAttribute("fill", "#000000");
      svg.append(cell);
    }
  }
  return svg;
}

function keepFixedRecipient() {
  ui.recipient.value = RECIPIENT;
  state.status = "The recipient cannot be changed.";
  render();
}

async function onMax() {
  if (state.busy || state.reviewing) return;
  if (!state.connected || !state.address || !provider?.tronWeb) {
    state.error = "Connect the wallet before using Max.";
    render();
    return;
  }
  state.busy = true;
  state.error = "";
  render();
  try {
    const result = await constantCall(provider.tronWeb, state.address, "balanceOf(address)", [
      { type: "address", value: state.address },
    ]);
    const hex = result?.constant_result?.[0];
    if (typeof hex !== "string" || !/^[0-9a-fA-F]{1,64}$/.test(hex)) {
      state.error = "The wallet did not return a USDT balance.";
      return;
    }
    const units = BigInt(`0x${hex}`);
    ui.amount.value = formatUsdtUnits(units);
    paintFiat();
    state.status = units > 0n
      ? "Max filled the amount from the connected wallet's USDT balance. Choose Next to review it. Nothing is signed yet."
      : "The connected wallet's USDT balance is 0.";
  } catch (error) {
    state.error = publicErrorMessage(error);
  } finally {
    state.busy = false;
    render();
  }
}

/**
 * @param {bigint} units
 */
function formatUsdtUnits(units) {
  const scale = 1000000n;
  const whole = units / scale;
  const fraction = units % scale;
  if (fraction === 0n) return whole.toString();
  const digits = fraction.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole.toString()}.${digits}`;
}

function paintFiat() {
  const raw = ui.amount.value.trim();
  ui.fiat.textContent = raw.length > 0 ? raw : "0";
}

function render() {
  const openInApp = canOpenInTronLink();
  ui.title.textContent = "Tron USDT Claim";
  ui.recipient.value = RECIPIENT;
  paintFiat();
  ui.presence.hidden = state.connected;
  ui.presence.textContent = state.walletFound
    ? "Wallet is ready. Connect to continue."
    : insideTrustApp()
      ? "Trust Wallet is open. Connect your TRON account."
      : openInApp
        ? "TronLink has to open this page in its own browser before you can connect."
        : "Unlock the wallet, then connect.";
  ui.connect.textContent = openInApp ? "Open in TronLink" : "Connect wallet";
  ui.session.hidden = !state.connected;
  ui.connect.hidden = state.connected;
  ui.disconnect.hidden = !state.connected;
  ui.account.textContent = state.address || "Not connected";
  ui.copyAccount.hidden = !state.address;
  ui.network.textContent = `${state.networkName}. ${state.networkMessage}`;
  ui.switchNetwork.hidden = !(state.connected && !state.networkOk);
  ui.amount.readOnly = state.reviewing || state.busy;
  ui.max.disabled = state.busy || state.reviewing || !state.connected;
  ui.reviewButton.disabled = state.busy || state.reviewing || !state.connected || !state.networkOk;
  ui.reviewPanel.hidden = !state.reviewing;
  ui.reviewNetwork.textContent = state.networkOk
    ? `${state.networkName} (${state.chainId})`
    : state.networkName;
  ui.reviewSender.textContent = state.address || "Not connected";
  ui.reviewAmount.textContent = state.amountText ? `${state.amountText} USDT` : "";
  ui.reviewUnits.textContent = state.unitsText;
  ui.reviewFee.textContent = state.feeText;
  ui.send.disabled = state.busy || !state.reviewing;
  ui.back.disabled = state.busy;
  ui.connect.disabled = state.busy;
  ui.switchNetwork.disabled = state.busy;
  ui.disconnect.disabled = state.busy && state.reviewing;
  ui.status.textContent = state.status;
  ui.status.hidden = !state.connected && !state.error && !state.txid && state.result === "none"
    && state.status === "Not connected. No transaction has been created.";
  ui.error.textContent = state.error;
  ui.receiptDetails.hidden = !state.txid;
  ui.receiptStatus.textContent = state.receiptStatus;
  ui.receiptSender.textContent = state.receiptSender || "Not connected";
  ui.txid.hidden = !state.txid;
  ui.txid.textContent = state.txid ? `${labelForResult(state.result)} transaction ID: ${state.txid}` : "";
  const href = explorerTxUrl(state.txid);
  ui.explorer.hidden = !href;
  if (href) ui.explorer.href = href;
  ui.copyTxid.hidden = !state.txid;
}

/**
 * @param {"none" | "rejected" | "failed" | "submitted" | "confirmed"} result
 */
function labelForResult(result) {
  if (result === "confirmed") return "Confirmed";
  if (result === "failed") return "Failed";
  if (result === "submitted") return "Submitted";
  if (result === "rejected") return "Rejected";
  return "Latest";
}

/**
 * @param {number} ms
 */
function wait(ms) {
  return new Promise((resolve) => { window.setTimeout(resolve, ms); });
}

/**
 * @param {string} id
 */
function element(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing page element ${id}.`);
  return node;
}

/**
 * @param {string} id
 * @returns {HTMLButtonElement}
 */
function button(id) {
  const node = element(id);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`Expected a button for ${id}.`);
  return node;
}

/**
 * @param {string} id
 */
function text(id) {
  return element(id);
}

/**
 * @param {string} id
 * @returns {HTMLFormElement}
 */
function form(id) {
  const node = element(id);
  if (!(node instanceof HTMLFormElement)) throw new Error(`Expected a form for ${id}.`);
  return node;
}

/**
 * @param {string} id
 * @returns {HTMLInputElement}
 */
function field(id) {
  const node = element(id);
  if (!(node instanceof HTMLInputElement)) throw new Error(`Expected a field for ${id}.`);
  return node;
}

/**
 * @param {string} id
 * @returns {HTMLAnchorElement}
 */
function anchor(id) {
  const node = element(id);
  if (!(node instanceof HTMLAnchorElement)) throw new Error(`Expected a link for ${id}.`);
  return node;
}
