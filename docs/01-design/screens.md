# Screen map

Every screen is an artboard in the claude.ai Design canvas "Aivera — Evidence Intelligence", copied verbatim into [`artboards/`](artboards/) (with `canvas.json`, the canvas layout) so every agent, reviewer and Copilot can read it. Open the file before building or reviewing its screen (AGENTS.md section 4); deviations are listed in the component and the PR. The artboard is the spec for layout and copy; [DESIGN.md](../../DESIGN.md) is the spec for tokens and components. Interactive states named in the artboard (preview, sent, done…) are the states the screen must implement.

| Artboard file                                                    | Title                                                   | Journey | Route (planned)                   |
| ---------------------------------------------------------------- | ------------------------------------------------------- | ------- | --------------------------------- |
| [`Foundations.dc.html`](artboards/Foundations.dc.html)           | Design system foundations                               | J0      | `@aivera/ui` gallery              |
| [`Landing.dc.html`](artboards/Landing.dc.html)                   | Website                                                 | J7      | `/`                               |
| [`SignUp.dc.html`](artboards/SignUp.dc.html)                     | Create workspace                                        | J1      | `/signup`                         |
| [`SignIn.dc.html`](artboards/SignIn.dc.html)                     | Sign in                                                 | J1      | `/sign-in`                        |
| [`Roles.dc.html`](artboards/Roles.dc.html)                       | Jobs                                                    | J1      | `/app/jobs`                       |
| [`RoleNew.dc.html`](artboards/RoleNew.dc.html)                   | Add a job                                               | J1      | `/app/jobs/new`                   |
| [`Rubric.dc.html`](artboards/Rubric.dc.html)                     | Job rubric                                              | J1      | `/app/jobs/[jobId]/rubric`        |
| [`Inbox.dc.html`](artboards/Inbox.dc.html)                       | Inbox                                                   | J2      | `/app/inbox`                      |
| [`Candidates.dc.html`](artboards/Candidates.dc.html)             | Job: ranked candidates                                  | J2      | `/app/jobs/[jobId]/candidates`    |
| [`Candidate.dc.html`](artboards/Candidate.dc.html)               | Candidate evidence profile                              | J2      | `/app/candidates/[personId]?job=` |
| [`Compare.dc.html`](artboards/Compare.dc.html)                   | Job: candidate comparison                               | J2      | `/app/jobs/[jobId]/compare`       |
| [`People.dc.html`](artboards/People.dc.html)                     | Candidates (all jobs)                                   | J2      | `/app/candidates`                 |
| [`Portal.dc.html`](artboards/Portal.dc.html)                     | Candidate upload page                                   | J2      | `/r/[token]`                      |
| [`Interviews.dc.html`](artboards/Interviews.dc.html)             | Interviews                                              | J3      | `/app/interviews`                 |
| [`Interview.dc.html`](artboards/Interview.dc.html)               | Interview scorecard                                     | J3      | `/app/interviews/[interviewId]`   |
| [`Pack.dc.html`](artboards/Pack.dc.html)                         | Job: decision pack                                      | J3      | `/app/jobs/[jobId]/pack`          |
| [`ClientPack.dc.html`](artboards/ClientPack.dc.html)             | Client view of the shortlist                            | J3      | `/share/[token]`                  |
| [`Desk.dc.html`](artboards/Desk.dc.html)                         | My desk                                                 | J4      | `/app`                            |
| [`Pool.dc.html`](artboards/Pool.dc.html)                         | Talent pool                                             | J4      | `/app/pool`                       |
| [`Main.dc.html`](artboards/Main.dc.html)                         | Value dashboard                                         | J4      | `/app/value`                      |
| [`CHome.dc.html`](artboards/CHome.dc.html)                       | Candidate site: home                                    | J5      | `/candidates`                     |
| [`CJobs.dc.html`](artboards/CJobs.dc.html)                       | Candidate site: jobs                                    | J5      | `/candidates/jobs`                |
| [`CJob.dc.html`](artboards/CJob.dc.html) … `CJob5.dc.html`       | Candidate site: job detail (AI, QA, PM, sales, banking) | J5      | `/candidates/jobs/[slug]`         |
| [`CApply.dc.html`](artboards/CApply.dc.html) … `CApply5.dc.html` | Candidate site: apply                                   | J5      | `/candidates/jobs/[slug]/apply`   |
| [`CCheck.dc.html`](artboards/CCheck.dc.html)                     | Candidate site: free CV check                           | J5      | `/candidates/cv-check`            |
| [`CSignUp.dc.html`](artboards/CSignUp.dc.html)                   | Candidate site: create account                          | J5      | `/candidates/signup`              |
| [`CDash.dc.html`](artboards/CDash.dc.html)                       | Candidate site: my applications                         | J5/J6   | `/candidates/me`                  |
| [`CPlans.dc.html`](artboards/CPlans.dc.html)                     | Candidate site: plans                                   | J6      | `/candidates/plans`               |
| [`CPay.dc.html`](artboards/CPay.dc.html)                         | Candidate site: start Plus                              | J6      | `/candidates/plus/checkout`       |
| [`CName.dc.html`](artboards/CName.dc.html)                       | Candidate site: portfolio address                       | J6      | `/candidates/plus/address`        |
| [`CFolio.dc.html`](artboards/CFolio.dc.html)                     | Candidate site: public portfolio                        | J6      | `<name>.aivera…`                  |
| [`CTailor.dc.html`](artboards/CTailor.dc.html)                   | Candidate site: tailored CV                             | J6      | `/candidates/me/cv/[jobSlug]`     |
| [`operator-console.md`](operator-console.md) (no artboard)       | Operator console                                        | J0      | `/ops/**`                         |

