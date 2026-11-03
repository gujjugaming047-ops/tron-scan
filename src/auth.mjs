import { randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, recoverMessageAddress } from "viem";
import { utils as tronUtils } from "tronweb";
import { isValidTronAddress } from "./logic.mjs";

export const WALLET_COOKIE = "wallet_session";
export const AUTH_VERSION = "1";
export const NONCE_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * @typedef {{ address: string, network: "evm" | "tron", chainId: string, walletId: "metamask" | "trust" | "tronlink" | "injected" | "walletconnect" }} WalletIdentity
 * @typedef {WalletIdentity & { expiresAt: number }} WalletSession
 */

const allowedNetworks = new Map([
  ["evm", /^[1-9]\d*$/],
  ["tron", /^0x2b6653dc$/],
]);

export function createAuthState() {
  /** @type {Map<string, number>} */
  const nonces = new Map();
  /** @type {Map<string, WalletSession>} */
  const sessions = new Map();

  return {
    issueNonce(now = Date.now()) {
      cleanExpired(nonces, now);
      const nonce = randomBytes(18).toString("base64url");
      nonces.set(nonce, now + NONCE_TTL_MS);
      return { nonce, expiresAt: now + NONCE_TTL_MS };
    },
    /**
     * @param {string} nonce
     * @param {number} [now]
     */
    consumeNonce(nonce, now = Date.now()) {
      const expiresAt = nonces.get(nonce);
      nonces.delete(nonce);
      return typeof expiresAt === "number" && expiresAt >= now;
    },
    /**
     * @param {WalletIdentity} identity
     * @param {number} [now]
     */
    createSession(identity, now = Date.now()) {
      cleanSessions(sessions, now);
      const token = randomBytes(32).toString("base64url");
      const session = { ...identity, expiresAt: now + SESSION_TTL_MS };
      sessions.set(token, session);
      return { token, session };
    },
    /**
     * @param {string} token
     * @param {number} [now]
     */
    readSession(token, now = Date.now()) {
      const session = sessions.get(token);
      if (!session || session.expiresAt < now) {
        if (token) sessions.delete(token);
        return null;
      }
      return { ...session };
    },
    /**
     * @param {string} token
     */
    deleteSession(token) {
      if (token) sessions.delete(token);
    },
  };
}

/**
 * @param {{
 *   domain: string,
 *   address: string,
 *   uri: string,
 *   network: "evm" | "tron",
 *   walletId: "metamask" | "trust" | "tronlink" | "injected" | "walletconnect",
 *   chainId: string,
 *   nonce: string,
 *   issuedAt: string,
 *   expirationTime: string
 * }} fields
 */
export function createSignInMessage(fields) {
  const accountLabel = fields.network === "tron" ? "TRON" : "Ethereum";
  return `${fields.domain} wants you to sign in with your ${accountLabel} account:
${fields.address}

Sign in to FlashCheck. This request does not authorize a transaction.

URI: ${fields.uri}
Version: ${AUTH_VERSION}
Network: ${fields.network}
Wallet ID: ${fields.walletId}
Chain ID: ${fields.chainId}
Nonce: ${fields.nonce}
Issued At: ${fields.issuedAt}
Expiration Time: ${fields.expirationTime}`;
}

/**
 * @param {string} message
 */
export function parseSignInMessage(message) {
  if (typeof message !== "string" || message.length > 4096) return null;
  const match = message.match(/^([^\r\n]+) wants you to sign in with your (Ethereum|TRON) account:\n([^\r\n]+)\n\nSign in to FlashCheck\. This request does not authorize a transaction\.\n\nURI: ([^\r\n]+)\nVersion: ([^\r\n]+)\nNetwork: ([^\r\n]+)\nWallet ID: (metamask|trust|tronlink|injected|walletconnect)\nChain ID: ([^\r\n]+)\nNonce: ([A-Za-z0-9_-]+)\nIssued At: ([^\r\n]+)\nExpiration Time: ([^\r\n]+)$/);
  if (!match) return null;
  const [, domain, accountLabel, address, uri, version, network, walletId, chainId, nonce, issuedAt, expirationTime] = match;
  if ((network === "tron") !== (accountLabel === "TRON")) return null;
  if (network !== "evm" && network !== "tron") return null;
  return {
    domain,
    address,
    uri,
    version,
    network: /** @type {"evm" | "tron"} */ (network),
    walletId: /** @type {"metamask" | "trust" | "tronlink" | "injected" | "walletconnect"} */ (walletId),
    chainId,
    nonce,
    issuedAt,
    expirationTime,
  };
}

