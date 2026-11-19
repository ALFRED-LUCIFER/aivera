# Personas and synthetic demo cast

**Every person here is synthetic.** Use only these people (or new ones added here) in code, fixtures, tests, screenshots, issues and AI evaluation sets. Emails are `firstname@example.com`; portfolio hosts are `<name>.aivera.example`. `pnpm db:seed` loads this cast from [`tools/seed/src/cast.ts`](../../tools/seed/src/cast.ts): seeded candidates use `firstname.lastname@example.com` and phones in Ofcom's drama range `+44 7700 900xxx`. Any similarity to a real person is accidental; if one is found, rename them here and everywhere they appear.

## Roles

| Role                          | Who in the demo                                                                                                                                                                                       | Uses                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Recruiter                     | The signed-in user ("AP", a talent partner)                                                                                                                                                           | Everything in the recruiter app      |
| Workspace admin               | Alex Recruiter (`alex@example.com`), who creates workspace "Demo Hiring Co" in the workspaces tests                                                                                                   | Workspace members and roles          |
| Hiring owner                  | Head of Engineering (`hassan@example.com`, Demo Hiring Co); CPO, Payments; Head of Quality; VP Engineering; Design Director                                                                           | Rubric approval, decision pack       |
| Interviewer                   | The recruiter or the hiring owner; Rami Panel (`rami@example.com`, Demo Hiring Co, also on Gulf Talent Partners' panel)                                                                               | Scorecard                            |
| Client                        | CPO, Payments (agency case)                                                                                                                                                                           | Client view of the shortlist         |
| Solo recruiter                | Nadia Freelance (`nadia@example.com`), see below                                                                                                                                                      | Her own one-member workspace         |
| Recruiter (AI drafting tests) | Mira Recruiter (`mira@example.com`), admin of "Draft Studio"; Karim Recruiter (`karim@example.com`), admin of "Spent Budget Co", whose daily AI budget is used up                                     | Draft competencies (AIV-P1-008)      |
| Candidate                     | Sara Al Qahtani and the cast below                                                                                                                                                                    | Candidate site, evidence upload page |
| Platform operator             | Pia Platform (`pia.platform@example.com`) and Theo Platform (`theo.platform@example.com`), in tests and the e2e config only; never a workspace member ([ADR-012](../adr/ADR-012-operator-console.md)) | Operator console `/ops`              |

## Individual recruiters and agencies ([ADR-009](../adr/ADR-009-identity-and-account-model.md))

| Who or what                                | Type           | Details                                                                                                                                                                                                                              |
| ------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nadia Freelance, `nadia@example.com`       | Solo recruiter | Signs up with a personal email and no company. Admin of her one-member workspace "Nadia Freelance". Also a recruiter in "Gulf Talent Partners", and switches between the two.                                                        |
| Gulf Talent Partners                       | Agency         | Admin Omar Agency (`omar.agency@example.com`). Two clients, below. Its talent pool covers both clients.                                                                                                                              |
| Client "Falcon Pay" (a BNPL fintech)       | Agency client  | Hiring owner Huda Client (`huda@example.com`), "CPO, Falcon Pay", granted the client's jobs. Job: Senior Product Manager, Payments.                                                                                                  |
| Client "Dune Logistics" (a logistics firm) | Agency client  | Hiring owner Faisal Client (`faisal@example.com`), "Head of Engineering, Dune Logistics", granted one job: Staff Backend Engineer. Interviewer Lina Panel (`lina@example.com`), granted the same job. Neither sees Falcon Pay's job. |

## Demo jobs (workspace "Demo")

| Job                              | Team · location               | Hiring owner        | Stage                            |
| -------------------------------- | ----------------------------- | ------------------- | -------------------------------- |
| Senior AI Engineer               | Engineering · DIFC, Dubai     | Head of Engineering | Round 1 interviews, 64 assessed  |
| Senior Product Manager, Payments | Product · Dubai Internet City | CPO, Payments       | Round 1 interviews, 52 assessed  |
| QA Automation Engineer           | Quality · Dubai, hybrid       | Head of Quality     | Collecting evidence, 38 assessed |
| Staff Backend Engineer           | Engineering · Riyadh, hybrid  | VP Engineering      | Collecting evidence, 31 assessed |
| Senior Product Designer          | Design · Abu Dhabi            | Design Director     | Defining rubric                  |

AP signs in as `ap@example.com` in the e2e seed. Each demo hiring owner is a user named by their title, at `head.engineering@example.com`, `cpo.payments@example.com`, `head.quality@example.com`, `vp.engineering@example.com` and `design.director@example.com`.

Candidate-site listings also include Real Estate Sales Consultant (a property brokerage, Dubai) and Senior Software Engineer, Banking (a retail bank, Dubai). Employers are described generically ("A BNPL fintech"), never named.

## Candidates

| Name              | Main job                         | Backed score | Notes                                                                                                                                                                        |
| ----------------- | -------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sara Al Qahtani   | Senior AI Engineer               | 68, up to 84 | Rank 1 of 64. Eval harness (412 of 460 commits), merchant assistant (~9,000 merchants). Open claims: 40% cost cut, Gulf Arabic eval set. Plus member, `sara.aivera.example`. |
| Arjun Menon       | Senior AI Engineer               | 64, up to 76 | Open-source queue library maintainer; KYC document reader.                                                                                                                   |
| Layla Haddad      | Senior AI Engineer               | 61, up to 82 | Only inspected Arabic work (Arabic OCR pipeline).                                                                                                                            |
| Daniel Novak      | Senior AI Engineer               | 55, up to 78 | Round 1 today; claim 71% → 88% answer accuracy.                                                                                                                              |
| Priya Nair        | Senior AI Engineer               | 49, up to 77 | Round 1 on 20 Nov.                                                                                                                                                           |
| Omar Al Suwaidi   | Senior AI Engineer               | 38, up to 74 | Evidence requested, reminded twice.                                                                                                                                          |
| Maria Santos      | Senior AI Engineer               | 31, up to 69 | CV only so far.                                                                                                                                                              |
| Hessa Al Mazrouei | QA Automation Engineer           | 72, up to 85 | 148 of 171 test cases in `checkout-e2e`.                                                                                                                                     |
| Karim Nasser      | Senior Product Manager, Payments | 66, up to 79 | Round 2 on 21 Nov.                                                                                                                                                           |
| Rana Khoury       | Senior Product Manager, Payments | 58, up to 74 | Round 1 on 20 Nov.                                                                                                                                                           |
| Anjali Iyer       | Senior Product Manager, Payments | —            | Scorecard due.                                                                                                                                                               |
| Tarek Mansour     | Staff Backend Engineer           | 63, up to 80 | In 2 jobs; saga library.                                                                                                                                                     |
| Inbox arrivals    | various                          | —            | Fatima Al Hammadi, Sneha Iyer, Anna Schmidt, Mark Reyes, Youssef Aziz, Paolo Garcia                                                                                          |
| Talent pool       | various                          | —            | Hala Saleh, Imran Qureshi, Kristine Dela Cruz, Lukas Schmidt, Noura Al Ketbi                                                                                                 |
