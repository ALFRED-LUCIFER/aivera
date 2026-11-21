# ADR-014: Recruiters approve their jobs' rubrics

- **Status:** Accepted, 21 Nov 2026 (owner decision).
- **Ticket:** AIV-P1-083 (#448); My desk follows in AIV-P1-084 (#449).
- **Amends:** the J1 journey step 4 ([journeys](../01-design/journeys.md)) and AIV-P1-014's rule that only the job's hiring owner, or an admin acting as owner, approves a rubric.

## Context

A job's rubric is what candidates are assessed against: approving a version writes `RubricApproved.v1`, which starts assessment. Until now only the job's named hiring owner could approve, or an admin "acting as owner", recorded so. A version had to be sent for approval first, and sending it emails the hiring owner.

That model assumes a second person. The owner tested it with a one-person workspace on 21 Nov 2026 and decided: "If I'm a one-person company I create a job and make its rubric. I should approve it myself. A single recruiter in a big company should manage their own too. The hiring owner should never be contacted unless the recruiter wants: the recruiter shortlists and forwards the candidate list to them." A plain recruiter could not approve at all, so every job waited on someone else.

## Options

1. **Hiring owner approves (today).** Two people on every rubric, but a solo recruiter has no one to send to, and the hiring owner is contacted before the recruiter has anything to show.
2. **Auto-approve on save.** No extra click, but an editing slip would start assessment, and nothing records a decision to approve.
3. **The recruiter approves, explicitly (chosen).** Any admin or recruiter on the job clicks "Approve version N"; sending to the hiring owner first is optional.

## Decision

1. `rubric.approve` allows admins, recruiters and granted hiring owners. `approvesAs` returns `owner` for the job's named hiring owner and `recruiter` for any other admin or recruiter; there is no "on behalf of the owner" any more.
2. A draft or returned version may be approved directly by an admin or recruiter: the status machine allows `draft → approved` and `returned → approved`. "Return with a note" stays only for a version sent for approval.
3. A hiring owner decides only what was sent to them: a draft or returned version is refused to a hiring owner (403), checked in the jobs module, not only in the page.
4. "Send to the hiring owner" (save and send for approval) stays as the recruiter's choice, and is the only path that emails the hiring owner. The hiring owner approves or returns what was sent, as before.
5. Every approval is audited (`rubric.approved` with actor, time, version and `actingAs: recruiter | owner`). Entries written before this ADR may say `admin_as_owner`. An edit to an approved rubric opens a new version, which is approved again; the approved one stays in force until then.

## Consequences

- Assessment can start without the hiring owner. AGENTS.md 1.5 still holds: a person, the recruiter, decides, with an explicit click, and it is audited.
- The hiring owner's first contact is what the recruiter sends: a rubric, if the recruiter chooses, or later the shortlist and decision pack.
- The rubric page offers "Approve version N" on the open draft to admins and recruiters. My desk lists those drafts in AIV-P1-084.
- Revisit when a workspace needs the hiring owner's sign-off to be mandatory: a workspace setting, off by default.
