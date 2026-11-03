import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { utils as tronUtils } from "tronweb";
import {
  NONCE_TTL_MS,
  createAuthState,
  createSignInMessage,
  parseSignInMessage,
  verifySignIn,
} from "../src/auth.mjs";

const domain = "127.0.0.1:4173";
const uri = "http://127.0.0.1:4173/";

describe("wallet authentication", () => {
  it("issues one-time nonces and restores valid sessions", () => {
    const state = createAuthState();
    const now = Date.now();
    const issued = state.issueNonce(now);
    assert.equal(state.consumeNonce(issued.nonce, now + 1), true);
    assert.equal(state.consumeNonce(issued.nonce, now + 2), false);

    const created = state.createSession({
      address: "0x1111111111111111111111111111111111111111",
      network: "evm",
      chainId: "1",
      walletId: "metamask",
    }, now);
    assert.equal(state.readSession(created.token, now + 1)?.address, created.session.address);
    state.deleteSession(created.token);
    assert.equal(state.readSession(created.token, now + 2), null);
  });

  it("verifies an EVM login and rejects nonce replay", async () => {
    const state = createAuthState();
    const now = Date.now();
    const account = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`);
    const issued = state.issueNonce(now);
    const message = loginMessage({
      address: account.address,
      nonce: issued.nonce,
      issuedAt: new Date(now).toISOString(),
      expirationTime: new Date(now + NONCE_TTL_MS - 1).toISOString(),
    });
    const signature = await account.signMessage({ message });
    const verify = () => verifySignIn({
      message,
      signature,
      expectedDomain: domain,
      expectedUri: uri,
      consumeNonce: (nonce, time) => state.consumeNonce(nonce, time),
      now,
    });
    const first = await verify();
    assert.equal(first.ok, true);
    assert.equal(first.ok && first.identity.address, account.address);
    const replay = await verify();
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.match(replay.error, /nonce/i);
  });

  it("verifies a TRON login message without a transaction", async () => {
    const state = createAuthState();
    const now = Date.now();
    const account = tronUtils.accounts.generateAccount();
    const issued = state.issueNonce(now);
    const message = createSignInMessage({
      domain,
      address: account.address.base58,
      uri,
      network: "tron",
      walletId: "tronlink",
      chainId: "0x2b6653dc",
      nonce: issued.nonce,
      issuedAt: new Date(now).toISOString(),
      expirationTime: new Date(now + NONCE_TTL_MS - 1).toISOString(),
    });
    const signature = tronUtils.message.signMessage(message, account.privateKey);
    const verified = await verifySignIn({
      message,
      signature,
      expectedDomain: domain,
      expectedUri: uri,
      consumeNonce: (nonce, time) => state.consumeNonce(nonce, time),
      now,
    });
    assert.equal(verified.ok, true);
    assert.equal(verified.ok && verified.identity.address, account.address.base58);
  });

  it("binds messages to origin, chain, expiry, and wallet", async () => {
    const now = Date.now();
    const state = createAuthState();
    const account = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`);
    const issued = state.issueNonce(now);
    const expired = loginMessage({
      address: account.address,
      nonce: issued.nonce,
      issuedAt: new Date(now - NONCE_TTL_MS).toISOString(),
      expirationTime: new Date(now - 1).toISOString(),
    });
    const signature = await account.signMessage({ message: expired });
    const verified = await verifySignIn({
      message: expired,
      signature,
      expectedDomain: domain,
      expectedUri: uri,
      consumeNonce: (nonce, time) => state.consumeNonce(nonce, time),
      now,
    });
    assert.equal(verified.ok, false);
    assert.match(verified.error, /expired|time/i);
    assert.equal(parseSignInMessage(expired)?.walletId, "metamask");
    assert.equal(parseSignInMessage(expired)?.chainId, "1");
  });
});

/**
 * @param {Partial<{
 *   address: string,
 *   nonce: string,
 *   issuedAt: string,
 *   expirationTime: string
 * }>} overrides
 */
function loginMessage(overrides) {
  return createSignInMessage({
    domain,
    address: "0x1111111111111111111111111111111111111111",
    uri,
    network: "evm",
    walletId: "metamask",
    chainId: "1",
    nonce: "unused",
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + NONCE_TTL_MS - 1).toISOString(),
    ...overrides,
  });
}
