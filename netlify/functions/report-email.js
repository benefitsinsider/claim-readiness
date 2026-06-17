/*
 * Builds the branded HTML Readiness Report email. Pure function — no I/O.
 * Email-client-safe: table layout, inline styles, system/Georgia fonts,
 * 600px max width. Brand: navy #1A2B4A, gold #D4A24C, cream #FFF8EB.
 */

const TIERS = {
  strong: {
    name: "Strong Evidence Foundation",
    color: "#2E7D5B",
    summary: "Based on your answers, your evidence and preparation appear well-organized today. You appear to meet the basic rules, your medical record looks consistent, and you can describe your work limits in concrete terms.",
    next: "People at this stage often pull their earnings record at ssa.gov/myaccount, keep copies of what they've organized, and decide whether to file on their own or talk with a qualified representative first. Filing is free at ssa.gov."
  },
  promising: {
    name: "Promising but Incomplete",
    color: "#D4A24C",
    summary: "Based on your answers, your situation may involve serious limitations, but the documentation appears incomplete. Specific gaps could slow the process or make it harder for SSA to understand your limitations.",
    next: "People at this stage often focus on the section that cost the most points — for most, that's medical documentation or the work-limits story — and re-check after 30 days of building the record."
  },
  building: {
    name: "Building Your Case",
    color: "#C58B3A",
    summary: "Based on your answers, the medical condition may be real, but the documented case is not yet complete enough to stand on its own during review.",
    next: "People at this stage often focus on establishing consistent medical care, starting a symptom journal today, and re-checking every few months as the record grows."
  },
  "major-gaps": {
    name: "Major Gaps to Address",
    color: "#9B1B30",
    summary: "Based on your answers — or because one of the four basic rules appears not met — the case as it stands today faces significant barriers.",
    next: "Situations in this tier usually involve facts a self-screen cannot evaluate. Many people here consider a conversation with a qualified attorney or eligible non-attorney representative — most offer free initial consultations — before making any filing decision."
  }
};

const SECTION_TITLES = {
  program: "Your Program Path",
  work: "Your Work & Earnings",
  severity: "Your Condition",
  medical: "Your Medical Records",
  function: "Your Work Limits Story",
  vocational: "Your Age, Education & Past Work",
  risk: "Application Risk Factors"
};

