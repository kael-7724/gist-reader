import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import app from "./index.js";
import adminPage from "./self-host-admin-page.mjs";
import loginPage from "./self-host-login-page.mjs";

// The site owner signs in with ADMIN_USER / ADMIN_PASSWORD and keeps the original library.
// GIST_PASSWORD is a long server-side secret that signs sessions; it is never typed in.
function adminName(env) {
  return (typeof env.ADMIN_USER === "string" && env.ADMIN_USER.trim() ? env.ADMIN_USER : "gist").trim().toLowerCase();
}
function adminPassword(env) {
  return typeof env.ADMIN_PASSWORD === "string" && env.ADMIN_PASSWORD ? env.ADMIN_PASSWORD : env.GIST_PASSWORD;
}
const adminOwnerId = "gist-selfhost-owner";
const sessionCookie = "gist_session";
// Remember a signed-in device for one year. Changing a password signs that account out everywhere.
const sessionMaxAge = 60 * 60 * 24 * 365;
const usernamePattern = /^[a-z0-9_-]{2,32}$/;
const ownedTables = [
  "article_translations", "word_ai_enrichments", "saved_words", "saved_sentences",
  "articles", "ai_connections", "maimemo_connections", "baidu_translation_connections", "reading_daily",
];

function safeEqual(a, b) {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

function hashPassword(salt, password) {
  return createHash("sha256").update(`${salt}:${password}`).digest("base64url");
}

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return [...randomBytes(20)].map((byte) => alphabet[byte % alphabet.length]).join("");
}

