import { createServer } from "node:http";
import { timingSafeEqual, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isValidTronAddress } from "../src/logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4173);
const storePath = path.join(root, "data", "connected-wallets.json");
const operatorId = process.env.OPERATOR_ID || "";
const operatorPassword = process.env.OPERATOR_PASSWORD || "";
const sessionCookie = "operator_session";
/** @type {Set<string>} */
const sessions = new Set();
let writeQueue = Promise.resolve();

const allowed = new Map([
  ["/index.html", "text/html; charset=utf-8"],
  ["/src/app.js", "text/javascript; charset=utf-8"],
  ["/src/logic.mjs", "text/javascript; charset=utf-8"],
  ["/src/styles.css", "text/css; charset=utf-8"],
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
    await serveStatic(url.pathname, response);
  } catch {
    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    }
    if (!response.writableEnded) response.end("Server error");
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
    sessions.add(token);
    response.writeHead(303, {
      Location: "/login",
      "Set-Cookie": `${sessionCookie}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`,
      "Cache-Control": "no-store",
    });
    response.end();
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
  if (token) sessions.delete(token);
  response.writeHead(303, {
    Location: "/login",
    "Set-Cookie": `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    "Cache-Control": "no-store",
  });
  response.end();
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
async function handleWalletConnection(request, response) {
  const body = await readBody(request, 2048);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendText(response, 400, "Bad request");
    return;
  }
  const address = parsed && typeof parsed === "object" ? parsed.address : "";
  if (typeof address !== "string" || !(await isValidTronAddress(address))) {
    sendText(response, 400, "Bad request");
    return;
  }
  await rememberWallet(address);
  sendJson(response, 200, { ok: true });
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
    response.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      "CDN-Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
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
  return token.length > 0 && sessions.has(token);
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
      <p class="lede">Sign in to see public TRON addresses that finished Connect wallet.</p>
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
    ? `<table><thead><tr><th>TRON address</th><th>Connected</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p>No wallets have connected yet.</p>`;
  return pageShell("Connected wallets", `<section class="card operator-list" aria-labelledby="wallets-title">
      <p class="eyebrow">Operator</p>
      <h1 id="wallets-title">Connected wallets</h1>
      <p class="lede">Public TRON addresses and the time each one finished Connect wallet.</p>
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
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(html);
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {string} text
 */
function sendText(response, status, text) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(text);
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

server.listen(port, "127.0.0.1", () => {
  console.log(`Local preview: http://127.0.0.1:${port}`);
  console.log("Do not generate the production QR from this local URL.");
});
