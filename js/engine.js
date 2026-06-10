/*
 * Disability Claim Readiness Score — scoring engine.
 * Pure function: scoreQuiz(bank, answers) -> result. No DOM, no fetch, no state.
 * `bank` is the parsed data/questions.json; `answers` maps questionId -> option
 * value (string), or array of values for type "multi". Unanswered ids are absent.
 */

function scoreQuiz(bank, answers) {
  var byId = {};
  bank.questions.forEach(function (q) { byId[q.id] = q; });

  function isVisible(q) {
    if (!q.showIf) return true;
    var parent = byId[q.showIf.q];
    if (parent && !isVisible(parent)) return false;
    return q.showIf.is.indexOf(answers[q.showIf.q]) !== -1;
  }

  function selectedOption(q) {
    var v = answers[q.id];
    if (v === undefined || v === null) return null;
    for (var i = 0; i < q.options.length; i++) {
      if (q.options[i].value === v) return q.options[i];
    }
    return null;
  }

  function questionPoints(qid) {
    var q = byId[qid];
    if (!q || !isVisible(q)) return 0;
    var opt = selectedOption(q);
    return opt && typeof opt.points === "number" ? opt.points : 0;
  }

  // ---- Section scores ----
  var sections = bank.sections.map(function (s) {
    var qs = bank.questions.filter(function (q) { return q.section === s.id; });
    var pts = 0;

    if (s.scoring.type === "sum") {
      qs.forEach(function (q) { pts += questionPoints(q.id); });

    } else if (s.scoring.type === "max-plus") {
      var best = 0;
      s.scoring.maxOf.forEach(function (id) {
        var p = questionPoints(id);
        if (p > best) best = p;
      });
      pts = best;
      s.scoring.plus.forEach(function (id) { pts += questionPoints(id); });

    } else if (s.scoring.type === "deduct") {
      pts = s.scoring.base;
      qs.forEach(function (q) {
        if (q.type !== "multi") return;
        var picked = answers[q.id] || [];
        var none = q.options.filter(function (o) { return o.exclusive; })
                            .map(function (o) { return o.value; });
        var effective = picked.some(function (v) { return none.indexOf(v) !== -1; }) ? [] : picked;
        effective.forEach(function (v) {
          var opt = q.options.filter(function (o) { return o.value === v; })[0];
          if (opt && typeof opt.deduct === "number") pts -= opt.deduct;
        });
      });
      if (pts < s.scoring.min) pts = s.scoring.min;
    }

    if (pts > s.maxPoints) pts = s.maxPoints;
    if (pts < 0) pts = 0;
    return { id: s.id, title: s.title, points: pts, maxPoints: s.maxPoints };
  });

  var total = sections.reduce(function (t, s) { return t + s.points; }, 0);

  // ---- Gates ----
  function clausesMet(cond) {
    if (!cond) return false;
    return cond.all.every(function (c) {
      return c.is.indexOf(answers[c.q]) !== -1;
    });
  }

  var gates = bank.gates.map(function (g) {
    var status = clausesMet(g.closedWhen) ? "closed"
               : clausesMet(g.reviewWhen) ? "review"
               : "open";
    return { id: g.id, name: g.name, status: status, capTier: g.capTier,
             message: status === "closed" ? g.closedMessage
                    : status === "review" ? g.reviewMessage : null };
  });

  // ---- Tier (tiers ordered best-first in the bank; caps push down) ----
  var tierOrder = bank.tiers.map(function (t) { return t.id; });
  var tier = bank.tiers.filter(function (t) {
    return total >= t.range[0] && total <= t.range[1];
  })[0] || bank.tiers[bank.tiers.length - 1];

  var cappedBy = null;
  gates.forEach(function (g) {
    if (g.status !== "closed") return;
    if (tierOrder.indexOf(g.capTier) > tierOrder.indexOf(tier.id)) {
      tier = bank.tiers.filter(function (t) { return t.id === g.capTier; })[0];
      cappedBy = g.id;
    }
  });

  // ---- Flags ----
  var flags = [];
  bank.questions.forEach(function (q) {
    if (!isVisible(q)) return;
    var opt = selectedOption(q);
    if (opt && opt.flags) opt.flags.forEach(function (f) {
      if (flags.indexOf(f) === -1) flags.push(f);
    });
  });
  Object.keys(bank.flags).forEach(function (fid) {
    var f = bank.flags[fid];
    if (f.derivedWhen && clausesMet(f.derivedWhen) && flags.indexOf(fid) === -1) flags.push(fid);
  });

  return {
    total: total,
    sections: sections,
    gates: gates,
    tier: { id: tier.id, name: tier.name },
    cappedBy: cappedBy,
    flags: flags,
    showDelayWarning: tier.id !== "strong"
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { scoreQuiz: scoreQuiz };
