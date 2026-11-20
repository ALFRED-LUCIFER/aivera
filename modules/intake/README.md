# @credalent/intake

Applications per job and where each one came from (AIV-P1-017). An application links one person (`@credalent/candidates`) to one job (`@credalent/jobs`). Other code imports only `@credalent/intake` (the `IntakeContract` types); apps build it with `createIntake(workspaces, candidates, jobs, now)` from `@credalent/intake/composition`.

- **Tables:** `intake.application` (person id, job id, stage, `received_at` of the first arrival, `submitted_to_client_at`), `intake.application_source` (one row per arrival: source, `received_at`, Blob `file_ids`, `links`) and `intake.outbox`. `application_person_job_key` makes one application per person per job, so a second arrival adds a source. Person and job ids are opaque: no foreign keys across modules. The source's foreign key includes the workspace, so it cannot point at another workspace's application. Migrations are tracked in `migrations.intake`.
- **Sources:** `linkedin | careers_page | referral | email | whatsapp`, a check constraint matching `SOURCES`.
- **Stages:** `new | first_pass_done | assessing | in_process | in_pool | withdrawn`, a check constraint matching `STAGES`. There is no rejected stage: nothing rejects a candidate automatically (AGENTS.md 1.5).
- **Contract:** `receiveApplication(ctx, { jobId, person, source, fileIds, links })` checks the job is in the workspace (else `IntakeError('job_not_found')`, writing nothing), finds or creates the person, creates or reuses the application and records the source. Admins and recruiters (`candidate.create`).
- **Event:** `ApplicationReceived.v1` (`{ applicationId, sourceId }`, strict, opaque ids only) is written to `intake.outbox` in the same transaction, on every arrival, since each can bring new files.
- **Row-level security (ADR-005):** every table `ENABLE` + `FORCE ROW LEVEL SECURITY` with `tenantPolicy` on `workspace_id`; the repository also filters by workspace.
- **Personal data (AGENTS.md 1.2):** `links` is personal data (`PERSONAL_DATA_FIELDS`); the module never logs.
- **Not here:** merging duplicate people (AIV-P1-018), the email and upload channels and their zod validation (AIV-P1-019), careers-page applications from the candidate site (AIV-P3-008).
- **Shortcut:** the worker relay does not read `intake.outbox` yet, because nothing consumes `ApplicationReceived.v1`; events wait there, unsent. Add `intake` to the worker's outboxes and map the event to a queue with its first consumer (evidence ingestion, AIV-P1-025).
- **Tests:** stage enum in `src/domain/application.test.ts`; database scenarios in `tests/integration/src/intake.test.ts`.
