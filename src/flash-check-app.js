import {
  OFFICIAL_USDT_CONTRACT,
  OFFICIAL_USDT_DECIMALS,
  classifyCheckInput,
  decodeAbiStringResult,
  decodeAbiUintResult,
  explorerAccountUrl,
  explorerTokenUrl,
  explorerTransactionUrl,
  extractTransactionTransfers,
  normalizeTokenRow,
  parseTronGridTrc20Balances,
  parseTronGridTrc20History,
  summarizeAddressTokens,
  summarizeTransactionCheck,
  // @ts-expect-error Versioned specifier reloads the same module in the browser. The file is ./flash-check.mjs.
} from "./flash-check.mjs?v=1";
import {
  tronAddressToHex,
  // @ts-expect-error Versioned specifier reloads the same module in the browser. The file is ./logic.mjs.
} from "./logic.mjs?v=1";

const TRONGRID = "https://api.trongrid.io";

const state = {
  busy: false,
  status: "Waiting for an address or transaction id.",
  error: "",
  /** @type {null | {
   *   verdict: string,
   *   headline: string,
   *   detail: string,
   *   subject: string,
   *   explorer: string,
   *   genuine: any[],
   *   flash: any[],
   *   other: any[],
   * }} */
  result: null,
};

const ui = {
  form: /** @type {HTMLFormElement} */ (required(document.getElementById("check-form"))),
  input: /** @type {HTMLInputElement} */ (required(document.getElementById("check-input"))),
  button: /** @type {HTMLButtonElement} */ (required(document.getElementById("check-button"))),
  status: text("status"),
  error: text("error"),
  panel: /** @type {HTMLElement} */ (required(document.getElementById("result-panel"))),
  heading: text("result-heading"),
  detail: text("result-detail"),
  subject: text("result-subject"),
  explorer: /** @type {HTMLAnchorElement} */ (required(document.getElementById("explorer-link"))),
  genuineBlock: /** @type {HTMLElement} */ (required(document.getElementById("genuine-block"))),
  flashBlock: /** @type {HTMLElement} */ (required(document.getElementById("flash-block"))),
  otherBlock: /** @type {HTMLElement} */ (required(document.getElementById("other-block"))),
  genuineList: /** @type {HTMLElement} */ (required(document.getElementById("genuine-list"))),
  flashList: /** @type {HTMLElement} */ (required(document.getElementById("flash-list"))),
  otherList: /** @type {HTMLElement} */ (required(document.getElementById("other-list"))),
  official: text("official-contract"),
};

ui.official.textContent = OFFICIAL_USDT_CONTRACT;
ui.form.addEventListener("submit", (event) => {
  event.preventDefault();
  void onCheck();
});
render();

async function onCheck() {
  if (state.busy) return;
  state.busy = true;
  state.error = "";
  state.result = null;
  state.status = "Checking…";
  render();

  try {
    const classified = await classifyCheckInput(ui.input.value);
    if (classified.kind === "invalid") {
      state.error = classified.error;
      state.status = "Check stopped.";
      return;
    }
    if (classified.kind === "address") {
      state.result = await checkAddress(classified.value);
      state.status = "Address check finished.";
      return;
    }
    state.result = await checkTransaction(classified.value);
    state.status = "Transaction check finished.";
  } catch (error) {
    state.error = publicMessage(error);
    state.status = "Check failed.";
    state.result = null;
  } finally {
    state.busy = false;
    render();
    if (state.result) ui.heading.focus();
    else ui.status.focus();
  }
}

/**
 * @param {string} address
 */
