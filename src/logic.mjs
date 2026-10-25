/**
 * Pure checks for the TRON USDT payment page.
 * This module never talks to a wallet and never builds a secret.
 */

export const RECIPIENT = "TG94XL9N1uVHPM4U4zcpYGc6w1i7nUBuiq";
export const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export const MAINNET_CHAIN_ID = "0x2b6653dc";
export const USDT_DECIMALS = 6;
export const FEE_LIMIT_SUN = 100_000_000;
export const TRANSFER_SELECTOR = "a9059cbb";

/** Documented TronLink chain ids. Hex bytes are compared in lowercase. */
export const KNOWN_CHAIN_IDS = Object.freeze({
  "0x2b6653dc": "TRON mainnet",
  "0x94a9059e": "Shasta testnet",
  "0xcd8690dc": "Nile testnet",
});

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SCALE = 10n ** BigInt(USDT_DECIMALS);

/**
 * @param {string} address
 * @returns {Promise<boolean>}
 */
export async function isValidTronAddress(address) {
  if (typeof address !== "string" || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
    return false;
  }
  const decoded = decodeBase58(address);
  if (!decoded || decoded.length !== 25 || decoded[0] !== 0x41) return false;
  const payload = decoded.subarray(0, 21);
  const checksum = decoded.subarray(21);
  const hash = (await sha256(await sha256(payload))).subarray(0, 4);
  for (let i = 0; i < 4; i += 1) {
    if (hash[i] !== checksum[i]) return false;
  }
  return true;
}

/**
 * 21-byte TRON address hex (version byte 41 + 20 bytes), lowercase, no 0x prefix.
 * Returns null instead of a rewritten address when validation fails.
 * @param {string} address
 * @returns {Promise<string | null>}
 */
export async function tronAddressToHex(address) {
  if (!(await isValidTronAddress(address))) return null;
  const decoded = decodeBase58(address);
  if (!decoded) return null;
  return bytesToHex(decoded.subarray(0, 21));
}

/**
 * The account TronLink approved, as a base58 address.
 * eth_requestAccounts may return base58 or 20/21-byte hex, and tronWeb.defaultAddress can lag behind.
 * Two different valid accounts are rejected.
 * @param {unknown} requested
 * @param {unknown} walletAddress
 * @returns {Promise<{ ok: true, address: string } | { ok: false, error: "missing" | "mismatch" }>}
 */
export async function selectConnectedAccount(requested, walletAddress) {
  const fromRequest = await canonicalTronAccount(requested);
  const fromWallet = await canonicalTronAccount(walletAddress);
  if (fromRequest && fromWallet && fromRequest !== fromWallet) return { ok: false, error: "mismatch" };
  const address = fromRequest || fromWallet;
  if (!address) return { ok: false, error: "missing" };
  return { ok: true, address };
}

/**
 * First checksum-valid TRON account in the list.
 * The caller puts the signing account ahead of the request payload.
 * @param {readonly unknown[]} values
 * @returns {Promise<{ ok: true, address: string } | { ok: false, error: "missing" }>}
 */
export async function preferConnectedAccount(values) {
  for (const value of values) {
    const address = await canonicalTronAccount(value);
    if (address) return { ok: true, address };
  }
  return { ok: false, error: "missing" };
}

/**
 * @param {unknown} value
 * @returns {Promise<string | null>}
 */
async function canonicalTronAccount(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (await isValidTronAddress(trimmed)) return trimmed;
  const embedded = trimmed.match(/T[1-9A-HJ-NP-Za-km-z]{33}/);
  if (embedded && await isValidTronAddress(embedded[0])) return embedded[0];
  const payload = tronHexPayload(trimmed);
  if (!payload) return null;
  const encoded = await base58FromTronHex(payload);
  return (await isValidTronAddress(encoded)) ? encoded : null;
}

/**
 * @param {string} value
 * @returns {string | null}
 */
function tronHexPayload(value) {
  let hex = value.toLowerCase();
  if (hex.startsWith("0x")) hex = hex.slice(2);
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) return null;
  if (hex.length === 40) hex = `41${hex}`;
  if (hex.length !== 42 || !hex.startsWith("41")) return null;
  return hex;
}

/**
 * @param {string} payloadHex 21-byte hex beginning with 41
 * @returns {Promise<string>}
 */
async function base58FromTronHex(payloadHex) {
  const payload = hexToBytes(payloadHex);
  const checksum = (await sha256(await sha256(payload))).subarray(0, 4);
  const full = new Uint8Array(25);
  full.set(payload, 0);
  full.set(checksum, 21);
  return encodeBase58(full);
}

/**
 * @param {unknown} text
 * @returns {{ ok: true, unitsText: string } | { ok: false, error: string }}
 */
export function parseUsdtAmount(text) {
  if (typeof text !== "string") {
    return { ok: false, error: "Enter the USDT amount as digits." };
  }
  if (text.length === 0) {
    return { ok: false, error: "Enter a USDT amount." };
  }
  if (text !== text.trim() || /\s/.test(text)) {
    return { ok: false, error: "Remove spaces from the amount." };
  }
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(text)) {
    return {
      ok: false,
      error: "Enter a positive USDT amount with at most 6 decimal places and at most 12 digits before the decimal point.",
    };
  }
  const [whole, fraction = ""] = text.split(".");
  const units = BigInt(whole) * SCALE + BigInt((fraction + "000000").slice(0, 6));
  if (units <= 0n) {
    return { ok: false, error: "Enter an amount greater than 0." };
  }
  return { ok: true, unitsText: units.toString() };
}

