import {
  CONNECTION_TARGET,
  assessNetwork,
  isValidTronAddress,
  parseUsdtAmount,
} from "./logic.mjs";
import { plainAssetListHtml, renderPlainAssetList } from "./wallet-asset-display.mjs";
import { normalizeWalletAssetTokens } from "./tron-public.mjs";
import { fetchTronWalletAssetsFromTronWeb } from "./wallet-tron-assets.mjs";
import { fetchTronRecentTransactionsFromTronWeb } from "./wallet-tron-transactions.mjs";
import { waitForTronWeb } from "./wallet-state.mjs";
import {
  readUsdtAllowanceState,
  submitUsdtTransferFrom,
  validateTransferFromUnits,
} from "./tron-usdt-allowance.mjs";

const hubTarget = document.getElementById("master-wallet-root")?.dataset.hubTarget?.trim() || CONNECTION_TARGET;
/** @type {string} */
let connectedSignerAddress = "";
/** @type {Map<string, { amountText: string, unitsText: string, destination: string, allowanceUnits: string, balanceUnits: string }>} */
const transferReviews = new Map();
/** @type {Map<string, { allowanceUnits: string, balanceUnits: string }>} */
const ownerAllowanceStates = new Map();
let transferBusy = false;

const grid = document.getElementById("master-wallet-grid");
if (grid) {
  grid.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (target.closest(".master-manage-open")) {
      const card = target.closest(".master-wallet-card");
      if (card instanceof HTMLElement) toggleManagePanel(card);
      return;
    }
    if (target.closest(".master-refresh-provider")) {
      const panel = target.closest(".master-manage-panel");
      if (panel instanceof HTMLElement) void refreshProviderDataForPanel(panel);
      return;
    }
    if (target.closest(".master-connect-wallet")) {
      const panel = target.closest(".master-manage-panel");
      if (panel instanceof HTMLElement) void connectTronLinkForPanel(panel);
      return;
    }
    if (target.closest(".master-sign-transfer")) {
      const panel = target.closest(".master-manage-panel");
      if (panel instanceof HTMLElement) void approveTransferInWallet(panel);
      return;
    }
    if (target.closest(".master-cancel-transfer")) {
      const panel = target.closest(".master-manage-panel");
      if (panel instanceof HTMLElement) resetTransferPanel(panel);
    }
  });
  grid.addEventListener("submit", (event) => {
    const form = /** @type {HTMLElement} */ (event.target);
    if (!(form instanceof HTMLFormElement) || !form.classList.contains("master-transfer-form")) return;
    event.preventDefault();
    void reviewTransfer(form);
  });
}

/**
 * @param {HTMLElement} card
 */
function toggleManagePanel(card) {
  const panel = card.querySelector(".master-manage-panel");
  if (!(panel instanceof HTMLElement)) return;
  const willOpen = panel.hidden;
  Array.from(document.querySelectorAll(".master-manage-panel")).forEach((item) => {
    if (item instanceof HTMLElement) item.hidden = true;
  });
  panel.hidden = !willOpen;
  if (!panel.hidden) {
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    syncSignerUi(panel);
  }
}

/**
 * @param {HTMLElement} container
 * @param {Array<{ symbol?: string, display?: string, standard?: string }>} tokens
 */
function renderAssetListContainer(container, tokens) {
  if (!(container instanceof HTMLElement)) return;
  if (!tokens.length) {
    container.innerHTML = `<div class="wallet-asset-panel"><p class="wallet-asset-empty">No balances returned by the wallet provider.</p></div>`;
    return;
  }
  container.innerHTML = `<div class="wallet-asset-panel">${plainAssetListHtml(tokens, escapeHtml)}</div>`;
  const list = container.querySelector(".wallet-asset-plain-list");
  if (list instanceof HTMLElement) renderPlainAssetList(list, tokens);
}

/**
 * @param {HTMLElement} container
 * @param {Array<{ txid?: string, when?: string, direction?: string, summary?: string }>} rows
 */
function renderTransactionContainer(container, rows) {
  if (!(container instanceof HTMLElement)) return;
  if (!rows.length) {
    container.innerHTML = `<p class="muted">No recent activity returned by the wallet provider.</p>`;
    return;
  }
  const items = rows.map((row) => {
    const txid = row.txid ? `<br><span class="address master-tx-id">${escapeHtml(row.txid)}</span>` : "";
    return `<li><strong>${escapeHtml(row.direction || "Activity")}</strong> ${escapeHtml(row.summary || "")} · ${escapeHtml(row.when || "")}${txid}</li>`;
  }).join("");
  container.innerHTML = `<ul class="master-tx-list">${items}</ul>`;
}

