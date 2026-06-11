/*
 * Receives the capture-form POST and does three independent jobs:
 *   1. Creates/updates a beehiiv subscriber (marketing stream: Daily 3, nurture)
 *      with the score summary and consent record as custom fields. beehiiv is
 *      the ONLY identified datastore.
 *   2. Sends the branded Readiness Report email instantly via Resend
 *      (transactional stream) — see report-email.js for the template.
 *   3. Writes an ANONYMOUS stats record (score/tier/sections/stage + hour
 *      bucket — deliberately NO name, email, phone, or IP) to Netlify Blobs
 *      store "stats" for the aggregate dashboard at /stats.html.
 * Any job failing does not block the others. Quiz answers are never sent
 * here — only contact details + score/tier/section totals.
 *
 * Required Netlify env vars:
 *   BEEHIIV_API_KEY  — beehiiv Settings → Integrations → API
 *   BEEHIIV_PUB_ID   — the publication id (starts with "pub_")
 *   RESEND_API_KEY   — resend.com API key (report email is skipped if absent)
 * Optional:
 *   REPORT_FROM            — sender, default "Kwame at Benefits Insider <reports@mydisabilitycheck.org>"
 *   REPORT_REPLY_TO        — reply-to address (e.g. hello@benefitsinsider.co)
 *   REPORT_POSTAL_ADDRESS  — mailing address for the email footer
 *
 * The custom fields below must exist in beehiiv (Settings → Custom fields),
 * named exactly (Title Case, matching beehiiv's defaults): First Name,
 * Phone Number, SMS Consent, Readiness Score, Readiness Tier,
 * Sections Summary, Gates Closed, Consent At, Consent IP,
 * Consent Form Version, Stage.
 */

const { buildReportEmail } = require("./report-email");

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
      { name: "Consent Form Version", value: clip(body.formVersion, 20) },
      { name: "Stage", value: clip(body.stage, 20) }
    ]
  };

  // Job 1: beehiiv subscriber (marketing stream)
  let subscribed = false;
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
    if (res.ok) {
      subscribed = true;
    } else {
      console.error("beehiiv error", res.status, (await res.text()).slice(0, 500));
    }
  } catch (err) {
    console.error("beehiiv request failed", err.message);
  }

  // Job 2: instant Readiness Report via Resend (transactional stream)
  let reportSent = false;
  if (process.env.RESEND_API_KEY) {
    try {
      const msg = buildReportEmail(body);
      const mail = {
        from: process.env.REPORT_FROM || "Kwame at Benefits Insider <reports@mydisabilitycheck.org>",
        to: [email],
        subject: msg.subject,
        html: msg.html
      };
      if (process.env.REPORT_REPLY_TO) mail.reply_to = process.env.REPORT_REPLY_TO;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`
        },
        body: JSON.stringify(mail)
      });
      if (res.ok) {
        reportSent = true;
      } else {
        console.error("resend error", res.status, (await res.text()).slice(0, 500));
      }
    } catch (err) {
      console.error("resend request failed", err.message);
    }
  }

  // Job 3: anonymous stats record — NO identifiers, hour-bucketed timestamp
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("stats");
    const hour = new Date();
    hour.setMinutes(0, 0, 0);
    const bucket = hour.toISOString();
    const key = "d/" + bucket + "-" + Math.random().toString(36).slice(2, 10);
    await store.setJSON(key, {
      at: bucket,
      score: parseInt(body.score, 10) || 0,
      tierId: clip(body.tierId, 20),
      sections: sections,
      gatesClosed: clip(body.gatesClosed, 100),
      stage: clip(body.stage, 20)
    });
  } catch (err) {
    console.error("stats write failed", err.message);
  }

  if (!subscribed && !reportSent) {
    return { statusCode: 502, body: JSON.stringify({ error: "delivery failed" }) };
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, subscribed: subscribed, reportSent: reportSent }) };
};