/**
 * @param {unknown} chainId
 * @returns {string | null}
 */
export function normalizeChainId(chainId) {
  if (typeof chainId !== "string") return null;
  const match = /^0x([0-9a-fA-F]{8})$/.exec(chainId);
  if (!match) return null;
  return `0x${match[1].toLowerCase()}`;
}

/**
 * Chain id is the last 4 bytes of the genesis block id.
 * @param {unknown} blockId
 * @returns {string | null}
 */
export function chainIdFromGenesisBlockId(blockId) {
  if (typeof blockId !== "string") return null;
  const hex = blockId.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  return `0x${hex.slice(-8)}`;
}

/**
 * Fail closed unless the genesis block proves TRON mainnet.
 * A reported chain id is accepted only when it matches that block.
 * @param {{ chainId?: unknown, genesisBlockId?: unknown }} input
 */
export function assessNetwork(input) {
  const genesisChainId = chainIdFromGenesisBlockId(input?.genesisBlockId);
  const reported = normalizeChainId(input?.chainId);
  if (!genesisChainId) {
    return {
      ok: false,
      chainId: null,
      networkName: "Unknown network",
      message: "The wallet did not provide a genesis block this page could verify. Transfers stay disabled.",
    };
  }
  if (reported && reported !== genesisChainId) {
    return {
      ok: false,
      chainId: null,
      networkName: "Unverified network",
      message: "The wallet chain id does not match the node genesis block. Transfers stay disabled.",
    };
  }
  const names = /** @type {Readonly<Record<string, string>>} */ (KNOWN_CHAIN_IDS);
  const networkName = names[genesisChainId] || "Unrecognized TRON network";
  if (genesisChainId !== MAINNET_CHAIN_ID) {
    return {
      ok: false,
      chainId: genesisChainId,
      networkName,
      message: `This wallet is on ${networkName}, not TRON mainnet. Mainnet transfers stay disabled.`,
    };
  }
  return {
    ok: true,
    chainId: genesisChainId,
    networkName,
    message: "TRON mainnet verified from the genesis block (chain id 0x2b6653dc).",
  };
}

/**
 * @param {unknown} symbolValue
 * @param {unknown} decimalsValue
 */
export function usdtMetadataOk(symbolValue, decimalsValue) {
  return readTokenSymbol(symbolValue) === "USDT" && readTokenDecimals(decimalsValue) === USDT_DECIMALS;
}

/**
 * @param {string} recipient
 * @param {string} unitsText
 * @returns {Promise<string | null>}
 */
export async function buildTransferCalldata(recipient, unitsText) {
  if (!/^[0-9]+$/.test(unitsText)) return null;
  const addressWord = await abiAddressWord(recipient);
  const amountWord = uint256Hex(unitsText);
  if (!addressWord || !amountWord) return null;
  return `${TRANSFER_SELECTOR}${addressWord}${amountWord}`;
}

/**
 * Confirm an unsigned or signed transaction is only USDT transfer(recipient, amount).
 * @param {unknown} tx
 * @param {{ sender: string, recipient: string, usdt: string, unitsText: string, feeLimitSun: number }} expected
 */
export async function inspectTransferTransaction(tx, expected) {
  const expectedData = await buildTransferCalldata(expected.recipient, expected.unitsText);
  if (!expectedData) {
    return { ok: false, reason: "The amount or recipient could not be encoded." };
  }
  const contract = triggerContract(tx);
  if (!contract) {
    return { ok: false, reason: "The transaction is not a single contract call." };
  }
  const value = contract.parameter && contract.parameter.value;
  if (!value || typeof value !== "object") {
    return { ok: false, reason: "The transaction is missing contract parameters." };
  }
  if (!(await sameAddress(value.owner_address, expected.sender))) {
    return { ok: false, reason: "The transaction sender does not match the connected wallet." };
  }
  if (!(await sameAddress(value.contract_address, expected.usdt))) {
    return { ok: false, reason: "The transaction contract is not the configured USDT contract." };
  }
  if (!callValueIsZero(value.call_value)) {
    return { ok: false, reason: "The transaction would also send TRX. It was not signed." };
  }
  const raw = rawData(tx);
  if (!feeLimitAllowed(raw?.fee_limit, expected.feeLimitSun)) {
    return { ok: false, reason: "The transaction fee limit is missing or above the 100 TRX cap." };
  }
  if (!dataEquals(value.data, expectedData)) {
    return { ok: false, reason: "The transaction data is not the expected USDT transfer." };
  }
  return { ok: true, reason: "" };
}

/**
 * @param {unknown} before
 * @param {unknown} after
 */
export function signedRawDataUnchanged(before, after) {
  const first = rawDataHex(before);
  const second = rawDataHex(after);
  if (first && second) return first === second;
  const a = triggerContract(before);
  const b = triggerContract(after);
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b) && feeLimitOf(before) === feeLimitOf(after);
}

/**
 * @param {unknown} result
 * @returns {string | null}
 */
