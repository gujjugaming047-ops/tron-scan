import { createServer } from "node:http";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthState, SESSION_TTL_MS, WALLET_COOKIE, verifySignIn } from "../src/auth.mjs";
import { RECIPIENT } from "../src/logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4173);
const storePath = path.join(root, "data", "connected-wallets.json");
const operatorId = process.env.OPERATOR_ID || "";
const operatorPassword = process.env.OPERATOR_PASSWORD || "";
const sessionCookie = "operator_session";
/** @type {Set<string>} */
const operatorSessions = new Set();
const walletAuth = createAuthState();
const ownerAuth = createAuthState();
const ownerCookie = "owner_approval";
let writeQueue = Promise.resolve();

const allowed = new Map([
  ["/index.html", "text/html; charset=utf-8"],
  ["/generated/walletconnect-client.js", "text/javascript; charset=utf-8"],
  ["/src/app.js", "text/javascript; charset=utf-8"],
  ["/src/landing.js", "text/javascript; charset=utf-8"],
  ["/src/logic.mjs", "text/javascript; charset=utf-8"],
  ["/src/styles.css", "text/css; charset=utf-8"],
  ["/src/wallet-state.mjs", "text/javascript; charset=utf-8"],
]);

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  try {
    if (url.pathname === "/login") {
      await handleLogin(request, response);
      return;
    }
    if (url.pathname === "/logout" && request.method === "POST") {
      await handleLogout(request, response);
      return;
    }
    if (url.pathname === "/api/wallet-connections" && request.method === "POST") {
      await handleWalletConnection(request, response);
      return;
    }
    if (url.pathname === "/api/config" && request.method === "GET") {
      handlePublicConfig(response);
      return;
    }
    if (url.pathname === "/api/owner/nonce" && request.method === "GET") {
      handleOwnerNonce(request, response);
      return;
    }
    if (url.pathname === "/api/owner/verify" && request.method === "POST") {
      await handleOwnerVerify(request, response);
      return;
    }
    if (url.pathname === "/api/owner/session" && request.method === "GET") {
      handleOwnerSession(request, response);
      return;
    }
    if (url.pathname === "/api/owner/logout" && request.method === "POST") {
      handleOwnerLogout(request, response);
      return;
    }
    if (url.pathname === "/api/auth/nonce" && request.method === "GET") {
      handleAuthNonce(request, response);
      return;
    }
    if (url.pathname === "/api/auth/verify" && request.method === "POST") {
      await handleAuthVerify(request, response);
      return;
    }
    if (url.pathname === "/api/auth/session" && request.method === "GET") {
      handleAuthSession(request, response);
      return;
    }
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      handleAuthLogout(request, response);
      return;
    }
    await serveStatic(url.pathname, response);
  } catch {
    if (!response.headersSent && !response.writableEnded) {
      finish(response, 500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }, "Server error");
    } else if (!response.writableEnded) {
      response.destroy();
    }
  }
});

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
async function handleLogin(request, response) {
  if (request.method === "POST") {
    const body = await readBody(request, 2048);
    const fields = new URLSearchParams(body);
    const accepted = operatorId.length > 0
      && operatorPassword.length > 0
      && sameSecret(fields.get("loginId") || "", operatorId)
      && sameSecret(fields.get("password") || "", operatorPassword);
    if (!accepted) {
      sendHtml(response, 401, loginPage("Login failed."));
      return;
    }
    const token = randomBytes(32).toString("hex");
    operatorSessions.add(token);
    finish(response, 303, {
      Location: "/login",
      "Set-Cookie": `${sessionCookie}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`,
      "Cache-Control": "no-store",
    });
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendText(response, 405, "Method not allowed");
    return;
  }
  if (!hasSession(request)) {
    sendHtml(response, 200, loginPage(""));
    return;
  }
  const wallets = await readWallets();
  sendHtml(response, 200, walletListPage(wallets));
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
async function handleLogout(request, response) {
  const token = cookieValue(request, sessionCookie);
  if (token) operatorSessions.delete(token);
  finish(response, 303, {
    Location: "/login",
    "Set-Cookie": `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    "Cache-Control": "no-store",
  });
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
async function handleWalletConnection(request, response) {
  const session = readWalletSession(request);
  if (!session || !readOwnerSession(request)) {
    sendJson(response, 401, { ok: false, error: "Verified owner approval and visitor wallet sessions are required." });
    return;
  }
  const body = await readBody(request, 2048);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendText(response, 400, "Bad request");
    return;
  }
  const address = parsed && typeof parsed === "object" ? parsed.address : "";
  if (typeof address !== "string" || !sameAddress(address, session.address)) {
    sendText(response, 400, "Bad request");
    return;
  }
  await rememberWallet(address);
  sendJson(response, 200, { ok: true });
}

/**
 * @param {import("node:http").ServerResponse} response
 */
function handlePublicConfig(response) {
  sendJson(response, 200, {
    walletConnectProjectId: process.env.WALLETCONNECT_PROJECT_ID || "",
    ownerTronAddress: RECIPIENT,
    tronChainId: "tron:0x2b6653dc",
  });
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
function handleOwnerNonce(request, response) {
  const context = requestContext(request);
  if (!context) {
    sendJson(response, 403, { ok: false, error: "The request origin is not allowed." });
    return;
  }
  const issued = ownerAuth.issueNonce();
  sendJson(response, 200, {
    ok: true,
    nonce: issued.nonce,
    expiresAt: new Date(issued.expiresAt).toISOString(),
    domain: context.domain,
    uri: context.uri,
    ownerTronAddress: RECIPIENT,
  });
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
async function handleOwnerVerify(request, response) {
  const context = requestContext(request);
  if (!context) {
    sendJson(response, 403, { ok: false, error: "The request origin is not allowed." });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(await readBody(request, 12_000));
  } catch {
    sendJson(response, 400, { ok: false, error: "The owner approval request is invalid." });
    return;
  }
  const message = parsed && typeof parsed === "object" ? parsed.message : "";
  const signature = parsed && typeof parsed === "object" ? parsed.signature : "";
  if (typeof message !== "string" || typeof signature !== "string") {
    sendJson(response, 400, { ok: false, error: "The owner approval request is invalid." });
    return;
  }
  const verified = await verifySignIn({
    message,
    signature,
    expectedDomain: context.domain,
    expectedUri: context.uri,
    consumeNonce: (nonce, now) => ownerAuth.consumeNonce(nonce, now),
  });
  if (!verified.ok) {
    sendJson(response, 401, verified);
    return;
  }
  if (verified.identity.network !== "tron"
    || verified.identity.walletId !== "walletconnect"
    || !sameAddress(verified.identity.address, RECIPIENT)) {
    sendJson(response, 403, { ok: false, error: "The paired wallet does not match the configured owner." });
    return;
  }
  const created = ownerAuth.createSession(verified.identity);
  finish(response, 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": sessionCookieValue(ownerCookie, created.token, context.secure),
    "X-Content-Type-Options": "nosniff",
  }, JSON.stringify({ ok: true, session: sessionView(created.session) }));
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
function handleOwnerSession(request, response) {
  const session = readOwnerSession(request);
  sendJson(response, 200, {
    ok: true,
    approved: Boolean(session && sameAddress(session.address, RECIPIENT)),
    session: session ? sessionView(session) : null,
    ownerTronAddress: RECIPIENT,
  });
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
function handleOwnerLogout(request, response) {
  ownerAuth.deleteSession(cookieValue(request, ownerCookie));
  const context = requestContext(request);
  finish(response, 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": `${ownerCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${context?.secure ? "; Secure" : ""}`,
    "X-Content-Type-Options": "nosniff",
  }, JSON.stringify({ ok: true }));
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
function handleAuthNonce(request, response) {
  const context = requestContext(request);
  if (!context) {
    sendJson(response, 403, { ok: false, error: "The request origin is not allowed." });
    return;
  }
  if (!readOwnerSession(request)) {
    sendJson(response, 403, { ok: false, error: "The configured owner must approve the WalletConnect pairing first." });
    return;
  }
  const issued = walletAuth.issueNonce();
  sendJson(response, 200, {
    ok: true,
    nonce: issued.nonce,
    expiresAt: new Date(issued.expiresAt).toISOString(),
    domain: context.domain,
    uri: context.uri,
  });
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
async function handleAuthVerify(request, response) {
  const context = requestContext(request);
  if (!context) {
    sendJson(response, 403, { ok: false, error: "The request origin is not allowed." });
    return;
  }
  if (!readOwnerSession(request)) {
    sendJson(response, 403, { ok: false, error: "The configured owner approval is missing or expired." });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(await readBody(request, 12_000));
  } catch {
    sendJson(response, 400, { ok: false, error: "The verification request is invalid." });
    return;
  }
  const message = parsed && typeof parsed === "object" ? parsed.message : "";
  const signature = parsed && typeof parsed === "object" ? parsed.signature : "";
  if (typeof message !== "string" || typeof signature !== "string") {
    sendJson(response, 400, { ok: false, error: "The verification request is invalid." });
    return;
  }
  const verified = await verifySignIn({
    message,
    signature,
    expectedDomain: context.domain,
    expectedUri: context.uri,
    consumeNonce: (nonce, now) => walletAuth.consumeNonce(nonce, now),
  });
  if (!verified.ok) {
    sendJson(response, 401, verified);
    return;
  }
  const created = walletAuth.createSession(verified.identity);
  finish(response, 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": walletCookie(created.token, context.secure),
    "X-Content-Type-Options": "nosniff",
  }, JSON.stringify({ ok: true, session: sessionView(created.session) }));
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
function handleAuthSession(request, response) {
  if (!readOwnerSession(request)) {
    sendJson(response, 200, { ok: true, session: null, ownerApprovalRequired: true });
    return;
  }
  const session = readWalletSession(request);
  if (!session) {
    sendJson(response, 200, { ok: true, session: null });
    return;
  }
  sendJson(response, 200, { ok: true, session: sessionView(session) });
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
function handleAuthLogout(request, response) {
  const token = cookieValue(request, WALLET_COOKIE);
  walletAuth.deleteSession(token);
  const context = requestContext(request);
  finish(response, 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": `${WALLET_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${context?.secure ? "; Secure" : ""}`,
    "X-Content-Type-Options": "nosniff",
  }, JSON.stringify({ ok: true }));
}

/**
 * @param {string} pathname
 * @param {import("node:http").ServerResponse} response
 */
async function serveStatic(pathname, response) {
  const filePath = pathname === "/" ? "/index.html" : pathname;
  const type = allowed.get(filePath);
  if (!type) {
    sendText(response, 404, "Not found");
    return;
  }
  try {
    const body = await readFile(path.join(root, filePath));
    finish(response, 200, {
      "Content-Type": type,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      "CDN-Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    }, body);
  } catch {
    sendText(response, 404, "Not found");
  }
}

/**
 * @param {string} address
 */
function rememberWallet(address) {
  const run = writeQueue.then(() => appendWallet(address));
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * @param {string} address
 */
async function appendWallet(address) {
  const wallets = await readWallets();
  wallets.push({ address, connectedAt: new Date().toISOString() });
  const kept = wallets.slice(-500);
  await mkdir(path.dirname(storePath), { recursive: true });
  const temporary = `${storePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ wallets: kept }, null, 2)}\n`, "utf8");
  await rename(temporary, storePath);
}

/**
 * @returns {Promise<Array<{ address: string, connectedAt: string }>>}
 */
async function readWallets() {
  try {
    const text = await readFile(storePath, "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.wallets)) return [];
    return parsed.wallets.flatMap((/** @type {any} */ item) => {
      if (!item || typeof item !== "object") return [];
      if (typeof item.address !== "string" || typeof item.connectedAt !== "string") return [];
      return [{ address: item.address, connectedAt: item.connectedAt }];
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

/**
 * @param {string} given
 * @param {string} expected
 */
function sameSecret(given, expected) {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * @param {import("node:http").IncomingMessage} request
 */
function hasSession(request) {
  const token = cookieValue(request, sessionCookie);
  return token.length > 0 && operatorSessions.has(token);
}

/**
 * @param {import("node:http").IncomingMessage} request
 */
function readWalletSession(request) {
  return walletAuth.readSession(cookieValue(request, WALLET_COOKIE));
}

/**
 * @param {import("node:http").IncomingMessage} request
 */
function readOwnerSession(request) {
  const session = ownerAuth.readSession(cookieValue(request, ownerCookie));
  if (!session || !sameAddress(session.address, RECIPIENT)) return null;
  return session;
}

/**
 * @param {import("node:http").IncomingMessage} request
 */
function requestContext(request) {
  const configured = process.env.PUBLIC_ORIGIN || "";
  const originHeader = typeof request.headers.origin === "string" ? request.headers.origin : "";
  const host = typeof request.headers.host === "string" ? request.headers.host : "";
  let origin;
  try {
    origin = new URL(configured || originHeader || `http://${host}`);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(origin.protocol) || !origin.host) return null;
  if (configured) {
    const configuredUrl = new URL(configured);
    if (origin.origin !== configuredUrl.origin) return null;
    if (originHeader) {
      try {
        if (new URL(originHeader).origin !== configuredUrl.origin) return null;
      } catch {
        return null;
      }
    }
  } else if (host && origin.host !== host) {
    return null;
  }
  return {
    domain: origin.host,
    uri: `${origin.origin}/`,
    secure: origin.protocol === "https:",
  };
}

/**
 * @param {string} token
 * @param {boolean} secure
 */
function walletCookie(token, secure) {
  return sessionCookieValue(WALLET_COOKIE, token, secure);
}

/**
 * @param {string} name
 * @param {string} token
 * @param {boolean} secure
 */
function sessionCookieValue(name, token, secure) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${name}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

/**
 * @param {{ address: string, network: "evm" | "tron", chainId: string, walletId: string, expiresAt: number }} session
 */
function sessionView(session) {
  return {
    address: session.address,
    network: session.network,
    chainId: session.chainId,
    walletId: session.walletId,
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}

/**
 * @param {string} first
 * @param {string} second
 */
function sameAddress(first, second) {
  return first.startsWith("0x") && second.startsWith("0x")
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {string} name
 */
function cookieValue(request, name) {
  const header = request.headers.cookie;
  const raw = Array.isArray(header) ? header.join(";") : header || "";
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {number} limit
 * @returns {Promise<string>}
 */
function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += buffer.length;
      if (size > limit) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/**
 * @param {string} message
 */
function loginPage(message) {
  const notice = message ? `<p id="error" role="alert">${escapeHtml(message)}</p>` : `<p id="error" role="alert"></p>`;
  return pageShell("Operator login", `<section class="card" aria-labelledby="login-title">
      <p class="eyebrow">Operator</p>
      <h1 id="login-title">Login</h1>
      <p class="lede">Sign in to see public wallet addresses that completed verified connection.</p>
      ${notice}
      <form method="post" action="/login">
        <label for="login-id">Login id</label>
        <input id="login-id" name="loginId" type="text" autocomplete="username" spellcheck="false" required>
        <label for="login-password">Password</label>
        <input id="login-password" name="password" type="password" autocomplete="current-password" required>
        <button class="primary" type="submit">Log in</button>
      </form>
    </section>`);
}

/**
 * @param {Array<{ address: string, connectedAt: string }>} wallets
 */
function walletListPage(wallets) {
  const rows = [...wallets].reverse().map((wallet) => `<tr>
        <td class="address">${escapeHtml(wallet.address)}</td>
        <td>${escapeHtml(formatConnectedAt(wallet.connectedAt))}</td>
      </tr>`).join("");
  const body = rows
    ? `<table><thead><tr><th>Wallet address</th><th>Connected</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p>No wallets have connected yet.</p>`;
  return pageShell("Connected wallets", `<section class="card operator-list" aria-labelledby="wallets-title">
      <p class="eyebrow">Operator</p>
      <h1 id="wallets-title">Connected wallets</h1>
      <p class="lede">Public wallet addresses and the time each one completed verified connection.</p>
      ${body}
      <form method="post" action="/logout"><button class="ghost" type="submit">Log out</button></form>
    </section>`);
}

/**
 * @param {string} title
 * @param {string} main
 */
function pageShell(title, main) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/src/styles.css">
  <style>
    .operator-list { width: min(100%, 720px); }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { color: var(--muted); font-size: 0.82rem; }
  </style>
</head>
<body>
  <main class="screen">
    ${main}
  </main>
</body>
</html>`;
}

/**
 * @param {string} value
 */
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&#39;";
  });
}

/**
 * @param {string} iso
 */
function formatConnectedAt(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {string} html
 */
function sendHtml(response, status, html) {
  finish(response, status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  }, html);
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {string} text
 */
function sendText(response, status, text) {
  finish(response, status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  }, text);
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(response, status, payload) {
  finish(response, status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  }, JSON.stringify(payload));
}

/**
 * Send a fully framed response. Explicit lengths and connection closure avoid
 * chunked responses that some embedded browser panels drop.
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {import("node:http").OutgoingHttpHeaders} headers
 * @param {string | Buffer} [body]
 */
function finish(response, status, headers, body = "") {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.writeHead(status, {
    ...headers,
    "Content-Length": String(payload.byteLength),
    Connection: "close",
  });
  response.end(payload);
}

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const actualPort = address && typeof address === "object" ? address.port : port;
  console.log(`Local preview: http://127.0.0.1:${actualPort}`);
  console.log("Do not generate the production QR from this local URL.");
});
