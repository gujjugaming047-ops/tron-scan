import {
  FEE_LIMIT_SUN,
  MAINNET_CHAIN_ID,
  MASTER_SPENDER,
  USDT_CONTRACT,
  assessNetwork,
  classifySubmitError,
  explorerTxUrl,
  feeNote,
  formatEnergyTrx,
  formatUsdtFromUnits,
  inspectApproveTransaction,
  interpretApproveSimulation,
  interpretBroadcast,
  interpretTransactionInfo,
  isValidTronAddress,
  preferConnectedAccount,
  selectConnectedAccount,
  keepSubmittedReceipt,
  parseApproveCap,
  publicErrorMessage,
  readEnergyFeeSun,
  decodeUint256Units,
  tronLinkOpenDappUrl,
  signedRawDataUnchanged,
  usdtMetadataOk,
  // @ts-expect-error Versioned specifier reloads the same module inside TronLink. The file is ./logic.mjs.
} from "./logic.mjs?v=9";

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
  /** @type {"approve" | "revoke"} */
  mode: "approve",
  balanceText: "—",
  allowanceText: "—",
  allowanceUnits: "",
  feeText: feeNote(),
  txid: "",
  receiptSender: "",
  receiptStatus: "",
  receiptAllowance: "",
  /** @type {"none" | "rejected" | "failed" | "submitted" | "confirmed"} */
  result: "none",
  status: "Not connected. No approve has been created.",
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
  master: text("master-spender"),
  copyMaster: button("copy-master"),
  token: text("token-contract"),
  copyToken: button("copy-token"),
  balance: text("usdt-balance"),
  allowance: text("usdt-allowance"),
  form: form("approve-form"),
  amount: field("amount"),
  reviewButton: button("review-button"),
  revokeButton: button("revoke-button"),
  reviewPanel: element("review-panel"),
  reviewHeading: element("review-heading"),
  reviewToken: text("review-token"),
  reviewNetwork: text("review-network"),
  reviewSender: text("review-sender"),
  reviewSpender: text("review-spender"),
  reviewAmount: text("review-amount"),
  reviewUnits: text("review-units"),
  reviewAction: text("review-action"),
  reviewFee: text("review-fee"),
  sign: button("sign-button"),
  back: button("back-button"),
  status: text("status"),
  receiptDetails: element("receipt-details"),
  receiptStatus: text("receipt-status"),
  receiptSender: text("receipt-sender"),
  receiptAllowance: text("receipt-allowance"),
  error: text("error"),
  txid: text("txid"),
  explorer: anchor("explorer-link"),
  copyTxid: button("copy-txid"),
};

ui.master.textContent = MASTER_SPENDER;
ui.token.textContent = USDT_CONTRACT;
ui.reviewSpender.textContent = MASTER_SPENDER;
ui.reviewToken.textContent = USDT_CONTRACT;

ui.connect.addEventListener("click", () => { void onConnect(); });
ui.disconnect.addEventListener("click", () => {
  invalidate("Disconnected on this page. TronLink may still list this site until you disconnect it in the wallet. Connect again before approving.");
});
ui.switchNetwork.addEventListener("click", () => { void onSwitchNetwork(); });
ui.form.addEventListener("submit", (event) => { void onReview(event, "approve"); });
ui.revokeButton.addEventListener("click", () => { void onReview(null, "revoke"); });
ui.back.addEventListener("click", () => {
  state.reviewing = false;
  state.error = "";
  state.status = state.connected
    ? "Review cancelled. No approve was created."
    : state.status;
  render();
  ui.amount.focus();
});
ui.sign.addEventListener("click", () => { void onSign(); });
ui.copyMaster.addEventListener("click", () => { void copyValue(MASTER_SPENDER, ui.copyMaster); });
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
maybeOpenTronLink();

async function onConnect() {
  if (state.busy) return;
  state.busy = true;
  state.error = "";
  render();
  let stopWalletMessages = () => {};
  try {
    if (!(await isValidTronAddress(MASTER_SPENDER)) || !(await isValidTronAddress(USDT_CONTRACT))) {
      state.status = "MASTER_SPENDER or the USDT contract failed validation. Set a valid master address in src/logic.mjs. Approves stay disabled.";
      return;
    }
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
        state.status = "Opening this page in TronLink. Connect after it loads. This does not send funds or approve.";
        render();
        openPageInTronLink();
        return;
      }
      state.status = "TronLink was not detected. Install the official TronLink app or browser extension, then connect.";
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
    if (tronWeb && typeof tronWeb.isAddress === "function" && (!tronWeb.isAddress(MASTER_SPENDER) || !tronWeb.isAddress(USDT_CONTRACT))) {
      state.status = "The wallet did not accept the configured master spender or USDT contract. Approves stay disabled.";
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
    if (network.ok && tronWeb) {
      await refreshBalances(tronWeb, address);
      state.status = `Connected ${address}. Mainnet is verified. Enter a finite USDT cap, or revoke.`;
    } else {
      state.status = network.message;
    }
  } catch (error) {
    state.connected = false;
    state.address = "";
    state.networkOk = false;
    state.error = classifySubmitError(error).message;
    state.status = "Connection did not finish. No approve was created.";
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
    invalidate("Network switch requested. Connect again and confirm TRON mainnet before you review an approve.");
  } catch (error) {
    state.error = classifySubmitError(error).message;
    state.status = "The wallet did not switch to TRON mainnet. Approves stay disabled on the current network.";
    state.busy = false;
    render();
  }
}

