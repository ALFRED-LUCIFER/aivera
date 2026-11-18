# Screen map

Every screen is an artboard in the claude.ai Design canvas "Aivera — Evidence Intelligence". The artboard is the spec for layout and copy; [DESIGN.md](../../DESIGN.md) is the spec for tokens and components. Interactive states named in the artboard (preview, sent, done…) are the states the screen must implement.

| Artboard file                        | Title                                                   | Journey | Route (planned)                   |
| ------------------------------------ | ------------------------------------------------------- | ------- | --------------------------------- |
| `Foundations.dc.html`                | Design system foundations                               | J0      | `@aivera/ui` gallery              |
| `Landing.dc.html`                    | Website                                                 | J7      | `/`                               |
| `SignUp.dc.html`                     | Create workspace                                        | J1      | `/signup`                         |
| `SignIn.dc.html`                     | Sign in                                                 | J1      | `/signin`                         |
| `Roles.dc.html`                      | Jobs                                                    | J1      | `/app/jobs`                       |
| `RoleNew.dc.html`                    | Add a job                                               | J1      | `/app/jobs/new`                   |
| `Rubric.dc.html`                     | Job rubric                                              | J1      | `/app/jobs/[jobId]/rubric`        |
| `Inbox.dc.html`                      | Inbox                                                   | J2      | `/app/inbox`                      |
| `Candidates.dc.html`                 | Job: ranked candidates                                  | J2      | `/app/jobs/[jobId]/candidates`    |
| `Candidate.dc.html`                  | Candidate evidence profile                              | J2      | `/app/candidates/[personId]?job=` |
| `Compare.dc.html`                    | Job: candidate comparison                               | J2      | `/app/jobs/[jobId]/compare`       |
| `People.dc.html`                     | Candidates (all jobs)                                   | J2      | `/app/candidates`                 |
| `Portal.dc.html`                     | Candidate upload page                                   | J2      | `/r/[token]`                      |
| `Interviews.dc.html`                 | Interviews                                              | J3      | `/app/interviews`                 |
| `Interview.dc.html`                  | Interview scorecard                                     | J3      | `/app/interviews/[interviewId]`   |
| `Pack.dc.html`                       | Job: decision pack                                      | J3      | `/app/jobs/[jobId]/pack`          |
| `ClientPack.dc.html`                 | Client view of the shortlist                            | J3      | `/share/[token]`                  |
| `Desk.dc.html`                       | My desk                                                 | J4      | `/app`                            |
| `Pool.dc.html`                       | Talent pool                                             | J4      | `/app/pool`                       |
| `Main.dc.html`                       | Value dashboard                                         | J4      | `/app/value`                      |
| `CHome.dc.html`                      | Candidate site: home                                    | J5      | `/candidates`                     |
| `CJobs.dc.html`                      | Candidate site: jobs                                    | J5      | `/candidates/jobs`                |
| `CJob.dc.html` … `CJob5.dc.html`     | Candidate site: job detail (AI, QA, PM, sales, banking) | J5      | `/candidates/jobs/[slug]`         |
| `CApply.dc.html` … `CApply5.dc.html` | Candidate site: apply                                   | J5      | `/candidates/jobs/[slug]/apply`   |
| `CCheck.dc.html`                     | Candidate site: free CV check                           | J5      | `/candidates/cv-check`            |
| `CSignUp.dc.html`                    | Candidate site: create account                          | J5      | `/candidates/signup`              |
| `CDash.dc.html`                      | Candidate site: my applications                         | J5/J6   | `/candidates/me`                  |
| `CPlans.dc.html`                     | Candidate site: plans                                   | J6      | `/candidates/plans`               |
| `CPay.dc.html`                       | Candidate site: start Plus                              | J6      | `/candidates/plus/checkout`       |
| `CName.dc.html`                      | Candidate site: portfolio address                       | J6      | `/candidates/plus/address`        |
| `CFolio.dc.html`                     | Candidate site: public portfolio                        | J6      | `<name>.aivera…`                  |
| `CTailor.dc.html`                    | Candidate site: tailored CV                             | J6      | `/candidates/me/cv/[jobSlug]`     |

Routes are planned; the ticket that builds a screen confirms its route and updates this table.
