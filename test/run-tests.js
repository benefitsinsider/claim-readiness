// Golden tests for the scoring engine. Runs on macOS's built-in JavaScript
// runtime — no Node required:  osascript -l JavaScript test/run-tests.js
ObjC.import("Foundation");

function read(path) {
  return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null));
}

var DIR = ObjC.unwrap($.NSFileManager.defaultManager.currentDirectoryPath);
eval(read(DIR + "/js/engine.js"));
var bank = JSON.parse(read(DIR + "/data/questions.json"));

// The strongest honest profile — every best answer.
var BEST = {
  "q1-ssdi-insured": "yes", "q1-ssi-limits": "yes", "q1-earnings-record": "yes",
  "q2-working": "no",
  "q3-duration": "already", "q3-work-impact": "prevents", "q3-sustain": "no", "q3-severe-diagnosis": "no",
  "q4-treating-provider": "regular", "q4-recency": "recent", "q4-objective": "yes",
  "q4-ams-diagnosis": "yes", "q4-records-access": "have", "q4-treatment-following": "yes",
  "q5-concrete-limits": "concrete", "q5-symptom-journal": "yes", "q5-records-mention-function": "yes",
  "q5-consistency": "yes", "q5-witnesses": "yes",
  "q6-age": "60-plus", "q6-past-work": "no", "q6-education": "hs-or-less",
  "q6-transferable": "no", "q6-history-documented": "yes",
  "q7-red-flags": ["none"]
};

function withChanges(base, changes) {
  var a = {}; Object.keys(base).forEach(function (k) { a[k] = base[k]; });
  Object.keys(changes).forEach(function (k) {
    if (changes[k] === undefined) delete a[k]; else a[k] = changes[k];
  });
  return a;
}

var failures = [], count = 0;
function check(name, cond, detail) {
  count++;
  if (!cond) failures.push(name + (detail ? "  [" + detail + "]" : ""));
}

// 1. Best path scores exactly 100, tier strong, all gates open, concurrent flag fires.
var r = scoreQuiz(bank, BEST);
check("best path total = 100", r.total === 100, "got " + r.total);
check("best path tier = strong", r.tier.id === "strong", r.tier.id);
check("best path gates all open", r.gates.every(function (g) { return g.status === "open"; }));
check("concurrent-benefits flag derived", r.flags.indexOf("concurrent-benefits") !== -1);
check("no delay warning on strong", r.showDelayWarning === false);

// 2. Above SGA with no exception: gate closed, capped to major-gaps despite high score.
r = scoreQuiz(bank, withChanges(BEST, { "q2-working": "yes", "q2-earnings": "above", "q2-exceptions": "none" }));
check("SGA-closed total = 85", r.total === 85, "got " + r.total);
check("SGA-closed tier capped to major-gaps", r.tier.id === "major-gaps", r.tier.id);
check("SGA-closed cappedBy gate-sga", r.cappedBy === "gate-sga", r.cappedBy);

// 3. Above SGA but possible exception: review status, no cap.
r = scoreQuiz(bank, withChanges(BEST, { "q2-working": "yes", "q2-earnings": "above", "q2-exceptions": "possible" }));
check("SGA-review no cap", r.cappedBy === null, r.cappedBy);
check("SGA-review status", r.gates.filter(function (g) { return g.id === "gate-sga"; })[0].status === "review");

// 4. Duration under 12 months: capped at building (not major-gaps).
r = scoreQuiz(bank, withChanges(BEST, { "q3-duration": "under-12" }));
check("duration-closed total = 94", r.total === 94, "got " + r.total);
check("duration caps at major-gaps", r.tier.id === "major-gaps", r.tier.id);

// 5. No program path: gate closed, capped major-gaps; section scores only the record-check.
r = scoreQuiz(bank, withChanges(BEST, { "q1-ssdi-insured": "no", "q1-ssi-limits": "no" }));
check("program section = 2", r.sections[0].points === 2, "got " + r.sections[0].points);
check("program gate caps major-gaps", r.tier.id === "major-gaps", r.tier.id);
check("no concurrent flag", r.flags.indexOf("concurrent-benefits") === -1);

// 6. One open path scores as well as two (max, not sum).
r = scoreQuiz(bank, withChanges(BEST, { "q1-ssi-limits": "no" }));
check("single path program = 10", r.sections[0].points === 10, "got " + r.sections[0].points);

// 7. No medical evidence from acceptable source: medical gate closes.
r = scoreQuiz(bank, withChanges(BEST, { "q4-objective": "none", "q4-ams-diagnosis": "no" }));
check("medical gate closed", r.gates.filter(function (g) { return g.id === "gate-medical"; })[0].status === "closed");
check("medical-closed tier major-gaps", r.tier.id === "major-gaps", r.tier.id);

// 8. Young applicant ceiling: 18-49 loses exactly the 4 age points; borderline flag fires.
r = scoreQuiz(bank, withChanges(BEST, { "q6-age": "18-49", "q6-borderline": "yes" }));
check("young ceiling = 96", r.total === 96, "got " + r.total);
check("young still reaches strong", r.tier.id === "strong", r.tier.id);
check("borderline-age flag", r.flags.indexOf("borderline-age") !== -1);

// 9. Borderline question hidden at 60+: its answer must not leak a flag.
r = scoreQuiz(bank, withChanges(BEST, { "q6-borderline": "yes" })); // age stays 60-plus
check("hidden borderline ignored", r.flags.indexOf("borderline-age") === -1);

// 10. All five red flags: risk floor 0; "none" beats stray selections.
r = scoreQuiz(bank, withChanges(BEST, { "q7-red-flags": ["treatment-gap", "not-following", "substance", "prior-denial", "work-since-onset"] }));
check("five flags risk = 0", r.sections[6].points === 0, "got " + r.sections[6].points);
r = scoreQuiz(bank, withChanges(BEST, { "q7-red-flags": ["none", "treatment-gap"] }));
check("exclusive none wins", r.sections[6].points === 5, "got " + r.sections[6].points);

// 11. CAL + DLI flags fire from option flags.
r = scoreQuiz(bank, withChanges(BEST, { "q3-severe-diagnosis": "yes", "q1-ssdi-insured": "not-sure" }));
check("cal-check flag", r.flags.indexOf("cal-check") !== -1);
check("dli-check flag", r.flags.indexOf("dli-check") !== -1);

// 12. Empty answers: 0 (deduct base survives), worst tier, nothing crashes.
r = scoreQuiz(bank, {});
check("empty total = 5 (risk base)", r.total === 5, "got " + r.total);
check("empty tier major-gaps", r.tier.id === "major-gaps", r.tier.id);

// 13. Delay warning shows on every non-strong tier.
r = scoreQuiz(bank, withChanges(BEST, { "q5-symptom-journal": "no", "q5-records-mention-function": "no",
  "q5-concrete-limits": "no", "q4-objective": "some", "q4-treating-provider": "occasional",
  "q5-witnesses": "no", "q4-recency": "year" }));
check("mid-tier total = 77", r.total === 77, "got " + r.total);
check("mid-tier is promising", r.tier.id === "promising", r.tier.id);
check("mid-tier shows delay warning", r.showDelayWarning === true, r.tier.id);

var out = failures.length
  ? "FAIL (" + failures.length + "/" + count + "):\n  " + failures.join("\n  ")
  : "ALL " + count + " TESTS PASS";
out;