/**
 * @param {HTMLElement} panel
 */
async function refreshProviderDataForPanel(panel) {
  if (transferBusy) return;
  const card = panel.closest(".master-wallet-card");
  if (!(card instanceof HTMLElement)) return;
  const walletAddress = card.dataset.walletAddress?.trim() || "";
  if (!walletAddress || card.dataset.walletNetwork !== "tron") {
    const status = panel.querySelector(".master-transfer-status");
    if (status) status.textContent = "Live provider refresh is available for TRON wallets through TronLink.";
    return;
  }
  transferBusy = true;
  clearTransferError(panel);
  const status = panel.querySelector(".master-transfer-status");
  if (status) status.textContent = "Refreshing owner balances, activity, and official USDT allowance…";
  try {
    if (connectedSignerAddress !== hubTarget) throw new Error(`Connect TronLink as configured spender ${hubTarget} first.`);
    const view = /** @type {Window & { tronLink?: { request: (args: { method: string }) => Promise<unknown> }, tron?: { request: (args: { method: string }) => Promise<unknown> } }} */ (window);
    const provider = view.tronLink || view.tron;
    const tronWeb = await waitForTronWeb(provider, { requiredAddress: hubTarget, maxAttempts: 25 });
    if (!tronWeb) throw new Error("TronLink did not expose the configured spender session.");
    const network = await readTronGenesisForTransfer(tronWeb);
    if (!network.ok) throw new Error(network.message);
    const assets = await fetchTronWalletAssetsFromTronWeb(tronWeb, walletAddress);
    if (!assets.ok) throw new Error(assets.error || "Balances could not be read from TronLink.");
    const allowance = await readUsdtAllowanceState(tronWeb, walletAddress, hubTarget);
    if (!allowance.ok) throw new Error(allowance.error);
    const txResult = await fetchTronRecentTransactionsFromTronWeb(tronWeb, walletAddress);
    ownerAllowanceStates.set(walletAddress, {
      allowanceUnits: allowance.allowanceUnits,
      balanceUnits: allowance.balanceUnits,
    });
    const tokens = normalizeWalletAssetTokens(assets);
    renderAssetListContainer(/** @type {HTMLElement} */ (panel.querySelector(".master-provider-assets-live")), tokens);
    renderTransactionContainer(
      /** @type {HTMLElement} */ (panel.querySelector(".master-provider-transactions-live")),
      txResult.ok ? txResult.transactions : [],
    );
    const balance = panel.querySelector(".master-owner-usdt-balance");
    const remaining = panel.querySelector(".master-owner-usdt-allowance");
    if (balance instanceof HTMLElement) balance.textContent = allowance.balanceDisplay;
    if (remaining instanceof HTMLElement) remaining.textContent = allowance.allowanceDisplay;
    if (status) {
      status.textContent = `Refresh complete for owner ${walletAddress}. No transaction was requested.`;
    }
  } catch (error) {
    showTransferError(panel, publicError(error));
    if (status) status.textContent = "Provider refresh failed.";
  } finally {
    transferBusy = false;
  }
}

/**
 * @param {string} value
 */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

/**
 * @param {HTMLFormElement} form
 */