export function extractTxId(result) {
  if (typeof result === "string" && /^[0-9a-fA-F]{64}$/.test(result)) return result.toLowerCase();
  if (!result || typeof result !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (result);
  const candidate = record.txid ?? record.txID ?? record.txId;
  if (typeof candidate === "string" && /^[0-9a-fA-F]{64}$/.test(candidate)) {
    return candidate.toLowerCase();
  }
  return null;
}

/**
 * @param {unknown} broadcast
 * @returns {{ state: "submitted", txid: string } | { state: "failed", message: string }}
 */
export function interpretBroadcast(broadcast) {
  const txid = broadcast && typeof broadcast === "object"
    ? extractTxId(/** @type {Record<string, unknown>} */ (broadcast).txid ?? broadcast)
    : extractTxId(broadcast);
  const resultFlag = broadcast && typeof broadcast === "object"
    ? /** @type {Record<string, unknown>} */ (broadcast).result
    : undefined;
  if (resultFlag === true && txid) {
    return { state: "submitted", txid };
  }
  if (typeof broadcast === "string" && txid) {
    return { state: "submitted", txid };
  }
  return {
    state: "failed",
    message: "The network did not accept the transaction. Nothing on this page was marked confirmed.",
  };
}

/**
 * A transaction id alone is not confirmation.
 * @param {unknown} info
 * @returns {{ state: "submitted" | "confirmed" | "failed", code: string }}
 */
export function interpretTransactionInfo(info) {
  if (!info || typeof info !== "object" || Object.keys(/** @type {object} */ (info)).length === 0) {
    return { state: "submitted", code: "" };
  }
  const record = /** @type {Record<string, unknown>} */ (info);
  const receipt = record.receipt && typeof record.receipt === "object"
    ? /** @type {Record<string, unknown>} */ (record.receipt)
    : null;
  const result = receipt && typeof receipt.result === "string" ? receipt.result : "";
  const included = record.blockNumber != null && record.blockNumber !== "";
  if (result === "SUCCESS" && included) return { state: "confirmed", code: "SUCCESS" };
  if (!result) return { state: "submitted", code: "" };
  if (result === "SUCCESS") return { state: "submitted", code: "SUCCESS" };
  return { state: "failed", code: result };
}

/**
 * @param {unknown} error
 * @returns {{ state: "rejected" | "failed", message: string }}
 */
export function classifySubmitError(error) {
  const code = error && typeof error === "object" ? /** @type {{ code?: unknown }} */ (error).code : undefined;
  const message = publicErrorMessage(error);
  if (code === 4001 || /user rejected|rejected the request|declined by user|user denied/i.test(message)) {
    return {
      state: "rejected",
      message: "You rejected the request in the wallet. No transaction was submitted.",
    };
  }
  return { state: "failed", message };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
export function publicErrorMessage(error) {
  const code = error && typeof error === "object" ? /** @type {{ code?: unknown }} */ (error).code : undefined;
  if (code === 4001) return "You rejected the request in the wallet. No transaction was submitted.";
  if (code === -32002) return "The wallet is already showing a request. Finish or close that prompt, then try again.";
  if (code === -32000) return "The wallet is locked or temporarily rate-limited the connection. Unlock TronLink, wait a moment, and try again.";
  if (code === 4200) return "This wallet does not support a required method. Use the official TronLink wallet.";
  if (code === 4902) return "TronLink did not accept the network switch.";
  const raw = error && typeof error === "object" && typeof /** @type {{ message?: unknown }} */ (error).message === "string"
    ? /** @type {{ message: string }} */ (error).message
    : "";
  const line = raw.split("\n")[0].trim();
  if (
    !line
    || line.length > 180
    || /private key|seed phrase|mnemonic|secret phrase/i.test(line)
    || /^\s*at\s+/.test(line)
    || line.includes("node_modules")
  ) {
    return "The wallet request failed. This page has not recorded a successful transfer.";
  }
  return line;
}

/**
 * @param {string} txid
 * @returns {string | null}
 */
export function explorerTxUrl(txid) {
  if (typeof txid !== "string" || !/^[0-9a-fA-F]{64}$/.test(txid)) return null;
  return `https://tronscan.org/#/transaction/${txid}`;
}

/**
 * Accept only a real HTTPS URL for the production QR.
 * The returned url is the original string, not a normalized rewrite.
 * @param {unknown} input
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
export function validateProductionQrUrl(input) {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, error: "Provide the deployed HTTPS URL." };
  }
  if (input.length > 2048 || /\s/.test(input) || !input.startsWith("https://")) {
    return { ok: false, error: "The production QR only accepts an https:// URL." };
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, error: "That value is not a valid URL." };
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return { ok: false, error: "Use an https:// URL without a username or password." };
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return { ok: false, error: "Localhost and .local hosts cannot be used for the production QR." };
  }
  if (host.endsWith(".example") || host.endsWith(".invalid") || host.endsWith(".test")) {
    return { ok: false, error: "Placeholder and reserved domains cannot be used for the production QR." };
  }
  if (host === "example.com" || host === "example.org" || host === "example.net" || host === "example") {
    return { ok: false, error: "Replace the example domain with the real deployed host." };
  }
  if (host.includes("placeholder") || host.includes("your-deployed") || host.includes("changeme")) {
    return { ok: false, error: "Replace the placeholder host with the real deployed host." };
  }
  if (isBlockedAddress(host) || host.includes("127.0.0.1") || host.startsWith("127.")) {
    return { ok: false, error: "Loopback, private, and documentation addresses cannot be used for the production QR." };
  }
  if (!host.includes(".")) {
    return { ok: false, error: "Use the full public host name of the deployed site." };
  }
  return { ok: true, url: input };
}

/**
 * @param {string} svg
 * @param {string} url
 */
export function labelQrSvg(svg, url) {
  const match = svg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/);
  if (!match) throw new Error("QR SVG is missing a viewBox.");
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("QR SVG viewBox is invalid.");
  }
  const extra = 16;
  const escaped = escapeXml(url);
  const body = svg.replace(/^[\s\S]*?<svg[^>]*>/i, "").replace(/<\/svg>\s*$/i, "");
  const pixelHeight = Math.round((1024 * (height + extra)) / width);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="${pixelHeight}" viewBox="0 0 ${width} ${height + extra}" role="img">
  <title>Opens website ${escaped}</title>
  <desc>This QR code opens the website only. Scanning does not connect a wallet or send funds. Encoded URL: ${escaped}</desc>
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${body}
  <text x="${width / 2}" y="${height + 6}" text-anchor="middle" fill="#000000" font-size="2.6" font-family="Arial, Helvetica, sans-serif">Opens the website only</text>
  <text x="${width / 2}" y="${height + 11}" text-anchor="middle" fill="#000000" font-size="2.2" font-family="Arial, Helvetica, sans-serif">Not a wallet connection or payment</text>
</svg>`;
}

/**
 * @param {unknown} response
 * @returns {{ action: "allow", energy: number | null } | { action: "block", message: string }}
 */
export function interpretTransferSimulation(response) {
  if (!response || typeof response !== "object") {
    return { action: "allow", energy: null };
  }
  const record = /** @type {Record<string, unknown>} */ (response);
  const result = record.result && typeof record.result === "object"
    ? /** @type {Record<string, unknown>} */ (record.result)
    : null;
  if (result && result.result === false) {
    return {
      action: "block",
      message: "A read-only simulation of this transfer failed. No transaction was submitted.",
    };
  }
  const returned = transferReturnedTrue(record.constant_result);
  if (returned === false) {
    return {
      action: "block",
      message: "The USDT contract returned false in a read-only simulation. Check the wallet balance. No transaction was submitted.",
    };
  }
  const energy = numeric(record.energy_used);
  return { action: "allow", energy };
}

/**
 * @param {unknown} parameters
 * @returns {number | null}
 */
export function readEnergyFeeSun(parameters) {
  if (!Array.isArray(parameters)) return null;
  const row = parameters.find((item) => {
    if (!item || typeof item !== "object") return false;
    return /** @type {{ key?: unknown }} */ (item).key === "getEnergyFee";
  });
  if (!row || typeof row !== "object") return null;
  return numeric(/** @type {{ value?: unknown }} */ (row).value);
}

/**
 * @param {{ energy?: number | null, energyTrx?: string | null }} [input]
 */
export function feeNote(input = {}) {
  const base = "TronLink shows the energy and bandwidth fee before you approve. This page caps the fee limit at 100 TRX and does not add its own fee.";
  if (input.energyTrx && input.energy != null) {
    return `${base} A read-only simulation used about ${input.energy} energy, roughly ${input.energyTrx} TRX before bandwidth or staked energy. Trust the fee shown in the wallet.`;
  }
  if (input.energy != null) {
    return `${base} A read-only simulation used about ${input.energy} energy. Trust the fee shown in the wallet.`;
  }
  return base;
}

/**
 * @param {number | null} energyUsed
 * @param {number | null} sunPerEnergy
 * @returns {string | null}
 */
export function formatEnergyTrx(energyUsed, sunPerEnergy) {
  if (energyUsed == null || sunPerEnergy == null) return null;
  if (!Number.isSafeInteger(energyUsed) || !Number.isSafeInteger(sunPerEnergy)) return null;
  if (energyUsed < 0 || sunPerEnergy <= 0) return null;
  const sun = BigInt(energyUsed) * BigInt(sunPerEnergy);
  const whole = sun / 1_000_000n;
  const fraction = (sun % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

/**
 * @param {string} value
 * @returns {Uint8Array | null}
 */
function decodeBase58(value) {
  if (!value) return null;
  const bytes = [0];
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) return null;
    let carry = digit;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < value.length && value[i] === "1"; i += 1) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

/**
 * @param {Uint8Array} data
 */
async function sha256(data) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 is unavailable in this runtime.");
  const digest = await subtle.digest("SHA-256", Uint8Array.from(data));
  return new Uint8Array(digest);
}

/**
 * @param {Uint8Array} bytes
 */
function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {Uint8Array} bytes
 */
function encodeBase58(bytes) {
  const digits = [0];
  for (const byte of bytes) {
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
  for (const byte of bytes) {
    if (byte !== 0) break;
    zeros += 1;
  }
  return "1".repeat(zeros) + digits.reverse().map((digit) => BASE58_ALPHABET[digit]).join("");
}

/**
 * @param {string} hex
 */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * @param {string} recipient
 */
async function abiAddressWord(recipient) {
  const hex = await tronAddressToHex(recipient);
  if (!hex || !hex.startsWith("41") || hex.length !== 42) return null;
  return hex.slice(2).padStart(64, "0");
}

/**
 * @param {string} unitsText
 */
function uint256Hex(unitsText) {
  try {
    const units = BigInt(unitsText);
    if (units < 0n || units >= 2n ** 256n) return null;
    return units.toString(16).padStart(64, "0");
  } catch {
    return null;
  }
}

/**
 * @param {unknown} tx
 */
function rawData(tx) {
  if (!tx || typeof tx !== "object") return null;
  const raw = /** @type {{ raw_data?: unknown }} */ (tx).raw_data;
  if (!raw || typeof raw !== "object") return null;
  return /** @type {Record<string, unknown>} */ (raw);
}

/**
 * @param {unknown} tx
 */
function triggerContract(tx) {
  const raw = rawData(tx);
  if (!raw || !Array.isArray(raw.contract) || raw.contract.length !== 1) return null;
  const contract = raw.contract[0];
  if (!contract || typeof contract !== "object") return null;
  if (/** @type {{ type?: unknown }} */ (contract).type !== "TriggerSmartContract") return null;
  return /** @type {{ parameter?: { value?: Record<string, unknown> } }} */ (contract);
}

/**
 * @param {unknown} tx
 */
function rawDataHex(tx) {
  if (!tx || typeof tx !== "object") return "";
  const hex = /** @type {{ raw_data_hex?: unknown }} */ (tx).raw_data_hex;
  return typeof hex === "string" ? hex.toLowerCase() : "";
}

/**
 * @param {unknown} tx
 */
function feeLimitOf(tx) {
  return rawData(tx)?.fee_limit ?? null;
}

/**
 * @param {unknown} field
 * @param {string} base58
 */
async function sameAddress(field, base58) {
  if (typeof field !== "string" || field !== field.trim()) return false;
  if (field === base58) return true;
  const expected = await tronAddressToHex(base58);
  if (!expected) return false;
  return field.toLowerCase().replace(/^0x/, "") === expected;
}

/**
 * @param {unknown} value
 */
function callValueIsZero(value) {
  return value == null || value === 0 || value === "0";
}

/**
 * @param {unknown} value
 * @param {number} cap
 */
function feeLimitAllowed(value, cap) {
  const amount = numeric(value);
  return amount != null && amount > 0 && amount <= cap;
}

/**
 * @param {unknown} field
 * @param {string} expected
 */
function dataEquals(field, expected) {
  if (typeof field !== "string") return false;
  return field.toLowerCase().replace(/^0x/, "") === expected.toLowerCase();
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function numeric(value) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function readTokenSymbol(value) {
  if (typeof value === "string") {
    const trimmed = value.replace(/\0/g, "").trim();
    if (/^[A-Za-z0-9]{1,12}$/.test(trimmed)) return trimmed;
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      const bytes = hexToBytes(trimmed);
      const end = bytes.indexOf(0);
      const text = new TextDecoder().decode(end === -1 ? bytes : bytes.slice(0, end));
      if (/^[A-Za-z0-9]{1,12}$/.test(text)) return text;
    }
    const decoded = decodeAbiString(trimmed);
    if (decoded && /^[A-Za-z0-9 ]{1,32}$/.test(decoded)) return decoded.trim();
  }
  if (value && typeof value === "object") {
    const record = /** @type {{ toString?: () => string, _hex?: unknown }} */ (value);
    if (typeof record._hex === "string") return readTokenSymbol(record._hex);
    if (typeof record.toString === "function") {
      const text = record.toString();
      if (text && text !== "[object Object]") return readTokenSymbol(text);
    }
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function readTokenDecimals(value) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 36) return value;
  if (typeof value === "bigint" && value >= 0n && value <= 36n) return Number(value);
  if (typeof value === "string") {
    if (/^[0-9]+$/.test(value)) {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 36 ? parsed : null;
    }
    const hex = value.replace(/^0x/, "");
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length >= 64) {
      try {
        const parsed = Number(BigInt(`0x${hex.slice(-64)}`));
        return Number.isInteger(parsed) && parsed >= 0 && parsed <= 36 ? parsed : null;
      } catch {
        return null;
      }
    }
  }
  if (value && typeof value === "object") {
    const record = /** @type {{ toNumber?: () => number, toString?: () => string, _hex?: unknown }} */ (value);
    if (typeof record.toNumber === "function") {
      const parsed = record.toNumber();
      if (Number.isInteger(parsed)) return readTokenDecimals(parsed);
    }
    if (typeof record._hex === "string") return readTokenDecimals(record._hex);
    if (typeof record.toString === "function") {
      const text = record.toString();
      if (/^[0-9]+$/.test(text)) return readTokenDecimals(text);
    }
  }
  return null;
}

/**
 * @param {string} hex
 */
function decodeAbiString(hex) {
  const raw = hex.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]*$/.test(raw) || raw.length < 128 || raw.length % 2 !== 0) return null;
  let offset;
  let length;
  try {
    offset = Number(BigInt(`0x${raw.slice(0, 64)}`));
    if (!Number.isInteger(offset) || offset < 0) return null;
    const start = offset * 2;
    if (start + 64 > raw.length) return null;
    length = Number(BigInt(`0x${raw.slice(start, start + 64)}`));
  } catch {
    return null;
  }
  if (!Number.isInteger(length) || length < 0 || length > 64) return null;
  const data = raw.slice(offset * 2 + 64, offset * 2 + 64 + length * 2);
  if (data.length !== length * 2) return null;
  return new TextDecoder().decode(hexToBytes(data));
}

/**
 * @param {unknown} constantResult
 * @returns {boolean | null}
 */
function transferReturnedTrue(constantResult) {
  if (!Array.isArray(constantResult) || typeof constantResult[0] !== "string") return null;
  const hex = constantResult[0].replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length < 64) return null;
  const word = hex.slice(-64);
  if (!/^0{63}[01]$/.test(word)) return null;
  return word.endsWith("1");
}

/**
 * @param {string} host
 */
function isBlockedAddress(host) {
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const parts = match.slice(1).map((part) => Number(part));
  if (parts.some((part) => part > 255)) return true;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

/**
 * @param {string} value
 */
function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * The on-page Receive USDT code stores only this page's HTTPS origin.
 * A scan opens the site. It is not a wallet request and it carries no amount.
 * @param {unknown} pageHref
 * @returns {string | null}
 */
export function receivePageUrl(pageHref) {
  if (typeof pageHref !== "string" || pageHref.length === 0 || pageHref.length > 2048) return null;
  if (/\s/.test(pageHref)) return null;
  let parsed;
  try {
    parsed = new URL(pageHref);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname) return null;
  return `${parsed.origin}/`;
}

/**
 * Official TronLink "open DApp" link for this page only.
 * The action is open. There is no amount, recipient, callback, or signature request.
 * @param {unknown} pageHref
 * @returns {string | null}
 */
export function tronLinkOpenDappUrl(pageHref) {
  const url = receivePageUrl(pageHref);
  if (!url) return null;
  const param = {
    url,
    action: "open",
    protocol: "TronLink",
    version: "1.0",
  };
  return `tronlinkoutside://pull.activity?param=${encodeURIComponent(JSON.stringify(param))}`;
}

