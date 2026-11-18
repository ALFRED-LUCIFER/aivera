# @aivera/jobs

Jobs and per-job rubrics. So far it holds only the job types catalogue (AIV-P1-004); the job and rubric tables come with AIV-P1-005. Other code imports only `@aivera/jobs`.

- **Job types:** `JOB_TYPE_CATALOGUE` in `src/domain/job-types.ts` lists the ten job types in PRODUCT.md's order. Each has a `key`, a `labelKey` and an `evidenceKey` (`jobTypes.<key>.*` in `packages/i18n`), and four starter competencies. It is code, reviewed in PRs, with no table. Bump `JOB_TYPE_CATALOGUE_VERSION` when an entry changes meaning. Keys are stored as a workspace's hiring focus, so a key is never renamed.
- **Tests:** `src/domain/job-types.test.ts` covers the ticket's Gherkin and holds a snapshot of the catalogue.