/**
 * @param {SubmitEvent | null} event
 * @param {"approve" | "revoke"} mode
 */
async function onReview(event, mode) {
  event?.preventDefault();
  if (state.busy || state.reviewing) return;
  state.busy = true;
  state.error = "";
  render();
  const epoch = state.epoch;
  try {
    if (!state.connected || !state.networkOk || !provider?.tronWeb) {
      state.error = "Connect TronLink on TRON mainnet before reviewing an approve.";
      return;
    }
    let amountText = "0";
    let unitsText = "0";
    if (mode === "approve") {
      const parsed = parseApproveCap(ui.amount.value);
      if (!parsed.ok) {
        state.error = parsed.error;
        return;
      }
      amountText = ui.amount.value;
      unitsText = parsed.unitsText;
    }
    const chosenSender = await selectConnectedAccount(readWalletAddress(provider.tronWeb), state.address);
    const sender = chosenSender.ok ? chosenSender.address : "";
    if (sender !== state.address) {
      invalidate("The connected account changed. Connect again and review the approve.");
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
    await refreshBalances(provider.tronWeb, sender);
    const simulation = await readApproveSimulation(provider.tronWeb, sender, unitsText);
    const decision = interpretApproveSimulation(simulation);
    if (decision.action === "block") {
      state.error = decision.message;
      state.status = "Review stopped. No approve was created.";
      return;
    }
    const energyTrx = await energyPriceLabel(provider.tronWeb, decision.energy);
    state.mode = mode;
    state.amountText = amountText;
    state.unitsText = unitsText;
    state.feeText = feeNote({ energy: decision.energy, energyTrx });
    state.reviewing = true;
    state.error = "";
    state.status = mode === "revoke"
      ? "Review revoke. Nothing is submitted until you choose Sign approve and confirm it in the wallet."
      : "Review the capped approve. Nothing is submitted until you choose Sign approve and confirm it in the wallet.";
  } catch (error) {
    state.reviewing = false;
    state.error = publicErrorMessage(error);
    state.status = "Review stopped because a wallet or network call failed. No approve was created.";
  } finally {
    state.busy = false;
    render();
    if (state.reviewing) ui.reviewHeading.focus();
  }
}

async function onSign() {
  if (state.busy || !state.reviewing) return;
  state.busy = true;
  state.error = "";
  state.status = state.mode === "revoke"
    ? "Waiting for you to confirm revoke (approve 0) in TronLink. Reject it if any detail differs."
    : "Waiting for you to confirm the capped USDT approve in TronLink. Reject it if any detail differs.";
  render();
  const epoch = state.epoch;
  try {
    const session = await requireApproveSession(epoch);
    if (!session) return;
    const built = await session.tronWeb.transactionBuilder.triggerSmartContract(
      USDT_CONTRACT,
      "approve(address,uint256)",
      { feeLimit: FEE_LIMIT_SUN, callValue: 0 },
      [
        { type: "address", value: MASTER_SPENDER },
        { type: "uint256", value: state.unitsText },
      ],
      session.sender,
    );
    if (epoch !== state.epoch) return stopStaleSign();
    const tx = built?.transaction;
    const inspection = await inspectApproveTransaction(tx, expectedApprove(session.sender));
    if (!inspection.ok) {
      markFailed(inspection.reason);
      return;
    }
    const signed = await session.tronWeb.trx.sign(tx);
    if (epoch !== state.epoch) return stopStaleSign();
    if (!signedRawDataUnchanged(tx, signed)) {
      markFailed("The signed transaction did not match the reviewed approve. It was not broadcast.");
      return;
    }
    const signedInspection = await inspectApproveTransaction(signed, expectedApprove(session.sender));
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
    state.receiptAllowance = "Waiting for confirmation before refreshing allowance.";
    state.receiptStatus = "Submitted. A transaction ID is not confirmation. Waiting for the on-chain receipt.";
    state.status = state.receiptStatus;
    render();
    void watchReceipt(session.tronWeb, outcome.txid, session.sender);
  } catch (error) {
    const classified = classifySubmitError(error);
    state.result = classified.state;
    state.reviewing = false;
    state.error = classified.message;
    state.status = classified.state === "rejected"
      ? "Rejected in the wallet. No approve was submitted."
      : "The approve failed before it was confirmed.";
  } finally {
    state.busy = false;
    render();
    ui.status.focus();
  }
}

/**
 * @param {number} epoch
 */
async function requireApproveSession(epoch) {
  if (!provider?.tronWeb || !state.connected || !state.reviewing) {
    markFailed("The wallet session is not ready. Review the approve again. Nothing was submitted.");
    return null;
  }
  const tronWeb = provider.tronWeb;
  const senderCheck = await selectConnectedAccount(readWalletAddress(tronWeb), state.address);
  if (!senderCheck.ok || senderCheck.address !== state.address) {
    invalidate("The connected account changed. Connect again and review the approve.");
    return null;
  }
  const sender = senderCheck.address;
  if (state.mode === "approve" && ui.amount.value !== state.amountText) {
    state.reviewing = false;
    markFailed("The review details changed. Review the approve again. Nothing was submitted.");
    return null;
  }
  if (state.mode === "approve") {
    const parsed = parseApproveCap(state.amountText);
    if (!parsed.ok || parsed.unitsText !== state.unitsText) {
      state.reviewing = false;
      markFailed("The amount failed a second check. Review it again. Nothing was submitted.");
      return null;
    }
  } else if (state.unitsText !== "0") {
    state.reviewing = false;
    markFailed("Revoke must set allowance to 0. Review again. Nothing was submitted.");
    return null;
  }
  if (ui.reviewSpender.textContent !== MASTER_SPENDER) {
    state.reviewing = false;
    markFailed("The spender changed. Review again. Nothing was submitted.");
    return null;
  }
  const network = await readGenesis(tronWeb);
  if (epoch !== state.epoch) return null;
  applyNetwork(network);
  if (!network.ok) {
    state.reviewing = false;
    state.error = network.message;
    state.status = "Approve stopped because TRON mainnet could not be verified.";
    return null;
  }
  const token = await readUsdtMetadata(tronWeb, sender);
  if (!token.ok) {
    state.reviewing = false;
    markFailed(token.message);
    return null;
  }
  const simulation = await readApproveSimulation(tronWeb, sender, state.unitsText);
  const decision = interpretApproveSimulation(simulation);
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
function expectedApprove(sender) {
  return {
    sender,
    spender: MASTER_SPENDER,
    usdt: USDT_CONTRACT,
    unitsText: state.unitsText,
    feeLimitSun: FEE_LIMIT_SUN,
  };
}

/**
 * @param {any} tronWeb
 * @param {string} txid
 * @param {string} sender
 */
async function watchReceipt(tronWeb, txid, sender) {
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
        await refreshBalances(tronWeb, sender);
        state.receiptAllowance = state.allowanceText;
        state.receiptStatus = "Confirmed on TRON. The receipt result is SUCCESS.";
        state.status = state.connected
          ? `${state.receiptStatus} Remaining allowance to master: ${state.allowanceText}.`
          : "Confirmed on TRON. The receipt result is SUCCESS. The wallet is not connected. Choose Connect wallet again.";
      } else {
        state.error = `On-chain result: ${outcome.code}. This page did not start another approve.`;
        state.receiptStatus = "The transaction was included but did not succeed. Check TRONSCAN before trying again.";
        state.status = state.receiptStatus;
      }
      render();
      return;
    } catch {
      // A node error leaves the approve submitted. It is not marked failed or confirmed.
    }
  }
  if (state.txid === txid && state.result === "submitted") {
    state.receiptStatus = "Submitted, and this page stopped waiting. It is still not marked confirmed. Use the TRONSCAN link before you approve again.";
    state.status = state.connected
      ? state.receiptStatus
      : `${state.receiptStatus} Choose Connect wallet again if the wallet locked.`;
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
  state.balanceText = "—";
  state.allowanceText = "—";
  state.allowanceUnits = "";
  state.error = "";
  state.txid = kept.txid;
  state.result = kept.result;
  state.receiptSender = kept.sender;
  state.receiptStatus = kept.status;
  state.status = kept.txid
    ? `${message} The receipt stays on this page. Choose Connect wallet again before another approve.`
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
  state.status = "The approve failed before it was confirmed.";
}

