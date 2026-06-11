/*
 * Aggregate stats API for /stats.html. Reads the ANONYMOUS records written by
 * subscribe.js (store "stats" — score/tier/sections/stage, no identifiers) and
 * returns computed aggregates only.
 *
 *   POST ?op=login {password}  -> {token, expiresAt}     (ADMIN_PASSWORD env var)
 *   GET  ?op=aggregate         -> {...aggregates}        (Bearer token)
 */

const crypto = require("crypto");

function sign(exp) {
  return crypto.createHmac("sha256", "dcr-stats|" + process.env.ADMIN_PASSWORD)
    .update(String(exp)).digest("hex");
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
  if (want.length !== got.length) { crypto.timingSafeEqual(want, want); return false; }
  return crypto.timingSafeEqual(want, got);
}

const SECTION_MAX = { program: 10, work: 15, severity: 15, medical: 20, function: 20, vocational: 15, risk: 5 };

exports.handler = async function (event) {
  const json = (code, obj) => ({
    statusCode: code,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(obj)
  });

  if (!process.env.ADMIN_PASSWORD) {
    return json(503, { error: "stats not configured (set ADMIN_PASSWORD)" });
  }

  const op = (event.queryStringParameters || {}).op || "";

  if (event.httpMethod === "POST" && op === "login") {
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "bad json" }); }
    if (!passwordMatches(body.password)) {
      await new Promise(r => setTimeout(r, 800));
      return json(401, { error: "wrong password" });
    }
    const exp = Date.now() + 24 * 60 * 60 * 1000;
    return json(200, { token: exp + "." + sign(exp), expiresAt: exp });
  }

  if (event.httpMethod === "GET" && op === "aggregate") {
    if (!tokenValid(event.headers.authorization)) return json(401, { error: "unauthorized" });
    try {
      const { getStore } = await import("@netlify/blobs");
      const store = getStore("stats");
      const keys = [];
      for await (const page of store.list({ prefix: "d/", paginate: true })) {
        for (const b of page.blobs) keys.push(b.key);
      }
      const rows = (await Promise.all(
        keys.map(k => store.get(k, { type: "json" }).catch(() => null))
      )).filter(Boolean);

      const agg = {
        total: rows.length,
        avgScore: null,
        tiers: {},        // tierId -> count
        stages: {},       // stage -> count
        gates: {},        // gate id -> closed count
        sections: {},     // section id -> {sumPts, sumPct, n}
        daily: {},        // YYYY-MM-DD -> count (last 30 days)
        scoreBands: { "0-19": 0, "20-39": 0, "40-59": 0, "60-79": 0, "80-100": 0 }
      };
      let scoreSum = 0;
      const cutoff = Date.now() - 30 * 86400000;

      rows.forEach(r => {
        scoreSum += r.score || 0;
        agg.tiers[r.tierId || "unknown"] = (agg.tiers[r.tierId || "unknown"] || 0) + 1;
        agg.stages[r.stage || "unknown"] = (agg.stages[r.stage || "unknown"] || 0) + 1;
        String(r.gatesClosed || "").split(",").map(s => s.trim()).filter(Boolean)
          .forEach(g => { agg.gates[g] = (agg.gates[g] || 0) + 1; });
        const s = r.score || 0;
        const band = s >= 80 ? "80-100" : s >= 60 ? "60-79" : s >= 40 ? "40-59" : s >= 20 ? "20-39" : "0-19";
        agg.scoreBands[band]++;
        const ts = Date.parse(r.at);
        if (ts >= cutoff) {
          const day = r.at.slice(0, 10);
          agg.daily[day] = (agg.daily[day] || 0) + 1;
        }
        String(r.sections || "").split(" ").filter(Boolean).forEach(pair => {
          const m = /^(\w+):(\d+)\/(\d+)$/.exec(pair);
          if (!m) return;
          const id = m[1], pts = parseInt(m[2], 10), max = parseInt(m[3], 10) || SECTION_MAX[id] || 1;
          if (!agg.sections[id]) agg.sections[id] = { sumPts: 0, sumPct: 0, n: 0, max: max };
          agg.sections[id].sumPts += pts;
          agg.sections[id].sumPct += pts / max;
          agg.sections[id].n++;
        });
      });
      if (rows.length) agg.avgScore = Math.round((scoreSum / rows.length) * 10) / 10;
      Object.values(agg.sections).forEach(s => {
        s.avgPts = Math.round((s.sumPts / s.n) * 10) / 10;
        s.avgPct = Math.round((s.sumPct / s.n) * 100);
        delete s.sumPts; delete s.sumPct;
      });
      return json(200, agg);
    } catch (err) {
      console.error("aggregate failed", err.message);
      return json(500, { error: "could not read stats" });
    }
  }

  return json(404, { error: "unknown op" });
};
