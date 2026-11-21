# Personas and synthetic demo cast

**Every person here is synthetic.** Use only these people (or new ones added here) in code, fixtures, tests, screenshots, issues and AI evaluation sets. Emails are `firstname@example.com`; portfolio hosts are `<name>.credalent.example`. `pnpm db:seed` loads this cast from [`tools/seed/src/cast.ts`](../../tools/seed/src/cast.ts): seeded candidates use `firstname.lastname@example.com` and phones in Ofcom's drama range `+44 7700 900xxx`. GitHub logins in tests and fixtures are `<firstname>-credalent-example` (`sara-credalent-example`), always against a synthetic API host (`api.github.credalent.example`). Any similarity to a real person is accidental; if one is found, rename them here and everywhere they appear.

## Roles

| Role                                               | Who in the demo                                                                                                                                                                                       | Uses                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Recruiter                                          | The signed-in user: Ayesha Perera (`ap@example.com`), a talent partner, "AP" in the end-to-end seed; admin of "Meridian Talent" in `pnpm db:seed`                                                     | Everything in the recruiter app      |
| Workspace admin                                    | Alex Recruiter (`alex@example.com`), who creates workspace "Demo Hiring Co" in the workspaces tests                                                                                                   | Workspace members and roles          |
| Hiring owner                                       | Head of Engineering (`hassan@example.com`, Demo Hiring Co); CPO, Payments; Head of Quality; VP Engineering; Design Director                                                                           | Rubric approval, decision pack       |
| Interviewer                                        | The recruiter or the hiring owner; Rami Panel (`rami@example.com`, Demo Hiring Co, also on Gulf Talent Partners' panel)                                                                               | Scorecard                            |
| Client                                             | CPO, Payments (agency case)                                                                                                                                                                           | Client view of the shortlist         |
| Solo recruiter                                     | Nadia Freelance (`nadia@example.com`), see below                                                                                                                                                      | Her own one-member workspace         |
| Recruiter (AI drafting tests)                      | Mira Recruiter (`mira@example.com`), admin of "Draft Studio"; Karim Recruiter (`karim@example.com`), admin of "Spent Budget Co", whose daily AI budget is used up                                     | Draft competencies (AIV-P1-008)      |
| Recruiter and hiring owner (rubric approval tests) | Tariq Recruiter (`tariq@example.com`), admin of "Approvals Co"; its hiring owner (`head.approvals@example.com`, title "Head of Engineering"), who approves its rubrics                                | Rubric approval (AIV-P1-014)         |
| Hiring owner (journey harness)                     | Hana Owner (`hana.owner@example.com`, shown as `hana.owner`, the mocked tenant's name), a hiring owner in AP's "Demo" with no jobs granted, who signs in as the e2e `hiringOwner` fixture             | J0 journey harness                   |
| Candidate                                          | Sara Al Qahtani and the cast below                                                                                                                                                                    | Candidate site, evidence upload page |
| Recruiter (not an admin)                           | Zaid Recruiter (`zaid@example.com`), recruiter in the agency "Oasis Talent", whose admin is Leila Agency (`leila@example.com`) and where Faisal Client is also a hiring owner                         | Read-only settings (AIV-P1-052)      |
| Platform operator                                  | Pia Platform (`pia.platform@example.com`) and Theo Platform (`theo.platform@example.com`), in tests and the e2e config only; never a workspace member ([ADR-012](../adr/ADR-012-operator-console.md)) | Operator console `/ops`              |

## Individual recruiters and agencies ([ADR-009](../adr/ADR-009-identity-and-account-model.md))

| Who or what                                | Type           | Details                                                                                                                                                                                                                                 |
| ------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nadia Freelance, `nadia@example.com`       | Solo recruiter | Signs up with a personal email and no company. Admin of her one-member workspace "Nadia Freelance". Also a recruiter in "Gulf Talent Partners", and switches between the two.                                                           |
| Gulf Talent Partners                       | Agency         | Admin Omar Agency (`omar.agency@example.com`). Two clients, below. Its talent pool covers both clients.                                                                                                                                 |
| Client "Falcon Pay" (a BNPL fintech)       | Agency client  | Hiring owner Huda Client (`huda@example.com`), "CPO, Falcon Pay", granted the client's jobs. Job: Senior Product Manager, Payments.                                                                                                     |
| Client "Dune Logistics" (a logistics firm) | Agency client  | Hiring owner Faisal Client (`faisal@example.com`), "Head of Engineering, Dune Logistics", granted one job: Staff Backend Engineer. Interviewer Lina Panel (`lina@example.com`), granted the same job. Neither sees Falcon Pay's job.    |
| Harbour Talent                             | Agency         | Admin Tariq Agency (`tariq.agency@example.com`). The same two clients and jobs as Gulf Talent Partners, in the end-to-end tests only: Tariq invites people there and Faisal accepts an invitation to Dune Logistics' jobs (AIV-P1-003). |

## Demo jobs (workspace "Meridian Talent", company Meridian Digital; "Demo" in the end-to-end seed)

| Job                              | Team · location               | Hiring owner                        | Stage                            |
| -------------------------------- | ----------------------------- | ----------------------------------- | -------------------------------- |
| Senior AI Engineer               | Engineering · DIFC, Dubai     | Hassan Barakat, Head of Engineering | Round 1 interviews, 64 assessed  |
| Senior Product Manager, Payments | Product · Dubai Internet City | Camille Fares, CPO, Payments        | Round 1 interviews, 52 assessed  |
| QA Automation Engineer           | Quality · Dubai, hybrid       | Rashid Al Nuaimi, Head of Quality   | Collecting evidence, 38 assessed |
| Staff Backend Engineer           | Engineering · Riyadh, hybrid  | Vikram Deshmukh, VP Engineering     | Collecting evidence, 31 assessed |
| Senior Product Designer          | Design · Abu Dhabi            | Dina Sabbagh, Design Director       | Defining rubric                  |

`pnpm db:seed` writes the five jobs above from the seed cast (`tools/seed/src/cast.ts`) at their stages (AIV-P1-067): each rubric approved by its hiring owner on its design date (Senior AI Engineer: version 1 on 5 Nov 2026, superseded by version 2 on 12 Nov; Senior Product Manager, Payments 5 Nov; QA Automation Engineer 9 Nov; Staff Backend Engineer 10 Nov), the Senior Product Designer's still a draft. Candidates and assessed counts are not seeded yet. It also writes five industry jobs (AIV-P1-065), each with a draft rubric v1 at "Defining rubric": the job type's starter competencies plus its domain pack's core competencies and regional hints (all desirable).

| Job                                  | Job type × domain pack                        | Team · location             | Hiring owner        | Regional hints |
| ------------------------------------ | --------------------------------------------- | --------------------------- | ------------------- | -------------- |
| Senior Backend Engineer, Payments    | Software engineering × Payments and fintech   | Engineering · DIFC, Dubai   | VP Engineering      | UAE            |
| Integration Engineer, Health Records | Forward deployed engineering × Healthcare     | Engineering · Abu Dhabi     | Head of Engineering | UAE            |
| Data Engineer, Marketplace           | Data and ML × E-commerce and marketplaces     | Data · Riyadh               | VP Engineering      | KSA            |
| SRE, Core Banking                    | DevOps and SRE × Banking and Islamic finance  | Platform · Riyadh, hybrid   | VP Engineering      | KSA            |
| QA Engineer, Payments                | QA and test automation × Payments and fintech | Quality · Bengaluru, hybrid | Head of Quality     | India          |

Their employers are a card and wallet payments company, a digital health company, an online marketplace, a retail bank and a payments gateway.

Ayesha Perera signs in as `ap@example.com`. In `pnpm db:seed` each demo hiring owner has a full name and keeps the title in the job's hiring-owner field: Hassan Barakat at `head.engineering@example.com`, Camille Fares at `cpo.payments@example.com`, Rashid Al Nuaimi at `head.quality@example.com`, Vikram Deshmukh at `vp.engineering@example.com` and Dina Sabbagh at `design.director@example.com`. The end-to-end seed (`tests/e2e/seed.ts`) still names its copies of these users by title. Every seeded person has a different surname.

Candidate-site listings also include Real Estate Sales Consultant (a property brokerage, Dubai) and Senior Software Engineer, Banking (a retail bank, Dubai). Employers are described generically ("A BNPL fintech"), never named.

## Candidates

| Name              | Main job                         | Backed score | Notes                                                                                                                                                                           |
| ----------------- | -------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sara Al Qahtani   | Senior AI Engineer               | 68, up to 84 | Rank 1 of 64. Eval harness (412 of 460 commits), merchant assistant (~9,000 merchants). Open claims: 40% cost cut, Gulf Arabic eval set. Plus member, `sara.credalent.example`. |
| Arjun Menon       | Senior AI Engineer               | 64, up to 76 | Open-source queue library maintainer; KYC document reader.                                                                                                                      |
| Layla Haddad      | Senior AI Engineer               | 61, up to 82 | Only inspected Arabic work (Arabic OCR pipeline).                                                                                                                               |
| Daniel Novak      | Senior AI Engineer               | 55, up to 78 | Round 1 today; claim 71% → 88% answer accuracy.                                                                                                                                 |
| Priya Nair        | Senior AI Engineer               | 49, up to 77 | Round 1 on 20 Nov.                                                                                                                                                              |
| Omar Al Suwaidi   | Senior AI Engineer               | 38, up to 74 | Evidence requested, reminded twice.                                                                                                                                             |
| Maria Santos      | Senior AI Engineer               | 31, up to 69 | CV only so far.                                                                                                                                                                 |
| Hessa Al Mazrouei | QA Automation Engineer           | 72, up to 85 | 148 of 171 test cases in `checkout-e2e`.                                                                                                                                        |
| Karim Nasser      | Senior Product Manager, Payments | 66, up to 79 | Round 2 on 21 Nov.                                                                                                                                                              |
| Rana Khoury       | Senior Product Manager, Payments | 58, up to 74 | Round 1 on 20 Nov.                                                                                                                                                              |
| Anjali Iyer       | Senior Product Manager, Payments | —            | Scorecard due.                                                                                                                                                                  |
| Tarek Mansour     | Staff Backend Engineer           | 63, up to 80 | In 2 jobs; saga library.                                                                                                                                                        |
| Inbox arrivals    | various                          | —            | Fatima Al Hammadi, Sneha Kulkarni, Anna Schmidt, Mark Reyes, Youssef Aziz, Paolo Garcia                                                                                         |
| Talent pool       | various                          | —            | Hala Saleh, Imran Qureshi, Kristine Dela Cruz, Lukas Brandt, Noura Al Ketbi                                                                                                     |
