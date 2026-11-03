import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { createSignInMessage } from "../src/auth.mjs";

const root = path.resolve(import.meta.dirname, "..");
/** @type {import("node:child_process").ChildProcessWithoutNullStreams | undefined} */
let child;
let base = "";

describe("wallet authentication API", () => {
  before(async () => {
    child = spawn(process.execPath, [path.join(root, "scripts", "serve.mjs")], {
      cwd: root,
      env: { ...process.env, PORT: "0" },
    });
    base = await previewUrl(child);
  });

  after(() => {
    if (child && child.exitCode == null) child.kill("SIGTERM");
  });

  it("frames static, JSON, HTML, text, and redirect responses without chunking", async () => {
    await assertFramed(await fetch(`${base}/`), 200);
    await assertFramed(await fetch(`${base}/api/auth/session`), 200);
    await assertFramed(await fetch(`${base}/login`), 200);
    await assertFramed(await fetch(`${base}/missing-page`), 404);
    await assertFramed(await fetch(`${base}/logout`, { method: "POST", redirect: "manual" }), 303);
  });

  it("creates, restores, protects, and clears an HTTP-only session", async () => {
    const account = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`);
    const headers = { Origin: base };
    const nonceResponse = await fetch(`${base}/api/auth/nonce`, { headers });
    assert.equal(nonceResponse.status, 200);
    const nonce = await nonceResponse.json();
    const issuedAt = new Date();
    const message = createSignInMessage({
      domain: nonce.domain,
      address: account.address,
      uri: nonce.uri,
      network: "evm",
      walletId: "metamask",
      chainId: "1",
      nonce: nonce.nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: new Date(issuedAt.getTime() + 4 * 60 * 1000).toISOString(),
    });
    const signature = await account.signMessage({ message });
    const verification = await fetch(`${base}/api/auth/verify`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    assert.equal(verification.status, 200);
    const setCookie = verification.headers.get("set-cookie") || "";
    assert.match(setCookie, /^wallet_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.equal(/;\s*Secure/i.test(setCookie), false);
    const cookie = setCookie.split(";")[0];

    const restored = await fetch(`${base}/api/auth/session`, { headers: { ...headers, Cookie: cookie } });
    assert.equal(restored.status, 200);
    const restoredBody = await restored.json();
    assert.equal(restoredBody.session.address, account.address);
    assert.equal(restoredBody.session.walletId, "metamask");

    const protectedResponse = await fetch(`${base}/api/wallet-connections`, {
      method: "POST",
      headers: { ...headers, Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ address: account.address }),
    });
    assert.equal(protectedResponse.status, 200);
    const unauthorized = await fetch(`${base}/api/wallet-connections`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ address: account.address }),
    });
    assert.equal(unauthorized.status, 401);

    const replay = await fetch(`${base}/api/auth/verify`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    assert.equal(replay.status, 401);
    assert.match((await replay.json()).error, /nonce/i);

    const logout = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { ...headers, Cookie: cookie } });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie") || "", /Max-Age=0/);
    const afterLogout = await fetch(`${base}/api/auth/session`, { headers: { ...headers, Cookie: cookie } });
    assert.equal((await afterLogout.json()).session, null);
  });

  it("rejects a mismatched browser origin", async () => {
    const response = await fetch(`${base}/api/auth/nonce`, { headers: { Origin: "https://attacker.example" } });
    assert.equal(response.status, 403);
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
