# Disability Claim Readiness Score — Phase 0 Spec

A free, client-side readiness self-screen derived from The Disability Claim Readiness Kit (Benefits Insider).
Working name only — the public brand/domain must not contain "Social Security," "SSA," "SSI," or "SSDI"
(Section 1140; disclaimers are not a safe harbor).

## Files

- `data/questions.json` — question bank, sections, gates, tiers, flags. The single source of truth for content.
- `data/annual-numbers.json` — every year-specific dollar figure. Updated each January; nothing else should
  hardcode a dollar amount. Question text uses `{{token}}` placeholders resolved from `displayStrings`.

## Scoring engine rules (Phase 1 implements these as a pure function)

`score(answers) -> { total, sections[], gates[], tier, flags[] }`

1. **Sum scoring (default).** A section's score is the sum of `points` on the selected option of every
   *answered* question in that section. Questions hidden by `showIf` contribute 0. Branch paths are designed
   so every reachable path sums to ≤ section max.
2. **`max-plus` scoring (program section).** Score = max(points of `maxOf` questions) + sum of `plus`
   questions. Two open program paths shouldn't score double; one open path shouldn't be penalized for the
   other being closed.
3. **`deduct` scoring (risk section).** Start at `base` (5), subtract 1 per checked flag, floor at `min` (0).
   The `none` option is `exclusive`: selecting it clears the others.
4. **Gates.** After scoring, evaluate each gate's `closedWhen` / `reviewWhen` conditions (`all` = AND over
   `{q, is[]}` clauses). A closed gate caps the tier at `capTier` regardless of score. `review` does not cap;
   it surfaces the `reviewMessage` prominently.
5. **Tier.** Map total to `tiers[].range`, then apply the most restrictive gate cap.
6. **Flags.** Collected from selected options (`flags[]`) plus derived flags (`derivedWhen`). Shown as
   callouts on the results page. Flags never change the score.
7. **Delay warning.** Every below-`strong` result displays `delayWarning` (DLI/back-pay filing-date notice).

## Point budget (must always total 100)

| Section | Max | Source |
|---|---|---|
| program | 10 | Ch 1 C-Check |
| work | 15 | Ch 2 L-Check |
| severity | 15 | Ch 3 A-Check |
| medical | 20 | Ch 4 Medical Evidence Inventory |
| function | 20 | Ch 5 Function Story Builder |
| vocational | 15 | Ch 6 & 7 Past Work + Grid Check |
| risk | 5 | Ch 8 Red Flag Self-Audit (deduction) |

## Language constraints (compliance — do not regress)

- Readiness/preparation framing only. Never "you qualify," never approval odds, never directives
  ("you should file"). Descriptive: "people with X are typically better prepared."
- Quiz is free, no account. Answers never leave the browser (no analytics events or URL params encoding
  answers). Only contact info + tier may ever be transmitted, with explicit consent.
- Referral = click-out to named partner with campaign-tag attribution only (BenefitsUSA/Turnout model);
  no lead data transfer. Compensation disclosure at the point of referral.
- Health questions sit behind a consent gate ("I consent to the collection of health-related information…")
  per WA MHMDA pattern, even though processing is client-side.

## Report capture & beehiiv pipeline

Results are hard-gated behind the report form (first name + email required, phone optional with
separate SMS consent). Quiz answers never leave the device; the form POSTs contact details + score
summary (total, tier, section totals, closed gates) + consent record to
`netlify/functions/subscribe.js`, which upserts a beehiiv subscriber. Returning users (saved profile
in localStorage) skip the form and get an updated report automatically; their last score shows on the
landing page as the re-check hook. If the POST fails (e.g., GitHub Pages staging, which has no
functions), the score still displays with a delivery-failure note — never block the score on our
infrastructure.

One-time setup:
1. Netlify → Site settings → Environment variables: `BEEHIIV_API_KEY`, `BEEHIIV_PUB_ID`.
2. beehiiv → Settings → Subscriber data: create custom fields `first_name`, `phone`, `sms_consent`,
   `readiness_score`, `readiness_tier`, `sections_summary`, `gates_closed`, `consent_at`,
   `consent_ip`, `consent_form_version`.
3. beehiiv → Automations: signup trigger with `utm_source = mydisabilitycheck` sending the report
   email — full copy in `docs/report-email-template.md`.
4. Have a lawyer review `privacy.html` and the capture-form disclosure text before paid traffic.

## Policy watch (check during every January review — and on major SSA news)

- **Age as a vocational factor (the grids).** In Oct 2025 the administration drafted a rule to eliminate
  age as a factor or raise the threshold to 60; after public uproar, SSA scrapped it in Nov 2025
  (WaPo, Oct 5 / Nov 19, 2025). Confirmed unchanged as of June 2026 (20 CFR Part 404, Subpart P, App. 2).
  This proposal has surfaced in both Trump terms — treat it as likely to return. If the rules change:
  update `q6-age` points + helpText, `q6-borderline`, and the Ch 6/7-derived copy. The point values live
  in `questions.json`, so this is a data change, not a code change.
- **Occupational database.** SSA also halted its plan to replace the obsolete DOT jobs database with
  modern BLS data (Nov 2025). If a new database ever ships, Step 5 outcomes shift and the vocational
  section's framing should be re-reviewed.
- Watch: Federal Register (SSA rulemaking), ssa.gov/regulations. This is also Daily 3 content when it moves.

## Verification

The engine (`js/engine.js`, pure function `scoreQuiz(bank, answers)`) ships with 31 golden tests covering
the 100-point best path, every gate close/review/cap behavior, the max-plus and deduct rules, branch
visibility (hidden answers can't leak points or flags), flag derivation, and empty input. Run them with
macOS's built-in JavaScript runtime — no Node required:

    cd apps/claim-readiness && osascript -l JavaScript test/run-tests.js

Any change to `questions.json` point values or gate conditions must keep these passing (update expected
totals deliberately, never casually).
