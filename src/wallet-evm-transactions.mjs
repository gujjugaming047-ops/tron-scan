/**
 * Recent ERC-20 transfer activity through the injected provider (eth_getLogs) — not Blockscout.
 */

import { looksLikeEvmAddress, normalizeEvmChainId } from "./evm-public.mjs";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163caa673f5b9a1";
const LOG_WINDOW_BLOCKS = 4000n;

/** @typedef {{ txid: string, when: string, direction: string, summary: string, token?: string }} WalletTransactionRow */

/**
 * @param {string} address
 */
function padTopicAddress(address) {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

/**
 * @param {unknown} hex
 */
function topicToAddress(hex) {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hex)) return "";
  return `0x${hex.slice(-40)}`;
}

/**
 * @param {bigint} blockNumber
 */
function formatBlockWhen(blockNumber) {
  return blockNumber > 0n ? `Block ${blockNumber.toString()}` : "Recent block";
}

/**
 * @param {{ request: (args: { method: string, params?: unknown[] }) => Promise<unknown> }} provider
 * @param {string} address
 * @param {string} chainId
 * @param {number} [limit]
 * @returns {Promise<{ ok: true, transactions: WalletTransactionRow[] } | { ok: false, error: string }>}
 */
export async function fetchEvmRecentTransactionsFromProvider(provider, address, chainId, limit = 12) {
  if (!provider || typeof provider.request !== "function") {
    return { ok: false, error: "Your wallet provider is not available." };
  }
  const trimmed = address.trim();
  if (!looksLikeEvmAddress(trimmed)) {
    return { ok: false, error: "The EVM address is invalid." };
  }
  const normalizedChain = normalizeEvmChainId(chainId) || normalizeEvmChainId(await provider.request({ method: "eth_chainId" })) || "1";

  let latest = 0n;
  try {
    const blockHex = await provider.request({ method: "eth_blockNumber" });
    latest = typeof blockHex === "string" && blockHex.startsWith("0x") ? BigInt(blockHex) : 0n;
  } catch {
    return { ok: false, error: "Your wallet could not read the current block." };
  }

  const fromBlock = latest > LOG_WINDOW_BLOCKS ? latest - LOG_WINDOW_BLOCKS : 0n;
  const fromBlockHex = `0x${fromBlock.toString(16)}`;
  const padded = padTopicAddress(trimmed);

  /** @type {Array<{ transactionHash?: string, blockNumber?: string, topics?: string[], address?: string }>} */
  let logs = [];
  try {
    const outgoing = await provider.request({
      method: "eth_getLogs",
      params: [{ fromBlock: fromBlockHex, toBlock: "latest", topics: [TRANSFER_TOPIC, padded] }],
    });
    const incoming = await provider.request({
      method: "eth_getLogs",
      params: [{ fromBlock: fromBlockHex, toBlock: "latest", topics: [TRANSFER_TOPIC, null, padded] }],
    });
    logs = [
      ...(Array.isArray(outgoing) ? outgoing : []),
      ...(Array.isArray(incoming) ? incoming : []),
    ];
  } catch {
    return {
      ok: true,
      transactions: [{
        txid: "",
        when: "Unavailable",
        direction: "Info",
        summary: `ERC-20 transfer history is not exposed by this wallet on chain ${normalizedChain}. Native activity may still appear in your wallet app.`,
      }],
    };
  }

  /** @type {Map<string, WalletTransactionRow>} */
  const merged = new Map();
  for (const log of logs) {
    const txid = typeof log.transactionHash === "string" ? log.transactionHash : "";
    if (!txid || merged.has(txid)) continue;
    const blockNumber = typeof log.blockNumber === "string" && log.blockNumber.startsWith("0x")
      ? BigInt(log.blockNumber)
      : 0n;
    const from = Array.isArray(log.topics) && log.topics[1] ? topicToAddress(log.topics[1]) : "";
    const to = Array.isArray(log.topics) && log.topics[2] ? topicToAddress(log.topics[2]) : "";
    const direction = from.toLowerCase() === trimmed.toLowerCase()
      ? "Sent ERC-20"
      : to.toLowerCase() === trimmed.toLowerCase()
        ? "Received ERC-20"
        : "ERC-20 transfer";
    const contract = typeof log.address === "string" ? log.address : "";
    merged.set(txid, {
      txid,
      when: formatBlockWhen(blockNumber),
      direction,
      summary: contract ? `Token ${contract.slice(0, 6)}…${contract.slice(-4)}` : "Token transfer",
      token: "ERC-20",
    });
  }

  const transactions = [...merged.values()]
    .sort((left, right) => right.txid.localeCompare(left.txid))
    .slice(0, limit);

  return { ok: true, transactions };
}