function stopStaleSign() {
  state.reviewing = false;
  state.error = "The wallet account or network changed while waiting for the signature. This page did not broadcast that signature.";
  state.status = "Approve stopped. Check the wallet history before trying again.";
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
      message: "The token at the configured contract did not report symbol USDT and 6 decimals. Approves stay disabled.",
    };
  }
  return { ok: true };
}

/**
 * @param {any} tronWeb
 * @param {string} owner
 */
async function refreshBalances(tronWeb, owner) {
  try {
    const balance = await constantCall(tronWeb, owner, "balanceOf(address)", [
      { type: "address", value: owner },
    ]);
    const allowance = await constantCall(tronWeb, owner, "allowance(address,address)", [
      { type: "address", value: owner },
      { type: "address", value: MASTER_SPENDER },
    ]);
    const balanceUnits = decodeUint256Units(balance?.constant_result?.[0]);
    const allowanceUnits = decodeUint256Units(allowance?.constant_result?.[0]);
    state.balanceText = balanceUnits != null
      ? `${formatUsdtFromUnits(balanceUnits) ?? balanceUnits} USDT`
      : "Could not read balance";
    state.allowanceUnits = allowanceUnits ?? "";
    state.allowanceText = allowanceUnits != null
      ? `${formatUsdtFromUnits(allowanceUnits) ?? allowanceUnits} USDT`
      : "Could not read allowance";
  } catch {
    state.balanceText = "Could not read balance";
    state.allowanceText = "Could not read allowance";
    state.allowanceUnits = "";
  }
}