/**
 * Keep a submitted receipt when the wallet locks or disconnects.
 * The returned sender is the account that submitted the transfer, not a new connection.
 * @param {unknown} receipt
 * @returns {{ txid: string, result: "none" | "submitted" | "confirmed" | "failed", sender: string, status: string }}
 */
export function keepSubmittedReceipt(receipt) {
  const empty = { txid: "", result: /** @type {const} */ ("none"), sender: "", status: "" };
  if (!receipt || typeof receipt !== "object") return { ...empty };
  const record = /** @type {Record<string, unknown>} */ (receipt);
  const txid = typeof record.txid === "string" && /^[0-9a-fA-F]{64}$/.test(record.txid)
    ? record.txid.toLowerCase()
    : "";
  const result = record.result === "submitted" || record.result === "confirmed" || record.result === "failed"
    ? record.result
    : "none";
  if (!txid || result === "none") return { ...empty };
  return {
    txid,
    result,
    sender: typeof record.sender === "string" ? record.sender : "",
    status: typeof record.status === "string" ? record.status : "",
  };
}

/**
 * Byte-mode QR modules for the receive-page URL. Null when the URL is not a page origin.
 * @param {unknown} pageHref
 * @returns {number[][] | null}
 */
export function receiveQrModules(pageHref) {
  const url = receivePageUrl(pageHref);
  if (!url) return null;
  return encodeByteQr(url);
}