async function checkAddress(address) {
  const [accountPayload, historyPayload] = await Promise.all([
    fetchJson(`${TRONGRID}/v1/accounts/${encodeURIComponent(address)}`),
    fetchJson(`${TRONGRID}/v1/accounts/${encodeURIComponent(address)}/transactions/trc20?limit=200&only_confirmed=true`),
  ]);

  const balances = parseTronGridTrc20Balances(accountPayload);
  /** @type {Map<string, string>} */
  const balanceByContract = new Map(
    balances.map((/** @type {{ contract: string, balance: string }} */ item) => [item.contract, item.balance]),
  );
  /** @type {Map<string, { contract: string, symbol: string, name: string, balance: string | null, decimals: number }>} */
  const metaByContract = new Map();

  for (const item of parseTronGridTrc20History(historyPayload)) {
    metaByContract.set(item.contract, {
      ...item,
      balance: balanceByContract.get(item.contract) ?? item.balance,
    });
  }

  if (balanceByContract.has(OFFICIAL_USDT_CONTRACT) && !metaByContract.has(OFFICIAL_USDT_CONTRACT)) {
    metaByContract.set(OFFICIAL_USDT_CONTRACT, {
      contract: OFFICIAL_USDT_CONTRACT,
      symbol: "USDT",
      name: "Tether USD",
      balance: balanceByContract.get(OFFICIAL_USDT_CONTRACT) ?? null,
      decimals: OFFICIAL_USDT_DECIMALS,
    });
  }

  const unknown = [...balanceByContract.keys()].filter((contract) => !metaByContract.has(contract));
  const discover = unknown.slice(0, 24);
  const discovered = await Promise.all(discover.map((contract) => readTokenMeta(contract, address)));
  for (const item of discovered) {
    if (!item) continue;
    metaByContract.set(item.contract, {
      ...item,
      balance: balanceByContract.get(item.contract) ?? item.balance,
    });
  }

  for (const [contract, balance] of balanceByContract) {
    const existing = metaByContract.get(contract);
    if (existing) existing.balance = balance;
  }

  const tokens = [...metaByContract.values()];
  const summary = summarizeAddressTokens(tokens);
  return {
    verdict: summary.verdict,
    headline: summary.headline,
    detail: summary.detail,
    subject: address,
    explorer: explorerAccountUrl(address),
    genuine: summary.genuine,
    flash: summary.flash,
    other: summary.other.slice(0, 8),
  };
}

/**
 * @param {string} txid
 */
async function checkTransaction(txid) {
  const eventsPayload = await fetchJson(`${TRONGRID}/v1/transactions/${encodeURIComponent(txid)}/events`);
  let transfers = extractTransactionTransfers(eventsPayload);

  if (transfers.length === 0) {
    const info = await fetchJson(`${TRONGRID}/wallet/gettransactioninfobyid`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ value: txid }),
    });
    const contractHex = typeof info?.contract_address === "string" ? info.contract_address : "";
    if (contractHex) {
      const contract = await contractFromHex(contractHex);
      if (contract) {
        const meta = await readTokenMeta(contract, OFFICIAL_USDT_CONTRACT);
        if (meta) transfers = [meta];
      }
    }
  } else {
    const enriched = [];
    for (const item of transfers) {
      if (item.symbol && item.symbol !== "—") {
        enriched.push(item);
        continue;
      }
      const meta = await readTokenMeta(item.contract, OFFICIAL_USDT_CONTRACT);
      enriched.push(meta ? { ...meta, balance: item.balance } : item);
    }
    transfers = enriched;
  }

  if (transfers.length === 0) {
    throw new Error("No TRC-20 activity was returned for that transaction id.");
  }

  const summary = summarizeTransactionCheck({ transfers });
  return {
    verdict: summary.verdict,
    headline: summary.headline,
    detail: summary.detail,
    subject: txid,
    explorer: explorerTransactionUrl(txid),
    genuine: summary.genuine,
    flash: summary.flash,
    other: summary.other.slice(0, 8),
  };
}

/**
 * @param {string} contract
 * @param {string} owner
 */
async function readTokenMeta(contract, owner) {
  try {
    const [symbolPayload, namePayload, decimalsPayload] = await Promise.all([
      triggerConstant(owner, contract, "symbol()"),
      triggerConstant(owner, contract, "name()"),
      triggerConstant(owner, contract, "decimals()"),
    ]);
    const symbol = decodeAbiStringResult(symbolPayload?.constant_result) || "—";
    const name = decodeAbiStringResult(namePayload?.constant_result) || "—";
    const decimals = decodeAbiUintResult(decimalsPayload?.constant_result) ?? OFFICIAL_USDT_DECIMALS;
    return normalizeTokenRow({
      contract_address: contract,
      symbol,
      name,
      balance: null,
      decimals,
    });
  } catch {
    return null;
  }
}

/**
 * @param {string} owner
 * @param {string} contract
 * @param {string} selector
 */
