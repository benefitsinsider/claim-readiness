# Readiness Report — beehiiv automation email

Set up in beehiiv: **Automations → New automation → Trigger: Signup** with condition
`utm_source = mydisabilitycheck`. One email, sent immediately. Sender: "Kwame from
Benefits Insider". The merge tags below are the custom fields the Netlify function
populates — they exist under **Settings → Custom fields**: First Name, Phone Number,
SMS Consent, Readiness Score, Readiness Tier, Sections Summary, Gates Closed,
Consent At, Consent IP, Consent Form Version. Insert them in the email via
beehiiv's personalization menu (the {{ }} names below are placeholders for those).

**Subject:** Your Claim Readiness Report: {{Readiness Score}}/100
**Alt A:** {{First Name}}, your Readiness Score is {{Readiness Score}} — here's what it means
**Alt B:** Your disability claim readiness: {{Readiness Tier}}
**Alt C:** The report you requested — {{Readiness Score}}/100, {{Readiness Tier}}

---

{{First Name}},

Here is the Readiness Report you requested — your copy to keep, print, and bring
to any conversation about your claim.

## Your Claim Readiness Score: {{Readiness Score}} / 100

**Your readiness tier: {{Readiness Tier}}**

**Where your points came from:** {{Sections Summary}}

This score measures one thing: how prepared and organized your claim materials
appear **today**, based on your own answers. It is not a prediction of SSA's
decision — only SSA can make a disability determination. An honest lower score
is more useful than an inflated higher one, because it tells you exactly what
to strengthen. Your score can change as your record grows — many people
re-check after 30 days of building their documentation.

## How SSA actually decides a disability claim

Most denials surprise people because they never saw the test coming. SSA does
not pay for being sick or injured. It pays for being **unable to work, at a
defined earnings level, for at least 12 continuous months**. Once you apply,
your case runs through five steps, in order — and ends at the first step it
fails:

**Step 1 — Are you working above the earnings limit?** If your gross earnings
are above SSA's Substantial Gainful Activity level ($1,690/month in 2026;
$2,830 if you are statutorily blind), the claim is generally denied here, no
matter how serious the medical condition.

**Step 2 — Is there a severe, documented impairment expected to last 12
months?** No diagnosis, no medical records, or a condition expected to resolve
in under a year fails here. This is where claims without a built medical
record stall — not because the condition isn't real, but because there is
nothing on paper for SSA to evaluate.

**Step 3 — Does your condition meet a "Blue Book" Listing?** SSA keeps a list
of conditions severe enough to be presumptively disabling. Meet or equal one,
and the claim is generally approved at this step.

**Step 4 — Can you do any job you held in the last 15 years?** SSA assesses
what you can still do despite your limitations (your "residual functional
capacity") and compares it to your past work — as you actually performed it,
not the job title.

**Step 5 — Can you adjust to other work?** If you can't do past work, SSA asks
whether other jobs exist that you could do, given your limitations, age,
education, and work experience. This is where age matters: the rules shift
meaningfully at 50, 55, and 60.

Your Readiness Score maps to these same steps — the sections where you lost
points are the places SSA's process will look hardest.

## What to do with this report

1. **Keep it with your claim papers.** Your score and section breakdown are a
   snapshot of where things stood on the day you checked.
2. **Work the weakest section first.** For most people that's medical
   documentation or the day-to-day record of work limits (a symptom journal
   started today beats a perfect memory later).
3. **Re-check in 30 days.** Your saved results stay on your device at
   mydisabilitycheck.org — when you re-check, you'll see your last score and
   what's moved.
4. **If you talk to anyone about your claim** — SSA, an attorney, or an
   eligible non-attorney representative — bring this report. It saves them
   discovery time and saves you repeating yourself.

I'll also send you The Daily 3 on weekday mornings — the Social Security
update, the benefits item that affects your check, and one practical action
for the day. No panic. No politics. Just clarity.

Kwame Kuadey
The Benefits Insider™
Adjunct Professor of Finance · Johns Hopkins Carey Business School

---

*This report is an educational self-screen based solely on your own answers.
It is not legal advice, not a disability determination, and not a
recommendation to file or not file. Benefits Insider is not affiliated with
or endorsed by the Social Security Administration or any government agency.
Applying for disability benefits is free at ssa.gov or 1-800-772-1213.
Figures cited are for 2026 and are reviewed each January.*

(beehiiv appends the postal address and unsubscribe link automatically —
both are required on every send.)