const QR_TOTAL = [0, 26, 44, 70, 100, 134, 172];
const QR_ECC_H = [0, 17, 28, 44, 64, 88, 112];
const QR_BLOCKS_H = [0, 1, 1, 2, 4, 4, 4];
const QR_H_BITS = 2;
const QR_G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
const QR_G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

/**
 * @param {string} text
 * @returns {number[][] | null}
 */
function encodeByteQr(text) {
  const bytes = new TextEncoder().encode(text);
  const version = qrVersionForBytes(bytes.length);
  if (!version) return null;
  const size = version * 4 + 17;
  const matrix = qrMatrix(size);
  qrFinder(matrix);
  qrTiming(matrix);
  qrAlignment(matrix, version);
  qrFormat(matrix, 0);
  const codewords = qrDataCodewords(bytes, version);
  if (!codewords) return null;
  qrPlaceData(matrix, codewords);
  const mask = qrBestMask(matrix);
  qrApplyMask(matrix, mask);
  qrFormat(matrix, mask);
  const modules = [];
  for (let row = 0; row < size; row += 1) {
    const line = [];
    for (let col = 0; col < size; col += 1) line.push(matrix.data[row * size + col]);
    modules.push(line);
  }
  return modules;
}

/**
 * @param {number} length
 */
function qrVersionForBytes(length) {
  const bits = 4 + 8 + length * 8;
  for (let version = 1; version <= 6; version += 1) {
    if (bits <= (QR_TOTAL[version] - QR_ECC_H[version]) * 8) return version;
  }
  return 0;
}

