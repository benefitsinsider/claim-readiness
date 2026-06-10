/*
 * Quiz UI. State lives in `S`; answers persist to localStorage on every change.
 * Health-related sections sit behind an explicit consent gate; declining stops
 * the screen rather than silently skipping scored questions.
 */

(function () {
  "use strict";

  var STORE_KEY = "dcr-v1";
  var HEALTH_SECTIONS = ["severity", "medical", "function"];

  var S = {
    bank: null,
    numbers: null,
    answers: {},
    consent: null,       // {agreed: true, at: ISO string}
    cursor: 0,           // index into visibleQuestions()
    helpOpen: false
  };

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- persistence ----------
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        answers: S.answers, consent: S.consent, cursor: S.cursor, savedAt: new Date().toISOString()
      }));
    } catch (e) { /* private mode: resume simply unavailable */ }
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { return null; }
  }
  function clearSaved() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    S.answers = {}; S.consent = null; S.cursor = 0;
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
    ["landing", "quiz", "results"].forEach(function (v) {
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
    renderCurrent(); // re-render keeps aria state + Continue button honest
  }

  function goNext() {
    var vis = visibleQuestions();
    if (S.cursor < vis.length - 1) {
      S.cursor++;
      save();
      renderCurrent();
    } else {
      finish();
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

  function finish() {
    var r = scoreQuiz(S.bank, S.answers);
    var tier = S.bank.tiers.filter(function (t) { return t.id === r.tier.id; })[0];
    var html = "";

    html += '<div class="score-hero">' +
      '<div class="eyebrow">Your Claim Readiness Score</div>' +
      '<div class="score-num">' + r.total + "</div>" +
      '<div class="score-of">OUT OF 100</div></div>';

    html += '<div class="tier-card">' +
      '<div class="tier-band" style="background:' + tierColor(tier.id) + '"></div>' +
      '<div class="eyebrow" style="margin-top:0">' + (r.cappedBy ? "Hard gate applied · " : "") + r.total + " points</div>" +
      '<div class="tier-name">' + esc(tier.name) + "</div>" +
      "<p>" + esc(tier.summary) + "</p>" +
      '<p class="muted">' + esc(tier.caveat) + "</p>" +
      '<p style="margin-bottom:0;"><strong>What people in this tier often consider next:</strong> ' + esc(TIER_NEXT[tier.id]) + "</p></div>";

    // Gates
    html += '<div class="eyebrow">The Four Hard Gates</div><div class="tier-card" style="padding-top:20px"><div class="tier-band" style="background:var(--navy)"></div>';
    r.gates.forEach(function (g) {
      var label = g.status === "open" ? "Open" : g.status === "review" ? "Worth a review" : "Appears closed";
      html += '<div class="gate-pill gate-' + g.status + '"><span class="gate-dot"></span>' +
              "<span>" + esc(g.name) + '</span><span class="gate-status">' + label + "</span></div>";
    });
    html += "</div>";
    r.gates.forEach(function (g) {
      if (g.status === "closed") html += '<div class="warning"><div class="warning-title">' + esc(g.name) + " — appears closed</div><p style='margin:0'>" + esc(g.message) + "</p></div>";
      if (g.status === "review") html += '<div class="review-card"><div class="callout-title">' + esc(g.name) + " — worth a review</div><p style='margin:0'>" + esc(g.message) + "</p></div>";
    });

    // Section breakdown
    html += '<div class="eyebrow">Where Your Points Came From</div>';
    r.sections.forEach(function (s) {
      var pct = Math.round((s.points / s.maxPoints) * 100);
      html += '<div class="section-bar"><div class="label"><span>' + esc(s.title) + '</span><span class="pts">' + s.points + " / " + s.maxPoints + '</span></div>' +
              '<div class="track"><div class="fill" style="width:' + pct + '%"></div></div></div>';
    });

    // Flags
    r.flags.forEach(function (fid) {
      var f = S.bank.flags[fid];
      if (!f) return;
      html += '<div class="flag-card"><div class="flag-title">★ ' + esc(f.title) + "</div><p style='margin:0'>" + esc(f.message) + "</p></div>";
    });

    // Delay warning
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
      clearSaved(); show("landing");
    });
    show("results");
  }

  // ---------- boot ----------
  function boot(bank, numbers) {
    S.bank = bank;
    S.numbers = numbers;
    $("figures-stamp").textContent = "Dollar figures current for " + numbers.year +
      " (verified " + numbers.verified + "). Rules and figures are reviewed every January.";

    var saved = load();
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
        clearSaved();
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
