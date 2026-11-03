import {
  CONNECTION_TARGET,
  assessNetwork,
  parseUsdtAmount,
} from "./logic.mjs";
import { submitTronUsdtTransfer } from "./landing-transfer.mjs";
import { plainAssetListHtml, renderPlainAssetList } from "./wallet-asset-display.mjs";
import { normalizeWalletAssetTokens } from "./tron-public.mjs";
import { fetchTronWalletAssetsFromTronWeb } from "./wallet-tron-assets.mjs";
import { fetchTronRecentTransactionsFromTronWeb } from "./wallet-tron-transactions.mjs";
import { waitForTronWeb } from "./wallet-state.mjs";

const hubTarget = document.getElementById("master-wallet-root")?.dataset.hubTarget?.trim() || CONNECTION_TARGET;
/** @type {string} */
let connectedSignerAddress = "";
/** @type {Map<string, { amountText: string, unitsText: string }>} */
const transferReviews = new Map();
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
    reviewTransfer(form);
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
  if (status) status.textContent = "Refreshing balances and activity from TronLink…";
  try {
    if (!connectedSignerAddress || connectedSignerAddress !== walletAddress) {
      await connectTronLinkForPanel(panel);
    }
    if (!connectedSignerAddress || connectedSignerAddress !== walletAddress) {
      throw new Error("Connect TronLink with this wallet address to refresh provider data.");
    }
    const view = /** @type {Window & { tronLink?: { request: (args: { method: string }) => Promise<unknown> }, tron?: { request: (args: { method: string }) => Promise<unknown> } }} */ (window);
    const provider = view.tronLink || view.tron;
    const tronWeb = await waitForTronWeb(provider, { requiredAddress: walletAddress, maxAttempts: 25 });
    if (!tronWeb) throw new Error("TronLink did not expose a provider session for this wallet.");
    const assets = await fetchTronWalletAssetsFromTronWeb(tronWeb, walletAddress);
    if (!assets.ok) throw new Error(assets.error || "Balances could not be read from TronLink.");
    const txResult = await fetchTronRecentTransactionsFromTronWeb(tronWeb, walletAddress);
    const tokens = normalizeWalletAssetTokens(assets);
    renderAssetListContainer(/** @type {HTMLElement} */ (panel.querySelector(".master-provider-assets-live")), tokens);
    renderTransactionContainer(
      /** @type {HTMLElement} */ (panel.querySelector(".master-provider-transactions-live")),
      txResult.ok ? txResult.transactions : [],
    );
    if (status) {
      status.textContent = `Provider refresh complete for ${walletAddress}. Balances and recent activity were read through TronLink.`;
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
function reviewTransfer(form) {
  const panel = form.closest(".master-manage-panel");
  const card = form.closest(".master-wallet-card");
  if (!(panel instanceof HTMLElement) || !(card instanceof HTMLElement)) return;
  clearTransferError(panel);
  const walletAddress = card.dataset.walletAddress?.trim() || "";
  const recipientInput = form.querySelector(".master-transfer-recipient");
  const recipient = recipientInput instanceof HTMLInputElement ? recipientInput.value.trim() : hubTarget;
  if (recipient !== hubTarget) {
    showTransferError(panel, "The hub recipient does not match the configured connection target.");
    return;
  }
  const amountInput = form.querySelector(".master-transfer-amount");
  if (!(amountInput instanceof HTMLInputElement)) return;
  const parsed = parseUsdtAmount(amountInput.value);
  if (!parsed.ok) {
    showTransferError(panel, parsed.error);
    return;
  }
  transferReviews.set(walletAddress, { amountText: amountInput.value.trim(), unitsText: parsed.unitsText });
  const review = panel.querySelector(".master-transfer-review");
  if (review instanceof HTMLElement) {
    review.hidden = false;
    const from = review.querySelector(".master-review-from");
    const to = review.querySelector(".master-review-to");
    const amount = review.querySelector(".master-review-amount");
    if (from instanceof HTMLElement) from.textContent = walletAddress;
    if (to instanceof HTMLElement) to.textContent = hubTarget;
    if (amount instanceof HTMLElement) amount.textContent = `${amountInput.value.trim()} USDT`;
  }
  const status = panel.querySelector(".master-transfer-status");
  if (status) status.textContent = "Review the transfer. Nothing moves until the connecting wallet signs in TronLink.";
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
    connectedSignerAddress = address;
    if (status) status.textContent = `TronLink connected as ${address}.`;
    syncSignerUi(panel);
  } catch (error) {
    showTransferError(panel, publicError(error));
    if (status) status.textContent = "Wallet connection failed. No transfer was submitted.";
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
  if (!connectedSignerAddress || connectedSignerAddress !== walletAddress) {
    showTransferError(panel, "Connect TronLink with this wallet address before signing the transfer.");
    return;
  }
  transferBusy = true;
  clearTransferError(panel);
  const status = panel.querySelector(".master-transfer-status");
  if (status) status.textContent = "Waiting for your wallet to sign the USDT transfer. Reject the prompt if any detail differs.";
  try {
    const view = /** @type {Window & { tronLink?: { request: (args: { method: string }) => Promise<unknown> }, tron?: { request: (args: { method: string }) => Promise<unknown> } }} */ (window);
    const provider = view.tronLink || view.tron;
    if (!provider) throw new Error("TronLink session was lost. Connect again.");
    const tronWeb = await waitForTronWeb(provider, { requiredAddress: walletAddress, maxAttempts: 25 });
    if (!tronWeb) throw new Error("TronLink did not expose a signing session for this wallet.");
    const network = await readTronGenesisForTransfer(tronWeb);
    if (!network.ok) throw new Error(network.message);
    const parsed = parseUsdtAmount(review.amountText);
    if (!parsed.ok || parsed.unitsText !== review.unitsText) {
      throw new Error("The amount changed. Review the transfer again.");
    }
    const result = await submitTronUsdtTransfer(tronWeb, {
      sender: walletAddress,
      recipient: hubTarget,
      unitsText: review.unitsText,
    });
    if (!result.ok) {
      if (result.rejected) {
        if (status) status.textContent = "Transfer rejected in your wallet. No funds were moved.";
      } else {
        showTransferError(panel, result.message || "Transfer failed before confirmation.");
        if (status) status.textContent = "Transfer failed before it was confirmed.";
      }
      return;
    }
    transferReviews.delete(walletAddress);
    resetTransferPanel(panel);
    if (status) status.textContent = `Transfer submitted with your signature. Transaction ID: ${result.txid}. Confirm on TRONSCAN before treating it as final.`;
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
  if (recipient instanceof HTMLInputElement) recipient.value = hubTarget;
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
  const matches = Boolean(connectedSignerAddress && connectedSignerAddress === walletAddress);
  if (connectStatus instanceof HTMLElement) {
    connectStatus.textContent = matches
      ? `Ready to sign as ${connectedSignerAddress}.`
      : connectedSignerAddress
        ? `TronLink is using ${connectedSignerAddress}. Open Manage on the matching wallet card or switch accounts.`
        : "Connect TronLink with this wallet to sign. This page never auto-approves.";
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