/**
 * @param {number} size
 */
function qrMatrix(size) {
  return {
    size,
    data: new Uint8Array(size * size),
    reserved: new Uint8Array(size * size),
  };
}

/**
 * @param {{ size: number, data: Uint8Array, reserved: Uint8Array }} matrix
 * @param {number} row
 * @param {number} col
 * @param {number | boolean} value
 * @param {boolean} [reserved]
 */
function qrSet(matrix, row, col, value, reserved = false) {
  const index = row * matrix.size + col;
  matrix.data[index] = value ? 1 : 0;
  if (reserved) matrix.reserved[index] = 1;
}

/**
 * @param {{ size: number, data: Uint8Array, reserved: Uint8Array }} matrix
 */
function qrFinder(matrix) {
  const size = matrix.size;
  const anchors = [[0, 0], [0, size - 7], [size - 7, 0]];
  for (const [row, col] of anchors) {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const y = row + r;
        const x = col + c;
        if (y < 0 || x < 0 || y >= size || x >= size) continue;
        const edge = (r >= 0 && r <= 6 && (c === 0 || c === 6))
          || (c >= 0 && c <= 6 && (r === 0 || r === 6))
          || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        qrSet(matrix, y, x, edge, true);
      }
    }
  }
}

/**
 * @param {{ size: number, data: Uint8Array, reserved: Uint8Array }} matrix
 */
function qrTiming(matrix) {
  for (let i = 8; i < matrix.size - 8; i += 1) {
    const dark = i % 2 === 0;
    qrSet(matrix, i, 6, dark, true);
    qrSet(matrix, 6, i, dark, true);
  }
}

/**
 * @param {{ size: number, data: Uint8Array, reserved: Uint8Array }} matrix
 * @param {number} version
 */