const RULE_NAMES = {
  "gate-program": "A Program That Fits You",
  "gate-sga": "The Monthly Earnings Limit",
  "gate-duration": "The 12-Month Rule",
  "gate-medical": "Medical Evidence"
};

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function sectionRows(sections) {
  return Object.keys(SECTION_TITLES).map(id => {
    const raw = sections && sections[id] ? String(sections[id]) : "";
    const m = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
    const pts = m ? parseInt(m[1], 10) : 0;
    const max = m ? parseInt(m[2], 10) : 0;
    const pct = max ? Math.max(4, Math.round((pts / max) * 100)) : 0;
    return `
      <tr>
        <td style="padding:10px 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#2C2C2C;">
          ${SECTION_TITLES[id]}
          <span style="float:right;font-weight:bold;color:#1A2B4A;">${escapeHtml(raw)}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:0 0 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td width="${pct}%" style="background:#1A2B4A;height:10px;border-radius:5px 0 0 5px;font-size:0;line-height:0;">&nbsp;</td>
              <td style="background:#ECE6D8;height:10px;border-radius:0 5px 5px 0;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join("");
}

function rulesBlock(gatesClosed) {
  const closed = String(gatesClosed || "").split(",").map(s => s.trim()).filter(Boolean);
  if (closed.length === 0) {
    return `<p style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#2C2C2C;margin:0 0 8px;">
      <strong style="color:#2E7D5B;">All four basic rules look met</strong> based on your answers — a program that fits you,
      the monthly earnings limit, the 12-month rule, and medical evidence.</p>`;
  }
  const items = closed.map(id => RULE_NAMES[id] || id).map(n =>
    `<li style="margin:0 0 6px;"><strong style="color:#9B1B30;">${escapeHtml(n)}</strong> — appears not met based on your answers</li>`).join("");
  return `<p style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#2C2C2C;margin:0 0 8px;">
      One or more of the four basic rules appears not met — this matters more than the score itself:</p>
      <ul style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#2C2C2C;margin:0 0 8px;padding-left:22px;">${items}</ul>
      <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#6B7280;margin:0;">
      Your results page explains each one, what it means, and how it can change.</p>`;
}

const KIT_CHAPTERS = {
  program: "Chapter 1", work: "Chapter 2", severity: "Chapter 3",
  medical: "Chapter 4", function: "Chapter 5", vocational: "Chapters 6–7", risk: "Chapter 8"
};
const KIT_FIXABLE = ["program", "work", "severity", "medical", "function", "risk"];

let KIT_CFG = {};
try { KIT_CFG = (require("../../data/annual-numbers.json").kit) || {}; } catch (e) { KIT_CFG = {}; }

function kitBlock(data) {
  // URL/price come from data/annual-numbers.json (single source of truth, shared
  // with the results page). Env vars still override if ever set.
  const url = process.env.KIT_URL || KIT_CFG.url;
  if (!url) return "";
  const price = process.env.KIT_PRICE || KIT_CFG.price || "$47";

  const weak = [];
  Object.keys(data.sections || {}).forEach(id => {
    const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(data.sections[id] || ""));
    if (!m || KIT_FIXABLE.indexOf(id) === -1) return;
    const pts = parseInt(m[1], 10), max = parseInt(m[2], 10);
    if (pts < max) weak.push({ id, pts, max, ratio: pts / max, title: (SECTION_TITLES[id] || id).replace(/^Your /, "") });
  });
  weak.sort((a, b) => a.ratio - b.ratio);
  const w = weak.slice(0, 2);
  let personal;
  if (w.length === 2) {
    personal = `Your lowest areas were <strong>${w[0].title} (${w[0].pts}/${w[0].max})</strong> and <strong>${w[1].title} (${w[1].pts}/${w[1].max})</strong> — ${KIT_CHAPTERS[w[0].id]} and ${KIT_CHAPTERS[w[1].id]} of the Kit walk you through fixing exactly those, most of it in 30–90 days.`;
  } else if (w.length === 1) {
    personal = `Your lowest area was <strong>${w[0].title} (${w[0].pts}/${w[0].max})</strong> — ${KIT_CHAPTERS[w[0].id]} of the Kit walks you through fixing exactly that.`;
  } else {
    personal = "Your preparation scored well — the Kit is how people keep it organized and consistent through filing and beyond.";
  }

  return `
  <tr><td style="background:#ffffff;padding:8px 28px 20px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ECE6D8;border-top:5px solid #D4A24C;border-radius:4px;">
      <tr><td style="padding:20px 22px;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:2px;color:#D4A24C;">YOUR NEXT STEP</div>
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:bold;color:#1A2B4A;margin:6px 0 10px;">Close the gaps in this report — with the Readiness Kit</div>
        <p style="font-family:Arial,Helvetica,sans-serif;font-size:15.5px;line-height:1.6;color:#2C2C2C;margin:0 0 12px;">${personal}</p>
        <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#2C2C2C;margin:0 0 16px;">
          &#10003;&nbsp;11 plain-language chapters matched to the seven areas you were scored on<br>
          &#10003;&nbsp;The full worksheets behind your score &mdash; re-check yourself as your record grows<br>
          &#10003;&nbsp;126-page printable PDF + symptom diary, doctor guide, and SSA phone card</p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
          <td style="background:#D4A24C;border-radius:6px;text-align:center;">
            <a href="${escapeHtml(url)}" style="display:block;padding:15px 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#1A2B4A;text-decoration:none;">Get the Readiness Kit &mdash; ${escapeHtml(price)}</a>
          </td>
        </tr></table>
        <p style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.6;color:#6B7280;margin:10px 0 0;text-align:center;">
          One-time purchase &middot; Instant download &middot; An educational guide, not legal advice.<br>Applying for disability is always free at ssa.gov.</p>
      </td></tr>
    </table>
  </td></tr>`;
}

function buildReportEmail(data) {
  const tier = TIERS[data.tierId] || TIERS["major-gaps"];
  const firstName = escapeHtml((data.name || "").split(" ")[0] || "there");
  const score = escapeHtml(data.score);
  const year = new Date().getFullYear();
  const postal = process.env.REPORT_POSTAL_ADDRESS
    ? `<br>${escapeHtml(process.env.REPORT_POSTAL_ADDRESS)}` : "";

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Claim Readiness Report</title></head>
<body style="margin:0;padding:0;background:#FBF8F3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF8F3;">
<tr><td align="center" style="padding:0 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <tr><td style="background:#1A2B4A;padding:18px 28px;border-radius:0 0 0 0;">
    <span style="font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;letter-spacing:2px;color:#FFF8EB;">BENEFITS INSIDER&trade;</span>
    <span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#E8C77A;float:right;padding-top:3px;">YOUR READINESS REPORT</span>
  </td></tr>

  <tr><td align="center" style="background:#ffffff;padding:36px 28px 8px;">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:3px;color:#D4A24C;">YOUR CLAIM READINESS SCORE</div>
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:74px;font-weight:bold;color:#1A2B4A;line-height:1.1;">${score}</div>
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:2px;color:#6B7280;">OUT OF 100</div>
  </td></tr>

  <tr><td style="background:#ffffff;padding:18px 28px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ECE6D8;border-top:5px solid ${tier.color};border-radius:4px;">
      <tr><td style="padding:20px 22px;">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:bold;color:#1A2B4A;margin-bottom:10px;">${tier.name}</div>
        <p style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#2C2C2C;margin:0 0 10px;">${tier.summary}</p>
        <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#6B7280;margin:0;"><strong style="color:#1A2B4A;">What people in this tier often consider next:</strong> ${tier.next}</p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="background:#ffffff;padding:20px 28px 4px;">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:2px;color:#D4A24C;border-bottom:2px solid #D4A24C;padding-bottom:6px;">WHERE YOUR POINTS CAME FROM</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${sectionRows(data.sections)}</table>
  </td></tr>

  <tr><td style="background:#ffffff;padding:20px 28px 4px;">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:2px;color:#D4A24C;border-bottom:2px solid #D4A24C;padding-bottom:6px;margin-bottom:10px;">THE FOUR RULES THAT CAN STOP A CLAIM</div>
    <div style="padding-top:10px;">${rulesBlock(data.gatesClosed)}</div>
  </td></tr>

  <tr><td style="background:#ffffff;padding:20px 28px 8px;">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:2px;color:#D4A24C;border-bottom:2px solid #D4A24C;padding-bottom:6px;">WHAT TO DO WITH THIS REPORT</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#2C2C2C;">
      <tr><td style="padding:12px 0 0;"><strong style="color:#1A2B4A;">1. Keep it with your claim papers.</strong> Your score and breakdown are a snapshot of where things stood today.</td></tr>
      <tr><td style="padding:10px 0 0;"><strong style="color:#1A2B4A;">2. Work the weakest section first.</strong> For most people that's medical records or the day-to-day record of work limits — a symptom journal started today beats a perfect memory later.</td></tr>
      <tr><td style="padding:10px 0 0;"><strong style="color:#1A2B4A;">3. Re-check in 30 days.</strong> Your results stay saved on your device at mydisabilitycheck.org — re-check and you'll see what's moved.</td></tr>
      <tr><td style="padding:10px 0 12px;"><strong style="color:#1A2B4A;">4. Bring it to any conversation about your claim</strong> — SSA, an attorney, or a representative. It saves them time and saves you repeating yourself.</td></tr>
    </table>
  </td></tr>

  ${kitBlock(data)}

  <tr><td style="background:#1A2B4A;padding:22px 28px;">
    <p style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:16px;line-height:1.6;color:#FFF8EB;margin:0 0 10px;">
      I'll also send you The Daily 3 on weekday mornings — the Social Security update, the benefits item that affects your check, and one practical action for the day. No panic. No politics. Just clarity.</p>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#FFF8EB;margin:0;"><strong>Kwame Kuadey</strong><br>
      <span style="color:#E8C77A;">The Benefits Insider&trade;</span><br>
      <span style="font-size:13px;color:#9FB0CC;">Adjunct Professor of Finance &middot; Johns Hopkins Carey Business School</span></p>
  </td></tr>

  <tr><td style="padding:20px 28px 36px;">
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.6;color:#6B7280;margin:0 0 10px;">
      This report is an educational self-screen based solely on your own answers. It is not legal advice, not a disability determination, and not a recommendation to file or not file. Benefits Insider is not affiliated with or endorsed by the Social Security Administration or any government agency. Applying for disability benefits is always free at ssa.gov or 1-800-772-1213. Figures cited are for ${year}.</p>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.6;color:#6B7280;margin:0;">
      You're receiving this one-time report because you requested it at mydisabilitycheck.org. Ongoing emails from Benefits Insider arrive separately and always include an unsubscribe link.<br>
      Benefits Insider &middot; Next Chapter Media${postal}</p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  return {
    subject: `Your Claim Readiness Report: ${data.score}/100`,
    html: html
  };
}

module.exports = { buildReportEmail: buildReportEmail };