Routes are planned; the ticket that builds a screen confirms its route and updates this table.

### Emails (canvas page "Emails and print")

Every email is a React Email template in `modules/notifications/src/infrastructure/templates`, all copy in `packages/i18n` under `emails`, with a plain-text version that matches the artboard's. [`ELayout.dc.html`](artboards/ELayout.dc.html) (shared layout and the development band), [`EComponents.dc.html`](artboards/EComponents.dc.html) and [`EStyle.dc.html`](artboards/EStyle.dc.html) (grid, type, colour tokens, the component names) are the spec for `components.tsx`.

| Artboard file                                                                                                                                                                | Email                                        | Template                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------- |
| [`EEvidence.dc.html`](artboards/EEvidence.dc.html)                                                                                                                           | Evidence request                             | `evidence-request` (built, AIV-P0-017)   |
| [`EEvRemind.dc.html`](artboards/EEvRemind.dc.html)                                                                                                                           | Evidence request reminder                    | Planned (AIV-P1-040)                     |
| [`EInvite.dc.html`](artboards/EInvite.dc.html), [`ERoles.dc.html`](artboards/ERoles.dc.html)                                                                                 | Workspace invitation and its role variants   | Planned (AIV-P1-003)                     |
| `ERubric`, `EApproved`, `EReturned`, `ENewer`, `EIntro`, `EPack`, `EScore`, `EApplied`, `EForward`, `EClosed`, `EPlus`, `EFailed`, `ECancel`, `ESignIn`, `ERtl` (`.dc.html`) | The other emails and the right-to-left proof | Planned, with the ticket that sends each |

Every route under `/app` is listed in `apps/web/src/features/shell/domain/navigation.ts` with its capability and flag; a test fails when the two drift (ADR-002 item 4). The sidebar sections (`/app`, `/app/inbox`, `/app/jobs`, `/app/candidates`, `/app/pool`, `/app/interviews`, `/app/packs`, `/app/value`) are placeholder pages from AIV-P0-020 until their screen tickets land. "Decision packs" in the sidebar lists open packs at `/app/packs`; each job's own pack stays at `/app/jobs/[jobId]/pack`.