function qrAlignment(matrix, version) {
  if (version < 2) return;
  const size = matrix.size;
  const posCount = Math.floor(version / 7) + 2;
  const intervals = Math.ceil((size - 13) / (2 * posCount - 2)) * 2;
  const positions = [6];
  for (let i = 1; i < posCount - 1; i += 1) positions.push(positions[i - 1] + intervals);
  positions.push(size - 7);
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = 0; j < positions.length; j += 1) {
      if ((i === 0 && j === 0) || (i === 0 && j === positions.length - 1) || (i === positions.length - 1 && j === 0)) {
        continue;
      }
      const row = positions[i];
      const col = positions[j];
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const dark = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
          qrSet(matrix, row + r, col + c, dark, true);
        }
      }
    }
  }
}

/**
 * @param {Uint8Array} payload
 * @param {number} version
 * @returns {Uint8Array | null}
 */
function qrDataCodewords(payload, version) {
  const total = QR_TOTAL[version];
  const ecc = QR_ECC_H[version];
  const dataCount = total - ecc;
  const buffer = { bytes: /** @type {number[]} */ ([]), length: 0 };
  qrPut(buffer, 0b0100, 4);
  qrPut(buffer, payload.length, 8);
  for (const byte of payload) qrPut(buffer, byte, 8);
  const capacity = dataCount * 8;
  if (buffer.length + 4 <= capacity) qrPut(buffer, 0, 4);
  while (buffer.length % 8 !== 0) qrPut(buffer, 0, 1);
  const remaining = (capacity - buffer.length) / 8;
  for (let i = 0; i < remaining; i += 1) qrPut(buffer, i % 2 ? 0x11 : 0xec, 8);
  if (buffer.bytes.length !== dataCount) return null;
  return qrInterleave(Uint8Array.from(buffer.bytes), version);
}

/**
 * @param {{ bytes: number[], length: number }} buffer
 * @param {number} value
 * @param {number} bits
 */
function qrPut(buffer, value, bits) {
  for (let i = bits - 1; i >= 0; i -= 1) {
    const index = Math.floor(buffer.length / 8);
    if (buffer.bytes.length <= index) buffer.bytes.push(0);
    if ((value >>> i) & 1) buffer.bytes[index] |= 0x80 >>> (buffer.length % 8);
    buffer.length += 1;
  }
}

/**
 * @param {Uint8Array} data
 * @param {number} version
 */
function qrInterleave(data, version) {
  const total = QR_TOTAL[version];
  const eccTotal = QR_ECC_H[version];
  const dataTotal = total - eccTotal;
  const blocks = QR_BLOCKS_H[version];
  const group2 = total % blocks;
  const group1 = blocks - group2;
  const data1 = Math.floor(dataTotal / blocks);
  const eccCount = Math.floor(total / blocks) - data1;
  const rs = qrReedSolomon(eccCount);
  /** @type {Uint8Array[]} */
  const dataBlocks = [];
  /** @type {Uint8Array[]} */
  const eccBlocks = [];
  let offset = 0;
  for (let block = 0; block < blocks; block += 1) {
    const size = block < group1 ? data1 : data1 + 1;
    const slice = data.slice(offset, offset + size);
    dataBlocks.push(slice);
    eccBlocks.push(rs(slice));
    offset += size;
  }
  const out = new Uint8Array(total);
  let index = 0;
  const maxData = data1 + (group2 > 0 ? 1 : 0);
  for (let i = 0; i < maxData; i += 1) {
    for (let block = 0; block < blocks; block += 1) {
      if (i < dataBlocks[block].length) out[index++] = dataBlocks[block][i];
    }
  }
  for (let i = 0; i < eccCount; i += 1) {
    for (let block = 0; block < blocks; block += 1) out[index++] = eccBlocks[block][i];
  }
  return out;
}

/**
 * @param {number} degree
 */
function qrReedSolomon(degree) {
  const exp = new Uint8Array(512);
  const log = new Uint8Array(256);
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    exp[i] = value;
    log[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) exp[i] = exp[i - 255];
  /**
   * @param {number} left
   * @param {number} right
   */
  function mul(left, right) {
    if (left === 0 || right === 0) return 0;
    return exp[log[left] + log[right]];
  }
  let poly = Uint8Array.from([1]);
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    for (let a = 0; a < poly.length; a += 1) {
      next[a] ^= mul(poly[a], 1);
      next[a + 1] ^= mul(poly[a], exp[i]);
    }
    poly = next;
  }
  /**
   * @param {Uint8Array} block
   */
  return function encode(block) {
    let result = new Uint8Array(block.length + degree);
    result.set(block);
    while (result.length - poly.length >= 0) {
      const lead = result[0];
      for (let i = 0; i < poly.length; i += 1) result[i] ^= mul(poly[i], lead);
      let skip = 0;
      while (skip < result.length && result[skip] === 0) skip += 1;
      result = result.slice(skip);
    }
    if (result.length >= degree) return result.subarray(result.length - degree);
    const padded = new Uint8Array(degree);
    padded.set(result, degree - result.length);
    return padded;
  };
}

/**
 * @param {{ size: number, data: Uint8Array, reserved: Uint8Array }} matrix
 * @param {Uint8Array} codewords
 */
function qrPlaceData(matrix, codewords) {
  const size = matrix.size;
  let row = size - 1;
  let upward = true;
  let bitIndex = 7;
  let byteIndex = 0;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    let scanning = true;
    while (scanning) {
      for (let offset = 0; offset < 2; offset += 1) {
        const x = col - offset;
        if (!matrix.reserved[row * size + x]) {
          const dark = byteIndex < codewords.length && ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
          qrSet(matrix, row, x, dark, false);
          bitIndex -= 1;
          if (bitIndex < 0) {
            byteIndex += 1;
            bitIndex = 7;
          }
        }
      }
      row += upward ? -1 : 1;
      if (row < 0 || row >= size) {
        row += upward ? 1 : -1;
        upward = !upward;
        scanning = false;
      }
    }
  }
}

