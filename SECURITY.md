# Security policy

Aivera holds candidates' CVs, work evidence, contact details and assessments. The rules that protect them are in [AGENTS.md §1](AGENTS.md#1--non-negotiable-safety-rules).

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting on this repository ("Security" tab → "Report a vulnerability"). We acknowledge within 3 working days.

## In scope

Workspace isolation (row-level security), authorisation on server actions, route handlers and worker jobs, signed links (candidate upload page, client shortlist view), file upload handling, webhook verification, and leakage of candidate data into logs, URLs or telemetry.

## Data handling

- All data in the repository, CI and the dev environment is synthetic.
- Production data stays in Azure UAE North.
- Secrets live in Azure Key Vault; nothing secret is committed.
