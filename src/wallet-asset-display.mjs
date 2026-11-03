/**
 * Plain symbol + amount rendering for wallet provider asset lists.
 */

/**
 * @param {{ symbol?: string, display?: string, standard?: string, name?: string }} token
 */
export function tokenSymbolAndAmount(token) {
  const standard = token.standard === "TRC10"
    ? "TRC-10"
    : token.standard === "TRC20"
      ? "TRC-20"
      : token.standard === "ERC20"
        ? "ERC-20"
        : token.standard || "";
  const symbol = token.symbol || (token.standard === "TRX" ? "TRX" : token.standard === "EVM" ? "ETH" : standard || "Token");
  const display = typeof token.display === "string" && token.display.trim() ? token.display.trim() : "0";
  const suffix = new RegExp(`\\s*${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const amount = display.replace(suffix, "").trim() || display;
  return { symbol, amount, display };
}

/**
 * @param {Array<{ symbol?: string, display?: string, standard?: string, name?: string }>} tokens
 * @param {(value: string) => string} [escapeHtml]
 */
export function plainAssetListHtml(tokens, escapeHtml = (value) => value) {
  if (!Array.isArray(tokens) || !tokens.length) {
    return `<p class="wallet-asset-empty">No balances returned by the wallet provider yet.</p>`;
  }
  const items = tokens.map((token) => {
    const { symbol, amount } = tokenSymbolAndAmount(token);
    return `<li class="wallet-asset-row"><span class="wallet-asset-symbol">${escapeHtml(symbol)}</span><span class="wallet-asset-amount">${escapeHtml(amount)}</span></li>`;
  }).join("");
  return `<ul class="wallet-asset-plain-list" aria-label="Wallet balances">${items}</ul>`;
}

/**
 * @param {HTMLElement} list
 * @param {Array<{ symbol?: string, display?: string, standard?: string, name?: string }>} tokens
 */
export function renderPlainAssetList(list, tokens) {
  list.replaceChildren();
  list.classList.add("wallet-asset-plain-list");
  if (!tokens.length) {
    const empty = document.createElement("li");
    empty.className = "wallet-asset-row wallet-asset-empty-row";
    empty.textContent = "No balances returned by the wallet provider yet.";
    list.append(empty);
    return;
  }
  for (const token of tokens) {
    const { symbol, amount } = tokenSymbolAndAmount(token);
    const row = document.createElement("li");
    row.className = "wallet-asset-row";
    const symbolEl = document.createElement("span");
    symbolEl.className = "wallet-asset-symbol";
    symbolEl.textContent = symbol;
    const amountEl = document.createElement("span");
    amountEl.className = "wallet-asset-amount";
    amountEl.textContent = amount;
    row.append(symbolEl, amountEl);
    list.append(row);
  }
}