async function triggerConstant(owner, contract, selector) {
  return fetchJson(`${TRONGRID}/wallet/triggerconstantcontract`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      owner_address: owner,
      contract_address: contract,
      function_selector: selector,
      parameter: "",
      visible: true,
    }),
  });
}

/**
 * @param {string} hex
 */
async function contractFromHex(hex) {
  const cleaned = hex.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$|^41[0-9a-f]{40}$/.test(cleaned)) return null;
  const withVersion = cleaned.length === 40 ? `41${cleaned}` : cleaned;
  // Convert via known official USDT hex path: reuse address encoder by synthesizing base58 through a probe account.
  // Prefer matching against official contract hex first.
  const officialHex = await tronAddressToHex(OFFICIAL_USDT_CONTRACT);
  if (officialHex && officialHex === withVersion) return OFFICIAL_USDT_CONTRACT;
  const encoded = await base58CheckFromHex(withVersion);
  return encoded;
}

/**
 * @param {string} payloadHex
 */
async function base58CheckFromHex(payloadHex) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = new Uint8Array(payloadHex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(payloadHex.slice(i * 2, i * 2 + 2), 16);
  }
  const hash1 = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash2 = new Uint8Array(await crypto.subtle.digest("SHA-256", hash1));
  const full = new Uint8Array(bytes.length + 4);
  full.set(bytes, 0);
  full.set(hash2.subarray(0, 4), bytes.length);
  const digits = [0];
  for (const byte of full) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let zeros = 0;
  for (const byte of full) {
    if (byte !== 0) break;
    zeros += 1;
  }
  return `${"1".repeat(zeros)}${digits.reverse().map((digit) => alphabet[digit]).join("")}`;
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Public TRON data request failed (${response.status}). Try again in a moment.`);
  }
  return response.json();
}

/**
 * @param {unknown} error
 */
function publicMessage(error) {
  if (error && typeof error === "object" && typeof /** @type {{ message?: unknown }} */ (error).message === "string") {
    const message = /** @type {{ message: string }} */ (error).message.trim();
    if (message && message.length <= 180) return message;
  }
  return "The check could not be completed. Nothing was changed on chain.";
}

function render() {
  ui.button.disabled = state.busy;
  ui.input.disabled = state.busy;
  ui.status.textContent = state.status;
  ui.error.textContent = state.error;

  if (!state.result) {
    ui.panel.hidden = true;
    return;
  }

  ui.panel.hidden = false;
  ui.heading.textContent = state.result.headline;
  ui.heading.className = `verdict verdict-${state.result.verdict}`;
  ui.detail.textContent = state.result.detail;
  ui.subject.textContent = state.result.subject;
  ui.explorer.href = state.result.explorer;
  ui.explorer.textContent = "Open on TRONSCAN";

  fillTokenList(ui.genuineBlock, ui.genuineList, state.result.genuine);
  fillTokenList(ui.flashBlock, ui.flashList, state.result.flash);
  fillTokenList(ui.otherBlock, ui.otherList, state.result.other);
}

/**
 * @param {HTMLElement} block
 * @param {HTMLElement} list
 * @param {any[]} items
 */
function fillTokenList(block, list, items) {
  list.replaceChildren();
  if (!items.length) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  for (const item of items) {
    const li = document.createElement("li");
    const title = document.createElement("p");
    title.className = "token-title";
    title.textContent = `${item.symbol} · ${item.balanceText}`;
    const name = document.createElement("p");
    name.className = "hint";
    name.textContent = item.name;
    const contract = document.createElement("p");
    contract.className = "address";
    contract.textContent = item.contract;
    const reason = document.createElement("p");
    reason.className = "hint";
    reason.textContent = item.reason;
    const link = document.createElement("a");
    link.href = explorerTokenUrl(item.contract);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Token on TRONSCAN";
    li.append(title, name, contract, reason, link);
    list.append(li);
  }
}

/**
 * @param {string} id
 */
function text(id) {
  return /** @type {HTMLElement} */ (required(document.getElementById(id)));
}

/**
 * @template T
 * @param {T | null} value
 * @returns {T}
 */
function required(value) {
  if (value == null) throw new Error("Missing page element.");
  return value;
}
