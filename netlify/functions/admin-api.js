/*
 * Auth + data API for the submissions dashboard (/admin.html).
 *
 *   POST ?op=login   {password}            -> {token, expiresAt}
 *   GET  ?op=list&limit=500                -> {submissions: [...]}  (Bearer token)
 *
 * Auth: ADMIN_PASSWORD env var (required — everything 401s until it is set).
 * Tokens are HMAC-signed expiry timestamps; valid 24h; nothing stored server-side.
 */

const crypto = require("crypto");

function sign(exp) {
  return crypto.createHmac("sha256", "dcr-admin|" + process.env.ADMIN_PASSWORD)
    .update(String(exp)).digest("hex");
}

function makeToken() {
  const exp = Date.now() + 24 * 60 * 60 * 1000;
  return { token: exp + "." + sign(exp), expiresAt: exp };
}

function tokenValid(header) {
  const m = /^Bearer (\d+)\.([a-f0-9]{64})$/.exec(header || "");
  if (!m) return false;
  const exp = parseInt(m[1], 10);
  if (Date.now() > exp) return false;
  const expected = sign(exp);
  return expected.length === m[2].length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(m[2]));
}

function passwordMatches(given) {
  const want = Buffer.from(String(process.env.ADMIN_PASSWORD));
  const got = Buffer.from(String(given || ""));
  if (want.length !== got.length) {
    // burn comparable time, then fail
    crypto.timingSafeEqual(want, want);
    return false;
  }
  return crypto.timingSafeEqual(want, got);
}

exports.handler = async function (event) {
  const json = (code, obj) => ({
    statusCode: code,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(obj)
  });

  if (!process.env.ADMIN_PASSWORD) {
    return json(503, { error: "dashboard not configured (set ADMIN_PASSWORD)" });
  }

  const op = (event.queryStringParameters || {}).op || "";

  if (event.httpMethod === "POST" && op === "login") {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "bad json" }); }
    if (!passwordMatches(body.password)) {
      await new Promise(r => setTimeout(r, 800)); // slow brute force
      return json(401, { error: "wrong password" });
    }
    return json(200, makeToken());
  }

  if (event.httpMethod === "GET" && op === "list") {
    if (!tokenValid(event.headers.authorization)) return json(401, { error: "unauthorized" });
    const limit = Math.min(parseInt((event.queryStringParameters || {}).limit || "500", 10) || 500, 2000);
    try {
      const { getStore } = await import("@netlify/blobs");
      const store = getStore("submissions");
      const keys = [];
      for await (const page of store.list({ prefix: "s/", paginate: true })) {
        for (const b of page.blobs) keys.push(b.key);
      }
      keys.sort().reverse(); // ISO-stamped keys: newest first
      const recent = keys.slice(0, limit);
      const submissions = (await Promise.all(
        recent.map(k => store.get(k, { type: "json" }).catch(() => null))
      )).filter(Boolean);
      return json(200, { total: keys.length, submissions: submissions });
    } catch (err) {
      console.error("list failed", err.message);
      return json(500, { error: "could not read submissions" });
    }
  }

  return json(404, { error: "unknown op" });
};
