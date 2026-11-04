import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { utils as tronUtils } from "tronweb";
import { createSignInMessage } from "../src/auth.mjs";
import {
  CONNECTION_TARGET,
  isValidTronAddress,
} from "../src/logic.mjs";

const root = path.resolve(import.meta.dirname, "..");
const storePath = path.join(root, "data", "connected-wallets.json");
/** @type {import("node:child_process").ChildProcessWithoutNullStreams | undefined} */
let child;
let base = "";

describe("wallet authentication API", () => {
  before(async () => {
    child = spawn(process.execPath, [path.join(root, "scripts", "serve.mjs")], {
      cwd: root,
      env: { ...process.env, PORT: "0", WALLETCONNECT_PROJECT_ID: "" },
    });
    base = await previewUrl(child);
  });

  after(() => {
    if (child && child.exitCode == null) child.kill("SIGTERM");
  });

  it("frames static, JSON, HTML, text, and redirect responses without chunking", async () => {
    await assertFramed(await fetch(`${base}/`), 200);
    await assertFramed(await fetch(`${base}/src/landing.js`), 200);
    await assertFramed(await fetch(`${base}/src/tron-public.mjs`), 200);
    await assertFramed(await fetch(`${base}/src/evm-public.mjs`), 200);
    await assertFramed(await fetch(`${base}/api/auth/session`), 200);
    await assertFramed(await fetch(`${base}/login`), 200);
    await assertFramed(await fetch(`${base}/missing-page`), 404);
    await assertFramed(await fetch(`${base}/logout`, { method: "POST", redirect: "manual" }), 303);
  });

  it("exposes the connection target and allows visitor authentication without owner approval", async () => {
    const headers = { Origin: base };
    const config = await fetch(`${base}/api/config`, { headers });
    assert.equal(config.status, 200);
    assert.deepEqual(await config.json(), {
      walletConnectProjectId: "",
      connectionTargetTronAddress: CONNECTION_TARGET,
      tronChainId: "tron:0x2b6653dc",
    });
    assert.equal(await isValidTronAddress(CONNECTION_TARGET), true);
    const visitorNonce = await fetch(`${base}/api/auth/nonce`, { headers });
    assert.equal(visitorNonce.status, 200);
    const nonceBody = await visitorNonce.json();
    assert.equal(typeof nonceBody.nonce, "string");
    assert.ok(nonceBody.nonce.length >= 16);
  });

  it("accepts any verified TRON WalletConnect owner signature", async () => {
    const headers = { Origin: base };
    const account = tronUtils.accounts.generateAccount();
    const nonceResponse = await fetch(`${base}/api/owner/nonce`, { headers });
    assert.equal(nonceResponse.status, 200);
    const nonce = await nonceResponse.json();
    const issuedAt = new Date();
    const message = createSignInMessage({
      domain: nonce.domain,
      address: account.address.base58,
      uri: nonce.uri,
      network: "tron",
      walletId: "walletconnect",
      chainId: "0x2b6653dc",
      nonce: nonce.nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: new Date(issuedAt.getTime() + 4 * 60 * 1000).toISOString(),
    });
    const signature = tronUtils.message.signMessage(message, account.privateKey);
    const verification = await fetch(`${base}/api/owner/verify`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    assert.equal(verification.status, 200);
    assert.equal((await verification.json()).session.address, account.address.base58);
  });

  it("records a verified TRON wallet against the connection target", async () => {
    const headers = { Origin: base };
    const account = tronUtils.accounts.generateAccount();
    const nonceResponse = await fetch(`${base}/api/auth/nonce`, { headers });
    assert.equal(nonceResponse.status, 200);
    const nonce = await nonceResponse.json();
    const issuedAt = new Date();
    const message = createSignInMessage({
      domain: nonce.domain,
      address: account.address.base58,
      uri: nonce.uri,
      network: "tron",
      walletId: "walletconnect",
      chainId: "0x2b6653dc",
      nonce: nonce.nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: new Date(issuedAt.getTime() + 4 * 60 * 1000).toISOString(),
    });
    const signature = tronUtils.message.signMessage(message, account.privateKey);
    const verification = await fetch(`${base}/api/auth/verify`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    assert.equal(verification.status, 200);
    const body = await verification.json();
    assert.equal(body.session.connectionTarget, CONNECTION_TARGET);
    assert.equal(body.session.address, account.address.base58);
    const stored = JSON.parse(await readFile(storePath, "utf8"));
    const latest = stored.wallets.at(-1);
    assert.equal(latest.address, account.address.base58);
    assert.equal(latest.connectionTarget, CONNECTION_TARGET);
    const sessionCookie = (verification.headers.get("set-cookie") || "").match(/wallet_session=[^;]+/)?.[0] || "";
    assert.ok(sessionCookie);
    const assets = await fetch(`${base}/api/wallet-assets`, {
      headers: { ...headers, Cookie: sessionCookie },
    });
    assert.equal(assets.status, 410);
    const assetBody = await assets.json();
    assert.equal(assetBody.ok, false);
    assert.match(assetBody.error, /Web3 provider/i);
    const snapshot = await fetch(`${base}/api/wallet-provider-snapshot`, {
      method: "POST",
      headers: { ...headers, Cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        address: account.address.base58,
        assets: {
          ok: true,
          trxDisplay: "1 TRX",
          usdtDisplay: "0 USDT",
          tokens: [{ standard: "TRX", symbol: "TRX", name: "TRON", display: "1 TRX" }],
        },
        transactions: [{ txid: "abc123", when: "Now", direction: "Sent", summary: "1 TRX" }],
      }),
    });
    assert.equal(snapshot.status, 200);
    assert.equal((await snapshot.json()).ok, true);
    const blockedPublic = await fetch(
      `${base}/api/public/wallet-assets?address=${encodeURIComponent(account.address.base58)}`,
      { headers: { Origin: "https://attacker.example" } },
    );
    assert.equal(blockedPublic.status, 403);
    const invalidPublic = await fetch(`${base}/api/public/wallet-assets?address=not-a-tron-address`, { headers });
    assert.equal(invalidPublic.status, 400);
    const invalidEvm = await fetch(`${base}/api/public/evm-wallet-assets?address=not-evm&chainId=1`, { headers });
    assert.equal(invalidEvm.status, 400);
  });

  it("rejects a mismatched browser origin", async () => {
    const response = await fetch(`${base}/api/auth/nonce`, { headers: { Origin: "https://attacker.example" } });
    assert.equal(response.status, 403);
  });

  it("falls back to the Host header when Origin is missing on loopback", async () => {
    const response = await fetch(`${base}/api/auth/nonce`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.domain, new URL(base).host);
  });

  it("accepts a tunnel Origin when Host points at the local preview server", async () => {
    const tunnelOrigin = "https://surround-agent-mattress-gets.trycloudflare.com";
    const localHost = new URL(base).host;
    const headers = { Origin: tunnelOrigin, Host: localHost };
    const nonceResponse = await fetch(`${base}/api/auth/nonce`, { headers });
    assert.equal(nonceResponse.status, 200);
    const nonce = await nonceResponse.json();
    assert.equal(nonce.domain, "surround-agent-mattress-gets.trycloudflare.com");
    assert.equal(nonce.uri, `${tunnelOrigin}/`);
    const account = tronUtils.accounts.generateAccount();
    const issuedAt = new Date();
    const message = createSignInMessage({
      domain: nonce.domain,
      address: account.address.base58,
      uri: nonce.uri,
      network: "tron",
      walletId: "walletconnect",
      chainId: "0x2b6653dc",
      nonce: nonce.nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: new Date(issuedAt.getTime() + 4 * 60 * 1000).toISOString(),
    });
    const signature = tronUtils.message.signMessage(message, account.privateKey);
    const verification = await fetch(`${base}/api/auth/verify`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    assert.equal(verification.status, 200);
    assert.equal((await verification.json()).session.connectionTarget, CONNECTION_TARGET);
  });

  it("uses the browser Origin for sign-in even when PUBLIC_ORIGIN differs", async () => {
    const tunnel = "https://surround-agent-mattress-gets.trycloudflare.com";
    const preview = spawn(process.execPath, [path.join(root, "scripts", "serve.mjs")], {
      cwd: root,
      env: {
        ...process.env,
        PORT: "0",
        WALLETCONNECT_PROJECT_ID: "",
        PUBLIC_ORIGIN: tunnel,
      },
    });
    try {
      const loopback = await previewUrl(preview);
      const headers = { Origin: loopback };
      const nonceResponse = await fetch(`${loopback}/api/auth/nonce`, { headers });
      assert.equal(nonceResponse.status, 200);
      const nonce = await nonceResponse.json();
      assert.equal(nonce.domain, new URL(loopback).host);
      assert.equal(nonce.uri, `${loopback}/`);
      const account = tronUtils.accounts.generateAccount();
      const issuedAt = new Date();
      const message = createSignInMessage({
        domain: nonce.domain,
        address: account.address.base58,
        uri: nonce.uri,
        network: "tron",
        walletId: "walletconnect",
        chainId: "0x2b6653dc",
        nonce: nonce.nonce,
        issuedAt: issuedAt.toISOString(),
        expirationTime: new Date(issuedAt.getTime() + 4 * 60 * 1000).toISOString(),
      });
      const signature = tronUtils.message.signMessage(message, account.privateKey);
      const verification = await fetch(`${loopback}/api/auth/verify`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      assert.equal(verification.status, 200);
      assert.equal((await verification.json()).session.connectionTarget, CONNECTION_TARGET);
    } finally {
      if (preview.exitCode == null) preview.kill("SIGTERM");
    }
  });

  it("serves the hub master wallet review page for the connection target", async () => {
    const page = await fetch(`${base}/master-wallet`, { headers: { Origin: base } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Hub master wallet/);
    assert.match(html, new RegExp(CONNECTION_TARGET));
    assert.match(html, /No seed phrase · No private key · No automatic transfer/);
    assert.match(html, /Manage assets/);
    assert.match(html, /Wallet provider assets/);
    assert.match(html, /Recent activity/);
    assert.match(html, /master-refresh-provider/);
    assert.match(html, /master-manage-open/);
    assert.match(html, /master-wallet\.js\?v=/);
    assert.match(html, /Review transferFrom/);
    assert.match(html, /Sign transferFrom as spender/);
    assert.match(html, /Remaining allowance/);
    assert.match(html, /Flash USDT Check/);
  });
});

/**
 * @param {import("node:child_process").ChildProcessWithoutNullStreams} processHandle
 * @returns {Promise<string>}
 */
function previewUrl(processHandle) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Preview did not start. ${output}`)), 5000);
    processHandle.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    processHandle.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    processHandle.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/Local preview: (http:\/\/127\.0\.0\.1:\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match[1]);
    });
  });
}

/**
 * @param {Response} response
 * @param {number} status
 */
async function assertFramed(response, status) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("connection"), "close");
  assert.equal(response.headers.has("transfer-encoding"), false);
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(response.headers.get("content-length"), String(body.byteLength));
}