/**
 * @param {{ size: number, data: Uint8Array, reserved: Uint8Array }} matrix
 * @param {number} mask
 */
function qrFormat(matrix, mask) {
  const bits = qrFormatBits(mask);
  const size = matrix.size;
  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >> i) & 1) === 1;
    if (i < 6) qrSet(matrix, i, 8, dark, true);
    else if (i < 8) qrSet(matrix, i + 1, 8, dark, true);
    else qrSet(matrix, size - 15 + i, 8, dark, true);
    if (i < 8) qrSet(matrix, 8, size - i - 1, dark, true);
    else if (i < 9) qrSet(matrix, 8, 15 - i - 1 + 1, dark, true);
    else qrSet(matrix, 8, 15 - i - 1, dark, true);
  }
  qrSet(matrix, size - 8, 8, 1, true);
}

/**
 * @param {number} mask
 */
function qrFormatBits(mask) {
  const data = (QR_H_BITS << 3) | mask;
  let rest = data << 10;
  const shift = qrBitLength(QR_G15);
  while (qrBitLength(rest) - shift >= 0) {
    rest ^= QR_G15 << (qrBitLength(rest) - shift);
  }
  return ((data << 10) | rest) ^ QR_G15_MASK;
}

/**
 * @param {number} value
 */
function qrBitLength(value) {
  let bits = 0;
  let rest = value;
  while (rest !== 0) {
    bits += 1;
    rest >>>= 1;
  }
  return bits;
}

/**
 * @param {{ size: number, data: Uint8Array, reserved: Uint8Array }} matrix
 */
function qrBestMask(matrix) {
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    qrFormat(matrix, mask);
    qrApplyMask(matrix, mask);
    const score = qrPenalty(matrix);
    qrApplyMask(matrix, mask);
    if (score < bestScore) {
      bestScore = score;
      best = mask;
    }
  }
  return best;
}

/**
 * @param {{ size: number, data: Uint8Array, reserved: Uint8Array }} matrix
 * @param {number} mask
 */
function qrApplyMask(matrix, mask) {
  const size = matrix.size;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (matrix.reserved[row * size + col]) continue;
      if (qrMaskBit(mask, row, col)) matrix.data[row * size + col] ^= 1;
    }
  }
}

/**
 * @param {number} mask
 * @param {number} row
 * @param {number} col
 */
function qrMaskBit(mask, row, col) {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return (row * col) % 2 + (row * col) % 3 === 0;
    case 6: return ((row * col) % 2 + (row * col) % 3) % 2 === 0;
    default: return ((row * col) % 3 + (row + col) % 2) % 2 === 0;
  }
}

/**
 * @param {{ size: number, data: Uint8Array }} matrix
 */
function qrPenalty(matrix) {
  return qrPenaltyN1(matrix) + qrPenaltyN2(matrix) + qrPenaltyN3(matrix) + qrPenaltyN4(matrix);
}

/**
 * @param {{ size: number, data: Uint8Array }} matrix
 */
function qrPenaltyN1(matrix) {
  const size = matrix.size;
  let points = 0;
  for (let row = 0; row < size; row += 1) {
    let runCol = 0;
    let runRow = 0;
    let lastCol = -1;
    let lastRow = -1;
    for (let col = 0; col < size; col += 1) {
      const across = matrix.data[row * size + col];
      if (across === lastCol) runCol += 1;
      else {
        if (runCol >= 5) points += 3 + (runCol - 5);
        lastCol = across;
        runCol = 1;
      }
      const down = matrix.data[col * size + row];
      if (down === lastRow) runRow += 1;
      else {
        if (runRow >= 5) points += 3 + (runRow - 5);
        lastRow = down;
        runRow = 1;
      }
    }
    if (runCol >= 5) points += 3 + (runCol - 5);
    if (runRow >= 5) points += 3 + (runRow - 5);
  }
  return points;
}

/**
 * @param {{ size: number, data: Uint8Array }} matrix
 */
function qrPenaltyN2(matrix) {
  const size = matrix.size;
  let blocks = 0;
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const sum = matrix.data[row * size + col]
        + matrix.data[row * size + col + 1]
        + matrix.data[(row + 1) * size + col]
        + matrix.data[(row + 1) * size + col + 1];
      if (sum === 0 || sum === 4) blocks += 1;
    }
  }
  return blocks * 3;
}

/**
 * @param {{ size: number, data: Uint8Array }} matrix
 */
function qrPenaltyN3(matrix) {
  const size = matrix.size;
  let points = 0;
  for (let row = 0; row < size; row += 1) {
    let bitsCol = 0;
    let bitsRow = 0;
    for (let col = 0; col < size; col += 1) {
      bitsCol = ((bitsCol << 1) & 0x7ff) | matrix.data[row * size + col];
      if (col >= 10 && (bitsCol === 0x5d0 || bitsCol === 0x05d)) points += 1;
      bitsRow = ((bitsRow << 1) & 0x7ff) | matrix.data[col * size + row];
      if (col >= 10 && (bitsRow === 0x5d0 || bitsRow === 0x05d)) points += 1;
    }
  }
  return points * 40;
}

/**
 * @param {{ size: number, data: Uint8Array }} matrix
 */
function qrPenaltyN4(matrix) {
  let dark = 0;
  for (const module of matrix.data) dark += module;
  const k = Math.abs(Math.ceil((dark * 100 / matrix.data.length) / 5) - 10);
  return k * 10;
}
