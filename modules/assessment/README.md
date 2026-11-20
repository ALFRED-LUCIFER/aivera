# @credalent/assessment

The scoring core (AIV-P1-030): a candidate's mapped evidence and a job's approved rubric version in, the backed score, the claim range and a level per competency out. Other code imports only `@credalent/assessment`; apps build it with `createAssessment(workspaces, audit, now)` from `@credalent/assessment/composition`.

- **`assess(rubric, links)`** is pure and deterministic (`src/domain/assess.ts`). Per competency:
  - **Proven level (0–5):** the highest level among items that count: Strong or Medium work that is `corroborated` or `submitted`, and Supporting only when `corroborated`. Claims, contradicted items and items awaiting live defence never count (AGENTS.md 1.6).
  - **Claimed level:** the highest level of any linked item, never below the proven level.
  - **Citations:** a proven level above 0 always lists the item ids it rests on; the type `Proven` makes an uncited level impossible.
- **Scores:** backed = Σ weight × proven level ÷ 5, rounded (0–100); "up to N if claims hold" = the same with claimed levels. Owner decision, 20 Nov 2026: the formula wins over the design's illustrative numbers, so Sara Al Qahtani scores 63 up to 83 on the Senior AI Engineer rubric version 2.
- **Also:** "meets the job's need on X of N" (proven ≥ level needed), `missingCritical` (mandatory competencies proven below the need: evidence to request, never a reason to reject), and confidence from the share of weight proven by Strong evidence (High from 60%, Medium from 30%, else Low).
- **What reaches the score:** per link only the item id, competency, level, strength and provenance (`toLinks`). Anything else on an item or its source, such as an "Unusual content in this source" note, is dropped, so it never acts on the candidate (AGENTS.md 1.5).
- **Table:** `assessment.result`, one row per assessment that changed something: the score history of a candidate for a job. Ids, levels and numbers only. `ENABLE` + `FORCE ROW LEVEL SECURITY` with `tenantPolicy`; the app role cannot update a row (history) but can delete (erasure). Check constraints keep the backed score within 0–100 and at most the upper bound.
- **Contract:** `assessCandidate(ctx, { candidateId, jobId, rubric, evidence })` stores the result when it differs from the latest and audits a changed score (`score.changed`, before and after scores, the last write); `getLatestAssessment(ctx, candidateId, jobId)`. Admins and recruiters (`candidate.create`, `candidate.view`). Nothing is rejected, advanced or sent.
- **Paying never changes ranking:** the module imports nothing from billing, portfolio, ops or candidate-accounts (architecture rule `paying-never-changes-ranking`).
- **Not here:** running on events (AIV-P1-031), explanations (AIV-P1-033), interview score changes (AIV-P2-005, AIV-P2-006). The caller passes the rubric competencies with their ids until the jobs contract returns them (AIV-P1-027).
- **Tests:** rules, the claims-never-count property and determinism in `src/domain/assess.test.ts`; the note in `src/application/assessment.test.ts`; database scenarios in `tests/integration/src/assessment.test.ts`.