/**
 * @param {{
 *   message: string,
 *   signature: string,
 *   expectedDomain: string,
 *   expectedUri: string,
 *   consumeNonce: (nonce: string, now?: number) => boolean,
 *   now?: number
 * }} request
 */
export async function verifySignIn(request) {
  const now = request.now ?? Date.now();
  const fields = parseSignInMessage(request.message);
  if (!fields) return fail("The sign-in message is invalid.");
  if (!request.consumeNonce(fields.nonce, now)) return fail("The nonce is invalid, expired, or already used.");
  if (!safeEqual(fields.domain, request.expectedDomain) || !safeEqual(fields.uri, request.expectedUri)) {
    return fail("The sign-in origin does not match this site.");
  }
  if (fields.version !== AUTH_VERSION) return fail("The sign-in version is not supported.");
  const chainPattern = allowedNetworks.get(fields.network);
  if (!chainPattern?.test(fields.chainId)) return fail("The selected network is not supported.");
  const issuedAt = Date.parse(fields.issuedAt);
  const expiration = Date.parse(fields.expirationTime);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiration)) return fail("The sign-in time is invalid.");
  if (issuedAt > now + 60_000 || issuedAt < now - NONCE_TTL_MS) return fail("The sign-in request is outside its allowed time window.");
  if (expiration <= now || expiration > issuedAt + NONCE_TTL_MS) return fail("The sign-in request has expired.");

  try {
    if (fields.network === "evm") {
      if (!isAddress(fields.address)) return fail("The wallet address is invalid.");
      const recovered = await recoverMessageAddress({ message: request.message, signature: /** @type {`0x${string}`} */ (request.signature) });
      if (getAddress(recovered) !== getAddress(fields.address)) return fail("The signature does not match the wallet.");
      return success(getAddress(fields.address), fields);
    }
    if (!(await isValidTronAddress(fields.address))) return fail("The wallet address is invalid.");
    const recovered = tronUtils.message.verifyMessage(request.message, request.signature);
    if (!safeEqual(recovered, fields.address)) return fail("The signature does not match the wallet.");
    return success(fields.address, fields);
  } catch {
    return fail("The wallet signature could not be verified.");
  }
}

/**
 * @param {string} address
 * @param {{ network: "evm" | "tron", walletId: "metamask" | "trust" | "tronlink" | "injected" | "walletconnect", chainId: string }} fields
 */
function success(address, fields) {
  return {
    ok: /** @type {const} */ (true),
    identity: {
      address,
      network: fields.network,
      walletId: fields.walletId,
      chainId: fields.chainId,
    },
  };
}

/**
 * @param {string} error
 */
function fail(error) {
  return { ok: /** @type {const} */ (false), error };
}

/**
 * @param {string} left
 * @param {string} right
 */
function safeEqual(left, right) {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  if (first.length !== second.length) return false;
  return timingSafeEqual(first, second);
}

/**
 * @param {Map<string, number>} values
 * @param {number} now
 */
function cleanExpired(values, now) {
  for (const [key, expiresAt] of values) {
    if (expiresAt < now) values.delete(key);
  }
}

/**
 * @param {Map<string, WalletSession>} values
 * @param {number} now
 */
function cleanSessions(values, now) {
  for (const [key, session] of values) {
    if (session.expiresAt < now) values.delete(key);
  }
}
