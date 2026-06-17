/*
 * Quiz UI. State lives in `S`; progress persists to localStorage on every change.
 * Health-related sections sit behind an explicit consent gate. Results are
 * hard-gated behind the report capture form (first visit only — returning
 * users with a saved profile skip straight to results and get an updated
 * report). Quiz answers never leave the device; only the submitted contact
 * details and the score summary are POSTed, to deliver the emailed report.
 */

(function () {
  "use strict";

  var STORE_KEY = "dcr-v1";          // in-progress quiz (answers, cursor, consent)
  var PROFILE_KEY = "dcr-profile-v1"; // name/email/phone after first capture
  var LAST_KEY = "dcr-last-v1";       // last completed result (for re-check card)
  var HIST_KEY = "dcr-hist-v1";       // on-device score history (private, never transmitted)
  var SUBSCRIBE_URL = "/.netlify/functions/subscribe";
  var FORM_VERSION = "capture-v1";
  var HEALTH_SECTIONS = ["severity", "medical", "function"];

  var S = {
    bank: null,
    numbers: null,
    answers: {},
    consent: null,       // {agreed: true, at: ISO string}
    cursor: 0,
    pendingResult: null
  };

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- persistence ----------
  function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function fetchStore(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function save() {
    store(STORE_KEY, { answers: S.answers, consent: S.consent, cursor: S.cursor, savedAt: new Date().toISOString() });
  }
  function clearProgress() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    S.answers = {}; S.consent = null; S.cursor = 0; S.pendingResult = null;
  }

  // ---------- data ----------
  function interpolate(text) {
    return text.replace(/\{\{(\w+)\}\}/g, function (_, token) {
      return S.numbers.displayStrings[token] || token;
    });
  }

  function visibleQuestions() {
    return S.bank.questions.filter(function (q) {
      if (!q.showIf) return true;
      return q.showIf.is.indexOf(S.answers[q.showIf.q]) !== -1;
    });
  }

  function pruneHidden() {
    var visible = {};
    visibleQuestions().forEach(function (q) { visible[q.id] = true; });
    Object.keys(S.answers).forEach(function (id) {
      if (!visible[id]) delete S.answers[id];
    });
  }

  function sectionOf(q) {
    return S.bank.sections.filter(function (s) { return s.id === q.section; })[0];
  }

  function needsConsent(q) {
    return HEALTH_SECTIONS.indexOf(q.section) !== -1 && !(S.consent && S.consent.agreed);
  }

  // ---------- views ----------
  function show(view) {
    ["landing", "quiz", "capture", "results"].forEach(function (v) {
      $("view-" + v).classList.toggle("active", v === view);
    });
    window.scrollTo(0, 0);
  }

  // ---------- quiz rendering ----------
  function renderProgress(q) {
    var sec = sectionOf(q);
    var sectionIdx = S.bank.sections.indexOf(sec) + 1;
    $("progress-meta").textContent = "Part " + sectionIdx + " of " + S.bank.sections.length + " · " + sec.title;
    var vis = visibleQuestions();
    var pct = Math.round((S.cursor / vis.length) * 100);
    $("progress-fill").style.width = Math.max(pct, 4) + "%";
  }

  function renderConsentGate() {
    $("progress-meta").textContent = "Before the health questions";
    $("quiz-body").innerHTML =
      '<h2 class="q-text">A quick consent before we continue</h2>' +
      '<p>The next questions ask about your health conditions and how they affect you. ' +
      'Your answers are used only to calculate your Readiness Score, <strong>entirely on your device</strong> — they are never sent to us or anyone else.</p>' +
      '<div class="consent-card">' +
        '<label class="consent-row"><input type="checkbox" id="consent-box">' +
        '<span>I consent to answering health-related questions to calculate my Readiness Score</span></label>' +
        '<p class="consent-sub">You can stop at any time. Without the health questions the score cannot be calculated, because SSA’s process is built around them.</p>' +
      '</div>' +
      '<div class="btn-row">' +
        '<button class="btn btn-ghost" id="btn-back" type="button">Back</button>' +
        '<button class="btn btn-primary" id="btn-next" type="button" disabled>Continue</button>' +
      '</div>';

    $("consent-box").addEventListener("change", function (e) {
      $("btn-next").disabled = !e.target.checked;
    });
    $("btn-next").addEventListener("click", function () {
      S.consent = { agreed: true, at: new Date().toISOString() };
      save();
      renderCurrent();
    });
    $("btn-back").addEventListener("click", goBack);
  }

  function renderQuestion(q) {
    renderProgress(q);
    var multi = q.type === "multi";
    var picked = multi ? (S.answers[q.id] || []) : S.answers[q.id];

    var html = '<h2 class="q-text" id="q-text">' + esc(interpolate(q.text)) + "</h2>";
    if (q.helpText) {
      html += '<button class="help-toggle" id="help-toggle" type="button" aria-expanded="false">What does this mean?</button>' +
              '<div class="help-body" id="help-body" hidden>' + esc(interpolate(q.helpText)) + "</div>";
    }
    html += '<div role="' + (multi ? "group" : "radiogroup") + '" aria-labelledby="q-text" id="opts">';
    q.options.forEach(function (o) {
      var checked = multi ? picked.indexOf(o.value) !== -1 : picked === o.value;
      html += '<button class="opt" type="button" role="' + (multi ? "checkbox" : "radio") + '"' +
              ' aria-checked="' + checked + '" data-value="' + esc(o.value) + '">' +
              esc(o.label) + '<span class="tick">✓</span></button>';
    });
    html += "</div>" +
      '<div class="btn-row">' +
        '<button class="btn btn-ghost" id="btn-back" type="button"' + (S.cursor === 0 ? " disabled" : "") + ">Back</button>" +
        '<button class="btn btn-primary" id="btn-next" type="button"' + (answered(q) ? "" : " disabled") + ">Continue</button>" +
      "</div>";

    $("quiz-body").innerHTML = html;

    if (q.helpText) {
      $("help-toggle").addEventListener("click", function () {
        var open = $("help-body").hidden;
        $("help-body").hidden = !open;
        $("help-toggle").setAttribute("aria-expanded", String(open));
      });
    }

    Array.prototype.forEach.call($("opts").children, function (btn) {
      btn.addEventListener("click", function () { pick(q, btn.dataset.value); });
    });
    $("btn-back").addEventListener("click", goBack);
    $("btn-next").addEventListener("click", goNext);
  }

  function answered(q) {
    if (q.type === "multi") return (S.answers[q.id] || []).length > 0;
    return S.answers[q.id] !== undefined;
  }

  function pick(q, value) {
    if (q.type === "multi") {
      var cur = S.answers[q.id] || [];
      var exclusiveValues = q.options.filter(function (o) { return o.exclusive; })
                                     .map(function (o) { return o.value; });
      var isExclusive = exclusiveValues.indexOf(value) !== -1;
      if (cur.indexOf(value) !== -1) {
        cur = cur.filter(function (v) { return v !== value; });
      } else if (isExclusive) {
        cur = [value];
      } else {
        cur = cur.filter(function (v) { return exclusiveValues.indexOf(v) === -1; }).concat([value]);
      }
      S.answers[q.id] = cur;
    } else {
      S.answers[q.id] = value;
    }
    pruneHidden();
    save();
    renderCurrent();
  }

  function goNext() {
    var vis = visibleQuestions();
    if (S.cursor < vis.length - 1) {
      S.cursor++;
      save();
      renderCurrent();
    } else {
      finishFlow();
    }
  }

  function goBack() {
    if (S.cursor > 0) {
      S.cursor--;
      save();
      renderCurrent();
    }
  }

  function renderCurrent() {
    var vis = visibleQuestions();
    if (S.cursor >= vis.length) S.cursor = vis.length - 1;
    var q = vis[S.cursor];
    if (needsConsent(q)) { renderConsentGate(); return; }
    renderQuestion(q);
  }

  // ---------- capture & report ----------
  function maskEmail(email) {
    var parts = email.split("@");
    return parts[0].charAt(0) + "***@" + parts[1];
  }

  function sendReport(profile, result, onFail) {
    var sections = {};
    result.sections.forEach(function (s) { sections[s.id] = s.points + "/" + s.maxPoints; });
    return fetch(SUBSCRIBE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: profile.name,
        email: profile.email,
        phone: profile.phone || "",
        smsConsent: !!profile.smsConsent,
        consentAt: new Date().toISOString(),
        formVersion: FORM_VERSION,
        score: result.total,
        tierId: result.tier.id,
        tierName: result.tier.name,
        sections: sections,
        gatesClosed: result.gates.filter(function (g) { return g.status === "closed"; })
                                 .map(function (g) { return g.id; }).join(","),
        stage: S.answers["q0-stage"] || ""
      })
    }).then(function (r) {
      if (!r.ok) throw new Error("subscribe failed: " + r.status);
    }).catch(function () {
      if (onFail) onFail();
    });
  }

  function finishFlow() {
    S.pendingResult = scoreQuiz(S.bank, S.answers);
    var profile = fetchStore(PROFILE_KEY);
    if (profile && profile.email) {
      sendReport(profile, S.pendingResult, function () { noteFail(); });
      finish(S.pendingResult, "Your updated Readiness Report is on its way to " + esc(maskEmail(profile.email)) + ".");
    } else {
      show("capture");
    }
  }

  function noteFail() {
    var n = $("email-note");
    if (n) n.innerHTML = '<div class="callout-title">About your emailed report</div><p style="margin:0">We had trouble sending your report just now — your score below is complete, and we\'ll retry your report delivery automatically.</p>';
  }

  function setInvalid(fieldId, invalid) {
    $(fieldId).classList.toggle("invalid", invalid);
    return !invalid;
  }

  function handleCapture(e) {
    e.preventDefault();
    var name = $("in-name").value.trim();
    var email = $("in-email").value.trim();
    var phone = $("in-phone").value.trim();
    var sms = $("sms-consent").checked;

    var ok = setInvalid("f-name", name.length === 0);
    ok = setInvalid("f-email", !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) && ok;
    var phoneInvalid = (phone.length > 0 && !/^[\d\s().+-]{7,20}$/.test(phone)) || (sms && phone.length === 0);
    ok = setInvalid("f-phone", phoneInvalid) && ok;
    if (!ok) return;

    var profile = { name: name, email: email, phone: phone, smsConsent: sms, capturedAt: new Date().toISOString() };
    store(PROFILE_KEY, profile);
    sendReport(profile, S.pendingResult, function () { noteFail(); });
    finish(S.pendingResult, "Your Readiness Report is on its way to " + esc(maskEmail(email)) + ". It usually arrives within a few minutes — check spam/promotions if you don't see it.");
  }

  // ---------- results ----------
  var TIER_NEXT = {
    strong: "People at this stage often pull their earnings record at ssa.gov/myaccount, keep copies of what they've organized, and decide whether to file on their own or talk with a qualified representative first. Filing is free at ssa.gov.",
    promising: "People at this stage often focus on the section that cost the most points — for most, that's medical documentation or the work-limits story — and re-screen after 30 days of building the record.",
    building: "People at this stage often focus on establishing consistent medical care, starting a symptom journal today, and re-screening every few months as the record grows.",
    "major-gaps": "Situations in this tier usually involve facts a self-screen cannot evaluate. Many people here consider a conversation with a qualified attorney or eligible non-attorney representative — most offer free initial consultations — before making any filing decision."
  };

  function tierColor(id) {
    return { strong: "var(--green)", promising: "var(--gold)", building: "var(--amber)", "major-gaps": "var(--crimson)" }[id];
  }

  // ---------- Kit promo ----------
  var KIT_CHAPTERS = {
    program: "Chapter 1", work: "Chapter 2", severity: "Chapter 3",
    medical: "Chapter 4", function: "Chapter 5", vocational: "Chapters 6–7", risk: "Chapter 8"
  };
  var KIT_FIXABLE = ["program", "work", "severity", "medical", "function", "risk"];

  function kitPromoHtml(r) {
    var kit = S.numbers.kit;
    if (!kit || !kit.url) return "";

    var weak = r.sections
      .map(function (s) { return { id: s.id, points: s.points, maxPoints: s.maxPoints, title: s.title.replace(/^Your /, "") }; })
      .filter(function (s) { return KIT_FIXABLE.indexOf(s.id) !== -1 && s.points < s.maxPoints; })
      .sort(function (a, b) { return (a.points / a.maxPoints) - (b.points / b.maxPoints); })
      .slice(0, 2);

    var personal;
    if (weak.length === 2) {
      personal = "Your lowest areas were <strong>" + esc(weak[0].title) + " (" + weak[0].points + "/" + weak[0].maxPoints +
        ")</strong> and <strong>" + esc(weak[1].title) + " (" + weak[1].points + "/" + weak[1].maxPoints +
        ")</strong> — " + KIT_CHAPTERS[weak[0].id] + " and " + KIT_CHAPTERS[weak[1].id] + " of the Kit walk you through fixing exactly those, most of it in 30–90 days.";
    } else if (weak.length === 1) {
      personal = "Your lowest area was <strong>" + esc(weak[0].title) + " (" + weak[0].points + "/" + weak[0].maxPoints +
        ")</strong> — " + KIT_CHAPTERS[weak[0].id] + " of the Kit walks you through fixing exactly that.";
    } else {
      personal = "Your preparation scored well — the Kit is how people keep it organized, consistent, and ready through filing and beyond.";
    }

    return '<div class="kit-promo no-print">' +
      '<div class="band"></div>' +
      '<div class="inner">' +
        '<img class="cover" src="assets/kit-cover.png" alt="The Disability Claim Readiness Kit" width="120">' +
        '<div style="flex:1;min-width:0;">' +
          '<p class="kicker">Your Next Step</p>' +
          '<h3>Close the gaps you just saw — with the Readiness Kit</h3>' +
          '<p class="personal">' + personal + "</p>" +
          "<ul>" +
            "<li>11 plain-language chapters matched to the seven areas you were just scored on</li>" +
            "<li>The full worksheets behind your score — re-check yourself as your record grows</li>" +
            "<li>126-page printable PDF, plus the symptom diary, doctor guide, and SSA phone card</li>" +
          "</ul>" +
          '<a class="btn-kit" href="' + esc(kit.url) + '" target="_blank" rel="noopener">Get the Readiness Kit — ' + esc(kit.price || "$47") + "</a>" +
          '<p class="sub">One-time purchase · Instant download · Yours to keep and print</p>' +
          '<p class="sub">An educational guide — not legal advice. Applying for disability is always free at ssa.gov.</p>' +
        "</div>" +
      "</div></div>";
  }

  function finish(r, emailNote) {
    var tier = S.bank.tiers.filter(function (t) { return t.id === r.tier.id; })[0];
    var nowEntry = { total: r.total, tierId: tier.id, tierName: tier.name, at: new Date().toISOString() };
    // Prior check (before this one) for the progression badge, then append to on-device history.
    var hist = fetchStore(HIST_KEY) || [];
    var prior = hist.length ? hist[hist.length - 1] : null;
    hist.push(nowEntry);
    if (hist.length > 8) hist = hist.slice(hist.length - 8); // keep last 8, on device only
    store(HIST_KEY, hist);
    store(LAST_KEY, nowEntry);
    // A finished run is not resumable — next visit starts a fresh re-check.
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    var html = "";

    html += '<div class="score-hero">' +
      '<div class="eyebrow">Your Claim Readiness Score</div>' +
      '<div class="score-num">' + r.total + "</div>" +
      '<div class="score-of">OUT OF 100</div>';
    if (prior) {
      var delta = r.total - prior.total;
      var priorDate = new Date(prior.at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      var arrow = delta > 0 ? "&#9650; +" + delta : delta < 0 ? "&#9660; " + delta : "&middot; no change";
      var col = delta > 0 ? "var(--green, #2E7D5B)" : delta < 0 ? "var(--amber, #C58B3A)" : "var(--gray-text, #6B7280)";
      html += '<div class="score-delta" style="margin-top:10px;font-size:15.5px;color:' + col + ';font-weight:700;">' +
        arrow + ' since your ' + esc(priorDate) + ' check (was ' + prior.total + ')</div>' +
        (delta > 0 ? '<div class="muted" style="font-size:14px;margin-top:4px;">That\'s the kind of movement that comes from building the record.</div>' : '');
    }
    html += "</div>";

    if (emailNote) {
      html += '<div class="flag-card no-print" id="email-note"><div class="flag-title">★ Your report is on the way</div><p style="margin:0">' + emailNote + "</p></div>";
    }

    html += '<div class="tier-card">' +
      '<div class="tier-band" style="background:' + tierColor(tier.id) + '"></div>' +
      '<div class="eyebrow" style="margin-top:0">' + (r.cappedBy ? "One of the four rules applies · " : "") + r.total + " points</div>" +
      '<div class="tier-name">' + esc(tier.name) + "</div>" +
      "<p>" + esc(tier.summary) + "</p>" +
      '<p class="muted">' + esc(tier.caveat) + "</p>" +
      '<p style="margin-bottom:0;"><strong>What people in this tier often consider next:</strong> ' + esc(TIER_NEXT[tier.id]) + "</p></div>";

    html += '<div class="eyebrow">The Four Rules That Can Stop a Claim</div><div class="tier-card" style="padding-top:20px"><div class="tier-band" style="background:var(--navy)"></div>';
    r.gates.forEach(function (g) {
      var label = g.status === "open" ? "Looks met" : g.status === "review" ? "Worth a review" : "Appears not met";
      html += '<div class="gate-pill gate-' + g.status + '"><span class="gate-dot"></span>' +
              "<span>" + esc(g.name) + '</span><span class="gate-status">' + label + "</span></div>";
    });
    html += "</div>";
    r.gates.forEach(function (g) {
      if (g.status === "closed") html += '<div class="warning"><div class="warning-title">' + esc(g.name) + " — appears not met</div><p style='margin:0'>" + esc(g.message) + "</p></div>";
      if (g.status === "review") html += '<div class="review-card"><div class="callout-title">' + esc(g.name) + " — worth a review</div><p style='margin:0'>" + esc(g.message) + "</p></div>";
    });

    html += '<div class="eyebrow">Where Your Points Came From</div>';
    r.sections.forEach(function (s) {
      var pct = Math.round((s.points / s.maxPoints) * 100);
      html += '<div class="section-bar"><div class="label"><span>' + esc(s.title) + '</span><span class="pts">' + s.points + " / " + s.maxPoints + '</span></div>' +
              '<div class="track"><div class="fill" style="width:' + pct + '%"></div></div></div>';
    });

    html += kitPromoHtml(r);

    r.flags.forEach(function (fid) {
      var f = S.bank.flags[fid];
      if (!f) return;
      html += '<div class="flag-card"><div class="flag-title">★ ' + esc(f.title) + "</div><p style='margin:0'>" + esc(f.message) + "</p></div>";
    });

    if (r.showDelayWarning) {
      html += '<div class="callout"><div class="callout-title">A note about timing</div><p style="margin:0">' + esc(S.bank.delayWarning) + "</p></div>";
    }

    html += '<div class="nav-disclaimer"><strong>Reminder.</strong> ' +
      "This score measures how prepared your information appears today — it is not a prediction of SSA’s decision, and it is not legal advice. Only SSA can decide a claim. Honest answers in, honest snapshot out.</div>";

    html += '<div class="btn-row no-print">' +
      '<button class="btn btn-ghost" id="btn-print" type="button">Print / Save</button>' +
      '<button class="btn btn-primary" id="btn-restart" type="button">Start Over</button></div>';

    $("results-body").innerHTML = html;
    $("btn-print").addEventListener("click", function () { window.print(); });
    $("btn-restart").addEventListener("click", function () {
      clearProgress();
      renderLastCard();
      show("landing");
    });
    show("results");
  }

  // ---------- landing ----------
  function renderLastCard() {
    var existing = $("last-score-card");
    if (existing) existing.remove();
    var last = fetchStore(LAST_KEY);
    if (!last) return;
    var hist = fetchStore(HIST_KEY) || [];
    var when = new Date(last.at);
    var dateStr = when.toLocaleDateString(undefined, { month: "long", day: "numeric" });
    var card = document.createElement("div");
    card.className = "last-score-card";
    card.id = "last-score-card";
    var trend = "";
    if (hist.length >= 2) {
      var first = hist[0], gain = last.total - first.total;
      if (gain > 0) {
        trend = '<p style="margin:8px 0 0;font-size:15.5px;color:var(--green,#2E7D5B);font-weight:700;">' +
          '&#9650; Up ' + gain + ' points since your first check. Keep going.</p>';
      }
    }
    card.innerHTML = '<div class="eyebrow" style="margin:0 0 4px;">Your last score · ' + esc(dateStr) +
      (hist.length >= 2 ? ' · check ' + hist.length : '') + "</div>" +
      '<span class="num">' + last.total + '</span> <span class="muted">/ 100 · ' + esc(last.tierName) + "</span>" +
      trend +
      '<p style="margin:8px 0 0;font-size:15.5px;">Readiness changes as your record grows. Re-check to see what\'s moved.</p>';
    var hero = document.querySelector(".hero");
    hero.parentNode.insertBefore(card, hero.nextSibling);
    var startBtn = $("btn-start");
    if (startBtn && !fetchStore(STORE_KEY)) startBtn.textContent = "Re-Check My Readiness";
  }

  // ---------- boot ----------
  function boot(bank, numbers) {
    S.bank = bank;
    S.numbers = numbers;
    $("figures-stamp").textContent = "Dollar figures current for " + numbers.year +
      " (verified " + numbers.verified + "). Rules and figures are reviewed every January.";

    $("capture-form").addEventListener("submit", handleCapture);

    var saved = fetchStore(STORE_KEY);
    var startBtn = $("btn-start");

    if (saved && saved.answers && Object.keys(saved.answers).length > 0) {
      startBtn.textContent = "Resume Where I Left Off";
      var fresh = document.createElement("button");
      fresh.className = "btn btn-ghost";
      fresh.style.marginTop = "12px";
      fresh.type = "button";
      fresh.textContent = "Start Fresh Instead";
      startBtn.insertAdjacentElement("afterend", fresh);
      fresh.addEventListener("click", function () {
        clearProgress();
        show("quiz");
        renderCurrent();
      });
      startBtn.addEventListener("click", function () {
        S.answers = saved.answers || {};
        S.consent = saved.consent || null;
        S.cursor = saved.cursor || 0;
        show("quiz");
        renderCurrent();
      });
    } else {
      startBtn.addEventListener("click", function () {
        show("quiz");
        renderCurrent();
      });
    }

    renderLastCard();
  }

  Promise.all([
    fetch("data/questions.json").then(function (r) { return r.json(); }),
    fetch("data/annual-numbers.json").then(function (r) { return r.json(); })
  ]).then(function (res) {
    boot(res[0], res[1]);
  }).catch(function () {
    document.querySelector(".hero").insertAdjacentHTML("beforeend",
      '<div class="warning"><p style="margin:0">The screen could not load. Please refresh the page.</p></div>');
  });
})();
