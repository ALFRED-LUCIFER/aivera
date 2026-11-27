# User journeys J0–J7

Each journey is a Project 2 "Journey" value, an epic group, and (from J1 on) a Playwright journey spec in `tests/e2e`. A journey step turns green when its screen's Gherkin scenarios pass end to end.

## J0 Platform foundation

Not user-visible. Repository rules, toolchain, migrations, CI, Azure dev environment, sign-in, workspaces with row-level security, audit log, outbox and worker, uploads, email, the design system package, AI platform and eval harness, synthetic seed.

## J1 Workspace and first job (recruiter)

1. Create a workspace (name, any email, company if there is one, in-house team or agency, what they hire for most; email and password or one-time code, Google or Microsoft) → lands on Add a job. A solo recruiter gets a one-member workspace ([ADR-009](../adr/ADR-009-identity-and-account-model.md)).
2. Sign in (email, Google or Microsoft; company SSO per workspace later) → My desk. A person in several workspaces switches between them in the app shell.
3. Add a job: choose the job type (sets which evidence counts), title, description, team or client (agencies), location, hiring owner → **Draft competencies**: Credalent drafts those the description states (weight, level 1–5, mandatory/desirable, evidence expected) and suggests what it leaves out with a reason; keep, edit or remove each.
4. Save as the job's rubric (weights total 100%) → the recruiter approves it (version 1), or chooses to send it to the hiring owner first ([ADR-014](../adr/ADR-014-recruiters-approve-rubrics.md)). Editing a weight creates a new version that needs approval; rankings do not change until it is approved.
5. Optionally publish the job on the candidate site (preview of what candidates see; weights, client name and scores stay hidden).

## J2 Evidence and ranking (recruiter, candidate)

1. Inbox: applications from several sources are merged into one person per candidate, with a first pass (must-haves backed, what it rests on, flags such as "applied to 5 roles", "already submitted") and a suggested next step. Nobody is rejected.
2. Assess fully: evidence from the CV, repositories, documents and shipped products is collected, each piece with provenance and strength, and scored per competency against the rubric.
3. Ranked candidates: backed score with claim range, "meets the job's need on N of 6", confidence, missing critical evidence, next action; the "Who is ahead, and how sure are we?" chart.
4. Candidate evidence profile: why they rank there, proven versus needed per competency, competency-by-competency evidence with highlights and limits, needs live verification, interview history, across roles.
5. Compare the candidates ticked on the ranking (2 to 10) side by side, with the trade-offs.
6. Request evidence (single or bulk, always previewed, auto follow-up after 2 days, at most twice) → candidate upload page (two minutes; "I cannot share this" is allowed and costs nothing) → assessment updates.

## J3 Interviews and decisions (recruiter, interviewer, hiring owner, client)

1. Interviews list (ongoing, completed) with competencies to investigate.
2. Scorecard: evidence-linked questions per gap, rating (Not shown → Strongly shown) with a live preview of the backed-score change, notes, recommendation; submit is logged.
3. Decision pack: what the role needs, per candidate strengths, risks and Round 1 finding, Credalent's recommendation; the hiring owner records Advance, Hold or Do not advance. No candidate is contacted.
4. Client view of the shortlist (signed link): Interview, Hold or Pass with optional feedback, sent to the recruiter.

## J4 Recruiter desk and insight

1. My desk: waiting on you (oldest first), waiting on others (Credalent chases), jobs by pace, monthly target with observed and projected values.
2. Candidates across all jobs, one row per person.
3. Talent pool: evidence carries over, re-scored against a new job's rubric; invite with a drafted, previewed message.
4. Value dashboard: interviews per completed hire (north star), supporting metrics, each with its basis and next step; "not yet available" until a hire completes.
5. Credalent assistant on every page: page-aware suggestions, answers cite evidence, any change is a preview awaiting confirmation.

## J5 Candidate site

Home → jobs (each shows what it needs) → job detail (competencies and levels, how you will be judged) → apply (about you, CV, links to work for the two heaviest competencies, consent) → my applications (stages, evidence requests). Free CV check against one job at a time. Create account.

## J6 Candidate Plus

Plans → create account and pay (AED 49 a month) → claim portfolio address (taken-name suggestions) → public portfolio (labels for how each piece was checked) → CV tailored per job (every change shown, nothing invented) → gap report → interview preparation → jobs ranked by fit. Paying never changes recruiter ranking.

## J7 Website and launch

Marketing site (how it works, roles covered, why trust it, the one number to judge us on), SEO, Arabic right-to-left, launch gate.
