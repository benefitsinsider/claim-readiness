/*
 * Receives the capture-form POST and creates/updates a beehiiv subscriber with
 * the score summary and consent record as custom fields. Quiz answers are never
 * sent here — only contact details + score/tier/section totals.
 *
 * Required Netlify env vars:
 *   BEEHIIV_API_KEY  — beehiiv Settings → Integrations → API
 *   BEEHIIV_PUB_ID   — the publication id (starts with "pub_")
 *
 * The custom fields below must exist in beehiiv (Settings → Custom fields),
 * named exactly (Title Case, matching beehiiv's defaults): First Name,
 * Phone Number, SMS Consent, Readiness Score, Readiness Tier,
 * Sections Summary, Gates Closed, Consent At, Consent IP,
 * Consent Form Version.
 */

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "bad json" }) };
  }

  const email = String(body.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: "invalid email" }) };
  }

  const clip = (v, n) => String(v == null ? "" : v).slice(0, n);
  const sections = typeof body.sections === "object" && body.sections !== null
    ? Object.entries(body.sections).map(([k, v]) => `${clip(k, 20)}:${clip(v, 10)}`).join(" ")
    : "";

  const payload = {
    email: email,
    reactivate_existing: true,
    send_welcome_email: false,
    utm_source: "mydisabilitycheck",
    utm_medium: "readiness-quiz",
    custom_fields: [
      { name: "First Name", value: clip(body.name, 60) },
      { name: "Phone Number", value: clip(body.phone, 25) },
      { name: "SMS Consent", value: body.smsConsent ? "yes" : "no" },
      { name: "Readiness Score", value: clip(body.score, 5) },
      { name: "Readiness Tier", value: clip(body.tierName, 40) },
      { name: "Sections Summary", value: clip(sections, 250) },
      { name: "Gates Closed", value: clip(body.gatesClosed, 100) },
      { name: "Consent At", value: clip(body.consentAt, 30) },
      { name: "Consent IP", value: clip(event.headers["x-nf-client-connection-ip"], 45) },
      { name: "Consent Form Version", value: clip(body.formVersion, 20) }
    ]
  };

  try {
    const res = await fetch(
      `https://api.beehiiv.com/v2/publications/${process.env.BEEHIIV_PUB_ID}/subscriptions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.BEEHIIV_API_KEY}`
        },
        body: JSON.stringify(payload)
      }
    );
    if (!res.ok) {
      const detail = await res.text();
      console.error("beehiiv error", res.status, detail.slice(0, 500));
      return { statusCode: 502, body: JSON.stringify({ error: "subscription failed" }) };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error("beehiiv request failed", err.message);
    return { statusCode: 502, body: JSON.stringify({ error: "subscription failed" }) };
  }
};
