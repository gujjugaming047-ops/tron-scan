/**
 * Keep one current record per wallet. The server appends a record after each
 * verified sign-in, so rendering every historical record produces stale cards.
 * @template {{ address: string }} T
 * @param {T[]} wallets
 * @returns {T[]}
 */
export function latestWalletConnections(wallets) {
  const seen = new Set();
  const latest = [];
  for (let index = wallets.length - 1; index >= 0; index -= 1) {
    const wallet = wallets[index];
    const key = wallet.address.startsWith("0x") ? wallet.address.toLowerCase() : wallet.address;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(wallet);
  }
  return latest.reverse();
}

/**
 * Normalize a TRON mainnet balance read used only after a verified WalletConnect
 * TRON session (`T…`) when injected TronWeb is unavailable. This is not a
 * substitute for wallet connectivity by itself.
 * @param {{ ok?: boolean, body?: { assets?: Record<string, unknown>, error?: string } | null }} response
 * @returns {({ ok: true, source: "verified-wc-tron-mainnet-read" } & Record<string, unknown>) | { ok: false, error: string }}
 */
export function publicTronSnapshotAssets(response) {
  if (!response?.ok || !response.body?.assets || typeof response.body.assets !== "object") {
    return {
      ok: false,
      error: response?.body?.error || "TRON mainnet balances are temporarily unavailable after the verified session.",
    };
  }
  return {
    ...response.body.assets,
    ok: true,
    source: "verified-wc-tron-mainnet-read",
  };
}
