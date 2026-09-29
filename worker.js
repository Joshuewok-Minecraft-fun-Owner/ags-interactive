export { Room } from "./room.js";
// Login for AGS Interactive Series (Cloudflare Worker): Discord + username/password.
// Secrets: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SESSION_SECRET
// Secrets also: HOST_KEY (your host page password), GODOT_KEY (for the Godot script)
// Bindings: USERS (KV), ROOM (Durable Object), ASSETS (static site)

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function sign(payload, secret) {
  const body = b64(enc.encode(JSON.stringify(payload)));
  const sig = b64(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  return `${body}.${sig}`;
}
async function verify(token, secret) {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig) return null;
  if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64(sig), enc.encode(body)))) return null;
  const data = JSON.parse(new TextDecoder().decode(unb64(body)));
  return data.exp > Date.now() ? data : null;
}
function cookie(req, name) {
  const m = (req.headers.get("Cookie") || "").match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? m[1] : null;
}
const setCookie = (name, val, maxAge) => `${name}=${val}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function hashPw(password, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256));
}
async function sessionHeaders(env, id, name, extra = []) {
  const token = await sign({ id, name, exp: Date.now() + 30 * 864e5 }, env.SESSION_SECRET);
  const h = new Headers();
  h.append("Set-Cookie", setCookie("ags_session", token, 30 * 86400));
  extra.forEach((c) => h.append("Set-Cookie", c));
  return h;
}
const fail = (msg, status = 400) => Response.json({ error: msg }, { status });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    // ---- API: forwarded to the Durable Object with identity set server-side ----
    if (path.startsWith("/api/")) {
      const h = new Headers(req.headers);
      for (const k of [...h.keys()]) if (k.startsWith("x-")) h.delete(k); // never trust client-sent identity
      const sess = await verify(cookie(req, "ags_session"), env.SESSION_SECRET);
      if (sess) { h.set("X-Uid", sess.id); h.set("X-Name", encodeURIComponent(sess.name)); }
      const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
      let role = "";
      if (bearer && env.HOST_KEY && bearer === env.HOST_KEY) role = "host";
      else if (bearer && env.GODOT_KEY && bearer === env.GODOT_KEY) role = "godot";
      h.set("X-Role", role);
      return env.ROOM.get(env.ROOM.idFromName("main")).fetch(new Request(req, { headers: h }));
    }

    // ---- Username / password ----
    if (path === "/auth/register" && req.method === "POST") {
      const { username = "", password = "" } = await req.json().catch(() => ({}));
      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return fail("Username must be 3-20 letters, numbers or underscores.");
      if (password.length < 8 || password.length > 128) return fail("Password must be 8-128 characters.");
      const key = "u:" + username.toLowerCase();
      if (await env.USERS.get(key)) return fail("That username is taken.", 409);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      await env.USERS.put(key, JSON.stringify({ name: username, salt: b64(salt), hash: await hashPw(password, salt) }));
      return Response.json({ ok: true }, { headers: await sessionHeaders(env, "pw:" + username.toLowerCase(), username) });
    }

    if (path === "/auth/login" && req.method === "POST") {
      const { username = "", password = "" } = await req.json().catch(() => ({}));
      const rec = JSON.parse((await env.USERS.get("u:" + username.toLowerCase())) || "null");
      const bad = fail("Wrong username or password.", 401);
      if (!rec) return bad;
      if ((await hashPw(password, unb64(rec.salt))) !== rec.hash) return bad;
      return Response.json({ ok: true }, { headers: await sessionHeaders(env, "pw:" + username.toLowerCase(), rec.name) });
    }

    // ---- Discord ----
    const origin = env.PUBLIC_URL || url.origin; // PUBLIC_URL is set by scripts/dev.sh in Codespaces
    const redirectUri = `${origin}/auth/discord/callback`;
    if (path === "/auth/discord") {
      const state = crypto.randomUUID();
      const q = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, redirect_uri: redirectUri, response_type: "code", scope: "identify", state });
      return new Response(null, {
        status: 302,
        headers: { Location: `https://discord.com/oauth2/authorize?${q}`, "Set-Cookie": setCookie("ags_state", state, 600) },
      });
    }

    if (path === "/auth/discord/callback") {
      const code = url.searchParams.get("code");
      if (!code || url.searchParams.get("state") !== cookie(req, "ags_state")) return new Response("Login failed. Please try again.", { status: 400 });
      const t = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      });
      if (!t.ok) return new Response("Discord login failed.", { status: 502 });
      const { access_token } = await t.json();
      const u = await (await fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${access_token}` } })).json();
      if (!u.id) return new Response("Could not read Discord profile.", { status: 502 });
      const h = await sessionHeaders(env, "discord:" + u.id, u.global_name || u.username, [setCookie("ags_state", "", 0)]);
      h.set("Location", "/#live");
      return new Response(null, { status: 302, headers: h });
    }

    // ---- Session ----
    if (path === "/auth/me") {
      const s = await verify(cookie(req, "ags_session"), env.SESSION_SECRET);
      return s ? Response.json({ id: s.id, name: s.name }) : new Response("Not signed in", { status: 401 });
    }
    if (path === "/auth/logout" && req.method === "POST") {
      return new Response(null, { status: 204, headers: { "Set-Cookie": setCookie("ags_session", "", 0) } });
    }

    return env.ASSETS.fetch(req);
  },
};

// In your future vote endpoint:
//   const s = await verify(cookie(req, "ags_session"), env.SESSION_SECRET);
//   if (!s) return new Response("Login required", { status: 401 });
//   // s.id is the one-vote-per-account key
