# Modules

The back end is a modular monolith ([ADR-002](../adr/ADR-002-repository-layout.md)). Each module is a package `modules/<m>` (`@aivera/<m>`) that owns one PostgreSQL schema of the same name ([ADR-004](../adr/ADR-004-database-and-migrations.md)). Other code imports only its contracts. This map is the plan; a module is created by the ticket that builds it, which updates its row.

| Module               | Owns                                                                                  | Publishes (examples)                       | State                                                |
| -------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| `workspaces`         | Workspaces (tenants), members, roles, invitations                                     | `MemberInvited.v1`                         | Built (AIV-P0-008); invitations planned (AIV-P1-003) |
| `identity`           | Sign-in sessions, Entra ID and External ID links                                      | —                                          | Planned                                              |
| `audit`              | Append-only audit log                                                                 | —                                          | Planned                                              |
| `jobs`               | Jobs, job types, rubric versions, competencies, approvals, publishing                 | `RubricApproved.v1`, `JobPublished.v1`     | Planned                                              |
| `candidates`         | One person across jobs; sources; dedupe and merge                                     | `CandidateMerged.v1`                       | Planned                                              |
| `intake`             | Applications per job, inbox, first pass                                               | `ApplicationReceived.v1`                   | Planned                                              |
| `evidence`           | Evidence items, provenance, strength, evidence requests, uploads                      | `EvidenceAdded.v1`, `EvidenceRequested.v1` | Planned                                              |
| `assessment`         | Competency scores, backed score and claim range, ranking, explanations                | `CandidateAssessed.v1`                     | Planned                                              |
| `interviews`         | Rounds, guides, scorecards, score changes                                             | `ScorecardSubmitted.v1`                    | Planned                                              |
| `decisions`          | Decision packs, decisions, client shares                                              | `DecisionRecorded.v1`                      | Planned                                              |
| `pool`               | Talent pool matches and invitations                                                   | —                                          | Planned                                              |
| `insights`           | Value metrics with their basis                                                        | —                                          | Planned                                              |
| `assistant`          | Page-aware assistant, previews                                                        | —                                          | Planned                                              |
| `ai`                 | AI platform: Foundry client, prompts, structured output, citation check, eval harness | —                                          | Planned                                              |
| `notifications`      | Email, follow-up schedules                                                            | —                                          | Planned                                              |
| `candidate-accounts` | Candidate accounts, applications view, CV check                                       | —                                          | Planned                                              |
| `portfolio`          | Portfolio addresses and public items                                                  | —                                          | Planned                                              |
| `billing`            | Plus subscriptions, Stripe                                                            | `PlusStarted.v1`                           | Planned                                              |

## Rules that the architecture test enforces

- A module imports another module only as `@aivera/<m>` (its contracts).
- `assessment`, `jobs` and `intake` never import `billing` or `portfolio` (AGENTS.md 1.8: paying never changes ranking).
- No module imports an app, `packages/ui` or `packages/tokens`.
- Only apps import `@aivera/<m>/composition`.