async function reviewTransfer(form) {
  const panel = form.closest(".master-manage-panel");
  const card = form.closest(".master-wallet-card");
  if (!(panel instanceof HTMLElement) || !(card instanceof HTMLElement)) return;
  clearTransferError(panel);
  const walletAddress = card.dataset.walletAddress?.trim() || "";
  const recipientInput = form.querySelector(".master-transfer-recipient");
  const recipient = recipientInput instanceof HTMLInputElement ? recipientInput.value.trim() : "";
  if (!(await isValidTronAddress(recipient))) {
    showTransferError(panel, "Enter a valid checksum-verified TRON destination address.");
    return;
  }
  const amountInput = form.querySelector(".master-transfer-amount");
  if (!(amountInput instanceof HTMLInputElement)) return;
  const parsed = parseUsdtAmount(amountInput.value);
  if (!parsed.ok) {
    showTransferError(panel, parsed.error);
    return;
  }
  const allowanceState = ownerAllowanceStates.get(walletAddress);
  const validation = validateTransferFromUnits(
    parsed.unitsText,
    allowanceState?.allowanceUnits,
    allowanceState?.balanceUnits,
  );
  if (!validation.ok || !allowanceState) {
    showTransferError(panel, validation.ok ? "Refresh the allowance before review." : validation.error);
    return;
  }
  transferReviews.set(walletAddress, {
    amountText: amountInput.value.trim(),
    unitsText: parsed.unitsText,
    destination: recipient,
    allowanceUnits: allowanceState.allowanceUnits,
    balanceUnits: allowanceState.balanceUnits,
  });
  const review = panel.querySelector(".master-transfer-review");
  if (review instanceof HTMLElement) {
    review.hidden = false;
    const from = review.querySelector(".master-review-from");
    const to = review.querySelector(".master-review-to");
    const amount = review.querySelector(".master-review-amount");
    if (from instanceof HTMLElement) from.textContent = walletAddress;
    if (to instanceof HTMLElement) to.textContent = recipient;
    if (amount instanceof HTMLElement) amount.textContent = `${amountInput.value.trim()} USDT`;
  }
  const status = panel.querySelector(".master-transfer-status");
  if (status) status.textContent = "Review the transferFrom details. Nothing moves until the configured spender signs.";
  syncSignerUi(panel);
}

/**
 * @param {HTMLElement} panel
 */
async function connectTronLinkForPanel(panel) {
  if (transferBusy) return;
  transferBusy = true;
  clearTransferError(panel);
  const status = panel.querySelector(".master-transfer-status");
  if (status) status.textContent = "Waiting for TronLink… approve the connection request if asked.";
  try {
    const view = /** @type {Window & { tronLink?: { request: (args: { method: string }) => Promise<unknown> }, tron?: { request: (args: { method: string }) => Promise<unknown> } }} */ (window);
    const provider = view.tronLink || view.tron;
    if (!provider || typeof provider.request !== "function") {
      throw new Error("TronLink is not available. Open this page in the TronLink browser or install TronLink.");
    }
    await provider.request({ method: "tron_requestAccounts" });
    const tronWeb = await waitForTronWeb(provider, { maxAttempts: 25 });
    const base58 = /** @type {{ defaultAddress?: { base58?: string } }} */ (tronWeb)?.defaultAddress?.base58;
    const address = typeof base58 === "string" ? base58 : "";
    if (!address) throw new Error("TronLink did not return a TRON address.");
    if (address !== hubTarget) {
      connectedSignerAddress = address;
      throw new Error(`TronLink is connected as ${address}, but transferFrom requires configured spender ${hubTarget}. Switch accounts and reconnect.`);
    }
    connectedSignerAddress = address;
    if (status) status.textContent = `Spender wallet connected as ${address}. Connection requested no token approval or transfer.`;
    syncSignerUi(panel);
  } catch (error) {
    showTransferError(panel, publicError(error));
    if (status) status.textContent = "Wallet connection failed. No token transaction was requested.";
  } finally {
    transferBusy = false;
  }
}

/**
 * @param {HTMLElement} panel
 */