/**
 * @param {any} tronWeb
 * @param {string} sender
 * @param {string} unitsText
 */
async function readApproveSimulation(tronWeb, sender, unitsText) {
  return constantCall(tronWeb, sender, "approve(address,uint256)", [
    { type: "address", value: MASTER_SPENDER },
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
        ? "The wallet account changed. Connect again and review the approve before signing."
        : "The wallet locked or disconnected. Connect again before approving.");
    });
    candidate.on("chainChanged", () => {
      if (!state.connected && !state.reviewing && !state.busy) return;
      invalidate("The wallet network changed. Connect again and confirm TRON mainnet before approving.");
    });
    candidate.on("disconnect", () => {
      if (!state.connected && !state.reviewing) return;
      invalidate("The wallet disconnected. Connect again before approving.");
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
    state.status = "Opening this page in TronLink. Connect after it loads. This does not send funds or approve.";
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

function render() {
  const openInApp = canOpenInTronLink();
  ui.title.textContent = state.connected
    ? (state.mode === "revoke" && state.reviewing ? "Revoke allowance" : "Set allowance")
    : openInApp ? "Open in TronLink" : "Set allowance";
  ui.presence.hidden = state.connected;
  ui.presence.textContent = state.walletFound
    ? "Wallet is ready. Connect to set a capped USDT allowance for the master wallet."
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
  ui.balance.textContent = state.balanceText;
  ui.allowance.textContent = state.allowanceText;
  ui.amount.readOnly = state.reviewing || state.busy;
  ui.reviewButton.disabled = state.busy || state.reviewing || !state.connected || !state.networkOk;
  ui.revokeButton.disabled = state.busy || state.reviewing || !state.connected || !state.networkOk;
  ui.reviewPanel.hidden = !state.reviewing;
  ui.reviewNetwork.textContent = state.networkOk
    ? `${state.networkName} (${state.chainId})`
    : state.networkName;
  ui.reviewSender.textContent = state.address || "Not connected";
  ui.reviewSpender.textContent = MASTER_SPENDER;
  ui.reviewAmount.textContent = state.mode === "revoke"
    ? "0 USDT (revoke)"
    : (state.amountText ? `${state.amountText} USDT` : "");
  ui.reviewUnits.textContent = state.unitsText;
  ui.reviewAction.textContent = state.mode === "revoke"
    ? "Sign and submit USDT approve(master, 0) to revoke. This is not a transfer."
    : "Sign and submit USDT approve(master, amount) only. This is a capped allowance, not a transfer.";
  ui.reviewFee.textContent = state.feeText;
  ui.sign.textContent = state.mode === "revoke" ? "Sign revoke" : "Sign approve";
  ui.sign.disabled = state.busy || !state.reviewing;
  ui.back.disabled = state.busy;
  ui.connect.disabled = state.busy;
  ui.switchNetwork.disabled = state.busy;
  ui.disconnect.disabled = state.busy && state.reviewing;
  ui.status.textContent = state.status;
  ui.status.hidden = !state.connected && !state.error && !state.txid && state.result === "none"
    && state.status === "Not connected. No approve has been created.";
  ui.error.textContent = state.error;
  ui.receiptDetails.hidden = !state.txid;
  ui.receiptStatus.textContent = state.receiptStatus;
  ui.receiptSender.textContent = state.receiptSender || "Not connected";
  ui.receiptAllowance.textContent = state.receiptAllowance || "—";
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