function sessionToken(env, username, secret) {
  const mac = createHmac("sha256", env.GIST_PASSWORD).update(`gist-session-v2\n${username}\n${secret}`).digest("base64url");
  return `v2.${username}.${mac}`;
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

async function findUser(env, username) {
  if (!usernamePattern.test(username) || username === adminName(env)) return null;
  return env.DB.prepare("SELECT username, owner_id AS ownerId, password_salt AS salt, password_hash AS hash FROM self_host_users WHERE username = ?")
    .bind(username).first();
}

// Once the owner changes their password on the site, it is kept (salted and hashed) in the database
// and replaces ADMIN_PASSWORD. Until then ADMIN_PASSWORD is the password.
async function adminCredential(env) {
  const row = await env.DB.prepare("SELECT value FROM self_host_settings WHERE key = 'admin_password'").first().catch(() => null);
  const [salt, hash] = typeof row?.value === "string" ? row.value.split(":") : [];
  return salt && hash ? { salt, hash } : null;
}

async function adminAccount(env) {
  const credential = await adminCredential(env);
  return { username: adminName(env), ownerId: adminOwnerId, isAdmin: true, secret: credential ? credential.hash : adminPassword(env) };
}

function userAccount(row) {
  return { username: row.username, ownerId: row.ownerId, isAdmin: false, secret: row.hash };
}

async function accountFromSession(request, env) {
  const value = readCookie(request, sessionCookie);
  if (!value) return null;
  const match = /^v2\.([a-z0-9_-]{2,32})\.[A-Za-z0-9_-]+$/.exec(value);
  if (!match) return null;
  const account = match[1] === adminName(env) ? await adminAccount(env) : await findUser(env, match[1]).then((row) => row && userAccount(row));
  if (!account) return null;
  return safeEqual(Buffer.from(value), Buffer.from(sessionToken(env, account.username, account.secret))) ? account : null;
}

async function accountFromBasic(request, env) {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const split = decoded.indexOf(":");
  if (split < 1) return null;
  return accountFromPassword(env, decoded.slice(0, split), decoded.slice(split + 1));
}

async function accountFromPassword(env, rawUsername, password) {
  const username = String(rawUsername ?? "").trim().toLowerCase();
  if (!username || typeof password !== "string" || !password) return null;
  if (username === adminName(env)) {
    const credential = await adminCredential(env);
    const valid = credential
      ? safeEqual(Buffer.from(hashPassword(credential.salt, password)), Buffer.from(credential.hash))
      : safeEqual(Buffer.from(password), Buffer.from(adminPassword(env)));
    return valid ? adminAccount(env) : null;
  }
  const row = await findUser(env, username);
  if (!row) return null;
  return safeEqual(Buffer.from(hashPassword(row.salt, password)), Buffer.from(row.hash)) ? userAccount(row) : null;
}

const FAILURE_LIMIT = 10;
const FAILURE_WINDOW_MINUTES = 15;

function clientKey(request) {
  return `ip:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`;
}

async function tooManyFailures(env, request) {
  const row = await env.DB.prepare(`SELECT count FROM login_failures WHERE key = ? AND window_start > datetime('now', '-${FAILURE_WINDOW_MINUTES} minutes')`)
    .bind(clientKey(request)).first().catch(() => null);
  return Boolean(row && row.count >= FAILURE_LIMIT);
}

async function recordFailure(env, request) {
  await env.DB.prepare(`INSERT INTO login_failures (key, count, window_start) VALUES (?, 1, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start > datetime('now', '-${FAILURE_WINDOW_MINUTES} minutes') THEN count + 1 ELSE 1 END,
    window_start = CASE WHEN window_start > datetime('now', '-${FAILURE_WINDOW_MINUTES} minutes') THEN window_start ELSE datetime('now') END`)
    .bind(clientKey(request)).run().catch(() => undefined);
}

async function clearFailures(env, request) {
  await env.DB.prepare("DELETE FROM login_failures WHERE key = ?").bind(clientKey(request)).run().catch(() => undefined);
}

function privateResponse(body, status, headers) {
  const result = new Headers(headers);
  result.set("Cache-Control", "private, no-store");
  return new Response(body, { status, headers: result });
}

function jsonResponse(body, status = 200) {
  return privateResponse(JSON.stringify(body), status, { "Content-Type": "application/json; charset=utf-8" });
}

function ownerHeaders(headers, account) {
  for (const name of [...headers.keys()]) {
    if (name.startsWith("oai-authenticated-")) headers.delete(name);
  }
  headers.set("oai-authenticated-user-id", account.ownerId);
  headers.set("oai-authenticated-user-email", `${account.username}@gist.local`);
  return headers;
}

// Import-only MCP connector for scheduled assistants such as ChatGPT.
// Each secret path grants exactly one ability: adding an article to that account's library.
// It cannot read, change or delete anything else.
const connectorPath = /^\/connector\/([A-Za-z0-9_-]{20,200})\/mcp\/?$/;
const mcpVersions = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

async function connectorAccount(env, token) {
  if (typeof env.IMPORT_TOKEN === "string" && env.IMPORT_TOKEN.length >= 32 && safeEqual(Buffer.from(token), Buffer.from(env.IMPORT_TOKEN))) {
    return adminAccount(env);
  }
  const row = await env.DB.prepare("SELECT username, owner_id AS ownerId, password_hash AS hash FROM self_host_users WHERE import_token = ?").bind(token).first();
  return row ? userAccount(row) : null;
}

async function handleConnector(request, env, context, url, token) {
  const account = await connectorAccount(env, token);
  if (!account) return privateResponse("Not found", 404);
  if (request.method !== "POST") {
    return privateResponse("Method not allowed", 405, { Allow: "POST" });
  }
  const rpc = await request.json().catch(() => null);
  if (!rpc || typeof rpc !== "object" || Array.isArray(rpc)) {
    return jsonResponse({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  const reply = (result) => jsonResponse({ jsonrpc: "2.0", id: rpc.id ?? null, result });
  if (rpc.id === undefined || rpc.id === null) return privateResponse(null, 202);

  switch (rpc.method) {
    case "initialize": {
      const requested = rpc.params?.protocolVersion;
      return reply({
        protocolVersion: mcpVersions.includes(requested) ? requested : mcpVersions[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "gist-daily-import", title: "Gist 每日文章导入", version: "1.1.0" },
        instructions: (account.ownerId === adminOwnerId
          ? "Use import_daily_article to add 5 different English articles a day to Gist's shared daily list, one call per article; readers then choose which ones to read. Stop when the result is list_full_today. "
          : "Use import_daily_article to save one English article per day to Gist. ") + "title = the original headline exactly as published; content = the article body only (no captions, photo credits, related links, newsletter prompts or ads), copied verbatim with a blank line between paragraphs and subheadings on their own lines; publisher = the publication name; publishedDate = the original publication date (YYYY-MM-DD); sourceUrl = the canonical https link without tracking parameters. If the result is already_imported_today, stop. If it is duplicate_article, choose a different article.",
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
    case "tools/call": {
      const headers = ownerHeaders(new Headers({ "Content-Type": "application/json", Origin: url.origin }), account);
      const inner = new Request(new URL("/mcp", url.origin), { method: "POST", headers, body: JSON.stringify(rpc) });
      const response = await app.fetch(inner, env, context);
      return privateResponse(response.body, response.status, { "Content-Type": "application/json" });
    }
    default:
      return jsonResponse({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "Method not found" } });
  }
}

async function newCredentials(env, password = generatePassword()) {
  const salt = randomBytes(16).toString("base64url");
  return { password, salt, hash: hashPassword(salt, password) };
}

async function handleAdminApi(request, env) {
  const body = await request.json().catch(() => null);
  const action = body?.action;
  const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";

  if (action === "list") {
    const { results } = await env.DB.prepare("SELECT username, created_at AS createdAt FROM self_host_users ORDER BY created_at, username").all();
    return jsonResponse({ users: results });
  }
  if (!usernamePattern.test(username)) return jsonResponse({ error: "用户名只能用小写字母、数字、- 和 _，2–32 位" }, 400);
  if (username === adminName(env)) return jsonResponse({ error: "这个用户名是你自己的，不能使用" }, 400);

  if (action === "create") {
    // New accounts start with the username as the password; the friend changes it in Settings after signing in.
    const { password, salt, hash } = await newCredentials(env, username);
    const importToken = randomBytes(32).toString("base64url");
    const ownerId = `gist-user:${randomUUID()}`;
    const inserted = await env.DB.prepare(
      "INSERT INTO self_host_users (username, owner_id, password_salt, password_hash, import_token) VALUES (?, ?, ?, ?, ?) ON CONFLICT(username) DO NOTHING RETURNING username",
    ).bind(username, ownerId, salt, hash, importToken).first();
    if (!inserted) return jsonResponse({ error: "这个用户名已经有人用了" }, 409);
    return jsonResponse({ username, password, importToken }, 201);
  }
  if (action === "reset") {
    const { password, salt, hash } = await newCredentials(env);
    const updated = await env.DB.prepare("UPDATE self_host_users SET password_salt = ?, password_hash = ? WHERE username = ? RETURNING import_token AS importToken")
      .bind(salt, hash, username).first();
    if (!updated) return jsonResponse({ error: "没有找到这个账号" }, 404);
    return jsonResponse({ username, password, importToken: updated.importToken });
  }
  if (action === "delete") {
    const row = await env.DB.prepare("SELECT owner_id AS ownerId FROM self_host_users WHERE username = ?").bind(username).first();
    if (!row) return jsonResponse({ error: "没有找到这个账号" }, 404);
    await env.DB.batch([
      ...ownedTables.map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE owner_id = ?`).bind(row.ownerId)),
      env.DB.prepare("DELETE FROM self_host_users WHERE username = ?").bind(username),
    ]);
    return jsonResponse({ ok: true });
  }
  return jsonResponse({ error: "未知操作" }, 400);
}

async function handlePasswordChange(request, env, account, url) {
  if (await tooManyFailures(env, request)) return jsonResponse({ error: "尝试次数太多，请 15 分钟后再试" }, 429);
  const body = await request.json().catch(() => null);
  const current = typeof body?.current === "string" ? body.current : "";
  const next = typeof body?.next === "string" ? body.next : "";
  if (!await accountFromPassword(env, account.username, current)) {
    await recordFailure(env, request);
    return jsonResponse({ error: "当前密码不正确" }, 403);
  }
  if (next.length < 8 || next.length > 128) return jsonResponse({ error: "新密码至少 8 位" }, 400);
  if (next === current) return jsonResponse({ error: "新密码和当前密码一样" }, 400);
  const salt = randomBytes(16).toString("base64url");
  const hash = hashPassword(salt, next);
  if (account.isAdmin) {
    await env.DB.prepare("INSERT INTO self_host_settings (key, value) VALUES ('admin_password', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(`${salt}:${hash}`).run();
  } else {
    await env.DB.prepare("UPDATE self_host_users SET password_salt = ?, password_hash = ? WHERE username = ?").bind(salt, hash, account.username).run();
  }
  await clearFailures(env, request);
  // Other devices are signed out (their sessions were signed with the old password); this one stays signed in.
  const response = jsonResponse({ ok: true });
  response.headers.append("Set-Cookie", sessionCookieValue(env, { ...account, secret: hash }, url));
  return response;
}

function sessionCookieValue(env, account, url) {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${sessionCookie}=${sessionToken(env, account.username, account.secret)}; Path=/; Max-Age=${sessionMaxAge}; HttpOnly; SameSite=Lax${secure}`;
}

function withSession(response, env, account, url, viaBasic) {
  if (viaBasic) response.headers.append("Set-Cookie", sessionCookieValue(env, account, url));
  return response;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function safeNext(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value === "/login" || value.startsWith("/login?") || value.startsWith("/logout")) return "/";
  return value.slice(0, 500);
}

function themeOf(request) {
  return /(?:^|;\s*)gist_theme=light(?:;|$)/.test(request.headers.get("cookie") || "") ? "light" : "dark";
}

function loginResponse({ next = "/", username = "", error = "", theme = "dark" }, status = 200) {
  const html = loginPage
    .replace("{{THEME}}", theme === "light" ? "light" : "dark")
    .replace("{{NEXT}}", escapeHtml(next))
    .replace("{{USERNAME}}", escapeHtml(username))
    .replace("{{ERROR}}", escapeHtml(error))
    .replace("{{USER_FOCUS}}", username ? "" : "autofocus")
    .replace("{{PASS_FOCUS}}", username ? "autofocus" : "");
  return privateResponse(html, status, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  });
}

function redirect(location, cookie) {
  const headers = new Headers({ Location: location, "Cache-Control": "private, no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function isCrossSiteWrite(request, url) {
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return (origin && origin !== url.origin) || fetchSite === "cross-site" || fetchSite === "same-site";
}

function wantsPage(request) {
  if (!["GET", "HEAD"].includes(request.method)) return false;
  return request.headers.get("Sec-Fetch-Mode") === "navigate" || (request.headers.get("Accept") ?? "").includes("text/html");
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.protocol === "http:" && !loopback) {
      url.protocol = "https:";
      return Response.redirect(url, 308);
    }
    if (typeof env.GIST_PASSWORD !== "string" || env.GIST_PASSWORD.length < 24) {
      return privateResponse("Gist is waiting for its server password to be configured.", 503);
    }
    const connector = connectorPath.exec(url.pathname);
    if (connector) return handleConnector(request, env, context, url, connector[1]);

    let account = await accountFromSession(request, env);
    const viaBasic = !account;
    if (!account && request.headers.has("Authorization")) {
      if (await tooManyFailures(env, request)) return jsonResponse({ error: "登录失败次数太多，请 15 分钟后再试" }, 429);
      account = await accountFromBasic(request, env);
      if (!account) await recordFailure(env, request);
    }

    if (url.pathname === "/logout") {
      const secure = url.protocol === "https:" ? "; Secure" : "";
      return redirect("/login", `${sessionCookie}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
    }
    if (url.pathname === "/login") {
      if (request.method === "POST") {
        if (isCrossSiteWrite(request, url)) return privateResponse("Cross-origin writes are not allowed.", 403);
        const form = await request.formData().catch(() => null);
        const next = safeNext(form?.get("next"));
        const username = String(form?.get("username") ?? "").trim().slice(0, 64);
        if (await tooManyFailures(env, request)) return loginResponse({ next, username, error: "登录失败次数太多，请 15 分钟后再试", theme: themeOf(request) }, 429);
        const signedIn = await accountFromPassword(env, username, form?.get("password"));
        if (!signedIn) {
          await recordFailure(env, request);
          await new Promise((resolve) => setTimeout(resolve, 700));
          return loginResponse({ next, username, error: "用户名或密码不正确", theme: themeOf(request) }, 401);
        }
        await clearFailures(env, request);
        return redirect(next, sessionCookieValue(env, signedIn, url));
      }
      if (account) return redirect(safeNext(url.searchParams.get("next")));
      return loginResponse({ next: safeNext(url.searchParams.get("next")), theme: themeOf(request) });
    }

    if (!account) {
      if (wantsPage(request)) return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
      return jsonResponse({ error: "请先登录" }, 401);
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && isCrossSiteWrite(request, url)) {
      return privateResponse("Cross-origin writes are not allowed.", 403);
    }

    if (url.pathname === "/account" && request.method === "GET") {
      return withSession(jsonResponse({ username: account.username, isAdmin: account.isAdmin }), env, account, url, viaBasic);
    }
    if (url.pathname === "/account/password" && request.method === "POST") {
      return handlePasswordChange(request, env, account, url);
    }

    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      if (!account.isAdmin) return privateResponse("Not found", 404);
      if (url.pathname === "/admin/api" && request.method === "POST") {
        return withSession(await handleAdminApi(request, env), env, account, url, viaBasic);
      }
      if (url.pathname === "/admin" && request.method === "GET") {
        return withSession(privateResponse(adminPage, 200, { "Content-Type": "text/html; charset=utf-8" }), env, account, url, viaBasic);
      }
      return privateResponse("Not found", 404);
    }

    const headers = new Headers(request.headers);
    headers.delete("Authorization");
    const otherCookies = (request.headers.get("Cookie") ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part && !part.startsWith(`${sessionCookie}=`));
    if (otherCookies.length) headers.set("Cookie", otherCookies.join("; "));
    else headers.delete("Cookie");
    ownerHeaders(headers, account);

    const response = await app.fetch(new Request(request, { headers }), env, context);
    const result = new Response(response.body, response);
    result.headers.set("Cache-Control", "private, no-store");
    return withSession(result, env, account, url, viaBasic);
  },
};
