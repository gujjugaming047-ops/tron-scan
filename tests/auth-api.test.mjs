import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { utils as tronUtils } from "tronweb";
import { createSignInMessage } from "../src/auth.mjs";
import { RECIPIENT } from "../src/logic.mjs";

const root = path.resolve(import.meta.dirname, "..");
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
    await assertFramed(await fetch(`${base}/api/auth/session`), 200);
    await assertFramed(await fetch(`${base}/login`), 200);
    await assertFramed(await fetch(`${base}/missing-page`), 404);
    await assertFramed(await fetch(`${base}/logout`, { method: "POST", redirect: "manual" }), 303);
  });

  it("requires the configured owner before visitor authentication", async () => {
    const headers = { Origin: base };
    const config = await fetch(`${base}/api/config`, { headers });
    assert.equal(config.status, 200);
    assert.deepEqual(await config.json(), {
      walletConnectProjectId: "",
      ownerTronAddress: RECIPIENT,
      tronChainId: "tron:0x2b6653dc",
    });
    const ownerSession = await fetch(`${base}/api/owner/session`, { headers });
    assert.deepEqual(await ownerSession.json(), {
      ok: true,
      approved: false,
      session: null,
      ownerTronAddress: RECIPIENT,
    });
    const visitorNonce = await fetch(`${base}/api/auth/nonce`, { headers });
    assert.equal(visitorNonce.status, 403);
    assert.match((await visitorNonce.json()).error, /owner.*approve/i);
  });

  it("rejects a paired TRON wallet that is not the configured owner", async () => {
    const headers = { Origin: base };
    const account = tronUtils.accounts.generateAccount();
    assert.notEqual(account.address.base58, RECIPIENT);
    const nonceResponse = await fetch(`${base}/api/owner/nonce`, { headers });
    assert.equal(nonceResponse.status, 200);
    const nonce = await nonceResponse.json();
    assert.equal(nonce.ownerTronAddress, RECIPIENT);
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
    assert.equal(verification.status, 403);
    assert.match((await verification.json()).error, /does not match.*owner/i);

    const replay = await fetch(`${base}/api/owner/verify`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature }),
    });
    assert.equal(replay.status, 401);
    assert.match((await replay.json()).error, /nonce/i);
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
