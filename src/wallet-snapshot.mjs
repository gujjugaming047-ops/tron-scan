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
 * Normalize the read-only TRON mainnet fallback response used when a verified
 * WalletConnect session does not expose injected TronWeb.
 * @param {{ ok?: boolean, body?: { assets?: Record<string, unknown>, error?: string } | null }} response
 * @returns {({ ok: true, source: "public-tron-mainnet" } & Record<string, unknown>) | { ok: false, error: string }}
 */
export function publicTronSnapshotAssets(response) {
  if (!response?.ok || !response.body?.assets || typeof response.body.assets !== "object") {
    return {
      ok: false,
      error: response?.body?.error || "Read-only TRON mainnet balances are temporarily unavailable.",
    };
  }
  return {
    ...response.body.assets,
    ok: true,
    source: "public-tron-mainnet",
  };
}