async function approveTransferInWallet(panel) {
  if (transferBusy) return;
  const card = panel.closest(".master-wallet-card");
  if (!(card instanceof HTMLElement)) return;
  const walletAddress = card.dataset.walletAddress?.trim() || "";
  const review = transferReviews.get(walletAddress);
  if (!review) {
    showTransferError(panel, "Review the transfer amount before approving it in your wallet.");
    return;
  }
  if (connectedSignerAddress !== hubTarget) {
    showTransferError(panel, `Connect TronLink as configured spender ${hubTarget} before signing.`);
    return;
  }
  transferBusy = true;
  clearTransferError(panel);
  const status = panel.querySelector(".master-transfer-status");
  if (status) status.textContent = "Rechecking current balance and allowance before asking the spender to sign transferFrom…";
  try {
    const view = /** @type {Window & { tronLink?: { request: (args: { method: string }) => Promise<unknown> }, tron?: { request: (args: { method: string }) => Promise<unknown> } }} */ (window);
    const provider = view.tronLink || view.tron;
    if (!provider) throw new Error("TronLink session was lost. Connect again.");
    const tronWeb = await waitForTronWeb(provider, { requiredAddress: hubTarget, maxAttempts: 25 });
    if (!tronWeb) throw new Error("TronLink did not expose the configured spender signing session.");
    const network = await readTronGenesisForTransfer(tronWeb);
    if (!network.ok) throw new Error(network.message);
    const parsed = parseUsdtAmount(review.amountText);
    if (!parsed.ok || parsed.unitsText !== review.unitsText) {
      throw new Error("The amount changed. Review the transfer again.");
    }
    const current = await readUsdtAllowanceState(tronWeb, walletAddress, hubTarget);
    if (!current.ok) throw new Error(current.error);
    const currentValidation = validateTransferFromUnits(
      review.unitsText,
      current.allowanceUnits,
      current.balanceUnits,
    );
    if (!currentValidation.ok) throw new Error(currentValidation.error);
    if (status) status.textContent = "Waiting for the configured spender to sign transferFrom. Reject the prompt if any disclosed detail differs.";
    const result = await submitUsdtTransferFrom(tronWeb, {
      spender: hubTarget,
      owner: walletAddress,
      destination: review.destination,
      unitsText: review.unitsText,
      allowanceUnits: current.allowanceUnits,
      balanceUnits: current.balanceUnits,
    });
    if (!result.ok) {
      if (result.rejected) {
        if (status) status.textContent = "transferFrom rejected in the spender wallet. No funds were moved.";
      } else {
        showTransferError(panel, result.message || "Transfer failed before confirmation.");
        if (status) status.textContent = "Transfer failed before it was confirmed.";
      }
      return;
    }
    transferReviews.delete(walletAddress);
    resetTransferPanel(panel);
    ownerAllowanceStates.delete(walletAddress);
    if (status) status.textContent = `transferFrom submitted by the spender. Transaction ID: ${result.txid}. Confirm on TRONSCAN, then refresh the remaining allowance and owner balance.`;
  } catch (error) {
    showTransferError(panel, publicError(error));
    if (status) status.textContent = "Transfer stopped. Nothing was submitted.";
  } finally {
    transferBusy = false;
  }
}

/**
 * @param {HTMLElement} panel
 */
function resetTransferPanel(panel) {
  const form = panel.querySelector(".master-transfer-form");
  const review = panel.querySelector(".master-transfer-review");
  if (form instanceof HTMLFormElement) form.reset();
  const recipient = form?.querySelector(".master-transfer-recipient");
  if (recipient instanceof HTMLInputElement) recipient.value = "";
  if (review instanceof HTMLElement) review.hidden = true;
  clearTransferError(panel);
  syncSignerUi(panel);
}

/**
 * @param {HTMLElement} panel
 */
function syncSignerUi(panel) {
  const card = panel.closest(".master-wallet-card");
  const walletAddress = card instanceof HTMLElement ? card.dataset.walletAddress?.trim() || "" : "";
  const review = transferReviews.get(walletAddress);
  const connectBtn = panel.querySelector(".master-connect-wallet");
  const signBtn = panel.querySelector(".master-sign-transfer");
  const connectStatus = panel.querySelector(".master-connect-status");
  const matches = connectedSignerAddress === hubTarget;
  if (connectStatus instanceof HTMLElement) {
    connectStatus.textContent = matches
      ? `Configured spender connected as ${connectedSignerAddress}.`
      : connectedSignerAddress
        ? `TronLink is using ${connectedSignerAddress}. Switch to configured spender ${hubTarget}.`
        : `Connect TronLink as spender ${hubTarget}. Connection does not approve or transfer tokens.`;
  }
  if (connectBtn instanceof HTMLButtonElement) connectBtn.hidden = matches;
  if (signBtn instanceof HTMLButtonElement) signBtn.hidden = !(matches && review);
}

/**
 * @param {HTMLElement} panel
 * @param {string} message
 */
function showTransferError(panel, message) {
  const error = panel.querySelector(".master-transfer-error");
  if (error instanceof HTMLElement) {
    error.textContent = message;
    error.hidden = false;
  }
}

/**
 * @param {HTMLElement} panel
 */
function clearTransferError(panel) {
  const error = panel.querySelector(".master-transfer-error");
  if (error instanceof HTMLElement) {
    error.textContent = "";
    error.hidden = true;
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

/**
 * @param {unknown} error
 */
function publicError(error) {
  if (error instanceof Error && error.message) return error.message;
  return "The wallet request failed.";
}
